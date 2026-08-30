-- Runtime integration coverage for migration 085.
-- Destructive fixture data is written only to the disposable isolated DB.
\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE final_blocker_results (
  scenario TEXT PRIMARY KEY,
  details JSONB NOT NULL DEFAULT '{}'::JSONB
) ON COMMIT PRESERVE ROWS;

DO $$
DECLARE
  v_owner UUID := '85000000-0000-0000-0000-000000000001';
  v_owner_role UUID;
  v_branch UUID := '85000000-0000-0000-0000-000000000010';
  v_warehouse UUID := '85000000-0000-0000-0000-000000000020';
  v_category UUID := '85000000-0000-0000-0000-000000000030';
  v_unit UUID := '85000000-0000-0000-0000-000000000040';
  v_customer UUID := '85000000-0000-0000-0000-000000000050';
  v_history_customer UUID := '85000000-0000-0000-0000-000000000051';
  v_product_credit UUID := '85000000-0000-0000-0000-000000000061';
  v_product_reversal UUID := '85000000-0000-0000-0000-000000000062';
  v_product_cash UUID := '85000000-0000-0000-0000-000000000063';
  v_product_cliq UUID := '85000000-0000-0000-0000-000000000064';
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    v_owner, 'authenticated', 'authenticated',
    'final-admin-blockers-owner@example.test', NOW(),
    '{}'::JSONB, '{}'::JSONB, NOW(), NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, full_name, is_active)
  VALUES (v_owner, 'مالك اختبار الحواجز النهائية', true)
  ON CONFLICT (id) DO UPDATE SET is_active = true;
  INSERT INTO public.roles (code, name_ar)
  VALUES ('owner', 'مالك النظام')
  ON CONFLICT (code) DO NOTHING;
  SELECT id INTO v_owner_role FROM public.roles WHERE code = 'owner';
  INSERT INTO public.user_roles (user_id, role_id)
  VALUES (v_owner, v_owner_role)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.branches (id, code, name_ar, is_active)
  VALUES (v_branch, 'FAB-BR-01', 'فرع اختبار الحواجز', true)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.warehouses (id, branch_id, code, name_ar, is_active)
  VALUES (v_warehouse, v_branch, 'FAB-WH-01', 'مستودع اختبار الحواجز', true)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.categories (id, code, name_ar, is_active)
  VALUES (v_category, 'FAB-CAT', 'قسم اختبار الحواجز', true)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.units (id, code, name_ar)
  VALUES (v_unit, 'FAB-PCS', 'قطعة')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.customers (
    id, full_name, phone, customer_type, credit_limit_in_minor_units
  ) VALUES
    (v_customer, 'عميل دورة دين POS', '0798500001', 'wholesale', 999999999),
    (v_history_customer, 'عميل تاريخ كبير', '0798500002', 'wholesale', 999999999)
  ON CONFLICT (id) DO UPDATE
    SET is_active = true, is_blocked = false, is_deleted = false;

  INSERT INTO public.customers (
    full_name, phone, customer_type, credit_limit_in_minor_units
  )
  SELECT
    'عميل اختبار ' || LPAD(series::TEXT, 4, '0'),
    '0798' || LPAD(series::TEXT, 6, '0'),
    'wholesale',
    999999999
  FROM generate_series(1, 1000) series;

  INSERT INTO public.products (
    id, sku, name_ar, category_id, unit_id, purchase_unit_id, sale_unit_id,
    units_per_purchase_unit, units_per_sale_unit,
    default_sale_price_in_minor_units, cost_price_in_minor_units,
    sale_price_in_minor_units, wholesale_price_in_minor_units,
    min_stock_level, is_active, is_flavor_master
  ) VALUES
    (v_product_credit, 'FAB-CREDIT', 'صنف دين POS', v_category, v_unit, v_unit, v_unit, 1, 1, 1275, 100, 1275, 1275, 1, true, false),
    (v_product_reversal, 'FAB-REVERSE', 'صنف عكس دين POS', v_category, v_unit, v_unit, v_unit, 1, 1, 500, 100, 500, 500, 1, true, false),
    (v_product_cash, 'FAB-CASH', 'صنف نقدي POS', v_category, v_unit, v_unit, v_unit, 1, 1, 700, 100, 700, 700, 1, true, false),
    (v_product_cliq, 'FAB-CLIQ', 'صنف CliQ POS', v_category, v_unit, v_unit, v_unit, 1, 1, 800, 100, 800, 800, 1, true, false)
  ON CONFLICT (id) DO UPDATE SET is_active = true;

  INSERT INTO public.inventory_balances (
    warehouse_id, product_id, on_hand_quantity, reserved_quantity
  )
  SELECT v_warehouse, product_id, 100, 0
  FROM unnest(ARRAY[
    v_product_credit, v_product_reversal, v_product_cash, v_product_cliq
  ]) AS product_id
  ON CONFLICT (warehouse_id, product_id)
  DO UPDATE SET on_hand_quantity = EXCLUDED.on_hand_quantity, reserved_quantity = 0;

  -- A large historical customer record proves the detail RPC never returns the
  -- complete 1,000-row history in one browser response.
  INSERT INTO public.orders (
    order_number, customer_id, status, payment_method, payment_status,
    subtotal_in_minor_units, total_in_minor_units,
    amount_paid_in_minor_units, source, created_at
  )
  SELECT
    'FAB-HISTORY-' || LPAD(series::TEXT, 4, '0'),
    v_history_customer,
    CASE WHEN series % 20 = 0 THEN 'cancelled' ELSE 'completed' END,
    'cash_on_delivery',
    CASE WHEN series % 20 = 0 THEN 'unpaid' ELSE 'paid' END,
    1000,
    1000,
    CASE WHEN series % 20 = 0 THEN 0 ELSE 1000 END,
    'website',
    NOW() - (series || ' minutes')::INTERVAL
  FROM generate_series(1, 1000) series;
END $$;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"85000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);

DO $$
DECLARE
  v_branch UUID := '85000000-0000-0000-0000-000000000010';
  v_warehouse UUID := '85000000-0000-0000-0000-000000000020';
  v_customer UUID := '85000000-0000-0000-0000-000000000050';
  v_history_customer UUID := '85000000-0000-0000-0000-000000000051';
  v_product_credit UUID := '85000000-0000-0000-0000-000000000061';
  v_product_reversal UUID := '85000000-0000-0000-0000-000000000062';
  v_product_cash UUID := '85000000-0000-0000-0000-000000000063';
  v_product_cliq UUID := '85000000-0000-0000-0000-000000000064';
  v_result JSONB;
  v_page JSONB;
  v_detail JSONB;
  v_order UUID;
  v_safe_reversal_order UUID;
  v_payment_partial UUID;
  v_payment_final UUID;
  v_due BIGINT;
  v_expected BIGINT;
  v_plan JSONB;
  v_target UUID;
  v_started TIMESTAMPTZ;
  v_history_ms NUMERIC;
BEGIN
  PERFORM public.open_cash_shift(v_branch, 0);

  -- Complete POS credit lifecycle using only canonical mutation RPCs.
  v_result := public.create_pos_sale(
    v_warehouse, v_branch, v_customer, 'عميل دورة دين POS', 'debt',
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product_credit, 'quantity', 1
    )),
    0, 0, 'final-admin-pos-credit-sale-key-000001'
  );
  v_order := (v_result->>'orderId')::UUID;

  v_page := public.get_customer_outstanding_orders_page(1, 25, '0798500001');
  SELECT (entry->>'amount_due_in_minor_units')::BIGINT INTO v_due
  FROM jsonb_array_elements(v_page->'orders') entry
  WHERE (entry->>'id')::UUID = v_order;
  IF v_due IS DISTINCT FROM 1275 THEN
    RAISE EXCEPTION 'POS credit sale was not exposed as a 1.275 JOD receivable.';
  END IF;
  INSERT INTO final_blocker_results VALUES (
    'pos_credit_visible', jsonb_build_object('due_in_minor_units', v_due)
  );

  v_result := public.record_customer_order_payment_once(
    v_order, 275, 'cash', NULL, 'دفعة جزئية معزولة',
    'final-admin-customer-partial-key-000001'
  );
  v_payment_partial := (v_result->>'payment_id')::UUID;
  v_page := public.get_customer_outstanding_orders_page(1, 25, '0798500001');
  SELECT (entry->>'amount_due_in_minor_units')::BIGINT INTO v_due
  FROM jsonb_array_elements(v_page->'orders') entry
  WHERE (entry->>'id')::UUID = v_order;
  IF v_due IS DISTINCT FROM 1000 THEN
    RAISE EXCEPTION 'Partial POS debt collection did not reconcile to 1.000 JOD.';
  END IF;
  INSERT INTO final_blocker_results VALUES (
    'pos_credit_partial_payment', jsonb_build_object('due_in_minor_units', v_due)
  );

  v_result := public.record_customer_order_payment_once(
    v_order, 1000, 'cliq', 'FAB-CLIQ-FINAL', 'دفعة نهائية معزولة',
    'final-admin-customer-final-key-0000001'
  );
  v_payment_final := (v_result->>'payment_id')::UUID;
  v_page := public.get_customer_outstanding_orders_page(1, 25, '0798500001');
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_page->'orders') entry
    WHERE (entry->>'id')::UUID = v_order
  ) THEN
    RAISE EXCEPTION 'Fully paid POS debt remained in receivables.';
  END IF;
  INSERT INTO final_blocker_results VALUES (
    'pos_credit_final_payment', jsonb_build_object('due_in_minor_units', 0)
  );

  PERFORM public.reverse_customer_order_payment(
    v_payment_final, 'عكس الدفعة النهائية في الاختبار المعزول'
  );
  v_page := public.get_customer_outstanding_orders_page(1, 25, '0798500001');
  SELECT (entry->>'amount_due_in_minor_units')::BIGINT INTO v_due
  FROM jsonb_array_elements(v_page->'orders') entry
  WHERE (entry->>'id')::UUID = v_order;
  IF v_due IS DISTINCT FROM 1000 THEN
    RAISE EXCEPTION 'Reversed final payment did not restore exactly 1.000 JOD.';
  END IF;
  PERFORM public.reverse_customer_order_payment(
    v_payment_partial, 'عكس الدفعة الجزئية في الاختبار المعزول'
  );
  v_page := public.get_customer_outstanding_orders_page(1, 25, '0798500001');
  SELECT (entry->>'amount_due_in_minor_units')::BIGINT INTO v_due
  FROM jsonb_array_elements(v_page->'orders') entry
  WHERE (entry->>'id')::UUID = v_order;
  IF v_due IS DISTINCT FROM 1275 THEN
    RAISE EXCEPTION 'Reversing both customer payments did not restore 1.275 JOD.';
  END IF;
  INSERT INTO final_blocker_results VALUES (
    'pos_credit_payment_reversals', jsonb_build_object('due_in_minor_units', v_due)
  );

  -- A separate debt sale without a later payment dependency remains eligible
  -- for the frozen safe POS reversal primitive.
  v_result := public.create_pos_sale(
    v_warehouse, v_branch, v_customer, 'عميل عكس دين POS', 'debt',
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product_reversal, 'quantity', 1
    )),
    0, 0, 'final-admin-pos-safe-reversal-sale-00001'
  );
  v_safe_reversal_order := (v_result->>'orderId')::UUID;
  PERFORM public.reverse_pos_sale(
    v_safe_reversal_order,
    'عكس بيع آجل آمن في الاختبار المعزول',
    'final-admin-pos-safe-reversal-key-000001'
  );
  v_page := public.get_customer_outstanding_orders_page(1, 25, '0798500001');
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_page->'orders') entry
    WHERE (entry->>'id')::UUID = v_safe_reversal_order
  ) THEN
    RAISE EXCEPTION 'Safely reversed POS sale remained in receivables.';
  END IF;
  INSERT INTO final_blocker_results VALUES (
    'safe_pos_reversal_removed_debt',
    jsonb_build_object('order_id', v_safe_reversal_order)
  );

  -- Cash and CliQ POS sales must never be interpreted as receivables.
  PERFORM public.create_pos_sale(
    v_warehouse, v_branch, v_customer, 'عميل بيع نقدي', 'cash',
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product_cash, 'quantity', 1
    )),
    0, 700, 'final-admin-pos-cash-sale-key-0000001'
  );
  PERFORM public.create_pos_sale(
    v_warehouse, v_branch, v_customer, 'عميل بيع CliQ', 'cliq',
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product_cliq, 'quantity', 1
    )),
    0, 0, 'final-admin-pos-cliq-sale-key-0000001'
  );
  v_page := public.get_customer_outstanding_orders_page(1, 25, '0798500001');
  SELECT COALESCE(SUM((entry->>'amount_due_in_minor_units')::BIGINT), 0)
  INTO v_due
  FROM jsonb_array_elements(v_page->'orders') entry;
  SELECT COALESCE(SUM(GREATEST(
    o.total_in_minor_units - o.amount_paid_in_minor_units, 0
  )), 0)::BIGINT
  INTO v_expected
  FROM public.orders o
  WHERE o.customer_id = v_customer
    AND o.status IN ('completed', 'delivered')
    AND o.amount_paid_in_minor_units < o.total_in_minor_units
    AND (COALESCE(o.source, 'website') <> 'pos' OR o.payment_method = 'debt');
  IF v_due <> v_expected OR v_due <> 1275 THEN
    RAISE EXCEPTION 'Independent receivable reconciliation failed: read %, expected %.', v_due, v_expected;
  END IF;
  INSERT INTO final_blocker_results VALUES (
    'cash_cliq_excluded_and_receivable_reconciled',
    jsonb_build_object('read_due', v_due, 'expected_due', v_expected)
  );

  -- The customer detail response is bounded while its statistics cover all
  -- 1,000 historical records on the server.
  v_started := clock_timestamp();
  v_detail := public.get_crm_customer_detail_page(
    v_history_customer, 1, 25
  );
  v_history_ms := EXTRACT(EPOCH FROM (clock_timestamp() - v_started)) * 1000;
  IF jsonb_array_length(v_detail->'orders') <> 25
    OR (v_detail->>'history_total_count')::INTEGER <> 1000
    OR NOT (v_detail->>'history_has_more')::BOOLEAN
    OR (v_detail->'stats'->>'total_orders')::INTEGER <> 1000
  THEN
    RAISE EXCEPTION 'Customer history did not return a bounded 25/1000 page.';
  END IF;
  v_detail := public.get_crm_customer_detail_page(
    v_history_customer, 40, 25
  );
  IF jsonb_array_length(v_detail->'orders') <> 25
    OR (v_detail->>'history_has_more')::BOOLEAN
  THEN
    RAISE EXCEPTION 'Customer history final page metadata is invalid.';
  END IF;
  INSERT INTO final_blocker_results VALUES (
    'customer_history_1000_server_paged',
    jsonb_build_object(
      'total_count', 1000,
      'browser_rows_per_page', 25,
      'first_page_ms', ROUND(v_history_ms, 3)
    )
  );

  -- Customer numbers 251, 500 and 1000 are found from the complete server
  -- directory, not from a browser-side first-250 list.
  FOREACH v_due IN ARRAY ARRAY[251::BIGINT, 500::BIGINT, 1000::BIGINT]
  LOOP
    v_page := public.get_pos_customer_page(
      1, 25, 'عميل اختبار ' || LPAD(v_due::TEXT, 4, '0')
    );
    IF (v_page->>'total_count')::INTEGER <> 1
      OR jsonb_array_length(v_page->'customers') <> 1
    THEN
      RAISE EXCEPTION 'POS customer % was not searchable.', v_due;
    END IF;
  END LOOP;
  v_page := public.get_pos_customer_page(1, 25, '0798000500');
  IF (v_page->>'total_count')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'POS phone-prefix customer search failed.';
  END IF;
  v_target := (v_page->'customers'->0->>'id')::UUID;
  v_page := public.get_pos_customer_page(1, 25, v_target::TEXT);
  IF (v_page->>'total_count')::INTEGER <> 1
    OR (v_page->'customers'->0->>'id')::UUID <> v_target
  THEN
    RAISE EXCEPTION 'POS exact customer-id search failed.';
  END IF;
  INSERT INTO final_blocker_results VALUES (
    'pos_customer_251_500_1000_searchable',
    jsonb_build_object(
      'fixture_customers', 1000,
      'targets', jsonb_build_array(251, 500, 1000),
      'phone_search', true,
      'id_search', true
    )
  );

  -- Force index eligibility checks without imposing machine-specific timing
  -- thresholds on CI.
  PERFORM set_config('enable_seqscan', 'off', true);
  EXECUTE $plan$
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT id
    FROM public.customers
    WHERE is_active = true AND is_blocked = false AND is_deleted = false
      AND LOWER(full_name) LIKE LOWER('عميل اختبار 0500') || '%'
    ORDER BY LOWER(full_name), id
    LIMIT 25
  $plan$ INTO v_plan;
  IF v_plan::TEXT NOT LIKE '%idx_customers_pos_name_search%' THEN
    RAISE EXCEPTION 'POS customer name search index is not query-plan eligible.';
  END IF;
  EXECUTE format(
    'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM public.orders WHERE customer_id = %L::uuid ORDER BY created_at DESC LIMIT 25',
    v_history_customer
  ) INTO v_plan;
  IF v_plan::TEXT NOT LIKE '%idx_orders_customer_created_at%' THEN
    RAISE EXCEPTION 'Customer history index is not query-plan eligible.';
  END IF;
  INSERT INTO final_blocker_results VALUES (
    'new_read_models_index_eligible',
    jsonb_build_object(
      'pos_customer_index', 'idx_customers_pos_name_search',
      'history_index', 'idx_orders_customer_created_at'
    )
  );

  IF has_function_privilege(
    'anon', 'public.get_crm_customer_detail_page(uuid,integer,integer)', 'EXECUTE'
  ) OR has_function_privilege(
    'anon', 'public.get_pos_customer_page(integer,integer,text)', 'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated', 'public.get_crm_customer_detail_page(uuid,integer,integer)', 'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated', 'public.get_pos_customer_page(integer,integer,text)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Read-model execute grants are not fail-closed.';
  END IF;
  INSERT INTO final_blocker_results VALUES (
    'read_model_security_grants',
    jsonb_build_object('anonymous', 'denied', 'authenticated', 'role_guarded')
  );
END $$;

SELECT jsonb_build_object(
  'runtime_scenarios', (SELECT COUNT(*) FROM final_blocker_results),
  'passed', (SELECT COUNT(*) FROM final_blocker_results),
  'unexpected_failures', 0,
  'pos_credit_reconciliation', 'pass',
  'customer_history_1000', 'pass',
  'customer_search_251_500_1000', 'pass',
  'cash_cliq_exclusion', 'pass',
  'full_return_applicable_to_pos', false,
  'scenarios', (
    SELECT jsonb_agg(jsonb_build_object(
      'name', scenario, 'details', details
    ) ORDER BY scenario)
    FROM final_blocker_results
  )
) AS final_admin_blockers_runtime_summary;

COMMIT;
