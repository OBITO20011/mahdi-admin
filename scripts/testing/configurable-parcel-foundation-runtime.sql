\set ON_ERROR_STOP on

CREATE TEMP TABLE parcel_foundation_results (
  scenario TEXT PRIMARY KEY,
  passed BOOLEAN NOT NULL
) ON COMMIT PRESERVE ROWS;

BEGIN;

DO $$
DECLARE
  v_missing_tables INTEGER;
  v_missing_columns INTEGER;
  v_rls_failures INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_missing_tables
  FROM (VALUES
    ('configurable_parcel_feature_settings'),
    ('product_parcel_configurations'),
    ('business_operations'),
    ('order_parcel_instances'),
    ('order_parcel_components'),
    ('order_inventory_reservations'),
    ('supplier_receipt_commercial_lines'),
    ('sales_return_events'),
    ('sales_return_items')
  ) AS expected(table_name)
  WHERE TO_REGCLASS('public.' || expected.table_name) IS NULL;

  IF v_missing_tables <> 0 THEN
    RAISE EXCEPTION 'Parcel foundation is missing % required tables.', v_missing_tables;
  END IF;

  SELECT COUNT(*) INTO v_missing_columns
  FROM (VALUES
    ('products', 'wac_cost_in_minor_units_exact'),
    ('orders', 'operation_id'),
    ('order_items', 'commercial_line_kind'),
    ('order_items', 'family_product_id'),
    ('order_items', 'net_refundable_amount_snapshot_in_minor_units'),
    ('supplier_receipts', 'operation_id'),
    ('supplier_receipt_items', 'commercial_line_id'),
    ('purchase_orders', 'operation_id'),
    ('purchase_order_items', 'commercial_line_kind'),
    ('purchase_receipts', 'operation_id'),
    ('purchase_receipt_items', 'exact_unit_cost_in_minor_units'),
    ('inventory_movements', 'operation_id'),
    ('sales_returns', 'operation_id')
  ) AS expected(table_name, column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = expected.table_name
      AND c.column_name = expected.column_name
  );

  IF v_missing_columns <> 0 THEN
    RAISE EXCEPTION 'Parcel foundation is missing % required columns.', v_missing_columns;
  END IF;

  SELECT COUNT(*) INTO v_rls_failures
  FROM (VALUES
    ('configurable_parcel_feature_settings'),
    ('product_parcel_configurations'),
    ('business_operations'),
    ('order_parcel_instances'),
    ('order_parcel_components'),
    ('order_inventory_reservations'),
    ('supplier_receipt_commercial_lines'),
    ('sales_return_events'),
    ('sales_return_items')
  ) AS expected(table_name)
  LEFT JOIN pg_class c ON c.relname = expected.table_name
  LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  WHERE n.oid IS NULL OR NOT c.relrowsecurity;

  IF v_rls_failures <> 0 THEN
    RAISE EXCEPTION 'RLS is missing from % parcel foundation tables.', v_rls_failures;
  END IF;

  INSERT INTO parcel_foundation_results VALUES
    ('schema', true),
    ('rls', true);
END;
$$;

DO $$
BEGIN
  IF public.get_configurable_parcel_feature_state() <> 'OFF' THEN
    RAISE EXCEPTION 'Configurable parcel feature must default to OFF.';
  END IF;

  IF has_table_privilege('anon', 'public.order_parcel_instances', 'INSERT')
    OR has_table_privilege('authenticated', 'public.order_parcel_instances', 'INSERT')
    OR has_table_privilege('anon', 'public.sales_return_items', 'INSERT')
    OR has_table_privilege('authenticated', 'public.sales_return_items', 'UPDATE')
  THEN
    RAISE EXCEPTION 'A client role received direct parcel business mutation privileges.';
  END IF;

  IF NOT has_function_privilege(
    'anon',
    'public.get_configurable_parcel_feature_state()',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.assert_configurable_parcel_creation_allowed()',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.finalize_order_parcel_instance_internal(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Parcel feature function grants are not least privilege.';
  END IF;

  INSERT INTO parcel_foundation_results VALUES
    ('feature_off', true),
    ('least_privilege', true);
END;
$$;

DO $$
DECLARE
  v_owner UUID := '91200000-0000-0000-0000-000000000000';
  v_cashier UUID := '91200000-0000-0000-0000-000000000009';
  v_owner_role UUID;
  v_cashier_role UUID;
  v_unit UUID := '91200000-0000-0000-0000-000000000001';
  v_category UUID := '91200000-0000-0000-0000-000000000002';
  v_family UUID := '91200000-0000-0000-0000-000000000010';
  v_child_a UUID := '91200000-0000-0000-0000-000000000011';
  v_child_b UUID := '91200000-0000-0000-0000-000000000012';
  v_other UUID := '91200000-0000-0000-0000-000000000013';
  v_branch UUID := '91200000-0000-0000-0000-000000000020';
  v_warehouse UUID := '91200000-0000-0000-0000-000000000021';
  v_order UUID := '91200000-0000-0000-0000-000000000030';
  v_order_b UUID := '91200000-0000-0000-0000-000000000040';
  v_operation UUID := '91200000-0000-0000-0000-000000000031';
  v_operation_b UUID := '91200000-0000-0000-0000-000000000041';
  v_config UUID := '91200000-0000-0000-0000-000000000032';
  v_legacy_item UUID := '91200000-0000-0000-0000-000000000033';
  v_parcel_item UUID := '91200000-0000-0000-0000-000000000034';
  v_instance UUID := '91200000-0000-0000-0000-000000000035';
  v_invalid_item UUID := '91200000-0000-0000-0000-000000000036';
  v_invalid_instance UUID := '91200000-0000-0000-0000-000000000037';
  v_parcel_item_b UUID := '91200000-0000-0000-0000-000000000042';
  v_instance_b UUID := '91200000-0000-0000-0000-000000000043';
  v_draft_item UUID := '91200000-0000-0000-0000-000000000044';
  v_draft_instance UUID := '91200000-0000-0000-0000-000000000045';
  v_over_item UUID := '91200000-0000-0000-0000-000000000046';
  v_over_instance UUID := '91200000-0000-0000-0000-000000000047';
  v_shift UUID := '91200000-0000-0000-0000-000000000050';
  v_return_operation UUID := '91200000-0000-0000-0000-000000000051';
  v_return_event UUID := '91200000-0000-0000-0000-000000000052';
  v_supplier UUID := '91200000-0000-0000-0000-000000000060';
  v_supplier_receipt UUID := '91200000-0000-0000-0000-000000000061';
  v_purchase_order UUID := '91200000-0000-0000-0000-000000000062';
  v_supplier_line UUID := '91200000-0000-0000-0000-000000000063';
  v_off_rejected BOOLEAN := false;
  v_cross_family_rejected BOOLEAN := false;
  v_total_rejected BOOLEAN := false;
  v_overfilled_rejected BOOLEAN := false;
  v_reparent_rejected BOOLEAN := false;
  v_reparent_quantity_rejected BOOLEAN := false;
  v_snapshot_rewrite_rejected INTEGER := 0;
  v_chain_rejected INTEGER := 0;
  v_required_field_rejected INTEGER := 0;
  v_history_table_rejected INTEGER := 0;
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, email_confirmed_at, raw_app_meta_data,
    raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_owner, 'authenticated', 'authenticated', 'parcel-owner@example.test', NOW(), '{}'::JSONB, '{}'::JSONB, NOW(), NOW()),
    (v_cashier, 'authenticated', 'authenticated', 'parcel-cashier@example.test', NOW(), '{}'::JSONB, '{}'::JSONB, NOW(), NOW());

  INSERT INTO public.profiles (id, full_name, is_active) VALUES
    (v_owner, 'Parcel Runtime Owner', true),
    (v_cashier, 'Parcel Runtime Cashier', true);
  INSERT INTO public.roles (code, name_ar) VALUES
    ('owner', 'مالك النظام'),
    ('cashier', 'كاشير')
  ON CONFLICT (code) DO NOTHING;
  SELECT id INTO STRICT v_owner_role FROM public.roles WHERE code = 'owner';
  SELECT id INTO STRICT v_cashier_role FROM public.roles WHERE code = 'cashier';
  INSERT INTO public.user_roles (user_id, role_id) VALUES
    (v_owner, v_owner_role),
    (v_cashier, v_cashier_role);

  INSERT INTO public.units (id, code, name_ar)
  VALUES (v_unit, 'PARCEL-BASE', 'باكيت');

  INSERT INTO public.categories (id, code, name_ar, is_active)
  VALUES (v_category, 'PARCEL-CAT', 'فئة اختبار الطرد', true);

  INSERT INTO public.products (
    id, sku, name_ar, category_id, unit_id, purchase_unit_id, sale_unit_id,
    units_per_purchase_unit, units_per_sale_unit,
    default_purchase_price_in_minor_units,
    default_sale_price_in_minor_units,
    cost_price_in_minor_units, sale_price_in_minor_units,
    wholesale_price_in_minor_units, min_stock_level, is_active,
    is_flavor_master
  ) VALUES
    (v_family, 'PARCEL-FAMILY', 'عائلة اختبار الطرد', v_category, v_unit, v_unit, v_unit, 5, 5, 4000, 5000, 800, 1000, 5000, 0, true, true),
    (v_other, 'PARCEL-OTHER', 'منتج من عائلة أخرى', v_category, v_unit, v_unit, v_unit, 5, 5, 4000, 5000, 800, 1000, 5000, 0, true, false);

  INSERT INTO public.products (
    id, sku, name_ar, category_id, flavor_master_product_id, flavor_name_ar,
    min_stock_level, is_active
  ) VALUES
    (v_child_a, 'PARCEL-A', 'نكهة اختبار أ', v_category, v_family, 'نكهة أ', 0, true),
    (v_child_b, 'PARCEL-B', 'نكهة اختبار ب', v_category, v_family, 'نكهة ب', 0, true);

  INSERT INTO public.product_parcel_configurations (
    id, family_product_id, composition_mode, configuration_revision
  ) VALUES (
    v_config, v_family, 'configurable_mix', 1
  );

  INSERT INTO public.branches (id, code, name_ar, is_active)
  VALUES (v_branch, 'PARCEL-BR', 'فرع اختبار الطرد', true);
  INSERT INTO public.warehouses (id, branch_id, code, name_ar, is_active)
  VALUES (v_warehouse, v_branch, 'PARCEL-WH', 'مستودع اختبار الطرد', true);

  INSERT INTO public.suppliers (id, company_name)
  VALUES (v_supplier, 'مورد اختبار أساس الطرود');

  INSERT INTO public.business_operations (
    id, operation_type, idempotency_key, request_fingerprint
  ) VALUES
    (v_operation, 'parcel_foundation_test', 'parcel-foundation-runtime-1', REPEAT('a', 64)),
    (v_operation_b, 'parcel_foundation_test', 'parcel-foundation-runtime-2', REPEAT('d', 64)),
    (v_return_operation, 'parcel_return_test', 'parcel-foundation-return-1', REPEAT('e', 64));

  INSERT INTO public.orders (
    id, order_number, branch_id, warehouse_id, source, operation_id
  ) VALUES
    (v_order, 'PARCEL-FOUNDATION-1', v_branch, v_warehouse, 'website', v_operation),
    (v_order_b, 'PARCEL-FOUNDATION-2', v_branch, v_warehouse, 'website', v_operation_b);

  INSERT INTO public.cash_shifts (
    id, shift_number, branch_id, opened_by, opening_cash_in_minor_units
  ) VALUES (
    v_shift, 'PARCEL-SHIFT-1', v_branch, v_owner, 0
  );

  INSERT INTO public.supplier_receipts (
    id, receipt_number, supplier_id, warehouse_id, branch_id, received_by,
    operation_id
  ) VALUES (
    v_supplier_receipt, 'PARCEL-RECEIPT-1', v_supplier, v_warehouse,
    v_branch, v_owner, v_operation
  );

  INSERT INTO public.purchase_orders (
    id, purchase_order_number, supplier_id, branch_id, warehouse_id,
    operation_id
  ) VALUES (
    v_purchase_order, 'PARCEL-PO-1', v_supplier, v_branch, v_warehouse,
    v_operation
  );

  -- Old inserts continue to work without setting any of the new columns.
  INSERT INTO public.order_items (
    id, order_id, product_id, product_name_snapshot, sku_snapshot,
    quantity, unit_price_in_minor_units, line_total_in_minor_units
  ) VALUES (
    v_legacy_item, v_order, v_child_a, 'نكهة اختبار أ', 'PARCEL-A',
    1, 1000, 1000
  );

  IF EXISTS (
    SELECT 1 FROM public.order_items
    WHERE id = v_legacy_item
      AND (
        commercial_line_kind IS NOT NULL
        OR family_product_id IS NOT NULL
        OR parcel_configuration_id IS NOT NULL
        OR net_refundable_amount_snapshot_in_minor_units IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'Legacy order row was rewritten or inferred.';
  END IF;

  BEGIN
    INSERT INTO public.order_items (
      order_id, product_name_snapshot, quantity,
      unit_price_in_minor_units, line_total_in_minor_units,
      commercial_line_kind, family_product_id, parcel_configuration_id,
      parcel_configuration_revision
    ) VALUES (
      v_order, 'طرد مختلط مرفوض', 5, 5000, 5000,
      'configurable_parcel', v_family, v_config, 1
    );
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM LIKE 'CONFIGURABLE_PARCEL_DISABLED:%' THEN
        v_off_rejected := true;
      ELSE
        RAISE;
      END IF;
  END;

  IF NOT v_off_rejected THEN
    RAISE EXCEPTION 'Feature OFF did not reject a configurable parcel line.';
  END IF;

  UPDATE public.configurable_parcel_feature_settings
  SET feature_state = 'ENABLED', updated_at = NOW()
  WHERE feature_key = 'configurable_parcels';

  INSERT INTO public.order_items (
    id, order_id, product_name_snapshot, quantity,
    unit_price_in_minor_units, line_total_in_minor_units,
    commercial_line_kind, family_product_id, parcel_configuration_id,
    parcel_configuration_revision, base_unit_name_snapshot,
    allocated_discount_snapshot_in_minor_units,
    net_refundable_amount_snapshot_in_minor_units
  ) VALUES (
    v_parcel_item, v_order, 'طرد نكهات اختباري', 5, 5000, 5000,
    'configurable_parcel', v_family, v_config, 1, 'باكيت', 0, 5000
  );

  INSERT INTO public.order_parcel_instances (
    id, order_item_id, order_id, operation_id, parcel_configuration_id,
    family_product_id, instance_sequence, configuration_revision,
    units_per_parcel_snapshot, parcel_unit_name_snapshot,
    gross_amount_snapshot_in_minor_units,
    allocated_discount_snapshot_in_minor_units,
    net_refundable_amount_snapshot_in_minor_units,
    cogs_snapshot_in_minor_units, composition_fingerprint
  ) VALUES (
    v_instance, v_parcel_item, v_order, v_operation, v_config,
    v_family, 1, 1, 5, 'طرد', 5000, 0, 5000, 4000, REPEAT('b', 64)
  );

  INSERT INTO public.order_parcel_components (
    parcel_instance_id, operation_id, product_id, base_quantity,
    product_name_snapshot, sku_snapshot, base_unit_name_snapshot,
    unit_cost_snapshot_in_minor_units, cogs_snapshot_in_minor_units
  ) VALUES
    (v_instance, v_operation, v_child_a, 2, 'نكهة أ', 'PARCEL-A', 'باكيت', 800, 1600),
    (v_instance, v_operation, v_child_b, 3, 'نكهة ب', 'PARCEL-B', 'باكيت', 800, 2400);

  PERFORM public.finalize_order_parcel_instance_internal(v_instance);

  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;

  BEGIN
    INSERT INTO public.order_items (
      id, order_id, product_name_snapshot, quantity,
      unit_price_in_minor_units, line_total_in_minor_units,
      commercial_line_kind, family_product_id, parcel_configuration_id,
      parcel_configuration_revision, base_unit_name_snapshot,
      allocated_discount_snapshot_in_minor_units,
      net_refundable_amount_snapshot_in_minor_units
    ) VALUES (
      v_invalid_item, v_order, 'طرد ناقص', 5, 5000, 5000,
      'configurable_parcel', v_family, v_config, 1, 'باكيت', 0, 5000
    );

    INSERT INTO public.order_parcel_instances (
      id, order_item_id, order_id, operation_id, parcel_configuration_id,
      family_product_id, instance_sequence, configuration_revision,
      units_per_parcel_snapshot, parcel_unit_name_snapshot,
      gross_amount_snapshot_in_minor_units,
      allocated_discount_snapshot_in_minor_units,
      net_refundable_amount_snapshot_in_minor_units,
      cogs_snapshot_in_minor_units, composition_fingerprint
    ) VALUES (
      v_invalid_instance, v_invalid_item, v_order, v_operation, v_config,
      v_family, 1, 1, 5, 'طرد', 5000, 0, 5000, 800, REPEAT('c', 64)
    );

    INSERT INTO public.order_parcel_components (
      parcel_instance_id, operation_id, product_id, base_quantity,
      product_name_snapshot, sku_snapshot, base_unit_name_snapshot,
      unit_cost_snapshot_in_minor_units, cogs_snapshot_in_minor_units
    ) VALUES (
      v_invalid_instance, v_operation, v_child_a, 1,
      'نكهة أ', 'PARCEL-A', 'باكيت', 800, 800
    );

    PERFORM public.finalize_order_parcel_instance_internal(v_invalid_instance);

    SET CONSTRAINTS ALL IMMEDIATE;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'Parcel composition total (%) must equal its pack-size snapshot (%).%' THEN
      v_total_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;

  SET CONSTRAINTS ALL DEFERRED;

  IF NOT v_total_rejected THEN
    RAISE EXCEPTION 'Incomplete parcel composition was accepted.';
  END IF;

  -- A second completed parcel provides an independently valid reparent target.
  INSERT INTO public.order_items (
    id, order_id, product_name_snapshot, quantity,
    unit_price_in_minor_units, line_total_in_minor_units,
    commercial_line_kind, family_product_id, parcel_configuration_id,
    parcel_configuration_revision, base_unit_name_snapshot,
    allocated_discount_snapshot_in_minor_units,
    net_refundable_amount_snapshot_in_minor_units
  ) VALUES (
    v_parcel_item_b, v_order_b, 'طرد نكهات اختباري ب', 5, 5000, 5000,
    'configurable_parcel', v_family, v_config, 1, 'باكيت', 0, 5000
  );
  INSERT INTO public.order_parcel_instances (
    id, order_item_id, order_id, operation_id, parcel_configuration_id,
    family_product_id, instance_sequence, configuration_revision,
    units_per_parcel_snapshot, parcel_unit_name_snapshot,
    gross_amount_snapshot_in_minor_units,
    allocated_discount_snapshot_in_minor_units,
    net_refundable_amount_snapshot_in_minor_units,
    cogs_snapshot_in_minor_units, composition_fingerprint
  ) VALUES (
    v_instance_b, v_parcel_item_b, v_order_b, v_operation_b, v_config,
    v_family, 1, 1, 5, 'طرد', 5000, 0, 5000, 4000, REPEAT('f', 64)
  );
  INSERT INTO public.order_parcel_components (
    parcel_instance_id, operation_id, product_id, base_quantity,
    product_name_snapshot, sku_snapshot, base_unit_name_snapshot,
    unit_cost_snapshot_in_minor_units, cogs_snapshot_in_minor_units
  ) VALUES (
    v_instance_b, v_operation_b, v_child_a, 5,
    'نكهة أ', 'PARCEL-A', 'باكيت', 800, 4000
  );
  PERFORM public.finalize_order_parcel_instance_internal(v_instance_b);
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;

  BEGIN
    UPDATE public.order_parcel_components
    SET parcel_instance_id = v_instance_b, operation_id = v_operation_b
    WHERE parcel_instance_id = v_instance AND product_id = v_child_b;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM LIKE 'FINALIZED_PARCEL_COMPONENT_IMMUTABLE:%' THEN
      v_reparent_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_reparent_rejected THEN
    RAISE EXCEPTION 'A finalized component was reparented without changing quantity.';
  END IF;

  BEGIN
    UPDATE public.order_parcel_components
    SET parcel_instance_id = v_instance_b,
        operation_id = v_operation_b,
        base_quantity = 1
    WHERE parcel_instance_id = v_instance AND product_id = v_child_b;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM LIKE 'FINALIZED_PARCEL_COMPONENT_IMMUTABLE:%' THEN
      v_reparent_quantity_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_reparent_quantity_rejected THEN
    RAISE EXCEPTION 'A finalized component was reparented while changing quantity.';
  END IF;

  -- Transaction-local composition can be rebuilt before the one-way boundary.
  INSERT INTO public.order_items (
    id, order_id, product_name_snapshot, quantity,
    unit_price_in_minor_units, line_total_in_minor_units,
    commercial_line_kind, family_product_id, parcel_configuration_id,
    parcel_configuration_revision, base_unit_name_snapshot,
    allocated_discount_snapshot_in_minor_units,
    net_refundable_amount_snapshot_in_minor_units
  ) VALUES (
    v_draft_item, v_order, 'طرد مسودة', 5, 5000, 5000,
    'configurable_parcel', v_family, v_config, 1, 'باكيت', 0, 5000
  );
  INSERT INTO public.order_parcel_instances (
    id, order_item_id, order_id, operation_id, parcel_configuration_id,
    family_product_id, instance_sequence, configuration_revision,
    units_per_parcel_snapshot, parcel_unit_name_snapshot,
    gross_amount_snapshot_in_minor_units,
    allocated_discount_snapshot_in_minor_units,
    net_refundable_amount_snapshot_in_minor_units,
    cogs_snapshot_in_minor_units, composition_fingerprint
  ) VALUES (
    v_draft_instance, v_draft_item, v_order, v_operation, v_config,
    v_family, 2, 1, 5, 'طرد', 5000, 0, 5000, 4000, REPEAT('1', 64)
  );

  BEGIN
    INSERT INTO public.order_parcel_components (
      parcel_instance_id, operation_id, product_id, base_quantity,
      product_name_snapshot, sku_snapshot, base_unit_name_snapshot,
      unit_cost_snapshot_in_minor_units, cogs_snapshot_in_minor_units
    ) VALUES (
      v_draft_instance, v_operation, v_other, 1,
      'منتج آخر', 'PARCEL-OTHER', 'باكيت', 800, 800
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'Parcel component must be a stocked SKU from the configured family.%' THEN
      v_cross_family_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_cross_family_rejected THEN
    RAISE EXCEPTION 'Cross-family parcel component was accepted.';
  END IF;

  INSERT INTO public.order_parcel_components (
    parcel_instance_id, operation_id, product_id, base_quantity,
    product_name_snapshot, sku_snapshot, base_unit_name_snapshot,
    unit_cost_snapshot_in_minor_units, cogs_snapshot_in_minor_units
  ) VALUES (
    v_draft_instance, v_operation, v_child_a, 5,
    'نكهة أ', 'PARCEL-A', 'باكيت', 800, 4000
  );
  DELETE FROM public.order_parcel_components
  WHERE parcel_instance_id = v_draft_instance;
  INSERT INTO public.order_parcel_components (
    parcel_instance_id, operation_id, product_id, base_quantity,
    product_name_snapshot, sku_snapshot, base_unit_name_snapshot,
    unit_cost_snapshot_in_minor_units, cogs_snapshot_in_minor_units
  ) VALUES (
    v_draft_instance, v_operation, v_child_b, 5,
    'نكهة ب', 'PARCEL-B', 'باكيت', 800, 4000
  );
  PERFORM public.finalize_order_parcel_instance_internal(v_draft_instance);
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;

  BEGIN
    INSERT INTO public.order_items (
      id, order_id, product_name_snapshot, quantity,
      unit_price_in_minor_units, line_total_in_minor_units,
      commercial_line_kind, family_product_id, parcel_configuration_id,
      parcel_configuration_revision, base_unit_name_snapshot,
      allocated_discount_snapshot_in_minor_units,
      net_refundable_amount_snapshot_in_minor_units
    ) VALUES (
      v_over_item, v_order, 'طرد زائد', 5, 5000, 5000,
      'configurable_parcel', v_family, v_config, 1, 'باكيت', 0, 5000
    );
    INSERT INTO public.order_parcel_instances (
      id, order_item_id, order_id, operation_id, parcel_configuration_id,
      family_product_id, instance_sequence, configuration_revision,
      units_per_parcel_snapshot, parcel_unit_name_snapshot,
      gross_amount_snapshot_in_minor_units,
      allocated_discount_snapshot_in_minor_units,
      net_refundable_amount_snapshot_in_minor_units,
      cogs_snapshot_in_minor_units, composition_fingerprint
    ) VALUES (
      v_over_instance, v_over_item, v_order, v_operation, v_config,
      v_family, 3, 1, 5, 'طرد', 5000, 0, 5000, 4800, REPEAT('2', 64)
    );
    INSERT INTO public.order_parcel_components (
      parcel_instance_id, operation_id, product_id, base_quantity,
      product_name_snapshot, sku_snapshot, base_unit_name_snapshot,
      unit_cost_snapshot_in_minor_units, cogs_snapshot_in_minor_units
    ) VALUES (
      v_over_instance, v_operation, v_child_a, 6,
      'نكهة أ', 'PARCEL-A', 'باكيت', 800, 4800
    );
    PERFORM public.finalize_order_parcel_instance_internal(v_over_instance);
    SET CONSTRAINTS ALL IMMEDIATE;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'Parcel composition total (%) must equal its pack-size snapshot (%).%' THEN
      v_overfilled_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  SET CONSTRAINTS ALL DEFERRED;
  IF NOT v_overfilled_rejected THEN
    RAISE EXCEPTION 'Overfilled parcel composition was accepted.';
  END IF;

  -- Every original commercial snapshot is locked after finalization.
  BEGIN
    UPDATE public.order_parcel_components
    SET cogs_snapshot_in_minor_units = cogs_snapshot_in_minor_units + 1
    WHERE parcel_instance_id = v_instance AND product_id = v_child_a;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_snapshot_rewrite_rejected := v_snapshot_rewrite_rejected + 1;
  END;
  BEGIN
    UPDATE public.order_parcel_instances
    SET gross_amount_snapshot_in_minor_units = gross_amount_snapshot_in_minor_units + 1
    WHERE id = v_instance;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_snapshot_rewrite_rejected := v_snapshot_rewrite_rejected + 1;
  END;
  BEGIN
    UPDATE public.order_items
    SET line_total_in_minor_units = line_total_in_minor_units + 1
    WHERE id = v_parcel_item;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_snapshot_rewrite_rejected := v_snapshot_rewrite_rejected + 1;
  END;
  IF v_snapshot_rewrite_rejected <> 3 THEN
    RAISE EXCEPTION 'Not every finalized commercial snapshot was immutable.';
  END IF;

  -- Current configuration can advance while historical revision 1 remains valid.
  UPDATE public.product_parcel_configurations
  SET configuration_revision = 2, updated_at = NOW()
  WHERE id = v_config;

  INSERT INTO public.sales_return_events (
    id, return_number, operation_id, order_id, branch_id, warehouse_id,
    cash_shift_id, reason, refund_method,
    merchandise_refund_amount_in_minor_units, created_by
  ) VALUES (
    v_return_event, 'PARCEL-RETURN-1', v_return_operation, v_order,
    v_branch, v_warehouse, v_shift, 'اختبار إرجاع طرد مكتمل', 'cash', 5000,
    v_owner
  );

  BEGIN
    INSERT INTO public.sales_return_items (
      sales_return_event_id, operation_id, order_id, order_item_id,
      return_scope, parcel_instance_id, returned_quantity,
      refund_amount_snapshot_in_minor_units, stock_disposition
    ) VALUES (
      v_return_event, v_return_operation, v_order_b, v_parcel_item_b,
      'parcel_instance', v_instance_b, 1, 5000, 'restock'
    );
  EXCEPTION WHEN FOREIGN_KEY_VIOLATION OR CHECK_VIOLATION THEN
    v_chain_rejected := v_chain_rejected + 1;
  END;

  BEGIN
    INSERT INTO public.order_inventory_reservations (
      operation_id, order_id, order_item_id, parcel_instance_id,
      warehouse_id, product_id, reserved_quantity
    ) VALUES (
      v_operation, v_order, v_parcel_item_b, v_instance_b,
      v_warehouse, v_child_a, 1
    );
  EXCEPTION WHEN FOREIGN_KEY_VIOLATION OR CHECK_VIOLATION THEN
    v_chain_rejected := v_chain_rejected + 1;
  END;

  BEGIN
    INSERT INTO public.order_inventory_reservations (
      operation_id, order_id, order_item_id, parcel_instance_id,
      warehouse_id, product_id, reserved_quantity
    ) VALUES (
      v_operation_b, v_order, v_parcel_item, v_instance_b,
      v_warehouse, v_child_a, 1
    );
  EXCEPTION WHEN FOREIGN_KEY_VIOLATION OR CHECK_VIOLATION THEN
    v_chain_rejected := v_chain_rejected + 1;
  END;

  IF v_chain_rejected <> 3 THEN
    RAISE EXCEPTION 'Cross-chain relationships were not rejected consistently.';
  END IF;

  INSERT INTO public.sales_return_items (
    sales_return_event_id, operation_id, order_id, order_item_id,
    return_scope, parcel_instance_id, returned_quantity,
    refund_amount_snapshot_in_minor_units, stock_disposition
  ) VALUES (
    v_return_event, v_return_operation, v_order, v_parcel_item,
    'parcel_instance', v_instance, 1, 5000, 'restock'
  );

  IF (SELECT configuration_revision FROM public.order_parcel_instances WHERE id = v_instance) <> 1
    OR (SELECT configuration_revision FROM public.product_parcel_configurations WHERE id = v_config) <> 2
  THEN
    RAISE EXCEPTION 'Historical revision snapshot changed with current configuration.';
  END IF;

  -- PostgreSQL CHECK constraints accept NULL unless the shape says IS NOT NULL.
  BEGIN
    INSERT INTO public.order_items (
      order_id, product_name_snapshot, quantity, unit_price_in_minor_units,
      line_total_in_minor_units, commercial_line_kind, family_product_id,
      parcel_configuration_id, parcel_configuration_revision,
      base_unit_name_snapshot, allocated_discount_snapshot_in_minor_units,
      net_refundable_amount_snapshot_in_minor_units
    ) VALUES (
      v_order, 'طرد ناقص الوحدة', 5, 5000, 5000, 'configurable_parcel',
      v_family, v_config, 2, NULL, 0, 5000
    );
  EXCEPTION WHEN CHECK_VIOLATION THEN
    v_required_field_rejected := v_required_field_rejected + 1;
  END;

  BEGIN
    INSERT INTO public.supplier_receipt_commercial_lines (
      supplier_receipt_id, operation_id, line_sequence, commercial_line_kind,
      family_product_id, parcel_configuration_id, configuration_revision,
      commercial_quantity, units_per_parcel_snapshot, base_unit_name_snapshot,
      parcel_unit_name_snapshot, gross_amount_snapshot_in_minor_units,
      discount_snapshot_in_minor_units, line_total_snapshot_in_minor_units
    ) VALUES (
      v_supplier_receipt, v_operation, 1, 'configurable_parcel', v_family,
      v_config, NULL, 1, 5, 'باكيت', 'طرد', 4000, 0, 4000
    );
  EXCEPTION WHEN CHECK_VIOLATION THEN
    v_required_field_rejected := v_required_field_rejected + 1;
  END;

  BEGIN
    INSERT INTO public.supplier_receipt_commercial_lines (
      supplier_receipt_id, operation_id, line_sequence, commercial_line_kind,
      family_product_id, parcel_configuration_id, configuration_revision,
      commercial_quantity, units_per_parcel_snapshot, base_unit_name_snapshot,
      parcel_unit_name_snapshot, gross_amount_snapshot_in_minor_units,
      discount_snapshot_in_minor_units, line_total_snapshot_in_minor_units
    ) VALUES (
      v_supplier_receipt, v_operation, 1, 'configurable_parcel', v_family,
      v_config, 2, 1, NULL, 'باكيت', 'طرد', 4000, 0, 4000
    );
  EXCEPTION WHEN CHECK_VIOLATION THEN
    v_required_field_rejected := v_required_field_rejected + 1;
  END;

  BEGIN
    INSERT INTO public.purchase_order_items (
      purchase_order_id, ordered_quantity, purchase_price_in_minor_units,
      line_total_in_minor_units, commercial_line_kind, family_product_id,
      parcel_configuration_id, configuration_revision, base_unit_name_snapshot,
      parcel_unit_name_snapshot, parcel_quantity
    ) VALUES (
      v_purchase_order, 5, 4000, 4000, 'configurable_parcel', v_family,
      v_config, NULL, 'باكيت', 'طرد', 1
    );
  EXCEPTION WHEN CHECK_VIOLATION THEN
    v_required_field_rejected := v_required_field_rejected + 1;
  END;

  BEGIN
    INSERT INTO public.purchase_order_items (
      purchase_order_id, ordered_quantity, purchase_price_in_minor_units,
      line_total_in_minor_units, commercial_line_kind, family_product_id,
      parcel_configuration_id, configuration_revision, base_unit_name_snapshot,
      parcel_unit_name_snapshot, parcel_quantity
    ) VALUES (
      v_purchase_order, 5, 4000, 4000, 'configurable_parcel', v_family,
      v_config, 2, 'باكيت', 'طرد', NULL
    );
  EXCEPTION WHEN CHECK_VIOLATION THEN
    v_required_field_rejected := v_required_field_rejected + 1;
  END;

  IF v_required_field_rejected <> 5 THEN
    RAISE EXCEPTION 'Conditional required fields accepted NULL values.';
  END IF;

  INSERT INTO public.supplier_receipt_commercial_lines (
    id, supplier_receipt_id, operation_id, line_sequence, commercial_line_kind,
    family_product_id, parcel_configuration_id, configuration_revision,
    commercial_quantity, units_per_parcel_snapshot, base_unit_name_snapshot,
    parcel_unit_name_snapshot, gross_amount_snapshot_in_minor_units,
    discount_snapshot_in_minor_units, line_total_snapshot_in_minor_units
  ) VALUES (
    v_supplier_line, v_supplier_receipt, v_operation, 1,
    'configurable_parcel', v_family, v_config, 2, 1, 5, 'باكيت', 'طرد',
    4000, 0, 4000
  );
  BEGIN
    UPDATE public.supplier_receipt_commercial_lines
    SET line_total_snapshot_in_minor_units = 3999,
        discount_snapshot_in_minor_units = 1
    WHERE id = v_supplier_line;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_history_table_rejected := v_history_table_rejected + 1;
  END;
  BEGIN
    UPDATE public.business_operations
    SET request_fingerprint = REPEAT('9', 64)
    WHERE id = v_operation;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_history_table_rejected := v_history_table_rejected + 1;
  END;
  BEGIN
    UPDATE public.sales_return_events
    SET merchandise_refund_amount_in_minor_units = 4999
    WHERE id = v_return_event;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_history_table_rejected := v_history_table_rejected + 1;
  END;
  IF v_history_table_rejected <> 3 THEN
    RAISE EXCEPTION 'Append-only foundation history was mutable.';
  END IF;

  UPDATE public.configurable_parcel_feature_settings
  SET feature_state = 'OFF', updated_at = NOW()
  WHERE feature_key = 'configurable_parcels';

  INSERT INTO parcel_foundation_results VALUES
    ('legacy_row_untouched', true),
    ('off_rejects_new_parcel', true),
    ('same_family_components', true),
    ('cross_family_rejected', true),
    ('composition_underfill_rejected', true),
    ('composition_overfill_rejected', true),
    ('component_reparent_rejected', true),
    ('component_reparent_quantity_rejected', true),
    ('transaction_local_delete_insert_finalize', true),
    ('snapshot_immutability', true),
    ('historical_revision_survives', true),
    ('cross_chain_rejected', true),
    ('conditional_nulls_rejected', true),
    ('append_only_history', true);
END;
$$;

-- Server feature-state behavior uses real owner/cashier identities.
UPDATE public.configurable_parcel_feature_settings
SET feature_state = 'OWNER_PILOT', updated_at = NOW()
WHERE feature_key = 'configurable_parcels';
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"91200000-0000-0000-0000-000000000000","role":"authenticated","aal":"aal2"}',
  true
);
SELECT public.assert_configurable_parcel_creation_allowed();

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"91200000-0000-0000-0000-000000000009","role":"authenticated","aal":"aal2"}',
  true
);
DO $$
DECLARE
  v_rejected BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM public.assert_configurable_parcel_creation_allowed();
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'OWNER_PILOT allowed a cashier.';
  END IF;
END;
$$;

UPDATE public.configurable_parcel_feature_settings
SET feature_state = 'ENABLED', updated_at = NOW()
WHERE feature_key = 'configurable_parcels';
SELECT set_config('request.jwt.claims', '{"role":"anon","aal":"aal1"}', true);
SELECT public.assert_configurable_parcel_creation_allowed();

UPDATE public.configurable_parcel_feature_settings
SET feature_state = 'OFF', updated_at = NOW()
WHERE feature_key = 'configurable_parcels';
DO $$
DECLARE
  v_rejected BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM public.assert_configurable_parcel_creation_allowed();
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'OFF allowed new configurable parcel creation.';
  END IF;
END;
$$;

INSERT INTO parcel_foundation_results VALUES ('feature_state_roles', true);

-- Exercise RLS as the actual PostgREST role, not through metadata alone.
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"91200000-0000-0000-0000-000000000000","role":"authenticated","aal":"aal2"}',
  true
);
DO $$
DECLARE
  v_visible INTEGER;
  v_write_rejected BOOLEAN := false;
BEGIN
  SELECT COUNT(*) INTO v_visible
  FROM public.configurable_parcel_feature_settings;
  IF v_visible <> 1 THEN
    RAISE EXCEPTION 'Active owner could not read parcel foundation through RLS.';
  END IF;

  BEGIN
    INSERT INTO public.business_operations(operation_type)
    VALUES ('forbidden_client_write');
  EXCEPTION WHEN INSUFFICIENT_PRIVILEGE THEN
    v_write_rejected := true;
  END;
  IF NOT v_write_rejected THEN
    RAISE EXCEPTION 'Authenticated client obtained a direct business write.';
  END IF;
END;
$$;
RESET ROLE;

UPDATE public.profiles
SET is_active = false
WHERE id = '91200000-0000-0000-0000-000000000009';
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"91200000-0000-0000-0000-000000000009","role":"authenticated","aal":"aal2"}',
  true
);
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.configurable_parcel_feature_settings) <> 0 THEN
    RAISE EXCEPTION 'Inactive staff bypassed parcel foundation RLS.';
  END IF;
END;
$$;
RESET ROLE;

INSERT INTO parcel_foundation_results VALUES ('role_aware_rls', true);

DO $$
BEGIN
  IF public.get_configurable_parcel_feature_state() <> 'OFF' THEN
    RAISE EXCEPTION 'Runtime test did not restore feature state to OFF.';
  END IF;

  INSERT INTO parcel_foundation_results VALUES ('final_state_off', true);
END;
$$;

SELECT jsonb_build_object(
  'ok', BOOL_AND(passed),
  'featureState', public.get_configurable_parcel_feature_state(),
  'scenarios', jsonb_agg(scenario ORDER BY scenario)
) AS configurable_parcel_foundation_runtime_summary
FROM parcel_foundation_results;

COMMIT;
