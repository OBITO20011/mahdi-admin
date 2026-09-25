\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE phase4_foundation_results (
  scenario TEXT PRIMARY KEY,
  passed BOOLEAN NOT NULL
) ON COMMIT DROP;

DO $phase4$
DECLARE
  v_owner UUID := '92400000-0000-0000-0000-000000000001';
  v_sku_a UUID := '92400000-0000-0000-0000-000000000101';
  v_sku_b UUID := '92400000-0000-0000-0000-000000000102';
  v_family UUID := '92400000-0000-0000-0000-000000000100';
  v_configuration UUID := '92400000-0000-0000-0000-000000000300';
  v_order_id UUID;
  v_order_item_id UUID;
  v_parcel_id UUID;
  v_branch_id UUID;
  v_warehouse_id UUID;
  v_shift_id UUID;
  v_sale_operation_id UUID;
  v_entitlement BIGINT;
  v_cogs BIGINT;
  v_units INTEGER;
  v_damage_price BIGINT;
  v_customer_result JSONB;
  v_customer_order_id UUID;
  v_cap_sale_result JSONB;
  v_cap_order_id UUID;
  v_cap_order_item_id UUID;
  v_cap_parcel_id UUID;
  v_cap_cogs BIGINT;
  v_redemptions_before BIGINT;
  v_redemptions_after BIGINT;
  v_error_state TEXT;
  v_error_message TEXT;
  v_cancel_operation UUID := 'f4400000-0000-4000-8000-000000000001';
  v_cancel_event UUID := 'f4400000-0000-4000-8000-000000000002';
  v_cancel_item UUID := 'f4400000-0000-4000-8000-000000000003';
  v_return_operation UUID := 'f4400000-0000-4000-8000-000000000011';
  v_return_event UUID := 'f4400000-0000-4000-8000-000000000012';
  v_return_item UUID := 'f4400000-0000-4000-8000-000000000013';
  v_duplicate_operation UUID := 'f4400000-0000-4000-8000-000000000021';
  v_duplicate_event UUID := 'f4400000-0000-4000-8000-000000000022';
  v_duplicate_item UUID := 'f4400000-0000-4000-8000-000000000023';
  v_cap_return_operation UUID := 'f4400000-0000-4000-8000-000000000031';
  v_cap_return_event UUID := 'f4400000-0000-4000-8000-000000000032';
  v_cap_return_item UUID := 'f4400000-0000-4000-8000-000000000033';
BEGIN
  SELECT customer_order.id, item.id, instance.id, customer_order.branch_id,
    customer_order.warehouse_id, customer_order.cash_shift_id,
    customer_order.operation_id,
    instance.net_refundable_amount_snapshot_in_minor_units,
    instance.cogs_snapshot_in_minor_units,
    instance.units_per_parcel_snapshot
  INTO STRICT v_order_id, v_order_item_id, v_parcel_id, v_branch_id,
    v_warehouse_id, v_shift_id, v_sale_operation_id, v_entitlement, v_cogs,
    v_units
  FROM public.orders customer_order
  JOIN public.order_items item ON item.order_id = customer_order.id
  JOIN public.order_parcel_instances instance ON instance.order_item_id = item.id
  WHERE customer_order.status = 'completed'
    AND customer_order.source = 'pos'
    AND item.commercial_line_kind = 'configurable_parcel'
  ORDER BY customer_order.created_at DESC
  LIMIT 1;

  IF EXISTS (
    SELECT 1 FROM public.order_parcel_components component
    WHERE component.parcel_instance_id = v_parcel_id
      AND component.effective_standalone_unit_sale_price_snapshot_in_minor_units
        IS DISTINCT FROM 1000
  ) THEN
    RAISE EXCEPTION 'POS V2 did not persist the authoritative normal standalone price.';
  END IF;
  INSERT INTO phase4_foundation_results VALUES ('pos_effective_price_snapshot', true);

  INSERT INTO public.promotion_codes(
    id, code, description_ar, discount_type, discount_value,
    minimum_subtotal_in_minor_units, is_active
  ) VALUES
    ('f4410000-0000-4000-8000-000000000001', 'P4UNIT200',
      'Phase 4 effective standalone price', 'fixed', 200, 0, true),
    ('f4410000-0000-4000-8000-000000000002', 'P4MINIMUM',
      'Phase 4 ineligible minimum', 'fixed', 200, 2000, true),
    ('f4410000-0000-4000-8000-000000000003', 'P4FREEUNIT',
      'Phase 4 zero effective price', 'fixed', 1000, 0, true);

  SELECT COUNT(*) INTO v_redemptions_before
  FROM public.promotion_redemptions redemption
  JOIN public.promotion_codes promotion
    ON promotion.id = redemption.promotion_code_id
  WHERE promotion.code IN ('P4UNIT200', 'P4MINIMUM', 'P4FREEUNIT');

  IF public.phase4_effective_standalone_unit_price_internal(
      v_sku_a, 'customer_v2', '0795550991', 'P4UNIT200', statement_timestamp()
    ) <> 800
    OR public.phase4_effective_standalone_unit_price_internal(
      v_sku_a, 'customer_v2', '0795550991', 'P4MINIMUM', statement_timestamp()
    ) <> 1000
    OR public.phase4_effective_standalone_unit_price_internal(
      v_sku_a, 'customer_v2', '0795550991', 'P4FREEUNIT', statement_timestamp()
    ) <> 0
  THEN
    RAISE EXCEPTION 'Effective standalone pricing rules did not match the authoritative one-unit sale.';
  END IF;

  SELECT COUNT(*) INTO v_redemptions_after
  FROM public.promotion_redemptions redemption
  JOIN public.promotion_codes promotion
    ON promotion.id = redemption.promotion_code_id
  WHERE promotion.code IN ('P4UNIT200', 'P4MINIMUM', 'P4FREEUNIT');
  IF v_redemptions_after <> v_redemptions_before THEN
    RAISE EXCEPTION 'Standalone pricing resolution consumed promotion quota.';
  END IF;
  INSERT INTO phase4_foundation_results VALUES ('pricing_resolver_side_effect_free', true);

  INSERT INTO public.inventory_balances(
    warehouse_id, product_id, on_hand_quantity, reserved_quantity
  )
  SELECT storefront.id, product.id, 100, 0
  FROM (
    SELECT warehouse.id
    FROM public.warehouses warehouse
    JOIN public.branches branch ON branch.id = warehouse.branch_id
    WHERE warehouse.is_active AND branch.is_active
    ORDER BY warehouse.created_at, warehouse.id
    LIMIT 1
  ) storefront
  CROSS JOIN public.products product
  WHERE product.id IN (v_sku_a, v_sku_b)
  ON CONFLICT (warehouse_id, product_id) DO UPDATE
    SET on_hand_quantity = 100, reserved_quantity = 0;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  v_customer_result := public.submit_guest_customer_order_v2(
    'f4420000-0000-4000-8000-000000000001', repeat('c', 64), repeat('d', 64),
    'عميل Phase 4', '0795550991', 'إربد', 'الرمثا', 'الحي', 'الشارع',
    NULL, NULL, NULL, NULL, NULL, NULL,
    JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
      'commercial_line_kind', 'configurable_parcel',
      'family_product_id', v_family,
      'parcel_configuration_id', v_configuration,
      'configuration_revision', 1,
      'expected_unit_price_in_minor_units', 5000,
      'parcel_instances', JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
        'components', JSONB_BUILD_ARRAY(
          JSONB_BUILD_OBJECT('product_id', v_sku_a, 'base_quantity', 2),
          JSONB_BUILD_OBJECT('product_id', v_sku_b, 'base_quantity', 3)
        )
      ))
    )),
    'P4UNIT200', 'cash_on_delivery', 'inside_ramtha', 5000, 200, 0, 4800
  );
  v_customer_order_id := (v_customer_result->>'order_id')::UUID;

  IF (SELECT COUNT(*) FROM public.order_parcel_components component
      JOIN public.order_parcel_instances instance
        ON instance.id = component.parcel_instance_id
      WHERE instance.order_id = v_customer_order_id
        AND component.effective_standalone_unit_sale_price_snapshot_in_minor_units = 800) <> 2
  THEN
    RAISE EXCEPTION 'Customer V2 did not freeze the effective standalone offer price.';
  END IF;
  IF (SELECT COUNT(*) FROM public.promotion_redemptions redemption
      WHERE redemption.order_id = v_customer_order_id) <> 1 THEN
    RAISE EXCEPTION 'Price snapshots created an extra or missing promotion redemption.';
  END IF;

  UPDATE public.products SET sale_price_in_minor_units = 1300
  WHERE id IN (v_sku_a, v_sku_b);
  UPDATE public.promotion_codes SET discount_value = 300
  WHERE code = 'P4UNIT200';
  IF EXISTS (
    SELECT 1 FROM public.order_parcel_components component
    JOIN public.order_parcel_instances instance
      ON instance.id = component.parcel_instance_id
    WHERE instance.order_id = v_customer_order_id
      AND component.effective_standalone_unit_sale_price_snapshot_in_minor_units
        IS DISTINCT FROM 800
  ) THEN
    RAISE EXCEPTION 'Historical effective standalone snapshots changed with current pricing.';
  END IF;
  INSERT INTO phase4_foundation_results VALUES ('customer_effective_price_snapshot', true);
  INSERT INTO phase4_foundation_results VALUES ('historical_price_immutability', true);

  -- A historical effective unit price above the Parcel entitlement must cap
  -- the accepted entitlement at zero without inventing a refund method.
  -- Flavor pricing is inherited from its Family master by the existing
  -- commercial trigger. Change the authoritative source, not a child row that
  -- the trigger correctly normalizes back to Family settings.
  UPDATE public.products SET sale_price_in_minor_units = 6000
  WHERE id = v_family;
  PERFORM set_config(
    'request.jwt.claims',
    JSONB_BUILD_OBJECT('sub', v_owner, 'role', 'authenticated', 'aal', 'aal2')::TEXT,
    true
  );
  v_cap_sale_result := public.create_pos_sale_v2(
    v_warehouse_id, v_branch_id, NULL, 'Phase 4 cap proof', 'cash',
    JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
      'commercial_line_kind', 'configurable_parcel',
      'family_product_id', v_family,
      'parcel_configuration_id', v_configuration,
      'configuration_revision', 1,
      'price_authority', 'server_catalog',
      'line_discount_in_minor_units', 0,
      'parcel_instances', JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
        'components', JSONB_BUILD_ARRAY(
          JSONB_BUILD_OBJECT('product_id', v_sku_a, 'base_quantity', 2),
          JSONB_BUILD_OBJECT('product_id', v_sku_b, 'base_quantity', 3)
        )
      ))
    )),
    0, 5000, 'phase4-cap-sale-0001'
  );
  v_cap_order_id := (v_cap_sale_result->>'orderId')::UUID;
  SELECT item.id, instance.id, instance.cogs_snapshot_in_minor_units
  INTO STRICT v_cap_order_item_id, v_cap_parcel_id, v_cap_cogs
  FROM public.orders customer_order
  JOIN public.order_items item ON item.order_id = customer_order.id
  JOIN public.order_parcel_instances instance ON instance.order_item_id = item.id
  WHERE customer_order.id = v_cap_order_id;
  IF (SELECT component.effective_standalone_unit_sale_price_snapshot_in_minor_units
      FROM public.order_parcel_components component
      WHERE component.parcel_instance_id = v_cap_parcel_id
        AND component.product_id = v_sku_a) <> 6000
  THEN
    RAISE EXCEPTION 'Cap proof sale did not freeze the 6,000-unit effective price.';
  END IF;

  INSERT INTO public.business_operations(
    id, operation_type, idempotency_key, request_fingerprint, initiated_by,
    result_snapshot, completed_at, request_identity_version,
    request_identity_snapshot, actor_scope_type, actor_scope_hash
  ) VALUES (
    v_cap_return_operation, 'phase4_return_v1', 'phase4-cap-return',
    repeat('7', 64), v_owner, JSONB_BUILD_OBJECT(
      'success', true, 'operationId', v_cap_return_operation,
      'returnId', v_cap_return_event),
    statement_timestamp(), 401, JSONB_BUILD_OBJECT('order_id', v_cap_order_id),
    'erp_user', repeat('8', 64)
  );
  INSERT INTO public.sales_return_events(
    id, return_number, operation_id, order_id, branch_id, warehouse_id,
    cash_shift_id, reason, refund_method,
    merchandise_refund_amount_in_minor_units, contract_version,
    settlement_status, outstanding_debt_before_snapshot_in_minor_units,
    net_collected_before_snapshot_in_minor_units,
    debt_reduction_amount_in_minor_units, money_refund_amount_in_minor_units,
    raw_customer_damage_deduction_in_minor_units,
    applied_customer_damage_deduction_in_minor_units
  ) VALUES (
    v_cap_return_event, 'P4-CAPPED-RETURN', v_cap_return_operation,
    v_cap_order_id, v_branch_id, v_warehouse_id, NULL, 'Damage cap proof',
    NULL, 0, 401, 'draft', 0, 5000, 0, 0, 6000, 5000
  );
  INSERT INTO public.sales_return_items(
    id, sales_return_event_id, operation_id, order_id, order_item_id,
    return_scope, parcel_instance_id, returned_quantity,
    refund_amount_snapshot_in_minor_units, stock_disposition,
    accepted_base_quantity, rejected_base_quantity,
    original_cogs_snapshot_in_minor_units,
    raw_customer_damage_deduction_in_minor_units,
    applied_customer_damage_deduction_in_minor_units
  ) VALUES (
    v_cap_return_item, v_cap_return_event, v_cap_return_operation,
    v_cap_order_id, v_cap_order_item_id, 'parcel_instance', v_cap_parcel_id,
    1, 0, 'restock', 4, 1, v_cap_cogs, 6000, 5000
  );
  INSERT INTO public.sales_return_component_inspections(
    sales_return_item_id, return_operation_id, parcel_component_id,
    original_sale_operation_id, product_id, accepted_quantity,
    rejected_quantity, accepted_condition, accepted_stock_disposition,
    rejection_reason, rejected_stock_disposition
  )
  SELECT v_cap_return_item, v_cap_return_operation, component.id,
    component.operation_id, component.product_id,
    CASE WHEN component.product_id = v_sku_a
      THEN component.base_quantity - 1 ELSE component.base_quantity END,
    CASE WHEN component.product_id = v_sku_a THEN 1 ELSE 0 END,
    'sellable', 'restock',
    CASE WHEN component.product_id = v_sku_a THEN 'customer_damage' END,
    CASE WHEN component.product_id = v_sku_a THEN 'returned_to_customer' END
  FROM public.order_parcel_components component
  WHERE component.parcel_instance_id = v_cap_parcel_id;
  INSERT INTO public.sales_aftercare_consumptions(
    operation_id, return_item_id, source_kind, source_id, product_id,
    consumed_quantity, consumption_kind
  )
  SELECT v_cap_return_operation, v_cap_return_item, 'parcel_component',
    component.id, component.product_id, component.base_quantity, 'return'
  FROM public.order_parcel_components component
  WHERE component.parcel_instance_id = v_cap_parcel_id;
  PERFORM public.phase4_finalize_aftercare_operation_internal(v_cap_return_operation);
  IF (SELECT ROW(
      merchandise_refund_amount_in_minor_units,
      raw_customer_damage_deduction_in_minor_units,
      applied_customer_damage_deduction_in_minor_units,
      refund_method, cash_shift_id, settlement_status
    ) FROM public.sales_return_events WHERE id = v_cap_return_event)
    IS DISTINCT FROM ROW(0::BIGINT, 6000::BIGINT, 5000::BIGINT,
      NULL::TEXT, NULL::UUID, 'settled'::TEXT)
  THEN
    RAISE EXCEPTION 'Customer-damage cap did not settle exactly at zero.';
  END IF;
  INSERT INTO phase4_foundation_results VALUES ('customer_damage_cap_zero', true);

  SELECT component.effective_standalone_unit_sale_price_snapshot_in_minor_units
  INTO STRICT v_damage_price
  FROM public.order_parcel_components component
  WHERE component.parcel_instance_id = v_parcel_id
    AND component.product_id = v_sku_a;

  -- A cancelled draft inspection does not consume the Parcel Return identity.
  INSERT INTO public.business_operations(
    id, operation_type, idempotency_key, request_fingerprint, initiated_by,
    result_snapshot, completed_at, request_identity_version,
    request_identity_snapshot, actor_scope_type, actor_scope_hash
  ) VALUES (
    v_cancel_operation, 'phase4_return_v1', 'phase4-cancelled-draft',
    repeat('1', 64), v_owner, JSONB_BUILD_OBJECT(
      'success', true, 'operationId', v_cancel_operation,
      'returnId', v_cancel_event),
    statement_timestamp(), 401, JSONB_BUILD_OBJECT('order_id', v_order_id),
    'erp_user', repeat('2', 64)
  );
  INSERT INTO public.sales_return_events(
    id, return_number, operation_id, order_id, branch_id, warehouse_id,
    cash_shift_id, reason, refund_method,
    merchandise_refund_amount_in_minor_units, contract_version,
    settlement_status, outstanding_debt_before_snapshot_in_minor_units,
    net_collected_before_snapshot_in_minor_units,
    debt_reduction_amount_in_minor_units, money_refund_amount_in_minor_units,
    raw_customer_damage_deduction_in_minor_units,
    applied_customer_damage_deduction_in_minor_units
  ) VALUES (
    v_cancel_event, 'P4-CANCELLED-DRAFT', v_cancel_operation, v_order_id,
    v_branch_id, v_warehouse_id, v_shift_id, 'Cancelled inspection', 'cash',
    v_entitlement - LEAST(v_entitlement, v_damage_price), 401, 'draft', 0,
    v_entitlement, 0, v_entitlement - LEAST(v_entitlement, v_damage_price),
    v_damage_price, LEAST(v_entitlement, v_damage_price)
  );
  INSERT INTO public.sales_return_items(
    id, sales_return_event_id, operation_id, order_id, order_item_id,
    return_scope, parcel_instance_id, returned_quantity,
    refund_amount_snapshot_in_minor_units, stock_disposition,
    accepted_base_quantity, rejected_base_quantity,
    original_cogs_snapshot_in_minor_units,
    raw_customer_damage_deduction_in_minor_units,
    applied_customer_damage_deduction_in_minor_units
  ) VALUES (
    v_cancel_item, v_cancel_event, v_cancel_operation, v_order_id,
    v_order_item_id, 'parcel_instance', v_parcel_id, 1,
    v_entitlement - LEAST(v_entitlement, v_damage_price), 'restock',
    v_units - 1, 1, v_cogs, v_damage_price,
    LEAST(v_entitlement, v_damage_price)
  );
  INSERT INTO public.sales_return_component_inspections(
    sales_return_item_id, return_operation_id, parcel_component_id,
    original_sale_operation_id, product_id, accepted_quantity,
    rejected_quantity, accepted_condition, accepted_stock_disposition,
    rejection_reason, rejected_stock_disposition
  )
  SELECT v_cancel_item, v_cancel_operation, component.id,
    component.operation_id, component.product_id,
    CASE WHEN component.product_id = v_sku_a
      THEN component.base_quantity - 1 ELSE component.base_quantity END,
    CASE WHEN component.product_id = v_sku_a THEN 1 ELSE 0 END,
    'sellable', 'restock',
    CASE WHEN component.product_id = v_sku_a THEN 'customer_damage' END,
    CASE WHEN component.product_id = v_sku_a THEN 'returned_to_customer' END
  FROM public.order_parcel_components component
  WHERE component.parcel_instance_id = v_parcel_id;
  INSERT INTO public.sales_aftercare_consumptions(
    operation_id, return_item_id, source_kind, source_id, product_id,
    consumed_quantity, consumption_kind
  )
  SELECT v_cancel_operation, v_cancel_item, 'parcel_component', component.id,
    component.product_id, component.base_quantity, 'return'
  FROM public.order_parcel_components component
  WHERE component.parcel_instance_id = v_parcel_id;
  PERFORM public.phase4_cancel_draft_aftercare_internal(v_cancel_operation);
  IF (SELECT settlement_status FROM public.sales_return_events
      WHERE id = v_cancel_event) <> 'cancelled'
    OR EXISTS (SELECT 1 FROM public.sales_aftercare_consumptions
      WHERE operation_id = v_cancel_operation
        AND consumption_state <> 'cancelled')
  THEN
    RAISE EXCEPTION 'Draft cancellation did not preserve non-consuming evidence.';
  END IF;
  INSERT INTO phase4_foundation_results VALUES ('cancelled_draft_non_consuming', true);

  -- The same Parcel can now settle once. One customer-damaged unit uses the
  -- historical standalone price, never Parcel equal allocation or COGS.
  INSERT INTO public.business_operations(
    id, operation_type, idempotency_key, request_fingerprint, initiated_by,
    result_snapshot, completed_at, request_identity_version,
    request_identity_snapshot, actor_scope_type, actor_scope_hash
  ) VALUES (
    v_return_operation, 'phase4_return_v1', 'phase4-settled-return',
    repeat('3', 64), v_owner, JSONB_BUILD_OBJECT(
      'success', true, 'operationId', v_return_operation,
      'returnId', v_return_event),
    statement_timestamp(), 401, JSONB_BUILD_OBJECT('order_id', v_order_id),
    'erp_user', repeat('4', 64)
  );
  INSERT INTO public.sales_return_events(
    id, return_number, operation_id, order_id, branch_id, warehouse_id,
    cash_shift_id, reason, refund_method,
    merchandise_refund_amount_in_minor_units, contract_version,
    settlement_status, outstanding_debt_before_snapshot_in_minor_units,
    net_collected_before_snapshot_in_minor_units,
    debt_reduction_amount_in_minor_units, money_refund_amount_in_minor_units,
    raw_customer_damage_deduction_in_minor_units,
    applied_customer_damage_deduction_in_minor_units
  ) VALUES (
    v_return_event, 'P4-SETTLED-RETURN', v_return_operation, v_order_id,
    v_branch_id, v_warehouse_id, v_shift_id, 'Whole Parcel inspection', 'cash',
    v_entitlement - LEAST(v_entitlement, v_damage_price), 401, 'draft', 0,
    v_entitlement, 0, v_entitlement - LEAST(v_entitlement, v_damage_price),
    v_damage_price, LEAST(v_entitlement, v_damage_price)
  );
  INSERT INTO public.sales_return_items(
    id, sales_return_event_id, operation_id, order_id, order_item_id,
    return_scope, parcel_instance_id, returned_quantity,
    refund_amount_snapshot_in_minor_units, stock_disposition,
    accepted_base_quantity, rejected_base_quantity,
    original_cogs_snapshot_in_minor_units,
    raw_customer_damage_deduction_in_minor_units,
    applied_customer_damage_deduction_in_minor_units
  ) VALUES (
    v_return_item, v_return_event, v_return_operation, v_order_id,
    v_order_item_id, 'parcel_instance', v_parcel_id, 1,
    v_entitlement - LEAST(v_entitlement, v_damage_price), 'restock',
    v_units - 1, 1, v_cogs, v_damage_price,
    LEAST(v_entitlement, v_damage_price)
  );
  INSERT INTO public.sales_return_component_inspections(
    sales_return_item_id, return_operation_id, parcel_component_id,
    original_sale_operation_id, product_id, accepted_quantity,
    rejected_quantity, accepted_condition, accepted_stock_disposition,
    rejection_reason, rejected_stock_disposition
  )
  SELECT v_return_item, v_return_operation, component.id,
    component.operation_id, component.product_id,
    CASE WHEN component.product_id = v_sku_a
      THEN component.base_quantity - 1 ELSE component.base_quantity END,
    CASE WHEN component.product_id = v_sku_a THEN 1 ELSE 0 END,
    'sellable', 'restock',
    CASE WHEN component.product_id = v_sku_a THEN 'customer_damage' END,
    CASE WHEN component.product_id = v_sku_a THEN 'returned_to_customer' END
  FROM public.order_parcel_components component
  WHERE component.parcel_instance_id = v_parcel_id;
  INSERT INTO public.sales_aftercare_consumptions(
    operation_id, return_item_id, source_kind, source_id, product_id,
    consumed_quantity, consumption_kind
  )
  SELECT v_return_operation, v_return_item, 'parcel_component', component.id,
    component.product_id, component.base_quantity, 'return'
  FROM public.order_parcel_components component
  WHERE component.parcel_instance_id = v_parcel_id;

  PERFORM public.phase4_finalize_aftercare_operation_internal(v_return_operation);
  IF (SELECT settlement_status FROM public.sales_return_events
      WHERE id = v_return_event) <> 'settled'
    OR EXISTS (SELECT 1 FROM public.sales_aftercare_consumptions
      WHERE operation_id = v_return_operation
        AND consumption_state <> 'settled')
    OR (SELECT merchandise_refund_amount_in_minor_units
      FROM public.sales_return_events WHERE id = v_return_event)
      <> v_entitlement - v_damage_price
  THEN
    RAISE EXCEPTION 'Whole Parcel settlement did not reconcile exactly.';
  END IF;
  INSERT INTO phase4_foundation_results VALUES ('whole_parcel_damage_settlement', true);

  -- A second Return can collect draft evidence but cannot consume the settled
  -- Parcel identity. The expected COMMIT-boundary failure remains zero-write.
  INSERT INTO public.business_operations(
    id, operation_type, idempotency_key, request_fingerprint, initiated_by,
    result_snapshot, completed_at, request_identity_version,
    request_identity_snapshot, actor_scope_type, actor_scope_hash
  ) VALUES (
    v_duplicate_operation, 'phase4_return_v1', 'phase4-duplicate-return',
    repeat('5', 64), v_owner, JSONB_BUILD_OBJECT(
      'success', true, 'operationId', v_duplicate_operation,
      'returnId', v_duplicate_event),
    statement_timestamp(), 401, JSONB_BUILD_OBJECT('order_id', v_order_id),
    'erp_user', repeat('6', 64)
  );
  INSERT INTO public.sales_return_events(
    id, return_number, operation_id, order_id, branch_id, warehouse_id,
    cash_shift_id, reason, refund_method,
    merchandise_refund_amount_in_minor_units, contract_version,
    settlement_status, outstanding_debt_before_snapshot_in_minor_units,
    net_collected_before_snapshot_in_minor_units,
    debt_reduction_amount_in_minor_units, money_refund_amount_in_minor_units,
    raw_customer_damage_deduction_in_minor_units,
    applied_customer_damage_deduction_in_minor_units
  ) VALUES (
    v_duplicate_event, 'P4-DUPLICATE-RETURN', v_duplicate_operation, v_order_id,
    v_branch_id, v_warehouse_id, v_shift_id, 'Duplicate attempt', 'cash',
    v_entitlement, 401, 'draft', 0, v_entitlement, 0, v_entitlement, 0, 0
  );
  INSERT INTO public.sales_return_items(
    id, sales_return_event_id, operation_id, order_id, order_item_id,
    return_scope, parcel_instance_id, returned_quantity,
    refund_amount_snapshot_in_minor_units, stock_disposition,
    accepted_base_quantity, rejected_base_quantity,
    original_cogs_snapshot_in_minor_units,
    raw_customer_damage_deduction_in_minor_units,
    applied_customer_damage_deduction_in_minor_units
  ) VALUES (
    v_duplicate_item, v_duplicate_event, v_duplicate_operation, v_order_id,
    v_order_item_id, 'parcel_instance', v_parcel_id, 1, v_entitlement,
    'restock', v_units, 0, v_cogs, 0, 0
  );
  INSERT INTO public.sales_return_component_inspections(
    sales_return_item_id, return_operation_id, parcel_component_id,
    original_sale_operation_id, product_id, accepted_quantity,
    rejected_quantity, accepted_condition, accepted_stock_disposition
  )
  SELECT v_duplicate_item, v_duplicate_operation, component.id,
    component.operation_id, component.product_id, component.base_quantity,
    0, 'sellable', 'restock'
  FROM public.order_parcel_components component
  WHERE component.parcel_instance_id = v_parcel_id;
  INSERT INTO public.sales_aftercare_consumptions(
    operation_id, return_item_id, source_kind, source_id, product_id,
    consumed_quantity, consumption_kind
  )
  SELECT v_duplicate_operation, v_duplicate_item, 'parcel_component',
    component.id, component.product_id, component.base_quantity, 'return'
  FROM public.order_parcel_components component
  WHERE component.parcel_instance_id = v_parcel_id;

  BEGIN
    PERFORM public.phase4_finalize_aftercare_operation_internal(
      v_duplicate_operation
    );
    RAISE EXCEPTION 'Expected duplicate Parcel Return rejection.';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_state = RETURNED_SQLSTATE,
      v_error_message = MESSAGE_TEXT;
    IF v_error_state <> 'P0001'
      OR POSITION('PHASE4_PARCEL_RETURN_ALREADY_CONSUMED' IN v_error_message) = 0
    THEN
      RAISE EXCEPTION 'Wrong duplicate Return rejection: % %',
        v_error_state, v_error_message;
    END IF;
  END;
  IF (SELECT settlement_status FROM public.sales_return_events
      WHERE id = v_duplicate_event) <> 'draft'
    OR EXISTS (SELECT 1 FROM public.sales_aftercare_consumptions
      WHERE operation_id = v_duplicate_operation
        AND consumption_state <> 'draft')
    OR (SELECT settlement_status FROM public.sales_return_events
      WHERE id = v_return_event) <> 'settled'
  THEN
    RAISE EXCEPTION 'Duplicate rejection left partial business state.';
  END IF;
  INSERT INTO phase4_foundation_results VALUES ('duplicate_parcel_zero_write', true);

  IF has_table_privilege('authenticated', 'public.sales_return_events', 'INSERT')
    OR has_table_privilege('authenticated', 'public.sales_return_items', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.sales_replacement_events', 'DELETE')
    OR has_function_privilege(
      'authenticated', 'public.phase4_finalize_aftercare_operation_internal(uuid)', 'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'Phase 4 foundation exposed a direct authenticated write path.';
  END IF;
  INSERT INTO phase4_foundation_results VALUES ('rpc_only_security_boundary', true);
END;
$phase4$;

DO $phase4_corrections$
DECLARE
  v_owner UUID := '92400000-0000-0000-0000-000000000001';
  v_sku_a UUID := '92400000-0000-0000-0000-000000000101';
  v_sku_b UUID := '92400000-0000-0000-0000-000000000102';
  v_family UUID := '92400000-0000-0000-0000-000000000100';
  v_configuration UUID := '92400000-0000-0000-0000-000000000300';
  v_branch UUID;
  v_warehouse UUID;
  v_shift UUID;
  v_order UUID;
  v_order_item UUID;
  v_parcel UUID;
  v_sale_operation UUID;
  v_entitlement BIGINT;
  v_cogs BIGINT;
  v_units INTEGER;
  v_component_a UUID;
  v_component_b UUID;
  v_component_a_quantity INTEGER;
  v_component_b_quantity INTEGER;
  v_unrelated_component UUID;
  v_unrelated_product UUID;
  v_result JSONB;
  v_replay JSONB;
  v_before JSONB;
  v_after JSONB;
  v_completion TIMESTAMPTZ;
  v_error_state TEXT;
  v_error_message TEXT;
  v_constraint TEXT;
  v_base_order UUID;
  v_base_item UUID;
  v_base_operation UUID;
  v_replacement_operation UUID := 'f4470000-0000-4000-8000-000000000001';
  v_replacement_event UUID := 'f4470000-0000-4000-8000-000000000002';
  v_replacement_item UUID := 'f4470000-0000-4000-8000-000000000003';
  v_return_operation UUID := 'f4470000-0000-4000-8000-000000000011';
  v_return_event UUID := 'f4470000-0000-4000-8000-000000000012';
  v_return_item UUID := 'f4470000-0000-4000-8000-000000000013';
  v_foreign_draft_operation UUID := 'f4480000-0000-4000-8000-000000000001';
  v_foreign_draft_event UUID := 'f4480000-0000-4000-8000-000000000002';
  v_foreign_draft_item UUID := 'f4480000-0000-4000-8000-000000000003';
  v_foreign_settle_operation UUID := 'f4480000-0000-4000-8000-000000000011';
  v_foreign_settle_event UUID := 'f4480000-0000-4000-8000-000000000012';
  v_foreign_settle_item UUID := 'f4480000-0000-4000-8000-000000000013';
  v_cancelled_parent_operation UUID := 'f4460000-0000-4000-8000-000000000001';
  v_cancelled_parent_event UUID := 'f4460000-0000-4000-8000-000000000002';
  v_cancelled_parent_item UUID := 'f4460000-0000-4000-8000-000000000003';
  v_cancelled_child_operation UUID := 'f4460000-0000-4000-8000-000000000011';
  v_cancelled_child_event UUID := 'f4460000-0000-4000-8000-000000000012';
BEGIN
  PERFORM SET_CONFIG(
    'request.jwt.claims',
    JSONB_BUILD_OBJECT('sub', v_owner, 'role', 'authenticated', 'aal', 'aal2')::TEXT,
    true
  );
  SELECT branch.id, warehouse.id, shift.id
  INTO STRICT v_branch, v_warehouse, v_shift
  FROM public.cash_shifts shift
  JOIN public.branches branch ON branch.id = shift.branch_id
  JOIN public.warehouses warehouse ON warehouse.branch_id = branch.id
  WHERE shift.status = 'open' AND branch.is_active AND warehouse.is_active
  ORDER BY shift.opened_at, warehouse.created_at
  LIMIT 1;
  SELECT customer_order.id INTO STRICT v_order
  FROM public.orders customer_order
  WHERE customer_order.status = 'completed'
  ORDER BY customer_order.created_at DESC LIMIT 1;

  -- M6: every Phase-4 operation must carry the full immutable actor-scoped
  -- identity. PostgreSQL CHECK UNKNOWN semantics must not admit a partial row.
  BEGIN
    INSERT INTO public.business_operations(
      id, operation_type, initiated_by
    ) VALUES (
      'f4490000-0000-4000-8000-000000000000', 'phase4_return_v1', v_owner
    );
    RAISE EXCEPTION 'Incomplete Phase-4 operation identity passed the DB boundary.';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_state = RETURNED_SQLSTATE,
      v_error_message = MESSAGE_TEXT, v_constraint = CONSTRAINT_NAME;
    IF v_error_state <> '23514'
      OR (v_constraint IS DISTINCT FROM 'business_operations_phase4_shape_check'
        AND POSITION('PHASE4_OPERATION_INSERT_SHAPE_INVALID' IN v_error_message) = 0)
    THEN RAISE; END IF;
  END;
  INSERT INTO phase4_foundation_results VALUES
    ('phase4_operation_identity_required', true);

  -- M6: actor-scoped Phase-4 replay is immutable, conflicting payloads are
  -- zero-write rejections, and another actor cannot observe this actor's row.
  INSERT INTO public.business_operations(
    id, operation_type, idempotency_key, request_fingerprint, initiated_by,
    result_snapshot, completed_at, request_identity_version,
    request_identity_snapshot, actor_scope_type, actor_scope_hash
  ) VALUES (
    'f4490000-0000-4000-8000-000000000001', 'phase4_return_v1',
    'phase4-actor-replay-proof', repeat('a', 64), v_owner,
    '{"success":true,"operationId":"f4490000-0000-4000-8000-000000000001","returnId":"f4490000-0000-4000-8000-000000000002"}'::JSONB,
    statement_timestamp(), 401, JSONB_BUILD_OBJECT('order_id', v_order),
    'erp_user', repeat('b', 64)
  );
  SELECT TO_JSONB(operation) INTO v_before
  FROM public.business_operations operation
  WHERE operation.id = 'f4490000-0000-4000-8000-000000000001';
  BEGIN
    PERFORM public.phase4_resolve_operation_replay_internal(
      'phase4_return_v1', 'phase4-actor-replay-proof', repeat('b', 64),
      repeat('a', 64)
    );
    RAISE EXCEPTION 'Unsettled Phase-4 operation replayed as committed success.';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_state = RETURNED_SQLSTATE,
      v_error_message = MESSAGE_TEXT;
    IF v_error_state <> 'P0001'
      OR POSITION('PHASE4_OPERATION_NOT_SETTLED' IN v_error_message) = 0
    THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.phase4_resolve_operation_replay_internal(
      'phase4_return_v1', 'phase4-actor-replay-proof', repeat('b', 64),
      repeat('c', 64)
    );
    RAISE EXCEPTION 'Changed Phase-4 request was accepted.';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_state = RETURNED_SQLSTATE,
      v_error_message = MESSAGE_TEXT;
    IF v_error_state <> 'P0001'
      OR POSITION('PHASE4_IDEMPOTENCY_CONFLICT' IN v_error_message) = 0
    THEN RAISE; END IF;
  END;
  IF (public.phase4_resolve_operation_replay_internal(
      'phase4_return_v1', 'phase4-actor-replay-proof', repeat('d', 64),
      repeat('a', 64)
    )->>'decision') <> 'NEW'
  THEN
    RAISE EXCEPTION 'Cross-actor Phase-4 key exposed another actor result.';
  END IF;
  SELECT TO_JSONB(operation) INTO v_after
  FROM public.business_operations operation
  WHERE operation.id = 'f4490000-0000-4000-8000-000000000001';
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'Replay/conflict changed immutable operation evidence.';
  END IF;
  INSERT INTO phase4_foundation_results VALUES
    ('unsettled_operation_replay_rejected', true),
    ('actor_scoped_idempotency_conflict_zero_write', true),
    ('cross_actor_idempotency_privacy', true);

  -- M5: SQL NULL must not make a versioned financial CHECK evaluate UNKNOWN.
  INSERT INTO public.business_operations(
    id, operation_type, idempotency_key, request_fingerprint, initiated_by,
    result_snapshot, completed_at, request_identity_version,
    request_identity_snapshot, actor_scope_type, actor_scope_hash
  ) VALUES (
    'f4490000-0000-4000-8000-000000000011', 'phase4_return_v1',
    'phase4-null-financial-proof', repeat('e', 64), v_owner,
    '{"success":true,"operationId":"f4490000-0000-4000-8000-000000000011","returnId":"f4490000-0000-4000-8000-000000000012"}'::JSONB,
    statement_timestamp(), 401,
    JSONB_BUILD_OBJECT('order_id', v_order), 'erp_user', repeat('f', 64)
  );
  BEGIN
    INSERT INTO public.sales_return_events(
      id, return_number, operation_id, order_id, branch_id, warehouse_id,
      reason, merchandise_refund_amount_in_minor_units, contract_version,
      settlement_status, outstanding_debt_before_snapshot_in_minor_units,
      net_collected_before_snapshot_in_minor_units,
      debt_reduction_amount_in_minor_units, money_refund_amount_in_minor_units,
      raw_customer_damage_deduction_in_minor_units,
      applied_customer_damage_deduction_in_minor_units
    ) SELECT
      'f4490000-0000-4000-8000-000000000012', 'P4-NULL-FINANCIAL',
      'f4490000-0000-4000-8000-000000000011', customer_order.id,
      customer_order.branch_id, customer_order.warehouse_id,
      'NULL evidence must fail', 0, 401, 'draft', NULL, NULL, 0, 0, 0, 0
    FROM public.orders customer_order WHERE customer_order.id = v_order;
    RAISE EXCEPTION 'NULL financial evidence passed the DB boundary.';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint <> 'sales_return_events_financial_source_snapshots_check'
    THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.sales_return_events(
      id, return_number, operation_id, order_id, branch_id, warehouse_id,
      reason, merchandise_refund_amount_in_minor_units, contract_version,
      settlement_status, outstanding_debt_before_snapshot_in_minor_units,
      net_collected_before_snapshot_in_minor_units,
      debt_reduction_amount_in_minor_units, money_refund_amount_in_minor_units,
      raw_customer_damage_deduction_in_minor_units,
      applied_customer_damage_deduction_in_minor_units
    ) SELECT
      'f4490000-0000-4000-8000-000000000012', 'P4-MISSING-MONEY-METHOD',
      'f4490000-0000-4000-8000-000000000011', customer_order.id,
      customer_order.branch_id, customer_order.warehouse_id,
      'Positive money refund requires method evidence', 100, 401, 'draft',
      0, 100, 0, 100, 0, 0
    FROM public.orders customer_order WHERE customer_order.id = v_order;
    RAISE EXCEPTION 'Positive money refund without method evidence was accepted.';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint <> 'sales_return_events_money_method_shape_check'
    THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.sales_return_events(
      id, return_number, operation_id, order_id, branch_id, warehouse_id,
      reason, merchandise_refund_amount_in_minor_units, contract_version,
      settlement_status, settled_at,
      outstanding_debt_before_snapshot_in_minor_units,
      net_collected_before_snapshot_in_minor_units,
      debt_reduction_amount_in_minor_units, money_refund_amount_in_minor_units,
      raw_customer_damage_deduction_in_minor_units,
      applied_customer_damage_deduction_in_minor_units
    ) SELECT
      'f4490000-0000-4000-8000-000000000012', 'P4-DIRECT-SETTLED-RETURN',
      'f4490000-0000-4000-8000-000000000011', customer_order.id,
      customer_order.branch_id, customer_order.warehouse_id,
      'Direct final-state insert must fail', 0, 401, 'settled', clock_timestamp(),
      0, 0, 0, 0, 0, 0
    FROM public.orders customer_order WHERE customer_order.id = v_order;
    RAISE EXCEPTION 'Versioned Return was inserted directly as settled.';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_state = RETURNED_SQLSTATE,
      v_error_message = MESSAGE_TEXT;
    IF v_error_state <> 'P0001'
      OR POSITION('PHASE4_RETURN_INITIAL_STATE_INVALID' IN v_error_message) = 0
    THEN RAISE; END IF;
  END;
  INSERT INTO public.sales_return_events(
    id, return_number, operation_id, order_id, branch_id, warehouse_id,
    reason, merchandise_refund_amount_in_minor_units, contract_version,
    settlement_status, outstanding_debt_before_snapshot_in_minor_units,
    net_collected_before_snapshot_in_minor_units,
    debt_reduction_amount_in_minor_units, money_refund_amount_in_minor_units,
    raw_customer_damage_deduction_in_minor_units,
    applied_customer_damage_deduction_in_minor_units
  ) SELECT
    'f4490000-0000-4000-8000-000000000012', 'P4-DEBT-ONLY-VALID',
    'f4490000-0000-4000-8000-000000000011', customer_order.id,
    customer_order.branch_id, customer_order.warehouse_id,
    'Debt-only settlement has no money method', 1000, 401, 'draft',
    1000, 0, 1000, 0, 0, 0
  FROM public.orders customer_order WHERE customer_order.id = v_order;
  INSERT INTO phase4_foundation_results VALUES
    ('financial_null_matrix_rejected', true),
    ('debt_only_zero_money_shape_valid', true),
    ('direct_settled_return_insert_rejected', true);

  -- M2: a foreign active draft is inspection evidence only.  It does not
  -- consume the root quantity and cannot block a different valid settlement.
  v_result := public.create_pos_sale_v2(
    v_warehouse, v_branch, NULL, 'Phase 4 draft non-consumption', 'cash',
    JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
      'commercial_line_kind', 'base_unit', 'product_id', v_sku_a,
      'base_quantity', 2, 'price_authority', 'server_catalog',
      'line_discount_in_minor_units', 0
    )), 0, 12000, 'phase4-foreign-draft-base-sale'
  );
  v_base_order := (v_result->>'orderId')::UUID;
  v_base_operation := (v_result->>'operationId')::UUID;
  SELECT item.id INTO STRICT v_base_item FROM public.order_items item
  WHERE item.order_id = v_base_order;
  v_completion := public.phase4_authoritative_completion_internal(v_base_order);

  INSERT INTO public.business_operations(
    id, operation_type, idempotency_key, request_fingerprint, initiated_by,
    result_snapshot, completed_at, request_identity_version,
    request_identity_snapshot, actor_scope_type, actor_scope_hash
  ) VALUES
    (v_foreign_draft_operation, 'phase4_return_v1', 'phase4-foreign-draft-return',
      repeat('1', 64), v_owner, JSONB_BUILD_OBJECT(
        'success', true, 'operationId', v_foreign_draft_operation,
        'returnId', v_foreign_draft_event),
      statement_timestamp(), 401, JSONB_BUILD_OBJECT('order_id', v_base_order),
      'erp_user', repeat('2', 64)),
    (v_foreign_settle_operation, 'phase4_replacement_v1', 'phase4-settle-over-draft',
      repeat('3', 64), v_owner, JSONB_BUILD_OBJECT(
        'success', true, 'operationId', v_foreign_settle_operation,
        'replacementId', v_foreign_settle_event),
      statement_timestamp(), 401, JSONB_BUILD_OBJECT('order_id', v_base_order),
      'erp_user', repeat('4', 64));
  INSERT INTO public.sales_return_events(
    id, return_number, operation_id, order_id, branch_id, warehouse_id,
    cash_shift_id, reason, refund_method,
    merchandise_refund_amount_in_minor_units, contract_version,
    settlement_status, outstanding_debt_before_snapshot_in_minor_units,
    net_collected_before_snapshot_in_minor_units,
    debt_reduction_amount_in_minor_units, money_refund_amount_in_minor_units,
    raw_customer_damage_deduction_in_minor_units,
    applied_customer_damage_deduction_in_minor_units
  ) VALUES (
    v_foreign_draft_event, 'P4-FOREIGN-DRAFT', v_foreign_draft_operation,
    v_base_order, v_branch, v_warehouse, v_shift, 'Unsettled inspection',
    'cash', 12000, 401,
    'draft', 0, 12000, 0, 12000, 0, 0
  );
  INSERT INTO public.sales_return_items(
    id, sales_return_event_id, operation_id, order_id, order_item_id,
    return_scope, product_id, returned_quantity,
    refund_amount_snapshot_in_minor_units,
    stock_disposition, accepted_base_quantity, rejected_base_quantity,
    original_cogs_snapshot_in_minor_units,
    raw_customer_damage_deduction_in_minor_units,
    applied_customer_damage_deduction_in_minor_units
  ) SELECT
    v_foreign_draft_item, v_foreign_draft_event, v_foreign_draft_operation,
    v_base_order, v_base_item, 'base_unit', v_sku_a, 2,
    item.net_refundable_amount_snapshot_in_minor_units, 'restock', 2, 0,
    item.cogs_in_minor_units, 0, 0
  FROM public.order_items item WHERE item.id = v_base_item;
  INSERT INTO public.sales_aftercare_consumptions(
    operation_id, return_item_id, source_kind, source_id, product_id,
    consumed_quantity, consumption_kind
  ) VALUES (
    v_foreign_draft_operation, v_foreign_draft_item, 'base_order_item',
    v_base_item, v_sku_a, 2, 'return'
  );
  BEGIN
    INSERT INTO public.sales_aftercare_consumptions(
      operation_id, return_item_id, source_kind, source_id, product_id,
      consumed_quantity, consumption_kind, consumption_state, settled_at
    ) VALUES (
      v_foreign_draft_operation, v_foreign_draft_item, 'base_order_item',
      v_base_item, v_sku_a, 1, 'return', 'settled', clock_timestamp()
    );
    RAISE EXCEPTION 'Finalized consumption was inserted below a draft Return.';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_state = RETURNED_SQLSTATE,
      v_error_message = MESSAGE_TEXT;
    IF v_error_state <> 'P0001'
      OR POSITION('PHASE4_CONSUMPTION_INITIAL_STATE_INVALID' IN v_error_message) = 0
    THEN RAISE; END IF;
  END;
  IF EXISTS (
    SELECT 1 FROM public.sales_aftercare_consumptions consumption
    WHERE consumption.operation_id = v_foreign_draft_operation
      AND consumption.consumption_state = 'settled'
  ) THEN
    RAISE EXCEPTION 'Rejected finalized draft consumption left persisted state.';
  END IF;
  INSERT INTO public.sales_replacement_events(
    id, operation_id, root_order_id, branch_id, warehouse_id,
    contract_version, original_completed_at_snapshot, reason, created_by
  ) VALUES (
    v_foreign_settle_event, v_foreign_settle_operation, v_base_order,
    v_branch, v_warehouse, 401, v_completion, 'Supplier defect', v_owner
  );
  INSERT INTO public.sales_replacement_items(
    id, replacement_event_id, operation_id, root_order_item_id, product_id,
    quantity, replacement_unit_cost_snapshot_in_minor_units_exact,
    replacement_cogs_snapshot_in_minor_units, condition_code
  ) VALUES (
    v_foreign_settle_item, v_foreign_settle_event, v_foreign_settle_operation,
    v_base_item, v_sku_a, 2, 1.000000, 2, 'supplier_defect'
  );
  INSERT INTO public.sales_aftercare_consumptions(
    operation_id, replacement_item_id, source_kind, source_id, product_id,
    consumed_quantity, consumption_kind
  ) VALUES (
    v_foreign_settle_operation, v_foreign_settle_item, 'base_order_item',
    v_base_item, v_sku_a, 2, 'replacement'
  );
  PERFORM public.phase4_finalize_aftercare_operation_internal(
    v_foreign_settle_operation
  );
  IF (SELECT settlement_status FROM public.sales_return_events
      WHERE id = v_foreign_draft_event) <> 'draft'
    OR (SELECT replacement_status FROM public.sales_replacement_events
      WHERE id = v_foreign_settle_event) <> 'settled'
  THEN
    RAISE EXCEPTION 'Foreign draft incorrectly consumed logical quantity.';
  END IF;
  INSERT INTO phase4_foundation_results VALUES
    ('foreign_draft_non_consuming', true),
    ('direct_settled_consumption_insert_rejected', true);

  -- M3/M4: a settled replacement becomes the current representative of its
  -- original Parcel component. Whole-Parcel Return consumes that leaf while
  -- retaining original sale entitlement/COGS, then closes all item appends.
  v_result := public.create_pos_sale_v2(
    v_warehouse, v_branch, NULL, 'Phase 4 replacement lineage', 'cash',
    JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
      'commercial_line_kind', 'configurable_parcel',
      'family_product_id', v_family,
      'parcel_configuration_id', v_configuration,
      'configuration_revision', 1, 'price_authority', 'server_catalog',
      'line_discount_in_minor_units', 0,
      'parcel_instances', JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
        'components', JSONB_BUILD_ARRAY(
          JSONB_BUILD_OBJECT('product_id', v_sku_a, 'base_quantity', 2),
          JSONB_BUILD_OBJECT('product_id', v_sku_b, 'base_quantity', 3)
        )
      ))
    )), 0, 5000, 'phase4-replacement-lineage-sale'
  );
  v_order := (v_result->>'orderId')::UUID;
  v_sale_operation := (v_result->>'operationId')::UUID;
  SELECT item.id, instance.id,
    instance.net_refundable_amount_snapshot_in_minor_units,
    instance.cogs_snapshot_in_minor_units, instance.units_per_parcel_snapshot
  INTO STRICT v_order_item, v_parcel, v_entitlement, v_cogs, v_units
  FROM public.order_items item
  JOIN public.order_parcel_instances instance ON instance.order_item_id = item.id
  WHERE item.order_id = v_order;
  SELECT component.id, component.base_quantity
  INTO STRICT v_component_a, v_component_a_quantity
  FROM public.order_parcel_components component
  WHERE component.parcel_instance_id = v_parcel AND component.product_id = v_sku_a;
  SELECT component.id, component.base_quantity
  INTO STRICT v_component_b, v_component_b_quantity
  FROM public.order_parcel_components component
  WHERE component.parcel_instance_id = v_parcel AND component.product_id = v_sku_b;
  v_completion := public.phase4_authoritative_completion_internal(v_order);

  INSERT INTO public.business_operations(
    id, operation_type, idempotency_key, request_fingerprint, initiated_by,
    result_snapshot, completed_at, request_identity_version,
    request_identity_snapshot, actor_scope_type, actor_scope_hash
  ) VALUES
    (v_replacement_operation, 'phase4_replacement_v1',
      'phase4-parcel-replacement', repeat('5', 64), v_owner,
      JSONB_BUILD_OBJECT('success', true,
        'operationId', v_replacement_operation,
        'replacementId', v_replacement_event), statement_timestamp(), 401,
      JSONB_BUILD_OBJECT('order_id', v_order), 'erp_user', repeat('6', 64)),
    (v_return_operation, 'phase4_return_v1',
      'phase4-parcel-after-replacement', repeat('7', 64), v_owner,
      JSONB_BUILD_OBJECT('success', true,
        'operationId', v_return_operation, 'returnId', v_return_event),
      statement_timestamp(), 401,
      JSONB_BUILD_OBJECT('order_id', v_order), 'erp_user', repeat('8', 64));
  INSERT INTO public.sales_replacement_events(
    id, operation_id, root_order_id, branch_id, warehouse_id,
    contract_version, original_completed_at_snapshot, reason, created_by
  ) VALUES (
    v_replacement_event, v_replacement_operation, v_order, v_branch,
    v_warehouse, 401, v_completion, 'Supplier defect replacement', v_owner
  );
  INSERT INTO public.sales_replacement_items(
    id, replacement_event_id, operation_id, root_order_item_id,
    root_parcel_instance_id, root_parcel_component_id,
    original_sale_operation_id, product_id, quantity,
    replacement_unit_cost_snapshot_in_minor_units_exact,
    replacement_cogs_snapshot_in_minor_units, condition_code
  ) VALUES (
    v_replacement_item, v_replacement_event, v_replacement_operation,
    v_order_item, v_parcel, v_component_a, v_sale_operation, v_sku_a,
    v_component_a_quantity, 1.000000, v_component_a_quantity,
    'supplier_defect'
  );
  INSERT INTO public.sales_aftercare_consumptions(
    operation_id, replacement_item_id, source_kind, source_id, product_id,
    consumed_quantity, consumption_kind
  ) VALUES (
    v_replacement_operation, v_replacement_item, 'parcel_component',
    v_component_a, v_sku_a, v_component_a_quantity, 'replacement'
  );
  SELECT component.id, component.product_id
  INTO STRICT v_unrelated_component, v_unrelated_product
  FROM public.order_parcel_components component
  WHERE component.parcel_instance_id <> v_parcel
    AND component.product_id = v_sku_a
  ORDER BY component.created_at, component.id
  LIMIT 1;
  BEGIN
    INSERT INTO public.sales_aftercare_consumptions(
      operation_id, replacement_item_id, source_kind, source_id, product_id,
      consumed_quantity, consumption_kind
    ) VALUES (
      v_replacement_operation, v_replacement_item, 'parcel_component',
      v_unrelated_component, v_unrelated_product, 1, 'replacement'
    );
    PERFORM public.phase4_finalize_aftercare_operation_internal(
      v_replacement_operation
    );
    RAISE EXCEPTION 'Replacement settled with an unrelated logical consumption root.';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_state = RETURNED_SQLSTATE,
      v_error_message = MESSAGE_TEXT;
    IF v_error_state <> 'P0001'
      OR POSITION('PHASE4_REPLACEMENT_CONSUMPTION_SCOPE_INVALID' IN v_error_message) = 0
    THEN RAISE; END IF;
  END;
  IF (SELECT replacement_status FROM public.sales_replacement_events
      WHERE id = v_replacement_event) <> 'draft'
    OR EXISTS (
      SELECT 1 FROM public.sales_aftercare_consumptions consumption
      WHERE consumption.operation_id = v_replacement_operation
        AND consumption.source_id = v_unrelated_component
    )
  THEN
    RAISE EXCEPTION 'Rejected unrelated Replacement consumption left partial state.';
  END IF;
  PERFORM public.phase4_finalize_aftercare_operation_internal(v_replacement_operation);
  v_replay := public.phase4_resolve_operation_replay_internal(
    'phase4_replacement_v1', '  phase4-parcel-replacement  ', repeat('6', 64),
    repeat('5', 64)
  );
  IF v_replay->>'decision' IS DISTINCT FROM 'REPLAY'
    OR (v_replay->>'operation_id')::UUID
      IS DISTINCT FROM v_replacement_operation
    OR (v_replay->'result_snapshot'->>'replacementId')::UUID
      IS DISTINCT FROM v_replacement_event
  THEN
    RAISE EXCEPTION 'Settled Replacement did not replay its committed result.';
  END IF;
  BEGIN
    INSERT INTO public.business_operations(
      id, operation_type, idempotency_key, request_fingerprint, initiated_by,
      result_snapshot, completed_at, request_identity_version,
      request_identity_snapshot, actor_scope_type, actor_scope_hash
    ) VALUES (
      'f4470000-0000-4000-8000-000000000021', 'phase4_replacement_v1',
      ' phase4-parcel-replacement ', repeat('5', 64), v_owner,
      JSONB_BUILD_OBJECT('success', true,
        'operationId', 'f4470000-0000-4000-8000-000000000021',
        'replacementId', 'f4470000-0000-4000-8000-000000000022'),
      statement_timestamp(), 401, JSONB_BUILD_OBJECT('order_id', v_base_order),
      'erp_user', repeat('6', 64)
    );
    RAISE EXCEPTION 'Equivalent Replacement key obtained a second owner.';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.business_operations
      WHERE id = 'f4470000-0000-4000-8000-000000000021')
  THEN
    RAISE EXCEPTION 'Rejected equivalent Replacement key left an operation row.';
  END IF;
  INSERT INTO phase4_foundation_results VALUES
    ('settled_replacement_operation_replay', true),
    ('equivalent_replacement_key_replay', true),
    ('duplicate_normalized_replacement_key_blocked', true);

  INSERT INTO public.sales_return_events(
    id, return_number, operation_id, order_id, branch_id, warehouse_id,
    cash_shift_id, reason, refund_method,
    merchandise_refund_amount_in_minor_units, contract_version,
    settlement_status, outstanding_debt_before_snapshot_in_minor_units,
    net_collected_before_snapshot_in_minor_units,
    debt_reduction_amount_in_minor_units, money_refund_amount_in_minor_units,
    raw_customer_damage_deduction_in_minor_units,
    applied_customer_damage_deduction_in_minor_units
  ) VALUES (
    v_return_event, 'P4-RETURN-AFTER-REPLACEMENT', v_return_operation, v_order,
    v_branch, v_warehouse, v_shift, 'Whole Parcel after replacement', 'cash',
    v_entitlement, 401, 'draft', 0, v_entitlement, 0, v_entitlement, 0, 0
  );
  INSERT INTO public.sales_return_items(
    id, sales_return_event_id, operation_id, order_id, order_item_id,
    return_scope, parcel_instance_id, returned_quantity,
    refund_amount_snapshot_in_minor_units, stock_disposition,
    accepted_base_quantity, rejected_base_quantity,
    original_cogs_snapshot_in_minor_units,
    raw_customer_damage_deduction_in_minor_units,
    applied_customer_damage_deduction_in_minor_units
  ) VALUES (
    v_return_item, v_return_event, v_return_operation, v_order, v_order_item,
    'parcel_instance', v_parcel, 1, v_entitlement, 'restock', v_units, 0,
    v_cogs, 0, 0
  );
  BEGIN
    INSERT INTO public.sales_return_component_inspections(
      sales_return_item_id, return_operation_id, parcel_component_id,
      original_sale_operation_id, product_id, accepted_quantity,
      rejected_quantity, accepted_condition, accepted_stock_disposition
    ) VALUES (
      v_return_item, v_return_operation, v_component_a, v_sale_operation,
      v_sku_a, v_component_a_quantity, 0, 'sellable', NULL
    );
    RAISE EXCEPTION 'Accepted inspection without stock disposition was accepted.';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint <> 'sales_return_component_inspections_accepted_shape_check'
    THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.sales_return_component_inspections(
      sales_return_item_id, return_operation_id, parcel_component_id,
      original_sale_operation_id, product_id, accepted_quantity,
      rejected_quantity, accepted_condition, accepted_stock_disposition,
      rejection_reason, rejected_stock_disposition
    ) VALUES (
      v_return_item, v_return_operation, v_component_a, v_sale_operation,
      v_sku_a, v_component_a_quantity - 1, 1, 'sellable', 'restock',
      NULL, 'returned_to_customer'
    );
    RAISE EXCEPTION 'Rejected inspection without rejection reason was accepted.';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint <> 'sales_return_component_inspections_rejected_shape_check'
    THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.sales_return_component_inspections(
      sales_return_item_id, return_operation_id, parcel_component_id,
      original_sale_operation_id, product_id, accepted_quantity,
      rejected_quantity, accepted_condition, accepted_stock_disposition,
      rejection_reason, rejected_stock_disposition
    ) VALUES (
      v_return_item, v_return_operation, v_component_a, v_sale_operation,
      v_sku_a, v_component_a_quantity - 1, 1, 'sellable', 'restock',
      'customer_damage', NULL
    );
    RAISE EXCEPTION 'Rejected inspection without stock disposition was accepted.';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint <> 'sales_return_component_inspections_rejected_shape_check'
    THEN RAISE; END IF;
  END;
  INSERT INTO public.sales_return_component_inspections(
    sales_return_item_id, return_operation_id, parcel_component_id,
    original_sale_operation_id, product_id, accepted_quantity,
    rejected_quantity, accepted_condition, accepted_stock_disposition
  ) SELECT v_return_item, v_return_operation, component.id,
    component.operation_id, component.product_id, component.base_quantity,
    0, 'sellable', 'restock'
  FROM public.order_parcel_components component
  WHERE component.parcel_instance_id = v_parcel;
  INSERT INTO public.sales_aftercare_consumptions(
    operation_id, return_item_id, source_kind, source_id, product_id,
    consumed_quantity, consumption_kind
  ) VALUES
    (v_return_operation, v_return_item, 'replacement_item',
      v_replacement_item, v_sku_a, v_component_a_quantity, 'return'),
    (v_return_operation, v_return_item, 'parcel_component',
      v_component_b, v_sku_b, v_component_b_quantity, 'return');
  SELECT component.id, component.product_id
  INTO STRICT v_unrelated_component, v_unrelated_product
  FROM public.order_parcel_components component
  WHERE component.parcel_instance_id <> v_parcel
  ORDER BY component.created_at, component.id
  LIMIT 1;
  BEGIN
    INSERT INTO public.sales_aftercare_consumptions(
      operation_id, return_item_id, source_kind, source_id, product_id,
      consumed_quantity, consumption_kind
    ) VALUES (
      v_return_operation, v_return_item, 'parcel_component',
      v_unrelated_component, v_unrelated_product, 1, 'return'
    );
    PERFORM public.phase4_finalize_aftercare_operation_internal(v_return_operation);
    RAISE EXCEPTION 'Return settled with an unrelated logical consumption root.';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_state = RETURNED_SQLSTATE,
      v_error_message = MESSAGE_TEXT;
    IF v_error_state <> 'P0001'
      OR POSITION('PHASE4_RETURN_CONSUMPTION_SCOPE_INVALID' IN v_error_message) = 0
    THEN RAISE; END IF;
  END;
  IF (SELECT settlement_status FROM public.sales_return_events
      WHERE id = v_return_event) <> 'draft'
    OR EXISTS (
      SELECT 1 FROM public.sales_aftercare_consumptions consumption
      WHERE consumption.operation_id = v_return_operation
        AND consumption.source_id = v_unrelated_component
    )
  THEN
    RAISE EXCEPTION 'Rejected unrelated consumption left partial Return state.';
  END IF;
  PERFORM public.phase4_finalize_aftercare_operation_internal(v_return_operation);
  IF (SELECT replacement_status FROM public.sales_replacement_events
      WHERE id = v_replacement_event) <> 'settled'
    OR (SELECT settlement_status FROM public.sales_return_events
      WHERE id = v_return_event) <> 'settled'
    OR (SELECT merchandise_refund_amount_in_minor_units
      FROM public.sales_return_events WHERE id = v_return_event) <> v_entitlement
  THEN
    RAISE EXCEPTION 'Replacement lineage did not preserve original Parcel entitlement.';
  END IF;
  SELECT JSONB_BUILD_OBJECT(
    'operation', (SELECT TO_JSONB(operation)
      FROM public.business_operations operation
      WHERE operation.id = v_return_operation),
    'event', (SELECT TO_JSONB(event)
      FROM public.sales_return_events event WHERE event.id = v_return_event),
    'items', (SELECT JSONB_AGG(TO_JSONB(item) ORDER BY item.id)
      FROM public.sales_return_items item
      WHERE item.operation_id = v_return_operation),
    'inspections', (SELECT JSONB_AGG(TO_JSONB(inspection) ORDER BY inspection.id)
      FROM public.sales_return_component_inspections inspection
      WHERE inspection.return_operation_id = v_return_operation),
    'consumptions', (SELECT JSONB_AGG(TO_JSONB(consumption) ORDER BY consumption.id)
      FROM public.sales_aftercare_consumptions consumption
      WHERE consumption.operation_id = v_return_operation)
  ) INTO v_before;
  v_replay := public.phase4_resolve_operation_replay_internal(
    'phase4_return_v1', '  phase4-parcel-after-replacement  ', repeat('8', 64),
    repeat('7', 64)
  );
  IF v_replay->>'decision' IS DISTINCT FROM 'REPLAY'
    OR (v_replay->>'operation_id')::UUID IS DISTINCT FROM v_return_operation
  THEN
    RAISE EXCEPTION 'Settled Return did not replay its committed result.';
  END IF;
  SELECT JSONB_BUILD_OBJECT(
    'operation', (SELECT TO_JSONB(operation)
      FROM public.business_operations operation
      WHERE operation.id = v_return_operation),
    'event', (SELECT TO_JSONB(event)
      FROM public.sales_return_events event WHERE event.id = v_return_event),
    'items', (SELECT JSONB_AGG(TO_JSONB(item) ORDER BY item.id)
      FROM public.sales_return_items item
      WHERE item.operation_id = v_return_operation),
    'inspections', (SELECT JSONB_AGG(TO_JSONB(inspection) ORDER BY inspection.id)
      FROM public.sales_return_component_inspections inspection
      WHERE inspection.return_operation_id = v_return_operation),
    'consumptions', (SELECT JSONB_AGG(TO_JSONB(consumption) ORDER BY consumption.id)
      FROM public.sales_aftercare_consumptions consumption
      WHERE consumption.operation_id = v_return_operation)
  ) INTO v_after;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'Settled Return replay changed committed business state.';
  END IF;
  BEGIN
    INSERT INTO public.business_operations(
      id, operation_type, idempotency_key, request_fingerprint, initiated_by,
      result_snapshot, completed_at, request_identity_version,
      request_identity_snapshot, actor_scope_type, actor_scope_hash
    ) VALUES (
      'f4470000-0000-4000-8000-000000000031', 'phase4_return_v1',
      ' phase4-parcel-after-replacement ', repeat('7', 64), v_owner,
      JSONB_BUILD_OBJECT('success', true,
        'operationId', 'f4470000-0000-4000-8000-000000000031',
        'returnId', 'f4470000-0000-4000-8000-000000000032'),
      statement_timestamp(), 401, JSONB_BUILD_OBJECT('order_id', v_base_order),
      'erp_user', repeat('8', 64)
    );
    RAISE EXCEPTION 'Equivalent Return key obtained a second owner.';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.business_operations
      WHERE id = 'f4470000-0000-4000-8000-000000000031')
  THEN
    RAISE EXCEPTION 'Rejected equivalent Return key left an operation row.';
  END IF;
  BEGIN
    INSERT INTO public.sales_replacement_items(
      replacement_event_id, operation_id, root_order_item_id,
      root_parcel_instance_id, root_parcel_component_id,
      original_sale_operation_id, product_id, quantity,
      replacement_unit_cost_snapshot_in_minor_units_exact,
      replacement_cogs_snapshot_in_minor_units, condition_code
    ) VALUES (
      v_replacement_event, v_replacement_operation, v_order_item, v_parcel,
      v_component_a, v_sale_operation, v_sku_a, 1, 1.000000, 1,
      'supplier_defect'
    );
    RAISE EXCEPTION 'Settled Replacement accepted appended item evidence.';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_state = RETURNED_SQLSTATE,
      v_error_message = MESSAGE_TEXT;
    IF v_error_state <> '23514'
      OR POSITION('PHASE4_REPLACEMENT_ROOT_INVALID' IN v_error_message) = 0
    THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.sales_replacement_items
    SET quantity = quantity + 1
    WHERE id = v_replacement_item;
    RAISE EXCEPTION 'Settled Replacement item evidence was mutable.';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_state = RETURNED_SQLSTATE,
      v_error_message = MESSAGE_TEXT;
    IF v_error_state <> 'P0001'
      OR POSITION('IMMUTABLE_BUSINESS_HISTORY' IN v_error_message) = 0
    THEN RAISE; END IF;
  END;
  INSERT INTO phase4_foundation_results VALUES
    ('replacement_current_lineage_whole_parcel_return', true),
    ('settled_replacement_evidence_closed', true),
    ('settled_replacement_update_rejected', true),
    ('replacement_unrelated_consumption_scope_rejected', true),
    ('inspection_null_completeness_rejected', true),
    ('unrelated_consumption_scope_rejected', true),
    ('settled_operation_replay', true),
    ('equivalent_return_key_replay', true),
    ('duplicate_normalized_return_key_blocked', true);

  -- M4: a cancelled parent cannot become the current physical representative
  -- for a later replacement lineage.
  INSERT INTO public.business_operations(
    id, operation_type, idempotency_key, request_fingerprint, initiated_by,
    result_snapshot, completed_at, request_identity_version,
    request_identity_snapshot, actor_scope_type, actor_scope_hash
  ) VALUES
    (v_cancelled_parent_operation, 'phase4_replacement_v1',
      'phase4-cancelled-parent', repeat('a', 64), v_owner,
      JSONB_BUILD_OBJECT('success', true,
        'operationId', v_cancelled_parent_operation,
        'replacementId', v_cancelled_parent_event), statement_timestamp(), 401,
      JSONB_BUILD_OBJECT('order_id', v_order), 'erp_user', repeat('1', 64)),
    (v_cancelled_child_operation, 'phase4_replacement_v1',
      'phase4-child-of-cancelled-parent', repeat('b', 64), v_owner,
      JSONB_BUILD_OBJECT('success', true,
        'operationId', v_cancelled_child_operation,
        'replacementId', v_cancelled_child_event), statement_timestamp(), 401,
      JSONB_BUILD_OBJECT('order_id', v_order), 'erp_user', repeat('2', 64));
  INSERT INTO public.sales_replacement_events(
    id, operation_id, root_order_id, branch_id, warehouse_id,
    contract_version, original_completed_at_snapshot, reason, created_by
  ) VALUES
    (v_cancelled_parent_event, v_cancelled_parent_operation, v_order, v_branch,
      v_warehouse, 401, v_completion, 'Cancelled parent evidence', v_owner),
    (v_cancelled_child_event, v_cancelled_child_operation, v_order, v_branch,
      v_warehouse, 401, v_completion, 'Child of cancelled parent', v_owner);
  INSERT INTO public.sales_replacement_items(
    id, replacement_event_id, operation_id, root_order_item_id,
    root_parcel_instance_id, root_parcel_component_id,
    original_sale_operation_id, product_id, quantity,
    replacement_unit_cost_snapshot_in_minor_units_exact,
    replacement_cogs_snapshot_in_minor_units, condition_code
  ) VALUES (
    v_cancelled_parent_item, v_cancelled_parent_event,
    v_cancelled_parent_operation, v_order_item, v_parcel, v_component_b,
    v_sale_operation, v_sku_b, 1, 1.000000, 1, 'supplier_defect'
  );
  PERFORM public.phase4_cancel_draft_aftercare_internal(
    v_cancelled_parent_operation
  );
  BEGIN
    INSERT INTO public.sales_replacement_items(
      replacement_event_id, operation_id, root_order_item_id,
      root_parcel_instance_id, root_parcel_component_id,
      original_sale_operation_id, parent_replacement_item_id,
      product_id, quantity,
      replacement_unit_cost_snapshot_in_minor_units_exact,
      replacement_cogs_snapshot_in_minor_units, condition_code
    ) VALUES (
      v_cancelled_child_event, v_cancelled_child_operation, v_order_item,
      v_parcel, v_component_b, v_sale_operation, v_cancelled_parent_item,
      v_sku_b, 1, 1.000000, 1, 'supplier_defect'
    );
    RAISE EXCEPTION 'Cancelled Replacement parent was accepted as current lineage.';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_state = RETURNED_SQLSTATE,
      v_error_message = MESSAGE_TEXT;
    IF v_error_state <> '23514'
      OR POSITION('PHASE4_REPLACEMENT_LINEAGE_INVALID' IN v_error_message) = 0
    THEN RAISE; END IF;
  END;
  INSERT INTO phase4_foundation_results VALUES
    ('cancelled_parent_replacement_rejected', true);

  -- M4: empty settlement is never a business operation.
  INSERT INTO public.business_operations(
    id, operation_type, idempotency_key, request_fingerprint, initiated_by,
    result_snapshot, completed_at, request_identity_version,
    request_identity_snapshot, actor_scope_type, actor_scope_hash
  ) VALUES (
    'f4490000-0000-4000-8000-000000000021', 'phase4_replacement_v1',
    'phase4-empty-replacement', repeat('9', 64), v_owner,
    '{"success":true,"operationId":"f4490000-0000-4000-8000-000000000021","replacementId":"f4490000-0000-4000-8000-000000000022"}'::JSONB,
    statement_timestamp(), 401,
    JSONB_BUILD_OBJECT('order_id', v_order), 'erp_user', repeat('0', 64)
  );
  BEGIN
    INSERT INTO public.sales_replacement_events(
      id, operation_id, root_order_id, branch_id, warehouse_id,
      contract_version, replacement_status, original_completed_at_snapshot,
      settled_at, reason, created_by
    ) VALUES (
      'f4490000-0000-4000-8000-000000000022',
      'f4490000-0000-4000-8000-000000000021', v_order, v_branch,
      v_warehouse, 401, 'settled', v_completion, clock_timestamp(),
      'Direct final-state Replacement proof', v_owner
    );
    RAISE EXCEPTION 'Versioned Replacement was inserted directly as settled.';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_state = RETURNED_SQLSTATE,
      v_error_message = MESSAGE_TEXT;
    IF v_error_state <> 'P0001'
      OR POSITION('PHASE4_REPLACEMENT_INITIAL_STATE_INVALID' IN v_error_message) = 0
    THEN RAISE; END IF;
  END;
  INSERT INTO public.sales_replacement_events(
    id, operation_id, root_order_id, branch_id, warehouse_id,
    contract_version, original_completed_at_snapshot, reason, created_by
  ) VALUES (
    'f4490000-0000-4000-8000-000000000022',
    'f4490000-0000-4000-8000-000000000021', v_order, v_branch,
    v_warehouse, 401, v_completion, 'Empty replacement proof', v_owner
  );
  BEGIN
    PERFORM public.phase4_resolve_operation_replay_internal(
      'phase4_replacement_v1', 'phase4-empty-replacement', repeat('0', 64),
      repeat('9', 64)
    );
    RAISE EXCEPTION 'Draft Replacement replayed as committed success.';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_state = RETURNED_SQLSTATE,
      v_error_message = MESSAGE_TEXT;
    IF v_error_state <> 'P0001'
      OR POSITION('PHASE4_OPERATION_NOT_SETTLED' IN v_error_message) = 0
    THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.phase4_finalize_aftercare_operation_internal(
      'f4490000-0000-4000-8000-000000000021'
    );
    RAISE EXCEPTION 'Empty Replacement settled.';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_state = RETURNED_SQLSTATE,
      v_error_message = MESSAGE_TEXT;
    IF v_error_state <> 'P0001'
      OR POSITION('PHASE4_REPLACEMENT_ITEMS_REQUIRED' IN v_error_message) = 0
    THEN RAISE; END IF;
  END;
  PERFORM public.phase4_cancel_draft_aftercare_internal(
    'f4490000-0000-4000-8000-000000000021'
  );
  BEGIN
    PERFORM public.phase4_resolve_operation_replay_internal(
      'phase4_replacement_v1', 'phase4-empty-replacement', repeat('0', 64),
      repeat('9', 64)
    );
    RAISE EXCEPTION 'Cancelled Replacement replayed as committed success.';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_state = RETURNED_SQLSTATE,
      v_error_message = MESSAGE_TEXT;
    IF v_error_state <> 'P0001'
      OR POSITION('PHASE4_OPERATION_NOT_SETTLED' IN v_error_message) = 0
    THEN RAISE; END IF;
  END;
  IF (SELECT replacement_status FROM public.sales_replacement_events
      WHERE id = 'f4490000-0000-4000-8000-000000000022') <> 'cancelled'
  THEN
    RAISE EXCEPTION 'Empty draft Replacement cancellation did not persist.';
  END IF;
  INSERT INTO phase4_foundation_results VALUES
    ('direct_settled_replacement_insert_rejected', true),
    ('draft_operation_replay_rejected', true),
    ('empty_replacement_rejected', true),
    ('cancelled_operation_replay_rejected', true);
END;
$phase4_corrections$;

SELECT JSONB_BUILD_OBJECT(
  'ok', BOOL_AND(passed),
  'scenarioCount', COUNT(*),
  'scenarios', JSONB_AGG(scenario ORDER BY scenario)
)
FROM phase4_foundation_results;

ROLLBACK;
