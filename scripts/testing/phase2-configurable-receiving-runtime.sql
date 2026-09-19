\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_missing_tables INTEGER;
  v_missing_columns INTEGER;
  v_owner_role UUID;
  v_warehouse_role UUID;
BEGIN
  SELECT COUNT(*) INTO v_missing_tables
  FROM (VALUES
    ('purchase_order_item_components'),
    ('purchase_receipt_commercial_lines'),
    ('supplier_financial_invoice_identities'),
    ('phase2_receipt_wac_snapshots')
  ) expected(table_name)
  WHERE TO_REGCLASS('public.' || expected.table_name) IS NULL;

  IF v_missing_tables <> 0 THEN
    RAISE EXCEPTION 'Phase 2 is missing % required tables.', v_missing_tables;
  END IF;

  SELECT COUNT(*) INTO v_missing_columns
  FROM (VALUES
    ('products', 'wac_cost_in_minor_units_exact'),
    ('supplier_receipts', 'inventory_acquisition_cost_snapshot_in_minor_units'),
    ('supplier_receipt_items', 'exact_unit_cost_in_minor_units'),
    ('purchase_order_items', 'received_parcel_quantity'),
    ('purchase_receipts', 'supplier_invoice_payable_total_snapshot_in_minor_units'),
    ('purchase_receipt_items', 'merchandise_net_cost_in_minor_units'),
    ('inventory_movements', 'mutation_sequence')
  ) expected(table_name, column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns column_info
    WHERE column_info.table_schema = 'public'
      AND column_info.table_name = expected.table_name
      AND column_info.column_name = expected.column_name
  );

  IF v_missing_columns <> 0 THEN
    RAISE EXCEPTION 'Phase 2 is missing % required columns.', v_missing_columns;
  END IF;

  INSERT INTO auth.users (
    id, aud, role, email, email_confirmed_at, raw_app_meta_data,
    raw_user_meta_data, created_at, updated_at
  ) VALUES
    ('92300000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
      'phase2-owner@example.test', NOW(), '{}'::JSONB, '{}'::JSONB, NOW(), NOW()),
    ('92300000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
      'phase2-cashier@example.test', NOW(), '{}'::JSONB, '{}'::JSONB, NOW(), NOW());

  INSERT INTO public.profiles (id, full_name, is_active) VALUES
    ('92300000-0000-0000-0000-000000000001', 'Phase 2 Runtime Owner', true),
    ('92300000-0000-0000-0000-000000000002', 'Phase 2 Runtime Cashier', true);

  INSERT INTO public.roles (code, name_ar) VALUES
    ('owner', 'مالك النظام'),
    ('warehouse_keeper', 'أمين مستودع')
  ON CONFLICT (code) DO NOTHING;
  SELECT id INTO STRICT v_owner_role FROM public.roles WHERE code = 'owner';
  SELECT id INTO STRICT v_warehouse_role FROM public.roles WHERE code = 'warehouse_keeper';
  INSERT INTO public.user_roles (user_id, role_id) VALUES
    ('92300000-0000-0000-0000-000000000001', v_owner_role),
    ('92300000-0000-0000-0000-000000000002', v_warehouse_role);

  INSERT INTO public.units (id, code, name_ar) VALUES
    ('92300000-0000-0000-0000-000000000010', 'PHASE2-PACKET', 'باكيت');
  INSERT INTO public.categories (id, code, name_ar, is_active) VALUES
    ('92300000-0000-0000-0000-000000000011', 'PHASE2-CAT', 'فئة اختبار الاستلام', true);

  INSERT INTO public.products (
    id, sku, name_ar, category_id, unit_id, purchase_unit_id, sale_unit_id,
    units_per_purchase_unit, units_per_sale_unit,
    default_purchase_price_in_minor_units, default_sale_price_in_minor_units,
    cost_price_in_minor_units, sale_price_in_minor_units,
    wholesale_price_in_minor_units, min_stock_level, is_active,
    is_flavor_master
  ) VALUES
    ('92300000-0000-0000-0000-000000000100', 'PHASE2-FAMILY', 'عائلة اختبار Phase 2',
      '92300000-0000-0000-0000-000000000011', '92300000-0000-0000-0000-000000000010',
      '92300000-0000-0000-0000-000000000010', '92300000-0000-0000-0000-000000000010',
      5, 5, 4000, 5000, 800, 1000, 5000, 0, true, true),
    ('92300000-0000-0000-0000-000000000104', 'PHASE2-OTHER', 'منتج مستقل',
      '92300000-0000-0000-0000-000000000011', '92300000-0000-0000-0000-000000000010',
      '92300000-0000-0000-0000-000000000010', '92300000-0000-0000-0000-000000000010',
      1, 1, 100, 150, 100, 150, 150, 0, true, false);

  INSERT INTO public.products (
    id, sku, name_ar, category_id, flavor_master_product_id,
    flavor_name_ar, min_stock_level, is_active
  ) VALUES
    ('92300000-0000-0000-0000-000000000101', 'PHASE2-A', 'نكهة أ',
      '92300000-0000-0000-0000-000000000011', '92300000-0000-0000-0000-000000000100', 'أ', 0, true),
    ('92300000-0000-0000-0000-000000000102', 'PHASE2-B', 'نكهة ب',
      '92300000-0000-0000-0000-000000000011', '92300000-0000-0000-0000-000000000100', 'ب', 0, true),
    ('92300000-0000-0000-0000-000000000103', 'PHASE2-C', 'نكهة ج',
      '92300000-0000-0000-0000-000000000011', '92300000-0000-0000-0000-000000000100', 'ج', 0, true);

  INSERT INTO public.product_parcel_configurations (
    id, family_product_id, composition_mode, configuration_revision
  ) VALUES (
    '92300000-0000-0000-0000-000000000401',
    '92300000-0000-0000-0000-000000000100',
    'configurable_mix', 1
  );

  INSERT INTO public.branches (id, code, name_ar, is_active) VALUES
    ('92300000-0000-0000-0000-000000000200', 'PHASE2-BR', 'فرع اختبار Phase 2', true);
  INSERT INTO public.warehouses (id, branch_id, code, name_ar, is_active) VALUES
    ('92300000-0000-0000-0000-000000000201', '92300000-0000-0000-0000-000000000200',
      'PHASE2-WH-A', 'مستودع أ', true),
    ('92300000-0000-0000-0000-000000000202', '92300000-0000-0000-0000-000000000200',
      'PHASE2-WH-B', 'مستودع ب', true);

  INSERT INTO public.suppliers (id, company_name, current_balance_in_minor_units) VALUES
    ('92300000-0000-0000-0000-000000000301', 'مورد اختبار Phase 2 أ', 0),
    ('92300000-0000-0000-0000-000000000302', 'مورد اختبار Phase 2 ب', 0);

  INSERT INTO public.cash_shifts (
    id, shift_number, branch_id, opened_by, opening_cash_in_minor_units
  ) VALUES (
    '92300000-0000-0000-0000-000000000500',
    'PHASE2-SHIFT-1',
    '92300000-0000-0000-0000-000000000200',
    '92300000-0000-0000-0000-000000000001',
    0
  );
END;
$$;

COMMIT;

SELECT jsonb_build_object(
  'fixtures', true,
  'featureState', public.get_configurable_parcel_feature_state(),
  'migration113', TO_REGCLASS('public.phase2_receipt_wac_snapshots') IS NOT NULL,
  'rlsTables', (
    SELECT COUNT(*)
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN (
        'purchase_order_item_components',
        'purchase_receipt_commercial_lines',
        'supplier_financial_invoice_identities',
        'phase2_receipt_wac_snapshots'
      )
      AND relation.relrowsecurity
  ),
  'directClientWrites', (
    has_table_privilege('authenticated', 'public.purchase_receipt_commercial_lines', 'INSERT')
    OR has_table_privilege('authenticated', 'public.phase2_receipt_wac_snapshots', 'UPDATE')
    OR has_table_privilege('anon', 'public.supplier_financial_invoice_identities', 'DELETE')
  )
);
