-- Keep incident recovery ownership scoped to the scanner that created it.
-- The Phase 3 scanner previously treated every later alert type as inactive
-- through its ELSE branch, including Phase 5 Business-integrity incidents.

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

  -- Resolve only incidents owned by this scanner. Later scanners can add
  -- incident types without being silently resolved by this Phase 3 loop.
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

-- CREATE OR REPLACE preserves the private grants established by Migration 097.
COMMENT ON FUNCTION public.scan_core_business_alerts(TIMESTAMPTZ, INTEGER) IS
  'Scans and resolves only the core Business-alert incident types owned by this function.';
