\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE core_business_alert_results (
  scenario TEXT PRIMARY KEY,
  passed BOOLEAN NOT NULL
) ON COMMIT PRESERVE ROWS;

DO $$
DECLARE
  v_now TIMESTAMPTZ := '2026-01-01 08:45:00+00'; -- 11:45 Asia/Amman
  v_branch UUID := '97000000-0000-0000-0000-000000000010';
  v_owner UUID := '97000000-0000-0000-0000-000000000011';
  v_supplier UUID := '97000000-0000-0000-0000-000000000020';
  v_overdue_po UUID := '97000000-0000-0000-0000-000000000021';
  v_future_po UUID := '97000000-0000-0000-0000-000000000022';
  v_expired_order UUID := '97000000-0000-0000-0000-000000000030';
  v_attention_order UUID := '97000000-0000-0000-0000-000000000031';
  v_shift UUID := '97000000-0000-0000-0000-000000000040';
  v_expense UUID := '97000000-0000-0000-0000-000000000050';
  v_result JSONB;
BEGIN
  INSERT INTO auth.users(
    id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    v_owner, 'authenticated', 'authenticated', 'phase3-owner@example.test', NOW(),
    '{}'::JSONB, '{}'::JSONB, NOW(), NOW()
  ) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.profiles(id, full_name, is_active)
  VALUES (v_owner, 'مالك اختبار تنبيهات الأعمال', true)
  ON CONFLICT (id) DO UPDATE SET is_active = true;
  INSERT INTO public.branches(id, code, name_ar, is_active)
  VALUES (v_branch, 'PHASE3-ALERTS', 'فرع اختبار تنبيهات الأعمال', true);
  INSERT INTO public.suppliers(id, company_name, is_active)
  VALUES (v_supplier, 'مورد اختبار التنبيهات', true);

  IF NOT EXISTS (
    SELECT 1 FROM public.business_alert_settings
    WHERE id = true
      AND order_expired_enabled
      AND purchase_order_overdue_enabled
      AND order_unprocessed_after_minutes IS NULL
      AND order_near_expiry_minutes IS NULL
      AND shift_expected_close_local_time IS NULL
      AND cash_discrepancy_threshold_in_minor_units IS NULL
      AND daily_expense_threshold_in_minor_units IS NULL
  ) THEN
    RAISE EXCEPTION 'Unapproved thresholds were not fail-closed.';
  END IF;
  INSERT INTO core_business_alert_results VALUES ('unapproved_thresholds_disabled_by_default', true);

  INSERT INTO public.purchase_orders(
    id, purchase_order_number, supplier_id, branch_id, status,
    expected_delivery_date
  ) VALUES
    (v_overdue_po, 'PHASE3-PO-OVERDUE', v_supplier, v_branch, 'sent', v_now - INTERVAL '1 day'),
    (v_future_po, 'PHASE3-PO-FUTURE', v_supplier, v_branch, 'sent', v_now + INTERVAL '1 day');

  v_result := public.scan_core_business_alerts(v_now, 100);
  IF (v_result->>'opened')::INTEGER <> 1
    OR (SELECT count(*) FROM public.automation_events WHERE event_type = 'purchase_order_overdue') <> 1
    OR EXISTS (SELECT 1 FROM public.automation_events WHERE entity_id = v_future_po)
  THEN RAISE EXCEPTION 'Purchase-order due-date alert did not use the trusted expected date.'; END IF;
  INSERT INTO core_business_alert_results VALUES ('overdue_purchase_order_alerts_once', true);

  v_result := public.scan_core_business_alerts(v_now + INTERVAL '1 minute', 100);
  IF (v_result->>'opened')::INTEGER <> 0
    OR (SELECT count(*) FROM public.automation_events WHERE event_type = 'purchase_order_overdue') <> 1
  THEN RAISE EXCEPTION 'Repeated overdue scan created a duplicate.'; END IF;
  INSERT INTO core_business_alert_results VALUES ('repeated_scan_has_no_duplicate', true);

  UPDATE public.purchase_orders SET status = 'received' WHERE id = v_overdue_po;
  v_result := public.scan_core_business_alerts(v_now + INTERVAL '2 minutes', 100);
  IF (v_result->>'resolved')::INTEGER <> 1
    OR (SELECT count(*) FROM public.automation_events WHERE event_type = 'business_alert_recovery') <> 1
  THEN RAISE EXCEPTION 'Meaningful purchase-order recovery was not emitted once.'; END IF;
  v_result := public.scan_core_business_alerts(v_now + INTERVAL '3 minutes', 100);
  IF (SELECT count(*) FROM public.automation_events WHERE event_type = 'business_alert_recovery') <> 1
  THEN RAISE EXCEPTION 'Purchase-order recovery duplicated.'; END IF;
  INSERT INTO core_business_alert_results VALUES ('purchase_order_resolution_once', true);

  UPDATE public.purchase_orders
  SET status = 'sent', expected_delivery_date = v_now - INTERVAL '2 days'
  WHERE id = v_overdue_po;
  v_result := public.scan_core_business_alerts(v_now + INTERVAL '4 minutes', 100);
  IF (v_result->>'opened')::INTEGER <> 1
    OR (SELECT occurrence FROM public.business_alert_incidents WHERE entity_id = v_overdue_po) <> 2
  THEN RAISE EXCEPTION 'A genuine recurrence did not create a new occurrence.'; END IF;
  INSERT INTO core_business_alert_results VALUES ('resolved_incident_can_reopen_as_new_occurrence', true);

  INSERT INTO public.orders(
    id, order_number, status, source, subtotal_in_minor_units,
    total_in_minor_units, reservation_expires_at
  ) VALUES (
    v_expired_order, 'PHASE3-ORDER-EXPIRED', 'new', 'website', 0, 0,
    v_now - INTERVAL '1 minute'
  );
  UPDATE public.orders
  SET status = 'expired', expired_at = v_now,
      expired_reason = 'انتهت مهلة الاختبار', reservation_released_at = v_now
  WHERE id = v_expired_order;
  UPDATE public.orders SET updated_at = v_now + INTERVAL '1 second'
  WHERE id = v_expired_order;
  IF (SELECT count(*) FROM public.automation_events WHERE event_type = 'order_expired' AND entity_id = v_expired_order) <> 1
  THEN RAISE EXCEPTION 'Expired order transition was not exactly once.'; END IF;
  INSERT INTO core_business_alert_results VALUES ('expired_order_transition_alerts_exactly_once', true);

  INSERT INTO public.orders(
    id, order_number, status, source, subtotal_in_minor_units,
    total_in_minor_units, created_at, updated_at, reservation_expires_at
  ) VALUES (
    v_attention_order, 'PHASE3-ORDER-ATTENTION', 'new', 'website', 0, 0,
    v_now - INTERVAL '4 hours', v_now - INTERVAL '4 hours', v_now + INTERVAL '15 minutes'
  );
  v_result := public.scan_core_business_alerts(v_now, 100);
  IF EXISTS (
    SELECT 1 FROM public.automation_events
    WHERE entity_id = v_attention_order
      AND event_type IN ('order_unprocessed', 'order_near_expiry')
  ) THEN RAISE EXCEPTION 'Disabled order thresholds emitted an alert.'; END IF;
  INSERT INTO core_business_alert_results VALUES ('disabled_order_thresholds_emit_nothing', true);

  UPDATE public.business_alert_settings
  SET order_unprocessed_after_minutes = 180,
      order_near_expiry_minutes = 30
  WHERE id = true;
  v_result := public.scan_core_business_alerts(v_now, 100);
  IF (SELECT count(*) FROM public.automation_events WHERE entity_id = v_attention_order AND event_type = 'order_unprocessed') <> 1
    OR (SELECT count(*) FROM public.automation_events WHERE entity_id = v_attention_order AND event_type = 'order_near_expiry') <> 1
  THEN RAISE EXCEPTION 'Approved order thresholds did not emit expected alerts.'; END IF;
  v_result := public.scan_core_business_alerts(v_now + INTERVAL '1 minute', 100);
  IF (SELECT count(*) FROM public.automation_events WHERE entity_id = v_attention_order AND event_type IN ('order_unprocessed','order_near_expiry')) <> 2
  THEN RAISE EXCEPTION 'Approved order threshold alerts duplicated.'; END IF;
  INSERT INTO core_business_alert_results VALUES ('configured_order_thresholds_dedupe', true);

  UPDATE public.orders SET status = 'confirmed' WHERE id = v_attention_order;
  v_result := public.scan_core_business_alerts(v_now + INTERVAL '2 minutes', 100);
  IF (v_result->>'resolved')::INTEGER < 2
    OR (SELECT count(*) FROM public.automation_events WHERE entity_id = v_attention_order AND event_type = 'business_alert_recovery') <> 2
  THEN RAISE EXCEPTION 'Order attention recoveries were not emitted exactly once.'; END IF;
  INSERT INTO core_business_alert_results VALUES ('order_attention_resolution_exactly_once', true);

  INSERT INTO public.cash_shifts(
    id, shift_number, branch_id, opened_by, opened_at,
    opening_cash_in_minor_units, status
  ) VALUES (
    v_shift, 'PHASE3-SHIFT-001', v_branch, v_owner,
    '2026-01-01 05:00:00+00', 0, 'open'
  );
  UPDATE public.business_alert_settings
  SET shift_expected_close_local_time = '12:00', shift_near_close_minutes = 30
  WHERE id = true;
  v_result := public.scan_core_business_alerts(v_now, 100);
  IF (SELECT count(*) FROM public.automation_events WHERE entity_id = v_shift AND event_type = 'shift_close_reminder') <> 1
    OR EXISTS (SELECT 1 FROM public.automation_events WHERE entity_id = v_shift AND event_type = 'shift_close_overdue')
  THEN RAISE EXCEPTION 'Shift near-close reminder was incorrect.'; END IF;
  v_result := public.scan_core_business_alerts(v_now + INTERVAL '30 minutes', 100);
  IF (SELECT count(*) FROM public.automation_events WHERE entity_id = v_shift AND event_type = 'shift_close_overdue') <> 1
  THEN RAISE EXCEPTION 'Shift overdue alert was not emitted.'; END IF;
  INSERT INTO core_business_alert_results VALUES ('configured_shift_reminder_and_overdue_transition', true);

  INSERT INTO public.operational_expenses(
    id, expense_number, branch_id, shift_id, category, description,
    amount_in_minor_units, payment_method, created_by, created_at
  ) VALUES (
    v_expense, 'PHASE3-EXPENSE-001', v_branch, v_shift, 'other',
    'مصروف اختبار threshold', 1500, 'cash', v_owner, v_now
  );
  UPDATE public.business_alert_settings
  SET daily_expense_threshold_in_minor_units = 1000
  WHERE id = true;
  v_result := public.scan_core_business_alerts(v_now + INTERVAL '3 minutes', 100);
  IF (SELECT count(*) FROM public.automation_events WHERE entity_id = v_branch AND event_type = 'expense_daily_threshold') <> 1
  THEN RAISE EXCEPTION 'Configured daily expense threshold did not emit once.'; END IF;
  v_result := public.scan_core_business_alerts(v_now + INTERVAL '4 minutes', 100);
  IF (SELECT count(*) FROM public.automation_events WHERE entity_id = v_branch AND event_type = 'expense_daily_threshold') <> 1
  THEN RAISE EXCEPTION 'Daily expense threshold duplicated.'; END IF;
  INSERT INTO core_business_alert_results VALUES ('configured_expense_threshold_dedupes', true);

  IF has_function_privilege('anon', 'public.scan_core_business_alerts(timestamptz,integer)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.scan_core_business_alerts(timestamptz,integer)', 'EXECUTE')
    OR has_function_privilege('anon', 'public._transition_business_alert_incident(text,text,uuid,boolean,timestamptz,jsonb,boolean)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public._transition_business_alert_incident(text,text,uuid,boolean,timestamptz,jsonb,boolean)', 'EXECUTE')
    OR has_table_privilege('anon', 'public.business_alert_settings', 'SELECT')
    OR has_table_privilege('authenticated', 'public.business_alert_incidents', 'SELECT')
  THEN RAISE EXCEPTION 'Business alert internal contracts were exposed.'; END IF;
  INSERT INTO core_business_alert_results VALUES ('internal_alert_contracts_are_private', true);

  IF (SELECT count(*) FROM cron.job WHERE jobname = 'scan-core-business-alerts' AND schedule = '*/5 * * * *') <> 1
  THEN RAISE EXCEPTION 'Business alert scanner cron is not unique or correctly scheduled.'; END IF;
  INSERT INTO core_business_alert_results VALUES ('bounded_five_minute_cron_registered_once', true);
END $$;

SELECT jsonb_build_object(
  'ok', bool_and(passed),
  'runtime_scenarios', count(*),
  'scenarios', jsonb_agg(scenario ORDER BY scenario)
) AS core_business_alerts_runtime_summary
FROM core_business_alert_results;

ROLLBACK;
