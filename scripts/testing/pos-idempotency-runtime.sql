\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE pos_idempotency_results (
  scenario TEXT PRIMARY KEY,
  details JSONB NOT NULL
) ON COMMIT PRESERVE ROWS;

DO $$
DECLARE
  v_owner UUID := '91100000-0000-0000-0000-000000000001';
  v_second_owner UUID := '91100000-0000-0000-0000-000000000002';
  v_role UUID;
  v_branch UUID := '91100000-0000-0000-0000-000000000010';
  v_other_branch UUID := '91100000-0000-0000-0000-000000000011';
  v_warehouse UUID := '91100000-0000-0000-0000-000000000020';
  v_other_warehouse UUID := '91100000-0000-0000-0000-000000000021';
  v_category UUID := '91100000-0000-0000-0000-000000000030';
  v_unit UUID := '91100000-0000-0000-0000-000000000040';
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_owner, 'authenticated', 'authenticated', 'pos-idempotency-owner@example.test', NOW(), '{}', '{}', NOW(), NOW()),
    (v_second_owner, 'authenticated', 'authenticated', 'pos-idempotency-other@example.test', NOW(), '{}', '{}', NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, full_name, is_active)
  VALUES
    (v_owner, 'مالك اختبار POS', true),
    (v_second_owner, 'مالك اختبار POS ثان', true)
  ON CONFLICT (id) DO UPDATE SET is_active = true;

  INSERT INTO public.roles (code, name_ar)
  VALUES ('owner', 'مالك النظام')
  ON CONFLICT (code) DO NOTHING;
  SELECT id INTO v_role FROM public.roles WHERE code = 'owner';
  INSERT INTO public.user_roles (user_id, role_id)
  VALUES (v_owner, v_role), (v_second_owner, v_role)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.branches (id, code, name_ar, is_active)
  VALUES
    (v_branch, 'POS-IDEMP', 'فرع اختبار POS', true),
    (v_other_branch, 'POS-IDEMP-OTHER', 'فرع اختبار POS آخر', true)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.warehouses (id, branch_id, code, name_ar, is_active)
  VALUES
    (v_warehouse, v_branch, 'POS-IDEMP-WH', 'مستودع اختبار POS', true),
    (v_other_warehouse, v_other_branch, 'POS-IDEMP-WH-OTHER', 'مستودع اختبار POS آخر', true)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.categories (id, code, name_ar, is_active)
  VALUES (v_category, 'POS-IDEMP-CAT', 'قسم اختبار POS', true)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.units (id, code, name_ar)
  VALUES (v_unit, 'POS-IDEMP-UNIT', 'قطعة')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.customers (
    id, full_name, phone, customer_type, credit_limit_in_minor_units
  ) VALUES (
    '91100000-0000-0000-0000-000000000050',
    'عميل اختبار ذمة POS',
    '0799110001',
    'wholesale',
    999999999
  )
  ON CONFLICT (id) DO UPDATE
    SET is_active = true, is_blocked = false, is_deleted = false;

  INSERT INTO public.products (
    id, sku, name_ar, category_id, unit_id, purchase_unit_id, sale_unit_id,
    units_per_purchase_unit, units_per_sale_unit,
    default_sale_price_in_minor_units, cost_price_in_minor_units,
    sale_price_in_minor_units, wholesale_price_in_minor_units,
    min_stock_level, is_active, is_flavor_master
  ) VALUES
    ('91100000-0000-0000-0000-000000000061', 'POS-IDEMP-A', 'منتج إعادة الإرسال', v_category, v_unit, v_unit, v_unit, 1, 1, 700, 100, 700, 700, 1, true, false),
    ('91100000-0000-0000-0000-000000000062', 'POS-IDEMP-B', 'منتج الدفع النقدي', v_category, v_unit, v_unit, v_unit, 1, 1, 500, 200, 500, 500, 1, true, false),
    ('91100000-0000-0000-0000-000000000063', 'POS-IDEMP-C', 'منتج الذمة', v_category, v_unit, v_unit, v_unit, 1, 1, 900, 300, 900, 900, 1, true, false),
    ('91100000-0000-0000-0000-000000000064', 'POS-IDEMP-D', 'منتج التزامن المتطابق', v_category, v_unit, v_unit, v_unit, 1, 1, 1100, 400, 1100, 1100, 1, true, false),
    ('91100000-0000-0000-0000-000000000065', 'POS-IDEMP-E', 'منتج تعارض التزامن', v_category, v_unit, v_unit, v_unit, 1, 1, 1200, 500, 1200, 1200, 1, true, false)
  ON CONFLICT (id) DO UPDATE SET is_active = true;

  INSERT INTO public.inventory_balances (
    warehouse_id, product_id, on_hand_quantity, reserved_quantity
  )
  SELECT v_warehouse, product_id, 100, 0
  FROM unnest(ARRAY[
    '91100000-0000-0000-0000-000000000061'::UUID,
    '91100000-0000-0000-0000-000000000062'::UUID,
    '91100000-0000-0000-0000-000000000063'::UUID,
    '91100000-0000-0000-0000-000000000064'::UUID,
    '91100000-0000-0000-0000-000000000065'::UUID
  ]) AS product_id
  ON CONFLICT (warehouse_id, product_id)
  DO UPDATE SET on_hand_quantity = 100, reserved_quantity = 0;
END $$;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"91100000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);

SELECT public.open_cash_shift(
  '91100000-0000-0000-0000-000000000010', 0
);

DO $$
DECLARE
  v_branch UUID := '91100000-0000-0000-0000-000000000010';
  v_other_branch UUID := '91100000-0000-0000-0000-000000000011';
  v_warehouse UUID := '91100000-0000-0000-0000-000000000020';
  v_other_warehouse UUID := '91100000-0000-0000-0000-000000000021';
  v_product_a UUID := '91100000-0000-0000-0000-000000000061';
  v_product_b UUID := '91100000-0000-0000-0000-000000000062';
  v_product_c UUID := '91100000-0000-0000-0000-000000000063';
  v_result JSONB;
  v_original_result JSONB;
  v_order_id UUID;
  v_original_updated_at TIMESTAMPTZ;
  v_original_audit_count BIGINT;
  v_original_movement_count BIGINT;
  v_original_status_count BIGINT;
  v_original_stock INTEGER;
  v_original_cost BIGINT;
  v_before_orders BIGINT;
  v_before_movements BIGINT;
  v_shift_cash_before BIGINT;
  v_shift_summary JSONB;
  v_canonical_key TEXT := 'pos-idempotency-' || 'canonical-items-01';
BEGIN
  v_result := public.create_pos_sale(
    v_warehouse, v_branch, NULL, 'زبون نقدي', 'cliq',
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product_a, 'quantity', 1
    )),
    0, 0, 'pos-idempotency-sequential-000001'
  );
  v_order_id := (v_result->>'orderId')::UUID;
  v_original_result := v_result;

  IF (v_result->>'idempotentReplay')::BOOLEAN
    OR (v_result->>'totalInMinorUnits')::BIGINT <> 700
  THEN
    RAISE EXCEPTION 'Original POS sale result is invalid.';
  END IF;

  SELECT updated_at INTO v_original_updated_at
  FROM public.orders WHERE id = v_order_id;
  SELECT count(*) INTO v_original_audit_count
  FROM public.audit_logs WHERE entity_id = v_order_id;
  SELECT count(*) INTO v_original_movement_count
  FROM public.inventory_movements WHERE reference_id = v_order_id;
  SELECT count(*) INTO v_original_status_count
  FROM public.order_status_history WHERE order_id = v_order_id;
  SELECT on_hand_quantity INTO v_original_stock
  FROM public.inventory_balances
  WHERE warehouse_id = v_warehouse AND product_id = v_product_a;
  SELECT cost_price_in_minor_units INTO v_original_cost
  FROM public.products WHERE id = v_product_a;

  v_result := public.create_pos_sale(
    v_warehouse, v_branch, NULL, 'زبون نقدي', 'cliq',
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product_a, 'quantity', 1
    )),
    0, 0, 'pos-idempotency-sequential-000001'
  );

  IF NOT (v_result->>'idempotentReplay')::BOOLEAN
    OR (v_result->>'orderId')::UUID <> v_order_id
    OR (v_result->>'totalInMinorUnits')::BIGINT <> 700
    OR (v_result - 'idempotentReplay')
      IS DISTINCT FROM (v_original_result - 'idempotentReplay')
    OR (SELECT updated_at FROM public.orders WHERE id = v_order_id)
      IS DISTINCT FROM v_original_updated_at
    OR (SELECT count(*) FROM public.audit_logs WHERE entity_id = v_order_id)
      <> v_original_audit_count
    OR (SELECT count(*) FROM public.inventory_movements WHERE reference_id = v_order_id)
      <> v_original_movement_count
    OR (SELECT count(*) FROM public.order_status_history WHERE order_id = v_order_id)
      <> v_original_status_count
    OR (SELECT on_hand_quantity FROM public.inventory_balances
        WHERE warehouse_id = v_warehouse AND product_id = v_product_a)
      <> v_original_stock
    OR (SELECT reserved_quantity FROM public.inventory_balances
        WHERE warehouse_id = v_warehouse AND product_id = v_product_a) <> 0
    OR (SELECT cogs_in_minor_units FROM public.order_items
        WHERE order_id = v_order_id AND product_id = v_product_a) <> 100
    OR (SELECT profit_in_minor_units FROM public.order_items
        WHERE order_id = v_order_id AND product_id = v_product_a) <> 600
  THEN
    RAISE EXCEPTION 'Identical replay was not completely read-only.';
  END IF;

  UPDATE public.products
  SET
    default_sale_price_in_minor_units = 900,
    sku = 'POS-IDEMP-A-RENAMED'
  WHERE id = v_product_a;

  v_result := public.create_pos_sale(
    v_warehouse, v_branch, NULL, 'زبون نقدي', 'cliq',
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product_a, 'quantity', 1
    )),
    0, 0, 'pos-idempotency-sequential-000001'
  );

  IF (v_result->>'totalInMinorUnits')::BIGINT <> 700
    OR (v_result - 'idempotentReplay')
      IS DISTINCT FROM (v_original_result - 'idempotentReplay')
    OR (v_result->'items'->0->>'unitPriceInMinorUnits')::BIGINT <> 700
    OR (v_result->'items'->0->>'sku') <> 'POS-IDEMP-A'
    OR (SELECT total_in_minor_units FROM public.orders WHERE id = v_order_id) <> 700
    OR (SELECT line_total_in_minor_units FROM public.order_items
        WHERE order_id = v_order_id AND product_id = v_product_a) <> 700
    OR (SELECT cogs_in_minor_units FROM public.order_items
        WHERE order_id = v_order_id AND product_id = v_product_a) <> 100
    OR (SELECT profit_in_minor_units FROM public.order_items
        WHERE order_id = v_order_id AND product_id = v_product_a) <> 600
  THEN
    RAISE EXCEPTION 'Current product price changed the historical replay.';
  END IF;

  -- Every changed logical field must conflict without touching the original.
  BEGIN
    PERFORM public.create_pos_sale(
      v_warehouse, v_branch, NULL, 'زبون نقدي', 'cliq',
      jsonb_build_array(jsonb_build_object('product_id', v_product_a, 'quantity', 2)),
      0, 0, 'pos-idempotency-sequential-000001'
    );
    RAISE EXCEPTION 'Changed quantity unexpectedly succeeded.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'IDEMPOTENCY_CONFLICT:%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.create_pos_sale(
      v_warehouse, v_branch,
      '91100000-0000-0000-0000-000000000050',
      'عميل اختبار ذمة POS', 'cliq',
      jsonb_build_array(jsonb_build_object('product_id', v_product_a, 'quantity', 1)),
      0, 0, 'pos-idempotency-sequential-000001'
    );
    RAISE EXCEPTION 'Changed customer unexpectedly succeeded.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'IDEMPOTENCY_CONFLICT:%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.create_pos_sale(
      v_warehouse, v_branch, NULL, 'زبون نقدي', 'cliq',
      jsonb_build_array(jsonb_build_object('product_id', v_product_b, 'quantity', 1)),
      0, 0, 'pos-idempotency-sequential-000001'
    );
    RAISE EXCEPTION 'Changed product unexpectedly succeeded.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'IDEMPOTENCY_CONFLICT:%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.create_pos_sale(
      v_warehouse, v_branch, NULL, 'زبون نقدي', 'cash',
      jsonb_build_array(jsonb_build_object('product_id', v_product_a, 'quantity', 1)),
      0, 700, 'pos-idempotency-sequential-000001'
    );
    RAISE EXCEPTION 'Changed payment method unexpectedly succeeded.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'IDEMPOTENCY_CONFLICT:%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.create_pos_sale(
      v_warehouse, v_branch, NULL, 'زبون نقدي', 'cliq',
      jsonb_build_array(jsonb_build_object('product_id', v_product_a, 'quantity', 1)),
      1, 0, 'pos-idempotency-sequential-000001'
    );
    RAISE EXCEPTION 'Changed discount unexpectedly succeeded.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'IDEMPOTENCY_CONFLICT:%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.create_pos_sale(
      v_other_warehouse, v_other_branch, NULL, 'زبون نقدي', 'cliq',
      jsonb_build_array(jsonb_build_object('product_id', v_product_a, 'quantity', 1)),
      0, 0, 'pos-idempotency-sequential-000001'
    );
    RAISE EXCEPTION 'Changed branch/warehouse unexpectedly succeeded.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'IDEMPOTENCY_CONFLICT:%' THEN RAISE; END IF;
  END;

  IF (SELECT total_in_minor_units FROM public.orders WHERE id = v_order_id) <> 700
    OR (SELECT quantity FROM public.order_items
        WHERE order_id = v_order_id AND product_id = v_product_a) <> 1
    OR (SELECT on_hand_quantity FROM public.inventory_balances
        WHERE warehouse_id = v_warehouse AND product_id = v_product_a) <> 99
    OR (SELECT cost_price_in_minor_units FROM public.products WHERE id = v_product_a)
      <> v_original_cost
    OR (SELECT count(*) FROM public.audit_logs WHERE entity_id = v_order_id)
      <> v_original_audit_count
  THEN
    RAISE EXCEPTION 'A conflict changed canonical POS business state.';
  END IF;

  INSERT INTO pos_idempotency_results VALUES (
    'sequential_replay_and_conflicts',
    jsonb_build_object(
      'original_total', 700,
      'identical_replay_total', 700,
      'changed_price_replay_total', 700,
      'stock_after', 99,
      'movement_count', v_original_movement_count,
      'audit_count', v_original_audit_count
    )
  );

  SELECT public.get_cash_shift_summary(id)
  INTO v_shift_summary
  FROM public.cash_shifts
  WHERE branch_id = v_branch AND status = 'open';
  IF (v_shift_summary->>'cliqSalesInMinorUnits')::BIGINT <> 700 THEN
    RAISE EXCEPTION 'CliQ accounting did not contain the original sale exactly once.';
  END IF;

  -- Cash tender/change and shift totals remain immutable on replay.
  v_result := public.create_pos_sale(
    v_warehouse, v_branch, NULL, 'زبون نقدي', 'cash',
    jsonb_build_array(jsonb_build_object('product_id', v_product_b, 'quantity', 1)),
    0, 600, 'pos-idempotency-cash-0000000001'
  );
  SELECT public.get_cash_shift_summary(id) INTO v_shift_summary
  FROM public.cash_shifts WHERE branch_id = v_branch AND status = 'open';
  v_shift_cash_before := (v_shift_summary->>'cashSalesInMinorUnits')::BIGINT;
  v_result := public.create_pos_sale(
    v_warehouse, v_branch, NULL, 'زبون نقدي', 'cash',
    jsonb_build_array(jsonb_build_object('product_id', v_product_b, 'quantity', 1)),
    0, 600, 'pos-idempotency-cash-0000000001'
  );
  IF (v_result->>'changeDueInMinorUnits')::BIGINT <> 100
    OR v_shift_cash_before <> 500
  THEN
    RAISE EXCEPTION 'Cash replay changed cash/change reconciliation.';
  END IF;
  SELECT public.get_cash_shift_summary(id) INTO v_shift_summary
  FROM public.cash_shifts WHERE branch_id = v_branch AND status = 'open';
  IF (v_shift_summary->>'cashSalesInMinorUnits')::BIGINT <> v_shift_cash_before
    OR (v_shift_summary->>'expectedCashInMinorUnits')::BIGINT <> 500
  THEN
    RAISE EXCEPTION 'Cash replay changed the canonical shift summary.';
  END IF;
  BEGIN
    PERFORM public.create_pos_sale(
      v_warehouse, v_branch, NULL, 'زبون نقدي', 'cash',
      jsonb_build_array(jsonb_build_object('product_id', v_product_b, 'quantity', 1)),
      0, 700, 'pos-idempotency-cash-0000000001'
    );
    RAISE EXCEPTION 'Changed cash tender unexpectedly succeeded.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'IDEMPOTENCY_CONFLICT:%' THEN RAISE; END IF;
  END;
  INSERT INTO pos_idempotency_results VALUES (
    'cash_reconciliation',
    jsonb_build_object('cash_sales', v_shift_cash_before, 'change_due', 100)
  );

  -- Debt replay returns the original unpaid command result even if the order
  -- may later receive separately audited customer payments.
  v_result := public.create_pos_sale(
    v_warehouse, v_branch,
    '91100000-0000-0000-0000-000000000050',
    'عميل اختبار ذمة POS', 'debt',
    jsonb_build_array(jsonb_build_object('product_id', v_product_c, 'quantity', 1)),
    0, 0, 'pos-idempotency-debt-0000000001'
  );
  v_result := public.create_pos_sale(
    v_warehouse, v_branch,
    '91100000-0000-0000-0000-000000000050',
    'عميل اختبار ذمة POS', 'debt',
    jsonb_build_array(jsonb_build_object('product_id', v_product_c, 'quantity', 1)),
    0, 0, 'pos-idempotency-debt-0000000001'
  );
  IF (v_result->>'paymentStatus') <> 'unpaid'
    OR (v_result->>'amountPaidInMinorUnits')::BIGINT <> 0
  THEN
    RAISE EXCEPTION 'Debt replay did not preserve the original command result.';
  END IF;
  INSERT INTO pos_idempotency_results VALUES (
    'receivable_reconciliation',
    jsonb_build_object('total', 900, 'paid', 0, 'due', 900)
  );

  -- A failing multi-line sale must leave no order or inventory movement.
  SELECT count(*) INTO v_before_orders FROM public.orders;
  SELECT count(*) INTO v_before_movements FROM public.inventory_movements;
  BEGIN
    PERFORM public.create_pos_sale(
      v_warehouse, v_branch, NULL, 'زبون نقدي', 'cliq',
      jsonb_build_array(
        jsonb_build_object('product_id', v_product_a, 'quantity', 1),
        jsonb_build_object('product_id', v_product_b, 'quantity', 1000)
      ),
      0, 0, 'pos-idempotency-rollback-000001'
    );
    RAISE EXCEPTION 'Insufficient-stock sale unexpectedly succeeded.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'المتاح من المنتج%' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.orders) <> v_before_orders
    OR (SELECT count(*) FROM public.inventory_movements) <> v_before_movements
    OR EXISTS (
      SELECT 1 FROM public.orders
      WHERE idempotency_key = 'pos-idempotency-rollback-000001'
    )
  THEN
    RAISE EXCEPTION 'Failed POS sale left a partial business effect.';
  END IF;
  INSERT INTO pos_idempotency_results VALUES (
    'failure_rollback', jsonb_build_object('partial_effects', 0)
  );

  -- Line order is presentation-only. Canonical product identity and package
  -- quantity make an equivalent reordered cart the same logical request.
  v_result := public.create_pos_sale(
    v_warehouse, v_branch, NULL, 'زبون نقدي', 'cliq',
    jsonb_build_array(
      jsonb_build_object('product_id', v_product_a, 'quantity', 1),
      jsonb_build_object('product_id', v_product_b, 'quantity', 2)
    ),
    0, 0, v_canonical_key
  );
  v_original_result := v_result;
  v_order_id := (v_result->>'orderId')::UUID;

  v_result := public.create_pos_sale(
    v_warehouse, v_branch, NULL, 'زبون نقدي', 'cliq',
    jsonb_build_array(
      jsonb_build_object('product_id', v_product_b, 'quantity', 2),
      jsonb_build_object('product_id', v_product_a, 'quantity', 1)
    ),
    0, 0, v_canonical_key
  );

  IF NOT (v_result->>'idempotentReplay')::BOOLEAN
    OR (v_result->>'orderId')::UUID <> v_order_id
    OR (v_result - 'idempotentReplay')
      IS DISTINCT FROM (v_original_result - 'idempotentReplay')
    OR (SELECT count(*) FROM public.orders
        WHERE idempotency_key = v_canonical_key) <> 1
    OR (SELECT count(*) FROM public.order_items
        WHERE order_id = v_order_id) <> 2
    OR (SELECT count(*) FROM public.inventory_movements
        WHERE reference_id = v_order_id) <> 2
    OR (SELECT count(*) FROM public.audit_logs
        WHERE entity_id = v_order_id) <> 2
  THEN
    RAISE EXCEPTION 'Canonical line ordering did not produce a read-only replay.';
  END IF;

  INSERT INTO pos_idempotency_results VALUES (
    'canonical_line_order',
    jsonb_build_object('orders', 1, 'items', 2, 'movements', 2)
  );
END $$;

SELECT jsonb_build_object(
  'ok', true,
  'scenarios', jsonb_agg(
    jsonb_build_object('name', scenario, 'details', details)
    ORDER BY scenario
  )
) AS pos_idempotency_runtime_summary
FROM pos_idempotency_results;

COMMIT;
