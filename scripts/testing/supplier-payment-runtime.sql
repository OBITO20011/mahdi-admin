-- Runs only against the temporary isolated Supabase project created by
-- scripts/testing/bootstrap-isolated-supabase.mjs. The final ROLLBACK keeps
-- the runtime fixture and all attempted direct writes out of the test DB.

BEGIN;

DO $$
DECLARE
  v_owner UUID := '10000000-0000-0000-0000-000000000001';
  v_cashier UUID := '10000000-0000-0000-0000-000000000002';
  v_view_only UUID := '10000000-0000-0000-0000-000000000003';
  v_supplier UUID := '20000000-0000-0000-0000-000000000001';
  v_branch UUID := '20000000-0000-0000-0000-000000000002';
  v_warehouse UUID := '20000000-0000-0000-0000-000000000003';
  v_purchase_order UUID := '20000000-0000-0000-0000-000000000004';
  v_purchase_order_item UUID := '20000000-0000-0000-0000-000000000005';
  v_purchase_receipt UUID := '20000000-0000-0000-0000-000000000006';
  v_purchase_receipt_item UUID := '20000000-0000-0000-0000-000000000007';
  v_supplier_receipt UUID := '20000000-0000-0000-0000-000000000008';
  v_supplier_payment UUID := '20000000-0000-0000-0000-000000000009';
  v_owner_role UUID;
  v_cashier_role UUID;
  v_view_only_role UUID;
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, email_confirmed_at, raw_app_meta_data,
    raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_owner, 'authenticated', 'authenticated', 'runtime-owner@example.test', NOW(), '{}'::JSONB, '{}'::JSONB, NOW(), NOW()),
    (v_cashier, 'authenticated', 'authenticated', 'runtime-cashier@example.test', NOW(), '{}'::JSONB, '{}'::JSONB, NOW(), NOW()),
    (v_view_only, 'authenticated', 'authenticated', 'runtime-view-only@example.test', NOW(), '{}'::JSONB, '{}'::JSONB, NOW(), NOW());

  INSERT INTO public.profiles (id, full_name, is_active) VALUES
    (v_owner, 'Runtime Owner', true),
    (v_cashier, 'Runtime Cashier', true),
    (v_view_only, 'Runtime View Only', true);

  INSERT INTO public.roles (code, name_ar) VALUES
    ('owner', 'مالك النظام'),
    ('cashier', 'كاشير'),
    ('view_only', 'عرض فقط')
  ON CONFLICT (code) DO NOTHING;

  SELECT id INTO v_owner_role FROM public.roles WHERE code = 'owner';
  SELECT id INTO v_cashier_role FROM public.roles WHERE code = 'cashier';
  SELECT id INTO v_view_only_role FROM public.roles WHERE code = 'view_only';

  INSERT INTO public.user_roles (user_id, role_id) VALUES
    (v_owner, v_owner_role),
    (v_cashier, v_cashier_role),
    (v_view_only, v_view_only_role);

  INSERT INTO public.branches (id, code, name_ar) VALUES
    (v_branch, 'RUNTIME-BRANCH', 'فرع اختبار الدفع');
  INSERT INTO public.warehouses (id, branch_id, code, name_ar) VALUES
    (v_warehouse, v_branch, 'RUNTIME-WAREHOUSE', 'مستودع اختبار الدفع');
  INSERT INTO public.suppliers (id, company_name, current_balance_in_minor_units) VALUES
    (v_supplier, 'مورد اختبار الدفع', 2000);

  INSERT INTO public.purchase_orders (
    id, purchase_order_number, supplier_id, branch_id, warehouse_id,
    total_in_minor_units, amount_paid_in_minor_units
  ) VALUES (
    v_purchase_order, 'RUNTIME-PO-001', v_supplier, v_branch, v_warehouse,
    10000, 0
  );
  INSERT INTO public.purchase_order_items (
    id, purchase_order_id, ordered_quantity, purchase_price_in_minor_units,
    line_total_in_minor_units
  ) VALUES (
    v_purchase_order_item, v_purchase_order, 1, 10000, 10000
  );
  INSERT INTO public.purchase_receipts (
    id, receipt_number, purchase_order_id, supplier_id, warehouse_id
  ) VALUES (
    v_purchase_receipt, 'RUNTIME-PR-001', v_purchase_order, v_supplier, v_warehouse
  );
  INSERT INTO public.purchase_receipt_items (
    id, purchase_receipt_id, purchase_order_item_id, received_quantity,
    unit_cost_in_minor_units
  ) VALUES (
    v_purchase_receipt_item, v_purchase_receipt, v_purchase_order_item, 1, 10000
  );
  INSERT INTO public.supplier_receipts (
    id, receipt_number, supplier_id, warehouse_id, branch_id, received_by,
    total_in_minor_units, amount_paid_in_minor_units, amount_due_in_minor_units,
    payment_status, status
  ) VALUES (
    v_supplier_receipt, 'RUNTIME-SR-001', v_supplier, v_warehouse, v_branch, v_owner,
    2000, 0, 2000, 'unpaid', 'completed'
  );
  INSERT INTO public.supplier_payments (
    id, supplier_id, amount_in_minor_units, payment_method, created_by
  ) VALUES (
    v_supplier_payment, v_supplier, 1, 'bank', v_owner
  );
END;
$$;

-- Production currently grants these API table privileges to authenticated.
-- Grant them only inside this rolled-back test transaction so the following
-- checks exercise RLS policy denial rather than a missing table grant.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.purchase_orders,
  public.purchase_order_items,
  public.purchase_receipts,
  public.purchase_receipt_items,
  public.supplier_payments
TO authenticated;

-- Use an active owner identity through the same authenticated role and JWT
-- claim mechanism used by PostgREST. Both calls are real RPC executions.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $$
DECLARE
  v_po_first JSONB;
  v_po_retry JSONB;
  v_receipt_first JSONB;
  v_receipt_retry JSONB;
BEGIN
  v_po_first := public.record_supplier_payment(
    '20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000004',
    1000,
    'bank',
    'RUNTIME-PO-REF',
    NOW(),
    'runtime idempotency test',
    'runtime-supplier-po-payment-key-0001'
  );
  v_po_retry := public.record_supplier_payment(
    '20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000004',
    1000,
    'bank',
    'RUNTIME-PO-REF',
    NOW(),
    'runtime idempotency test retry',
    'runtime-supplier-po-payment-key-0001'
  );

  IF COALESCE((v_po_first->>'idempotent')::BOOLEAN, true)
    OR NOT COALESCE((v_po_retry->>'idempotent')::BOOLEAN, false)
    OR (v_po_first->>'payment_id') IS DISTINCT FROM (v_po_retry->>'payment_id')
  THEN
    RAISE EXCEPTION 'Purchase-order supplier payment retry was not idempotent.';
  END IF;

  v_receipt_first := public.record_supplier_receipt_payment(
    '20000000-0000-0000-0000-000000000008',
    500,
    'bank',
    'RUNTIME-SR-REF',
    'runtime idempotency test',
    'runtime-supplier-receipt-payment-key-0001'
  );
  v_receipt_retry := public.record_supplier_receipt_payment(
    '20000000-0000-0000-0000-000000000008',
    500,
    'bank',
    'RUNTIME-SR-REF',
    'runtime idempotency test retry',
    'runtime-supplier-receipt-payment-key-0001'
  );

  IF COALESCE((v_receipt_first->>'idempotent')::BOOLEAN, true)
    OR NOT COALESCE((v_receipt_retry->>'idempotent')::BOOLEAN, false)
    OR (v_receipt_first->>'payment_id') IS DISTINCT FROM (v_receipt_retry->>'payment_id')
  THEN
    RAISE EXCEPTION 'Supplier-receipt payment retry was not idempotent.';
  END IF;

END;
$$;

-- Inspect the durable rows as the test database owner, outside the simulated
-- browser role. This verifies that the retry did not change a balance twice.
RESET ROLE;
DO $$
DECLARE
  v_payment_count INTEGER;
  v_amount_paid BIGINT;
  v_receipt_paid BIGINT;
  v_receipt_due BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_payment_count
  FROM public.supplier_payments
  WHERE idempotency_scope = 'purchase_order_payment'
    AND idempotency_key = 'runtime-supplier-po-payment-key-0001';
  SELECT amount_paid_in_minor_units INTO v_amount_paid
  FROM public.purchase_orders
  WHERE id = '20000000-0000-0000-0000-000000000004';
  IF v_payment_count <> 1 OR v_amount_paid <> 1000 THEN
    RAISE EXCEPTION 'Purchase-order supplier payment retry changed the ledger twice.';
  END IF;

  SELECT COUNT(*) INTO v_payment_count
  FROM public.supplier_payments
  WHERE idempotency_scope = 'supplier_receipt_payment'
    AND idempotency_key = 'runtime-supplier-receipt-payment-key-0001';
  SELECT amount_paid_in_minor_units, amount_due_in_minor_units
  INTO v_receipt_paid, v_receipt_due
  FROM public.supplier_receipts
  WHERE id = '20000000-0000-0000-0000-000000000008';
  IF v_payment_count <> 1 OR v_receipt_paid <> 500 OR v_receipt_due <> 1500 THEN
    RAISE EXCEPTION 'Supplier-receipt payment retry changed the ledger twice.';
  END IF;
END;
$$;

-- Runtime RLS verification. Both restricted roles have valid profiles and a
-- real role assignment, but no mutation policy exists for these documents.
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_role_code TEXT;
  v_table_name TEXT;
  v_row_id UUID;
  v_updated INTEGER;
  v_deleted INTEGER;
BEGIN
  FOREACH v_role_code IN ARRAY ARRAY[
    '10000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000003'
  ]
  LOOP
    PERFORM set_config('request.jwt.claim.sub', v_role_code, true);

    FOR v_table_name, v_row_id IN
      SELECT * FROM (VALUES
        ('purchase_orders', '20000000-0000-0000-0000-000000000004'::UUID),
        ('purchase_order_items', '20000000-0000-0000-0000-000000000005'::UUID),
        ('purchase_receipts', '20000000-0000-0000-0000-000000000006'::UUID),
        ('purchase_receipt_items', '20000000-0000-0000-0000-000000000007'::UUID),
        ('supplier_payments', '20000000-0000-0000-0000-000000000009'::UUID)
      ) AS protected_rows(table_name, row_id)
    LOOP
      BEGIN
        EXECUTE format('UPDATE public.%I SET id = id WHERE id = $1', v_table_name)
        USING v_row_id;
        GET DIAGNOSTICS v_updated = ROW_COUNT;
        IF v_updated <> 0 THEN
          RAISE EXCEPTION 'Direct UPDATE was allowed for role % on %.', v_role_code, v_table_name;
        END IF;
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;

      BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE id = $1', v_table_name)
        USING v_row_id;
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
        IF v_deleted <> 0 THEN
          RAISE EXCEPTION 'Direct DELETE was allowed for role % on %.', v_role_code, v_table_name;
        END IF;
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
    END LOOP;

    BEGIN
      INSERT INTO public.purchase_orders (purchase_order_number, supplier_id)
      VALUES ('RUNTIME-DIRECT-PO-' || v_role_code, '20000000-0000-0000-0000-000000000001');
      RAISE EXCEPTION 'Direct INSERT was allowed for role % on purchase_orders.', v_role_code;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
      INSERT INTO public.purchase_order_items (
        purchase_order_id, ordered_quantity, purchase_price_in_minor_units, line_total_in_minor_units
      ) VALUES ('20000000-0000-0000-0000-000000000004', 1, 1, 1);
      RAISE EXCEPTION 'Direct INSERT was allowed for role % on purchase_order_items.', v_role_code;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
      INSERT INTO public.purchase_receipts (receipt_number, purchase_order_id)
      VALUES ('RUNTIME-DIRECT-PR-' || v_role_code, '20000000-0000-0000-0000-000000000004');
      RAISE EXCEPTION 'Direct INSERT was allowed for role % on purchase_receipts.', v_role_code;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
      INSERT INTO public.purchase_receipt_items (
        purchase_receipt_id, received_quantity, unit_cost_in_minor_units
      ) VALUES ('20000000-0000-0000-0000-000000000006', 1, 1);
      RAISE EXCEPTION 'Direct INSERT was allowed for role % on purchase_receipt_items.', v_role_code;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
      INSERT INTO public.supplier_payments (
        supplier_id, purchase_order_id, amount_in_minor_units, payment_method
      ) VALUES (
        '20000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000004',
        1,
        'bank'
      );
      RAISE EXCEPTION 'Direct INSERT was allowed for role % on supplier_payments.', v_role_code;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END;
$$;

RESET ROLE;
ROLLBACK;
