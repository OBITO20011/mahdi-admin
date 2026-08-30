-- Runtime integration coverage for migration 083. This script is destructive
-- only inside the disposable isolated Supabase project.
\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE reversal_runtime_results (
  scenario TEXT PRIMARY KEY,
  outcome TEXT NOT NULL CHECK (outcome IN ('pass', 'expected_blocked')),
  details JSONB NOT NULL DEFAULT '{}'::JSONB
) ON COMMIT PRESERVE ROWS;

DO $$
DECLARE
  v_owner UUID := '83000000-0000-0000-0000-000000000001';
  v_cashier UUID := '83000000-0000-0000-0000-000000000002';
  v_view_only UUID := '83000000-0000-0000-0000-000000000003';
  v_owner_role UUID;
  v_cashier_role UUID;
  v_view_role UUID;
  v_branch UUID := '83000000-0000-0000-0000-000000000010';
  v_warehouse UUID := '83000000-0000-0000-0000-000000000020';
  v_category UUID := '83000000-0000-0000-0000-000000000030';
  v_unit UUID := '83000000-0000-0000-0000-000000000040';
  v_supplier UUID := '83000000-0000-0000-0000-000000000050';
  v_customer UUID := '83000000-0000-0000-0000-000000000060';
  p_fils UUID := '83000000-0000-0000-0000-000000000071';
  p_five UUID := '83000000-0000-0000-0000-000000000072';
  p_1275 UUID := '83000000-0000-0000-0000-000000000073';
  p_19999 UUID := '83000000-0000-0000-0000-000000000074';
  p_flavor UUID := '83000000-0000-0000-0000-000000000075';
  p_blocked UUID := '83000000-0000-0000-0000-000000000076';
  p_supplier UUID := '83000000-0000-0000-0000-000000000077';
  p_retry UUID := '83000000-0000-0000-0000-000000000078';
  p_concurrent UUID := '83000000-0000-0000-0000-000000000079';
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_owner, 'authenticated', 'authenticated', 'reversal-owner@example.test', NOW(), '{}'::JSONB, '{}'::JSONB, NOW(), NOW()),
    (v_cashier, 'authenticated', 'authenticated', 'reversal-cashier@example.test', NOW(), '{}'::JSONB, '{}'::JSONB, NOW(), NOW()),
    (v_view_only, 'authenticated', 'authenticated', 'reversal-view@example.test', NOW(), '{}'::JSONB, '{}'::JSONB, NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, full_name, is_active) VALUES
    (v_owner, 'مالك اختبار العكس', true),
    (v_cashier, 'كاشير اختبار العكس', true),
    (v_view_only, 'مشاهد اختبار العكس', true)
  ON CONFLICT (id) DO UPDATE SET is_active = true;

  INSERT INTO public.roles (code, name_ar) VALUES
    ('owner', 'مالك النظام'), ('cashier', 'كاشير'), ('view_only', 'مشاهدة فقط')
  ON CONFLICT (code) DO NOTHING;
  SELECT id INTO v_owner_role FROM public.roles WHERE code = 'owner';
  SELECT id INTO v_cashier_role FROM public.roles WHERE code = 'cashier';
  SELECT id INTO v_view_role FROM public.roles WHERE code = 'view_only';
  INSERT INTO public.user_roles (user_id, role_id) VALUES
    (v_owner, v_owner_role), (v_cashier, v_cashier_role), (v_view_only, v_view_role)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.branches (id, code, name_ar, is_active)
  VALUES (v_branch, 'REV-BR-01', 'فرع اختبار العكس', true)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.warehouses (id, branch_id, code, name_ar, is_active)
  VALUES (v_warehouse, v_branch, 'REV-WH-01', 'مستودع اختبار العكس', true)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.categories (id, code, name_ar, is_active)
  VALUES (v_category, 'REV-CAT', 'قسم اختبار العكس', true)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.units (id, code, name_ar)
  VALUES (v_unit, 'REV-PCS', 'قطعة')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.suppliers (id, company_name, current_balance_in_minor_units)
  VALUES (v_supplier, 'مورد اختبار العكس', 0)
  ON CONFLICT (id) DO UPDATE SET current_balance_in_minor_units = 0;
  INSERT INTO public.customers (id, full_name, phone, customer_type, credit_limit_in_minor_units)
  VALUES (v_customer, 'عميل اختبار العكس', '0793000001', 'wholesale', 999999999)
  ON CONFLICT (id) DO UPDATE SET credit_limit_in_minor_units = EXCLUDED.credit_limit_in_minor_units;

  INSERT INTO public.products (
    id, sku, name_ar, category_id, unit_id, purchase_unit_id, sale_unit_id,
    units_per_purchase_unit, units_per_sale_unit, default_sale_price_in_minor_units,
    cost_price_in_minor_units, sale_price_in_minor_units, wholesale_price_in_minor_units,
    min_stock_level, is_active, flavor_master_product_id, flavor_name_ar, is_flavor_master
  ) VALUES
    (p_fils, 'REV-001', 'صنف فلس', v_category, v_unit, v_unit, v_unit, 1, 1, 1, 0, 1, 1, 1, true, NULL, NULL, false),
    (p_five, 'REV-005', 'صنف خمسة فلوس', v_category, v_unit, v_unit, v_unit, 1, 1, 5, 1, 5, 5, 1, true, NULL, NULL, false),
    (p_1275, 'REV-1275', 'شيبس اختبار', v_category, v_unit, v_unit, v_unit, 1, 1, 1275, 100, 1275, 1275, 1, true, NULL, NULL, true),
    (p_19999, 'REV-19999', 'صنف 19.999', v_category, v_unit, v_unit, v_unit, 1, 1, 19999, 1500, 19999, 19999, 1, true, NULL, NULL, false),
    (p_flavor, 'REV-1275-SPICY', 'شيبس اختبار حار', v_category, v_unit, v_unit, v_unit, 1, 1, 1275, 100, 1275, 1275, 1, true, p_1275, 'حار', false),
    (p_blocked, 'REV-BLOCK', 'صنف حركة لاحقة', v_category, v_unit, v_unit, v_unit, 1, 1, 100, 10, 100, 100, 1, true, NULL, NULL, false),
    (p_supplier, 'REV-SUP', 'صنف مورد', v_category, v_unit, v_unit, v_unit, 1, 1, 500, 100, 500, 500, 1, true, NULL, NULL, false),
    (p_retry, 'REV-RETRY', 'صنف إعادة الشبكة', v_category, v_unit, v_unit, v_unit, 1, 1, 500, 100, 500, 500, 1, true, NULL, NULL, false),
    (p_concurrent, 'REV-CONCURRENT', 'صنف التزامن', v_category, v_unit, v_unit, v_unit, 1, 1, 500, 100, 500, 500, 1, true, NULL, NULL, false)
  ON CONFLICT (id) DO UPDATE SET is_active = true;

  INSERT INTO public.inventory_balances (warehouse_id, product_id, on_hand_quantity, reserved_quantity)
  SELECT v_warehouse, product_id, 100, 0
  FROM unnest(ARRAY[p_fils, p_five, p_1275, p_19999, p_flavor, p_blocked, p_supplier, p_retry, p_concurrent]) AS product_id
  ON CONFLICT (warehouse_id, product_id)
  DO UPDATE SET on_hand_quantity = EXCLUDED.on_hand_quantity, reserved_quantity = 0;
END $$;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);

DO $$
DECLARE
  v_branch UUID := '83000000-0000-0000-0000-000000000010';
  v_warehouse UUID := '83000000-0000-0000-0000-000000000020';
  v_supplier UUID := '83000000-0000-0000-0000-000000000050';
  v_customer UUID := '83000000-0000-0000-0000-000000000060';
  p_fils UUID := '83000000-0000-0000-0000-000000000071';
  p_five UUID := '83000000-0000-0000-0000-000000000072';
  p_1275 UUID := '83000000-0000-0000-0000-000000000073';
  p_19999 UUID := '83000000-0000-0000-0000-000000000074';
  p_flavor UUID := '83000000-0000-0000-0000-000000000075';
  p_blocked UUID := '83000000-0000-0000-0000-000000000076';
  p_supplier UUID := '83000000-0000-0000-0000-000000000077';
  p_retry UUID := '83000000-0000-0000-0000-000000000078';
  p_concurrent UUID := '83000000-0000-0000-0000-000000000079';
  v_result JSONB;
  v_order UUID;
  v_blocked_order UUID;
  v_receipt UUID;
  v_purchase_order UUID;
  v_payment UUID;
  v_cliq_payment UUID;
  v_before INTEGER;
  v_after INTEGER;
  v_supplier_before BIGINT;
  v_error TEXT;
  v_shift_id UUID;
  v_shift_summary JSONB;
  v_report JSONB;
BEGIN
  PERFORM public.open_cash_shift(v_branch, 0);

  -- Cash sale, 0.001 JOD, stock and cash restore.
  SELECT on_hand_quantity INTO v_before FROM public.inventory_balances WHERE warehouse_id=v_warehouse AND product_id=p_fils;
  v_result := public.create_pos_sale(v_warehouse, v_branch, NULL, 'نقد اختبار', 'cash', jsonb_build_array(jsonb_build_object('product_id', p_fils, 'quantity', 1)), 0, 0, 'rev-pos-cash-sale-key-000000000001');
  v_order := (v_result->>'orderId')::UUID;
  v_result := public.reverse_pos_sale(v_order, 'عكس بيع نقدي تجريبي', 'rev-pos-cash-reversal-key-000000001');
  IF NOT COALESCE((v_result->>'success')::BOOLEAN, false) OR COALESCE((v_result->>'idempotent')::BOOLEAN, true) THEN RAISE EXCEPTION 'Cash POS reversal failed.'; END IF;
  SELECT on_hand_quantity INTO v_after FROM public.inventory_balances WHERE warehouse_id=v_warehouse AND product_id=p_fils;
  IF v_after <> v_before OR NOT EXISTS (SELECT 1 FROM public.orders WHERE id=v_order AND status='cancelled' AND amount_paid_in_minor_units=0) THEN RAISE EXCEPTION 'Cash reversal reconciliation failed.'; END IF;
  INSERT INTO reversal_runtime_results VALUES ('cash_pos_precision_001', 'pass', v_result);

  -- CliQ sale, 0.005 JOD.
  SELECT on_hand_quantity INTO v_before FROM public.inventory_balances WHERE warehouse_id=v_warehouse AND product_id=p_five;
  v_result := public.create_pos_sale(v_warehouse, v_branch, NULL, 'CliQ اختبار', 'cliq', jsonb_build_array(jsonb_build_object('product_id', p_five, 'quantity', 1)), 0, 0, 'rev-pos-cliq-sale-key-000000000001');
  v_order := (v_result->>'orderId')::UUID;
  v_result := public.reverse_pos_sale(v_order, 'عكس بيع CliQ تجريبي', 'rev-pos-cliq-reversal-key-000000001');
  SELECT on_hand_quantity INTO v_after FROM public.inventory_balances WHERE warehouse_id=v_warehouse AND product_id=p_five;
  IF v_after <> v_before OR (v_result->'actual_effect'->>'cliq_in_minor_units')::BIGINT <> 5 THEN RAISE EXCEPTION 'CliQ reversal reconciliation failed.'; END IF;
  INSERT INTO reversal_runtime_results VALUES ('cliq_pos_precision_005', 'pass', v_result);

  -- Credit sale, 1.275 JOD, returns the receivable to zero by cancelling its source order.
  SELECT on_hand_quantity INTO v_before FROM public.inventory_balances WHERE warehouse_id=v_warehouse AND product_id=p_1275;
  v_result := public.create_pos_sale(v_warehouse, v_branch, v_customer, 'عميل آجل', 'debt', jsonb_build_array(jsonb_build_object('product_id', p_1275, 'quantity', 1)), 0, 0, 'rev-pos-credit-sale-key-00000000001');
  v_order := (v_result->>'orderId')::UUID;
  v_result := public.reverse_pos_sale(v_order, 'عكس بيع آجل تجريبي', 'rev-pos-credit-reversal-key-0000001');
  SELECT on_hand_quantity INTO v_after FROM public.inventory_balances WHERE warehouse_id=v_warehouse AND product_id=p_1275;
  IF v_after <> v_before OR EXISTS (SELECT 1 FROM public.orders WHERE id=v_order AND status='completed') THEN RAISE EXCEPTION 'Credit reversal reconciliation failed.'; END IF;
  INSERT INTO reversal_runtime_results VALUES ('credit_pos_precision_1275', 'pass', v_result);

  -- Multi-line sale with flavor and a discount at 19.999 JOD precision.
  SELECT on_hand_quantity INTO v_before FROM public.inventory_balances WHERE warehouse_id=v_warehouse AND product_id=p_19999;
  v_result := public.create_pos_sale(v_warehouse, v_branch, NULL, 'متعدد الأصناف', 'cash', jsonb_build_array(jsonb_build_object('product_id', p_19999, 'quantity', 1), jsonb_build_object('product_id', p_flavor, 'quantity', 1)), 1000, 0, 'rev-pos-multi-sale-key-000000000001');
  v_order := (v_result->>'orderId')::UUID;
  v_result := public.reverse_pos_sale(v_order, 'عكس بيع متعدد مع خصم', 'rev-pos-multi-reversal-key-00000001');
  SELECT on_hand_quantity INTO v_after FROM public.inventory_balances WHERE warehouse_id=v_warehouse AND product_id=p_19999;
  IF v_after <> v_before OR NOT EXISTS (SELECT 1 FROM public.inventory_movements WHERE reference_type='pos_sale_reversal' AND reference_id=(v_result->>'reversal_id')::UUID) THEN RAISE EXCEPTION 'Multi-item flavor reversal failed.'; END IF;
  INSERT INTO reversal_runtime_results VALUES ('multi_item_flavor_discount_precision_19999', 'pass', v_result);

  -- Same-key retry returns the same completed reversal; a new key cannot reverse twice.
  v_result := public.create_pos_sale(v_warehouse, v_branch, NULL, 'إعادة محاولة', 'cash', jsonb_build_array(jsonb_build_object('product_id', p_retry, 'quantity', 1)), 0, 0, 'rev-pos-retry-sale-key-000000000001');
  v_order := (v_result->>'orderId')::UUID;
  v_result := public.reverse_pos_sale(v_order, 'عكس مع إعادة شبكة', 'rev-pos-retry-reversal-key-00000001');
  v_result := public.reverse_pos_sale(v_order, 'إعادة شبكة', 'rev-pos-retry-reversal-key-00000001');
  IF NOT COALESCE((v_result->>'idempotent')::BOOLEAN, false) THEN RAISE EXCEPTION 'POS retry was not idempotent.'; END IF;
  INSERT INTO reversal_runtime_results VALUES ('pos_network_retry_same_key', 'pass', v_result);
  BEGIN
    PERFORM public.reverse_pos_sale(v_order, 'عكس مكرر بمفتاح مختلف', 'rev-pos-other-reversal-key-00000001');
    RAISE EXCEPTION 'POS double reversal was allowed.';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
    IF v_error = 'POS double reversal was allowed.' THEN RAISE; END IF;
    INSERT INTO reversal_runtime_results VALUES ('pos_double_reversal', 'expected_blocked', jsonb_build_object('error', v_error));
  END;

  -- A movement after a sale must leave every target unchanged when blocked.
  v_result := public.create_pos_sale(v_warehouse, v_branch, NULL, 'حركة لاحقة', 'cash', jsonb_build_array(jsonb_build_object('product_id', p_blocked, 'quantity', 1)), 0, 0, 'rev-pos-block-sale-key-000000000001');
  v_blocked_order := (v_result->>'orderId')::UUID;
  SELECT on_hand_quantity INTO v_before FROM public.inventory_balances WHERE warehouse_id=v_warehouse AND product_id=p_blocked;
  PERFORM public.adjust_inventory_stock(v_warehouse, p_blocked, v_before + 1, 'حركة لاحقة تمنع عكس البيع', 'manual');
  SELECT on_hand_quantity INTO v_before FROM public.inventory_balances WHERE warehouse_id=v_warehouse AND product_id=p_blocked;
  BEGIN
    PERFORM public.reverse_pos_sale(v_blocked_order, 'يجب أن يفشل بعد حركة لاحقة', 'rev-pos-block-reversal-key-00000001');
    RAISE EXCEPTION 'Dependent POS reversal was allowed.';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
    IF v_error = 'Dependent POS reversal was allowed.' THEN RAISE; END IF;
    SELECT on_hand_quantity INTO v_after FROM public.inventory_balances WHERE warehouse_id=v_warehouse AND product_id=p_blocked;
    IF v_after <> v_before OR NOT EXISTS (SELECT 1 FROM public.orders WHERE id=v_blocked_order AND status='completed') OR EXISTS (SELECT 1 FROM public.pos_sale_reversals WHERE order_id=v_blocked_order) THEN RAISE EXCEPTION 'Blocked POS reversal left partial effects.'; END IF;
    INSERT INTO reversal_runtime_results VALUES ('pos_later_inventory_dependency_zero_partial', 'expected_blocked', jsonb_build_object('error', v_error));
  END;

  -- Supplier receipt payment in cash restores the receipt payable and supplier balance.
  v_result := public.create_direct_supplier_receipt(v_supplier, v_warehouse, v_branch, 'REV-CASH-INV', CURRENT_DATE, NOW(), 0, 0, 0, 0, 'cash', NULL, 'اختبار مورد كاش', NULL, '83000000-0000-0000-0000-000000000101', jsonb_build_array(jsonb_build_object('product_id', p_supplier, 'package_quantity', 1, 'units_per_package', 1, 'package_price_in_minor_units', 500, 'discount_in_minor_units', 0, 'update_product_defaults', false)));
  v_receipt := (v_result->>'receipt_id')::UUID;
  SELECT current_balance_in_minor_units INTO v_supplier_before FROM public.suppliers WHERE id=v_supplier;
  v_result := public.record_supplier_receipt_payment(v_receipt, 500, 'cash', NULL, 'دفعة مورد كاش', 'rev-supplier-cash-payment-key-000001');
  v_payment := (v_result->>'payment_id')::UUID;
  v_result := public.reverse_supplier_payment(v_payment, 'عكس دفعة مورد كاش', 'rev-supplier-cash-reversal-key-0001');
  IF (SELECT amount_due_in_minor_units FROM public.supplier_receipts WHERE id=v_receipt) <> 500 OR (SELECT current_balance_in_minor_units FROM public.suppliers WHERE id=v_supplier) <> v_supplier_before OR NOT EXISTS (SELECT 1 FROM public.supplier_payments WHERE id=v_payment AND is_reversed) THEN RAISE EXCEPTION 'Cash supplier-payment reversal reconciliation failed.'; END IF;
  INSERT INTO reversal_runtime_results VALUES ('supplier_cash_payment_reversal', 'pass', v_result);

  -- CliQ supplier payment uses the same financial source without mixing cash.
  v_result := public.create_direct_supplier_receipt(v_supplier, v_warehouse, v_branch, 'REV-CLIQ-INV', CURRENT_DATE, NOW(), 0, 0, 0, 0, 'cash', NULL, 'اختبار مورد CliQ', NULL, '83000000-0000-0000-0000-000000000102', jsonb_build_array(jsonb_build_object('product_id', p_supplier, 'package_quantity', 1, 'units_per_package', 1, 'package_price_in_minor_units', 1275, 'discount_in_minor_units', 0, 'update_product_defaults', false)));
  v_receipt := (v_result->>'receipt_id')::UUID;
  v_result := public.record_supplier_receipt_payment(v_receipt, 1275, 'cliq', 'REV-CLIQ-REF', 'دفعة مورد CliQ', 'rev-supplier-cliq-payment-key-00001');
  v_payment := (v_result->>'payment_id')::UUID;
  v_cliq_payment := v_payment;
  v_result := public.reverse_supplier_payment(v_payment, 'عكس دفعة مورد CliQ', 'rev-supplier-cliq-reversal-key-0001');
  IF (v_result->'actual_effect'->>'cliq_in_minor_units')::BIGINT <> 1275 THEN RAISE EXCEPTION 'CliQ supplier-payment effect is wrong.'; END IF;
  INSERT INTO reversal_runtime_results VALUES ('supplier_cliq_payment_reversal', 'pass', v_result);

  -- Purchase-order payment has no supplier-current-balance mutation in the
  -- canonical payment path, but it must restore its own paid amount and cash.
  v_result := public.create_purchase_order(
    v_supplier, v_branch, v_warehouse, NOW() + INTERVAL '1 day', 0, 0,
    'REV-PO-INV', 'اختبار أمر شراء', NULL,
    jsonb_build_array(jsonb_build_object(
      'product_id', p_supplier,
      'ordered_quantity', 1,
      'purchase_price_in_minor_units', 500,
      'discount_in_minor_units', 0
    ))
  );
  v_purchase_order := (v_result->>'purchase_order_id')::UUID;
  v_result := public.record_supplier_payment(
    v_supplier, v_purchase_order, 500, 'cash', NULL, NOW(),
    'دفعة أمر شراء كاش', 'rev-supplier-po-payment-key-00000001'
  );
  v_payment := (v_result->>'payment_id')::UUID;
  v_result := public.reverse_supplier_payment(
    v_payment, 'عكس دفعة أمر شراء كاش', 'rev-supplier-po-reversal-key-000001'
  );
  IF (SELECT amount_paid_in_minor_units FROM public.purchase_orders WHERE id=v_purchase_order) <> 0
    OR (v_result->'actual_effect'->>'cash_in_minor_units')::BIGINT <> 500
    OR NOT EXISTS (SELECT 1 FROM public.supplier_payments WHERE id=v_payment AND is_reversed)
  THEN
    RAISE EXCEPTION 'Purchase-order supplier-payment reversal reconciliation failed.';
  END IF;
  INSERT INTO reversal_runtime_results VALUES ('supplier_purchase_order_cash_payment_reversal', 'pass', v_result);

  -- Same key is a safe replay; a different key cannot reverse again.
  v_result := public.reverse_supplier_payment(v_cliq_payment, 'إعادة شبكة مورد', 'rev-supplier-cliq-reversal-key-0001');
  IF NOT COALESCE((v_result->>'idempotent')::BOOLEAN, false) THEN RAISE EXCEPTION 'Supplier retry was not idempotent.'; END IF;
  INSERT INTO reversal_runtime_results VALUES ('supplier_network_retry_same_key', 'pass', v_result);
  BEGIN
    PERFORM public.reverse_supplier_payment(v_cliq_payment, 'عكس مكرر مورد', 'rev-supplier-other-reversal-key-0001');
    RAISE EXCEPTION 'Supplier double reversal was allowed.';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
    IF v_error = 'Supplier double reversal was allowed.' THEN RAISE; END IF;
    INSERT INTO reversal_runtime_results VALUES ('supplier_double_reversal', 'expected_blocked', jsonb_build_object('error', v_error));
  END;

  -- Security: strict AAL2 and owner-only, before any mutation is attempted.
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',
    true
  );
  BEGIN
    PERFORM public.reverse_pos_sale(v_blocked_order, 'AAL1 يجب أن يرفض', 'rev-security-aal1-key-000000000001');
    RAISE EXCEPTION 'Owner AAL1 was allowed.';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
    IF v_error = 'Owner AAL1 was allowed.' THEN RAISE; END IF;
    INSERT INTO reversal_runtime_results VALUES ('owner_aal1_denied', 'expected_blocked', jsonb_build_object('error', v_error));
  END;
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"83000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',
    true
  );
  BEGIN
    PERFORM public.reverse_pos_sale(v_blocked_order, 'كاشير يجب أن يرفض', 'rev-security-cashier-key-0000000001');
    RAISE EXCEPTION 'Cashier was allowed.';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
    IF v_error = 'Cashier was allowed.' THEN RAISE; END IF;
    INSERT INTO reversal_runtime_results VALUES ('cashier_denied', 'expected_blocked', jsonb_build_object('error', v_error));
  END;
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"83000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',
    true
  );
  BEGIN
    PERFORM public.reverse_supplier_payment(v_payment, 'مشاهدة فقط يجب أن ترفض', 'rev-security-view-key-000000000001');
    RAISE EXCEPTION 'View-only was allowed.';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
    IF v_error = 'View-only was allowed.' THEN RAISE; END IF;
    INSERT INTO reversal_runtime_results VALUES ('view_only_denied', 'expected_blocked', jsonb_build_object('error', v_error));
  END;
  PERFORM set_config('request.jwt.claims', '{"role":"anon","aal":"aal2"}', true);
  BEGIN
    PERFORM public.reverse_pos_sale(v_blocked_order, 'مجهول يجب أن يرفض', 'rev-security-anon-key-000000000001');
    RAISE EXCEPTION 'Anonymous was allowed.';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
    IF v_error = 'Anonymous was allowed.' THEN RAISE; END IF;
    INSERT INTO reversal_runtime_results VALUES ('anonymous_denied', 'expected_blocked', jsonb_build_object('error', v_error));
  END;

  -- Restore owner AAL2 and leave two fresh records for the separate concurrent tests.
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',
    true
  );
  v_result := public.create_pos_sale(v_warehouse, v_branch, NULL, 'تزامن POS', 'cash', jsonb_build_array(jsonb_build_object('product_id', p_concurrent, 'quantity', 1)), 0, 0, 'rev-pos-concurrent-sale-key-000000001');
  INSERT INTO reversal_runtime_results VALUES ('concurrent_pos_fixture', 'pass', v_result);
  v_result := public.create_direct_supplier_receipt(v_supplier, v_warehouse, v_branch, 'REV-CONCURRENT-INV', CURRENT_DATE, NOW(), 0, 0, 0, 0, 'cash', NULL, 'مورد للتزامن', NULL, '83000000-0000-0000-0000-000000000103', jsonb_build_array(jsonb_build_object('product_id', p_supplier, 'package_quantity', 1, 'units_per_package', 1, 'package_price_in_minor_units', 500, 'discount_in_minor_units', 0, 'update_product_defaults', false)));
  v_receipt := (v_result->>'receipt_id')::UUID;
  v_result := public.record_supplier_receipt_payment(v_receipt, 500, 'cash', NULL, 'دفعة مورد للتزامن', 'rev-supplier-concurrent-payment-key-001');
  INSERT INTO reversal_runtime_results VALUES ('concurrent_supplier_fixture', 'pass', v_result);

  -- All reversed POS sales must be absent from the canonical sales/COGS/profit
  -- report, while the intentionally blocked sale and fresh concurrency fixture
  -- remain. Cash and CliQ must remain independently reconciled in the shift.
  SELECT id INTO v_shift_id
  FROM public.cash_shifts
  WHERE branch_id = v_branch AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;
  v_shift_summary := public.get_cash_shift_summary(v_shift_id);
  IF (v_shift_summary->>'cashSalesInMinorUnits')::BIGINT <> 600
    OR (v_shift_summary->>'cliqSalesInMinorUnits')::BIGINT <> 0
    OR (v_shift_summary->>'cashSupplierPaymentsInMinorUnits')::BIGINT <> 500
    OR (v_shift_summary->>'cliqSupplierPaymentsInMinorUnits')::BIGINT <> 0
    OR (v_shift_summary->>'expectedCashInMinorUnits')::BIGINT <> 100
  THEN
    RAISE EXCEPTION 'Cash/CliQ reconciliation retained a reversed operation.';
  END IF;
  v_report := public.get_operational_business_report(
    v_branch,
    (NOW() AT TIME ZONE 'Asia/Amman')::DATE,
    (NOW() AT TIME ZONE 'Asia/Amman')::DATE
  );
  IF (v_report->'sales'->>'grossSalesInMinorUnits')::BIGINT <> 600
    OR (v_report->'sales'->>'cogsInMinorUnits')::BIGINT <> 110
    OR (v_report->'sales'->>'grossProfitInMinorUnits')::BIGINT <> 490
    OR (v_report->'sales'->>'discountInMinorUnits')::BIGINT <> 0
    OR (v_report->'balances'->>'customerDueInMinorUnits')::BIGINT <> 0
  THEN
    RAISE EXCEPTION 'POS reversal did not fully reconcile the canonical report or customer balance.';
  END IF;
  INSERT INTO reversal_runtime_results VALUES ('cash_cliq_customer_cogs_profit_reconciliation', 'pass', jsonb_build_object('shift', v_shift_summary, 'sales', v_report->'sales'));

  -- Independent active-source reconciliation before the concurrent subset.
  IF EXISTS (
    SELECT 1 FROM public.inventory_movements im
    WHERE im.reference_type='pos_sale_reversal'
      AND im.balance_after < im.balance_before
  ) THEN RAISE EXCEPTION 'POS reversal inventory movement direction is invalid.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.source='pos' AND o.status='cancelled'
      AND o.amount_paid_in_minor_units <> 0
  ) THEN RAISE EXCEPTION 'Cancelled POS order retained a paid balance.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.suppliers s
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(sr.amount_due_in_minor_units), 0)::BIGINT AS due
      FROM public.supplier_receipts sr
      WHERE sr.supplier_id=s.id AND sr.status='completed'
    ) balances ON true
    WHERE s.id=v_supplier AND s.current_balance_in_minor_units <> balances.due
  ) THEN RAISE EXCEPTION 'Supplier balance is not reconciled after payment reversals.'; END IF;
  IF (SELECT COUNT(*) FROM public.audit_logs WHERE action IN ('REVERSE_POS_SALE', 'REVERSE_SUPPLIER_PAYMENT')) < 6 THEN
    RAISE EXCEPTION 'Expected reversal audit records were not written.';
  END IF;
  INSERT INTO reversal_runtime_results VALUES ('independent_reconciliation_before_concurrency', 'pass', '{}'::JSONB);
END $$;

SELECT jsonb_build_object(
  'runtime_scenarios', (SELECT COUNT(*) FROM reversal_runtime_results),
  'passed', (SELECT COUNT(*) FROM reversal_runtime_results WHERE outcome='pass'),
  'expected_blocked', (SELECT COUNT(*) FROM reversal_runtime_results WHERE outcome='expected_blocked'),
  'unexpected_failures', 0,
  'scenarios', (SELECT jsonb_agg(jsonb_build_object('name', scenario, 'outcome', outcome) ORDER BY scenario) FROM reversal_runtime_results)
) AS reversal_primitives_runtime_summary;

COMMIT;
