\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE business_summary_results (
  scenario TEXT PRIMARY KEY,
  passed BOOLEAN NOT NULL
) ON COMMIT PRESERVE ROWS;

DO $$
DECLARE
  v_owner UUID := '98000000-0000-0000-0000-000000000001';
  v_owner_role UUID;
  v_branch UUID := '98000000-0000-0000-0000-000000000010';
  v_warehouse UUID := '98000000-0000-0000-0000-000000000011';
  v_category UUID := '98000000-0000-0000-0000-000000000012';
  v_unit UUID := '98000000-0000-0000-0000-000000000013';
  v_product UUID := '98000000-0000-0000-0000-000000000014';
  v_out_product UUID := '98000000-0000-0000-0000-000000000015';
  v_customer UUID := '98000000-0000-0000-0000-000000000016';
  v_supplier UUID := '98000000-0000-0000-0000-000000000017';
  v_closed_shift UUID := '98000000-0000-0000-0000-000000000018';
  v_open_shift UUID := '98000000-0000-0000-0000-000000000019';
  v_cash_order UUID := '98000000-0000-0000-0000-000000000020';
  v_cliq_order UUID := '98000000-0000-0000-0000-000000000021';
  v_debt_order UUID := '98000000-0000-0000-0000-000000000022';
  v_expired_order UUID := '98000000-0000-0000-0000-000000000023';
  v_summary JSONB;
  v_weekly JSONB;
  v_report JSONB;
  v_first JSONB;
  v_second JSONB;
  v_scan JSONB;
  v_monitoring JSONB;
  v_event_count INTEGER;
BEGIN
  INSERT INTO auth.users(
    id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    v_owner, 'authenticated', 'authenticated', 'phase4-owner@example.test', NOW(),
    '{}'::JSONB, '{}'::JSONB, NOW(), NOW()
  );
  INSERT INTO public.profiles(id, full_name, is_active)
  VALUES (v_owner, 'مالك اختبار الملخصات', true);
  INSERT INTO public.roles(code, name_ar) VALUES ('owner', 'مالك النظام')
  ON CONFLICT (code) DO NOTHING;
  SELECT id INTO STRICT v_owner_role FROM public.roles WHERE code = 'owner';
  INSERT INTO public.user_roles(user_id, role_id) VALUES (v_owner, v_owner_role);

  INSERT INTO public.branches(id, code, name_ar, is_active)
  VALUES (v_branch, 'PHASE4-BR', 'فرع اختبار الملخصات', true);
  INSERT INTO public.warehouses(id, branch_id, code, name_ar, is_active)
  VALUES (v_warehouse, v_branch, 'PHASE4-WH', 'مستودع اختبار الملخصات', true);
  INSERT INTO public.categories(id, code, name_ar, is_active)
  VALUES (v_category, 'PHASE4-CAT', 'قسم اختبار الملخصات', true);
  INSERT INTO public.units(id, code, name_ar)
  VALUES (v_unit, 'PHASE4-UNIT', 'قطعة');
  INSERT INTO public.products(
    id, sku, name_ar, category_id, unit_id, purchase_unit_id, sale_unit_id,
    units_per_purchase_unit, units_per_sale_unit,
    default_sale_price_in_minor_units, cost_price_in_minor_units,
    sale_price_in_minor_units, wholesale_price_in_minor_units,
    min_stock_level, is_active
  ) VALUES
    (v_product, 'PHASE4-001', 'صنف اختبار الملخصات', v_category, v_unit,
      v_unit, v_unit, 1, 1, 10000, 2000, 10000, 10000, 3, true),
    (v_out_product, 'PHASE4-002', 'صنف نافد اختبار', v_category, v_unit,
      v_unit, v_unit, 1, 1, 1000, 500, 1000, 1000, 2, true);
  INSERT INTO public.inventory_balances(
    warehouse_id, product_id, on_hand_quantity, reserved_quantity
  ) VALUES
    (v_warehouse, v_product, 2, 0),
    (v_warehouse, v_out_product, 0, 0);

  INSERT INTO public.customers(
    id, full_name, phone, customer_type, credit_limit_in_minor_units
  ) VALUES (
    v_customer, 'عميل خاص لا يجوز ظهوره', '0799999999', 'wholesale', 1000000
  );
  INSERT INTO public.suppliers(id, company_name, current_balance_in_minor_units)
  VALUES (v_supplier, 'مورد خاص لا يجوز ظهوره', 7000);

  INSERT INTO public.cash_shifts(
    id, shift_number, branch_id, opened_by, closed_by, opened_at, closed_at,
    opening_cash_in_minor_units, expected_cash_in_minor_units,
    actual_cash_in_minor_units, cash_discrepancy_in_minor_units, status,
    closing_report_snapshot, closing_report_snapshotted_at,
    closing_report_snapshot_version
  ) VALUES (
    v_closed_shift, 'PHASE4-CLOSED', v_branch, v_owner, v_owner,
    '2026-01-05 08:00:00+03', '2026-01-05 20:00:00+03',
    0, 10000, 10500, 500, 'closed',
    '{"fixture":true}'::JSONB, '2026-01-05 20:00:00+03', 1
  );
  INSERT INTO public.cash_shifts(
    id, shift_number, branch_id, opened_by, opened_at,
    opening_cash_in_minor_units, status
  ) VALUES (
    v_open_shift, 'PHASE4-OPEN', v_branch, v_owner,
    '2026-01-05 20:30:00+03', 0, 'open'
  );

  INSERT INTO public.orders(
    id, order_number, customer_id, branch_id, warehouse_id, status,
    payment_method, payment_status, subtotal_in_minor_units,
    discount_in_minor_units, total_in_minor_units,
    amount_paid_in_minor_units, source, created_at, updated_at
  ) VALUES
    (v_cash_order, 'PHASE4-CASH', NULL, v_branch, v_warehouse, 'completed',
      'cash', 'paid', 10000, 1000, 9000, 9000, 'pos',
      '2026-01-05 09:00:00+03', '2026-01-05 09:05:00+03'),
    (v_cliq_order, 'PHASE4-CLIQ', NULL, v_branch, v_warehouse, 'completed',
      'cliq', 'paid', 5000, 0, 5000, 5000, 'pos',
      '2026-01-05 10:00:00+03', '2026-01-05 10:05:00+03'),
    (v_debt_order, 'PHASE4-DEBT', v_customer, v_branch, v_warehouse, 'completed',
      'debt', 'partially_paid', 6000, 0, 6000, 2000, 'pos',
      '2026-01-05 11:00:00+03', '2026-01-05 11:05:00+03');

  INSERT INTO public.order_items(
    order_id, product_id, product_name_snapshot, sku_snapshot, quantity,
    unit_price_in_minor_units, line_total_in_minor_units, created_at
  ) VALUES
    (v_cash_order, v_product, 'صنف اختبار الملخصات', 'PHASE4-001', 1,
      10000, 10000, '2026-01-05 09:00:00+03'),
    (v_cliq_order, v_product, 'صنف اختبار الملخصات', 'PHASE4-001', 1,
      5000, 5000, '2026-01-05 10:00:00+03'),
    (v_debt_order, v_product, 'صنف اختبار الملخصات', 'PHASE4-001', 1,
      6000, 6000, '2026-01-05 11:00:00+03');
  INSERT INTO public.order_status_history(
    order_id, old_status, new_status, changed_by, created_at
  ) VALUES
    (v_cash_order, 'out_for_delivery', 'completed', v_owner, '2026-01-05 09:05:00+03'),
    (v_cliq_order, 'out_for_delivery', 'completed', v_owner, '2026-01-05 10:05:00+03'),
    (v_debt_order, 'out_for_delivery', 'completed', v_owner, '2026-01-05 11:05:00+03');

  INSERT INTO public.operational_expenses(
    expense_number, branch_id, shift_id, category, description,
    amount_in_minor_units, payment_method, created_by, created_at
  ) VALUES (
    'PHASE4-EXP', v_branch, v_open_shift, 'other', 'مصروف اختبار الملخصات',
    1500, 'cash', v_owner, '2026-01-05 12:00:00+03'
  );
  INSERT INTO public.supplier_receipts(
    receipt_number, supplier_id, warehouse_id, branch_id, received_by,
    total_in_minor_units, amount_paid_in_minor_units,
    amount_due_in_minor_units, payment_status, status, received_at
  ) VALUES (
    'PHASE4-RECEIPT', v_supplier, v_warehouse, v_branch, v_owner,
    12000, 5000, 7000, 'partially_paid', 'completed',
    '2026-01-05 13:00:00+03'
  );

  INSERT INTO public.orders(
    id, order_number, branch_id, warehouse_id, status, payment_method,
    payment_status, subtotal_in_minor_units, total_in_minor_units,
    source, reservation_released_at, expired_at, expired_reason,
    created_at, updated_at
  ) VALUES (
    v_expired_order, 'PHASE4-EXPIRED', v_branch, v_warehouse, 'expired',
    'cash_on_delivery', 'unpaid', 0, 0, 'website',
    '2026-01-05 15:00:00+03', '2026-01-05 15:00:00+03', 'fixture',
    '2026-01-05 09:00:00+03', '2026-01-05 15:00:00+03'
  );
  INSERT INTO public.order_status_history(
    order_id, old_status, new_status, changed_by, created_at
  ) VALUES (
    v_expired_order, 'new', 'expired', v_owner, '2026-01-05 15:00:00+03'
  );
  INSERT INTO public.business_alert_incidents(
    incident_key, alert_type, entity_id, state, occurrence,
    opened_at, last_seen_at, updated_at
  ) VALUES (
    'phase4:test-open-incident', 'purchase_order_overdue', v_supplier,
    'open', 1, '2026-01-05 08:00:00+03', '2026-01-05 08:00:00+03',
    '2026-01-05 08:00:00+03'
  );

  v_summary := public.build_business_summary(
    'daily', DATE '2026-01-05', DATE '2026-01-05',
    '2026-01-05 21:30:00+03'
  );
  IF (v_summary #>> '{sales,completedOrderCount}')::INTEGER <> 3
    OR (v_summary #>> '{sales,grossSalesInMinorUnits}')::BIGINT <> 20000
    OR (v_summary #>> '{sales,cashSalesInMinorUnits}')::BIGINT <> 9000
    OR (v_summary #>> '{sales,cliqSalesInMinorUnits}')::BIGINT <> 5000
    OR (v_summary #>> '{sales,creditSalesInMinorUnits}')::BIGINT <> 6000
  THEN RAISE EXCEPTION 'Daily sales/payment reconciliation failed: %', v_summary; END IF;
  INSERT INTO business_summary_results VALUES ('daily_sales_and_payment_methods_reconcile', true);

  IF (v_summary #>> '{sales,cogsInMinorUnits}')::BIGINT <> 6000
    OR (v_summary #>> '{sales,discountInMinorUnits}')::BIGINT <> 1000
    OR (v_summary #>> '{sales,grossProfitInMinorUnits}')::BIGINT <> 14000
    OR (v_summary #>> '{expenses,totalInMinorUnits}')::BIGINT <> 1500
    OR (v_summary #>> '{sales,netProfitInMinorUnits}')::BIGINT <> 12500
  THEN RAISE EXCEPTION 'Profit/expense reconciliation failed: %', v_summary; END IF;
  INSERT INTO business_summary_results VALUES ('cogs_discount_profit_and_expenses_reconcile', true);

  IF (v_summary #>> '{balances,customerDueInMinorUnits}')::BIGINT <> 4000
    OR (v_summary #>> '{balances,supplierDueInMinorUnits}')::BIGINT <> 7000
    OR (v_summary #>> '{purchases,totalInMinorUnits}')::BIGINT <> 12000
    OR (v_summary #>> '{inventory,lowStockCount}')::INTEGER <> 1
    OR (v_summary #>> '{inventory,outOfStockCount}')::INTEGER <> 1
    OR (v_summary #>> '{shifts,openCount}')::INTEGER <> 1
    OR (v_summary #>> '{shifts,cashDiscrepancyCount}')::INTEGER <> 1
    OR (v_summary #>> '{orders,expiredCount}')::INTEGER <> 1
    OR (v_summary #>> '{openIncidents,total}')::INTEGER <> 1
  THEN RAISE EXCEPTION 'Operational reconciliation failed: %', v_summary; END IF;
  INSERT INTO business_summary_results VALUES ('balances_stock_purchases_shifts_and_incidents_reconcile', true);

  IF v_summary::TEXT LIKE '%0799999999%'
    OR v_summary::TEXT LIKE '%عميل خاص%'
    OR v_summary::TEXT LIKE '%مورد خاص%'
  THEN RAISE EXCEPTION 'Summary exposed unnecessary PII.'; END IF;
  INSERT INTO business_summary_results VALUES ('summary_contains_no_customer_or_supplier_pii', true);

  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"98000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',
    true
  );
  v_report := public.get_operational_business_report(
    v_branch, DATE '2026-01-05', DATE '2026-01-05'
  );
  IF v_report #> '{sales,grossSalesInMinorUnits}'
      <> v_summary #> '{sales,grossSalesInMinorUnits}'
    OR v_report #> '{sales,cogsInMinorUnits}'
      <> v_summary #> '{sales,cogsInMinorUnits}'
    OR v_report #> '{sales,grossProfitInMinorUnits}'
      <> v_summary #> '{sales,grossProfitInMinorUnits}'
    OR v_report #> '{sales,netProfitInMinorUnits}'
      <> v_summary #> '{sales,netProfitInMinorUnits}'
    OR v_report #> '{expenses,totalInMinorUnits}'
      <> v_summary #> '{expenses,totalInMinorUnits}'
  THEN RAISE EXCEPTION 'Canonical operational report mismatch: report %, summary %', v_report, v_summary; END IF;
  INSERT INTO business_summary_results VALUES ('canonical_operational_report_matches_summary', true);

  v_weekly := public.build_business_summary(
    'weekly', DATE '2026-01-05', DATE '2026-01-11',
    '2026-01-12 09:00:00+03'
  );
  IF jsonb_array_length(v_weekly->'dailyBreakdown') <> 7
    OR (v_weekly #>> '{sales,grossSalesInMinorUnits}')::BIGINT <> 20000
    OR (v_weekly->'dailyBreakdown'->0->>'grossSalesInMinorUnits')::BIGINT <> 20000
  THEN RAISE EXCEPTION 'Weekly rollup/daily comparison failed: %', v_weekly; END IF;
  INSERT INTO business_summary_results VALUES ('weekly_rollup_has_seven_reconciled_days', true);

  v_first := public.enqueue_business_summary(
    'daily', DATE '2026-01-05', DATE '2026-01-05',
    '2026-01-05 21:30:00+03', '2026-01-05 21:30:00+03'
  );
  v_second := public.enqueue_business_summary(
    'daily', DATE '2026-01-05', DATE '2026-01-05',
    '2026-01-05 21:30:00+03', '2026-01-05 21:31:00+03'
  );
  IF NOT (v_first->>'created')::BOOLEAN OR (v_second->>'created')::BOOLEAN
    OR v_first->>'eventId' IS DISTINCT FROM v_second->>'eventId'
    OR (SELECT count(*) FROM public.automation_events
        WHERE event_type = 'business_daily_summary') <> 1
  THEN RAISE EXCEPTION 'Daily period deduplication failed.'; END IF;
  INSERT INTO business_summary_results VALUES ('same_period_is_enqueued_exactly_once', true);

  UPDATE public.business_alert_settings
  SET summaries_activated_at = '2026-02-01 00:00:00+03',
      daily_summary_local_time = '08:00',
      weekly_summary_iso_day = 1,
      weekly_summary_local_time = '09:00'
  WHERE id = true;
  v_scan := public.scan_business_summaries('2026-02-10 08:01:00+03');
  IF NOT (v_scan->>'dailyCreated')::BOOLEAN
    OR NOT (v_scan->>'weeklyCreated')::BOOLEAN
    OR (v_scan->>'missedRecorded')::INTEGER < 1
    OR (SELECT count(*) FROM public.business_summary_runs
        WHERE summary_type = 'daily' AND period_start = DATE '2026-02-09'
          AND run_status = 'queued') <> 1
    OR (SELECT count(*) FROM public.business_summary_runs
        WHERE summary_type = 'weekly' AND period_start = DATE '2026-02-02'
          AND period_end = DATE '2026-02-08' AND run_status = 'queued') <> 1
  THEN RAISE EXCEPTION 'Asia/Amman schedule or missed-period detection failed: %', v_scan; END IF;
  SELECT count(*) INTO v_event_count FROM public.automation_events;
  v_scan := public.scan_business_summaries('2026-02-10 08:02:00+03');
  IF (v_scan->>'dailyCreated')::BOOLEAN OR (v_scan->>'weeklyCreated')::BOOLEAN
    OR (SELECT count(*) FROM public.automation_events) <> v_event_count
  THEN RAISE EXCEPTION 'Repeated scheduler scan duplicated summaries.'; END IF;
  INSERT INTO business_summary_results VALUES ('amman_schedule_missed_detection_and_rescan_dedupe', true);

  v_monitoring := public.get_business_summary_monitoring_status();
  IF (SELECT count(*) FROM jsonb_object_keys(v_monitoring)) <> 2
    OR NOT (v_monitoring ? 'unresolvedMissedPeriods')
    OR NOT (v_monitoring ? 'overdueDeliveries')
    OR v_monitoring::TEXT ~* '(sales|cash|customer|supplier|amount|phone|address)'
  THEN RAISE EXCEPTION 'Developer monitoring status exposed Business data: %', v_monitoring; END IF;
  INSERT INTO business_summary_results VALUES ('developer_monitoring_exposes_technical_counts_only', true);

  IF has_function_privilege('anon', 'public.build_business_summary(text,date,date,timestamptz)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.build_business_summary(text,date,date,timestamptz)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.enqueue_business_summary(text,date,date,timestamptz,timestamptz)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.scan_business_summaries(timestamptz)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.get_business_summary_monitoring_status()', 'EXECUTE')
    OR has_table_privilege('anon', 'public.business_summary_runs', 'SELECT')
    OR has_table_privilege('authenticated', 'public.business_summary_runs', 'SELECT')
  THEN RAISE EXCEPTION 'Business summary internals are exposed to users.'; END IF;
  INSERT INTO business_summary_results VALUES ('summary_contracts_are_service_role_only', true);

  IF (SELECT count(*) FROM cron.job
      WHERE jobname = 'scan-business-summaries'
        AND schedule = '*/5 * * * *' AND active) <> 1
  THEN RAISE EXCEPTION 'Business summary cron is not unique and active.'; END IF;
  INSERT INTO business_summary_results VALUES ('bounded_summary_cron_registered_once', true);
END $$;

SELECT jsonb_build_object(
  'ok', bool_and(passed),
  'runtime_scenarios', count(*),
  'scenarios', jsonb_agg(scenario ORDER BY scenario)
) AS business_summaries_runtime_summary
FROM business_summary_results;

ROLLBACK;
