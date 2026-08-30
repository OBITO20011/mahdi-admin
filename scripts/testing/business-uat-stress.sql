-- Nawasrah ERP automated business UAT. Runs only in the disposable local
-- Supabase project created by business-uat-stress.mjs. No production data.
\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE uat_operation_results (
  operation_no integer PRIMARY KEY,
  operation_kind text NOT NULL,
  expected_result text NOT NULL,
  actual_result text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('passed', 'expected_safe_failure')),
  severity text NOT NULL DEFAULT 'none',
  details jsonb NOT NULL DEFAULT '{}'::jsonb
) ON COMMIT PRESERVE ROWS;

CREATE TEMP TABLE uat_inventory_start (
  warehouse_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity integer NOT NULL,
  PRIMARY KEY (warehouse_id, product_id)
) ON COMMIT PRESERVE ROWS;

DO $$
DECLARE
  v_owner uuid := '71000000-0000-0000-0000-000000000001';
  v_cashier uuid := '71000000-0000-0000-0000-000000000002';
  v_owner_role uuid;
  v_cashier_role uuid;
  v_branch uuid := '71000000-0000-0000-0000-000000000010';
  v_empty_branch uuid := '71000000-0000-0000-0000-000000000011';
  v_wh_a uuid := '71000000-0000-0000-0000-000000000020';
  v_wh_b uuid := '71000000-0000-0000-0000-000000000021';
  v_category uuid := '71000000-0000-0000-0000-000000000030';
  v_unit_piece uuid := '71000000-0000-0000-0000-000000000040';
  v_unit_carton uuid := '71000000-0000-0000-0000-000000000041';
  v_supplier uuid := '71000000-0000-0000-0000-000000000050';
  v_customer uuid := '71000000-0000-0000-0000-000000000060';
  v_product_low uuid := '71000000-0000-0000-0000-000000000071';
  v_product_micro uuid := '71000000-0000-0000-0000-000000000072';
  v_product_mid uuid := '71000000-0000-0000-0000-000000000073';
  v_product_high uuid := '71000000-0000-0000-0000-000000000074';
BEGIN
  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_owner, 'authenticated', 'authenticated', 'uat-owner@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_cashier, 'authenticated', 'authenticated', 'uat-cashier@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, full_name, is_active)
  VALUES (v_owner, 'مالك اختبار UAT', true), (v_cashier, 'كاشير اختبار UAT', true)
  ON CONFLICT (id) DO UPDATE SET is_active = true;

  INSERT INTO public.roles (code, name_ar) VALUES
    ('owner', 'مالك النظام'), ('cashier', 'كاشير')
  ON CONFLICT (code) DO NOTHING;
  SELECT id INTO v_owner_role FROM public.roles WHERE code = 'owner';
  SELECT id INTO v_cashier_role FROM public.roles WHERE code = 'cashier';
  INSERT INTO public.user_roles (user_id, role_id) VALUES
    (v_owner, v_owner_role), (v_cashier, v_cashier_role)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.branches (id, code, name_ar, is_active) VALUES
    (v_branch, 'UAT-BR-01', 'فرع اختبار UAT', true),
    (v_empty_branch, 'UAT-BR-EMPTY', 'فرع اختبار وردية فارغة', true)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.warehouses (id, branch_id, code, name_ar, is_active) VALUES
    (v_wh_a, v_branch, 'UAT-WH-A', 'مستودع UAT أ', true),
    (v_wh_b, v_branch, 'UAT-WH-B', 'مستودع UAT ب', true)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.categories (id, code, name_ar, is_active)
  VALUES (v_category, 'UAT-CAT', 'قسم اختبار UAT', true)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.units (id, code, name_ar) VALUES
    (v_unit_piece, 'UAT-PCS', 'قطعة'), (v_unit_carton, 'UAT-CTN', 'كرتونة')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.suppliers (id, company_name, current_balance_in_minor_units)
  VALUES (v_supplier, 'مورد اختبار UAT', 0)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.customers (id, full_name, phone, customer_type, credit_limit_in_minor_units)
  VALUES (v_customer, 'عميل اختبار UAT', '0790000001', 'wholesale', 999999999)
  ON CONFLICT (id) DO UPDATE SET credit_limit_in_minor_units = EXCLUDED.credit_limit_in_minor_units;

  INSERT INTO public.products (
    id, sku, name_ar, category_id, unit_id, purchase_unit_id, sale_unit_id,
    units_per_purchase_unit, units_per_sale_unit, default_sale_price_in_minor_units,
    cost_price_in_minor_units, sale_price_in_minor_units, wholesale_price_in_minor_units,
    min_stock_level, is_active
  ) VALUES
    (v_product_low, 'UAT-001', 'منتج UAT فلس واحد', v_category, v_unit_piece, v_unit_carton, v_unit_carton, 1, 1, 1, 0, 1, 1, 1, true),
    (v_product_micro, 'UAT-005', 'منتج UAT خمسة فلوس', v_category, v_unit_piece, v_unit_carton, v_unit_carton, 1, 1, 5, 1, 5, 5, 1, true),
    (v_product_mid, 'UAT-1275', 'منتج UAT دينار و275', v_category, v_unit_piece, v_unit_carton, v_unit_carton, 10, 10, 1275, 100, 128, 1275, 10, true),
    (v_product_high, 'UAT-19999', 'منتج UAT 19.999', v_category, v_unit_piece, v_unit_carton, v_unit_carton, 10, 10, 19999, 1500, 2000, 19999, 10, true)
  ON CONFLICT (id) DO UPDATE SET is_active = true;

  INSERT INTO public.inventory_balances (warehouse_id, product_id, on_hand_quantity, reserved_quantity) VALUES
    (v_wh_a, v_product_low, 500, 0), (v_wh_a, v_product_micro, 500, 0),
    (v_wh_a, v_product_mid, 1500, 0), (v_wh_a, v_product_high, 1000, 0),
    (v_wh_b, v_product_low, 0, 0), (v_wh_b, v_product_micro, 0, 0),
    (v_wh_b, v_product_mid, 0, 0), (v_wh_b, v_product_high, 0, 0)
  ON CONFLICT (warehouse_id, product_id) DO UPDATE SET on_hand_quantity = EXCLUDED.on_hand_quantity, reserved_quantity = 0;
END $$;

INSERT INTO uat_inventory_start (warehouse_id, product_id, quantity)
SELECT warehouse_id, product_id, on_hand_quantity
FROM public.inventory_balances
WHERE warehouse_id IN ('71000000-0000-0000-0000-000000000020', '71000000-0000-0000-0000-000000000021')
  AND product_id IN (
    '71000000-0000-0000-0000-000000000071', '71000000-0000-0000-0000-000000000072',
    '71000000-0000-0000-0000-000000000073', '71000000-0000-0000-0000-000000000074'
  );

SELECT set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $$
DECLARE
  v_branch uuid := '71000000-0000-0000-0000-000000000010';
  v_empty_branch uuid := '71000000-0000-0000-0000-000000000011';
  v_wh_a uuid := '71000000-0000-0000-0000-000000000020';
  v_wh_b uuid := '71000000-0000-0000-0000-000000000021';
  p_low uuid := '71000000-0000-0000-0000-000000000071';
  p_micro uuid := '71000000-0000-0000-0000-000000000072';
  p_mid uuid := '71000000-0000-0000-0000-000000000073';
  p_high uuid := '71000000-0000-0000-0000-000000000074';
  v_supplier uuid := '71000000-0000-0000-0000-000000000050';
  v_customer uuid := '71000000-0000-0000-0000-000000000060';
  v_shift_id uuid;
  v_empty_shift_id uuid;
  v_order_id uuid;
  v_result jsonb;
  v_payment_id uuid;
  v_receipt_id uuid;
  v_po_id uuid;
  v_expense_id uuid;
  v_web_orders uuid[] := '{}';
  v_debt_orders uuid[] := '{}';
  v_ops integer := 0;
  i integer;
  v_error text;
  v_expected_cash bigint;
  v_payment_amount bigint;
BEGIN
  -- 1: Open the operating shift.
  v_result := public.open_cash_shift(v_branch, 50000);
  v_shift_id := (v_result->>'id')::uuid;
  v_ops := v_ops + 1;
  INSERT INTO uat_operation_results VALUES (v_ops, 'open_shift', 'Open one cash shift', 'success', 'passed', 'none', v_result);

  -- 2-41: realistic cash, CliQ, credit and precision wholesale POS sales.
  FOR i IN 1..40 LOOP
    v_result := public.create_pos_sale(
      v_wh_a, v_branch, CASE WHEN i % 3 = 0 THEN v_customer ELSE NULL END,
      CASE WHEN i % 3 = 0 THEN 'عميل اختبار UAT' ELSE 'زبون نقدي UAT' END,
      CASE WHEN i % 3 = 1 THEN 'cash' WHEN i % 3 = 2 THEN 'cliq' ELSE 'debt' END,
      jsonb_build_array(jsonb_build_object(
        'product_id', CASE (i % 4) WHEN 1 THEN p_low WHEN 2 THEN p_micro WHEN 3 THEN p_mid ELSE p_high END,
        'quantity', CASE WHEN i % 4 IN (1,2) THEN 1 ELSE 2 END
      )),
      CASE WHEN i IN (4, 8, 12, 16) THEN 1 WHEN i = 20 THEN 5 ELSE 0 END,
      0,
      'uat-pos-' || lpad(i::text, 4, '0') || '-key-000000000000'
    );
    IF NOT COALESCE((v_result->>'success')::boolean, false) THEN RAISE EXCEPTION 'POS sale % failed: %', i, v_result; END IF;
    IF i % 3 = 0 THEN v_debt_orders := array_append(v_debt_orders, (v_result->>'orderId')::uuid); END IF;
    v_ops := v_ops + 1;
    INSERT INTO uat_operation_results VALUES (v_ops, 'pos_sale', 'POS sale via canonical RPC', 'success', 'passed', 'none', v_result);
  END LOOP;

  -- 42-81: eight customer-web workflows: create -> confirm -> prepare -> ready -> paid completion.
  FOR i IN 1..8 LOOP
    v_result := public.create_customer_order(
      'عميل متجر UAT ' || i, '0791000' || lpad(i::text, 3, '0'), NULL,
      'Irbid', 'Ramtha', 'UAT', 'Test street', '1', NULL, NULL, NULL,
      NULL, NULL, 'UAT address', NULL, 'manual', v_branch, v_wh_a,
      jsonb_build_array(jsonb_build_object('product_id', CASE WHEN i % 2 = 0 THEN p_mid ELSE p_high END, 'quantity', 1)),
      0, CASE WHEN i = 1 THEN 1 ELSE 0 END, 'UAT storefront order', NULL, 'website'
    );
    v_order_id := (v_result->>'order_id')::uuid;
    IF v_order_id IS NULL THEN RAISE EXCEPTION 'Customer order % did not return an id.', i; END IF;
    v_ops := v_ops + 1; INSERT INTO uat_operation_results VALUES (v_ops, 'storefront_order', 'Create wholesale customer order', 'success', 'passed', 'none', v_result);
    PERFORM public.update_order_status(v_order_id, 'confirmed', 'UAT confirm');
    v_ops := v_ops + 1; INSERT INTO uat_operation_results VALUES (v_ops, 'order_confirm', 'Confirm customer order', 'success', 'passed', 'none', jsonb_build_object('order_id', v_order_id));
    PERFORM public.update_order_status(v_order_id, 'preparing', 'UAT prepare');
    v_ops := v_ops + 1; INSERT INTO uat_operation_results VALUES (v_ops, 'order_prepare', 'Prepare customer order', 'success', 'passed', 'none', jsonb_build_object('order_id', v_order_id));
    PERFORM public.update_order_status(v_order_id, 'ready', 'UAT ready');
    v_ops := v_ops + 1; INSERT INTO uat_operation_results VALUES (v_ops, 'order_ready', 'Ready customer order', 'success', 'passed', 'none', jsonb_build_object('order_id', v_order_id));
    v_result := public.complete_website_order_with_payment(v_order_id, CASE WHEN i % 2 = 0 THEN 'cliq' ELSE 'cash' END, CASE WHEN i % 2 = 0 THEN 'UAT-CLIQ-' || i ELSE NULL END, 'UAT completion');
    IF NOT COALESCE((v_result->>'success')::boolean, false) THEN RAISE EXCEPTION 'Website completion % failed.', i; END IF;
    v_web_orders := array_append(v_web_orders, v_order_id);
    v_ops := v_ops + 1; INSERT INTO uat_operation_results VALUES (v_ops, 'storefront_completion', 'Collect and complete customer order', 'success', 'passed', 'none', v_result);
  END LOOP;

  -- 82-87: collect two credit sales; replay the first key; reverse one payment once.
  FOR i IN 1..2 LOOP
    SELECT GREATEST(1, LEAST(1000, total_in_minor_units / 2))
    INTO v_payment_amount
    FROM public.orders WHERE id = v_debt_orders[i];
    v_result := public.record_customer_order_payment_once(v_debt_orders[i], v_payment_amount, CASE WHEN i = 1 THEN 'cash' ELSE 'cliq' END, CASE WHEN i = 2 THEN 'UAT-CP-CLIQ' ELSE NULL END, 'UAT customer receipt', 'uat-customer-payment-key-' || i || '-000000000000');
    v_payment_id := (v_result->>'payment_id')::uuid;
    IF v_payment_id IS NULL THEN RAISE EXCEPTION 'Customer payment % failed.', i; END IF;
    v_ops := v_ops + 1; INSERT INTO uat_operation_results VALUES (v_ops, 'customer_payment', 'Record idempotent customer payment', 'success', 'passed', 'none', v_result);
    IF i = 1 THEN
      v_result := public.record_customer_order_payment_once(v_debt_orders[i], v_payment_amount, 'cash', NULL, 'UAT replay', 'uat-customer-payment-key-1-000000000000');
      IF NOT COALESCE((v_result->>'idempotent')::boolean, false) THEN RAISE EXCEPTION 'Customer-payment replay was not idempotent.'; END IF;
      v_ops := v_ops + 1; INSERT INTO uat_operation_results VALUES (v_ops, 'customer_payment_retry', 'Same idempotency key returns same receipt', 'idempotent replay', 'passed', 'none', v_result);
      v_result := public.reverse_customer_order_payment(v_payment_id, 'UAT reversal of first receipt');
      v_ops := v_ops + 1; INSERT INTO uat_operation_results VALUES (v_ops, 'customer_payment_reversal', 'Reverse active customer payment', 'success', 'passed', 'none', v_result);
      BEGIN
        PERFORM public.reverse_customer_order_payment(v_payment_id, 'duplicate reversal');
        RAISE EXCEPTION 'Customer-payment double reversal was allowed.';
      EXCEPTION WHEN OTHERS THEN
        v_error := SQLERRM;
        IF v_error = 'Customer-payment double reversal was allowed.' THEN RAISE; END IF;
        v_ops := v_ops + 1; INSERT INTO uat_operation_results VALUES (v_ops, 'customer_payment_double_reversal', 'Reject second reversal', v_error, 'expected_safe_failure', 'none', '{}'::jsonb);
      END;
    END IF;
  END LOOP;

  -- 88-95: five supplier receipts and three protected supplier payments.
  FOR i IN 1..5 LOOP
    v_result := public.create_direct_supplier_receipt(
      v_supplier, v_wh_a, v_branch, 'UAT-INV-' || i, current_date, now(), 0, 0, 0, 0,
      'cash', NULL, 'UAT supplier receipt', NULL,
      ('71000000-0000-0000-0000-' || lpad((100 + i)::text, 12, '0'))::uuid,
      jsonb_build_array(jsonb_build_object('product_id', CASE WHEN i % 2 = 0 THEN p_mid ELSE p_high END, 'package_quantity', 2, 'units_per_package', 10, 'package_price_in_minor_units', 8000, 'discount_in_minor_units', 0, 'update_product_defaults', false))
    );
    v_receipt_id := (v_result->>'receipt_id')::uuid;
    IF v_receipt_id IS NULL THEN RAISE EXCEPTION 'Supplier receipt % failed: %', i, v_result; END IF;
    v_ops := v_ops + 1; INSERT INTO uat_operation_results VALUES (v_ops, 'supplier_receipt', 'Receive supplier goods through canonical RPC', 'success', 'passed', 'none', v_result);
    IF i <= 3 THEN
      v_result := public.record_supplier_receipt_payment(v_receipt_id, 1000, CASE WHEN i % 2 = 0 THEN 'cliq' ELSE 'cash' END, CASE WHEN i % 2 = 0 THEN 'UAT-SP-CLIQ-' || i ELSE NULL END, 'UAT supplier payment', 'uat-supplier-receipt-payment-key-' || i || '-000000000');
      IF NOT COALESCE((v_result->>'success')::boolean, false) THEN RAISE EXCEPTION 'Supplier payment % failed.', i; END IF;
      v_ops := v_ops + 1; INSERT INTO uat_operation_results VALUES (v_ops, 'supplier_payment', 'Record supplier receipt payment', 'success', 'passed', 'none', v_result);
      IF i = 1 THEN
        v_result := public.record_supplier_receipt_payment(v_receipt_id, 1000, 'cash', NULL, 'UAT retry', 'uat-supplier-receipt-payment-key-1-000000000');
        IF NOT COALESCE((v_result->>'idempotent')::boolean, false) THEN RAISE EXCEPTION 'Supplier payment retry was not idempotent.'; END IF;
        v_ops := v_ops + 1; INSERT INTO uat_operation_results VALUES (v_ops, 'supplier_payment_retry', 'Same supplier-payment key is idempotent', 'idempotent replay', 'passed', 'none', v_result);
      END IF;
    END IF;
  END LOOP;

  -- 96-101: purchase orders, cash/CliQ expenses, then audited reversals.
  FOR i IN 1..3 LOOP
    v_result := public.create_purchase_order(v_supplier, v_branch, v_wh_a, now() + interval '1 day', 0, 0, 'UAT-PO-' || i, 'UAT purchase order', NULL, jsonb_build_array(jsonb_build_object('product_id', p_mid, 'ordered_quantity', 10, 'purchase_price_in_minor_units', 1000, 'discount_in_minor_units', 0)));
    v_po_id := (v_result->>'purchase_order_id')::uuid;
    IF v_po_id IS NULL THEN RAISE EXCEPTION 'Purchase order % failed.', i; END IF;
    v_ops := v_ops + 1; INSERT INTO uat_operation_results VALUES (v_ops, 'purchase_order', 'Create purchase order', 'success', 'passed', 'none', v_result);
  END LOOP;
  FOR i IN 1..3 LOOP
    v_result := public.create_operational_expense(v_branch, 'UAT expense', 'مصروف UAT ' || i, CASE WHEN i = 3 THEN 5 ELSE 1000 * i END, CASE WHEN i = 2 THEN 'cliq' ELSE 'cash' END, CASE WHEN i = 2 THEN 'UAT-EXP-CLIQ' ELSE NULL END);
    v_expense_id := (v_result->>'expenseId')::uuid;
    v_ops := v_ops + 1; INSERT INTO uat_operation_results VALUES (v_ops, 'operational_expense', 'Record operating expense', 'success', 'passed', 'none', v_result);
    IF i = 1 THEN
      v_result := public.reverse_operational_expense(v_expense_id, 'UAT reverse expense');
      v_ops := v_ops + 1; INSERT INTO uat_operation_results VALUES (v_ops, 'expense_reversal', 'Reverse active expense', 'success', 'passed', 'none', v_result);
      BEGIN
        PERFORM public.reverse_operational_expense(v_expense_id, 'duplicate');
        RAISE EXCEPTION 'Expense double reversal was allowed.';
      EXCEPTION WHEN OTHERS THEN
        v_error := SQLERRM;
        IF v_error = 'Expense double reversal was allowed.' THEN RAISE; END IF;
        v_ops := v_ops + 1; INSERT INTO uat_operation_results VALUES (v_ops, 'expense_double_reversal', 'Reject second expense reversal', v_error, 'expected_safe_failure', 'none', '{}'::jsonb);
      END;
    END IF;
  END LOOP;

  -- 102-109: transfers, official stock counts and two full returns.
  FOR i IN 1..3 LOOP
    v_result := public.transfer_inventory_between_warehouses(CASE WHEN i = 1 THEN p_mid WHEN i = 2 THEN p_high ELSE p_micro END, v_wh_a, v_wh_b, i, 'UAT transfer ' || i, now());
    v_ops := v_ops + 1; INSERT INTO uat_operation_results VALUES (v_ops, 'warehouse_transfer', 'Transfer stock with locks', 'success', 'passed', 'none', v_result);
  END LOOP;
  FOR i IN 1..3 LOOP
    v_result := public.adjust_inventory_stock(v_wh_a, CASE WHEN i = 1 THEN p_low WHEN i = 2 THEN p_micro ELSE p_mid END, (SELECT on_hand_quantity + CASE WHEN i = 2 THEN -1 ELSE 1 END FROM public.inventory_balances WHERE warehouse_id = v_wh_a AND product_id = CASE WHEN i = 1 THEN p_low WHEN i = 2 THEN p_micro ELSE p_mid END), 'UAT stock count ' || i, 'stock_count');
    v_ops := v_ops + 1; INSERT INTO uat_operation_results VALUES (v_ops, 'stock_count_adjustment', 'Official stock-count adjustment', 'success', 'passed', 'none', v_result);
  END LOOP;
  FOR i IN 1..2 LOOP
    v_result := public.return_completed_website_order(v_web_orders[i], 'UAT full sales return', 'restock', CASE WHEN i = 1 THEN 'cash' ELSE 'cliq' END, CASE WHEN i = 2 THEN 'UAT-RETURN-CLIQ' ELSE NULL END, 'UAT return');
    IF NOT COALESCE((v_result->>'success')::boolean, false) THEN RAISE EXCEPTION 'Sales return % failed.', i; END IF;
    v_ops := v_ops + 1; INSERT INTO uat_operation_results VALUES (v_ops, 'full_sales_return', 'Full return with refund and stock disposition', 'success', 'passed', 'none', v_result);
  END LOOP;

  -- 110-114: intentional safe rejections.
  BEGIN
    PERFORM public.create_pos_sale(v_wh_a, v_branch, NULL, 'UAT oversell', 'cash', jsonb_build_array(jsonb_build_object('product_id', p_low, 'quantity', 999999)), 0, 0, 'uat-oversell-key-0000000000000');
    RAISE EXCEPTION 'Oversell was allowed.';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM; IF v_error = 'Oversell was allowed.' THEN RAISE; END IF;
    v_ops := v_ops + 1; INSERT INTO uat_operation_results VALUES (v_ops, 'oversell_rejection', 'Reject sale above available stock', v_error, 'expected_safe_failure', 'none', '{}'::jsonb);
  END;
  BEGIN
    PERFORM public.cancel_empty_cash_shift(v_shift_id, 'UAT should reject active shift');
    RAISE EXCEPTION 'Active shift cancellation was allowed.';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM; IF v_error = 'Active shift cancellation was allowed.' THEN RAISE; END IF;
    v_ops := v_ops + 1; INSERT INTO uat_operation_results VALUES (v_ops, 'active_shift_cancellation', 'Reject cancellation of shift with operations', v_error, 'expected_safe_failure', 'none', '{}'::jsonb);
  END;
  PERFORM set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000002', true);
  BEGIN
    PERFORM public.create_operational_expense(v_branch, 'UAT forbidden', 'Cashier must not create this', 1, 'cash', NULL);
    RAISE EXCEPTION 'Cashier expense was allowed.';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM; IF v_error = 'Cashier expense was allowed.' THEN RAISE; END IF;
    v_ops := v_ops + 1; INSERT INTO uat_operation_results VALUES (v_ops, 'rbac_rejection', 'Reject privileged operation for cashier', v_error, 'expected_safe_failure', 'none', '{}'::jsonb);
  END;
  PERFORM set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
  v_result := public.create_direct_supplier_receipt(v_supplier, v_wh_a, v_branch, 'UAT-WAC', current_date, now(), 0,0,0,0,'cash',NULL,'UAT WAC receipt',NULL,'71000000-0000-0000-0000-000000000199',jsonb_build_array(jsonb_build_object('product_id',p_low,'package_quantity',1,'units_per_package',1,'package_price_in_minor_units',2)));
  v_receipt_id := (v_result->>'receipt_id')::uuid;
  PERFORM public.adjust_inventory_stock(v_wh_a, p_low, (SELECT on_hand_quantity + 1 FROM public.inventory_balances WHERE warehouse_id=v_wh_a AND product_id=p_low), 'UAT later movement', 'manual');
  BEGIN
    PERFORM public.cancel_supplier_receipt(v_receipt_id, 'must reject after movement');
    RAISE EXCEPTION 'Unsafe supplier receipt cancellation was allowed.';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM; IF v_error = 'Unsafe supplier receipt cancellation was allowed.' THEN RAISE; END IF;
    v_ops := v_ops + 1; INSERT INTO uat_operation_results VALUES (v_ops, 'wac_rejection', 'Reject supplier receipt cancellation after movement/WAC', v_error, 'expected_safe_failure', 'none', '{}'::jsonb);
  END;

  -- 115-116: a successful empty-shift lifecycle and final reconciliation/close.
  v_result := public.open_cash_shift(v_empty_branch, 1000); v_empty_shift_id := (v_result->>'id')::uuid;
  v_ops := v_ops + 1; INSERT INTO uat_operation_results VALUES (v_ops, 'open_empty_shift', 'Open second empty test shift', 'success', 'passed', 'none', v_result);
  v_result := public.cancel_empty_cash_shift(v_empty_shift_id, 'UAT empty shift cancellation');
  v_ops := v_ops + 1; INSERT INTO uat_operation_results VALUES (v_ops, 'cancel_empty_shift', 'Cancel empty shift with audit', 'success', 'passed', 'none', v_result);
  v_expected_cash := (public.get_cash_shift_summary(v_shift_id)->>'expectedCashInMinorUnits')::bigint;
  v_result := public.close_cash_shift(v_shift_id, v_expected_cash, NULL);
  v_ops := v_ops + 1; INSERT INTO uat_operation_results VALUES (v_ops, 'close_shift', 'Close shift with reconciled expected cash', 'success', 'passed', 'none', v_result);

  IF v_ops < 100 THEN RAISE EXCEPTION 'UAT executed only % operations, expected at least 100.', v_ops; END IF;
END $$;

-- Independent reconciliation checks performed as DB owner after the workflows.
DO $$
DECLARE
  v_bad_inventory integer;
  v_negative integer;
  v_bad_movements integer;
  v_customer_mismatch integer;
  v_supplier_mismatch integer;
  v_cash_mismatch integer;
  v_cliq_mismatch integer;
  v_duplicate_keys integer;
  v_bad_profit integer;
BEGIN
  SELECT count(*) INTO v_bad_inventory
  FROM uat_inventory_start s
  JOIN public.inventory_balances b ON b.warehouse_id=s.warehouse_id AND b.product_id=s.product_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(m.quantity),0)::integer AS delta
    FROM public.inventory_movements m
    WHERE m.warehouse_id=s.warehouse_id AND m.product_id=s.product_id
      AND m.created_by='71000000-0000-0000-0000-000000000001'
  ) d ON true
  WHERE s.quantity + d.delta <> b.on_hand_quantity;
  IF v_bad_inventory <> 0 THEN RAISE EXCEPTION 'Inventory reconciliation mismatch on % balances.', v_bad_inventory; END IF;

  SELECT count(*) INTO v_negative FROM public.inventory_balances
  WHERE warehouse_id IN ('71000000-0000-0000-0000-000000000020','71000000-0000-0000-0000-000000000021')
    AND on_hand_quantity < 0;
  IF v_negative <> 0 THEN RAISE EXCEPTION 'Negative stock was recorded.'; END IF;

  SELECT count(*) INTO v_bad_movements FROM public.inventory_movements
  WHERE created_by='71000000-0000-0000-0000-000000000001'
    AND balance_after <> balance_before + quantity;
  IF v_bad_movements <> 0 THEN RAISE EXCEPTION 'Inventory movements have invalid before/after balances.'; END IF;

  SELECT count(*) INTO v_customer_mismatch
  FROM public.orders o
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(cp.amount_in_minor_units) FILTER (WHERE cp.is_reversed=false),0)::bigint AS paid
    FROM public.customer_payments cp WHERE cp.order_id=o.id
  ) cp ON true
  WHERE o.customer_id='71000000-0000-0000-0000-000000000060'
    AND o.payment_method='debt'
    AND o.amount_paid_in_minor_units <> cp.paid;
  IF v_customer_mismatch <> 0 THEN RAISE EXCEPTION 'Customer payment balance mismatch.'; END IF;

  SELECT count(*) INTO v_supplier_mismatch
  FROM public.suppliers s
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(sr.amount_due_in_minor_units),0)::bigint AS due
    FROM public.supplier_receipts sr WHERE sr.supplier_id=s.id AND sr.status='completed'
  ) r ON true
  WHERE s.id='71000000-0000-0000-0000-000000000050'
    AND s.current_balance_in_minor_units <> r.due;
  IF v_supplier_mismatch <> 0 THEN RAISE EXCEPTION 'Supplier balance mismatch.'; END IF;

  SELECT count(*) INTO v_cash_mismatch
  FROM public.cash_shifts WHERE branch_id='71000000-0000-0000-0000-000000000010'
    AND status='closed' AND actual_cash_in_minor_units <> expected_cash_in_minor_units;
  IF v_cash_mismatch <> 0 THEN RAISE EXCEPTION 'Cash shift reconciliation mismatch.'; END IF;
  SELECT count(*) INTO v_cliq_mismatch
  FROM public.cash_shifts WHERE branch_id='71000000-0000-0000-0000-000000000010'
    AND cliq_sales_in_minor_units < 0;
  IF v_cliq_mismatch <> 0 THEN RAISE EXCEPTION 'CliQ reconciliation became invalid.'; END IF;

  SELECT count(*) INTO v_duplicate_keys FROM (
    SELECT created_by,idempotency_scope,idempotency_key FROM public.supplier_payments
    WHERE idempotency_key IS NOT NULL GROUP BY 1,2,3 HAVING count(*)>1
  ) duplicates;
  IF v_duplicate_keys <> 0 THEN RAISE EXCEPTION 'Duplicate supplier idempotency keys found.'; END IF;

  SELECT count(*) INTO v_bad_profit
  FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id
  WHERE o.cash_shift_id IS NOT NULL
    AND oi.line_total_in_minor_units <> oi.cogs_in_minor_units + oi.profit_in_minor_units;
  IF v_bad_profit <> 0 THEN RAISE EXCEPTION 'COGS/profit arithmetic mismatch.'; END IF;
END $$;

SELECT jsonb_build_object(
  'planned_operations', 117,
  'executed_operations', (SELECT count(*) FROM uat_operation_results),
  'passed', (SELECT count(*) FROM uat_operation_results WHERE outcome='passed'),
  'expected_safe_failures', (SELECT count(*) FROM uat_operation_results WHERE outcome='expected_safe_failure'),
  'unexpected_failures', 0,
  'inventory_reconciliation', 'pass',
  'customer_balances', 'pass',
  'supplier_balances', 'pass',
  'cash', 'pass',
  'cliq', 'pass',
  'sales_profit_discount_cogs', 'pass',
  'returns_reversals', 'pass',
  'idempotency', 'pass',
  'concurrency', 'pending_separate_subset'
) AS business_uat_summary;

COMMIT;
