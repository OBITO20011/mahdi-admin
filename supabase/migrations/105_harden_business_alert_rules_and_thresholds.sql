BEGIN;

-- Adopt the approved operating rules while preserving the existing outbox,
-- incident state machine, delivery channel, and five-minute scanner.
UPDATE public.business_alert_settings
SET business_timezone = 'Asia/Amman',
    order_unprocessed_after_minutes = 120,
    shift_expected_close_local_time = NULL,
    shift_near_close_minutes = NULL,
    cash_discrepancy_threshold_in_minor_units = NULL,
    daily_expense_threshold_in_minor_units = NULL,
    updated_at = NOW()
WHERE id = true;

ALTER TABLE public.business_alert_settings
  ALTER COLUMN business_timezone SET DEFAULT 'Asia/Amman',
  ALTER COLUMN order_unprocessed_after_minutes SET DEFAULT 120,
  ALTER COLUMN order_unprocessed_after_minutes SET NOT NULL;

ALTER TABLE public.business_alert_settings
  DROP CONSTRAINT IF EXISTS business_alert_settings_business_timezone_check,
  DROP CONSTRAINT IF EXISTS business_alert_settings_order_unprocessed_after_minutes_check,
  DROP CONSTRAINT IF EXISTS business_alert_settings_shift_expected_close_disabled_check,
  DROP CONSTRAINT IF EXISTS business_alert_settings_shift_near_close_disabled_check,
  DROP CONSTRAINT IF EXISTS business_alert_settings_cash_threshold_disabled_check,
  DROP CONSTRAINT IF EXISTS business_alert_settings_expense_threshold_disabled_check;

ALTER TABLE public.business_alert_settings
  ADD CONSTRAINT business_alert_settings_business_timezone_check
    CHECK (business_timezone = 'Asia/Amman'),
  ADD CONSTRAINT business_alert_settings_order_unprocessed_after_minutes_check
    CHECK (order_unprocessed_after_minutes = 120),
  ADD CONSTRAINT business_alert_settings_shift_expected_close_disabled_check
    CHECK (shift_expected_close_local_time IS NULL),
  ADD CONSTRAINT business_alert_settings_shift_near_close_disabled_check
    CHECK (shift_near_close_minutes IS NULL),
  ADD CONSTRAINT business_alert_settings_cash_threshold_disabled_check
    CHECK (cash_discrepancy_threshold_in_minor_units IS NULL),
  ADD CONSTRAINT business_alert_settings_expense_threshold_disabled_check
    CHECK (daily_expense_threshold_in_minor_units IS NULL);

-- Keep the existing one-event-per-shift contract. A non-zero difference is
-- now detected without a monetary threshold and carries an explicit direction.
CREATE OR REPLACE FUNCTION public.enqueue_closed_shift_automation_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_difference BIGINT := COALESCE(NEW.cash_discrepancy_in_minor_units, 0);
BEGIN
  IF OLD.status = 'open' AND NEW.status = 'closed' THEN
    PERFORM public.enqueue_automation_event(
      'shift_closed:' || NEW.id::TEXT,
      'shift_closed',
      NEW.id,
      jsonb_build_object(
        'shiftId', NEW.id,
        'shiftNumber', NEW.shift_number,
        'expectedCashInMinorUnits', NEW.expected_cash_in_minor_units,
        'actualCashInMinorUnits', NEW.actual_cash_in_minor_units,
        'cashDiscrepancyInMinorUnits', v_difference,
        'cashDiscrepancyAbsoluteInMinorUnits', ABS(v_difference),
        'cashDiscrepancyDetected', v_difference <> 0,
        'cashDiscrepancyDirection', CASE
          WHEN v_difference > 0 THEN 'surplus'
          WHEN v_difference < 0 THEN 'shortage'
          ELSE 'balanced'
        END,
        -- Preserve the legacy payload field for deployed consumers while
        -- changing its meaning to the approved any-non-zero rule.
        'cashDiscrepancyThresholdInMinorUnits', NULL,
        'cashDiscrepancyThresholdExceeded', v_difference <> 0,
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
  v_max_close_at TIMESTAMPTZ;
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

  -- Delayed order: two hours old and still in an actual open workflow state.
  FOR v_row IN
    SELECT o.id, o.order_number, o.status, o.created_at
    FROM public.orders o
    WHERE o.status IN ('new', 'confirmed', 'preparing', 'ready', 'out_for_delivery')
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
        'status', v_row.status,
        'thresholdMinutes', v_settings.order_unprocessed_after_minutes
      )
    );
    v_opened := v_opened + (v_transition = 'opened')::INTEGER;
  END LOOP;

  -- Preserve the separately approved website reservation-expiry warning.
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

  -- An open shift cannot exceed either 15 elapsed hours or its opening local
  -- calendar day. The earlier absolute instant is authoritative.
  FOR v_row IN
    SELECT cs.id, cs.shift_number, cs.opened_at
    FROM public.cash_shifts cs
    WHERE cs.status = 'open'
    ORDER BY cs.opened_at, cs.id
    LIMIT p_batch_size
  LOOP
    v_max_close_at := LEAST(
      v_row.opened_at + INTERVAL '15 hours',
      (
        (v_row.opened_at AT TIME ZONE v_settings.business_timezone)::DATE + 1
      )::TIMESTAMP AT TIME ZONE v_settings.business_timezone
    );
    v_transition := public._transition_business_alert_incident(
      'shift_close_overdue:' || v_row.id::TEXT,
      'shift_close_overdue', v_row.id,
      p_observed_at >= v_max_close_at, p_observed_at,
      jsonb_build_object(
        'shiftNumber', v_row.shift_number,
        'openedAt', v_row.opened_at,
        'expectedCloseAt', v_max_close_at,
        'maxDurationHours', 15,
        'timezone', v_settings.business_timezone
      )
    );
    v_opened := v_opened + (v_transition = 'opened')::INTEGER;
    v_resolved := v_resolved + (v_transition = 'resolved')::INTEGER;
  END LOOP;

  -- Resolve only incident types owned by this scanner. Legacy shift-reminder
  -- and expense-threshold incidents are closed because those rules are off.
  FOR v_row IN
    SELECT bi.*
    FROM public.business_alert_incidents bi
    WHERE bi.state = 'open'
      AND bi.alert_type IN (
        'order_unprocessed', 'order_near_expiry',
        'shift_close_reminder', 'shift_close_overdue',
        'purchase_order_overdue', 'expense_daily_threshold'
      )
    ORDER BY bi.last_seen_at, bi.incident_key
    LIMIT p_batch_size
  LOOP
    v_active := CASE v_row.alert_type
      WHEN 'order_unprocessed' THEN EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = v_row.entity_id
          AND o.status IN ('new', 'confirmed', 'preparing', 'ready', 'out_for_delivery')
          AND o.created_at <= p_observed_at
            - make_interval(mins => v_settings.order_unprocessed_after_minutes)
      )
      WHEN 'order_near_expiry' THEN
        v_settings.order_near_expiry_minutes IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.orders o
          WHERE o.id = v_row.entity_id AND o.source = 'website' AND o.status = 'new'
            AND o.reservation_expires_at > p_observed_at
            AND o.reservation_expires_at <= p_observed_at
              + make_interval(mins => v_settings.order_near_expiry_minutes)
        )
      WHEN 'purchase_order_overdue' THEN
        v_settings.purchase_order_overdue_enabled AND EXISTS (
          SELECT 1 FROM public.purchase_orders po
          WHERE po.id = v_row.entity_id
            AND po.status IN ('sent', 'approved', 'partially_received')
            AND po.expected_delivery_date IS NOT NULL
            AND po.expected_delivery_date < p_observed_at
        )
      WHEN 'shift_close_overdue' THEN EXISTS (
        SELECT 1
        FROM public.cash_shifts cs
        WHERE cs.id = v_row.entity_id
          AND cs.status = 'open'
          AND p_observed_at >= LEAST(
            cs.opened_at + INTERVAL '15 hours',
            (
              (cs.opened_at AT TIME ZONE v_settings.business_timezone)::DATE + 1
            )::TIMESTAMP AT TIME ZONE v_settings.business_timezone
          )
      )
      WHEN 'shift_close_reminder' THEN false
      WHEN 'expense_daily_threshold' THEN false
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
    'rules', jsonb_build_object(
      'delayedOrderMinutes', v_settings.order_unprocessed_after_minutes,
      'cashDifference', 'non_zero',
      'dailyExpenseWindow', 'calendar_day',
      'shiftMaxDurationHours', 15,
      'timezone', v_settings.business_timezone
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_closed_shift_automation_event()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scan_core_business_alerts(TIMESTAMPTZ, INTEGER)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.scan_core_business_alerts(TIMESTAMPTZ, INTEGER) IS
  'Private bounded scanner: delayed orders after 120 minutes and open shifts after min(opened_at + 15 hours, next Asia/Amman midnight); no automatic status mutation.';
COMMENT ON FUNCTION public.enqueue_closed_shift_automation_event() IS
  'Queues one deduplicated shift summary; every non-zero cash difference is flagged with surplus or shortage direction.';
COMMENT ON FUNCTION public.build_business_summary(TEXT, DATE, DATE, TIMESTAMPTZ) IS
  'Builds daily or weekly reporting over Asia/Amman calendar-day boundaries; daily expenses have no alert threshold.';

COMMIT;
