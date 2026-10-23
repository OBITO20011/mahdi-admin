BEGIN;

-- Owner23Oct: defective same-product replacement may consume ONE physical
-- unit from a saved parcel,including parcel_only. This is not a sales or refund
-- guard: the original whole-commercial return checks remain untouched.
CREATE FUNCTION public.aftercare211_assert_replacement_root_internal(p_order_item_id UUID,p_quantity INTEGER)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item public.order_items%ROWTYPE;
BEGIN
 SELECT * INTO item FROM public.order_items WHERE id=p_order_item_id;
 IF NOT FOUND OR p_quantity IS NULL OR p_quantity<=0 THEN RAISE EXCEPTION 'PHASE43_REPLACEMENT_SOURCE_INVALID'; END IF;
 IF item.commercial_line_kind='legacy_single_sku_parcel' AND (
  COALESCE(item.units_per_sale_package,0)<=0 OR COALESCE(item.sale_package_quantity,0)<=0
  OR item.quantity::BIGINT IS DISTINCT FROM item.sale_package_quantity::BIGINT*item.units_per_sale_package
 ) THEN RAISE EXCEPTION 'AFTERCARE211_PARCEL_SNAPSHOT_INVALID'; END IF;
END $$;
ALTER FUNCTION public.aftercare211_assert_replacement_root_internal(UUID,INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aftercare211_assert_replacement_root_internal(UUID,INTEGER) FROM PUBLIC,anon,authenticated,service_role;

-- Per-leaf physical capacity is independent of commercial parcel quantity.
-- Full-refund quantity remains enforced on the parent sales_return_item by132
-- and its initial/final/replay evidence. No caller-controlled mode or GUC.
CREATE OR REPLACE FUNCTION public.package_d_guard_physical_capacity_internal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_capacity INTEGER; v_used BIGINT; v_root RECORD;
BEGIN
  IF NEW.consumption_state NOT IN ('draft', 'settled') THEN RETURN NEW; END IF;
  PERFORM public.phase4_lock_aftercare_operation_order_internal(NEW.operation_id, NULL);
  SELECT * INTO v_root FROM public.phase4_aftercare_source_root_internal(NEW.source_kind,NEW.source_id,NEW.product_id);
  IF v_root.root_kind='base_order_item' THEN
    PERFORM public.aftercare211_assert_replacement_root_internal(v_root.root_id,NEW.consumed_quantity);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'phase4-aftercare|' || NEW.source_kind || '|' || NEW.source_id::TEXT, 0
  ));
  IF NEW.source_kind = 'base_order_item' THEN
    SELECT quantity INTO v_capacity FROM public.order_items
    WHERE id = NEW.source_id AND product_id = NEW.product_id FOR UPDATE;
  ELSIF NEW.source_kind = 'parcel_component' THEN
    SELECT base_quantity INTO v_capacity FROM public.order_parcel_components
    WHERE id = NEW.source_id AND product_id = NEW.product_id FOR UPDATE;
  ELSIF NEW.source_kind = 'replacement_item' THEN
    SELECT quantity INTO v_capacity FROM public.sales_replacement_items
    WHERE id = NEW.source_id AND product_id = NEW.product_id FOR UPDATE;
  END IF;
  SELECT COALESCE(SUM(consumed_quantity), 0) INTO v_used
  FROM public.sales_aftercare_consumptions
  WHERE source_kind = NEW.source_kind AND source_id = NEW.source_id
    AND id IS DISTINCT FROM NEW.id
    AND (consumption_state = 'settled'
      OR (operation_id = NEW.operation_id AND consumption_state = 'draft'));
  IF v_capacity IS NULL OR NEW.consumed_quantity <= 0
    OR v_used + NEW.consumed_quantity > v_capacity THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED: تغيرت الكمية المتبقية لهذه القطعة؛ أعد تحميل الطلب.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.phase43_assert_operational_replacement_evidence_internal(p_operation_id UUID,p_require_issued BOOLEAN DEFAULT true)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_item RECORD;
BEGIN
  PERFORM public.package_d_replacement_evidence_before_carton_internal(p_operation_id,p_require_issued);
  FOR v_item IN SELECT root_order_item_id,quantity,condition_code FROM public.sales_replacement_items WHERE operation_id=p_operation_id LOOP
    IF v_item.condition_code IS DISTINCT FROM 'supplier_defect' THEN RAISE EXCEPTION 'AFTERCARE211_DEFECT_REQUIRED'; END IF;
    PERFORM public.aftercare211_assert_replacement_root_internal(v_item.root_order_item_id,v_item.quantity);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.phase42_assert_operational_return_evidence_internal(p_operation_id UUID,p_require_settled BOOLEAN DEFAULT true)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_item RECORD; v_root RECORD;
BEGIN
  PERFORM public.package_d_assert_return_evidence_before_single_sku_internal(p_operation_id,p_require_settled);
  FOR v_item IN SELECT * FROM public.sales_return_items
    WHERE operation_id=p_operation_id AND return_scope='base_unit' LOOP
    PERFORM public.package_d_assert_whole_single_sku_quantity_internal(v_item.order_item_id,v_item.returned_quantity);
    PERFORM public.package_d_assert_carton_return_item_internal(to_jsonb(v_item));
  END LOOP;
  FOR v_item IN SELECT source_kind,source_id,product_id,consumed_quantity
    FROM public.sales_aftercare_consumptions WHERE operation_id=p_operation_id LOOP
    SELECT * INTO v_root FROM public.phase4_aftercare_source_root_internal(v_item.source_kind,v_item.source_id,v_item.product_id);
    IF v_root.root_kind='base_order_item' THEN
      PERFORM public.aftercare211_assert_replacement_root_internal(v_root.root_id,v_item.consumed_quantity);
    END IF;
  END LOOP;
END;
$$;

-- Exact209 issuer except the two approved replacement-only admission checks;
-- canonical actor/key/order/inventory locks,48h,issuance/cost/evidence unchanged.
CREATE OR REPLACE FUNCTION public.parcel209_replacement_issuer_internal(p_order_id uuid, p_idempotency_key text, p_items jsonb, p_reason text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_actor_hash TEXT;
  v_key TEXT;
  v_canonical JSONB;
  v_fingerprint TEXT;
  v_replay JSONB;
  v_order public.orders%ROWTYPE;
  v_creation_type TEXT;
  v_completion_at TIMESTAMPTZ;
  v_operation_id UUID := gen_random_uuid();
  v_event_id UUID := gen_random_uuid();
  v_now TIMESTAMPTZ;
  v_item JSONB;
  v_prepared JSONB := '[]'::JSONB;
  v_product_ids UUID[];
  v_source_kind TEXT;
  v_source_id UUID;
  v_quantity INTEGER;
  v_product_id UUID;
  v_root_order_item_id UUID;
  v_root_parcel_instance_id UUID;
  v_root_parcel_component_id UUID;
  v_original_sale_operation_id UUID;
  v_parent_replacement_item_id UUID;
  v_capacity INTEGER;
  v_consumed INTEGER;
  v_wac NUMERIC(24, 6);
  v_cogs BIGINT;
  v_replacement_item_id UUID;
  v_before INTEGER;
  v_available INTEGER;
  v_after INTEGER;
  v_movement_id UUID;
  v_result JSONB;
  v_total_quantity INTEGER := 0;
  v_total_cogs BIGINT := 0;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner', 'admin'], 'إصدار استبدال مبيعات Phase 4.3');
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'PHASE43_ACTOR_REQUIRED: Authenticated ERP actor is required.';
  END IF;
  v_key := public.phase4_canonicalize_idempotency_key_internal(p_idempotency_key);
  v_canonical := public.phase43_canonicalize_replacement_request_internal(
    p_order_id, p_items, p_reason, p_notes
  );
  v_actor_hash := public.phase3_actor_scope_hash_internal('erp_user', v_user_id, NULL, NULL);
  v_fingerprint := public.phase3_request_fingerprint_internal(v_canonical);
  v_replay := public.phase43_resolve_replacement_replay_internal(
    v_key, v_actor_hash, v_fingerprint
  );
  IF v_replay->>'decision' = 'REPLAY' THEN
    RETURN v_replay->'result_snapshot';
  END IF;

  PERFORM public.phase4_lock_customer_order_context_internal(p_order_id, false, false);
  SELECT * INTO v_order FROM public.orders customer_order
  WHERE customer_order.id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.status IS DISTINCT FROM 'completed'
    OR v_order.branch_id IS NULL OR v_order.warehouse_id IS NULL
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE43_ORIGINAL_SALE_INVALID: Replacement requires a completed sale with branch and warehouse evidence.';
  END IF;
  SELECT operation.operation_type INTO v_creation_type
  FROM public.business_operations operation WHERE operation.id = v_order.operation_id FOR SHARE;
  IF v_creation_type IS NULL OR v_creation_type NOT IN ('phase3_pos_sale_v1', 'phase3_customer_reservation_v1') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE43_SALE_CONTRACT_UNSUPPORTED: Only proven Phase-3 POS V2 and Customer V2 sales are supported.';
  END IF;

  FOR v_item IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_canonical->'items')
    ORDER BY value->>'source_kind', value->>'source_id'
  LOOP
    v_source_kind := v_item->>'source_kind';
    v_source_id := (v_item->>'source_id')::UUID;
    v_quantity := (v_item->>'quantity')::INTEGER;
    v_root_order_item_id := NULL;
    v_root_parcel_instance_id := NULL;
    v_root_parcel_component_id := NULL;
    v_original_sale_operation_id := NULL;
    v_parent_replacement_item_id := NULL;

    IF v_source_kind = 'base_order_item' THEN
      SELECT item.id, item.product_id, item.quantity
      INTO v_root_order_item_id, v_product_id, v_capacity
      FROM public.order_items item
      WHERE item.id = v_source_id AND item.order_id = p_order_id
        AND item.commercial_line_kind IN ('base_unit','legacy_single_sku_parcel');
    ELSIF v_source_kind = 'parcel_component' THEN
      SELECT order_item.id, instance.id, component.id, component.operation_id,
        component.product_id, component.base_quantity
      INTO v_root_order_item_id, v_root_parcel_instance_id,
        v_root_parcel_component_id, v_original_sale_operation_id,
        v_product_id, v_capacity
      FROM public.order_parcel_components component
      JOIN public.order_parcel_instances instance ON instance.id = component.parcel_instance_id
      JOIN public.order_items order_item ON order_item.id = instance.order_item_id
      WHERE component.id = v_source_id AND instance.order_id = p_order_id;
    ELSE
      SELECT item.root_order_item_id, item.root_parcel_instance_id,
        item.root_parcel_component_id, item.original_sale_operation_id,
        item.product_id, item.quantity, item.id
      INTO v_root_order_item_id, v_root_parcel_instance_id,
        v_root_parcel_component_id, v_original_sale_operation_id,
        v_product_id, v_capacity, v_parent_replacement_item_id
      FROM public.sales_replacement_items item
      JOIN public.sales_replacement_events event ON event.id = item.replacement_event_id
      WHERE item.id = v_source_id AND event.root_order_id = p_order_id
        AND event.replacement_status = 'settled'
        AND event.issuance_status = 'issued'
        AND event.issuance_coordinator_version = 403;
      IF v_parent_replacement_item_id IS NOT NULL THEN
        PERFORM public.phase43_assert_operational_replacement_evidence_internal(
          (SELECT operation_id FROM public.sales_replacement_items WHERE id = v_parent_replacement_item_id), true
        );
      END IF;
    END IF;

    IF v_product_id IS NULL OR v_capacity IS NULL OR v_quantity > v_capacity THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'PHASE43_REPLACEMENT_SOURCE_INVALID: Source is unavailable or quantity exceeds its immutable capacity.';
    END IF;
    PERFORM public.aftercare211_assert_replacement_root_internal(v_root_order_item_id,v_quantity);
    v_prepared := v_prepared || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
      'source_kind', v_source_kind, 'source_id', v_source_id,
      'quantity', v_quantity, 'product_id', v_product_id,
      'root_order_item_id', v_root_order_item_id,
      'root_parcel_instance_id', v_root_parcel_instance_id,
      'root_parcel_component_id', v_root_parcel_component_id,
      'original_sale_operation_id', v_original_sale_operation_id,
      'parent_replacement_item_id', v_parent_replacement_item_id
    ));
  END LOOP;

  SELECT ARRAY_AGG(DISTINCT (item->>'product_id')::UUID ORDER BY (item->>'product_id')::UUID)
  INTO v_product_ids FROM JSONB_ARRAY_ELEMENTS(v_prepared) item;
  PERFORM public.phase2_lock_inventory_products_internal(v_product_ids);
  -- Same-SKU supplier_defect issuer only; no whole-commercial restriction on defective pieces.
  v_completion_at := public.phase4_authoritative_completion_internal(p_order_id);
  IF clock_timestamp() > v_completion_at + INTERVAL '48 hours' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_REPLACEMENT_WINDOW_INVALID: Replacement is outside the original 48-hour window.';
  END IF;

  FOR v_item IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_prepared)
    ORDER BY value->>'source_kind', value->>'source_id'
  LOOP
    v_source_kind := v_item->>'source_kind';
    v_source_id := (v_item->>'source_id')::UUID;
    v_quantity := (v_item->>'quantity')::INTEGER;
    v_product_id := (v_item->>'product_id')::UUID;
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'phase4-aftercare|' || v_source_kind || '|' || v_source_id::TEXT, 0
    ));
    SELECT COALESCE(SUM(consumption.consumed_quantity), 0)::INTEGER
    INTO v_consumed FROM public.sales_aftercare_consumptions consumption
    WHERE consumption.source_kind = v_source_kind
      AND consumption.source_id = v_source_id
      AND consumption.consumption_state = 'settled';
    IF v_source_kind = 'base_order_item' THEN
      SELECT quantity INTO v_capacity FROM public.order_items
      WHERE id = v_source_id AND product_id = v_product_id FOR UPDATE;
    ELSIF v_source_kind = 'parcel_component' THEN
      SELECT base_quantity INTO v_capacity FROM public.order_parcel_components
      WHERE id = v_source_id AND product_id = v_product_id FOR UPDATE;
    ELSE
      SELECT quantity INTO v_capacity FROM public.sales_replacement_items
      WHERE id = v_source_id AND product_id = v_product_id FOR UPDATE;
    END IF;
    IF v_capacity IS NULL OR v_consumed + v_quantity > v_capacity THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED: Replacement exceeds the remaining physical source.';
    END IF;
    SELECT product.wac_cost_in_minor_units_exact INTO v_wac
    FROM public.products product WHERE product.id = v_product_id FOR NO KEY UPDATE;
    SELECT balance.on_hand_quantity, balance.available_quantity
    INTO v_before, v_available
    FROM public.inventory_balances balance
    WHERE balance.warehouse_id = v_order.warehouse_id
      AND balance.product_id = v_product_id FOR UPDATE;
    IF v_wac IS NULL OR v_before IS NULL OR v_available < v_quantity THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE43_REPLACEMENT_INVENTORY_UNAVAILABLE: Sellable inventory or exact WAC evidence is insufficient.';
    END IF;
  END LOOP;

  v_now := clock_timestamp();
  SELECT COALESCE(SUM((item->>'quantity')::INTEGER), 0)::INTEGER,
    COALESCE(SUM(ROUND(product.wac_cost_in_minor_units_exact
      * (item->>'quantity')::INTEGER)::BIGINT), 0)::BIGINT
  INTO v_total_quantity, v_total_cogs
  FROM JSONB_ARRAY_ELEMENTS(v_prepared) item
  JOIN public.products product ON product.id = (item->>'product_id')::UUID;
  v_result := JSONB_BUILD_OBJECT(
    'success', true, 'idempotentReplay', false,
    'operationId', v_operation_id, 'replacementId', v_event_id,
    'orderId', p_order_id, 'operationalCoordinatorVersion', 403,
    'issuedQuantity', v_total_quantity,
    'replacementCogsInMinorUnits', v_total_cogs,
    'moneyRefundInMinorUnits', 0, 'debtReductionInMinorUnits', 0
  );

  INSERT INTO public.business_operations(
    id, operation_type, idempotency_key, request_fingerprint, initiated_by,
    result_snapshot, completed_at, request_identity_version,
    request_identity_snapshot, actor_scope_type, actor_scope_hash
  ) VALUES (
    v_operation_id, 'phase4_replacement_v1', v_key, v_fingerprint, v_user_id,
    v_result, v_now, 401, v_canonical, 'erp_user', v_actor_hash
  );
  INSERT INTO public.sales_replacement_events(
    id, operation_id, root_order_id, branch_id, warehouse_id,
    contract_version, replacement_status, original_completed_at_snapshot,
    reason, created_by, issuance_coordinator_version
  ) VALUES (
    v_event_id, v_operation_id, p_order_id, v_order.branch_id,
    v_order.warehouse_id, 401, 'draft', v_completion_at,
    v_canonical->>'reason', v_user_id, 403
  );

  FOR v_item IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_prepared)
    ORDER BY value->>'source_kind', value->>'source_id'
  LOOP
    v_source_kind := v_item->>'source_kind';
    v_source_id := (v_item->>'source_id')::UUID;
    v_quantity := (v_item->>'quantity')::INTEGER;
    v_product_id := (v_item->>'product_id')::UUID;
    SELECT product.wac_cost_in_minor_units_exact INTO STRICT v_wac
    FROM public.products product WHERE product.id = v_product_id;
    v_cogs := ROUND(v_wac * v_quantity)::BIGINT;
    v_replacement_item_id := gen_random_uuid();
    INSERT INTO public.sales_replacement_items(
      id, replacement_event_id, operation_id, root_order_item_id,
      root_parcel_instance_id, root_parcel_component_id,
      original_sale_operation_id, parent_replacement_item_id,
      product_id, quantity, replacement_unit_cost_snapshot_in_minor_units_exact,
      replacement_cogs_snapshot_in_minor_units, condition_code
    ) VALUES (
      v_replacement_item_id, v_event_id, v_operation_id,
      (v_item->>'root_order_item_id')::UUID,
      (v_item->>'root_parcel_instance_id')::UUID,
      (v_item->>'root_parcel_component_id')::UUID,
      (v_item->>'original_sale_operation_id')::UUID,
      (v_item->>'parent_replacement_item_id')::UUID,
      v_product_id, v_quantity, v_wac, v_cogs, 'supplier_defect'
    );
    INSERT INTO public.sales_aftercare_consumptions(
      operation_id, replacement_item_id, source_kind, source_id,
      product_id, consumed_quantity, consumption_kind
    ) VALUES (
      v_operation_id, v_replacement_item_id, v_source_kind, v_source_id,
      v_product_id, v_quantity, 'replacement'
    );
    SELECT balance.on_hand_quantity INTO STRICT v_before
    FROM public.inventory_balances balance
    WHERE balance.warehouse_id = v_order.warehouse_id
      AND balance.product_id = v_product_id FOR UPDATE;
    v_after := v_before - v_quantity;
    UPDATE public.inventory_balances SET on_hand_quantity = v_after,
      updated_at = clock_timestamp()
    WHERE warehouse_id = v_order.warehouse_id AND product_id = v_product_id;
    INSERT INTO public.inventory_movements(
      warehouse_id, product_id, movement_type, quantity,
      balance_before, balance_after, reference_type, reference_id,
      notes, created_by, operation_id
    ) VALUES (
      v_order.warehouse_id, v_product_id, 'sales_deduction', -v_quantity,
      v_before, v_after, 'phase4_replacement_item', v_replacement_item_id,
      'Phase 4.3 operational Replacement issuance', v_user_id, v_operation_id
    ) RETURNING id INTO v_movement_id;
    INSERT INTO public.phase43_replacement_inventory_effects(
      operation_id, replacement_event_id, replacement_item_id,
      warehouse_id, product_id, inventory_movement_id,
      source_kind, source_id, issued_quantity,
      replacement_unit_cost_snapshot_in_minor_units_exact,
      replacement_cogs_snapshot_in_minor_units,
      target_balance_before, target_balance_after
    ) VALUES (
      v_operation_id, v_event_id, v_replacement_item_id,
      v_order.warehouse_id, v_product_id, v_movement_id,
      v_source_kind, v_source_id, v_quantity, v_wac, v_cogs,
      v_before, v_after
    );
  END LOOP;
  INSERT INTO public.phase43_replacement_issuance_guards(
    transaction_id, operation_id, replacement_event_id
  ) VALUES (pg_current_xact_id(), v_operation_id, v_event_id);
  INSERT INTO public.phase43_replacement_settlement_evidence(
    operation_id, replacement_event_id, order_id,
    result_snapshot, inventory_effects_snapshot
  ) VALUES (
    v_operation_id, v_event_id, p_order_id, v_result,
    public.phase43_inventory_effects_snapshot_internal(v_operation_id)
  );
  PERFORM public.phase4_finalize_aftercare_operation_internal(v_operation_id);
  DELETE FROM public.phase43_replacement_issuance_guards
  WHERE transaction_id = pg_current_xact_id() AND operation_id = v_operation_id;
  INSERT INTO public.audit_logs(user_id, action, entity_name, entity_id, details)
  VALUES (v_user_id, 'SETTLE_PHASE43_SALES_REPLACEMENT',
    'sales_replacement_events', v_event_id,
    JSONB_BUILD_OBJECT('operation_id', v_operation_id, 'order_id', p_order_id,
      'issued_quantity', v_total_quantity, 'replacement_cogs', v_total_cogs));
  RETURN v_result;
END;
$function$;


-- Owner J4/J5. Historical sale/issuance/return evidence is never rewritten.
-- The held asset is the defective physical leaf at ITS historical cost.
-- Any difference from the newly issued replacement cost remains in profit.
ALTER TABLE public.supplier_replacement_cases DROP CONSTRAINT supplier_replacement_cases_origin_check;
ALTER TABLE public.supplier_replacement_cases DROP CONSTRAINT supplier_replacement_cases_check1;
ALTER TABLE public.supplier_replacement_cases ADD CONSTRAINT supplier_replacement211_origin CHECK
 (origin IN ('shop','customer_return','shop_damage','customer_replacement'));
ALTER TABLE public.supplier_replacement_cases ADD CONSTRAINT supplier_replacement211_source CHECK
 ((origin IN ('shop','customer_replacement') AND supplier_id IS NOT NULL AND damage_event_id IS NULL)
 OR (origin='customer_return' AND supplier_id IS NOT NULL AND damage_event_id IS NOT NULL)
 OR (origin='shop_damage' AND supplier_id IS NULL AND damage_event_id IS NOT NULL));

CREATE TABLE public.aftercare_supplier_links (
 case_id UUID PRIMARY KEY REFERENCES public.supplier_replacement_cases(id) ON DELETE RESTRICT,
 replacement_item_id UUID UNIQUE REFERENCES public.sales_replacement_items(id) ON DELETE RESTRICT,
 damage_event_id UUID UNIQUE REFERENCES public.inventory_damage_events(id) ON DELETE RESTRICT,
 original_operation_id UUID NOT NULL REFERENCES public.business_operations(id) ON DELETE RESTRICT,
 source_fingerprint TEXT NOT NULL CHECK(source_fingerprint~'^[0-9a-f]{64}$'),
 CHECK(num_nonnulls(replacement_item_id,damage_event_id)=1)
);
ALTER TABLE public.aftercare_supplier_links OWNER TO postgres;
ALTER TABLE public.aftercare_supplier_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aftercare_supplier_links FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER aftercare_supplier_links_immutable BEFORE UPDATE OR DELETE ON public.aftercare_supplier_links
 FOR EACH ROW EXECUTE FUNCTION public.inventory_damage_reject_mutation_internal();
CREATE TRIGGER aftercare_supplier_links_no_truncate BEFORE TRUNCATE ON public.aftercare_supplier_links
 FOR EACH STATEMENT EXECUTE FUNCTION public.inventory_damage_reject_mutation_internal();

CREATE FUNCTION public.sr211_source_internal(p_kind TEXT,p_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE f public.phase43_replacement_inventory_effects%ROWTYPE; d public.inventory_damage_events%ROWTYPE;
 o public.orders%ROWTYPE; cost NUMERIC(24,6); original_id UUID; source JSONB;
BEGIN
 IF p_kind='replacement' THEN
  SELECT * INTO f FROM public.phase43_replacement_inventory_effects WHERE replacement_item_id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'AFTERCARE211_SOURCE_INVALID'; END IF;
  PERFORM public.phase43_assert_operational_replacement_evidence_internal(f.operation_id,true);
  SELECT ord.* INTO STRICT o FROM public.orders ord JOIN public.sales_replacement_events e ON e.root_order_id=ord.id WHERE e.id=f.replacement_event_id;
  IF f.source_kind='replacement_item' THEN
   SELECT replacement_unit_cost_snapshot_in_minor_units_exact INTO cost FROM public.sales_replacement_items WHERE id=f.source_id AND product_id=f.product_id;
  ELSIF f.source_kind='parcel_component' THEN
   SELECT COALESCE(exact_cogs_snapshot_in_minor_units/NULLIF(base_quantity,0),unit_cost_snapshot_in_minor_units) INTO cost
    FROM public.order_parcel_components WHERE id=f.source_id AND product_id=f.product_id;
  ELSE
   SELECT COALESCE(unit_cost_snapshot_in_minor_units_exact,unit_cost_in_minor_units::NUMERIC) INTO cost
    FROM public.order_items WHERE id=f.source_id AND product_id=f.product_id;
  END IF;
  original_id:=f.operation_id;
  source:=jsonb_build_object('kind',p_kind,'id',p_id,'orderId',o.id,'operationId',original_id,
   'productId',f.product_id,'warehouseId',f.warehouse_id,'branchId',o.branch_id,
   'quantity',f.issued_quantity,'unitCost',cost,'evidence',to_jsonb(f));
 ELSIF p_kind='return' THEN
  SELECT * INTO d FROM public.inventory_damage_events WHERE id=p_id AND origin='customer_return';
  IF NOT FOUND THEN RAISE EXCEPTION 'AFTERCARE211_SOURCE_INVALID'; END IF;
  SELECT e.operation_id INTO STRICT original_id FROM public.sales_return_events e WHERE e.id=d.return_event_id;
  SELECT ord.* INTO STRICT o FROM public.orders ord JOIN public.sales_return_events e ON e.order_id=ord.id WHERE e.id=d.return_event_id;
  PERFORM public.phase42_assert_operational_return_evidence_internal(original_id,true);
  cost:=d.unit_cost_in_minor_units_exact;
  source:=jsonb_build_object('kind',p_kind,'id',p_id,'orderId',o.id,'operationId',original_id,
   'productId',d.product_id,'warehouseId',d.warehouse_id,'branchId',d.branch_id,
   'quantity',d.quantity,'unitCost',cost,'evidence',to_jsonb(d));
 ELSE RAISE EXCEPTION 'AFTERCARE211_SOURCE_INVALID'; END IF;
 IF cost IS NULL OR cost<0 THEN RAISE EXCEPTION 'DAMAGE_HISTORICAL_COST_MISSING'; END IF;
 RETURN source;
END $$;

CREATE FUNCTION public.sr211_blocked_internal(p_kind TEXT,p_id UUID)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.aftercare_supplier_links WHERE replacement_item_id=p_id OR damage_event_id=p_id)
  OR (p_kind='return' AND EXISTS(SELECT 1 FROM public.supplier_replacement_cases WHERE damage_event_id=p_id)) THEN
  RETURN 'AFTERCARE211_ALREADY_CLASSIFIED';
 END IF;
 IF p_kind='replacement' AND EXISTS(SELECT 1 FROM public.sales_aftercare_consumptions
  WHERE source_kind='replacement_item' AND source_id=p_id AND consumption_state='settled') THEN
  RETURN 'AFTERCARE211_DEPENDENCY';
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION public.sr211_links_manifest_internal(p_operation_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.case_id),'[]') FROM public.aftercare_supplier_links l
 JOIN public.supplier_replacement_cases c ON c.id=l.case_id WHERE c.operation_id=p_operation_id;
$$;

-- Preserve the exact 208 manifest shape and commitments for every old operation.
ALTER FUNCTION public.sr208_assert_operation_internal(UUID) RENAME TO sr211_assert_operation_before211_internal;
REVOKE ALL ON FUNCTION public.sr211_assert_operation_before211_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.sr208_assert_operation_internal(p_operation_id UUID)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE l RECORD; s JSONB; creator public.business_operations%ROWTYPE; manifest JSONB;
BEGIN
 PERFORM public.sr211_assert_operation_before211_internal(p_operation_id);
 FOR l IN SELECT links.*,c.operation_id,c.product_id,c.warehouse_id,c.branch_id,c.quantity,c.unit_cost_in_minor_units_exact,c.origin
  FROM public.aftercare_supplier_links links JOIN public.supplier_replacement_cases c ON c.id=links.case_id
  WHERE c.operation_id=p_operation_id OR EXISTS(SELECT 1 FROM public.supplier_replacement_events e WHERE e.case_id=c.id AND e.operation_id=p_operation_id)
 LOOP
  SELECT * INTO STRICT creator FROM public.business_operations WHERE id=l.operation_id;
  manifest:=public.sr211_links_manifest_internal(l.operation_id);
  IF creator.result_snapshot->>'aftercare211Fingerprint' IS DISTINCT FROM encode(extensions.digest(manifest::TEXT,'sha256'),'hex') THEN
   RAISE EXCEPTION 'AFTERCARE211_EVIDENCE_INVALID';
  END IF;
  IF creator.request_identity_snapshot->>'action'='replacement_supplier' AND(
   creator.result_snapshot->>'replacementOperationId' IS DISTINCT FROM l.original_operation_id::TEXT
   OR creator.request_identity_snapshot->'financialRequest' IS DISTINCT FROM (SELECT request_identity_snapshot FROM public.business_operations WHERE id=l.original_operation_id)
   OR creator.result_snapshot->>'replacementResultFingerprint' IS DISTINCT FROM (SELECT encode(extensions.digest(result_snapshot::TEXT,'sha256'),'hex') FROM public.business_operations WHERE id=l.original_operation_id)
   OR creator.initiated_by IS DISTINCT FROM (SELECT initiated_by FROM public.business_operations WHERE id=l.original_operation_id)) THEN
   RAISE EXCEPTION 'AFTERCARE211_EVIDENCE_INVALID';
  END IF;
  s:=public.sr211_source_internal(CASE WHEN l.replacement_item_id IS NULL THEN 'return' ELSE 'replacement' END,COALESCE(l.replacement_item_id,l.damage_event_id));
  IF l.source_fingerprint IS DISTINCT FROM encode(extensions.digest(s::TEXT,'sha256'),'hex')
   OR l.original_operation_id IS DISTINCT FROM (s->>'operationId')::UUID
   OR l.product_id IS DISTINCT FROM (s->>'productId')::UUID OR l.warehouse_id IS DISTINCT FROM (s->>'warehouseId')::UUID
   OR l.branch_id IS DISTINCT FROM (s->>'branchId')::UUID OR l.quantity IS DISTINCT FROM (s->>'quantity')::INTEGER
   OR l.unit_cost_in_minor_units_exact IS DISTINCT FROM (s->>'unitCost')::NUMERIC
   OR (l.replacement_item_id IS NOT NULL AND l.origin<>'customer_replacement') THEN RAISE EXCEPTION 'AFTERCARE211_EVIDENCE_INVALID'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.supplier_replacement_cases c WHERE c.origin='customer_replacement'
  AND(c.operation_id=p_operation_id OR EXISTS(SELECT 1 FROM public.supplier_replacement_events e WHERE e.case_id=c.id AND e.operation_id=p_operation_id))
  AND NOT EXISTS(SELECT 1 FROM public.aftercare_supplier_links missing_link WHERE missing_link.case_id=c.id)) THEN RAISE EXCEPTION 'AFTERCARE211_EVIDENCE_INVALID'; END IF;
END $$;

CREATE FUNCTION public.preview_aftercare_supplier_v1(p_kind TEXT,p_source_id UUID,p_supplier_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s JSONB; blocked TEXT;
BEGIN
 PERFORM public.sr208_assert_role_internal('customer_return');
 s:=public.sr211_source_internal(p_kind,p_source_id);
 blocked:=public.sr211_blocked_internal(p_kind,p_source_id);
 IF NOT EXISTS(SELECT 1 FROM public.suppliers WHERE id=p_supplier_id AND is_active) THEN blocked:='SUPPLIER_REPLACEMENT_SUPPLIER_INVALID'; END IF;
 RETURN jsonb_build_object('contractVersion',211,'eligible',blocked IS NULL,'blockedReason',blocked,
  'sourceKind',p_kind,'sourceId',p_source_id,'supplierId',p_supplier_id,'productId',s->'productId',
  'quantity',s->'quantity','unitCostInMinorUnitsExact',s->>'unitCost',
  'reclassifiedInMinorUnits',round((s->>'quantity')::INTEGER*(s->>'unitCost')::NUMERIC)::BIGINT,
  'previewFingerprint',encode(extensions.digest(jsonb_build_object('source',s,'supplierId',p_supplier_id)::TEXT,'sha256'),'hex'));
END $$;

CREATE FUNCTION public.get_aftercare_damage_candidates_v1(p_order_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE rows JSONB;
BEGIN
 PERFORM public.sr208_assert_role_internal('customer_return');
 WITH candidates AS (
  SELECT 'replacement'::TEXT kind,f.replacement_item_id id,e.issued_at occurred_at,f.product_id
   FROM public.phase43_replacement_inventory_effects f JOIN public.sales_replacement_events e ON e.id=f.replacement_event_id WHERE e.root_order_id=p_order_id
  UNION ALL SELECT 'return',d.id,d.occurred_at,d.product_id FROM public.inventory_damage_events d JOIN public.sales_return_events e ON e.id=d.return_event_id
   WHERE e.order_id=p_order_id AND d.origin='customer_return'
 ), sources AS(SELECT c.*,public.sr211_source_internal(c.kind,c.id) source FROM candidates c)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('kind',kind,'id',id,'productId',product_id,
  'productName',(SELECT name_ar FROM public.products WHERE products.id=sources.product_id),'occurredAt',occurred_at,
  'quantity',source->'quantity','blockedReason',public.sr211_blocked_internal(kind,id)) ORDER BY occurred_at,id),'[]') INTO rows FROM sources;
 RETURN jsonb_build_object('contractVersion',211,'candidates',rows);
END $$;

-- New owner-only coordinator; existing 121/132/209 writers remain the sole
-- issuers of money and sellable stock. A failure rolls the entire call back.
CREATE FUNCTION public.execute_aftercare_supplier_v1(p_action TEXT,p_idempotency_key TEXT,p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor UUID; k TEXT:=btrim(p_idempotency_key); reason TEXT; allowed TEXT[];
 request JSONB; financial JSONB; financial_replay JSONB; fingerprint TEXT; existing public.business_operations%ROWTYPE;
 op UUID:=gen_random_uuid(); original UUID; order_id UUID; supplier UUID; source_kind TEXT; source_id UUID;
 source JSONB; preview JSONB; blocked TEXT; issued JSONB; row RECORD; case_id UUID; case_ids UUID[]:='{}'::UUID[];
 manifest JSONB; result JSONB; at TIMESTAMPTZ; quantity INTEGER; cost NUMERIC(24,6); unit_name TEXT;
BEGIN
 actor:=public.sr208_assert_role_internal('customer_return');
 IF p_action NOT IN ('replacement_supplier','reclassify_replacement','reclassify_return') OR p_action IS NULL THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_ACTION_INVALID'; END IF;
 IF k IS NULL OR length(k) NOT BETWEEN 16 AND 200 THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_KEY_INVALID'; END IF;
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_REQUEST_INVALID'; END IF;
 reason:=NULLIF(btrim(p_payload->>'reason'),'');
 IF reason IS NULL OR length(reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_REASON_INVALID'; END IF;
 allowed:=CASE WHEN p_action='replacement_supplier' THEN ARRAY['orderId','items','reason','notes','supplierId']
  ELSE ARRAY['sourceId','supplierId','reason','previewFingerprint'] END;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) x WHERE NOT x=ANY(allowed)) THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_FIELD_INVALID'; END IF;
 supplier:=(p_payload->>'supplierId')::UUID;
 IF supplier IS NULL THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_SUPPLIER_INVALID'; END IF;
 IF p_action='replacement_supplier' THEN
  order_id:=(p_payload->>'orderId')::UUID;
  financial:=public.phase43_canonicalize_replacement_request_internal(order_id,p_payload->'items',reason,p_payload->>'notes');
  financial_replay:=public.phase43_resolve_replacement_replay_internal(public.phase4_canonicalize_idempotency_key_internal(k),
   public.phase3_actor_scope_hash_internal('erp_user',actor,NULL,NULL),public.phase3_request_fingerprint_internal(financial));
  request:=jsonb_build_object('action',p_action,'financialRequest',financial,'supplierId',supplier);
 ELSE
  source_kind:=CASE WHEN p_action='reclassify_replacement' THEN 'replacement' ELSE 'return' END;
  source_id:=(p_payload->>'sourceId')::UUID;
  IF source_id IS NULL OR p_payload->>'previewFingerprint' IS NULL THEN RAISE EXCEPTION 'AFTERCARE211_PREVIEW_REQUIRED'; END IF;
  request:=jsonb_build_object('action',p_action,'sourceId',source_id,'supplierId',supplier,'reason',reason,'previewFingerprint',p_payload->>'previewFingerprint');
 END IF;
 fingerprint:=encode(extensions.digest(request::TEXT,'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('supplier-replacement208|'||actor::TEXT||'|'||k,0));
 SELECT * INTO existing FROM public.business_operations WHERE operation_type='supplier_replacement208' AND initiated_by=actor AND idempotency_key=k;
 IF FOUND THEN
  IF existing.request_fingerprint IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_IDEMPOTENCY_CONFLICT'; END IF;
  PERFORM public.sr208_assert_operation_internal(existing.id);
  IF p_action='replacement_supplier' AND(financial_replay->>'decision' IS DISTINCT FROM 'REPLAY'
   OR financial_replay->>'operation_id' IS DISTINCT FROM existing.result_snapshot->>'replacementOperationId') THEN RAISE EXCEPTION 'AFTERCARE211_EVIDENCE_INVALID'; END IF;
  SELECT array_agg(x::UUID ORDER BY x::UUID) INTO case_ids FROM jsonb_array_elements_text(existing.result_snapshot->'caseIds') x;
  RETURN jsonb_build_object('success',true,'contractVersion',208,'action',p_action,'idempotencyKey',k,'operationId',existing.id,'idempotent',true,
   'cases',(SELECT jsonb_agg(public.sr208_case_dto_internal(id,true) ORDER BY id) FROM unnest(case_ids) id));
 END IF;
 IF p_action='replacement_supplier' AND financial_replay->>'decision'='REPLAY' THEN RAISE EXCEPTION 'AFTERCARE211_STANDALONE_IDENTITY'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.suppliers WHERE id=supplier AND is_active) THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_SUPPLIER_INVALID'; END IF;
 IF p_action='replacement_supplier' THEN
  issued:=public.settle_sales_replacement_v1(order_id,k,p_payload->'items',reason,p_payload->>'notes');
  original:=(issued->>'operationId')::UUID;
  IF original IS NULL THEN RAISE EXCEPTION 'AFTERCARE211_EVIDENCE_INVALID'; END IF;
 ELSE
  source:=public.sr211_source_internal(source_kind,source_id);
  order_id:=(source->>'orderId')::UUID;
  PERFORM public.phase4_lock_customer_order_context_internal(order_id,false,false);
  PERFORM public.phase2_lock_inventory_products_internal(ARRAY[(source->>'productId')::UUID]);
  preview:=public.preview_aftercare_supplier_v1(source_kind,source_id,supplier);
  IF preview->>'previewFingerprint' IS DISTINCT FROM p_payload->>'previewFingerprint' THEN RAISE EXCEPTION 'AFTERCARE211_PREVIEW_CHANGED'; END IF;
  blocked:=preview->>'blockedReason';IF blocked IS NOT NULL THEN RAISE EXCEPTION '%',blocked; END IF;
  original:=(source->>'operationId')::UUID;
 END IF;
 -- Canonical issuer owns inventory locks first; never block on a supplier
 -- already held by receipt cancellation in the opposite hierarchy.
 BEGIN
  PERFORM 1 FROM public.suppliers WHERE id=supplier AND is_active FOR SHARE NOWAIT;
 EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='SUPPLIER_REPLACEMENT_PARENT_BUSY_RETRY'; END;
 IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_SUPPLIER_INVALID'; END IF;
 FOR row IN SELECT 'replacement'::TEXT kind,f.replacement_item_id id FROM public.phase43_replacement_inventory_effects f
  WHERE p_action='replacement_supplier' AND f.operation_id=original
  UNION ALL SELECT source_kind,source_id WHERE p_action<>'replacement_supplier'
  ORDER BY 1,2
 LOOP
  source:=public.sr211_source_internal(row.kind,row.id);
  blocked:=public.sr211_blocked_internal(row.kind,row.id);IF blocked IS NOT NULL THEN RAISE EXCEPTION '%',blocked; END IF;
  quantity:=(source->>'quantity')::INTEGER;cost:=(source->>'unitCost')::NUMERIC;at:=clock_timestamp();
  SELECT COALESCE(u.name_ar,'باكيت') INTO unit_name FROM public.products p LEFT JOIN public.units u ON u.id=p.unit_id WHERE p.id=(source->>'productId')::UUID;
  INSERT INTO public.supplier_replacement_cases(operation_id,supplier_id,product_id,warehouse_id,branch_id,origin,damage_event_id,
   quantity,commercial_quantity,units_per_commercial_unit,unit_name,base_unit_name,unit_cost_in_minor_units_exact,occurred_at,created_by)
  VALUES(op,supplier,(source->>'productId')::UUID,(source->>'warehouseId')::UUID,(source->>'branchId')::UUID,
   CASE WHEN row.kind='replacement' THEN 'customer_replacement' ELSE 'customer_return' END,CASE WHEN row.kind='return' THEN row.id END,
   quantity,quantity,1,unit_name,unit_name,cost,at,actor) RETURNING id INTO case_id;
  INSERT INTO public.aftercare_supplier_links(case_id,replacement_item_id,damage_event_id,original_operation_id,source_fingerprint)
   VALUES(case_id,CASE WHEN row.kind='replacement' THEN row.id END,CASE WHEN row.kind='return' THEN row.id END,
    (source->>'operationId')::UUID,encode(extensions.digest(source::TEXT,'sha256'),'hex'));
  PERFORM public.sr208_append_event_internal(op,case_id,'send',quantity,quantity,-round(quantity*cost)::BIGINT,0,reason,at);
  case_ids:=array_append(case_ids,case_id);
 END LOOP;
 IF cardinality(case_ids)=0 THEN RAISE EXCEPTION 'AFTERCARE211_EVIDENCE_INVALID'; END IF;
 manifest:=public.sr208_operation_manifest_internal(op);
 result:=jsonb_build_object('evidenceFingerprint',encode(extensions.digest(manifest::TEXT,'sha256'),'hex'),
  'aftercare211Fingerprint',encode(extensions.digest(public.sr211_links_manifest_internal(op)::TEXT,'sha256'),'hex'),
  'caseIds',(SELECT jsonb_agg(x->'id' ORDER BY x->>'id') FROM jsonb_array_elements(manifest->'cases') x),
  'eventIds',(SELECT jsonb_agg(x->'id' ORDER BY x->>'id') FROM jsonb_array_elements(manifest->'events') x));
 -- The shared envelope contains commitments/IDs only. Replacement COGS stays
 -- in its existing protected issuance evidence, never copied into this tail.
 IF p_action='replacement_supplier' THEN result:=result||jsonb_build_object('replacementOperationId',original,
  'replacementResultFingerprint',encode(extensions.digest(issued::TEXT,'sha256'),'hex')); END IF;
 INSERT INTO public.business_operations(id,operation_type,idempotency_key,request_fingerprint,request_identity_version,request_identity_snapshot,initiated_by,result_snapshot,completed_at)
 VALUES(op,'supplier_replacement208',k,fingerprint,208,request,actor,result,clock_timestamp());
 PERFORM public.sr208_assert_operation_internal(op);
 INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details)
 VALUES(actor,'AFTERCARE_SUPPLIER_DISPOSITION','business_operations',op,jsonb_build_object('action',p_action,'order_id',order_id,'case_ids',case_ids));
 RETURN jsonb_build_object('success',true,'contractVersion',208,'action',p_action,'idempotencyKey',k,'operationId',op,'idempotent',false,
  'cases',(SELECT jsonb_agg(public.sr208_case_dto_internal(id,true) ORDER BY id) FROM unnest(case_ids) id));
END $$;

ALTER FUNCTION public.sr211_source_internal(TEXT,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sr211_source_internal(TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.sr211_blocked_internal(TEXT,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sr211_blocked_internal(TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.sr211_links_manifest_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sr211_links_manifest_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.sr211_assert_operation_before211_internal(UUID) OWNER TO postgres;
ALTER FUNCTION public.sr208_assert_operation_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sr208_assert_operation_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.preview_aftercare_supplier_v1(TEXT,UUID,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.preview_aftercare_supplier_v1(TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.preview_aftercare_supplier_v1(TEXT,UUID,UUID) TO authenticated;
ALTER FUNCTION public.get_aftercare_damage_candidates_v1(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_aftercare_damage_candidates_v1(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_aftercare_damage_candidates_v1(UUID) TO authenticated;
ALTER FUNCTION public.execute_aftercare_supplier_v1(TEXT,TEXT,JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.execute_aftercare_supplier_v1(TEXT,TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.execute_aftercare_supplier_v1(TEXT,TEXT,JSONB) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
