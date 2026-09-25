\set ON_ERROR_STOP on

CREATE TEMP TABLE phase3_contract_results (
  scenario TEXT PRIMARY KEY,
  passed BOOLEAN NOT NULL
) ON COMMIT PRESERVE ROWS;

CREATE TEMP TABLE phase3_pos_runtime_state (
  state_key TEXT PRIMARY KEY,
  state_value TEXT NOT NULL
) ON COMMIT PRESERVE ROWS;

DO $$
DECLARE
  v_owner UUID := '92400000-0000-0000-0000-000000000001';
  v_cashier UUID := '92400000-0000-0000-0000-000000000002';
  v_owner_role UUID;
  v_cashier_role UUID;
  v_unit UUID := '92400000-0000-0000-0000-000000000010';
  v_category UUID := '92400000-0000-0000-0000-000000000011';
  v_family UUID := '92400000-0000-0000-0000-000000000100';
  v_sku_a UUID := '92400000-0000-0000-0000-000000000101';
  v_sku_b UUID := '92400000-0000-0000-0000-000000000102';
  v_other UUID := '92400000-0000-0000-0000-000000000103';
  v_branch UUID := '92400000-0000-0000-0000-000000000200';
  v_warehouse UUID := '92400000-0000-0000-0000-000000000201';
  v_config UUID := '92400000-0000-0000-0000-000000000300';
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, email_confirmed_at, raw_app_meta_data,
    raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_owner, 'authenticated', 'authenticated', 'phase3-owner@example.test', NOW(), '{}'::JSONB, '{}'::JSONB, NOW(), NOW()),
    (v_cashier, 'authenticated', 'authenticated', 'phase3-cashier@example.test', NOW(), '{}'::JSONB, '{}'::JSONB, NOW(), NOW());

  INSERT INTO public.profiles (id, full_name, is_active) VALUES
    (v_owner, 'Phase 3 Owner', true),
    (v_cashier, 'Phase 3 Cashier', true);
  INSERT INTO public.roles (code, name_ar) VALUES
    ('owner', 'مالك النظام'),
    ('sales', 'موظف مبيعات')
  ON CONFLICT (code) DO NOTHING;
  SELECT id INTO STRICT v_owner_role FROM public.roles WHERE code = 'owner';
  SELECT id INTO STRICT v_cashier_role FROM public.roles WHERE code = 'sales';
  INSERT INTO public.user_roles (user_id, role_id) VALUES
    (v_owner, v_owner_role),
    (v_cashier, v_cashier_role);

  INSERT INTO public.units (id, code, name_ar)
  VALUES (v_unit, 'P3-BASE', 'باكيت');
  INSERT INTO public.categories (id, code, name_ar, is_active)
  VALUES (v_category, 'P3-CAT', 'فئة Phase 3', true);

  INSERT INTO public.products (
    id, sku, name_ar, category_id, unit_id, purchase_unit_id, sale_unit_id,
    units_per_purchase_unit, units_per_sale_unit,
    default_purchase_price_in_minor_units,
    default_sale_price_in_minor_units,
    cost_price_in_minor_units, sale_price_in_minor_units,
    wholesale_price_in_minor_units, min_stock_level, is_active,
    is_flavor_master, wac_cost_in_minor_units_exact
  ) VALUES
    (v_family, 'P3-FAMILY', 'عائلة Phase 3', v_category, v_unit, v_unit, v_unit,
      5, 5, 3800, 5000, 8, 1000, 5000, 0, true, true, 8.000000),
    (v_other, 'P3-OTHER', 'منتج مختلف', v_category, v_unit, v_unit, v_unit,
      5, 5, 3000, 4500, 7, 900, 4500, 0, true, false, 7.000000);

  INSERT INTO public.products (
    id, sku, name_ar, category_id, flavor_master_product_id, flavor_name_ar,
    min_stock_level, is_active
  ) VALUES
    (v_sku_a, 'P3-A', 'نكهة أ', v_category, v_family, 'أ', 0, true),
    (v_sku_b, 'P3-B', 'نكهة ب', v_category, v_family, 'ب', 0, true);
  UPDATE public.products
  SET wac_cost_in_minor_units_exact = CASE id
    WHEN v_sku_a THEN 10.333333
    WHEN v_sku_b THEN 5.666667
  END,
  cost_price_in_minor_units = CASE id WHEN v_sku_a THEN 10 ELSE 6 END,
  unit_id = v_unit,
  purchase_unit_id = v_unit,
  sale_unit_id = v_unit,
  units_per_purchase_unit = 1,
  units_per_sale_unit = 1,
  default_purchase_price_in_minor_units = CASE id WHEN v_sku_a THEN 10 ELSE 6 END,
  default_sale_price_in_minor_units = 1000,
  sale_price_in_minor_units = 1000,
  wholesale_price_in_minor_units = 1000
  WHERE id IN (v_sku_a, v_sku_b);

  INSERT INTO public.branches (id, code, name_ar, is_active)
  VALUES (v_branch, 'P3-BR', 'فرع Phase 3', true);
  INSERT INTO public.warehouses (id, branch_id, code, name_ar, is_active)
  VALUES (v_warehouse, v_branch, 'P3-WH', 'مستودع Phase 3', true);
  INSERT INTO public.cash_shifts (
    id, shift_number, branch_id, opened_by, opening_cash_in_minor_units
  ) VALUES (
    '92400000-0000-0000-0000-000000000202', 'P3-SHIFT-1',
    v_branch, v_owner, 0
  );
  INSERT INTO public.inventory_balances (
    warehouse_id, product_id, on_hand_quantity, reserved_quantity
  ) VALUES
    (v_warehouse, v_sku_a, 100, 0),
    (v_warehouse, v_sku_b, 100, 0),
    (v_warehouse, v_other, 100, 0);

  INSERT INTO public.product_parcel_configurations (
    id, family_product_id, composition_mode, configuration_revision
  ) VALUES (v_config, v_family, 'configurable_mix', 1);

  INSERT INTO phase3_contract_results VALUES ('fixture_setup', true);
END;
$$;

DO $$
DECLARE
  v_owner UUID := '92400000-0000-0000-0000-000000000001';
  v_actor_hash TEXT;
  v_request_a JSONB;
  v_request_b JSONB;
  v_canonical_a JSONB;
  v_canonical_b JSONB;
  v_base JSONB;
BEGIN
  v_actor_hash := public.phase3_actor_scope_hash_internal(
    'erp_user', v_owner, NULL, NULL
  );
  IF v_actor_hash !~ '^[0-9a-f]{64}$'
    OR v_actor_hash IS DISTINCT FROM public.phase3_actor_scope_hash_internal(
      'erp_user', v_owner, NULL, NULL
    )
  THEN
    RAISE EXCEPTION 'Phase 3 ERP actor hash is not deterministic.';
  END IF;

  v_request_a := JSONB_BUILD_OBJECT(
    'contract_version', 'phase3-sale-v1',
    'actor_scope_type', 'erp_user',
    'actor_scope_hash', v_actor_hash,
    'operation_source', 'admin_pos',
    'warehouse_id', '92400000-0000-0000-0000-000000000201',
    'branch_id', '92400000-0000-0000-0000-000000000200',
    'payment_method', 'cash',
    'lines', JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
      'commercial_line_kind', 'configurable_parcel',
      'family_product_id', '92400000-0000-0000-0000-000000000100',
      'parcel_configuration_id', '92400000-0000-0000-0000-000000000300',
      'configuration_revision', 1,
      'line_discount_in_minor_units', 0,
      'parcel_instances', JSONB_BUILD_ARRAY(
        JSONB_BUILD_OBJECT('components', JSONB_BUILD_ARRAY(
          JSONB_BUILD_OBJECT('product_id', '92400000-0000-0000-0000-000000000101', 'base_quantity', 2),
          JSONB_BUILD_OBJECT('product_id', '92400000-0000-0000-0000-000000000102', 'base_quantity', 3)
        )),
        JSONB_BUILD_OBJECT('components', JSONB_BUILD_ARRAY(
          JSONB_BUILD_OBJECT('product_id', '92400000-0000-0000-0000-000000000101', 'base_quantity', 1),
          JSONB_BUILD_OBJECT('product_id', '92400000-0000-0000-0000-000000000101', 'base_quantity', 1),
          JSONB_BUILD_OBJECT('product_id', '92400000-0000-0000-0000-000000000102', 'base_quantity', 3)
        ))
      )
    ))
  );
  v_request_b := JSONB_SET(
    v_request_a,
    '{lines,0,parcel_instances,0,components}',
    JSONB_BUILD_ARRAY(
      JSONB_BUILD_OBJECT('base_quantity', 3, 'product_id', '92400000-0000-0000-0000-000000000102'),
      JSONB_BUILD_OBJECT('base_quantity', 2, 'product_id', '92400000-0000-0000-0000-000000000101')
    )
  );

  v_canonical_a := public.phase3_canonicalize_sale_request_internal(v_request_a);
  v_canonical_b := public.phase3_canonicalize_sale_request_internal(v_request_b);
  IF v_canonical_a IS DISTINCT FROM v_canonical_b
    OR public.phase3_request_fingerprint_internal(v_canonical_a)
      IS DISTINCT FROM public.phase3_request_fingerprint_internal(v_canonical_b)
    OR JSONB_ARRAY_LENGTH(v_canonical_a #> '{lines,0,parcel_instances}') <> 2
    OR JSONB_ARRAY_LENGTH(v_canonical_a #> '{lines,0,parcel_instances,0,components}') <> 2
  THEN
    RAISE EXCEPTION 'Canonical Parcel request equivalence is incorrect.';
  END IF;

  v_base := public.phase3_canonicalize_sale_request_internal(JSONB_BUILD_OBJECT(
    'contract_version', 'phase3-sale-v1',
    'actor_scope_type', 'erp_user',
    'actor_scope_hash', v_actor_hash,
    'operation_source', 'admin_pos',
    'warehouse_id', '92400000-0000-0000-0000-000000000201',
    'lines', JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
      'commercial_line_kind', 'base_unit',
      'product_id', '92400000-0000-0000-0000-000000000101',
      'base_quantity', 1
    ))
  ));
  IF v_base #>> '{lines,0,commercial_line_kind}' <> 'base_unit' THEN
    RAISE EXCEPTION 'Canonical Base Unit contract failed.';
  END IF;

  INSERT INTO phase3_contract_results VALUES
    ('actor_scope', true),
    ('canonical_identity', true),
    ('multiple_instances', true),
    ('legacy_base_contract', true);
END;
$$;

DO $$
DECLARE
  v_owner UUID := '92400000-0000-0000-0000-000000000001';
  v_cashier UUID := '92400000-0000-0000-0000-000000000002';
  v_components JSONB := JSONB_BUILD_ARRAY(
    JSONB_BUILD_OBJECT('product_id', '92400000-0000-0000-0000-000000000101', 'base_quantity', 2),
    JSONB_BUILD_OBJECT('product_id', '92400000-0000-0000-0000-000000000102', 'base_quantity', 3)
  );
  v_validated JSONB;
  v_off_rejected BOOLEAN := false;
  v_cashier_rejected BOOLEAN := false;
  v_guest_rejected BOOLEAN := false;
BEGIN
  PERFORM SET_CONFIG('request.jwt.claim.role', 'authenticated', true);
  PERFORM SET_CONFIG('request.jwt.claim.sub', v_owner::TEXT, true);
  BEGIN
    PERFORM public.phase3_validate_configurable_parcel_internal(
      'erp_user', v_owner,
      '92400000-0000-0000-0000-000000000100',
      '92400000-0000-0000-0000-000000000300', 1, v_components
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM LIKE 'CONFIGURABLE_PARCEL_DISABLED:%' THEN
      v_off_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_off_rejected THEN
    RAISE EXCEPTION 'Feature OFF did not reject new configurable Parcel validation.';
  END IF;

  UPDATE public.configurable_parcel_feature_settings
  SET feature_state = 'OWNER_PILOT', updated_at = NOW()
  WHERE feature_key = 'configurable_parcels';
  v_validated := public.phase3_validate_configurable_parcel_internal(
    'erp_user', v_owner,
    '92400000-0000-0000-0000-000000000100',
    '92400000-0000-0000-0000-000000000300', 1, v_components
  );
  IF v_validated->>'composition_fingerprint' IS NULL
    OR JSONB_ARRAY_LENGTH(v_validated->'components') <> 2
  THEN
    RAISE EXCEPTION 'Owner pilot validation did not return canonical components.';
  END IF;

  PERFORM SET_CONFIG('request.jwt.claim.sub', v_cashier::TEXT, true);
  BEGIN
    PERFORM public.phase3_validate_configurable_parcel_internal(
      'erp_user', v_cashier,
      '92400000-0000-0000-0000-000000000100',
      '92400000-0000-0000-0000-000000000300', 1, v_components
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM LIKE 'CONFIGURABLE_PARCEL_DISABLED:%' THEN
      v_cashier_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;

  PERFORM SET_CONFIG('request.jwt.claim.role', 'service_role', true);
  PERFORM SET_CONFIG('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.phase3_validate_configurable_parcel_internal(
      'guest_gateway', NULL,
      '92400000-0000-0000-0000-000000000100',
      '92400000-0000-0000-0000-000000000300', 1, v_components
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM LIKE 'CONFIGURABLE_PARCEL_DISABLED:%' THEN
      v_guest_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_cashier_rejected OR NOT v_guest_rejected THEN
    RAISE EXCEPTION 'OWNER_PILOT actor matrix is incorrect.';
  END IF;

  UPDATE public.configurable_parcel_feature_settings
  SET feature_state = 'ENABLED', updated_at = NOW()
  WHERE feature_key = 'configurable_parcels';
  PERFORM public.phase3_validate_configurable_parcel_internal(
    'guest_gateway', NULL,
    '92400000-0000-0000-0000-000000000100',
    '92400000-0000-0000-0000-000000000300', 1, v_components
  );

  INSERT INTO phase3_contract_results VALUES
    ('feature_off', true),
    ('owner_pilot', true),
    ('guest_enabled', true),
    ('composition_validation', true);
END;
$$;

DO $$
DECLARE
  v_allocation JSONB;
  v_component_sum BIGINT;
BEGIN
  v_allocation := public.phase3_allocate_parcel_cogs_internal(JSONB_BUILD_ARRAY(
    JSONB_BUILD_OBJECT(
      'product_id', '92400000-0000-0000-0000-000000000101',
      'base_quantity', 2,
      'unit_cost_in_minor_units_exact', 10.333333
    ),
    JSONB_BUILD_OBJECT(
      'product_id', '92400000-0000-0000-0000-000000000102',
      'base_quantity', 3,
      'unit_cost_in_minor_units_exact', 5.666667
    )
  ));
  SELECT SUM((component->>'allocated_cogs_in_minor_units')::BIGINT)
  INTO v_component_sum
  FROM JSONB_ARRAY_ELEMENTS(v_allocation->'components') component;
  IF (v_allocation->>'total_cogs_in_minor_units')::BIGINT <> 38
    OR v_component_sum <> 38
    OR v_allocation #>> '{components,0,allocated_cogs_in_minor_units}' <> '21'
    OR v_allocation #>> '{components,1,allocated_cogs_in_minor_units}' <> '17'
  THEN
    RAISE EXCEPTION 'Deterministic per-instance COGS allocation is incorrect: %', v_allocation;
  END IF;
  INSERT INTO phase3_contract_results VALUES ('cogs_allocation', true);
END;
$$;

DO $$
DECLARE
  v_owner UUID := '92400000-0000-0000-0000-000000000001';
  v_operation UUID := '92400000-0000-0000-0000-000000000400';
  v_order UUID := '92400000-0000-0000-0000-000000000401';
  v_item UUID := '92400000-0000-0000-0000-000000000402';
  v_instance UUID := '92400000-0000-0000-0000-000000000403';
  v_actor_hash TEXT;
  v_request JSONB;
  v_fingerprint TEXT;
  v_replay JSONB;
  v_before JSONB;
  v_after JSONB;
BEGIN
  PERFORM SET_CONFIG('request.jwt.claim.role', 'authenticated', true);
  PERFORM SET_CONFIG('request.jwt.claim.sub', v_owner::TEXT, true);
  v_actor_hash := public.phase3_actor_scope_hash_internal('erp_user', v_owner, NULL, NULL);
  v_request := public.phase3_canonicalize_sale_request_internal(JSONB_BUILD_OBJECT(
    'contract_version', 'phase3-sale-v1',
    'actor_scope_type', 'erp_user',
    'actor_scope_hash', v_actor_hash,
    'operation_source', 'admin_pos',
    'warehouse_id', '92400000-0000-0000-0000-000000000201',
    'branch_id', '92400000-0000-0000-0000-000000000200',
    'payment_method', 'cash',
    'lines', JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
      'commercial_line_kind', 'configurable_parcel',
      'family_product_id', '92400000-0000-0000-0000-000000000100',
      'parcel_configuration_id', '92400000-0000-0000-0000-000000000300',
      'configuration_revision', 1,
      'parcel_instances', JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
        'components', JSONB_BUILD_ARRAY(
          JSONB_BUILD_OBJECT('product_id', '92400000-0000-0000-0000-000000000101', 'base_quantity', 2),
          JSONB_BUILD_OBJECT('product_id', '92400000-0000-0000-0000-000000000102', 'base_quantity', 3)
        )
      ))
    ))
  ));
  v_fingerprint := public.phase3_request_fingerprint_internal(v_request);

  INSERT INTO public.business_operations (
    id, operation_type, idempotency_key, request_fingerprint,
    initiated_by, result_snapshot, completed_at,
    request_identity_version, request_identity_snapshot,
    actor_scope_type, actor_scope_hash
  ) VALUES (
    v_operation, 'phase3_pos_sale_v1', 'phase3-runtime-replay-key',
    v_fingerprint, v_owner,
    JSONB_BUILD_OBJECT('success', true, 'order_id', v_order), NOW(),
    301, v_request, 'erp_user', v_actor_hash
  );

  SELECT TO_JSONB(operation) INTO v_before
  FROM public.business_operations operation WHERE operation.id = v_operation;
  v_replay := public.phase3_resolve_operation_replay_internal(
    'phase3_pos_sale_v1', 'phase3-runtime-replay-key',
    'erp_user', v_actor_hash, v_fingerprint
  );
  SELECT TO_JSONB(operation) INTO v_after
  FROM public.business_operations operation WHERE operation.id = v_operation;
  IF v_replay->>'decision' <> 'REPLAY'
    OR v_replay #>> '{result_snapshot,order_id}' <> v_order::TEXT
    OR v_before IS DISTINCT FROM v_after
  THEN
    RAISE EXCEPTION 'Exact replay was not immutable.';
  END IF;

  INSERT INTO public.orders (
    id, order_number, branch_id, warehouse_id, source, operation_id
  ) VALUES (v_order, 'P3-RUNTIME-1',
    '92400000-0000-0000-0000-000000000200',
    '92400000-0000-0000-0000-000000000201', 'website', v_operation);
  INSERT INTO public.order_items (
    id, order_id, product_id, product_name_snapshot, quantity,
    unit_price_in_minor_units, line_total_in_minor_units,
    commercial_line_kind, family_product_id, parcel_configuration_id,
    parcel_configuration_revision, base_unit_name_snapshot,
    allocated_discount_snapshot_in_minor_units,
    net_refundable_amount_snapshot_in_minor_units
  ) VALUES (
    v_item, v_order, NULL, 'طرد Phase 3', 5, 5000, 5000,
    'configurable_parcel', '92400000-0000-0000-0000-000000000100',
    '92400000-0000-0000-0000-000000000300', 1, 'باكيت', 0, 5000
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
    v_instance, v_item, v_order, v_operation,
    '92400000-0000-0000-0000-000000000300',
    '92400000-0000-0000-0000-000000000100', 1, 1, 5, 'طرد',
    5000, 0, 5000, 38,
    public.phase3_request_fingerprint_internal(v_request #> '{lines,0,parcel_instances,0,components}')
  );
  INSERT INTO public.order_parcel_components (
    parcel_instance_id, operation_id, product_id, base_quantity,
    product_name_snapshot, sku_snapshot, base_unit_name_snapshot,
    unit_cost_snapshot_in_minor_units, cogs_snapshot_in_minor_units
  ) VALUES
    (v_instance, v_operation, '92400000-0000-0000-0000-000000000101', 2,
      'نكهة أ', 'P3-A', 'باكيت', 10.333333, 21),
    (v_instance, v_operation, '92400000-0000-0000-0000-000000000102', 3,
      'نكهة ب', 'P3-B', 'باكيت', 5.666667, 17);
  PERFORM public.finalize_order_parcel_instance_internal(v_instance);

  INSERT INTO public.order_inventory_reservations (
    operation_id, order_id, order_item_id, parcel_instance_id,
    warehouse_id, product_id, reserved_quantity
  ) VALUES
    (v_operation, v_order, v_item, v_instance,
      '92400000-0000-0000-0000-000000000201',
      '92400000-0000-0000-0000-000000000101', 2),
    (v_operation, v_order, v_item, v_instance,
      '92400000-0000-0000-0000-000000000201',
      '92400000-0000-0000-0000-000000000102', 3);

  UPDATE public.order_inventory_reservations
  SET reservation_state = 'released', resolved_at = NOW()
  WHERE operation_id = v_operation
    AND product_id = '92400000-0000-0000-0000-000000000102';

  INSERT INTO phase3_contract_results VALUES
    ('immutable_replay', true),
    ('reservation_relationships', true),
    ('reservation_terminal_state', true);
END;
$$;

DO $$
DECLARE
  v_owner UUID := '92400000-0000-0000-0000-000000000001';
  v_employee UUID := '92400000-0000-0000-0000-000000000002';
  v_branch UUID := '92400000-0000-0000-0000-000000000200';
  v_warehouse UUID := '92400000-0000-0000-0000-000000000201';
  v_family UUID := '92400000-0000-0000-0000-000000000100';
  v_sku_a UUID := '92400000-0000-0000-0000-000000000101';
  v_sku_b UUID := '92400000-0000-0000-0000-000000000102';
  v_other UUID := '92400000-0000-0000-0000-000000000103';
  v_config UUID := '92400000-0000-0000-0000-000000000300';
  v_request JSONB;
  v_changed JSONB;
  v_result JSONB;
  v_replay JSONB;
  v_reversal JSONB;
  v_order_id UUID;
  v_operation_id UUID;
  v_before JSONB;
  v_after JSONB;
  v_error TEXT;
  v_state TEXT;
BEGIN
  PERFORM SET_CONFIG(
    'request.jwt.claims',
    JSONB_BUILD_OBJECT('sub', v_owner, 'role', 'authenticated', 'aal', 'aal2')::TEXT,
    true
  );
  UPDATE public.configurable_parcel_feature_settings
  SET feature_state = 'OWNER_PILOT', updated_at = NOW()
  WHERE feature_key = 'configurable_parcels';

  v_request := JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
    'commercial_line_kind', 'configurable_parcel',
    'family_product_id', v_family,
    'parcel_configuration_id', v_config,
    'configuration_revision', 1,
    'price_authority', 'server_catalog',
    'line_discount_in_minor_units', 0,
    'parcel_instances', JSONB_BUILD_ARRAY(
      JSONB_BUILD_OBJECT('components', JSONB_BUILD_ARRAY(
        JSONB_BUILD_OBJECT('product_id', v_sku_a, 'base_quantity', 2),
        JSONB_BUILD_OBJECT('product_id', v_sku_b, 'base_quantity', 3)
      )),
      JSONB_BUILD_OBJECT('components', JSONB_BUILD_ARRAY(
        JSONB_BUILD_OBJECT('product_id', v_sku_a, 'base_quantity', 1),
        JSONB_BUILD_OBJECT('product_id', v_sku_a, 'base_quantity', 1),
        JSONB_BUILD_OBJECT('product_id', v_sku_b, 'base_quantity', 3)
      ))
    )
  ));

  v_result := public.create_pos_sale_v2(
    v_warehouse, v_branch, NULL, 'عميل Phase 3', 'cash', v_request,
    3, 12000, 'phase3-pos-configurable-main-0001'
  );
  v_order_id := (v_result->>'orderId')::UUID;
  v_operation_id := (v_result->>'operationId')::UUID;
  INSERT INTO phase3_pos_runtime_state VALUES
    ('main_order_id', v_order_id::TEXT),
    ('main_operation_id', v_operation_id::TEXT);

  IF NOT COALESCE((v_result->>'success')::BOOLEAN, false)
    OR (v_result->>'subtotalInMinorUnits')::BIGINT <> 10000
    OR (v_result->>'discountInMinorUnits')::BIGINT <> 3
    OR (v_result->>'totalInMinorUnits')::BIGINT <> 9997
    OR (v_result #>> '{items,0,cogsInMinorUnits}')::BIGINT <> 76
    OR (v_result #>> '{items,0,profitInMinorUnits}')::BIGINT <> 9921
    OR JSONB_ARRAY_LENGTH(v_result #> '{items,0,parcelInstances}') <> 2
  THEN
    RAISE EXCEPTION 'Configurable Parcel POS result is incorrect: %', v_result;
  END IF;

  IF (SELECT COUNT(*) FROM public.order_items
      WHERE order_id = v_order_id AND commercial_line_kind = 'configurable_parcel'
        AND quantity = 2 AND sale_package_quantity = 2
        AND allocated_discount_snapshot_in_minor_units = 3
        AND net_refundable_amount_snapshot_in_minor_units = 9997
        AND cogs_in_minor_units = 76 AND profit_in_minor_units = 9921) <> 1
    OR (SELECT COUNT(*) FROM public.order_parcel_instances
      WHERE order_id = v_order_id AND finalized_at IS NOT NULL) <> 2
    OR (SELECT SUM(allocated_discount_snapshot_in_minor_units)
      FROM public.order_parcel_instances WHERE order_id = v_order_id) <> 3
    OR (SELECT SUM(net_refundable_amount_snapshot_in_minor_units)
      FROM public.order_parcel_instances WHERE order_id = v_order_id) <> 9997
    OR (SELECT SUM(cogs_snapshot_in_minor_units)
      FROM public.order_parcel_instances WHERE order_id = v_order_id) <> 76
    OR (SELECT COUNT(*) FROM public.order_parcel_components component
      JOIN public.order_parcel_instances instance ON instance.id = component.parcel_instance_id
      WHERE instance.order_id = v_order_id) <> 4
    OR (SELECT on_hand_quantity FROM public.inventory_balances
      WHERE warehouse_id = v_warehouse AND product_id = v_sku_a) <> 96
    OR (SELECT on_hand_quantity FROM public.inventory_balances
      WHERE warehouse_id = v_warehouse AND product_id = v_sku_b) <> 94
    OR EXISTS (SELECT 1 FROM public.inventory_balances
      WHERE warehouse_id = v_warehouse AND product_id = v_family)
    OR (SELECT COUNT(*) FROM public.inventory_movements
      WHERE operation_id = v_operation_id AND parcel_component_id IS NOT NULL
        AND reference_id = v_order_id) <> 4
  THEN
    RAISE EXCEPTION 'Configurable Parcel persistence/inventory invariants failed.';
  END IF;

  -- Exact replay is resolved before feature, price, WAC or inventory state.
  UPDATE public.configurable_parcel_feature_settings
  SET feature_state = 'OFF', updated_at = NOW()
  WHERE feature_key = 'configurable_parcels';
  UPDATE public.products SET default_sale_price_in_minor_units = 7777
  WHERE id = v_family;
  UPDATE public.products SET wac_cost_in_minor_units_exact = 999.999999
  WHERE id = v_sku_a;
  SELECT JSONB_BUILD_OBJECT(
    'operation', (SELECT TO_JSONB(operation) FROM public.business_operations operation
      WHERE operation.id = v_operation_id),
    'orders', (SELECT JSONB_AGG(TO_JSONB(orders) ORDER BY orders.id)
      FROM public.orders orders WHERE orders.operation_id = v_operation_id),
    'items', (SELECT JSONB_AGG(TO_JSONB(item) ORDER BY item.id)
      FROM public.order_items item WHERE item.order_id = v_order_id),
    'instances', (SELECT JSONB_AGG(TO_JSONB(instance) ORDER BY instance.id)
      FROM public.order_parcel_instances instance WHERE instance.order_id = v_order_id),
    'components', (SELECT JSONB_AGG(TO_JSONB(component) ORDER BY component.id)
      FROM public.order_parcel_components component
      JOIN public.order_parcel_instances instance ON instance.id = component.parcel_instance_id
      WHERE instance.order_id = v_order_id),
    'movements', (SELECT JSONB_AGG(TO_JSONB(movement) ORDER BY movement.id)
      FROM public.inventory_movements movement WHERE movement.operation_id = v_operation_id),
    'shift', (SELECT TO_JSONB(shift) FROM public.cash_shifts shift
      WHERE shift.id = '92400000-0000-0000-0000-000000000202')
  ) INTO v_before;
  v_replay := public.create_pos_sale_v2(
    v_warehouse, v_branch, NULL, 'عميل Phase 3', 'cash', v_request,
    3, 12000, 'phase3-pos-configurable-main-0001'
  );
  SELECT JSONB_BUILD_OBJECT(
    'operation', (SELECT TO_JSONB(operation) FROM public.business_operations operation
      WHERE operation.id = v_operation_id),
    'orders', (SELECT JSONB_AGG(TO_JSONB(orders) ORDER BY orders.id)
      FROM public.orders orders WHERE orders.operation_id = v_operation_id),
    'items', (SELECT JSONB_AGG(TO_JSONB(item) ORDER BY item.id)
      FROM public.order_items item WHERE item.order_id = v_order_id),
    'instances', (SELECT JSONB_AGG(TO_JSONB(instance) ORDER BY instance.id)
      FROM public.order_parcel_instances instance WHERE instance.order_id = v_order_id),
    'components', (SELECT JSONB_AGG(TO_JSONB(component) ORDER BY component.id)
      FROM public.order_parcel_components component
      JOIN public.order_parcel_instances instance ON instance.id = component.parcel_instance_id
      WHERE instance.order_id = v_order_id),
    'movements', (SELECT JSONB_AGG(TO_JSONB(movement) ORDER BY movement.id)
      FROM public.inventory_movements movement WHERE movement.operation_id = v_operation_id),
    'shift', (SELECT TO_JSONB(shift) FROM public.cash_shifts shift
      WHERE shift.id = '92400000-0000-0000-0000-000000000202')
  ) INTO v_after;
  IF v_replay IS DISTINCT FROM v_result OR v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'Exact V2 replay was not a zero-write immutable response.';
  END IF;

  v_changed := JSONB_SET(
    v_request, '{0,parcel_instances,0,components}',
    JSONB_BUILD_ARRAY(
      JSONB_BUILD_OBJECT('product_id', v_sku_a, 'base_quantity', 1),
      JSONB_BUILD_OBJECT('product_id', v_sku_b, 'base_quantity', 4)
    )
  );
  BEGIN
    PERFORM public.create_pos_sale_v2(
      v_warehouse, v_branch, NULL, 'عميل Phase 3', 'cash', v_changed,
      3, 12000, 'phase3-pos-configurable-main-0001'
    );
    RAISE EXCEPTION 'Changed composition replay was accepted.';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error NOT LIKE 'PHASE3_IDEMPOTENCY_CONFLICT:%' THEN RAISE; END IF;
  END;
  SELECT TO_JSONB(operation) INTO v_after
  FROM public.business_operations operation WHERE operation.id = v_operation_id;
  IF v_after IS DISTINCT FROM v_before->'operation' THEN
    RAISE EXCEPTION 'Changed composition conflict mutated operation identity.';
  END IF;

  PERFORM SET_CONFIG(
    'request.jwt.claims',
    JSONB_BUILD_OBJECT('sub', v_employee, 'role', 'authenticated', 'aal', 'aal1')::TEXT,
    true
  );
  BEGIN
    PERFORM public.create_pos_sale_v2(
      v_warehouse, v_branch, NULL, 'عميل Phase 3', 'cash', v_request,
      3, 12000, 'phase3-pos-configurable-main-0001'
    );
    RAISE EXCEPTION 'Cross-actor V2 replay was accepted.';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error NOT LIKE 'PHASE3_IDEMPOTENCY_CONFLICT:%' THEN RAISE; END IF;
  END;

  -- Historical reversal uses immutable Components and remains available OFF.
  PERFORM SET_CONFIG(
    'request.jwt.claims',
    JSONB_BUILD_OBJECT('sub', v_owner, 'role', 'authenticated', 'aal', 'aal2')::TEXT,
    true
  );
  UPDATE public.products SET default_sale_price_in_minor_units = 5000
  WHERE id = v_family;
  UPDATE public.products SET wac_cost_in_minor_units_exact = 10.333333
  WHERE id = v_sku_a;
  v_reversal := public.reverse_pos_sale(
    v_order_id, 'عكس طرد Phase 3 التجريبي',
    'phase3-pos-config-reversal-0001'
  );
  IF NOT COALESCE((v_reversal->>'success')::BOOLEAN, false)
    OR (v_reversal #>> '{actual_effect,cogs_in_minor_units}')::BIGINT <> 76
    OR (v_reversal #>> '{actual_effect,profit_in_minor_units}')::BIGINT <> 9921
    OR (v_reversal #>> '{actual_effect,restored_base_units}')::INTEGER <> 10
    OR (SELECT status FROM public.orders WHERE id = v_order_id) <> 'cancelled'
    OR (SELECT on_hand_quantity FROM public.inventory_balances
      WHERE warehouse_id = v_warehouse AND product_id = v_sku_a) <> 100
    OR (SELECT on_hand_quantity FROM public.inventory_balances
      WHERE warehouse_id = v_warehouse AND product_id = v_sku_b) <> 100
    OR (SELECT COUNT(*) FROM public.inventory_movements
      WHERE reference_type = 'pos_sale_reversal'
        AND reference_id = (v_reversal->>'reversal_id')::UUID
        AND parcel_component_id IS NOT NULL) <> 4
  THEN
    RAISE EXCEPTION 'Configurable Parcel reversal did not restore immutable truth: %', v_reversal;
  END IF;
  v_result := public.reverse_pos_sale(
    v_order_id, 'إعادة شبكة لا تغيّر الحقيقة',
    'phase3-pos-config-reversal-0001'
  );
  IF NOT COALESCE((v_result->>'idempotent')::BOOLEAN, false)
    OR v_result->>'reversal_id' <> v_reversal->>'reversal_id'
  THEN
    RAISE EXCEPTION 'Configurable Parcel reversal replay is not idempotent.';
  END IF;

  -- OFF blocks only new configurable creation; Base Unit V2 remains available.
  BEGIN
    PERFORM public.create_pos_sale_v2(
      v_warehouse, v_branch, NULL, 'جديد مرفوض', 'cash', v_request,
      0, 10000, 'phase3-pos-feature-off-new-0001'
    );
    RAISE EXCEPTION 'Feature OFF allowed a new configurable sale.';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error NOT LIKE 'CONFIGURABLE_PARCEL_DISABLED:%' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.orders
      WHERE idempotency_key = 'phase3-pos-feature-off-new-0001')
    OR EXISTS (SELECT 1 FROM public.business_operations
      WHERE idempotency_key = 'phase3-pos-feature-off-new-0001')
  THEN RAISE EXCEPTION 'Feature OFF rejection left business state.'; END IF;

  v_result := public.create_pos_sale_v2(
    v_warehouse, v_branch, NULL, 'بيع وحدة', 'cash',
    JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
      'commercial_line_kind', 'base_unit', 'product_id', v_sku_a,
      'base_quantity', 2, 'price_authority', 'server_catalog',
      'line_discount_in_minor_units', 0
    )), 0, 2000, 'phase3-pos-base-off-allowed-0001'
  );
  IF v_result #>> '{items,0,commercialLineKind}' <> 'base_unit'
    OR (v_result #>> '{items,0,baseQuantity}')::INTEGER <> 2
  THEN RAISE EXCEPTION 'Base Unit V2 compatibility failed while feature OFF.'; END IF;

  -- V2-first blocks a legacy V1 interpretation of the same raw key.
  BEGIN
    PERFORM public.create_pos_sale(
      v_warehouse, v_branch, NULL, 'V1 after V2', 'cash',
      JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('product_id', v_sku_a, 'quantity', 2)),
      0, 2000, 'phase3-pos-base-off-allowed-0001'
    );
    RAISE EXCEPTION 'V1 accepted a key consumed by V2.';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error NOT LIKE 'IDEMPOTENCY_CONFLICT:%' THEN RAISE; END IF;
  END;

  -- V1-first likewise fails closed in V2 with zero additional effects.
  v_result := public.create_pos_sale(
    v_warehouse, v_branch, NULL, 'V1 first', 'cash',
    JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('product_id', v_other, 'quantity', 1)),
    0, 4500, 'phase3-cross-version-v1-first-0001'
  );
  SELECT JSONB_BUILD_OBJECT(
    'orders', (SELECT COUNT(*) FROM public.orders),
    'movements', (SELECT COUNT(*) FROM public.inventory_movements),
    'other_stock', (SELECT on_hand_quantity FROM public.inventory_balances
      WHERE warehouse_id = v_warehouse AND product_id = v_other),
    'operations', (SELECT COUNT(*) FROM public.business_operations)
  ) INTO v_before;
  BEGIN
    PERFORM public.create_pos_sale_v2(
      v_warehouse, v_branch, NULL, 'V2 after V1', 'cash',
      JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
        'commercial_line_kind', 'legacy_single_sku_parcel',
        'product_id', v_other, 'parcel_quantity', 1,
        'units_per_parcel', 5, 'price_authority', 'server_catalog',
        'line_discount_in_minor_units', 0
      )), 0, 4500, 'phase3-cross-version-v1-first-0001'
    );
    RAISE EXCEPTION 'V2 accepted a key consumed by V1.';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error NOT LIKE 'PHASE3_IDEMPOTENCY_CONFLICT:%' THEN RAISE; END IF;
  END;
  SELECT JSONB_BUILD_OBJECT(
    'orders', (SELECT COUNT(*) FROM public.orders),
    'movements', (SELECT COUNT(*) FROM public.inventory_movements),
    'other_stock', (SELECT on_hand_quantity FROM public.inventory_balances
      WHERE warehouse_id = v_warehouse AND product_id = v_other),
    'operations', (SELECT COUNT(*) FROM public.business_operations)
  ) INTO v_after;
  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'Cross-version V1-first conflict left business writes.';
  END IF;

  -- OWNER_PILOT allows owner but rejects a non-owner sales employee.
  UPDATE public.configurable_parcel_feature_settings
  SET feature_state = 'OWNER_PILOT', updated_at = NOW()
  WHERE feature_key = 'configurable_parcels';
  v_result := public.create_pos_sale_v2(
    v_warehouse, v_branch, NULL, 'مالك تجريبي', 'cash',
    JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
      'commercial_line_kind', 'configurable_parcel',
      'family_product_id', v_family,
      'parcel_configuration_id', v_config,
      'configuration_revision', 1,
      'price_authority', 'server_catalog',
      'line_discount_in_minor_units', 0,
      'parcel_instances', JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
        'components', JSONB_BUILD_ARRAY(
          JSONB_BUILD_OBJECT('product_id', v_sku_a, 'base_quantity', 2),
          JSONB_BUILD_OBJECT('product_id', v_sku_b, 'base_quantity', 3)
        )
      ))
    )), 0, 5000, 'phase3-owner-pilot-sale-0000001'
  );
  IF NOT COALESCE((v_result->>'success')::BOOLEAN, false) THEN
    RAISE EXCEPTION 'OWNER_PILOT did not allow owner sale.';
  END IF;

  PERFORM SET_CONFIG(
    'request.jwt.claims',
    JSONB_BUILD_OBJECT('sub', v_employee, 'role', 'authenticated', 'aal', 'aal1')::TEXT,
    true
  );
  BEGIN
    PERFORM public.create_pos_sale_v2(
      v_warehouse, v_branch, NULL, 'موظف مرفوض', 'cash', v_request,
      0, 10000, 'phase3-employee-pilot-reject-0001'
    );
    RAISE EXCEPTION 'OWNER_PILOT allowed non-owner sale.';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error NOT LIKE 'CONFIGURABLE_PARCEL_DISABLED:%' THEN RAISE; END IF;
  END;

  PERFORM SET_CONFIG(
    'request.jwt.claims',
    JSONB_BUILD_OBJECT('sub', v_owner, 'role', 'authenticated', 'aal', 'aal2')::TEXT,
    true
  );
  UPDATE public.configurable_parcel_feature_settings
  SET feature_state = 'ENABLED', updated_at = NOW()
  WHERE feature_key = 'configurable_parcels';

  BEGIN
    PERFORM public.create_pos_sale_v2(
      v_warehouse, v_branch, NULL, 'Config stale', 'cash',
      JSONB_SET(v_request, '{0,configuration_revision}', '2'::JSONB),
      0, 10000, 'phase3-stale-config-reject-0001'
    );
    RAISE EXCEPTION 'Stale configuration was accepted.';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error NOT LIKE 'PARCEL_CONFIGURATION_STALE:%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.create_pos_sale_v2(
      v_warehouse, v_branch, NULL, 'Insufficient', 'cash',
      JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
        'commercial_line_kind', 'base_unit', 'product_id', v_sku_b,
        'base_quantity', 10000, 'price_authority', 'server_catalog',
        'line_discount_in_minor_units', 0
      )), 0, 10000000, 'phase3-insufficient-stock-000001'
    );
    RAISE EXCEPTION 'Insufficient inventory sale was accepted.';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error NOT LIKE 'PHASE3_POS_INSUFFICIENT_INVENTORY:%' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.orders
      WHERE idempotency_key = 'phase3-insufficient-stock-000001') -- gitleaks:allow test fixture
    OR EXISTS (SELECT 1 FROM public.business_operations
      WHERE idempotency_key = 'phase3-insufficient-stock-000001') -- gitleaks:allow test fixture
  THEN RAISE EXCEPTION 'Insufficient inventory rejection left business state.'; END IF;

  INSERT INTO phase3_contract_results VALUES
    ('pos_v2_configurable_sale', true),
    ('pos_v2_multiple_instances', true),
    ('pos_v2_repeated_component_aggregation', true),
    ('pos_v2_parent_revenue_component_cogs', true),
    ('pos_v2_inventory_component_only', true),
    ('pos_v2_exact_replay_zero_write', true),
    ('pos_v2_changed_composition_conflict', true),
    ('pos_v2_cross_actor_privacy', true),
    ('pos_v2_feature_matrix', true),
    ('pos_v2_base_unit_compatibility', true),
    ('pos_v2_cross_version_v1_first', true),
    ('pos_v2_cross_version_v2_first', true),
    ('pos_v2_insufficient_rollback', true),
    ('pos_v2_stale_config', true),
    ('pos_v2_parcel_reversal', true),
    ('pos_v2_reversal_replay', true);
END;
$$;

-- Use a separate transaction so PostgreSQL's transaction-stable NOW() mirrors
-- real sequential sales when the later-movement guard compares timestamps.
DO $$
DECLARE
  v_owner UUID := '92400000-0000-0000-0000-000000000001';
  v_warehouse UUID := '92400000-0000-0000-0000-000000000201';
  v_branch UUID := '92400000-0000-0000-0000-000000000200';
  v_other UUID := '92400000-0000-0000-0000-000000000103';
  v_result JSONB;
  v_reversal JSONB;
BEGIN
  PERFORM SET_CONFIG(
    'request.jwt.claims',
    JSONB_BUILD_OBJECT('sub', v_owner, 'role', 'authenticated', 'aal', 'aal2')::TEXT,
    true
  );
  v_result := public.create_pos_sale(
    v_warehouse, v_branch, NULL, 'Legacy reverse', 'cash',
    JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('product_id', v_other, 'quantity', 1)),
    0, 4500, 'phase3-legacy-reversal-sale-0001'
  );
  v_reversal := public.reverse_pos_sale(
    (v_result->>'orderId')::UUID, 'عكس بيع Legacy للتراجع',
    'phase3-legacy-reversal-key-00001'
  );
  IF NOT COALESCE((v_reversal->>'success')::BOOLEAN, false)
    OR (v_reversal #>> '{actual_effect,restored_base_units}')::INTEGER <> 5
  THEN RAISE EXCEPTION 'Legacy POS reversal regressed.'; END IF;
  INSERT INTO phase3_contract_results VALUES ('pos_v2_legacy_reversal', true);
END;
$$;

SELECT JSONB_BUILD_OBJECT(
  'ok', BOOL_AND(passed),
  'scenarios', JSONB_AGG(scenario ORDER BY scenario),
  'operationRows', (
    SELECT COUNT(*) FROM public.business_operations
    WHERE operation_type LIKE 'phase3_%'
  ),
  'reservationRows', (
    SELECT COUNT(*) FROM public.order_inventory_reservations
    WHERE operation_id = '92400000-0000-0000-0000-000000000400'
  ),
  'featureState', public.get_configurable_parcel_feature_state()
)
FROM phase3_contract_results;
