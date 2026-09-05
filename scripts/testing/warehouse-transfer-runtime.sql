-- Runtime regression for migration 095. This runs only against the disposable
-- isolated Supabase database and rolls all fixtures back.
\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_owner UUID := '95000000-0000-0000-0000-000000000001';
  v_cashier UUID := '95000000-0000-0000-0000-000000000002';
  v_branch UUID := '95000000-0000-0000-0000-000000000010';
  v_source UUID := '95000000-0000-0000-0000-000000000020';
  v_destination UUID := '95000000-0000-0000-0000-000000000021';
  v_category UUID := '95000000-0000-0000-0000-000000000030';
  v_unit UUID := '95000000-0000-0000-0000-000000000040';
  v_active_product UUID := '95000000-0000-0000-0000-000000000050';
  v_inactive_product UUID := '95000000-0000-0000-0000-000000000051';
  v_owner_role UUID;
  v_cashier_role UUID;
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, email_confirmed_at, raw_app_meta_data,
    raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_owner, 'authenticated', 'authenticated', 'transfer-owner@example.test', NOW(), '{}'::JSONB, '{}'::JSONB, NOW(), NOW()),
    (v_cashier, 'authenticated', 'authenticated', 'transfer-cashier@example.test', NOW(), '{}'::JSONB, '{}'::JSONB, NOW(), NOW());

  INSERT INTO public.profiles (id, full_name, is_active) VALUES
    (v_owner, 'Transfer Runtime Owner', true),
    (v_cashier, 'Transfer Runtime Cashier', true);

  INSERT INTO public.roles (code, name_ar) VALUES
    ('owner', 'مالك النظام'),
    ('cashier', 'كاشير')
  ON CONFLICT (code) DO NOTHING;

  SELECT id INTO v_owner_role FROM public.roles WHERE code = 'owner';
  SELECT id INTO v_cashier_role FROM public.roles WHERE code = 'cashier';
  INSERT INTO public.user_roles (user_id, role_id) VALUES
    (v_owner, v_owner_role),
    (v_cashier, v_cashier_role);

  INSERT INTO public.branches(id, code, name_ar, is_active)
  VALUES (v_branch, 'TRANSFER-095', 'فرع اختبار النقل', true);
  INSERT INTO public.warehouses(id, branch_id, code, name_ar, is_active) VALUES
    (v_source, v_branch, 'TRANSFER-095-SRC', 'مستودع مصدر', true),
    (v_destination, v_branch, 'TRANSFER-095-DST', 'مستودع هدف', true);
  INSERT INTO public.categories(id, code, name_ar, is_active)
  VALUES (v_category, 'TRANSFER-095-CAT', 'قسم اختبار النقل', true);
  INSERT INTO public.units(id, code, name_ar)
  VALUES (v_unit, 'TRANSFER-095-U', 'قطعة');
  INSERT INTO public.products(
    id, sku, name_ar, category_id, unit_id, purchase_unit_id, sale_unit_id,
    units_per_purchase_unit, units_per_sale_unit,
    default_sale_price_in_minor_units, cost_price_in_minor_units,
    sale_price_in_minor_units, wholesale_price_in_minor_units,
    min_stock_level, is_active
  ) VALUES
    (v_active_product, 'TRANSFER-095-ACTIVE', 'منتج نشط', v_category, v_unit, v_unit, v_unit,
     1, 1, 1000, 500, 1000, 1000, 0, true),
    (v_inactive_product, 'TRANSFER-095-INACTIVE', 'منتج غير نشط', v_category, v_unit, v_unit, v_unit,
     1, 1, 1000, 500, 1000, 1000, 0, false);
  INSERT INTO public.inventory_balances(warehouse_id, product_id, on_hand_quantity, reserved_quantity) VALUES
    (v_source, v_active_product, 10, 2),
    (v_destination, v_active_product, 3, 0),
    (v_source, v_inactive_product, 5, 0);
END;
$$;

-- The browser role has no direct anonymous execute grant.
DO $$
BEGIN
  IF has_function_privilege(
    'anon',
    'public.transfer_inventory_between_warehouses(uuid,uuid,uuid,integer,text,timestamptz)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Anonymous unexpectedly has transfer execute privilege.';
  END IF;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"95000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);

-- Successful transfer preserves exact balances, movements, and audit record.
DO $$
DECLARE
  v_result JSONB;
BEGIN
  v_result := public.transfer_inventory_between_warehouses(
    '95000000-0000-0000-0000-000000000050',
    '95000000-0000-0000-0000-000000000020',
    '95000000-0000-0000-0000-000000000021',
    4,
    'Migration 095 runtime transfer',
    NOW()
  );

  IF NOT COALESCE((v_result->>'success')::BOOLEAN, false)
    OR (SELECT on_hand_quantity FROM public.inventory_balances WHERE warehouse_id = '95000000-0000-0000-0000-000000000020' AND product_id = '95000000-0000-0000-0000-000000000050') <> 6
    OR (SELECT reserved_quantity FROM public.inventory_balances WHERE warehouse_id = '95000000-0000-0000-0000-000000000020' AND product_id = '95000000-0000-0000-0000-000000000050') <> 2
    OR (SELECT on_hand_quantity FROM public.inventory_balances WHERE warehouse_id = '95000000-0000-0000-0000-000000000021' AND product_id = '95000000-0000-0000-0000-000000000050') <> 7
    OR (SELECT count(*) FROM public.inventory_movements WHERE product_id = '95000000-0000-0000-0000-000000000050' AND reference_type = 'warehouse_transfer') <> 2
    OR (SELECT COALESCE(sum(quantity), 0) FROM public.inventory_movements WHERE product_id = '95000000-0000-0000-0000-000000000050' AND reference_type = 'warehouse_transfer') <> 0
    OR (SELECT count(*) FROM public.audit_logs WHERE entity_id = '95000000-0000-0000-0000-000000000050' AND action = 'TRANSFER_INVENTORY') <> 1
  THEN
    RAISE EXCEPTION 'Successful transfer reconciliation failed: %', v_result;
  END IF;
END;
$$;

-- Insufficient available stock must fail without any partial effects.
DO $$
DECLARE
  v_error TEXT;
  v_movement_count INTEGER;
  v_audit_count INTEGER;
BEGIN
  SELECT count(*) INTO v_movement_count FROM public.inventory_movements;
  SELECT count(*) INTO v_audit_count FROM public.audit_logs;
  BEGIN
    PERFORM public.transfer_inventory_between_warehouses(
      '95000000-0000-0000-0000-000000000050',
      '95000000-0000-0000-0000-000000000020',
      '95000000-0000-0000-0000-000000000021',
      5,
      NULL,
      NOW()
    );
    RAISE EXCEPTION 'Insufficient-stock transfer unexpectedly succeeded.';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
    IF v_error = 'Insufficient-stock transfer unexpectedly succeeded.' THEN RAISE; END IF;
  END;

  IF (SELECT on_hand_quantity FROM public.inventory_balances WHERE warehouse_id = '95000000-0000-0000-0000-000000000020' AND product_id = '95000000-0000-0000-0000-000000000050') <> 6
    OR (SELECT on_hand_quantity FROM public.inventory_balances WHERE warehouse_id = '95000000-0000-0000-0000-000000000021' AND product_id = '95000000-0000-0000-0000-000000000050') <> 7
    OR (SELECT count(*) FROM public.inventory_movements) <> v_movement_count
    OR (SELECT count(*) FROM public.audit_logs) <> v_audit_count
  THEN
    RAISE EXCEPTION 'Insufficient-stock rejection left partial effects.';
  END IF;
END;
$$;

-- Inactive and missing products must fail before inventory is changed.
DO $$
DECLARE
  v_product UUID;
  v_error TEXT;
BEGIN
  FOREACH v_product IN ARRAY ARRAY[
    '95000000-0000-0000-0000-000000000051'::UUID,
    '95000000-0000-0000-0000-000000000099'::UUID
  ] LOOP
    BEGIN
      PERFORM public.transfer_inventory_between_warehouses(
        v_product,
        '95000000-0000-0000-0000-000000000020',
        '95000000-0000-0000-0000-000000000021',
        1,
        NULL,
        NOW()
      );
      RAISE EXCEPTION 'Inactive/missing product transfer unexpectedly succeeded.';
    EXCEPTION WHEN OTHERS THEN
      v_error := SQLERRM;
      IF v_error = 'Inactive/missing product transfer unexpectedly succeeded.' THEN RAISE; END IF;
    END;
  END LOOP;

  IF (SELECT on_hand_quantity FROM public.inventory_balances WHERE warehouse_id = '95000000-0000-0000-0000-000000000020' AND product_id = '95000000-0000-0000-0000-000000000051') <> 5
    OR EXISTS (SELECT 1 FROM public.inventory_movements WHERE product_id = '95000000-0000-0000-0000-000000000051')
  THEN
    RAISE EXCEPTION 'Inactive/missing product rejection left partial effects.';
  END IF;
END;
$$;

-- A cashier remains denied by the same server-side RBAC guard.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"95000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',
  true
);
DO $$
DECLARE
  v_error TEXT;
BEGIN
  BEGIN
    PERFORM public.transfer_inventory_between_warehouses(
      '95000000-0000-0000-0000-000000000050',
      '95000000-0000-0000-0000-000000000020',
      '95000000-0000-0000-0000-000000000021',
      1,
      NULL,
      NOW()
    );
    RAISE EXCEPTION 'Cashier transfer unexpectedly succeeded.';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
    IF v_error = 'Cashier transfer unexpectedly succeeded.' THEN RAISE; END IF;
  END;

  IF (SELECT on_hand_quantity FROM public.inventory_balances WHERE warehouse_id = '95000000-0000-0000-0000-000000000020' AND product_id = '95000000-0000-0000-0000-000000000050') <> 6
    OR (SELECT count(*) FROM public.inventory_movements WHERE product_id = '95000000-0000-0000-0000-000000000050' AND reference_type = 'warehouse_transfer') <> 2
  THEN
    RAISE EXCEPTION 'RBAC denial left partial inventory effects.';
  END IF;
END;
$$;

RESET ROLE;
SELECT jsonb_build_object(
  'ok', true,
  'runtime_scenarios', 5,
  'source_on_hand', (SELECT on_hand_quantity FROM public.inventory_balances WHERE warehouse_id = '95000000-0000-0000-0000-000000000020' AND product_id = '95000000-0000-0000-0000-000000000050'),
  'destination_on_hand', (SELECT on_hand_quantity FROM public.inventory_balances WHERE warehouse_id = '95000000-0000-0000-0000-000000000021' AND product_id = '95000000-0000-0000-0000-000000000050'),
  'net_transfer_quantity', (SELECT COALESCE(sum(quantity), 0) FROM public.inventory_movements WHERE product_id = '95000000-0000-0000-0000-000000000050' AND reference_type = 'warehouse_transfer')
);

ROLLBACK;
