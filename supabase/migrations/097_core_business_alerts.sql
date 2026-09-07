-- =========================================================================
-- Nawasrah ERP - Core Business Alerts
--
-- Extends the existing Business outbox. It does not introduce a delivery
-- channel, recipient, or mutation path. Only conditions with a trusted source
-- are enabled by default; business thresholds with no approved value remain
-- NULL (disabled) until explicitly configured.
-- =========================================================================

BEGIN;

ALTER TABLE public.automation_events
  DROP CONSTRAINT IF EXISTS automation_events_event_type_check;
ALTER TABLE public.automation_events
  ADD CONSTRAINT automation_events_event_type_check CHECK (event_type IN (
    'new_order',
    'low_stock',
    'out_of_stock',
    'shift_closed',
    'order_unprocessed',
    'order_near_expiry',
    'order_expired',
    'shift_close_reminder',
    'shift_close_overdue',
    'purchase_order_overdue',
    'expense_daily_threshold',
    'business_alert_recovery'
  ));

CREATE TABLE public.business_alert_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  business_timezone TEXT NOT NULL DEFAULT 'Asia/Amman',
  order_expired_enabled BOOLEAN NOT NULL DEFAULT true,
  purchase_order_overdue_enabled BOOLEAN NOT NULL DEFAULT true,
  order_unprocessed_after_minutes INTEGER CHECK (
    order_unprocessed_after_minutes IS NULL
    OR order_unprocessed_after_minutes BETWEEN 1 AND 299
  ),
  order_near_expiry_minutes INTEGER CHECK (
    order_near_expiry_minutes IS NULL
    OR order_near_expiry_minutes BETWEEN 1 AND 299
  ),
  shift_expected_close_local_time TIME,
  shift_near_close_minutes INTEGER CHECK (
    shift_near_close_minutes IS NULL
    OR shift_near_close_minutes BETWEEN 1 AND 720
  ),
  cash_discrepancy_threshold_in_minor_units BIGINT CHECK (
    cash_discrepancy_threshold_in_minor_units IS NULL
    OR cash_discrepancy_threshold_in_minor_units > 0
  ),
  daily_expense_threshold_in_minor_units BIGINT CHECK (
    daily_expense_threshold_in_minor_units IS NULL
    OR daily_expense_threshold_in_minor_units > 0
  ),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.business_alert_settings (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.business_alert_incidents (
  incident_key TEXT PRIMARY KEY CHECK (
    NULLIF(TRIM(incident_key), '') IS NOT NULL
    AND length(incident_key) <= 240
  ),
  alert_type TEXT NOT NULL CHECK (alert_type IN (
    'order_unprocessed',
    'order_near_expiry',
    'shift_close_reminder',
    'shift_close_overdue',
    'purchase_order_overdue',
    'expense_daily_threshold'
  )),
  entity_id UUID NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'resolved')),
  occurrence INTEGER NOT NULL DEFAULT 1 CHECK (occurrence > 0),
  opened_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_business_alert_incidents_open
  ON public.business_alert_incidents(alert_type, last_seen_at, incident_key)
  WHERE state = 'open';

CREATE INDEX idx_purchase_orders_business_overdue
  ON public.purchase_orders(expected_delivery_date, id)
  WHERE status IN ('sent', 'approved', 'partially_received')
    AND expected_delivery_date IS NOT NULL;

ALTER TABLE public.business_alert_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_alert_incidents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.business_alert_settings
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.business_alert_incidents
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.business_alert_settings TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.business_alert_incidents TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_automation_event(
  p_event_key TEXT,
  p_event_type TEXT,
  p_entity_id UUID,
  p_payload JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_id UUID;
  v_event_key TEXT := NULLIF(TRIM(p_event_key), '');
  v_payload JSONB := COALESCE(p_payload, '{}'::JSONB);
BEGIN
  IF v_event_key IS NULL OR length(v_event_key) > 300 THEN
    RAISE EXCEPTION 'Invalid automation event key.';
  END IF;
  IF p_event_type NOT IN (
    'new_order', 'low_stock', 'out_of_stock', 'shift_closed',
    'order_unprocessed', 'order_near_expiry', 'order_expired',
    'shift_close_reminder', 'shift_close_overdue',
    'purchase_order_overdue', 'expense_daily_threshold',
    'business_alert_recovery'
  ) THEN
    RAISE EXCEPTION 'Invalid automation event type.';
  END IF;
  IF p_entity_id IS NULL THEN
    RAISE EXCEPTION 'Automation event entity is required.';
  END IF;
  IF jsonb_typeof(v_payload) <> 'object'
    OR octet_length(v_payload::TEXT) > 32768
  THEN
    RAISE EXCEPTION 'Invalid automation event payload.';
  END IF;

  INSERT INTO public.automation_events(event_key, event_type, entity_id, payload)
  VALUES (v_event_key, p_event_type, p_entity_id, v_payload)
  ON CONFLICT (event_key) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT id INTO v_event_id
    FROM public.automation_events
    WHERE event_key = v_event_key;
  END IF;

  RETURN v_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public._transition_business_alert_incident(
  p_incident_key TEXT,
  p_event_type TEXT,
  p_entity_id UUID,
  p_is_active BOOLEAN,
  p_observed_at TIMESTAMPTZ,
  p_payload JSONB DEFAULT '{}'::JSONB,
  p_emit_recovery BOOLEAN DEFAULT true
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_incident public.business_alert_incidents%ROWTYPE;
  v_occurrence INTEGER;
BEGIN
  IF p_incident_key IS NULL OR NULLIF(TRIM(p_incident_key), '') IS NULL
    OR length(p_incident_key) > 240
    OR p_entity_id IS NULL
    OR p_observed_at IS NULL
    OR p_event_type NOT IN (
      'order_unprocessed', 'order_near_expiry',
      'shift_close_reminder', 'shift_close_overdue',
      'purchase_order_overdue', 'expense_daily_threshold'
    )
  THEN
    RAISE EXCEPTION 'Invalid Business alert incident transition.';
  END IF;

  SELECT * INTO v_incident
  FROM public.business_alert_incidents
  WHERE incident_key = p_incident_key
  FOR UPDATE;

  IF p_is_active THEN
    IF NOT FOUND THEN
      v_occurrence := 1;
      INSERT INTO public.business_alert_incidents(
        incident_key, alert_type, entity_id, state, occurrence,
        opened_at, last_seen_at, resolved_at, updated_at
      ) VALUES (
        p_incident_key, p_event_type, p_entity_id, 'open', v_occurrence,
        p_observed_at, p_observed_at, NULL, p_observed_at
      );
    ELSIF v_incident.state = 'resolved' THEN
      v_occurrence := v_incident.occurrence + 1;
      UPDATE public.business_alert_incidents
      SET alert_type = p_event_type,
          entity_id = p_entity_id,
          state = 'open',
          occurrence = v_occurrence,
          opened_at = p_observed_at,
          last_seen_at = p_observed_at,
          resolved_at = NULL,
          updated_at = p_observed_at
      WHERE incident_key = p_incident_key;
    ELSE
      UPDATE public.business_alert_incidents
      SET last_seen_at = p_observed_at,
          updated_at = p_observed_at
      WHERE incident_key = p_incident_key;
      RETURN 'unchanged';
    END IF;

    PERFORM public.enqueue_automation_event(
      'business:' || p_incident_key || ':open:' || v_occurrence::TEXT,
      p_event_type,
      p_entity_id,
      COALESCE(p_payload, '{}'::JSONB) || jsonb_build_object(
        'incidentKey', p_incident_key,
        'state', 'open',
        'occurrence', v_occurrence,
        'observedAt', p_observed_at
      )
    );
    RETURN 'opened';
  END IF;

  IF NOT FOUND OR v_incident.state <> 'open' THEN
    RETURN 'unchanged';
  END IF;

  UPDATE public.business_alert_incidents
  SET state = 'resolved',
      last_seen_at = p_observed_at,
      resolved_at = p_observed_at,
      updated_at = p_observed_at
  WHERE incident_key = p_incident_key;

  IF p_emit_recovery THEN
    PERFORM public.enqueue_automation_event(
      'business:' || p_incident_key || ':resolved:' || v_incident.occurrence::TEXT,
      'business_alert_recovery',
      p_entity_id,
      COALESCE(p_payload, '{}'::JSONB) || jsonb_build_object(
        'incidentKey', p_incident_key,
        'resolvedAlertType', p_event_type,
        'state', 'resolved',
        'occurrence', v_incident.occurrence,
        'observedAt', p_observed_at
      )
    );
  END IF;
  RETURN 'resolved';
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_expired_order_business_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_enabled BOOLEAN;
BEGIN
  SELECT order_expired_enabled INTO v_enabled
  FROM public.business_alert_settings
  WHERE id = true;

  IF COALESCE(v_enabled, false)
    AND NEW.source = 'website'
    AND NEW.status = 'expired'
    AND OLD.status IS DISTINCT FROM 'expired'
  THEN
    PERFORM public.enqueue_automation_event(
      'order_expired:' || NEW.id::TEXT,
      'order_expired',
      NEW.id,
      jsonb_build_object(
        'orderId', NEW.id,
        'orderNumber', NEW.order_number,
        'expiredAt', NEW.expired_at,
        'reason', NEW.expired_reason,
        'source', NEW.source
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_expired_order_business_alert
  ON public.orders;
CREATE TRIGGER trg_enqueue_expired_order_business_alert
AFTER UPDATE OF status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_expired_order_business_alert();

CREATE OR REPLACE FUNCTION public.enqueue_closed_shift_automation_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_discrepancy_threshold BIGINT;
BEGIN
  IF OLD.status = 'open' AND NEW.status = 'closed' THEN
    SELECT cash_discrepancy_threshold_in_minor_units
    INTO v_discrepancy_threshold
    FROM public.business_alert_settings
    WHERE id = true;

    PERFORM public.enqueue_automation_event(
      'shift_closed:' || NEW.id::TEXT,
      'shift_closed',
      NEW.id,
      jsonb_build_object(
        'shiftId', NEW.id,
        'shiftNumber', NEW.shift_number,
        'expectedCashInMinorUnits', NEW.expected_cash_in_minor_units,
        'actualCashInMinorUnits', NEW.actual_cash_in_minor_units,
        'cashDiscrepancyInMinorUnits', NEW.cash_discrepancy_in_minor_units,
        'cashDiscrepancyThresholdInMinorUnits', v_discrepancy_threshold,
        'cashDiscrepancyThresholdExceeded',
          v_discrepancy_threshold IS NOT NULL
          AND ABS(COALESCE(NEW.cash_discrepancy_in_minor_units, 0))
            >= v_discrepancy_threshold,
        'closedAt', NEW.closed_at
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.scan_core_business_alerts(
  p_observed_at TIMESTAMPTZ DEFAULT NOW(),
  p_batch_size INTEGER DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_settings public.business_alert_settings%ROWTYPE;
  v_row RECORD;
  v_transition TEXT;
  v_opened INTEGER := 0;
  v_resolved INTEGER := 0;
  v_expected_close TIMESTAMP;
  v_local_now TIMESTAMP;
  v_active BOOLEAN;
BEGIN
  IF p_observed_at IS NULL OR p_batch_size IS NULL
    OR p_batch_size NOT BETWEEN 1 AND 200
  THEN
    RAISE EXCEPTION 'Invalid Business alert scan request.';
  END IF;
  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('statement_timeout', '25s', true);

  SELECT * INTO STRICT v_settings
  FROM public.business_alert_settings
  WHERE id = true;

  -- The five-hour reservation is the trusted order deadline. Thresholds that
  -- would define "unprocessed" or "near" remain disabled until approved.
  IF v_settings.order_unprocessed_after_minutes IS NOT NULL THEN
    FOR v_row IN
      SELECT o.id, o.order_number, o.created_at, o.reservation_expires_at
      FROM public.orders o
      WHERE o.source = 'website' AND o.status = 'new'
        AND o.reservation_expires_at IS NOT NULL
        AND o.created_at <= p_observed_at
          - make_interval(mins => v_settings.order_unprocessed_after_minutes)
      ORDER BY o.created_at, o.id
      LIMIT p_batch_size
    LOOP
      v_transition := public._transition_business_alert_incident(
        'order_unprocessed:' || v_row.id::TEXT,
        'order_unprocessed', v_row.id, true, p_observed_at,
        jsonb_build_object(
          'orderNumber', v_row.order_number,
          'createdAt', v_row.created_at,
          'expiresAt', v_row.reservation_expires_at
        )
      );
      v_opened := v_opened + (v_transition = 'opened')::INTEGER;
    END LOOP;
  END IF;

  IF v_settings.order_near_expiry_minutes IS NOT NULL THEN
    FOR v_row IN
      SELECT o.id, o.order_number, o.reservation_expires_at
      FROM public.orders o
      WHERE o.source = 'website' AND o.status = 'new'
        AND o.reservation_expires_at > p_observed_at
        AND o.reservation_expires_at <= p_observed_at
          + make_interval(mins => v_settings.order_near_expiry_minutes)
      ORDER BY o.reservation_expires_at, o.id
      LIMIT p_batch_size
    LOOP
      v_transition := public._transition_business_alert_incident(
        'order_near_expiry:' || v_row.id::TEXT,
        'order_near_expiry', v_row.id, true, p_observed_at,
        jsonb_build_object(
          'orderNumber', v_row.order_number,
          'expiresAt', v_row.reservation_expires_at
        )
      );
      v_opened := v_opened + (v_transition = 'opened')::INTEGER;
    END LOOP;
  END IF;

  IF v_settings.purchase_order_overdue_enabled THEN
    FOR v_row IN
      SELECT po.id, po.purchase_order_number, po.status,
             po.expected_delivery_date, s.company_name AS supplier_name
      FROM public.purchase_orders po
      JOIN public.suppliers s ON s.id = po.supplier_id
      WHERE po.status IN ('sent', 'approved', 'partially_received')
        AND po.expected_delivery_date IS NOT NULL
        AND po.expected_delivery_date < p_observed_at
      ORDER BY po.expected_delivery_date, po.id
      LIMIT p_batch_size
    LOOP
      v_transition := public._transition_business_alert_incident(
        'purchase_order_overdue:' || v_row.id::TEXT,
        'purchase_order_overdue', v_row.id, true, p_observed_at,
        jsonb_build_object(
          'purchaseOrderNumber', v_row.purchase_order_number,
          'supplierName', v_row.supplier_name,
          'expectedDeliveryAt', v_row.expected_delivery_date,
          'status', v_row.status
        )
      );
      v_opened := v_opened + (v_transition = 'opened')::INTEGER;
    END LOOP;
  END IF;

  -- Shift timings are evaluated only after a closing time is approved.
  IF v_settings.shift_expected_close_local_time IS NOT NULL THEN
    v_local_now := p_observed_at AT TIME ZONE v_settings.business_timezone;
    FOR v_row IN
      SELECT cs.id, cs.shift_number, cs.opened_at
      FROM public.cash_shifts cs
      WHERE cs.status = 'open'
      ORDER BY cs.opened_at, cs.id
      LIMIT p_batch_size
    LOOP
      v_expected_close :=
        (v_row.opened_at AT TIME ZONE v_settings.business_timezone)::DATE
        + v_settings.shift_expected_close_local_time;
      IF (v_row.opened_at AT TIME ZONE v_settings.business_timezone)::TIME
        >= v_settings.shift_expected_close_local_time
      THEN
        v_expected_close := v_expected_close + INTERVAL '1 day';
      END IF;

      v_transition := public._transition_business_alert_incident(
        'shift_close_overdue:' || v_row.id::TEXT,
        'shift_close_overdue', v_row.id,
        v_local_now >= v_expected_close, p_observed_at,
        jsonb_build_object(
          'shiftNumber', v_row.shift_number,
          'openedAt', v_row.opened_at,
          'expectedCloseAt', v_expected_close,
          'timezone', v_settings.business_timezone
        )
      );
      v_opened := v_opened + (v_transition = 'opened')::INTEGER;
      v_resolved := v_resolved + (v_transition = 'resolved')::INTEGER;

      IF v_settings.shift_near_close_minutes IS NOT NULL THEN
        v_active := v_local_now < v_expected_close
          AND v_local_now >= v_expected_close
            - make_interval(mins => v_settings.shift_near_close_minutes);
        v_transition := public._transition_business_alert_incident(
          'shift_close_reminder:' || v_row.id::TEXT,
          'shift_close_reminder', v_row.id, v_active, p_observed_at,
          jsonb_build_object(
            'shiftNumber', v_row.shift_number,
            'openedAt', v_row.opened_at,
            'expectedCloseAt', v_expected_close,
            'timezone', v_settings.business_timezone
          )
        );
        v_opened := v_opened + (v_transition = 'opened')::INTEGER;
        v_resolved := v_resolved + (v_transition = 'resolved')::INTEGER;
      END IF;
    END LOOP;
  END IF;

  -- Daily expense monitoring is intentionally off until the owner approves a
  -- threshold. When enabled, one incident is emitted per branch/business day.
  IF v_settings.daily_expense_threshold_in_minor_units IS NOT NULL THEN
    FOR v_row IN
      SELECT oe.branch_id AS id, b.name_ar AS branch_name,
             (p_observed_at AT TIME ZONE v_settings.business_timezone)::DATE AS business_date,
             SUM(oe.amount_in_minor_units)::BIGINT AS daily_total
      FROM public.operational_expenses oe
      JOIN public.branches b ON b.id = oe.branch_id
      WHERE COALESCE(oe.is_reversed, false) = false
        AND oe.created_at >= date_trunc(
          'day', p_observed_at AT TIME ZONE v_settings.business_timezone
        ) AT TIME ZONE v_settings.business_timezone
        AND oe.created_at < (
          date_trunc('day', p_observed_at AT TIME ZONE v_settings.business_timezone)
          + INTERVAL '1 day'
        ) AT TIME ZONE v_settings.business_timezone
      GROUP BY oe.branch_id, b.name_ar
      HAVING SUM(oe.amount_in_minor_units)
        >= v_settings.daily_expense_threshold_in_minor_units
      ORDER BY oe.branch_id
      LIMIT p_batch_size
    LOOP
      v_transition := public._transition_business_alert_incident(
        'expense_daily_threshold:' || v_row.id::TEXT || ':' || v_row.business_date::TEXT,
        'expense_daily_threshold', v_row.id, true, p_observed_at,
        jsonb_build_object(
          'branchName', v_row.branch_name,
          'businessDate', v_row.business_date,
          'dailyTotalInMinorUnits', v_row.daily_total,
          'thresholdInMinorUnits', v_settings.daily_expense_threshold_in_minor_units
        )
      );
      v_opened := v_opened + (v_transition = 'opened')::INTEGER;
    END LOOP;
  END IF;

  -- Resolve only incidents previously opened by this scanner. The database
  -- condition is re-read; no notification is based on cached payload data.
  FOR v_row IN
    SELECT bi.*
    FROM public.business_alert_incidents bi
    WHERE bi.state = 'open'
    ORDER BY bi.last_seen_at, bi.incident_key
    LIMIT p_batch_size
  LOOP
    v_active := CASE v_row.alert_type
      WHEN 'order_unprocessed' THEN
        v_settings.order_unprocessed_after_minutes IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.orders o
          WHERE o.id = v_row.entity_id AND o.source = 'website' AND o.status = 'new'
            AND o.reservation_expires_at IS NOT NULL
            AND o.created_at <= p_observed_at - make_interval(mins => v_settings.order_unprocessed_after_minutes)
        )
      WHEN 'order_near_expiry' THEN
        v_settings.order_near_expiry_minutes IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.orders o
          WHERE o.id = v_row.entity_id AND o.source = 'website' AND o.status = 'new'
            AND o.reservation_expires_at > p_observed_at
            AND o.reservation_expires_at <= p_observed_at + make_interval(mins => v_settings.order_near_expiry_minutes)
        )
      WHEN 'purchase_order_overdue' THEN
        v_settings.purchase_order_overdue_enabled AND EXISTS (
          SELECT 1 FROM public.purchase_orders po
          WHERE po.id = v_row.entity_id
            AND po.status IN ('sent', 'approved', 'partially_received')
            AND po.expected_delivery_date IS NOT NULL
            AND po.expected_delivery_date < p_observed_at
        )
      WHEN 'shift_close_reminder' THEN EXISTS (
        SELECT 1 FROM public.cash_shifts cs WHERE cs.id = v_row.entity_id AND cs.status = 'open'
      ) AND v_settings.shift_expected_close_local_time IS NOT NULL
        AND v_settings.shift_near_close_minutes IS NOT NULL
      WHEN 'shift_close_overdue' THEN EXISTS (
        SELECT 1 FROM public.cash_shifts cs WHERE cs.id = v_row.entity_id AND cs.status = 'open'
      ) AND v_settings.shift_expected_close_local_time IS NOT NULL
      WHEN 'expense_daily_threshold' THEN
        v_settings.daily_expense_threshold_in_minor_units IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.operational_expenses oe
          WHERE oe.branch_id = v_row.entity_id
            AND COALESCE(oe.is_reversed, false) = false
            AND oe.created_at >= date_trunc('day', p_observed_at AT TIME ZONE v_settings.business_timezone)
              AT TIME ZONE v_settings.business_timezone
            AND oe.created_at < (date_trunc('day', p_observed_at AT TIME ZONE v_settings.business_timezone) + INTERVAL '1 day')
              AT TIME ZONE v_settings.business_timezone
          GROUP BY oe.branch_id
          HAVING SUM(oe.amount_in_minor_units) >= v_settings.daily_expense_threshold_in_minor_units
        )
      ELSE false
    END;

    IF NOT v_active THEN
      v_transition := public._transition_business_alert_incident(
        v_row.incident_key, v_row.alert_type, v_row.entity_id,
        false, p_observed_at,
        jsonb_build_object('reference', v_row.incident_key)
      );
      v_resolved := v_resolved + (v_transition = 'resolved')::INTEGER;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'opened', v_opened,
    'resolved', v_resolved,
    'disabledThresholds', to_jsonb(array_remove(ARRAY[
      CASE WHEN v_settings.order_unprocessed_after_minutes IS NULL THEN 'order_unprocessed_after_minutes' END,
      CASE WHEN v_settings.order_near_expiry_minutes IS NULL THEN 'order_near_expiry_minutes' END,
      CASE WHEN v_settings.shift_expected_close_local_time IS NULL THEN 'shift_expected_close_local_time' END,
      CASE WHEN v_settings.cash_discrepancy_threshold_in_minor_units IS NULL THEN 'cash_discrepancy_threshold_in_minor_units' END,
      CASE WHEN v_settings.daily_expense_threshold_in_minor_units IS NULL THEN 'daily_expense_threshold_in_minor_units' END
    ]::TEXT[], NULL))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_automation_event(TEXT, TEXT, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._transition_business_alert_incident(TEXT, TEXT, UUID, BOOLEAN, TIMESTAMPTZ, JSONB, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_expired_order_business_alert()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scan_core_business_alerts(TIMESTAMPTZ, INTEGER)
  FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'scan-core-business-alerts';
SELECT cron.schedule(
  'scan-core-business-alerts',
  '*/5 * * * *',
  $$SELECT public.scan_core_business_alerts(NOW(), 100);$$
);

COMMENT ON TABLE public.business_alert_settings IS
  'Central service-role-only thresholds for owner Business alerts; NULL threshold means disabled.';
COMMENT ON TABLE public.business_alert_incidents IS
  'State machine for deduplicated Business alert open/recovery transitions.';
COMMENT ON FUNCTION public.scan_core_business_alerts(TIMESTAMPTZ, INTEGER) IS
  'Private bounded five-minute scanner that writes only to the existing Business outbox.';

COMMIT;
