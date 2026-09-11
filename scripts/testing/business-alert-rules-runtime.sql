\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE rule_results(scenario TEXT PRIMARY KEY, passed BOOLEAN NOT NULL) ON COMMIT PRESERVE ROWS;

DO $$
DECLARE
  v_now TIMESTAMPTZ := '2026-01-05 23:00:00+03';
  v_branch UUID := '97000000-0000-0000-0000-000000000010';
  v_owner UUID := '97000000-0000-0000-0000-000000000011';
  v_supplier UUID := '97000000-0000-0000-0000-000000000020';
  v_po UUID := '97000000-0000-0000-0000-000000000021';
  v_delayed UUID := '97000000-0000-0000-0000-000000000030';
  v_completed UUID := '97000000-0000-0000-0000-000000000031';
  v_cancelled UUID := '97000000-0000-0000-0000-000000000032';
  v_shift_15h UUID := '97000000-0000-0000-0000-000000000040';
  v_shift_midnight UUID := '97000000-0000-0000-0000-000000000041';
  v_shift_shortage UUID := '97000000-0000-0000-0000-000000000042';
BEGIN
  INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  VALUES(v_owner,'authenticated','authenticated','rules-owner@example.test',NOW(),'{}','{}',NOW(),NOW())
  ON CONFLICT(id) DO NOTHING;
  INSERT INTO public.profiles(id,full_name,is_active) VALUES(v_owner,'مالك اختبار القواعد',true)
  ON CONFLICT(id) DO UPDATE SET is_active=true;
  INSERT INTO public.branches(id,code,name_ar,is_active) VALUES(v_branch,'ALERT-RULES','فرع اختبار القواعد',true);
  INSERT INTO public.suppliers(id,company_name,is_active) VALUES(v_supplier,'مورد اختبار القواعد',true);

  IF NOT EXISTS(SELECT 1 FROM public.business_alert_settings WHERE id
    AND business_timezone='Asia/Amman' AND order_unprocessed_after_minutes=120
    AND shift_expected_close_local_time IS NULL AND shift_near_close_minutes IS NULL
    AND cash_discrepancy_threshold_in_minor_units IS NULL
    AND daily_expense_threshold_in_minor_units IS NULL)
  THEN RAISE EXCEPTION 'Approved rules are not fixed.'; END IF;
  INSERT INTO rule_results VALUES('approved_rules_are_fixed',true);

  INSERT INTO public.purchase_orders(id,purchase_order_number,supplier_id,branch_id,status,expected_delivery_date)
  VALUES(v_po,'RULES-PO',v_supplier,v_branch,'sent',v_now-INTERVAL '1 day');
  PERFORM public.scan_core_business_alerts(v_now,100);
  PERFORM public.scan_core_business_alerts(v_now+INTERVAL '1 minute',100);
  IF (SELECT count(*) FROM public.automation_events WHERE entity_id=v_po AND event_type='purchase_order_overdue')<>1
  THEN RAISE EXCEPTION 'Purchase alert did not dedupe.'; END IF;
  UPDATE public.purchase_orders SET status='received' WHERE id=v_po;
  PERFORM public.scan_core_business_alerts(v_now+INTERVAL '2 minutes',100);
  IF (SELECT count(*) FROM public.automation_events WHERE entity_id=v_po AND event_type='business_alert_recovery')<>1
  THEN RAISE EXCEPTION 'Purchase recovery regressed.'; END IF;
  INSERT INTO rule_results VALUES('purchase_alert_dedup_and_recovery_preserved',true);

  INSERT INTO public.orders(id,order_number,status,source,subtotal_in_minor_units,total_in_minor_units,created_at,updated_at)
  VALUES
    (v_delayed,'RULES-DELAYED','confirmed','website',0,0,v_now-INTERVAL '1 hour 59 minutes',v_now),
    (v_completed,'RULES-COMPLETED','completed','website',0,0,v_now-INTERVAL '4 hours',v_now),
    (v_cancelled,'RULES-CANCELLED','cancelled','website',0,0,v_now-INTERVAL '4 hours',v_now);
  PERFORM public.scan_core_business_alerts(v_now,100);
  IF EXISTS(SELECT 1 FROM public.automation_events WHERE entity_id IN(v_delayed,v_completed,v_cancelled) AND event_type='order_unprocessed')
  THEN RAISE EXCEPTION '1h59m or terminal order alerted.'; END IF;
  INSERT INTO rule_results VALUES('delayed_1h59_and_terminal_orders_do_not_alert',true);

  PERFORM public.scan_core_business_alerts(v_now+INTERVAL '1 minute',100);
  IF (SELECT count(*) FROM public.automation_events WHERE entity_id=v_delayed AND event_type='order_unprocessed')<>1
    OR EXISTS(SELECT 1 FROM public.automation_events WHERE entity_id IN(v_completed,v_cancelled) AND event_type='order_unprocessed')
  THEN RAISE EXCEPTION 'Two-hour delayed boundary failed.'; END IF;
  INSERT INTO rule_results VALUES('delayed_order_at_two_hours_alerts',true);
  PERFORM public.scan_core_business_alerts(v_now+INTERVAL '2 minutes',100);
  IF (SELECT count(*) FROM public.automation_events WHERE entity_id=v_delayed AND event_type='order_unprocessed')<>1
  THEN RAISE EXCEPTION 'Delayed alert duplicated.'; END IF;
  INSERT INTO rule_results VALUES('delayed_order_dedupes',true);
  UPDATE public.orders SET status='cancelled' WHERE id=v_delayed;
  PERFORM public.scan_core_business_alerts(v_now+INTERVAL '3 minutes',100);
  PERFORM public.scan_core_business_alerts(v_now+INTERVAL '4 minutes',100);
  IF (SELECT count(*) FROM public.automation_events WHERE entity_id=v_delayed AND event_type='business_alert_recovery')<>1
  THEN RAISE EXCEPTION 'Delayed recovery failed.'; END IF;
  INSERT INTO rule_results VALUES('delayed_terminal_transition_recovers_once',true);

  INSERT INTO public.cash_shifts(id,shift_number,branch_id,opened_by,opened_at,opening_cash_in_minor_units,status)
  VALUES(v_shift_15h,'RULES-15H',v_branch,v_owner,'2026-01-05 08:00:00+03',0,'open');
  PERFORM public.scan_core_business_alerts('2026-01-05 22:59:00+03',100);
  IF EXISTS(SELECT 1 FROM public.automation_events WHERE entity_id=v_shift_15h AND event_type='shift_close_overdue')
  THEN RAISE EXCEPTION 'Shift alerted before 15 hours.'; END IF;
  INSERT INTO rule_results VALUES('shift_before_limit_has_no_alert',true);
  PERFORM public.scan_core_business_alerts('2026-01-05 23:00:00+03',100);
  PERFORM public.scan_core_business_alerts('2026-01-05 23:01:00+03',100);
  IF (SELECT count(*) FROM public.automation_events WHERE entity_id=v_shift_15h AND event_type='shift_close_overdue')<>1
    OR (SELECT status FROM public.cash_shifts WHERE id=v_shift_15h)<>'open'
  THEN RAISE EXCEPTION '15-hour alert/dedup/non-mutation failed.'; END IF;
  INSERT INTO rule_results VALUES('shift_at_15h_alerts_once_without_auto_close',true);

  UPDATE public.cash_shifts SET status='closed',closed_by=v_owner,closed_at='2026-01-05 23:02:00+03',
    actual_cash_in_minor_units=0,cash_discrepancy_in_minor_units=0,updated_at='2026-01-05 23:02:00+03'
  WHERE id=v_shift_15h;
  PERFORM public.scan_core_business_alerts('2026-01-05 23:03:00+03',100);
  IF (SELECT count(*) FROM public.automation_events WHERE entity_id=v_shift_15h AND event_type='business_alert_recovery')<>1
    OR NOT EXISTS(SELECT 1 FROM public.automation_events WHERE entity_id=v_shift_15h AND event_type='shift_closed'
      AND payload->>'cashDiscrepancyDetected'='false' AND payload->>'cashDiscrepancyDirection'='balanced')
  THEN RAISE EXCEPTION 'Shift recovery or zero difference failed.'; END IF;
  INSERT INTO rule_results VALUES('shift_recovers_and_zero_difference_is_balanced',true);

  INSERT INTO public.cash_shifts(id,shift_number,branch_id,opened_by,opened_at,opening_cash_in_minor_units,status)
  VALUES(v_shift_midnight,'RULES-MIDNIGHT',v_branch,v_owner,'2026-01-05 17:00:00+03',0,'open');
  PERFORM public.scan_core_business_alerts('2026-01-05 23:59:00+03',100);
  IF EXISTS(SELECT 1 FROM public.automation_events WHERE entity_id=v_shift_midnight AND event_type='shift_close_overdue')
  THEN RAISE EXCEPTION 'Late shift alerted before midnight.'; END IF;
  PERFORM public.scan_core_business_alerts('2026-01-06 00:00:00+03',100);
  IF (SELECT count(*) FROM public.automation_events WHERE entity_id=v_shift_midnight AND event_type='shift_close_overdue')<>1
    OR (SELECT status FROM public.cash_shifts WHERE id=v_shift_midnight)<>'open'
  THEN RAISE EXCEPTION 'Midnight cutoff failed.'; END IF;
  INSERT INTO rule_results VALUES('late_shift_uses_same_day_midnight_cutoff',true);
  UPDATE public.cash_shifts SET status='closed',closed_by=v_owner,closed_at='2026-01-06 00:01:00+03',
    actual_cash_in_minor_units=1,cash_discrepancy_in_minor_units=1,updated_at='2026-01-06 00:01:00+03'
  WHERE id=v_shift_midnight;
  IF NOT EXISTS(SELECT 1 FROM public.automation_events WHERE entity_id=v_shift_midnight AND event_type='shift_closed'
    AND payload->>'cashDiscrepancyDetected'='true' AND payload->>'cashDiscrepancyDirection'='surplus'
    AND (payload->>'cashDiscrepancyAbsoluteInMinorUnits')::BIGINT=1)
  THEN RAISE EXCEPTION 'Positive cash difference failed.'; END IF;
  INSERT INTO rule_results VALUES('positive_cash_difference_is_surplus',true);

  INSERT INTO public.cash_shifts(id,shift_number,branch_id,opened_by,opened_at,opening_cash_in_minor_units,expected_cash_in_minor_units,status)
  VALUES(v_shift_shortage,'RULES-SHORTAGE',v_branch,v_owner,'2026-01-06 08:00:00+03',1000,1000,'open');
  INSERT INTO public.operational_expenses(expense_number,branch_id,shift_id,category,description,amount_in_minor_units,payment_method,created_by,created_at)
  VALUES('RULES-EXPENSE',v_branch,v_shift_shortage,'other','مصروف بلا حد',999999999,'cash',v_owner,'2026-01-06 12:00:00+03');
  PERFORM public.scan_core_business_alerts('2026-01-06 12:01:00+03',100);
  IF EXISTS(SELECT 1 FROM public.automation_events WHERE event_type='expense_daily_threshold')
  THEN RAISE EXCEPTION 'Expense threshold alert emitted.'; END IF;
  INSERT INTO rule_results VALUES('daily_expenses_have_no_threshold_alert',true);
  UPDATE public.cash_shifts SET status='closed',closed_by=v_owner,closed_at='2026-01-06 12:02:00+03',
    actual_cash_in_minor_units=999,cash_discrepancy_in_minor_units=-1,updated_at='2026-01-06 12:02:00+03'
  WHERE id=v_shift_shortage;
  UPDATE public.cash_shifts SET updated_at='2026-01-06 12:03:00+03' WHERE id=v_shift_shortage;
  IF (SELECT count(*) FROM public.automation_events WHERE entity_id=v_shift_shortage AND event_type='shift_closed')<>1
    OR NOT EXISTS(SELECT 1 FROM public.automation_events WHERE entity_id=v_shift_shortage AND event_type='shift_closed'
      AND payload->>'cashDiscrepancyDirection'='shortage'
      AND (payload->>'cashDiscrepancyAbsoluteInMinorUnits')::BIGINT=1)
  THEN RAISE EXCEPTION 'Negative difference/dedup failed.'; END IF;
  INSERT INTO rule_results VALUES('negative_cash_difference_is_shortage_once',true);

  IF has_function_privilege('anon','public.scan_core_business_alerts(timestamptz,integer)','EXECUTE')
    OR has_function_privilege('authenticated','public.scan_core_business_alerts(timestamptz,integer)','EXECUTE')
    OR has_function_privilege('anon','public.enqueue_closed_shift_automation_event()','EXECUTE')
  THEN RAISE EXCEPTION 'Alert functions exposed.'; END IF;
  INSERT INTO rule_results VALUES('alert_functions_remain_private',true);
  IF (SELECT count(*) FROM cron.job WHERE jobname='scan-core-business-alerts' AND schedule='*/5 * * * *' AND active)<>1
  THEN RAISE EXCEPTION 'Scanner cron changed.'; END IF;
  INSERT INTO rule_results VALUES('existing_five_minute_cron_preserved',true);
END $$;

SELECT jsonb_build_object('ok',bool_and(passed),'runtime_scenarios',count(*),'scenarios',jsonb_agg(scenario ORDER BY scenario))
FROM rule_results;
ROLLBACK;
