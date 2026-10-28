BEGIN;

-- Owner-approved T-B design, 2026-10-28. No historical event or snapshot is
-- rewritten. An inspected warranty extends the existing physical issuer with
-- separate immutable evidence for the returned good packets and bad packets.
CREATE TABLE public.aftercare215_inspections (
 operation_id UUID PRIMARY KEY REFERENCES public.business_operations(id) DEFERRABLE INITIALLY DEFERRED,
 replacement_operation_id UUID NOT NULL UNIQUE REFERENCES public.business_operations(id),
 order_id UUID NOT NULL REFERENCES public.orders(id),
 good_recovery_in_minor_units BIGINT NOT NULL CHECK(good_recovery_in_minor_units>=0),
 created_at TIMESTAMPTZ NOT NULL,
 created_by UUID NOT NULL REFERENCES public.profiles(id)
);
CREATE TABLE public.aftercare215_inspection_items (
 replacement_item_id UUID PRIMARY KEY REFERENCES public.sales_replacement_items(id),
 operation_id UUID NOT NULL REFERENCES public.aftercare215_inspections(operation_id) DEFERRABLE INITIALLY DEFERRED,
 product_id UUID NOT NULL REFERENCES public.products(id),
 warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),
 good_quantity INTEGER NOT NULL CHECK(good_quantity>=0),
 bad_quantity INTEGER NOT NULL CHECK(bad_quantity>=0),
 source_unit_cost_exact NUMERIC(24,6) NOT NULL CHECK(source_unit_cost_exact>=0),
 global_quantity_before_restock BIGINT NOT NULL CHECK(global_quantity_before_restock>=0),
 on_hand_before INTEGER NOT NULL CHECK(on_hand_before>=0),
 on_hand_after INTEGER NOT NULL CHECK(on_hand_after>=0),
 wac_before NUMERIC(24,6) NOT NULL CHECK(wac_before>=0),
 wac_after NUMERIC(24,6) NOT NULL CHECK(wac_after>=0),
 movement_id UUID UNIQUE REFERENCES public.inventory_movements(id),
 supplier_case_id UUID UNIQUE REFERENCES public.supplier_replacement_cases(id),
 CHECK(good_quantity+bad_quantity>0),
 CHECK(on_hand_after=on_hand_before+good_quantity),
 CHECK((good_quantity>0)=(movement_id IS NOT NULL)),
 CHECK(supplier_case_id IS NULL OR bad_quantity>0)
);
CREATE INDEX aftercare215_inspection_period ON public.aftercare215_inspections(created_at,order_id);
CREATE INDEX aftercare215_inspection_members ON public.aftercare215_inspection_items(operation_id);
CREATE UNIQUE INDEX aftercare215_actor_key ON public.business_operations(initiated_by,idempotency_key)
 WHERE operation_type='aftercare215_inspection';

ALTER TABLE public.supplier_replacement_cases DROP CONSTRAINT supplier_replacement211_origin;
ALTER TABLE public.supplier_replacement_cases DROP CONSTRAINT supplier_replacement211_source;
ALTER TABLE public.supplier_replacement_cases ADD CONSTRAINT supplier_replacement215_origin CHECK
 (origin IN('shop','customer_return','shop_damage','customer_replacement','inspected_replacement'));
ALTER TABLE public.supplier_replacement_cases ADD CONSTRAINT supplier_replacement215_source CHECK
 ((origin IN('shop','customer_replacement','inspected_replacement') AND supplier_id IS NOT NULL AND damage_event_id IS NULL)
 OR(origin='customer_return' AND supplier_id IS NOT NULL AND damage_event_id IS NOT NULL)
 OR(origin='shop_damage' AND supplier_id IS NULL AND damage_event_id IS NOT NULL));

CREATE FUNCTION public.tb215_canonical_inspection_internal(p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE x JSONB; items JSONB:='[]'; reason TEXT:=nullif(btrim(p_payload->>'reason'),'');
BEGIN
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN('orderId','items','reason','notes'))
 OR reason IS NULL OR length(reason) NOT BETWEEN 3 AND 500
 OR jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array'
 OR jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 200
 THEN RAISE EXCEPTION 'AFTERCARE215_REQUEST_INVALID'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
  IF jsonb_typeof(x) IS DISTINCT FROM 'object'
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(x) k WHERE k NOT IN('sourceKind','sourceId','quantity','goodQuantity','supplierId'))
   OR COALESCE(x->>'sourceKind','') NOT IN('base_order_item','parcel_component','replacement_item')
   OR COALESCE(x->>'quantity','') !~ '^[1-9][0-9]{0,8}$'
   OR COALESCE(x->>'goodQuantity','') !~ '^(0|[1-9][0-9]{0,8})$'
   OR (x->>'goodQuantity')::INTEGER>(x->>'quantity')::INTEGER
   OR ((x->>'goodQuantity')::INTEGER=(x->>'quantity')::INTEGER AND nullif(x->>'supplierId','') IS NOT NULL)
  THEN RAISE EXCEPTION 'AFTERCARE215_INSPECTION_INVALID'; END IF;
  items:=items||jsonb_build_array(jsonb_build_object('sourceKind',x->>'sourceKind','sourceId',(x->>'sourceId')::UUID,
   'quantity',(x->>'quantity')::INTEGER,'goodQuantity',(x->>'goodQuantity')::INTEGER,
   'supplierId',nullif(x->>'supplierId','')::UUID));
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(items) x GROUP BY x->>'sourceKind',x->>'sourceId' HAVING count(*)>1)
 THEN RAISE EXCEPTION 'AFTERCARE215_DUPLICATE_SOURCE'; END IF;
 IF (p_payload->>'orderId')::UUID IS NULL THEN RAISE EXCEPTION 'AFTERCARE215_ORDER_REQUIRED'; END IF;
 RETURN jsonb_build_object('orderId',(p_payload->>'orderId')::UUID,'reason',reason,'notes',nullif(btrim(p_payload->>'notes'),''),
  'items',(SELECT jsonb_agg(x ORDER BY x->>'sourceKind',x->>'sourceId') FROM jsonb_array_elements(items) x));
END $$;

-- This private reader never executes a writer under a rollback/savepoint.
-- The older context calls authoritative_completion, which takes FOR SHARE;
-- preview instead reads the same immutable completion identity without locks.
CREATE FUNCTION public.tb215_read_sale_internal(p_order_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o public.orders%ROWTYPE; b public.business_operations%ROWTYPE; completed TIMESTAMPTZ; matches INTEGER;
BEGIN
 SELECT * INTO o FROM public.orders WHERE id=p_order_id;
 IF NOT FOUND OR o.status IS DISTINCT FROM 'completed' OR o.branch_id IS NULL OR o.warehouse_id IS NULL
 THEN RAISE EXCEPTION 'AFTERCARE215_ORDER_UNAVAILABLE'; END IF;
 SELECT * INTO b FROM public.business_operations WHERE id=o.operation_id;
 IF b.operation_type='phase3_customer_reservation_v1' THEN
  SELECT count(*)::INTEGER,max(completed_at) INTO matches,completed FROM public.business_operations
   WHERE operation_type='phase3_customer_completion_v1' AND completed_at IS NOT NULL
    AND lower(request_identity_snapshot->>'order_id')=p_order_id::TEXT
    AND lower(result_snapshot->>'order_id')=p_order_id::TEXT AND completed_at IS NOT DISTINCT FROM o.cost_finalized_at;
  IF matches<>1 THEN RAISE EXCEPTION 'PHASE4_COMPLETION_EVIDENCE_UNPROVEN'; END IF;
 ELSIF b.operation_type='phase3_pos_sale_v1' THEN completed:=b.completed_at;
 ELSE RAISE EXCEPTION 'PHASE43_SALE_CONTRACT_UNSUPPORTED'; END IF;
 SELECT LEAST(completed,COALESCE(min(x.original_completed_at),completed)) INTO completed FROM public.aftercare215_exchange_results r JOIN public.aftercare215_exchanges x ON x.operation_id=r.operation_id WHERE r.new_order_id=p_order_id;
 IF completed IS NULL OR statement_timestamp()>completed+INTERVAL '48 hours' THEN RAISE EXCEPTION 'AFTERCARE215_ORDER_UNAVAILABLE'; END IF;
 RETURN jsonb_build_object('capability','phase43_modern','order',jsonb_build_object('id',o.id,'orderNumber',o.order_number,
  'status',o.status,'saleContract',b.operation_type,'branchId',o.branch_id,'warehouseId',o.warehouse_id,
  'completedAt',completed,'deadlineAt',completed+INTERVAL '48 hours','withinWindow',true));
END $$;

CREATE FUNCTION public.tb215_prepare_inspection_internal(p_request JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE ctx JSONB; x JSONB; prepared JSONB:='[]'; pid UUID; root RECORD; item public.order_items%ROWTYPE;
 src RECORD; cost NUMERIC(24,6); capacity INTEGER; consumed BIGINT; q INTEGER; good INTEGER; root_instance UUID;
BEGIN
 ctx:=public.tb215_read_sale_internal((p_request->>'orderId')::UUID);
 IF ctx->>'capability' IS DISTINCT FROM 'phase43_modern' OR ctx->'order'->>'withinWindow' IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'AFTERCARE215_ORDER_UNAVAILABLE'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_request->'items') LOOP
  pid:=NULL;cost:=NULL;capacity:=NULL;root_instance:=NULL;q:=(x->>'quantity')::INTEGER;good:=(x->>'goodQuantity')::INTEGER;
  IF x->>'sourceKind'='base_order_item' THEN
   SELECT product_id,quantity,COALESCE(unit_cost_snapshot_in_minor_units_exact,unit_cost_in_minor_units::NUMERIC)
    INTO pid,capacity,cost FROM public.order_items WHERE id=(x->>'sourceId')::UUID AND order_id=(p_request->>'orderId')::UUID
    AND commercial_line_kind IN('base_unit','legacy_single_sku_parcel');
  ELSIF x->>'sourceKind'='parcel_component' THEN
   SELECT c.product_id,c.base_quantity,COALESCE(c.exact_cogs_snapshot_in_minor_units/NULLIF(c.base_quantity,0),c.unit_cost_snapshot_in_minor_units)
    INTO pid,capacity,cost FROM public.order_parcel_components c JOIN public.order_parcel_instances i ON i.id=c.parcel_instance_id
    WHERE c.id=(x->>'sourceId')::UUID AND i.order_id=(p_request->>'orderId')::UUID;
  ELSE
   SELECT i.product_id,i.quantity,i.replacement_unit_cost_snapshot_in_minor_units_exact
    INTO pid,capacity,cost FROM public.sales_replacement_items i JOIN public.sales_replacement_events e ON e.id=i.replacement_event_id
    WHERE i.id=(x->>'sourceId')::UUID AND e.root_order_id=(p_request->>'orderId')::UUID
     AND e.replacement_status='settled' AND e.issuance_status='issued' AND e.issuance_coordinator_version=403;
  END IF;
  IF pid IS NULL OR cost IS NULL OR cost<0 THEN RAISE EXCEPTION 'AFTERCARE215_HISTORICAL_SOURCE_UNAVAILABLE'; END IF;
  SELECT * INTO STRICT root FROM public.phase4_aftercare_source_root_internal(x->>'sourceKind',(x->>'sourceId')::UUID,pid);
  SELECT COALESCE(sum(consumed_quantity),0) INTO consumed FROM public.sales_aftercare_consumptions
   WHERE source_kind=x->>'sourceKind' AND source_id=(x->>'sourceId')::UUID AND consumption_state='settled';
  IF consumed+q>capacity THEN RAISE EXCEPTION 'PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED'; END IF;
  SELECT p.wac_cost_in_minor_units_exact,b.available_quantity,p.name_ar AS name INTO src FROM public.products p
   JOIN public.inventory_balances b ON b.product_id=p.id AND b.warehouse_id=(ctx->'order'->>'warehouseId')::UUID WHERE p.id=pid;
  IF src.wac_cost_in_minor_units_exact IS NULL THEN RAISE EXCEPTION 'AFTERCARE215_CURRENT_COST_UNAVAILABLE'; END IF;
  IF x->>'supplierId' IS NOT NULL THEN
   PERFORM public.sr208_assert_role_internal('customer_return');
   IF NOT EXISTS(SELECT 1 FROM public.suppliers WHERE id=(x->>'supplierId')::UUID AND is_active)
   THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_SUPPLIER_INVALID'; END IF;
  END IF;
  IF root.root_kind='base_order_item' THEN
   SELECT * INTO STRICT item FROM public.order_items WHERE id=root.root_id;
  ELSE
   SELECT c.parcel_instance_id INTO STRICT root_instance FROM public.order_parcel_components c WHERE c.id=root.root_id;
  END IF;
  prepared:=prepared||jsonb_build_array(x||jsonb_build_object('productId',pid,'productName',src.name,
   'rootKind',root.root_kind,'rootId',root.root_id,'rootInstanceId',root_instance,'sourceUnitCostExact',cost,
   'currentUnitCostExact',src.wac_cost_in_minor_units_exact,'availableQuantity',src.available_quantity,
   'remainingQuantity',capacity-consumed));
 END LOOP;
 -- Good packets may only be admitted with a whole commercial return. The
 -- existing narrow defective-packet exception remains all-bad/same SKU.
 FOR root IN SELECT x->>'rootKind' kind,(x->>'rootId')::UUID id,sum((x->>'quantity')::INTEGER)::INTEGER quantity,
   sum((x->>'goodQuantity')::INTEGER)::INTEGER good FROM jsonb_array_elements(prepared) x GROUP BY 1,2 LOOP
  IF root.kind='base_order_item' AND root.good>0 THEN
   PERFORM public.package_d_assert_whole_single_sku_quantity_internal(root.id,root.quantity);
  END IF;
 END LOOP;
 FOR root IN SELECT DISTINCT (x->>'rootInstanceId')::UUID id FROM jsonb_array_elements(prepared) x
  WHERE x->>'rootInstanceId' IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(prepared) g
   WHERE g->>'rootInstanceId'=x->>'rootInstanceId' AND(g->>'goodQuantity')::INTEGER>0) LOOP
  IF EXISTS(SELECT 1 FROM public.order_parcel_components c WHERE c.parcel_instance_id=root.id AND c.base_quantity IS DISTINCT FROM
   (SELECT COALESCE(sum((x->>'quantity')::INTEGER),0)::INTEGER FROM jsonb_array_elements(prepared) x WHERE (x->>'rootId')::UUID=c.id))
  THEN RAISE EXCEPTION 'AFTERCARE215_WHOLE_PARCEL_INSPECTION_REQUIRED'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(prepared) x GROUP BY x->>'productId'
  HAVING sum((x->>'quantity')::INTEGER)>min((x->>'availableQuantity')::INTEGER))
 THEN RAISE EXCEPTION 'PHASE43_REPLACEMENT_INVENTORY_UNAVAILABLE'; END IF;
 RETURN jsonb_build_object('request',p_request,'order',ctx->'order','items',prepared);
END $$;

CREATE FUNCTION public.preview_inspected_sales_replacement_v2(p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE plan JSONB; result JSONB; owner_values BOOLEAN; issued BIGINT; good BIGINT; held BIGINT;
BEGIN
 PERFORM public.assert_erp_role(ARRAY['owner','admin'],'معاينة الإرجاع أو الاستبدال');
 IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='AFTERCARE215_ROLE_DENIED'; END IF;
 plan:=public.tb215_prepare_inspection_internal(public.tb215_canonical_inspection_internal(p_payload));
 owner_values:=public.has_erp_role(ARRAY['owner']);
 result:=jsonb_build_object('contractVersion',215,'previewFingerprint',encode(extensions.digest(plan::TEXT,'sha256'),'hex'),
  'orderId',plan->'request'->'orderId','issuedQuantity',(SELECT sum((x->>'quantity')::INTEGER) FROM jsonb_array_elements(plan->'items') x),
  'restockedQuantity',(SELECT sum((x->>'goodQuantity')::INTEGER) FROM jsonb_array_elements(plan->'items') x),
  'badQuantity',(SELECT sum((x->>'quantity')::INTEGER-(x->>'goodQuantity')::INTEGER) FROM jsonb_array_elements(plan->'items') x),
  'items',(SELECT jsonb_agg(jsonb_build_object('productId',x->'productId','productName',x->'productName','quantity',x->'quantity',
   'goodQuantity',x->'goodQuantity','badQuantity',(x->>'quantity')::INTEGER-(x->>'goodQuantity')::INTEGER,'supplierId',x->'supplierId')) FROM jsonb_array_elements(plan->'items') x),
  'moneyDifferenceInMinorUnits',0,'customerDebtDeltaInMinorUnits',0);
 IF owner_values THEN
  SELECT COALESCE(sum(round((x->>'currentUnitCostExact')::NUMERIC*(x->>'quantity')::INTEGER)),0)::BIGINT,
   round(COALESCE(sum((x->>'sourceUnitCostExact')::NUMERIC*(x->>'goodQuantity')::INTEGER),0))::BIGINT,
   COALESCE(sum(round((x->>'sourceUnitCostExact')::NUMERIC*((x->>'quantity')::INTEGER-(x->>'goodQuantity')::INTEGER)))
    FILTER(WHERE x->>'supplierId' IS NOT NULL),0)::BIGINT INTO issued,good,held FROM jsonb_array_elements(plan->'items') x;
  result:=result||jsonb_build_object('issuedCostInMinorUnits',issued,'goodRecoveryInMinorUnits',good,'supplierHeldInMinorUnits',held,
   'profitDeltaInMinorUnits',-issued+good+held);
 END IF;
 RETURN result;
END $$;

CREATE FUNCTION public.tb215_inspection_manifest_internal(p_operation_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('inspection',(SELECT to_jsonb(i) FROM public.aftercare215_inspections i WHERE i.operation_id=p_operation_id),
  'items',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY replacement_item_id) FROM public.aftercare215_inspection_items i WHERE i.operation_id=p_operation_id),'[]'::JSONB));
$$;

CREATE FUNCTION public.tb215_assert_inspection_internal(p_operation_id UUID)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.business_operations%ROWTYPE; i public.aftercare215_inspections%ROWTYPE; r RECORD; cost NUMERIC(24,6); total BIGINT;
BEGIN
 SELECT * INTO STRICT b FROM public.business_operations WHERE id=p_operation_id;
 SELECT * INTO STRICT i FROM public.aftercare215_inspections WHERE operation_id=p_operation_id;
 IF b.operation_type IS DISTINCT FROM 'aftercare215_inspection' OR b.request_identity_version IS DISTINCT FROM 215
  OR b.completed_at IS NULL OR b.initiated_by IS DISTINCT FROM i.created_by
  OR (b.request_identity_snapshot->'request'->>'orderId')::UUID IS DISTINCT FROM i.order_id
  OR (b.result_snapshot->>'operationId')::UUID IS DISTINCT FROM i.operation_id
  OR NOT EXISTS(SELECT 1 FROM public.business_operations original WHERE original.id=i.replacement_operation_id AND original.initiated_by=i.created_by)
  OR b.request_fingerprint IS DISTINCT FROM encode(extensions.digest(b.request_identity_snapshot::TEXT,'sha256'),'hex')
  OR b.result_snapshot->>'evidenceFingerprint' IS DISTINCT FROM encode(extensions.digest(public.tb215_inspection_manifest_internal(p_operation_id)::TEXT,'sha256'),'hex')
  OR b.result_snapshot-'evidenceFingerprint' IS DISTINCT FROM public.tb215_inspection_public_result_internal(p_operation_id)
 THEN RAISE EXCEPTION 'AFTERCARE215_EVIDENCE_INVALID'; END IF;
 PERFORM public.phase43_assert_operational_replacement_evidence_internal(i.replacement_operation_id,true);
 IF NOT EXISTS(SELECT 1 FROM public.sales_replacement_events e WHERE e.operation_id=i.replacement_operation_id AND e.root_order_id=i.order_id)
  OR (SELECT count(*) FROM public.aftercare215_inspection_items WHERE operation_id=p_operation_id) IS DISTINCT FROM
   (SELECT count(*) FROM public.sales_replacement_items WHERE operation_id=i.replacement_operation_id)
  OR EXISTS(SELECT 1 FROM public.aftercare215_inspection_items member JOIN public.sales_replacement_items replacement ON replacement.id=member.replacement_item_id
   WHERE member.operation_id=p_operation_id AND(replacement.operation_id<>i.replacement_operation_id OR replacement.product_id<>member.product_id))
 THEN RAISE EXCEPTION 'AFTERCARE215_EVIDENCE_INVALID'; END IF;
 FOR r IN SELECT x.*,f.source_kind,f.source_id,f.issued_quantity FROM public.aftercare215_inspection_items x
  JOIN public.phase43_replacement_inventory_effects f ON f.replacement_item_id=x.replacement_item_id
  WHERE x.operation_id=p_operation_id LOOP
  cost:=(public.tb215_source_before215_internal('replacement',r.replacement_item_id)->>'unitCost')::NUMERIC;
  IF r.source_unit_cost_exact IS DISTINCT FROM cost OR r.good_quantity+r.bad_quantity<>r.issued_quantity
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b.request_identity_snapshot->'request'->'items') x
    WHERE x->>'sourceKind'=r.source_kind AND(x->>'sourceId')::UUID=r.source_id
     AND(x->>'quantity')::INTEGER=r.issued_quantity AND(x->>'goodQuantity')::INTEGER=r.good_quantity
     AND ((x->>'supplierId' IS NULL)=(r.supplier_case_id IS NULL)))
   OR(r.good_quantity>0 AND NOT EXISTS(SELECT 1 FROM public.inventory_movements m WHERE m.id=r.movement_id
    AND m.operation_id IS NULL AND m.product_id=r.product_id AND m.warehouse_id=r.warehouse_id
    AND m.quantity=r.good_quantity AND m.balance_before=r.on_hand_before AND m.balance_after=r.on_hand_after
    AND m.movement_type='adjustment_add' AND m.reference_type='aftercare215_inspection' AND m.reference_id=r.replacement_item_id))
   OR r.wac_after IS DISTINCT FROM (CASE WHEN r.good_quantity=0 THEN r.wac_before ELSE round(
    (r.global_quantity_before_restock*r.wac_before+r.good_quantity*r.source_unit_cost_exact)/(r.global_quantity_before_restock+r.good_quantity),6) END)
  THEN RAISE EXCEPTION 'AFTERCARE215_EVIDENCE_INVALID'; END IF;
  IF r.supplier_case_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.supplier_replacement_cases c
   WHERE c.id=r.supplier_case_id AND c.origin='inspected_replacement' AND c.quantity=r.bad_quantity
    AND c.product_id=r.product_id AND c.warehouse_id=r.warehouse_id AND c.unit_cost_in_minor_units_exact=r.source_unit_cost_exact AND c.created_by=i.created_by
    AND c.supplier_id=(SELECT (x->>'supplierId')::UUID FROM jsonb_array_elements(b.request_identity_snapshot->'request'->'items') x
     WHERE x->>'sourceKind'=r.source_kind AND(x->>'sourceId')::UUID=r.source_id))
  THEN RAISE EXCEPTION 'AFTERCARE215_EVIDENCE_INVALID'; END IF;
 END LOOP;
 SELECT round(COALESCE(sum(good_quantity*source_unit_cost_exact),0))::BIGINT INTO total
  FROM public.aftercare215_inspection_items WHERE operation_id=p_operation_id;
 IF total IS DISTINCT FROM i.good_recovery_in_minor_units THEN RAISE EXCEPTION 'AFTERCARE215_EVIDENCE_INVALID'; END IF;
END $$;

CREATE FUNCTION public.settle_inspected_sales_replacement_v2(p_payload JSONB,p_idempotency_key TEXT,p_preview_fingerprint TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE actor UUID:=auth.uid(); request JSONB; identity JSONB; plan JSONB; preview JSONB; old_request JSONB; old_replay JSONB;
 key TEXT; actor_hash TEXT; fingerprint TEXT; existing public.business_operations%ROWTYPE; issued JSONB; result JSONB;
 op UUID:=gen_random_uuid(); tail UUID:=gen_random_uuid(); old_op UUID; row RECORD; x JSONB; source JSONB; c_id UUID;
 at TIMESTAMPTZ:=clock_timestamp(); warehouse UUID; branch UUID; before_qty INTEGER; global_qty BIGINT; before_wac NUMERIC(24,6);
 after_wac NUMERIC(24,6); movement UUID; unit_name TEXT; cases UUID[]:='{}'; recovery BIGINT; manifest JSONB;
BEGIN
 PERFORM public.assert_erp_role(ARRAY['owner','admin'],'تأكيد الإرجاع أو الاستبدال');
 IF auth.role() IS DISTINCT FROM 'authenticated' OR actor IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='AFTERCARE215_ROLE_DENIED'; END IF;
 request:=public.tb215_canonical_inspection_internal(p_payload);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(request->'items') x WHERE x->>'supplierId' IS NOT NULL)
 THEN PERFORM public.sr208_assert_role_internal('customer_return'); END IF;
 key:=public.phase4_canonicalize_idempotency_key_internal(p_idempotency_key);
 IF length(key)>200 OR COALESCE(p_preview_fingerprint,'') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'AFTERCARE215_PREVIEW_REQUIRED'; END IF;
 identity:=jsonb_build_object('request',request,'previewFingerprint',p_preview_fingerprint);
 fingerprint:=encode(extensions.digest(identity::TEXT,'sha256'),'hex');
 actor_hash:=public.phase3_actor_scope_hash_internal('erp_user',actor,NULL,NULL);
 -- Same legacy operation lock first: a direct old issuer cannot interleave.
 PERFORM pg_advisory_xact_lock(hashtextextended('phase4-operation|phase4_replacement_v1|'||actor_hash||'|'||key,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('aftercare215|'||actor::TEXT||'|'||key,0));
 SELECT * INTO existing FROM public.business_operations WHERE operation_type='aftercare215_inspection' AND initiated_by=actor AND idempotency_key=key;
 IF FOUND THEN
  IF existing.request_fingerprint IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'AFTERCARE215_IDEMPOTENCY_CONFLICT'; END IF;
  PERFORM public.tb215_assert_inspection_internal(existing.id);
  RETURN (existing.result_snapshot-'evidenceFingerprint')||jsonb_build_object('idempotentReplay',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.business_operations WHERE initiated_by=actor AND idempotency_key=key
  AND operation_type IN('phase4_replacement_v1','supplier_replacement208')) THEN RAISE EXCEPTION 'AFTERCARE215_LEGACY_KEY_CONFLICT'; END IF;
 PERFORM public.phase4_lock_customer_order_context_internal((request->>'orderId')::UUID,false,false);
 -- Discover all products before locking, then reuse the issuer's canonical
 -- inventory lock hierarchy. No supplier lock is taken ahead of inventory.
 plan:=public.tb215_prepare_inspection_internal(request);
 PERFORM public.phase2_lock_inventory_products_internal(ARRAY(SELECT DISTINCT (x->>'productId')::UUID FROM jsonb_array_elements(plan->'items') x ORDER BY 1));
 plan:=public.tb215_prepare_inspection_internal(request);
 IF p_preview_fingerprint IS DISTINCT FROM encode(extensions.digest(plan::TEXT,'sha256'),'hex') THEN RAISE EXCEPTION 'AFTERCARE215_PREVIEW_CHANGED'; END IF;
 warehouse:=(plan->'order'->>'warehouseId')::UUID;branch:=(plan->'order'->>'branchId')::UUID;
 -- Re-entrant issuer owns all capacity, sale-window and inventory evidence.
 issued:=public.settle_sales_replacement_v1((request->>'orderId')::UUID,key,
  (SELECT jsonb_agg(jsonb_build_object('sourceKind',x->'sourceKind','sourceId',x->'sourceId','quantity',x->'quantity')) FROM jsonb_array_elements(request->'items') x),
  request->>'reason',request->>'notes');
 old_op:=(issued->>'operationId')::UUID;
 FOR row IN SELECT DISTINCT (x->>'supplierId')::UUID id FROM jsonb_array_elements(request->'items') x WHERE x->>'supplierId' IS NOT NULL ORDER BY 1 LOOP
  BEGIN
   PERFORM 1 FROM public.suppliers WHERE id=row.id AND is_active FOR SHARE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='SUPPLIER_REPLACEMENT_PARENT_BUSY_RETRY'; END;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_SUPPLIER_INVALID'; END IF;
 END LOOP;
 FOR row IN SELECT f.* FROM public.phase43_replacement_inventory_effects f WHERE f.operation_id=old_op ORDER BY f.product_id,f.source_kind,f.source_id LOOP
  SELECT value INTO STRICT x FROM jsonb_array_elements(plan->'items') WHERE value->>'sourceKind'=row.source_kind AND(value->>'sourceId')::UUID=row.source_id;
  SELECT on_hand_quantity INTO STRICT before_qty FROM public.inventory_balances WHERE warehouse_id=warehouse AND product_id=row.product_id FOR UPDATE;
  SELECT wac_cost_in_minor_units_exact INTO STRICT before_wac FROM public.products WHERE id=row.product_id FOR NO KEY UPDATE;
  SELECT COALESCE(sum(on_hand_quantity),0) INTO global_qty FROM public.inventory_balances WHERE product_id=row.product_id;
  after_wac:=before_wac;movement:=NULL;c_id:=NULL;
  IF (x->>'goodQuantity')::INTEGER>0 THEN
   after_wac:=round((global_qty*before_wac+(x->>'goodQuantity')::INTEGER*(x->>'sourceUnitCostExact')::NUMERIC)/(global_qty+(x->>'goodQuantity')::INTEGER),6);
   UPDATE public.inventory_balances SET on_hand_quantity=on_hand_quantity+(x->>'goodQuantity')::INTEGER,updated_at=clock_timestamp() WHERE warehouse_id=warehouse AND product_id=row.product_id;
   UPDATE public.products SET wac_cost_in_minor_units_exact=after_wac,cost_price_in_minor_units=round(after_wac)::BIGINT,updated_at=clock_timestamp() WHERE id=row.product_id;
   INSERT INTO public.inventory_movements(warehouse_id,product_id,movement_type,quantity,balance_before,balance_after,reference_type,reference_id,notes,created_by,operation_id)
    VALUES(warehouse,row.product_id,'adjustment_add',(x->>'goodQuantity')::INTEGER,before_qty,before_qty+(x->>'goodQuantity')::INTEGER,
     'aftercare215_inspection',row.replacement_item_id,'استرداد السليم من استبدال مفحوص',actor,NULL) RETURNING id INTO movement;
  END IF;
  IF x->>'supplierId' IS NOT NULL THEN
   SELECT COALESCE(u.name_ar,'باكيت') INTO unit_name FROM public.products p LEFT JOIN public.units u ON u.id=p.unit_id WHERE p.id=row.product_id;
   INSERT INTO public.supplier_replacement_cases(operation_id,supplier_id,product_id,warehouse_id,branch_id,origin,quantity,commercial_quantity,
    units_per_commercial_unit,unit_name,base_unit_name,unit_cost_in_minor_units_exact,occurred_at,created_by)
    VALUES(tail,(x->>'supplierId')::UUID,row.product_id,warehouse,branch,'inspected_replacement',row.issued_quantity-(x->>'goodQuantity')::INTEGER,
     row.issued_quantity-(x->>'goodQuantity')::INTEGER,1,unit_name,unit_name,(x->>'sourceUnitCostExact')::NUMERIC,at,actor) RETURNING id INTO c_id;
   PERFORM public.sr208_append_event_internal(tail,c_id,'send',row.issued_quantity-(x->>'goodQuantity')::INTEGER,row.issued_quantity-(x->>'goodQuantity')::INTEGER,
    -round((row.issued_quantity-(x->>'goodQuantity')::INTEGER)*(x->>'sourceUnitCostExact')::NUMERIC)::BIGINT,0,request->>'reason',at);
   cases:=array_append(cases,c_id);
  END IF;
  INSERT INTO public.aftercare215_inspection_items(replacement_item_id,operation_id,product_id,warehouse_id,good_quantity,bad_quantity,source_unit_cost_exact,
   global_quantity_before_restock,on_hand_before,on_hand_after,wac_before,wac_after,movement_id,supplier_case_id)
   VALUES(row.replacement_item_id,op,row.product_id,warehouse,(x->>'goodQuantity')::INTEGER,row.issued_quantity-(x->>'goodQuantity')::INTEGER,
    (x->>'sourceUnitCostExact')::NUMERIC,global_qty,before_qty,before_qty+(x->>'goodQuantity')::INTEGER,before_wac,after_wac,movement,c_id);
 END LOOP;
 SELECT round(COALESCE(sum(good_quantity*source_unit_cost_exact),0))::BIGINT INTO recovery FROM public.aftercare215_inspection_items WHERE operation_id=op;
 INSERT INTO public.aftercare215_inspections VALUES(op,old_op,(request->>'orderId')::UUID,recovery,at,actor);
 IF cardinality(cases)>0 THEN
  manifest:=public.sr208_operation_manifest_internal(tail);
  INSERT INTO public.business_operations(id,operation_type,idempotency_key,request_fingerprint,request_identity_version,request_identity_snapshot,initiated_by,result_snapshot,completed_at)
   VALUES(tail,'supplier_replacement208',key,encode(extensions.digest(jsonb_build_object('action','inspected_replacement','inspectionId',op)::TEXT,'sha256'),'hex'),208,
    jsonb_build_object('action','inspected_replacement','inspectionId',op),actor,jsonb_build_object('evidenceFingerprint',encode(extensions.digest(manifest::TEXT,'sha256'),'hex'),
     'caseIds',(SELECT jsonb_agg(x->'id' ORDER BY x->>'id') FROM jsonb_array_elements(manifest->'cases') x),
     'eventIds',(SELECT jsonb_agg(x->'id' ORDER BY x->>'id') FROM jsonb_array_elements(manifest->'events') x)),at);
 END IF;
 result:=public.tb215_inspection_public_result_internal(op)||jsonb_build_object('evidenceFingerprint',encode(extensions.digest(public.tb215_inspection_manifest_internal(op)::TEXT,'sha256'),'hex'));
 INSERT INTO public.business_operations(id,operation_type,idempotency_key,request_fingerprint,request_identity_version,request_identity_snapshot,initiated_by,result_snapshot,completed_at)
  VALUES(op,'aftercare215_inspection',key,fingerprint,215,identity,actor,result,at);
 PERFORM public.tb215_assert_inspection_internal(op);
 IF cardinality(cases)>0 THEN PERFORM public.sr208_assert_operation_internal(tail); END IF;
 INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details) VALUES(actor,'INSPECTED_REPLACEMENT','business_operations',op,
  jsonb_build_object('order_id',request->'orderId','replacement_operation_id',old_op));
 RETURN (result-'evidenceFingerprint')||jsonb_build_object('idempotentReplay',false);
END $$;

-- J5 reclassification of a NEW inspected warranty concerns its bad packets
-- only. Existing 211 sources and their committed evidence stay byte-for-byte.
ALTER FUNCTION public.sr211_source_internal(TEXT,UUID) RENAME TO tb215_source_before215_internal;
CREATE FUNCTION public.sr211_source_internal(p_kind TEXT,p_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE source JSONB; inspection public.aftercare215_inspection_items%ROWTYPE;
BEGIN
 source:=public.tb215_source_before215_internal(p_kind,p_id);
 IF p_kind='replacement' THEN
  SELECT * INTO inspection FROM public.aftercare215_inspection_items WHERE replacement_item_id=p_id;
  IF FOUND THEN
   PERFORM public.tb215_assert_inspection_internal(inspection.operation_id);
   source:=source||jsonb_build_object('quantity',inspection.bad_quantity,'inspectionOperationId',inspection.operation_id);
  END IF;
 END IF;
 RETURN source;
END $$;
ALTER FUNCTION public.sr211_blocked_internal(TEXT,UUID) RENAME TO tb215_blocked_before215_internal;
CREATE FUNCTION public.sr211_blocked_internal(p_kind TEXT,p_id UUID)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE blocked TEXT; inspection public.aftercare215_inspection_items%ROWTYPE;
BEGIN
 blocked:=public.tb215_blocked_before215_internal(p_kind,p_id);
 IF blocked IS NOT NULL THEN RETURN blocked; END IF;
 IF p_kind='replacement' THEN
  SELECT * INTO inspection FROM public.aftercare215_inspection_items WHERE replacement_item_id=p_id;
  IF FOUND THEN
   IF inspection.supplier_case_id IS NOT NULL THEN RETURN 'AFTERCARE211_ALREADY_CLASSIFIED'; END IF;
   IF inspection.bad_quantity=0 THEN RETURN 'AFTERCARE215_NO_DEFECT'; END IF;
  END IF;
 END IF;
 RETURN NULL;
END $$;
ALTER FUNCTION public.get_aftercare_damage_candidates_v1(UUID) RENAME TO tb215_damage_candidates_before215_internal;
CREATE FUNCTION public.get_aftercare_damage_candidates_v1(p_order_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result JSONB;
BEGIN
 result:=public.tb215_damage_candidates_before215_internal(p_order_id);
 RETURN jsonb_set(result,'{candidates}',(SELECT COALESCE(jsonb_agg(x),'[]') FROM jsonb_array_elements(result->'candidates') x WHERE(x->>'quantity')::INTEGER>0));
END $$;

ALTER FUNCTION public.sr208_assert_operation_internal(UUID) RENAME TO tb215_supplier_evidence_before215_internal;
CREATE FUNCTION public.sr208_assert_operation_internal(p_operation_id UUID)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r RECORD;
BEGIN
 PERFORM public.tb215_supplier_evidence_before215_internal(p_operation_id);
 FOR r IN SELECT DISTINCT i.operation_id FROM public.aftercare215_inspection_items i JOIN public.supplier_replacement_cases c ON c.id=i.supplier_case_id
  WHERE c.operation_id=p_operation_id OR EXISTS(SELECT 1 FROM public.supplier_replacement_events e WHERE e.case_id=c.id AND e.operation_id=p_operation_id)
 LOOP PERFORM public.tb215_assert_inspection_internal(r.operation_id); END LOOP;
 FOR r IN SELECT DISTINCT credit.operation_id FROM public.supplier215_credits credit
  JOIN public.supplier_replacement_cases c ON c.id=credit.case_id
  WHERE credit.operation_id=p_operation_id OR c.operation_id=p_operation_id
   OR EXISTS(SELECT 1 FROM public.supplier_replacement_events e WHERE e.case_id=c.id AND e.operation_id=p_operation_id)
 LOOP PERFORM public.tb215_assert_supplier_credit_internal(r.operation_id); END LOOP;
 IF EXISTS(SELECT 1 FROM public.supplier_replacement_events e
  LEFT JOIN public.supplier_replacement_events original ON original.id=e.reverses_event_id
  WHERE e.operation_id=p_operation_id AND(e.action='credit' OR original.action='credit')
   AND NOT EXISTS(SELECT 1 FROM public.supplier215_credits credit WHERE credit.event_id=e.id))
 THEN RAISE EXCEPTION 'SUPPLIER215_CREDIT_EVIDENCE_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM public.supplier_replacement_cases c WHERE c.origin='inspected_replacement'
  AND(c.operation_id=p_operation_id OR EXISTS(SELECT 1 FROM public.supplier_replacement_events e WHERE e.case_id=c.id AND e.operation_id=p_operation_id))
  AND NOT EXISTS(SELECT 1 FROM public.aftercare215_inspection_items i WHERE i.supplier_case_id=c.id))
 THEN RAISE EXCEPTION 'AFTERCARE215_EVIDENCE_INVALID'; END IF;
END $$;

ALTER FUNCTION public.phase6_financial_facts_internal(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,BOOLEAN) RENAME TO tb215_financial_facts_before215_internal;
CREATE FUNCTION public.phase6_financial_facts_internal(p_branch_id UUID,p_period_start TIMESTAMPTZ,p_period_end TIMESTAMPTZ,p_timezone TEXT,p_verify_evidence BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE facts JSONB; recovery BIGINT; k TEXT;
BEGIN
 facts:=public.tb215_financial_facts_before215_internal(p_branch_id,p_period_start,p_period_end,p_timezone,p_verify_evidence);
 IF p_verify_evidence THEN PERFORM public.tb215_assert_inspection_internal(i.operation_id) FROM public.aftercare215_inspections i
  JOIN public.orders o ON o.id=i.order_id WHERE(p_branch_id IS NULL OR o.branch_id=p_branch_id) AND i.created_at>=p_period_start AND i.created_at<p_period_end;
  PERFORM public.tb215_assert_return_internal(c.operation_id) FROM public.aftercare215_return_contexts c
   JOIN public.orders o ON o.id=c.order_id
   WHERE(p_branch_id IS NULL OR o.branch_id=p_branch_id) AND c.created_at>=p_period_start AND c.created_at<p_period_end;
 END IF;
 SELECT COALESCE(sum(i.good_recovery_in_minor_units),0)::BIGINT INTO recovery FROM public.aftercare215_inspections i JOIN public.orders o ON o.id=i.order_id
  WHERE(p_branch_id IS NULL OR o.branch_id=p_branch_id) AND i.created_at>=p_period_start AND i.created_at<p_period_end;
 FOREACH k IN ARRAY ARRAY['restockRecoveryInMinorUnits','aftercareAdjustedMarginInMinorUnits','netProfitInMinorUnits'] LOOP
  facts:=jsonb_set(facts,ARRAY['sales',k],to_jsonb((facts->'sales'->>k)::BIGINT+recovery));
 END LOOP;
 RETURN public.tb215_exchange_financial_adjustment_internal(facts,p_branch_id,p_period_start,p_period_end,p_timezone,p_verify_evidence);
END $$;

-- Private215 allocation validator: exact132 body except independent packet
-- good/defect classification; old public admission guard is unchanged.
CREATE FUNCTION public.tb215_assert_return_allocation_internal(
  p_base_request JSONB,
  p_physical_sources JSONB
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item JSONB;
  v_component JSONB;
  v_root_kind TEXT;
  v_root_id TEXT;
  v_quantity INTEGER;
  v_sellable INTEGER;
  v_defect INTEGER;
  v_damage INTEGER;
BEGIN
  FOR v_item IN SELECT value FROM JSONB_ARRAY_ELEMENTS(p_base_request->'items')
  LOOP
    IF v_item->>'return_scope' = 'base_unit' THEN
      v_root_kind := 'base_order_item';
      v_root_id := v_item->>'order_item_id';
      v_quantity := (v_item->>'quantity')::INTEGER;
      SELECT COALESCE(SUM((source->>'sellable_restock_quantity')::INTEGER), 0)::INTEGER,
        COALESCE(SUM((source->>'defect_non_sellable_quantity')::INTEGER), 0)::INTEGER,
        COALESCE(SUM((source->>'customer_damage_quantity')::INTEGER), 0)::INTEGER
      INTO v_sellable, v_defect, v_damage
      FROM JSONB_ARRAY_ELEMENTS(p_physical_sources) source
      WHERE source->>'root_source_kind' = v_root_kind
        AND source->>'root_source_id' = v_root_id;
      IF v_sellable + v_defect + v_damage IS DISTINCT FROM v_quantity
        OR v_damage IS DISTINCT FROM COALESCE((v_item->>'customer_damage_quantity')::INTEGER,0)
        OR (v_item->>'stock_disposition' = 'restock' AND v_sellable <= 0)
        OR (v_item->>'stock_disposition' = 'damaged' AND v_sellable <> 0)
        OR (NOT EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.id=v_root_id::UUID
          AND oi.commercial_line_kind='legacy_single_sku_parcel')
          AND v_damage <> 0)
      THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = 'PHASE43_RETURN_ALLOCATION_MISMATCH: Base-unit inspection does not match its physical leaves.';
      END IF;
    ELSE
      FOR v_component IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_item->'components')
      LOOP
        v_root_kind := 'parcel_component';
        v_root_id := v_component->>'parcel_component_id';
        SELECT COALESCE(SUM((source->>'sellable_restock_quantity')::INTEGER), 0)::INTEGER,
          COALESCE(SUM((source->>'defect_non_sellable_quantity')::INTEGER), 0)::INTEGER,
          COALESCE(SUM((source->>'customer_damage_quantity')::INTEGER), 0)::INTEGER
        INTO v_sellable, v_defect, v_damage
        FROM JSONB_ARRAY_ELEMENTS(p_physical_sources) source
        WHERE source->>'root_source_kind' = v_root_kind
          AND source->>'root_source_id' = v_root_id;
        IF v_sellable + v_defect
            IS DISTINCT FROM (v_component->>'accepted_quantity')::INTEGER
          OR v_damage IS DISTINCT FROM (v_component->>'rejected_quantity')::INTEGER
          OR (v_sellable > 0 AND (
            v_component->>'accepted_condition' IS DISTINCT FROM 'sellable'
            OR v_component->>'accepted_stock_disposition' IS DISTINCT FROM 'restock'))
          OR (v_sellable = 0 AND v_defect > 0 AND (
            v_component->>'accepted_condition' IS DISTINCT FROM 'supplier_defect'
            OR v_component->>'accepted_stock_disposition' IS DISTINCT FROM 'non_sellable'))
          OR (v_sellable + v_defect = 0 AND (
            v_component->>'accepted_condition' IS NOT NULL
            OR v_component->>'accepted_stock_disposition' IS NOT NULL))
          OR (v_damage > 0 AND (
            v_component->>'rejection_reason' IS DISTINCT FROM 'customer_damage'
            OR v_component->>'rejected_stock_disposition' IS DISTINCT FROM 'returned_to_customer'))
          OR (v_damage = 0 AND (
            v_component->>'rejection_reason' IS NOT NULL
            OR v_component->>'rejected_stock_disposition' IS NOT NULL))
        THEN
          RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'PHASE43_RETURN_ALLOCATION_MISMATCH: Parcel inspection does not equal its three-bucket physical allocation.';
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM JSONB_ARRAY_ELEMENTS(p_physical_sources) source
    WHERE NOT EXISTS (
      SELECT 1 FROM JSONB_ARRAY_ELEMENTS(p_base_request->'items') item
      WHERE (item->>'return_scope' = 'base_unit'
          AND source->>'root_source_kind' = 'base_order_item'
          AND source->>'root_source_id' = item->>'order_item_id')
        OR (item->>'return_scope' = 'parcel_instance'
          AND source->>'root_source_kind' = 'parcel_component'
          AND EXISTS (SELECT 1 FROM JSONB_ARRAY_ELEMENTS(item->'components') component
            WHERE component->>'parcel_component_id' = source->>'root_source_id'))
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE43_RETURN_ALLOCATION_MISMATCH: Physical allocation contains a root outside the Return request.';
  END IF;
END;
$$;


-- Authoritative ordinary-return preview. Every amount comes from the saved
-- sale or the selected physical leaf; no writer/savepoint is used to preview.
CREATE FUNCTION public.tb215_return_source_cost_internal(p_order_id UUID,p_source JSONB)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_variable
DECLARE cost NUMERIC(24,6); capacity INTEGER; consumed BIGINT; pid UUID:=(p_source->>'product_id')::UUID;
 kind TEXT:=p_source->>'source_kind'; source_id UUID:=(p_source->>'source_id')::UUID;
BEGIN
 PERFORM public.phase43_assert_return_physical_source_internal(p_order_id,p_source->>'root_source_kind',(p_source->>'root_source_id')::UUID,kind,source_id,pid);
 IF kind='base_order_item' THEN
  SELECT COALESCE(unit_cost_snapshot_in_minor_units_exact,unit_cost_in_minor_units::NUMERIC),quantity INTO cost,capacity
   FROM public.order_items WHERE id=source_id AND product_id=pid;
 ELSIF kind='parcel_component' THEN
  SELECT COALESCE(round(exact_cogs_snapshot_in_minor_units/NULLIF(base_quantity,0),6),unit_cost_snapshot_in_minor_units),base_quantity INTO cost,capacity
   FROM public.order_parcel_components WHERE id=source_id AND product_id=pid;
 ELSE
  SELECT replacement_unit_cost_snapshot_in_minor_units_exact,quantity INTO cost,capacity FROM public.sales_replacement_items WHERE id=source_id AND product_id=pid;
 END IF;
 IF cost IS NULL OR cost<0 OR capacity IS NULL THEN RAISE EXCEPTION 'AFTERCARE215_HISTORICAL_SOURCE_UNAVAILABLE'; END IF;
 SELECT COALESCE(sum(c.consumed_quantity),0) INTO consumed FROM public.sales_aftercare_consumptions c
  WHERE c.source_kind=kind AND c.source_id=source_id AND c.consumption_state='settled';
 IF consumed+(p_source->>'quantity')::INTEGER>capacity THEN RAISE EXCEPTION 'PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED'; END IF;
 RETURN cost;
END $$;

CREATE FUNCTION public.tb215_canonical_return_internal(p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE base JSONB; physical JSONB; assignments JSONB:='[]'; entry JSONB; choice TEXT:=COALESCE(nullif(lower(btrim(p_payload->>'refundMethod')),''),'auto'); ref TEXT:=nullif(btrim(p_payload->>'referenceNumber'),'');
BEGIN
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN('orderId','items','physicalSources','reason','notes','refundMethod','referenceNumber','supplierAssignments'))
  OR choice NOT IN('auto','cash','cliq','debt') OR length(COALESCE(ref,''))>120
 THEN RAISE EXCEPTION 'AFTERCARE215_RETURN_REQUEST_INVALID'; END IF;
 base:=public.phase42_canonicalize_return_request_before_phase43_internal((p_payload->>'orderId')::UUID,p_payload->'items',p_payload->>'reason',NULL,NULL,p_payload->>'notes');
 physical:=public.phase43_canonicalize_return_physical_sources_internal(p_payload->'physicalSources');
 PERFORM public.tb215_assert_return_allocation_internal(base,physical);
 IF p_payload?'supplierAssignments' THEN
  IF jsonb_typeof(p_payload->'supplierAssignments') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'supplierAssignments')>100 THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_RETURN_ASSIGNMENTS_INVALID'; END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(p_payload->'supplierAssignments') LOOP
   IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR(SELECT count(*) FROM jsonb_object_keys(entry))<>3
    OR COALESCE(entry->>'sourceKind','') NOT IN('base_order_item','parcel_component','replacement_item')
    OR(entry->>'sourceId')::UUID IS NULL OR(entry->>'supplierId')::UUID IS NULL
   THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_RETURN_ASSIGNMENTS_INVALID'; END IF;
   assignments:=assignments||jsonb_build_array(jsonb_build_object('sourceKind',entry->>'sourceKind','sourceId',(entry->>'sourceId')::UUID,'supplierId',(entry->>'supplierId')::UUID));
  END LOOP;
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(assignments) a GROUP BY a->>'sourceKind',a->>'sourceId' HAVING count(*)>1) THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_RETURN_ASSIGNMENTS_INVALID'; END IF;
 RETURN jsonb_build_object('baseRequest',base,'physicalSources',physical,'refundChoice',choice,'referenceNumber',ref,
  'supplierAssignments',(SELECT COALESCE(jsonb_agg(a ORDER BY a->>'sourceKind',a->>'sourceId'),'[]') FROM jsonb_array_elements(assignments) a));
END $$;

CREATE FUNCTION public.tb215_prepare_return_internal(p_request JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_variable
DECLARE ctx JSONB; item JSONB; component JSONB; source JSONB; assignment JSONB; oi public.order_items%ROWTYPE; instance public.order_parcel_instances%ROWTYPE;
 pc public.order_parcel_components%ROWTYPE; position RECORD; q INTEGER; prior INTEGER; prior_refund BIGINT; target BIGINT; raw_damage BIGINT; refund BIGINT;
 entitlement BIGINT:=0; customer_damage BIGINT:=0; good_value NUMERIC(30,6):=0; bad_value BIGINT:=0; held_value BIGINT:=0; cost NUMERIC(24,6);
 good_q INTEGER:=0; bad_q INTEGER:=0; damage_q INTEGER:=0; debt BIGINT; money BIGINT; method TEXT; original_method TEXT; shift_id UUID;
 issues JSONB:='[]'; sources JSONB:='[]'; order_id UUID:=(p_request->'baseRequest'->>'order_id')::UUID;
BEGIN
 ctx:=public.tb215_read_sale_internal(order_id);
 IF NOT EXISTS(SELECT 1 FROM public.branches WHERE id=(ctx->'order'->>'branchId')::UUID AND is_active)
  OR NOT EXISTS(SELECT 1 FROM public.warehouses WHERE id=(ctx->'order'->>'warehouseId')::UUID AND is_active)
 THEN RAISE EXCEPTION 'AFTERCARE215_ORDER_UNAVAILABLE'; END IF;
 IF jsonb_array_length(p_request->'supplierAssignments')>0 THEN PERFORM public.sr208_assert_role_internal('customer_return'); END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_request->'baseRequest'->'items') LOOP
  SELECT * INTO oi FROM public.order_items WHERE id=(item->>'order_item_id')::UUID AND order_items.order_id=order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PHASE42_ORDER_ITEM_INVALID'; END IF;
  IF item->>'return_scope'='base_unit' THEN
   q:=(item->>'quantity')::INTEGER;
   IF oi.commercial_line_kind NOT IN('base_unit','legacy_single_sku_parcel') OR oi.net_refundable_amount_snapshot_in_minor_units IS NULL OR oi.quantity<=0 THEN RAISE EXCEPTION 'PHASE42_BASE_SALE_EVIDENCE_MISSING'; END IF;
   PERFORM public.package_d_assert_whole_single_sku_quantity_internal(oi.id,q);
   SELECT COALESCE(sum(i.returned_quantity),0)::INTEGER,COALESCE(sum(i.refund_amount_snapshot_in_minor_units+i.applied_customer_damage_deduction_in_minor_units),0)::BIGINT
    INTO prior,prior_refund FROM public.sales_return_items i JOIN public.sales_return_events e ON e.id=i.sales_return_event_id
    WHERE i.order_item_id=oi.id AND i.return_scope='base_unit' AND e.settlement_status='settled';
   IF prior+q>oi.quantity THEN RAISE EXCEPTION 'PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED'; END IF;
   target:=CASE WHEN prior+q=oi.quantity THEN oi.net_refundable_amount_snapshot_in_minor_units ELSE floor(oi.net_refundable_amount_snapshot_in_minor_units::NUMERIC*(prior+q)/oi.quantity)::BIGINT END;
   refund:=target-prior_refund;
   IF COALESCE((item->>'customer_damage_quantity')::INTEGER,0)>0 AND(oi.commercial_line_kind<>'legacy_single_sku_parcel' OR q<>oi.units_per_sale_package OR oi.effective_standalone_unit_sale_price_snapshot_in_minor_units IS NULL)
   THEN RAISE EXCEPTION 'PACKAGE_D_CARTON_DAMAGE_PRICE_MISSING'; END IF;
   raw_damage:=COALESCE((item->>'customer_damage_quantity')::INTEGER,0)::BIGINT*COALESCE(oi.effective_standalone_unit_sale_price_snapshot_in_minor_units,0);
  ELSE
   SELECT * INTO instance FROM public.order_parcel_instances WHERE id=(item->>'parcel_instance_id')::UUID AND order_item_id=oi.id AND order_parcel_instances.order_id=order_id;
   IF NOT FOUND OR oi.commercial_line_kind IS DISTINCT FROM 'configurable_parcel' OR instance.finalized_at IS NULL OR instance.net_refundable_amount_snapshot_in_minor_units IS NULL
    OR(SELECT count(*) FROM public.order_parcel_components WHERE parcel_instance_id=instance.id)<>jsonb_array_length(item->'components')
   THEN RAISE EXCEPTION 'PHASE42_PARCEL_SALE_EVIDENCE_MISSING'; END IF;
   IF EXISTS(SELECT 1 FROM public.sales_return_items i JOIN public.sales_return_events e ON e.id=i.sales_return_event_id
    WHERE i.parcel_instance_id=instance.id AND e.settlement_status='settled') THEN RAISE EXCEPTION 'PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED'; END IF;
   raw_damage:=0;
   FOR component IN SELECT value FROM jsonb_array_elements(item->'components') LOOP
    SELECT * INTO pc FROM public.order_parcel_components WHERE id=(component->>'parcel_component_id')::UUID AND parcel_instance_id=instance.id;
    IF NOT FOUND OR pc.base_quantity<>(component->>'accepted_quantity')::INTEGER+(component->>'rejected_quantity')::INTEGER
     OR((component->>'rejected_quantity')::INTEGER>0 AND pc.effective_standalone_unit_sale_price_snapshot_in_minor_units IS NULL)
    THEN RAISE EXCEPTION 'PHASE42_PARCEL_COMPONENT_EVIDENCE_INVALID'; END IF;
    raw_damage:=raw_damage+(component->>'rejected_quantity')::BIGINT*COALESCE(pc.effective_standalone_unit_sale_price_snapshot_in_minor_units,0);
   END LOOP;
   refund:=instance.net_refundable_amount_snapshot_in_minor_units;
  END IF;
  IF refund<0 THEN RAISE EXCEPTION 'PHASE42_CUMULATIVE_ALLOCATION_INVALID'; END IF;
  customer_damage:=customer_damage+LEAST(refund,raw_damage);entitlement:=entitlement+refund-LEAST(refund,raw_damage);
 END LOOP;
 FOR source IN SELECT value FROM jsonb_array_elements(p_request->'physicalSources') LOOP
  cost:=public.tb215_return_source_cost_internal(order_id,source);
  good_q:=good_q+(source->>'sellable_restock_quantity')::INTEGER;bad_q:=bad_q+(source->>'defect_non_sellable_quantity')::INTEGER;damage_q:=damage_q+(source->>'customer_damage_quantity')::INTEGER;
  good_value:=good_value+cost*(source->>'sellable_restock_quantity')::INTEGER;
  bad_value:=bad_value+round(cost*(source->>'defect_non_sellable_quantity')::INTEGER)::BIGINT;
  sources:=sources||jsonb_build_array(source||jsonb_build_object('historicalUnitCostExact',cost::TEXT));
 END LOOP;
 FOR assignment IN SELECT value FROM jsonb_array_elements(p_request->'supplierAssignments') LOOP
  SELECT value INTO source FROM jsonb_array_elements(sources) WHERE value->>'source_kind'=assignment->>'sourceKind' AND value->>'source_id'=assignment->>'sourceId';
  IF source IS NULL OR(source->>'defect_non_sellable_quantity')::INTEGER<=0 THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_RETURN_ASSIGNMENTS_MISMATCH'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.suppliers WHERE id=(assignment->>'supplierId')::UUID AND is_active) THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_SUPPLIER_INVALID'; END IF;
  held_value:=held_value+round((source->>'historicalUnitCostExact')::NUMERIC*(source->>'defect_non_sellable_quantity')::INTEGER)::BIGINT;
 END LOOP;
 SELECT * INTO position FROM public.phase42_order_financial_position_internal(order_id);
 IF NOT FOUND THEN RAISE EXCEPTION 'PHASE42_FINANCIAL_POSITION_UNAVAILABLE'; END IF;
 debt:=LEAST(entitlement,position.merchandise_debt_in_minor_units);money:=entitlement-debt;
 IF money>position.refundable_collected_in_minor_units THEN RAISE EXCEPTION 'PHASE42_FINANCIAL_EVIDENCE_CONTRADICTORY'; END IF;
 SELECT payment_method INTO original_method FROM public.orders WHERE id=order_id;
 method:=CASE WHEN p_request->>'refundChoice'='auto' THEN CASE WHEN original_method='cash_on_delivery' THEN 'cash' WHEN original_method IN('cash','cliq') THEN original_method ELSE NULL END
  WHEN p_request->>'refundChoice'='debt' THEN NULL ELSE p_request->>'refundChoice' END;
 SELECT id INTO shift_id FROM public.cash_shifts WHERE branch_id=(ctx->'order'->>'branchId')::UUID AND status='open';
 IF money=0 THEN method:=NULL;
 ELSE
  IF method IS NULL THEN issues:=issues||jsonb_build_array(jsonb_build_object('field','refundMethod','code','AFTERCARE215_REFUND_METHOD_REQUIRED')); END IF;
  IF shift_id IS NULL THEN issues:=issues||jsonb_build_array(jsonb_build_object('field','cashShift','code','PHASE2_OPEN_SHIFT_REQUIRED')); END IF;
  IF method='cliq' AND p_request->>'referenceNumber' IS NULL THEN issues:=issues||jsonb_build_array(jsonb_build_object('field','referenceNumber','code','AFTERCARE215_REFUND_REFERENCE_REQUIRED')); END IF;
 END IF;
 RETURN jsonb_build_object('request',p_request,'order',ctx->'order','originalPaymentMethod',original_method,'financialPosition',to_jsonb(position),
  'cashShiftId',CASE WHEN money>0 THEN shift_id END,'refundMethod',method,'referenceNumber',CASE WHEN money>0 AND method='cliq' THEN p_request->'referenceNumber' END,
  'entitlementInMinorUnits',entitlement::TEXT,'debtReductionInMinorUnits',debt::TEXT,'moneyRefundInMinorUnits',money::TEXT,
  'customerDamageDeductionInMinorUnits',customer_damage::TEXT,'goodQuantity',good_q,'badQuantity',bad_q,'customerDamageQuantity',damage_q,
  'goodRestockValueExact',good_value::TEXT,'badLossInMinorUnits',bad_value::TEXT,'supplierHeldInMinorUnits',held_value::TEXT,
  'physicalSources',sources,'issues',issues);
END $$;

CREATE FUNCTION public.preview_admin_sales_return_v2(p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE plan JSONB; result JSONB;
BEGIN
 PERFORM public.assert_erp_role(ARRAY['owner','admin'],'معاينة إرجاع البضاعة');
 IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='AFTERCARE215_ROLE_DENIED'; END IF;
 plan:=public.tb215_prepare_return_internal(public.tb215_canonical_return_internal(p_payload));
 result:=jsonb_build_object('contractVersion',215,'previewFingerprint',encode(extensions.digest(plan::TEXT,'sha256'),'hex'),
  'orderId',plan->'request'->'baseRequest'->'order_id','entitlementInMinorUnits',plan->'entitlementInMinorUnits','debtReductionInMinorUnits',plan->'debtReductionInMinorUnits',
  'moneyRefundInMinorUnits',plan->'moneyRefundInMinorUnits','refundMethod',plan->'refundMethod','referenceNumber',plan->'referenceNumber',
  'customerDamageDeductionInMinorUnits',plan->'customerDamageDeductionInMinorUnits','goodQuantity',plan->'goodQuantity','badQuantity',plan->'badQuantity',
  'customerDamageQuantity',plan->'customerDamageQuantity','issues',plan->'issues','canConfirm',jsonb_array_length(plan->'issues')=0);
 IF public.has_erp_role(ARRAY['owner']) THEN result:=result||jsonb_build_object('goodRestockValueExact',plan->'goodRestockValueExact',
  'badLossInMinorUnits',plan->'badLossInMinorUnits','supplierHeldInMinorUnits',plan->'supplierHeldInMinorUnits',
  'profitDeltaExactInMinorUnits',(-(plan->>'entitlementInMinorUnits')::NUMERIC+(plan->>'goodRestockValueExact')::NUMERIC+(plan->>'supplierHeldInMinorUnits')::NUMERIC)::TEXT); END IF;
 RETURN result;
END $$;

CREATE TABLE public.aftercare215_return_contexts (
 operation_id UUID PRIMARY KEY REFERENCES public.business_operations(id) DEFERRABLE INITIALLY DEFERRED,
 order_id UUID NOT NULL REFERENCES public.orders(id),
 created_by UUID NOT NULL REFERENCES public.profiles(id),
 transaction_id XID8 NOT NULL,
 idempotency_key TEXT NOT NULL,
 request_snapshot JSONB NOT NULL,
 executed_base_request JSONB NOT NULL,
 physical_sources JSONB NOT NULL,
 prepared_plan JSONB NOT NULL,
 preview_fingerprint TEXT NOT NULL CHECK(preview_fingerprint~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL,
 UNIQUE(created_by,idempotency_key)
);
CREATE TABLE public.aftercare215_return_results (
 operation_id UUID PRIMARY KEY REFERENCES public.aftercare215_return_contexts(operation_id),
 return_operation_id UUID NOT NULL UNIQUE REFERENCES public.business_operations(id),
 supplier_operation_id UUID UNIQUE REFERENCES public.business_operations(id)
);
CREATE UNIQUE INDEX aftercare215_return_actor_key ON public.business_operations(initiated_by,idempotency_key)
 WHERE operation_type='aftercare215_return';
CREATE INDEX aftercare215_return_transaction ON public.aftercare215_return_contexts(transaction_id,created_by);
CREATE INDEX aftercare215_return_period ON public.aftercare215_return_contexts(created_at,order_id);

-- Only the server-created, still-in-progress v2 context may admit mixed
-- good/bad independent packets. No caller-set GUC is an authorization token.
-- Old public calls, including later calls in the same transaction, retain the
-- exact old guard once the outer completed envelope exists.
ALTER FUNCTION public.phase43_assert_return_allocation_contract_internal(JSONB,JSONB) RENAME TO tb215_return_allocation_before215_internal;
CREATE FUNCTION public.phase43_assert_return_allocation_contract_internal(p_base_request JSONB,p_physical_sources JSONB)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.aftercare215_return_contexts c
  WHERE c.transaction_id=pg_current_xact_id_if_assigned() AND c.created_by=auth.uid()
   AND c.executed_base_request=p_base_request AND c.physical_sources=p_physical_sources
   AND NOT EXISTS(SELECT 1 FROM public.business_operations b WHERE b.id=c.operation_id)) THEN
  PERFORM public.tb215_assert_return_allocation_internal(p_base_request,p_physical_sources);
 ELSE
  PERFORM public.tb215_return_allocation_before215_internal(p_base_request,p_physical_sources);
 END IF;
END $$;

CREATE FUNCTION public.tb215_hold_return_subset_internal(p_return_operation_id UUID,p_assignments JSONB,p_key TEXT,p_reason TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor UUID; operation UUID:=gen_random_uuid(); e public.sales_return_events%ROWTYPE; d public.inventory_damage_events%ROWTYPE;
 a JSONB; supplier UUID; case_id UUID; unit_name TEXT; manifest JSONB; result JSONB; request JSONB;
BEGIN
 IF jsonb_array_length(p_assignments)=0 THEN RETURN NULL; END IF;
 actor:=public.sr208_assert_role_internal('customer_return');
 SELECT * INTO STRICT e FROM public.sales_return_events WHERE operation_id=p_return_operation_id AND settlement_status='settled';
 PERFORM public.phase42_assert_operational_return_evidence_internal(p_return_operation_id,true);
 FOR supplier IN SELECT DISTINCT(x->>'supplierId')::UUID FROM jsonb_array_elements(p_assignments) x ORDER BY 1 LOOP
  BEGIN
   PERFORM 1 FROM public.suppliers WHERE id=supplier AND is_active FOR SHARE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='SUPPLIER_REPLACEMENT_PARENT_BUSY_RETRY'; END;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_SUPPLIER_INVALID'; END IF;
 END LOOP;
 FOR a IN SELECT value FROM jsonb_array_elements(p_assignments) ORDER BY value->>'sourceKind',value->>'sourceId' LOOP
  SELECT * INTO d FROM public.inventory_damage_events WHERE return_event_id=e.id AND origin='customer_return'
   AND source_kind=a->>'sourceKind' AND source_id=(a->>'sourceId')::UUID;
  IF NOT FOUND OR d.quantity<=0 OR d.unit_cost_in_minor_units_exact IS NULL THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_RETURN_ASSIGNMENTS_MISMATCH'; END IF;
  SELECT COALESCE(u.name_ar,'باكيت') INTO unit_name FROM public.products p LEFT JOIN public.units u ON u.id=p.unit_id WHERE p.id=d.product_id;
  INSERT INTO public.supplier_replacement_cases(operation_id,supplier_id,product_id,warehouse_id,branch_id,origin,damage_event_id,
   quantity,commercial_quantity,units_per_commercial_unit,unit_name,base_unit_name,unit_cost_in_minor_units_exact,occurred_at,created_by)
   VALUES(operation,(a->>'supplierId')::UUID,d.product_id,d.warehouse_id,d.branch_id,'customer_return',d.id,d.quantity,d.quantity,1,
    unit_name,unit_name,d.unit_cost_in_minor_units_exact,d.occurred_at,actor) RETURNING id INTO case_id;
  PERFORM public.sr208_append_event_internal(operation,case_id,'send',d.quantity,d.quantity,-d.loss_in_minor_units,0,p_reason,d.occurred_at);
 END LOOP;
 request:=jsonb_build_object('action','customer_return_subset215','returnOperationId',p_return_operation_id,'supplierAssignments',p_assignments);
 manifest:=public.sr208_operation_manifest_internal(operation);
 result:=jsonb_build_object('evidenceFingerprint',encode(extensions.digest(manifest::TEXT,'sha256'),'hex'),
  'caseIds',(SELECT jsonb_agg(x->'id' ORDER BY x->>'id') FROM jsonb_array_elements(manifest->'cases') x),
  'eventIds',(SELECT jsonb_agg(x->'id' ORDER BY x->>'id') FROM jsonb_array_elements(manifest->'events') x),
  'returnOperationId',p_return_operation_id,'returnResult',(SELECT result_snapshot FROM public.business_operations WHERE id=p_return_operation_id));
 INSERT INTO public.business_operations(id,operation_type,idempotency_key,request_fingerprint,request_identity_version,request_identity_snapshot,initiated_by,result_snapshot,completed_at)
  VALUES(operation,'supplier_replacement208',p_key,encode(extensions.digest(request::TEXT,'sha256'),'hex'),208,request,actor,result,clock_timestamp());
 PERFORM public.sr208_assert_operation_internal(operation);
 RETURN operation;
END $$;

CREATE FUNCTION public.tb215_return_manifest_internal(p_operation_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('context',(SELECT(to_jsonb(c)-'created_at')||jsonb_build_object('createdAtEpoch',extract(epoch FROM c.created_at)::TEXT)
  FROM public.aftercare215_return_contexts c WHERE c.operation_id=p_operation_id),
  'result',(SELECT to_jsonb(r) FROM public.aftercare215_return_results r WHERE r.operation_id=p_operation_id));
$$;

CREATE FUNCTION public.tb215_assert_return_internal(p_operation_id UUID)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.business_operations%ROWTYPE; c public.aftercare215_return_contexts%ROWTYPE; r public.aftercare215_return_results%ROWTYPE;
 inner_op public.business_operations%ROWTYPE; return_event UUID; a JSONB;
BEGIN
 SELECT * INTO STRICT b FROM public.business_operations WHERE id=p_operation_id;
 SELECT * INTO STRICT c FROM public.aftercare215_return_contexts WHERE operation_id=p_operation_id;
 SELECT * INTO STRICT r FROM public.aftercare215_return_results WHERE operation_id=p_operation_id;
 SELECT * INTO STRICT inner_op FROM public.business_operations WHERE id=r.return_operation_id;
 IF b.operation_type IS DISTINCT FROM 'aftercare215_return' OR b.request_identity_version IS DISTINCT FROM 215 OR b.completed_at IS NULL
  OR b.initiated_by IS DISTINCT FROM c.created_by OR inner_op.initiated_by IS DISTINCT FROM c.created_by
  OR b.request_fingerprint IS DISTINCT FROM encode(extensions.digest(b.request_identity_snapshot::TEXT,'sha256'),'hex')
  OR b.request_identity_snapshot IS DISTINCT FROM jsonb_build_object('request',c.request_snapshot,'previewFingerprint',c.preview_fingerprint)
  OR c.prepared_plan->'request' IS DISTINCT FROM c.request_snapshot
  OR c.preview_fingerprint IS DISTINCT FROM encode(extensions.digest(c.prepared_plan::TEXT,'sha256'),'hex')
  OR c.order_id IS DISTINCT FROM(c.request_snapshot->'baseRequest'->>'order_id')::UUID
  OR c.executed_base_request IS DISTINCT FROM(c.request_snapshot->'baseRequest')||jsonb_build_object('refund_method',c.prepared_plan->'refundMethod','reference_number',c.prepared_plan->'referenceNumber')
  OR inner_op.request_identity_snapshot IS DISTINCT FROM c.executed_base_request||jsonb_build_object('physical_sources',c.physical_sources)
  OR inner_op.idempotency_key IS DISTINCT FROM c.idempotency_key
  OR inner_op.operation_type IS DISTINCT FROM 'phase4_return_v1'
  OR c.physical_sources IS DISTINCT FROM c.request_snapshot->'physicalSources'
  OR (inner_op.result_snapshot->>'merchandiseEntitlementInMinorUnits')::BIGINT IS DISTINCT FROM(c.prepared_plan->>'entitlementInMinorUnits')::BIGINT
  OR (inner_op.result_snapshot->>'debtReductionInMinorUnits')::BIGINT IS DISTINCT FROM(c.prepared_plan->>'debtReductionInMinorUnits')::BIGINT
  OR (inner_op.result_snapshot->>'moneyRefundInMinorUnits')::BIGINT IS DISTINCT FROM(c.prepared_plan->>'moneyRefundInMinorUnits')::BIGINT
  OR b.result_snapshot->>'evidenceFingerprint' IS DISTINCT FROM encode(extensions.digest(public.tb215_return_manifest_internal(p_operation_id)::TEXT,'sha256'),'hex')
  OR b.result_snapshot-'evidenceFingerprint' IS DISTINCT FROM public.tb215_return_public_result_internal(p_operation_id)
 THEN RAISE EXCEPTION 'AFTERCARE215_RETURN_EVIDENCE_INVALID'; END IF;
 PERFORM public.phase42_assert_operational_return_evidence_internal(r.return_operation_id,true);
 SELECT id INTO STRICT return_event FROM public.sales_return_events WHERE operation_id=r.return_operation_id;
 IF (SELECT COALESCE(sum(historical_restock_value_in_minor_units_exact),0) FROM public.phase42_return_inventory_effects WHERE operation_id=r.return_operation_id)
   IS DISTINCT FROM(c.prepared_plan->>'goodRestockValueExact')::NUMERIC
  OR(SELECT COALESCE(sum(loss_in_minor_units),0) FROM public.inventory_damage_events WHERE return_event_id=return_event AND origin='customer_return')
   IS DISTINCT FROM(c.prepared_plan->>'badLossInMinorUnits')::NUMERIC
 THEN RAISE EXCEPTION 'AFTERCARE215_RETURN_EVIDENCE_INVALID'; END IF;
 IF (r.supplier_operation_id IS NULL) IS DISTINCT FROM(jsonb_array_length(c.request_snapshot->'supplierAssignments')=0) THEN RAISE EXCEPTION 'AFTERCARE215_RETURN_EVIDENCE_INVALID'; END IF;
 IF r.supplier_operation_id IS NOT NULL THEN
  PERFORM public.sr208_assert_operation_internal(r.supplier_operation_id);
  IF NOT EXISTS(SELECT 1 FROM public.business_operations tail WHERE tail.id=r.supplier_operation_id AND tail.initiated_by=c.created_by
   AND tail.request_identity_snapshot=jsonb_build_object('action','customer_return_subset215','returnOperationId',r.return_operation_id,'supplierAssignments',c.request_snapshot->'supplierAssignments'))
   OR(SELECT count(*) FROM public.supplier_replacement_cases WHERE operation_id=r.supplier_operation_id)<>jsonb_array_length(c.request_snapshot->'supplierAssignments')
  THEN RAISE EXCEPTION 'AFTERCARE215_RETURN_EVIDENCE_INVALID'; END IF;
  IF (SELECT COALESCE(-sum(expense_delta_in_minor_units),0) FROM public.supplier_replacement_events WHERE operation_id=r.supplier_operation_id)
   IS DISTINCT FROM(c.prepared_plan->>'supplierHeldInMinorUnits')::NUMERIC THEN RAISE EXCEPTION 'AFTERCARE215_RETURN_EVIDENCE_INVALID'; END IF;
  FOR a IN SELECT value FROM jsonb_array_elements(c.request_snapshot->'supplierAssignments') LOOP
   IF NOT EXISTS(SELECT 1 FROM public.supplier_replacement_cases claim JOIN public.inventory_damage_events d ON d.id=claim.damage_event_id
    WHERE claim.operation_id=r.supplier_operation_id AND claim.supplier_id=(a->>'supplierId')::UUID
     AND d.return_event_id=return_event AND d.source_kind=a->>'sourceKind' AND d.source_id=(a->>'sourceId')::UUID
     AND claim.quantity=d.quantity AND claim.unit_cost_in_minor_units_exact=d.unit_cost_in_minor_units_exact)
   THEN RAISE EXCEPTION 'AFTERCARE215_RETURN_EVIDENCE_INVALID'; END IF;
  END LOOP;
 END IF;
END $$;

CREATE FUNCTION public.settle_admin_sales_return_v2(p_payload JSONB,p_idempotency_key TEXT,p_preview_fingerprint TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_variable
DECLARE actor UUID:=auth.uid(); request JSONB; plan JSONB; identity JSONB; fingerprint TEXT; actor_hash TEXT; key TEXT;
 existing public.business_operations%ROWTYPE; operation UUID:=gen_random_uuid(); inner_result JSONB; executed_base JSONB;
 inner_operation UUID; supplier_operation UUID; result JSONB; at TIMESTAMPTZ:=clock_timestamp();
BEGIN
 PERFORM public.assert_erp_role(ARRAY['owner','admin'],'تأكيد إرجاع البضاعة');
 IF auth.role() IS DISTINCT FROM 'authenticated' OR actor IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='AFTERCARE215_ROLE_DENIED'; END IF;
 request:=public.tb215_canonical_return_internal(p_payload);
 IF jsonb_array_length(request->'supplierAssignments')>0 THEN PERFORM public.sr208_assert_role_internal('customer_return'); END IF;
 key:=public.phase4_canonicalize_idempotency_key_internal(p_idempotency_key);
 IF length(key)>200 OR COALESCE(p_preview_fingerprint,'') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'AFTERCARE215_PREVIEW_REQUIRED'; END IF;
 identity:=jsonb_build_object('request',request,'previewFingerprint',p_preview_fingerprint);fingerprint:=encode(extensions.digest(identity::TEXT,'sha256'),'hex');
 actor_hash:=public.phase3_actor_scope_hash_internal('erp_user',actor,NULL,NULL);
 PERFORM pg_advisory_xact_lock(hashtextextended('phase4-operation|phase4_return_v1|'||actor_hash||'|'||key,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('aftercare215|'||actor::TEXT||'|'||key,0));
 SELECT * INTO existing FROM public.business_operations WHERE operation_type='aftercare215_return' AND initiated_by=actor AND idempotency_key=key;
 IF FOUND THEN
  IF existing.request_fingerprint IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'AFTERCARE215_IDEMPOTENCY_CONFLICT'; END IF;
  PERFORM public.tb215_assert_return_internal(existing.id);
  RETURN(existing.result_snapshot-'evidenceFingerprint')||jsonb_build_object('idempotentReplay',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.business_operations WHERE initiated_by=actor AND idempotency_key=key AND operation_type IN('phase4_return_v1','supplier_replacement208')) THEN RAISE EXCEPTION 'AFTERCARE215_LEGACY_KEY_CONFLICT'; END IF;
 PERFORM public.phase4_lock_customer_order_context_internal((request->'baseRequest'->>'order_id')::UUID,false,false);
 plan:=public.tb215_prepare_return_internal(request);
 PERFORM public.phase2_lock_inventory_products_internal(ARRAY(SELECT DISTINCT(x->>'product_id')::UUID FROM jsonb_array_elements(request->'physicalSources') x ORDER BY 1));
 plan:=public.tb215_prepare_return_internal(request);
 IF p_preview_fingerprint IS DISTINCT FROM encode(extensions.digest(plan::TEXT,'sha256'),'hex') THEN RAISE EXCEPTION 'AFTERCARE215_PREVIEW_CHANGED'; END IF;
 IF jsonb_array_length(plan->'issues')<>0 THEN RAISE EXCEPTION USING MESSAGE='AFTERCARE215_FIELDS_REQUIRED',DETAIL=(plan->'issues')::TEXT; END IF;
 executed_base:=public.phase42_canonicalize_return_request_before_phase43_internal((request->'baseRequest'->>'order_id')::UUID,request->'baseRequest'->'items',request->'baseRequest'->>'reason',
  plan->>'refundMethod',plan->>'referenceNumber',request->'baseRequest'->>'notes');
 INSERT INTO public.aftercare215_return_contexts(operation_id,order_id,created_by,transaction_id,idempotency_key,request_snapshot,executed_base_request,physical_sources,prepared_plan,preview_fingerprint,created_at)
  VALUES(operation,(request->'baseRequest'->>'order_id')::UUID,actor,pg_current_xact_id(),key,request,executed_base,request->'physicalSources',plan,p_preview_fingerprint,at);
 inner_result:=public.settle_admin_sales_return_v1((request->'baseRequest'->>'order_id')::UUID,key,request->'baseRequest'->'items',request->'physicalSources',
  request->'baseRequest'->>'reason',plan->>'refundMethod',plan->>'referenceNumber',request->'baseRequest'->>'notes');
 inner_operation:=(inner_result->>'operationId')::UUID;
 supplier_operation:=public.tb215_hold_return_subset_internal(inner_operation,request->'supplierAssignments',key,request->'baseRequest'->>'reason');
 INSERT INTO public.aftercare215_return_results VALUES(operation,inner_operation,supplier_operation);
 result:=public.tb215_return_public_result_internal(operation)||jsonb_build_object('evidenceFingerprint',encode(extensions.digest(public.tb215_return_manifest_internal(operation)::TEXT,'sha256'),'hex'));
 INSERT INTO public.business_operations(id,operation_type,idempotency_key,request_fingerprint,request_identity_version,request_identity_snapshot,actor_scope_type,actor_scope_hash,initiated_by,result_snapshot,completed_at)
  VALUES(operation,'aftercare215_return',key,fingerprint,215,identity,'erp_user',actor_hash,actor,result,clock_timestamp());
 PERFORM public.tb215_assert_return_internal(operation);
 INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details) VALUES(actor,'RETURN215_CONFIRMED','business_operations',operation,
  jsonb_build_object('order_id',request->'baseRequest'->'order_id','return_operation_id',inner_operation));
 RETURN(result-'evidenceFingerprint')||jsonb_build_object('idempotentReplay',false);
END $$;

CREATE FUNCTION public.tb215_guard_return_context_internal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN PERFORM public.tb215_assert_return_internal(NEW.operation_id);RETURN NULL; END $$;
CREATE CONSTRAINT TRIGGER aftercare215_return_context_complete AFTER INSERT ON public.aftercare215_return_contexts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.tb215_guard_return_context_internal();

-- A supplier credit exchanges a held in-kind asset for an equal reduction of
-- an evidenced supplier payable. It is not a cash payment or a write-off.
CREATE TABLE public.supplier215_credits (
 event_id UUID PRIMARY KEY REFERENCES public.supplier_replacement_events(id),
 operation_id UUID NOT NULL UNIQUE REFERENCES public.business_operations(id) DEFERRABLE INITIALLY DEFERRED,
 case_id UUID NOT NULL REFERENCES public.supplier_replacement_cases(id),
 supplier_id UUID NOT NULL REFERENCES public.suppliers(id),
 amount_delta_in_minor_units BIGINT NOT NULL CHECK(amount_delta_in_minor_units<>0),
 balance_before_in_minor_units BIGINT NOT NULL,
 balance_after_in_minor_units BIGINT NOT NULL,
 financial_membership_sha256 TEXT NOT NULL CHECK(financial_membership_sha256~'^[0-9a-f]{64}$'),
 reverses_credit_event_id UUID UNIQUE REFERENCES public.supplier215_credits(event_id),
 created_at TIMESTAMPTZ NOT NULL,
 created_by UUID NOT NULL REFERENCES public.profiles(id),
 CHECK(balance_after_in_minor_units=balance_before_in_minor_units-amount_delta_in_minor_units),
 CHECK((amount_delta_in_minor_units<0)=(reverses_credit_event_id IS NOT NULL))
);
CREATE INDEX supplier215_credit_supplier ON public.supplier215_credits(supplier_id,created_at,event_id);
CREATE INDEX supplier215_credit_case ON public.supplier215_credits(case_id,created_at,event_id);
ALTER TABLE public.supplier_replacement_events DROP CONSTRAINT supplier_replacement_events_action_check;
ALTER TABLE public.supplier_replacement_events DROP CONSTRAINT supplier_replacement_events_check1;
ALTER TABLE public.supplier_replacement_events ADD CONSTRAINT supplier_replacement215_action CHECK(action IN('send','immediate','receive','writeoff','damage','reverse','credit'));
ALTER TABLE public.supplier_replacement_events ADD CONSTRAINT supplier_replacement215_delta CHECK(action='reverse'
 OR(action='send' AND held_delta=quantity) OR(action IN('receive','writeoff','credit') AND held_delta=-quantity)
 OR(action IN('immediate','damage') AND held_delta=0));

CREATE FUNCTION public.tb215_supplier_membership_internal(p_supplier_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT encode(extensions.digest(jsonb_build_object(
  'direct',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.supplier_receipts r WHERE r.supplier_id=p_supplier_id),
  'purchase',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.purchase_receipts r JOIN public.purchase_orders po ON po.id=r.purchase_order_id WHERE po.supplier_id=p_supplier_id),
  'legacyPurchasePayable',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.purchase_order_id),'[]') FROM public.phase133_legacy_po_payables_internal() r WHERE r.supplier_id=p_supplier_id),
  'payments',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.supplier_payments r WHERE r.supplier_id=p_supplier_id),
  'opening',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.supplier_opening_balances r WHERE r.supplier_id=p_supplier_id),
  'claims',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.cheque_compensation_claims r WHERE r.party_kind='supplier' AND r.party_id=p_supplier_id)
 )::TEXT,'sha256'),'hex');
$$;

ALTER FUNCTION public.phase133_supplier_balance_evidence_internal() RENAME TO tb215_supplier_balance_before215_internal;
CREATE FUNCTION public.phase133_supplier_balance_evidence_internal()
RETURNS TABLE(supplier_id UUID,balance BIGINT) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT old.supplier_id,(old.balance-COALESCE(credits.amount,0))::BIGINT FROM public.tb215_supplier_balance_before215_internal() old
 LEFT JOIN(SELECT c.supplier_id,sum(c.amount_delta_in_minor_units) amount FROM public.supplier215_credits c GROUP BY c.supplier_id) credits ON credits.supplier_id=old.supplier_id;
$$;

CREATE FUNCTION public.tb215_credit_plan_internal(p_action TEXT,p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.supplier_replacement_cases%ROWTYPE; original public.supplier215_credits%ROWTYPE; event public.supplier_replacement_events%ROWTYPE;
 quantity INTEGER; amount BIGINT; pending BIGINT; prior BIGINT; balance BIGINT; cached BIGINT; last_id UUID; membership TEXT; reason TEXT:=nullif(btrim(p_payload->>'reason'),'');
BEGIN
 IF p_action IS NULL OR p_action NOT IN('credit','reverse_credit') OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
  OR reason IS NULL OR length(reason) NOT BETWEEN 3 AND 500
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE NOT k=ANY(CASE WHEN p_action='credit' THEN ARRAY['caseId','quantity','reason'] ELSE ARRAY['eventId','reason'] END))
 THEN RAISE EXCEPTION 'SUPPLIER215_CREDIT_REQUEST_INVALID'; END IF;
 IF p_action='credit' THEN
  IF jsonb_typeof(p_payload->'quantity') IS DISTINCT FROM 'number' OR COALESCE(p_payload->>'quantity','') !~ '^[1-9][0-9]{0,8}$'
  THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_QUANTITY_INVALID'; END IF;
  quantity:=(p_payload->>'quantity')::INTEGER;
  SELECT * INTO c FROM public.supplier_replacement_cases WHERE id=(p_payload->>'caseId')::UUID;
 ELSE
  SELECT * INTO original FROM public.supplier215_credits WHERE event_id=(p_payload->>'eventId')::UUID AND amount_delta_in_minor_units>0;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER215_CREDIT_EVENT_INVALID'; END IF;
  SELECT * INTO STRICT event FROM public.supplier_replacement_events WHERE id=original.event_id;
  SELECT * INTO c FROM public.supplier_replacement_cases WHERE id=original.case_id;
  quantity:=event.quantity;
 END IF;
 IF c.id IS NULL OR c.supplier_id IS NULL THEN RAISE EXCEPTION 'SUPPLIER215_CREDIT_CASE_INVALID'; END IF;
 SELECT id INTO last_id FROM public.supplier_replacement_events e WHERE e.case_id=c.id
  AND NOT EXISTS(SELECT 1 FROM public.supplier_replacement_events n WHERE n.previous_event_id=e.id);
 SELECT COALESCE(sum(held_delta),0) INTO pending FROM public.supplier_replacement_events WHERE case_id=c.id;
 SELECT current_balance_in_minor_units INTO cached FROM public.suppliers WHERE id=c.supplier_id AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_SUPPLIER_INVALID'; END IF;
 SELECT e.balance INTO balance FROM public.phase133_supplier_balance_evidence_internal() e WHERE e.supplier_id=c.supplier_id;
 IF balance IS NULL OR balance IS DISTINCT FROM cached THEN RAISE EXCEPTION 'SUPPLIER215_PAYABLE_EVIDENCE_INVALID'; END IF;
 membership:=public.tb215_supplier_membership_internal(c.supplier_id);
 IF p_action='credit' THEN
  IF quantity>pending THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_EXCEEDS_PENDING'; END IF;
  SELECT COALESCE(sum(CASE WHEN e.action='credit' THEN e.quantity ELSE -e.quantity END),0) INTO prior
   FROM public.supplier215_credits l JOIN public.supplier_replacement_events e ON e.id=l.event_id WHERE l.case_id=c.id;
  amount:=round((prior+quantity)*c.unit_cost_in_minor_units_exact)::BIGINT-round(prior*c.unit_cost_in_minor_units_exact)::BIGINT;
  IF amount<=0 OR amount>balance THEN RAISE EXCEPTION 'SUPPLIER215_CREDIT_EXCEEDS_PAYABLE'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM public.supplier215_credits WHERE reverses_credit_event_id=original.event_id) THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_ALREADY_REVERSED'; END IF;
  IF last_id IS DISTINCT FROM original.event_id OR pending+quantity>c.quantity
   OR balance IS DISTINCT FROM original.balance_after_in_minor_units OR membership IS DISTINCT FROM original.financial_membership_sha256
  THEN RAISE EXCEPTION 'SUPPLIER215_CREDIT_LATER_DEPENDENCY'; END IF;
  amount:=-original.amount_delta_in_minor_units;
 END IF;
 RETURN jsonb_build_object('action',p_action,'payload',p_payload||jsonb_build_object('reason',reason),'caseId',c.id,'supplierId',c.supplier_id,
  'productId',c.product_id,'quantity',quantity,'amountDeltaInMinorUnits',amount::TEXT,'balanceBeforeInMinorUnits',balance::TEXT,
  'balanceAfterInMinorUnits',(balance-amount)::TEXT,'lastEventId',last_id,'pendingBefore',pending,'membership',membership,'reversesEventId',original.event_id);
END $$;

CREATE FUNCTION public.preview_supplier_replacement_credit_v1(p_action TEXT,p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE plan JSONB;
BEGIN
 PERFORM public.sr208_assert_role_internal(CASE WHEN p_action='reverse_credit' THEN 'reverse' ELSE 'values' END);
 plan:=public.tb215_credit_plan_internal(p_action,p_payload);
 RETURN (plan-'membership'-'payload')||jsonb_build_object('contractVersion',215,'previewFingerprint',encode(extensions.digest(plan::TEXT,'sha256'),'hex'));
END $$;

-- Credit and its inverse are value-neutral stock events. The ordinary 208
-- stock-restoring inverse continues to enforce its original movement guards.
ALTER FUNCTION public.sr208_append_event_internal(UUID,UUID,TEXT,INTEGER,INTEGER,BIGINT,INTEGER,TEXT,TIMESTAMPTZ,UUID) RENAME TO tb215_append_before215_internal;
CREATE FUNCTION public.sr208_append_event_internal(p_operation_id UUID,p_case_id UUID,p_action TEXT,p_quantity INTEGER,p_held_delta INTEGER,p_expense BIGINT,p_stock_delta INTEGER,p_reason TEXT,p_at TIMESTAMPTZ,p_reverses UUID DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.supplier_replacement_cases%ROWTYPE; p public.products%ROWTYPE; qty INTEGER; reserved INTEGER; previous UUID; event_id UUID:=gen_random_uuid(); original public.supplier_replacement_events%ROWTYPE;
BEGIN
 IF p_action<>'credit' AND NOT(p_action='reverse' AND EXISTS(SELECT 1 FROM public.supplier215_credits credit WHERE credit.event_id=p_reverses AND credit.amount_delta_in_minor_units>0)) THEN
  RETURN public.tb215_append_before215_internal(p_operation_id,p_case_id,p_action,p_quantity,p_held_delta,p_expense,p_stock_delta,p_reason,p_at,p_reverses);
 END IF;
 IF p_quantity IS NULL OR p_quantity<=0 OR p_expense IS DISTINCT FROM 0 OR p_stock_delta IS DISTINCT FROM 0
  OR (p_action='credit' AND(p_reverses IS NOT NULL OR p_held_delta IS DISTINCT FROM -p_quantity))
  OR (p_action='reverse' AND p_held_delta IS DISTINCT FROM p_quantity) THEN RAISE EXCEPTION 'SUPPLIER215_CREDIT_EFFECT_INVALID'; END IF;
 SELECT * INTO STRICT c FROM public.supplier_replacement_cases WHERE id=p_case_id;
 IF p_action='reverse' THEN
  SELECT * INTO STRICT original FROM public.supplier_replacement_events WHERE id=p_reverses;
  IF original.case_id<>c.id OR original.action<>'credit' OR original.quantity<>p_quantity THEN RAISE EXCEPTION 'SUPPLIER215_CREDIT_EFFECT_INVALID'; END IF;
 END IF;
 SELECT * INTO STRICT p FROM public.products WHERE id=c.product_id;
 SELECT on_hand_quantity,reserved_quantity INTO STRICT qty,reserved FROM public.inventory_balances WHERE warehouse_id=c.warehouse_id AND product_id=c.product_id;
 SELECT id INTO previous FROM public.supplier_replacement_events e WHERE e.case_id=c.id AND NOT EXISTS(SELECT 1 FROM public.supplier_replacement_events n WHERE n.previous_event_id=e.id);
 INSERT INTO public.supplier_replacement_events(id,case_id,operation_id,action,quantity,held_delta,expense_delta_in_minor_units,reverses_event_id,previous_event_id,reason,occurred_at,created_by)
  VALUES(event_id,c.id,p_operation_id,p_action,p_quantity,p_held_delta,0,p_reverses,previous,p_reason,p_at,auth.uid());
 INSERT INTO public.supplier_replacement_inventory_effects(event_id,product_id,warehouse_id,on_hand_before,on_hand_after,reserved_before,wac_before,wac_after,cost_before,cost_after,movement_ids,post_inventory_fingerprint)
  VALUES(event_id,c.product_id,c.warehouse_id,qty,qty,reserved,p.wac_cost_in_minor_units_exact,p.wac_cost_in_minor_units_exact,p.cost_price_in_minor_units,p.cost_price_in_minor_units,'{}',public.sr208_inventory_fingerprint_internal(c.product_id));
 RETURN event_id;
END $$;

CREATE FUNCTION public.tb215_assert_supplier_credit_internal(p_operation_id UUID)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE l public.supplier215_credits%ROWTYPE; c public.supplier_replacement_cases%ROWTYPE; e public.supplier_replacement_events%ROWTYPE; b public.business_operations%ROWTYPE; amount BIGINT; prior BIGINT;
BEGIN
 SELECT * INTO STRICT l FROM public.supplier215_credits WHERE operation_id=p_operation_id;
 SELECT * INTO STRICT c FROM public.supplier_replacement_cases WHERE id=l.case_id;
 SELECT * INTO STRICT e FROM public.supplier_replacement_events WHERE id=l.event_id;
 SELECT * INTO STRICT b FROM public.business_operations WHERE id=p_operation_id;
 IF e.case_id IS DISTINCT FROM l.case_id OR e.operation_id IS DISTINCT FROM l.operation_id OR c.supplier_id IS DISTINCT FROM l.supplier_id
  OR e.expense_delta_in_minor_units<>0 OR e.created_by IS DISTINCT FROM l.created_by OR b.initiated_by IS DISTINCT FROM l.created_by
  OR e.occurred_at IS DISTINCT FROM l.created_at OR l.balance_after_in_minor_units<>l.balance_before_in_minor_units-l.amount_delta_in_minor_units
  OR e.reason IS DISTINCT FROM b.request_identity_snapshot->'payload'->>'reason'
  OR b.result_snapshot->>'credit215Fingerprint' IS DISTINCT FROM encode(extensions.digest(
   ((to_jsonb(l)-'created_at')||jsonb_build_object('createdAtEpoch',extract(epoch FROM l.created_at)::TEXT))::TEXT,'sha256'),'hex')
  OR NOT EXISTS(SELECT 1 FROM public.supplier_replacement_inventory_effects f WHERE f.event_id=e.id AND f.on_hand_before=f.on_hand_after
   AND f.wac_before IS NOT DISTINCT FROM f.wac_after AND f.cost_before=f.cost_after AND cardinality(f.movement_ids)=0)
 THEN RAISE EXCEPTION 'SUPPLIER215_CREDIT_EVIDENCE_INVALID'; END IF;
 IF l.amount_delta_in_minor_units>0 THEN
  WITH RECURSIVE ancestors AS(SELECT p.* FROM public.supplier_replacement_events p WHERE p.id=e.previous_event_id
   UNION ALL SELECT p.* FROM public.supplier_replacement_events p JOIN ancestors a ON p.id=a.previous_event_id)
  SELECT COALESCE(sum(CASE WHEN a.action='credit' THEN a.quantity ELSE -a.quantity END),0) INTO prior
   FROM ancestors a JOIN public.supplier215_credits other ON other.event_id=a.id;
  amount:=round((prior+e.quantity)*c.unit_cost_in_minor_units_exact)::BIGINT-round(prior*c.unit_cost_in_minor_units_exact)::BIGINT;
  IF e.action<>'credit' OR e.held_delta<>-e.quantity OR l.reverses_credit_event_id IS NOT NULL OR amount<>l.amount_delta_in_minor_units
   OR l.balance_before_in_minor_units<amount OR b.request_identity_snapshot->>'action' IS DISTINCT FROM 'credit'
   OR (b.request_identity_snapshot->'payload'->>'caseId')::UUID IS DISTINCT FROM c.id
   OR (b.request_identity_snapshot->'payload'->>'quantity')::INTEGER IS DISTINCT FROM e.quantity
  THEN RAISE EXCEPTION 'SUPPLIER215_CREDIT_EVIDENCE_INVALID'; END IF;
 ELSE
  IF e.action<>'reverse' OR e.held_delta<>e.quantity OR e.reverses_event_id IS DISTINCT FROM l.reverses_credit_event_id
   OR b.request_identity_snapshot->>'action' IS DISTINCT FROM 'reverse_credit'
   OR (b.request_identity_snapshot->'payload'->>'eventId')::UUID IS DISTINCT FROM l.reverses_credit_event_id
   OR NOT EXISTS(SELECT 1 FROM public.supplier215_credits original WHERE original.event_id=l.reverses_credit_event_id
    AND original.amount_delta_in_minor_units=-l.amount_delta_in_minor_units AND original.supplier_id=l.supplier_id AND original.case_id=l.case_id)
  THEN RAISE EXCEPTION 'SUPPLIER215_CREDIT_EVIDENCE_INVALID'; END IF;
 END IF;
END $$;

CREATE FUNCTION public.settle_supplier_replacement_credit_v1(p_action TEXT,p_payload JSONB,p_idempotency_key TEXT,p_preview_fingerprint TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_variable
DECLARE actor UUID; key TEXT:=btrim(p_idempotency_key); request JSONB; plan JSONB; existing public.business_operations%ROWTYPE; fingerprint TEXT;
 operation UUID:=gen_random_uuid(); event UUID; case_id UUID; pid UUID; supplier UUID; at TIMESTAMPTZ:=clock_timestamp(); manifest JSONB; result JSONB;
BEGIN
 actor:=public.sr208_assert_role_internal(CASE WHEN p_action='reverse_credit' THEN 'reverse' ELSE 'values' END);
 IF key IS NULL OR length(key) NOT BETWEEN 16 AND 200 OR COALESCE(p_preview_fingerprint,'') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'SUPPLIER215_CREDIT_PREVIEW_REQUIRED'; END IF;
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'SUPPLIER215_CREDIT_REQUEST_INVALID'; END IF;
 request:=jsonb_build_object('action',p_action,'payload',p_payload||jsonb_build_object('reason',nullif(btrim(p_payload->>'reason'),'')),'previewFingerprint',p_preview_fingerprint);
 fingerprint:=encode(extensions.digest(request::TEXT,'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('supplier-replacement208|'||actor::TEXT||'|'||key,0));
 SELECT * INTO existing FROM public.business_operations WHERE operation_type='supplier_replacement208' AND initiated_by=actor AND idempotency_key=key;
 IF FOUND THEN
  IF existing.request_fingerprint IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_IDEMPOTENCY_CONFLICT'; END IF;
  PERFORM public.sr208_assert_operation_internal(existing.id);
  RETURN jsonb_build_object('success',true,'contractVersion',215,'operationId',existing.id,'idempotentReplay',true,
   'credit',(SELECT (to_jsonb(c)-'financial_membership_sha256')||jsonb_build_object('amount_delta_in_minor_units',c.amount_delta_in_minor_units::TEXT,
    'balance_before_in_minor_units',c.balance_before_in_minor_units::TEXT,'balance_after_in_minor_units',c.balance_after_in_minor_units::TEXT) FROM public.supplier215_credits c WHERE c.operation_id=existing.id));
 END IF;
 plan:=public.tb215_credit_plan_internal(p_action,p_payload);case_id:=(plan->>'caseId')::UUID;pid:=(plan->>'productId')::UUID;supplier:=(plan->>'supplierId')::UUID;
 PERFORM pg_advisory_xact_lock(hashtextextended('supplier-replacement208-case|'||case_id::TEXT,0));
 PERFORM 1 FROM public.supplier_replacement_cases WHERE id=case_id FOR SHARE;
 PERFORM public.phase2_lock_inventory_products_internal(ARRAY[pid]);
 BEGIN
  PERFORM 1 FROM public.suppliers WHERE id=supplier AND is_active FOR UPDATE NOWAIT;
 EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='SUPPLIER_REPLACEMENT_PARENT_BUSY_RETRY'; END;
 IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_SUPPLIER_INVALID'; END IF;
 PERFORM public.sr208_assert_operation_internal(e.operation_id) FROM(SELECT DISTINCT operation_id FROM public.supplier_replacement_events WHERE supplier_replacement_events.case_id=case_id) e;
 plan:=public.tb215_credit_plan_internal(p_action,p_payload);
 IF p_preview_fingerprint IS DISTINCT FROM encode(extensions.digest(plan::TEXT,'sha256'),'hex') THEN RAISE EXCEPTION 'SUPPLIER215_CREDIT_PREVIEW_CHANGED'; END IF;
 event:=public.sr208_append_event_internal(operation,case_id,CASE WHEN p_action='credit' THEN 'credit' ELSE 'reverse' END,
  (plan->>'quantity')::INTEGER,CASE WHEN p_action='credit' THEN -(plan->>'quantity')::INTEGER ELSE(plan->>'quantity')::INTEGER END,
  0,0,plan->'payload'->>'reason',at,(plan->>'reversesEventId')::UUID);
 INSERT INTO public.supplier215_credits(event_id,operation_id,case_id,supplier_id,amount_delta_in_minor_units,balance_before_in_minor_units,balance_after_in_minor_units,financial_membership_sha256,reverses_credit_event_id,created_at,created_by)
  VALUES(event,operation,case_id,supplier,(plan->>'amountDeltaInMinorUnits')::BIGINT,(plan->>'balanceBeforeInMinorUnits')::BIGINT,
   (plan->>'balanceAfterInMinorUnits')::BIGINT,plan->>'membership',(plan->>'reversesEventId')::UUID,at,actor);
 UPDATE public.suppliers SET current_balance_in_minor_units=(plan->>'balanceAfterInMinorUnits')::BIGINT,updated_at=clock_timestamp() WHERE id=supplier;
 manifest:=public.sr208_operation_manifest_internal(operation);
 result:=jsonb_build_object('evidenceFingerprint',encode(extensions.digest(manifest::TEXT,'sha256'),'hex'),
  'caseIds',(SELECT jsonb_agg(x->'id' ORDER BY x->>'id') FROM jsonb_array_elements(manifest->'cases') x),
  'eventIds',(SELECT jsonb_agg(x->'id' ORDER BY x->>'id') FROM jsonb_array_elements(manifest->'events') x),
  'credit215Fingerprint',(SELECT encode(extensions.digest(((to_jsonb(credit)-'created_at')||jsonb_build_object('createdAtEpoch',extract(epoch FROM credit.created_at)::TEXT))::TEXT,'sha256'),'hex')
   FROM public.supplier215_credits credit WHERE credit.operation_id=operation));
 INSERT INTO public.business_operations(id,operation_type,idempotency_key,request_fingerprint,request_identity_version,request_identity_snapshot,initiated_by,result_snapshot,completed_at)
  VALUES(operation,'supplier_replacement208',key,fingerprint,208,request,actor,result,at);
 PERFORM public.sr208_assert_operation_internal(operation);
 IF (SELECT balance FROM public.phase133_supplier_balance_evidence_internal() WHERE supplier_id=supplier) IS DISTINCT FROM(plan->>'balanceAfterInMinorUnits')::BIGINT THEN RAISE EXCEPTION 'SUPPLIER215_PAYABLE_EVIDENCE_INVALID'; END IF;
 INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details) VALUES(actor,'SUPPLIER_CREDIT_DECISION','business_operations',operation,
  jsonb_build_object('case_id',case_id,'event_id',event,'action',p_action));
 RETURN jsonb_build_object('success',true,'contractVersion',215,'operationId',operation,'idempotentReplay',false,
  'credit',(SELECT (to_jsonb(c)-'financial_membership_sha256')||jsonb_build_object('amount_delta_in_minor_units',c.amount_delta_in_minor_units::TEXT,
   'balance_before_in_minor_units',c.balance_before_in_minor_units::TEXT,'balance_after_in_minor_units',c.balance_after_in_minor_units::TEXT) FROM public.supplier215_credits c WHERE c.operation_id=operation));
END $$;

-- An ordinary 208 inverse cannot silently reopen the held asset while leaving
-- the payable credit in place. The owner uses the paired credit inverse.
ALTER FUNCTION public.execute_supplier_replacement_v1(TEXT,JSONB,TEXT) RENAME TO tb215_supplier_writer_before215_internal;
CREATE FUNCTION public.execute_supplier_replacement_v1(p_action TEXT,p_payload JSONB,p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM public.sr208_assert_role_internal(p_action);
 IF p_action='reverse' AND EXISTS(SELECT 1 FROM public.supplier215_credits WHERE event_id=(p_payload->>'eventId')::UUID)
 THEN RAISE EXCEPTION 'SUPPLIER215_USE_CREDIT_REVERSAL'; END IF;
 RETURN public.tb215_supplier_writer_before215_internal(p_action,p_payload,p_idempotency_key);
END $$;

CREATE FUNCTION public.get_supplier_replacement_credits_v1(p_supplier_id UUID,p_page INTEGER DEFAULT 1,p_page_size INTEGER DEFAULT 25)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE rows JSONB; total BIGINT;
BEGIN
 PERFORM public.sr208_assert_role_internal('values');
 IF p_page IS NULL OR p_page<1 OR p_page>1000000 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'SUPPLIER215_CREDIT_PAGE_INVALID'; END IF;
 SELECT count(*) INTO total FROM public.supplier215_credits WHERE supplier_id=p_supplier_id;
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.event_id),'[]') INTO rows FROM(
  SELECT c.event_id,c.operation_id,c.case_id,c.amount_delta_in_minor_units::TEXT AS amount_delta_in_minor_units,
   c.balance_before_in_minor_units::TEXT AS balance_before_in_minor_units,c.balance_after_in_minor_units::TEXT AS balance_after_in_minor_units,c.reverses_credit_event_id,c.created_at,e.reason,
   p.name_ar AS product_name FROM public.supplier215_credits c JOIN public.supplier_replacement_cases sc ON sc.id=c.case_id
   JOIN public.products p ON p.id=sc.product_id JOIN public.supplier_replacement_events e ON e.id=c.event_id
   WHERE c.supplier_id=p_supplier_id ORDER BY c.created_at DESC,c.event_id LIMIT p_page_size OFFSET(p_page-1)*p_page_size) x;
 RETURN jsonb_build_object('contractVersion',215,'page',p_page,'pageSize',p_page_size,'totalCount',total,'rows',rows);
END $$;

ALTER FUNCTION public.sr208_case_dto_internal(UUID,BOOLEAN) RENAME TO tb215_case_dto_before215_internal;
CREATE FUNCTION public.sr208_case_dto_internal(p_case_id UUID,p_values BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result JSONB; quantity BIGINT; amount BIGINT;
BEGIN
 result:=public.tb215_case_dto_before215_internal(p_case_id,p_values);
 IF EXISTS(SELECT 1 FROM public.supplier215_credits WHERE case_id=p_case_id) THEN
  SELECT COALESCE(sum(CASE WHEN e.action='credit' THEN e.quantity ELSE -e.quantity END),0),COALESCE(sum(c.amount_delta_in_minor_units),0)::BIGINT
   INTO quantity,amount FROM public.supplier215_credits c JOIN public.supplier_replacement_events e ON e.id=c.event_id WHERE c.case_id=p_case_id;
  result:=result||jsonb_build_object('creditedQuantity',quantity);
  IF p_values THEN result:=result||jsonb_build_object('supplierCreditInMinorUnits',amount::TEXT); END IF;
 END IF;
 RETURN result;
END $$;

-- G4 prices a separate sale paid by an explicit internal exchange credit.
-- This preview never calls a writer, reserves stock, or fabricates a payment.
CREATE FUNCTION public.tb215_canonical_exchange_internal(p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE replacement JSONB; request JSONB; method TEXT; reference TEXT; product UUID; kind TEXT; quantity INTEGER;
BEGIN
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload-ARRAY['returnRequest','replacement','differenceMethod','referenceNumber']::TEXT[]<>'{}'
  OR jsonb_typeof(p_payload->'replacement') IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'AFTERCARE215_EXCHANGE_REQUEST_INVALID'; END IF;
 replacement:=p_payload->'replacement';
 IF replacement-ARRAY['productId','kind','quantity']::TEXT[]<>'{}' OR COALESCE(replacement->>'quantity','')!~'^[1-9][0-9]*$'
  OR(replacement->>'quantity')::NUMERIC>2147483647 OR replacement->>'kind' IS NULL
  OR replacement->>'kind' NOT IN('base_unit','legacy_single_sku_parcel')
  OR jsonb_typeof(p_payload->'returnRequest') IS DISTINCT FROM 'object'
  OR COALESCE(p_payload->'returnRequest'->>'refundMethod','auto')<>'auto'
  OR nullif(btrim(p_payload->'returnRequest'->>'referenceNumber'),'') IS NOT NULL
 THEN RAISE EXCEPTION 'AFTERCARE215_EXCHANGE_REQUEST_INVALID'; END IF;
 product:=public.phase3_require_uuid_internal(replacement->>'productId','replacement productId');
 quantity:=(replacement->>'quantity')::INTEGER;kind:=replacement->>'kind';
 method:=lower(nullif(btrim(p_payload->>'differenceMethod'),''));reference:=nullif(btrim(p_payload->>'referenceNumber'),'');
 IF method IS NOT NULL AND method NOT IN('cash','cliq') OR length(COALESCE(reference,''))>120
  OR reference IS NOT NULL AND method IS DISTINCT FROM 'cliq'
 THEN RAISE EXCEPTION 'AFTERCARE215_EXCHANGE_REQUEST_INVALID'; END IF;
 request:=public.tb215_canonical_return_internal(p_payload->'returnRequest');
 RETURN jsonb_build_object('returnRequest',request,'replacement',jsonb_build_object('productId',product,'kind',kind,'quantity',quantity),
  'differenceMethod',method,'referenceNumber',reference);
END $$;

CREATE FUNCTION public.tb215_prepare_exchange_internal(p_request JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_variable
DECLARE returned JSONB; original public.orders%ROWTYPE; product public.products%ROWTYPE; replacement JSONB:=p_request->'replacement';
 product_id UUID:=(replacement->>'productId')::UUID; quantity INTEGER:=(replacement->>'quantity')::INTEGER;
 base_quantity BIGINT; price BIGINT; total NUMERIC; entitlement BIGINT; difference BIGINT; internal_credit BIGINT; exact_cogs NUMERIC;
 available BIGINT; line JSONB; method TEXT:=p_request->>'differenceMethod'; reference TEXT:=p_request->>'referenceNumber';
 shift_id UUID; issues JSONB:='[]';
BEGIN
 returned:=public.tb215_prepare_return_internal(p_request->'returnRequest');
 SELECT * INTO STRICT original FROM public.orders WHERE id=(returned->'request'->'baseRequest'->>'order_id')::UUID;
 IF (returned->'financialPosition'->>'outstanding_total_in_minor_units')::BIGINT<>0
  OR(returned->'financialPosition'->>'net_collected_in_minor_units')::BIGINT<(returned->'financialPosition'->>'total_in_minor_units')::BIGINT
  OR(returned->>'debtReductionInMinorUnits')::BIGINT<>0
 THEN RAISE EXCEPTION 'AFTERCARE215_EXCHANGE_FULLY_PAID_REQUIRED'; END IF;
 -- A packet taken out of a parcel cannot acquire a refund/another-SKU right.
 -- The existing whole-parcel guard is also checked for every selected root.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(returned->'physicalSources') s
   WHERE s->>'source_kind'='replacement_item'
    AND EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.id=(s->>'root_source_id')::UUID AND oi.commercial_line_kind='base_unit'))
 THEN RAISE EXCEPTION 'AFTERCARE215_EXCHANGE_ORIGINAL_PACKET_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(returned->'physicalSources') s WHERE(s->>'product_id')::UUID=product_id)
 THEN RAISE EXCEPTION 'AFTERCARE215_EXCHANGE_OTHER_PRODUCT_REQUIRED'; END IF;
 SELECT * INTO product FROM public.products WHERE id=product_id AND is_active;
 IF NOT FOUND OR product.is_flavor_master THEN RAISE EXCEPTION 'PHASE3_POS_PRODUCT_INVALID'; END IF;
 IF replacement->>'kind'='base_unit' THEN
  IF public.parcel209_effective_only_internal(product_id) THEN RAISE EXCEPTION 'PARCEL209_UNIT_SALE_FORBIDDEN'; END IF;
  base_quantity:=quantity;price:=product.sale_price_in_minor_units;
  line:=jsonb_build_object('commercial_line_kind','base_unit','product_id',product_id,'base_quantity',quantity);
 ELSE
  IF product.units_per_sale_unit<=1 OR COALESCE(product.default_sale_price_in_minor_units,0)<=0 THEN RAISE EXCEPTION 'PHASE3_POS_PRICE_OR_PACKAGE_STALE'; END IF;
  base_quantity:=quantity::BIGINT*product.units_per_sale_unit;price:=product.default_sale_price_in_minor_units;
  line:=jsonb_build_object('commercial_line_kind','legacy_single_sku_parcel','product_id',product_id,'parcel_quantity',quantity,'units_per_parcel',product.units_per_sale_unit);
 END IF;
 total:=quantity::NUMERIC*price;
 IF base_quantity>2147483647 OR price<=0 OR total>9223372036854775807 THEN RAISE EXCEPTION 'PHASE3_POS_MONEY_INVALID'; END IF;
 SELECT COALESCE(sum(b.on_hand_quantity-b.reserved_quantity),0)::BIGINT INTO available FROM public.inventory_balances b
  WHERE b.product_id=product.id AND b.warehouse_id=original.warehouse_id;
 IF available<base_quantity THEN RAISE EXCEPTION 'PHASE3_POS_INSUFFICIENT_STOCK'; END IF;
 exact_cogs:=round(base_quantity::NUMERIC*COALESCE(product.wac_cost_in_minor_units_exact,product.cost_price_in_minor_units::NUMERIC),6);
 entitlement:=(returned->>'entitlementInMinorUnits')::BIGINT;
 IF entitlement<=0 THEN RAISE EXCEPTION 'AFTERCARE215_EXCHANGE_VALUE_REQUIRED'; END IF;
 difference:=total::BIGINT-entitlement;internal_credit:=LEAST(total::BIGINT,entitlement);
 IF difference=0 THEN method:=NULL;reference:=NULL;
 ELSE
  IF method IS NULL AND difference<0 AND returned->>'originalPaymentMethod' IN('cash','cliq') THEN method:=returned->>'originalPaymentMethod'; END IF;
  IF method IS NULL THEN issues:=issues||jsonb_build_array(jsonb_build_object('field','differenceMethod','code','AFTERCARE215_DIFFERENCE_METHOD_REQUIRED')); END IF;
  IF method='cliq' AND reference IS NULL THEN issues:=issues||jsonb_build_array(jsonb_build_object('field','referenceNumber','code','AFTERCARE215_REFUND_REFERENCE_REQUIRED')); END IF;
 END IF;
 SELECT id INTO shift_id FROM public.cash_shifts WHERE branch_id=original.branch_id AND status='open';
 IF shift_id IS NULL THEN issues:=issues||jsonb_build_array(jsonb_build_object('field','cashShift','code','PHASE2_OPEN_SHIFT_REQUIRED')); END IF;
 RETURN jsonb_build_object('request',p_request,'returnPlan',returned-'issues','orderId',original.id,'branchId',original.branch_id,'warehouseId',original.warehouse_id,
  'customerId',original.customer_id,'customerName',original.customer_name_snapshot,'cashShiftId',shift_id,'productId',product.id,'productName',product.name_ar,
  'line',line||jsonb_build_object('price_authority','server_catalog','line_discount_in_minor_units',0),'baseQuantity',base_quantity,
  'availableQuantity',available,'newTotalInMinorUnits',total::TEXT,'internalCreditInMinorUnits',internal_credit::TEXT,
  'differenceInMinorUnits',difference::TEXT,'moneyReceivedInMinorUnits',GREATEST(difference,0)::TEXT,'moneyRefundInMinorUnits',GREATEST(-difference,0)::TEXT,
  'differenceMethod',method,'referenceNumber',reference,'newCogsExact',exact_cogs::TEXT,'newCogsInMinorUnits',round(exact_cogs)::TEXT,
  'issues',issues);
END $$;

CREATE FUNCTION public.preview_sales_exchange_v1(p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE plan JSONB; result JSONB;
BEGIN
 PERFORM public.assert_erp_role(ARRAY['owner','admin'],'معاينة تبديل بصنف آخر');
 IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='AFTERCARE215_ROLE_DENIED'; END IF;
 plan:=public.tb215_prepare_exchange_internal(public.tb215_canonical_exchange_internal(p_payload));
 result:=jsonb_build_object('contractVersion',215,'previewFingerprint',encode(extensions.digest(plan::TEXT,'sha256'),'hex'),
  'orderId',plan->'orderId','productId',plan->'productId','productName',plan->'productName','baseQuantity',plan->'baseQuantity',
  'newTotalInMinorUnits',plan->'newTotalInMinorUnits','internalCreditInMinorUnits',plan->'internalCreditInMinorUnits',
  'differenceInMinorUnits',plan->'differenceInMinorUnits','moneyReceivedInMinorUnits',plan->'moneyReceivedInMinorUnits','moneyRefundInMinorUnits',plan->'moneyRefundInMinorUnits',
  'differenceMethod',plan->'differenceMethod','referenceNumber',plan->'referenceNumber',
  'goodQuantity',plan->'returnPlan'->'goodQuantity','badQuantity',plan->'returnPlan'->'badQuantity','issues',plan->'issues','canConfirm',jsonb_array_length(plan->'issues')=0);
 IF public.has_erp_role(ARRAY['owner']) THEN result:=result||jsonb_build_object('newCogsExact',plan->'newCogsExact',
  'goodRestockValueExact',plan->'returnPlan'->'goodRestockValueExact','supplierHeldInMinorUnits',plan->'returnPlan'->'supplierHeldInMinorUnits',
  'profitDeltaExactInMinorUnits',((plan->>'differenceInMinorUnits')::NUMERIC-(plan->>'newCogsInMinorUnits')::NUMERIC
   +(plan->'returnPlan'->>'goodRestockValueExact')::NUMERIC+(plan->'returnPlan'->>'supplierHeldInMinorUnits')::NUMERIC)::TEXT); END IF;
 RETURN result;
END $$;

CREATE TABLE public.aftercare215_exchanges (
 operation_id UUID PRIMARY KEY REFERENCES public.business_operations(id) DEFERRABLE INITIALLY DEFERRED,
 created_by UUID NOT NULL REFERENCES public.profiles(id),transaction_id XID8 NOT NULL,
 order_id UUID NOT NULL REFERENCES public.orders(id),idempotency_key TEXT NOT NULL,
 return_key TEXT NOT NULL UNIQUE,pos_key TEXT NOT NULL UNIQUE,
 prepared_plan JSONB NOT NULL,preview_fingerprint TEXT NOT NULL CHECK(preview_fingerprint~'^[0-9a-f]{64}$'),
 original_completed_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL,
 UNIQUE(created_by,idempotency_key)
);
CREATE TABLE public.aftercare215_exchange_results (
 operation_id UUID PRIMARY KEY REFERENCES public.aftercare215_exchanges(operation_id),
 return_operation_id UUID NOT NULL UNIQUE REFERENCES public.business_operations(id),
 new_order_id UUID NOT NULL UNIQUE REFERENCES public.orders(id),supplier_operation_id UUID UNIQUE REFERENCES public.business_operations(id)
);
CREATE INDEX aftercare215_exchange_transaction ON public.aftercare215_exchanges(transaction_id,created_by);
CREATE INDEX aftercare215_exchange_period ON public.aftercare215_exchanges(created_at,order_id);

CREATE FUNCTION public.tb215_active_exchange_internal()
RETURNS public.aftercare215_exchanges LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ctx public.aftercare215_exchanges%ROWTYPE; n INTEGER;
BEGIN
 SELECT count(*)::INTEGER INTO n FROM public.aftercare215_exchanges e WHERE e.transaction_id=pg_current_xact_id_if_assigned() AND e.created_by=auth.uid()
  AND NOT EXISTS(SELECT 1 FROM public.business_operations b WHERE b.id=e.operation_id);
 IF n<>1 THEN RAISE EXCEPTION 'AFTERCARE215_EXCHANGE_CONTEXT_REQUIRED'; END IF;
 SELECT * INTO STRICT ctx FROM public.aftercare215_exchanges e WHERE e.transaction_id=pg_current_xact_id_if_assigned() AND e.created_by=auth.uid()
  AND NOT EXISTS(SELECT 1 FROM public.business_operations b WHERE b.id=e.operation_id);
 RETURN ctx;
END $$;

CREATE FUNCTION public.tb215_assert_exchange_pos_admission_internal(p_warehouse_id UUID,p_branch_id UUID,p_customer_id UUID,p_customer_name TEXT,
 p_payment_method TEXT,p_lines JSONB,p_discount BIGINT,p_received BIGINT,p_key TEXT)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ctx public.aftercare215_exchanges%ROWTYPE; plan JSONB;
BEGIN
 ctx:=public.tb215_active_exchange_internal();plan:=ctx.prepared_plan;
 IF p_key IS DISTINCT FROM ctx.pos_key OR p_payment_method IS DISTINCT FROM 'exchange_credit' OR p_discount IS DISTINCT FROM 0::BIGINT OR p_received IS DISTINCT FROM 0::BIGINT
  OR p_warehouse_id IS DISTINCT FROM(plan->>'warehouseId')::UUID OR p_branch_id IS DISTINCT FROM(plan->>'branchId')::UUID
  OR p_customer_id IS DISTINCT FROM(plan->>'customerId')::UUID OR p_customer_name IS DISTINCT FROM plan->>'customerName'
  OR p_lines IS DISTINCT FROM jsonb_build_array(plan->'line')
 THEN RAISE EXCEPTION 'AFTERCARE215_EXCHANGE_CONTEXT_REQUIRED'; END IF;
END $$;

CREATE FUNCTION public.tb215_assert_exchange_return_admission_internal(p_order_id UUID,p_key TEXT,p_items JSONB,p_reason TEXT,p_method TEXT,p_reference TEXT,p_notes TEXT)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ctx public.aftercare215_exchanges%ROWTYPE; request JSONB;
BEGIN
 ctx:=public.tb215_active_exchange_internal();request:=ctx.prepared_plan->'returnPlan'->'request'->'baseRequest';
 IF p_key IS DISTINCT FROM ctx.return_key OR p_order_id IS DISTINCT FROM ctx.order_id OR p_method IS DISTINCT FROM 'exchange_credit'
  OR p_items IS DISTINCT FROM request->'items' OR p_reason IS DISTINCT FROM request->>'reason'
  OR p_notes IS DISTINCT FROM request->>'notes' OR p_reference IS NOT NULL
 THEN RAISE EXCEPTION 'AFTERCARE215_EXCHANGE_CONTEXT_REQUIRED'; END IF;
END $$;

CREATE FUNCTION public.tb215_exchange_canonical_return_internal(p_order_id UUID,p_items JSONB,p_reason TEXT,p_method TEXT,p_reference TEXT,p_notes TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ctx public.aftercare215_exchanges%ROWTYPE; base JSONB; sources JSONB;
BEGIN
 ctx:=public.tb215_active_exchange_internal();
 PERFORM public.tb215_assert_exchange_return_admission_internal(p_order_id,ctx.return_key,p_items,p_reason,p_method,p_reference,p_notes);
 base:=public.phase42_canonicalize_return_request_before_phase43_internal(p_order_id,p_items,p_reason,NULL,NULL,p_notes);
 sources:=ctx.prepared_plan->'returnPlan'->'request'->'physicalSources';
 PERFORM public.tb215_assert_return_allocation_internal(base,sources);
 RETURN base||jsonb_build_object('refund_method','exchange_credit','physical_sources',sources);
END $$;

CREATE FUNCTION public.tb215_assert_exchange_return_event_internal(p_event_id UUID)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE event public.sales_return_events%ROWTYPE; op public.business_operations%ROWTYPE; ctx public.aftercare215_exchanges%ROWTYPE;
 request JSONB; matching INTEGER;
BEGIN
 SELECT * INTO STRICT event FROM public.sales_return_events WHERE id=p_event_id;
 SELECT * INTO STRICT op FROM public.business_operations WHERE id=event.operation_id;
 SELECT count(*) INTO matching FROM public.aftercare215_exchanges e WHERE e.return_key=op.idempotency_key AND e.created_by=op.initiated_by;
 IF matching<>1 THEN RAISE EXCEPTION 'AFTERCARE215_EXCHANGE_CONTEXT_REQUIRED'; END IF;
 SELECT * INTO STRICT ctx FROM public.aftercare215_exchanges e WHERE e.return_key=op.idempotency_key AND e.created_by=op.initiated_by;
 request:=ctx.prepared_plan->'returnPlan'->'request'->'baseRequest';
 IF event.order_id IS DISTINCT FROM ctx.order_id OR event.refund_method IS DISTINCT FROM 'exchange_credit'
  OR event.cash_shift_id IS DISTINCT FROM(ctx.prepared_plan->>'cashShiftId')::UUID OR event.reference_number IS NOT NULL
  OR event.debt_reduction_amount_in_minor_units IS DISTINCT FROM 0::BIGINT
  OR event.money_refund_amount_in_minor_units IS DISTINCT FROM(ctx.prepared_plan->'returnPlan'->>'entitlementInMinorUnits')::BIGINT
  OR op.request_identity_snapshot IS DISTINCT FROM request||jsonb_build_object('refund_method','exchange_credit','physical_sources',ctx.prepared_plan->'returnPlan'->'request'->'physicalSources')
  OR(op.request_fingerprint IS DISTINCT FROM public.phase3_request_fingerprint_internal(op.request_identity_snapshot))
 THEN RAISE EXCEPTION 'AFTERCARE215_EXCHANGE_EVIDENCE_INVALID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.business_operations b WHERE b.id=ctx.operation_id) AND(ctx.transaction_id IS DISTINCT FROM pg_current_xact_id_if_assigned() OR ctx.created_by IS DISTINCT FROM auth.uid())
 THEN RAISE EXCEPTION 'AFTERCARE215_EXCHANGE_CONTEXT_REQUIRED'; END IF;
END $$;

ALTER TABLE public.sales_return_events DROP CONSTRAINT sales_return_events_refund_method_check;
ALTER TABLE public.sales_return_events ADD CONSTRAINT sales_return_events_refund_method_check CHECK(refund_method IN('cash','cliq','exchange_credit'));
ALTER TABLE public.sales_return_events DROP CONSTRAINT sales_return_events_money_method_shape_check;
ALTER TABLE public.sales_return_events ADD CONSTRAINT sales_return_events_money_method_shape_check CHECK(contract_version IS NULL
 OR(money_refund_amount_in_minor_units=0 AND refund_method IS NULL AND cash_shift_id IS NULL AND reference_number IS NULL)
 OR(money_refund_amount_in_minor_units>0 AND refund_method IS NOT NULL AND refund_method IN('cash','cliq','exchange_credit') AND cash_shift_id IS NOT NULL
  AND(refund_method<>'cliq' OR nullif(btrim(reference_number),'') IS NOT NULL)
  AND(refund_method<>'exchange_credit' OR(reference_number IS NULL AND debt_reduction_amount_in_minor_units=0))));
CREATE FUNCTION public.tb215_guard_exchange_return_insert_internal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.refund_method='exchange_credit' THEN PERFORM public.tb215_assert_exchange_return_event_internal(NEW.id); END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER aftercare215_exchange_return_admission AFTER INSERT ON public.sales_return_events DEFERRABLE INITIALLY IMMEDIATE
 FOR EACH ROW EXECUTE FUNCTION public.tb215_guard_exchange_return_insert_internal();
-- Static exact214/132 derivatives;private guarded carriers only.
CREATE OR REPLACE FUNCTION public.tb215_exchange_pos_internal(p_warehouse_id uuid, p_branch_id uuid, p_customer_id uuid, p_customer_name text, p_payment_method text, p_lines jsonb, p_discount_in_minor_units bigint DEFAULT 0, p_amount_received_in_minor_units bigint DEFAULT 0, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_key TEXT := NULLIF(BTRIM(p_idempotency_key), '');
  v_payment_method TEXT := LOWER(COALESCE(NULLIF(BTRIM(p_payment_method), ''), 'cash'));
  v_customer_name TEXT := COALESCE(NULLIF(BTRIM(p_customer_name), ''), 'زبون نقدي');
  v_customer_identity_hash TEXT;
  v_actor_hash TEXT;
  v_request JSONB;
  v_canonical_request JSONB;
  v_fingerprint TEXT;
  v_replay JSONB;
  v_line JSONB;
  v_instance JSONB;
  v_validated JSONB;
  v_cogs_allocation JSONB;
  v_plan_lines JSONB := '[]'::JSONB;
  v_final_lines JSONB := '[]'::JSONB;
  v_plan_instances JSONB;
  v_final_instances JSONB;
  v_plan_components JSONB;
  v_line_weighted_keys JSONB;
  v_instance_weighted_keys JSONB;
  v_product_ids UUID[];
  v_configuration_ids UUID[];
  v_family_ids UUID[];
  v_line_sequence INTEGER := 0;
  v_line_kind TEXT;
  v_product public.products%ROWTYPE;
  v_order_id UUID := gen_random_uuid();
  v_operation_id UUID := gen_random_uuid();
  v_order_item_id UUID;
  v_parcel_instance_id UUID;
  v_order_number TEXT;
  v_shift_id UUID;
  v_base_unit_name TEXT;
  v_parcel_unit_name TEXT;
  v_commercial_quantity INTEGER;
  v_base_quantity BIGINT;
  v_units_per_parcel INTEGER;
  v_unit_price BIGINT;
  v_line_gross BIGINT;
  v_line_cogs BIGINT;
  v_unit_cost_exact NUMERIC(24,6);
  v_line_exact_cogs NUMERIC(30,6);
  v_line_discount BIGINT;
  v_line_net BIGINT;
  v_line_profit BIGINT;
  v_instance_discount BIGINT;
  v_subtotal BIGINT := 0;
  v_total BIGINT;
  v_paid BIGINT;
  v_change BIGINT;
  v_demand RECORD;
  v_on_hand INTEGER;
  v_reserved INTEGER;
  v_balance_after INTEGER;
  v_result_items JSONB;
  v_result JSONB;
  v_component JSONB;
  v_movement_quantity INTEGER;
  v_constraint_name TEXT;
BEGIN
  PERFORM public.tb215_assert_exchange_pos_admission_internal(p_warehouse_id,p_branch_id,p_customer_id,p_customer_name,p_payment_method,p_lines,p_discount_in_minor_units,p_amount_received_in_minor_units,p_idempotency_key);
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'تنفيذ بيع نقطة البيع بالإصدار المحمي'
  );

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_ACTOR_NOT_AUTHORIZED: المستخدم الحالي غير مصادق عليه.';
  END IF;
  IF v_key IS NULL OR CHAR_LENGTH(v_key) NOT BETWEEN 16 AND 200 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_IDEMPOTENCY_INPUT_INVALID: مفتاح إعادة المحاولة غير صالح.';
  END IF;
  IF p_warehouse_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_LOCATION_REQUIRED: المستودع والفرع مطلوبان.';
  END IF;
  IF COALESCE(p_discount_in_minor_units, -1) < 0
    OR COALESCE(p_amount_received_in_minor_units, -1) < 0
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_MONEY_INVALID: قيم الخصم أو المبلغ المستلم غير صالحة.';
  END IF;
  IF v_payment_method NOT IN (
    'cash', 'cliq', 'card', 'bank_transfer', 'debt', 'mixed', 'exchange_credit'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_PAYMENT_METHOD_INVALID: طريقة الدفع غير معتمدة.';
  END IF;

  -- Cross-version order is deliberate: V1 and V2 first serialize on the exact
  -- same raw-key lock.  Only then may V2 enter its versioned operation lock.
  PERFORM pg_advisory_xact_lock(hashtext(v_key));

  v_actor_hash := public.phase3_actor_scope_hash_internal(
    'erp_user', v_user_id, NULL, NULL
  );
  IF p_customer_id IS NULL THEN
    v_customer_identity_hash := ENCODE(extensions.digest(
      'phase3:walk-in-customer:v1|' || LOWER(v_customer_name),
      'sha256'::TEXT
    ), 'hex');
  END IF;

  v_request := JSONB_BUILD_OBJECT(
    'contract_version', 'phase3-sale-v1',
    'actor_scope_type', 'erp_user',
    'actor_scope_hash', v_actor_hash,
    'operation_source', 'admin_pos',
    'warehouse_id', p_warehouse_id,
    'branch_id', p_branch_id,
    'customer_id', p_customer_id,
    'customer_identity_hash', v_customer_identity_hash,
    'payment_method', v_payment_method,
    'order_discount_in_minor_units', COALESCE(p_discount_in_minor_units, 0),
    'amount_received_in_minor_units', COALESCE(p_amount_received_in_minor_units, 0),
    'lines', p_lines
  );
  v_canonical_request := public.phase3_canonicalize_sale_request_internal(v_request);
  v_fingerprint := public.phase3_request_fingerprint_internal(v_canonical_request);
  v_replay := public.phase3_resolve_operation_replay_internal(
    'phase3_pos_sale_v1', v_key, 'erp_user', v_actor_hash, v_fingerprint
  );
  IF v_replay->>'decision' = 'REPLAY' THEN
    RETURN v_replay->'result_snapshot';
  END IF;

  -- A key already consumed by V1 can never be reconstructed as a proven V2
  -- request.  Reject generically without exposing the historical order.
  IF EXISTS (
    SELECT 1 FROM public.orders existing_order
    WHERE existing_order.idempotency_key = v_key
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_IDEMPOTENCY_CONFLICT: Operation identity is unavailable.';
  END IF;

  PERFORM 1
  FROM public.warehouses warehouse
  WHERE warehouse.id = p_warehouse_id
    AND warehouse.branch_id = p_branch_id
    AND warehouse.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_LOCATION_INVALID: المستودع لا يتبع الفرع المحدد أو غير نشط.';
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT customer.full_name INTO v_customer_name
    FROM public.customers customer
    WHERE customer.id = p_customer_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_POS_CUSTOMER_INVALID: العميل المحدد غير موجود.';
    END IF;
  ELSIF v_payment_method = 'debt' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_DEBT_CUSTOMER_REQUIRED: البيع الآجل يحتاج عميلاً مسجلاً.';
  END IF;

  -- Shift precedes configuration/product/inventory locks throughout the paid
  -- operational paths and their reversal orchestrator.
  SELECT shift.id INTO v_shift_id
  FROM public.cash_shifts shift
  WHERE shift.branch_id = p_branch_id AND shift.status = 'open'
  ORDER BY shift.id
  LIMIT 1
  FOR SHARE;
  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_OPEN_SHIFT_REQUIRED: افتح وردية الصندوق قبل إتمام البيع.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines') candidate
    WHERE candidate->>'commercial_line_kind' = 'configurable_parcel'
  ) THEN
    PERFORM public.phase3_assert_configurable_parcel_creation_allowed_internal(
      'erp_user', v_user_id
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines') candidate
    WHERE COALESCE((candidate->>'line_discount_in_minor_units')::BIGINT, 0) <> 0
      OR candidate->>'price_authority' <> 'server_catalog'
      OR candidate->'commercial_unit_price_override_in_minor_units' <> 'null'::JSONB
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_PRICE_AUTHORITY_INVALID: هذا المسار يعتمد سعر الخادم وخصم الطلب الحالي فقط.';
  END IF;

  PERFORM public.parcel209_guard_modern_lines_internal(v_canonical_request->'lines');

  SELECT
    ARRAY_AGG(DISTINCT (candidate->>'parcel_configuration_id')::UUID
      ORDER BY (candidate->>'parcel_configuration_id')::UUID),
    ARRAY_AGG(DISTINCT (candidate->>'family_product_id')::UUID
      ORDER BY (candidate->>'family_product_id')::UUID)
  INTO v_configuration_ids, v_family_ids
  FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines') candidate
  WHERE candidate->>'commercial_line_kind' = 'configurable_parcel';

  IF COALESCE(CARDINALITY(v_configuration_ids), 0) > 0 THEN
    PERFORM configuration.id
    FROM public.product_parcel_configurations configuration
    WHERE configuration.id = ANY(v_configuration_ids)
    ORDER BY configuration.id
    FOR SHARE;

    PERFORM family.id
    FROM public.products family
    WHERE family.id = ANY(v_family_ids)
    ORDER BY family.id
    FOR SHARE;
  END IF;

  SELECT ARRAY_AGG(DISTINCT identity.product_id ORDER BY identity.product_id)
  INTO v_product_ids
  FROM (
    SELECT (candidate->>'product_id')::UUID AS product_id
    FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines') candidate
    WHERE candidate->>'commercial_line_kind' IN ('base_unit', 'legacy_single_sku_parcel')
    UNION ALL
    SELECT (component->>'product_id')::UUID
    FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines') candidate
    CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(candidate->'parcel_instances') parcel
    CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(parcel->'components') component
    WHERE candidate->>'commercial_line_kind' = 'configurable_parcel'
  ) identity;

  -- Family is commercial identity, never stock identity. Keep its shared
  -- snapshot lock ahead of the global stock-product hierarchy, but never pass
  -- it to the inventory helper (which would attempt a row-lock upgrade).
  PERFORM public.phase3_lock_inventory_products_internal(v_product_ids);

  -- Build a complete immutable plan before any business row is inserted.
  FOR v_line IN
    SELECT value FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines')
    ORDER BY value::TEXT
  LOOP
    v_line_sequence := v_line_sequence + 1;
    v_order_item_id := gen_random_uuid();
    v_line_kind := v_line->>'commercial_line_kind';
    v_plan_instances := '[]'::JSONB;
    v_unit_cost_exact := NULL;
    v_line_exact_cogs := NULL;

    IF v_line_kind = 'base_unit' THEN
      SELECT * INTO v_product FROM public.products
      WHERE id = (v_line->>'product_id')::UUID AND is_active;
      IF NOT FOUND OR v_product.is_flavor_master THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_POS_PRODUCT_INVALID: منتج الوحدة الأساسية غير صالح للبيع.';
      END IF;
      v_commercial_quantity := (v_line->>'base_quantity')::INTEGER;
      v_base_quantity := v_commercial_quantity;
      v_units_per_parcel := 1;
      v_unit_price := v_product.sale_price_in_minor_units;
      v_unit_cost_exact := COALESCE(v_product.wac_cost_in_minor_units_exact,
        v_product.cost_price_in_minor_units::NUMERIC);
      v_line_exact_cogs := ROUND(v_base_quantity::NUMERIC * v_unit_cost_exact, 6);
      -- Round once at the financial line boundary, never per physical unit.
      v_line_cogs := ROUND(v_line_exact_cogs)::BIGINT;
      SELECT COALESCE(unit.name_ar, 'وحدة') INTO v_base_unit_name
      FROM public.units unit WHERE unit.id = v_product.unit_id;
      v_base_unit_name := COALESCE(v_base_unit_name, 'وحدة');
      v_parcel_unit_name := v_base_unit_name;
    ELSIF v_line_kind = 'legacy_single_sku_parcel' THEN
      SELECT * INTO v_product FROM public.products
      WHERE id = (v_line->>'product_id')::UUID AND is_active;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_POS_PRODUCT_INVALID: منتج الطرد التجاري غير صالح للبيع.';
      END IF;
      IF v_product.units_per_sale_unit IS DISTINCT FROM
          (v_line->>'units_per_parcel')::INTEGER
        OR COALESCE(v_product.default_sale_price_in_minor_units, 0) <= 0
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_POS_PRICE_OR_PACKAGE_STALE: إعداد الطرد أو سعره تغير.';
      END IF;
      v_commercial_quantity := (v_line->>'parcel_quantity')::INTEGER;
      v_units_per_parcel := v_product.units_per_sale_unit;
      v_base_quantity := v_commercial_quantity::BIGINT * v_units_per_parcel::BIGINT;
      IF v_base_quantity > 2147483647 THEN
        RAISE EXCEPTION USING ERRCODE = '22003',
          MESSAGE = 'PHASE3_POS_QUANTITY_OVERFLOW: كمية الوحدات الأساسية تتجاوز الحد الآمن.';
      END IF;
      v_unit_price := v_product.default_sale_price_in_minor_units;
      v_unit_cost_exact := COALESCE(v_product.wac_cost_in_minor_units_exact,
        v_product.cost_price_in_minor_units::NUMERIC);
      v_line_exact_cogs := ROUND(v_base_quantity::NUMERIC * v_unit_cost_exact, 6);
      -- Round once at the financial line boundary, never per physical unit.
      v_line_cogs := ROUND(v_line_exact_cogs)::BIGINT;
      SELECT COALESCE(base_unit.name_ar, 'وحدة'), COALESCE(parcel_unit.name_ar, 'طرد')
      INTO v_base_unit_name, v_parcel_unit_name
      FROM public.products product
      LEFT JOIN public.units base_unit ON base_unit.id = product.unit_id
      LEFT JOIN public.units parcel_unit ON parcel_unit.id = product.sale_unit_id
      WHERE product.id = v_product.id;
    ELSE
      SELECT * INTO v_product FROM public.products
      WHERE id = (v_line->>'family_product_id')::UUID AND is_active;
      IF NOT FOUND OR NOT v_product.is_flavor_master
        OR COALESCE(v_product.default_sale_price_in_minor_units, 0) <= 0
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_POS_PRICE_OR_PACKAGE_STALE: عائلة الطرد أو سعرها غير صالح.';
      END IF;
      v_commercial_quantity := (v_line->>'parcel_quantity')::INTEGER;
      v_units_per_parcel := v_product.units_per_sale_unit;
      v_base_quantity := v_commercial_quantity::BIGINT * v_units_per_parcel::BIGINT;
      v_unit_price := v_product.default_sale_price_in_minor_units;
      v_line_cogs := 0;
      SELECT COALESCE(base_unit.name_ar, 'وحدة'), COALESCE(parcel_unit.name_ar, 'طرد')
      INTO v_base_unit_name, v_parcel_unit_name
      FROM public.products product
      LEFT JOIN public.units base_unit ON base_unit.id = product.unit_id
      LEFT JOIN public.units parcel_unit ON parcel_unit.id = product.sale_unit_id
      WHERE product.id = v_product.id;

      FOR v_instance IN
        SELECT value FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances')
        ORDER BY (value->>'instance_sequence')::INTEGER
      LOOP
        v_validated := public.phase3_validate_configurable_parcel_internal(
          'erp_user', v_user_id, (v_line->>'family_product_id')::UUID,
          (v_line->>'parcel_configuration_id')::UUID,
          (v_line->>'configuration_revision')::INTEGER,
          v_instance->'components'
        );
        v_cogs_allocation := public.phase3_allocate_parcel_cogs_internal(
          v_validated->'components'
        );
        v_parcel_instance_id := gen_random_uuid();
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
          'component_id', gen_random_uuid(),
          'product_id', validated_component->>'product_id',
          'base_quantity', (validated_component->>'base_quantity')::INTEGER,
          'product_name_snapshot', validated_component->>'product_name_snapshot',
          'sku_snapshot', validated_component->>'sku_snapshot',
          'base_unit_name_snapshot', COALESCE(
            NULLIF(validated_component->>'base_unit_name_snapshot', ''),
            v_base_unit_name
          ),
          'unit_cost_in_minor_units_exact',
            (validated_component->>'unit_cost_in_minor_units_exact')::NUMERIC(24,6),
          'exact_cogs_in_minor_units',
            (allocated_component->>'exact_cogs_in_minor_units')::NUMERIC,
          'allocated_cogs_in_minor_units',
            (allocated_component->>'allocated_cogs_in_minor_units')::BIGINT
        ) ORDER BY (validated_component->>'product_id')::UUID)
        INTO v_plan_components
        FROM JSONB_ARRAY_ELEMENTS(v_validated->'components') validated_component
        JOIN JSONB_ARRAY_ELEMENTS(v_cogs_allocation->'components') allocated_component
          ON allocated_component->>'product_id' = validated_component->>'product_id';

        v_line_cogs := v_line_cogs
          + (v_cogs_allocation->>'total_cogs_in_minor_units')::BIGINT;
        v_plan_instances := v_plan_instances || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
          'instance_id', v_parcel_instance_id,
          'instance_sequence', (v_instance->>'instance_sequence')::INTEGER,
          'configuration_revision', (v_line->>'configuration_revision')::INTEGER,
          'units_per_parcel', (v_validated->>'units_per_parcel')::INTEGER,
          'composition_fingerprint', v_validated->>'composition_fingerprint',
          'gross_amount_in_minor_units', v_unit_price,
          'allocated_discount_in_minor_units', 0,
          'net_refundable_amount_in_minor_units', v_unit_price,
          'cogs_in_minor_units',
            (v_cogs_allocation->>'total_cogs_in_minor_units')::BIGINT,
          'components', v_plan_components
        ));
      END LOOP;
    END IF;

    v_line_gross := v_commercial_quantity::BIGINT * v_unit_price;
    IF v_line_gross < 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22003',
        MESSAGE = 'PHASE3_POS_MONEY_OVERFLOW: إجمالي السطر تجاوز الحد الآمن.';
    END IF;
    v_subtotal := v_subtotal + v_line_gross;
    v_plan_lines := v_plan_lines || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
      'line_sequence', v_line_sequence,
      'order_item_id', v_order_item_id,
      'commercial_line_kind', v_line_kind,
      'product_id', v_product.id,
      'product_name_snapshot', v_product.name_ar,
      'sku_snapshot', v_product.sku,
      'family_product_id', CASE WHEN v_line_kind = 'configurable_parcel'
        THEN v_line->>'family_product_id' ELSE NULL END,
      'parcel_configuration_id', CASE WHEN v_line_kind = 'configurable_parcel'
        THEN v_line->>'parcel_configuration_id' ELSE NULL END,
      'configuration_revision', CASE WHEN v_line_kind = 'configurable_parcel'
        THEN (v_line->>'configuration_revision')::INTEGER ELSE NULL END,
      'commercial_quantity', v_commercial_quantity,
      'base_quantity', v_base_quantity,
      'units_per_parcel', v_units_per_parcel,
      'base_unit_name_snapshot', v_base_unit_name,
      'parcel_unit_name_snapshot', v_parcel_unit_name,
      'unit_price_in_minor_units', v_unit_price,
      'gross_amount_in_minor_units', v_line_gross,
      'unit_cost_snapshot_in_minor_units_exact', v_unit_cost_exact,
      'exact_cogs_snapshot_in_minor_units', v_line_exact_cogs,
      'cogs_in_minor_units', v_line_cogs,
      'unit_cost_in_minor_units', CASE WHEN v_base_quantity = 0 THEN 0
        ELSE ROUND(v_line_cogs::NUMERIC / v_base_quantity)::BIGINT END,
      'parcel_instances', v_plan_instances
    ));
  END LOOP;

  IF COALESCE(p_discount_in_minor_units, 0) > v_subtotal THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_DISCOUNT_EXCEEDS_SUBTOTAL: الخصم يتجاوز مجموع البيع.';
  END IF;
  v_total := v_subtotal - COALESCE(p_discount_in_minor_units, 0);
  IF v_payment_method = 'cash'
    AND COALESCE(p_amount_received_in_minor_units, 0) > 0
    AND p_amount_received_in_minor_units < v_total
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_TENDER_INSUFFICIENT: المبلغ النقدي المستلم أقل من الإجمالي.';
  END IF;

  SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
    'key', line->>'line_sequence',
    'weight', (line->>'gross_amount_in_minor_units')::BIGINT
  ) ORDER BY (line->>'line_sequence')::INTEGER)
  INTO v_line_weighted_keys
  FROM JSONB_ARRAY_ELEMENTS(v_plan_lines) line;

  FOR v_line IN
    SELECT value FROM JSONB_ARRAY_ELEMENTS(v_plan_lines)
    ORDER BY (value->>'line_sequence')::INTEGER
  LOOP
    SELECT allocated_amount INTO v_line_discount
    FROM public.phase2_allocate_largest_remainder_internal(
      COALESCE(p_discount_in_minor_units, 0), v_line_weighted_keys
    ) allocation
    WHERE allocation.allocation_key = v_line->>'line_sequence';
    v_line_discount := COALESCE(v_line_discount, 0);
    v_line_gross := (v_line->>'gross_amount_in_minor_units')::BIGINT;
    v_line_cogs := (v_line->>'cogs_in_minor_units')::BIGINT;
    v_line_net := v_line_gross - v_line_discount;
    v_line_profit := v_line_net - v_line_cogs;
    v_final_instances := v_line->'parcel_instances';

    IF v_line->>'commercial_line_kind' = 'configurable_parcel' THEN
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'key', instance->>'instance_sequence',
        'weight', (instance->>'gross_amount_in_minor_units')::BIGINT
      ) ORDER BY (instance->>'instance_sequence')::INTEGER)
      INTO v_instance_weighted_keys
      FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances') instance;

      v_final_instances := '[]'::JSONB;
      FOR v_instance IN
        SELECT value FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances')
        ORDER BY (value->>'instance_sequence')::INTEGER
      LOOP
        SELECT allocated_amount INTO v_instance_discount
        FROM public.phase2_allocate_largest_remainder_internal(
          v_line_discount, v_instance_weighted_keys
        ) allocation
        WHERE allocation.allocation_key = v_instance->>'instance_sequence';
        v_instance_discount := COALESCE(v_instance_discount, 0);
        v_final_instances := v_final_instances || JSONB_BUILD_ARRAY(
          v_instance || JSONB_BUILD_OBJECT(
            'allocated_discount_in_minor_units', v_instance_discount,
            'net_refundable_amount_in_minor_units',
              (v_instance->>'gross_amount_in_minor_units')::BIGINT
                - v_instance_discount
          )
        );
      END LOOP;
    END IF;

    v_final_lines := v_final_lines || JSONB_BUILD_ARRAY(
      v_line || JSONB_BUILD_OBJECT(
        'allocated_discount_in_minor_units', v_line_discount,
        'net_refundable_amount_in_minor_units', v_line_net,
        'profit_in_minor_units', v_line_profit,
        'parcel_instances', v_final_instances
      )
    );
  END LOOP;

  IF (SELECT COALESCE(SUM((line->>'allocated_discount_in_minor_units')::BIGINT), 0)
      FROM JSONB_ARRAY_ELEMENTS(v_final_lines) line)
      IS DISTINCT FROM COALESCE(p_discount_in_minor_units, 0)
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_DISCOUNT_RECONCILIATION_FAILED: تعذر توزيع الخصم بدقة.';
  END IF;

  -- Authoritative stock is rechecked only after every relevant balance is
  -- locked by the shared Phase-2/3 product protocol.
  FOR v_demand IN
    WITH demand AS (
      SELECT (line->>'product_id')::UUID AS product_id,
        (line->>'base_quantity')::INTEGER AS quantity
      FROM JSONB_ARRAY_ELEMENTS(v_final_lines) line
      WHERE line->>'commercial_line_kind' <> 'configurable_parcel'
      UNION ALL
      SELECT (component->>'product_id')::UUID,
        (component->>'base_quantity')::INTEGER
      FROM JSONB_ARRAY_ELEMENTS(v_final_lines) line
      CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(line->'parcel_instances') instance
      CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(instance->'components') component
      WHERE line->>'commercial_line_kind' = 'configurable_parcel'
    )
    SELECT product_id, SUM(quantity)::INTEGER AS quantity
    FROM demand GROUP BY product_id ORDER BY product_id
  LOOP
    SELECT balance.on_hand_quantity, balance.reserved_quantity
    INTO v_on_hand, v_reserved
    FROM public.inventory_balances balance
    WHERE balance.warehouse_id = p_warehouse_id
      AND balance.product_id = v_demand.product_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PARCEL_COMPONENT_NOT_STOCKED: أحد مكونات البيع لا يملك رصيدًا في المستودع.';
    END IF;
    IF v_on_hand - v_reserved < v_demand.quantity THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_POS_INSUFFICIENT_INVENTORY: مخزون أحد مكونات البيع غير كافٍ.';
    END IF;
  END LOOP;

  v_paid := CASE WHEN v_payment_method = 'debt' THEN 0 ELSE v_total END;
  v_change := CASE WHEN v_payment_method = 'cash' THEN GREATEST(
    COALESCE(p_amount_received_in_minor_units, v_total) - v_total, 0
  ) ELSE 0 END;
  -- The private exchange coordinator can still fail after issuing this sale.
  -- Bind its visible number to the new operation UUID, not a nontransactional
  -- business sequence. Ordinary POS numbering remains exactly unchanged.
  v_order_number := 'POS-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-X'
    || UPPER(REPLACE(v_operation_id::TEXT,'-',''));

  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
    'id', line->>'order_item_id',
    'productId', line->>'product_id',
    'productName', line->>'product_name_snapshot',
    'sku', line->>'sku_snapshot',
    'commercialLineKind', line->>'commercial_line_kind',
    'quantity', (line->>'commercial_quantity')::INTEGER,
    'baseQuantity', (line->>'base_quantity')::BIGINT,
    'unitsPerSalePackage', (line->>'units_per_parcel')::INTEGER,
    'salePackage', line->>'parcel_unit_name_snapshot',
    'unitPriceInMinorUnits', (line->>'unit_price_in_minor_units')::BIGINT,
    'lineTotalInMinorUnits', (line->>'gross_amount_in_minor_units')::BIGINT,
    'allocatedDiscountInMinorUnits',
      (line->>'allocated_discount_in_minor_units')::BIGINT,
    'netRefundableAmountInMinorUnits',
      (line->>'net_refundable_amount_in_minor_units')::BIGINT,
    'cogsInMinorUnits', (line->>'cogs_in_minor_units')::BIGINT,
    'profitInMinorUnits', (line->>'profit_in_minor_units')::BIGINT,
    'parcelInstances', line->'parcel_instances'
  ) ORDER BY (line->>'line_sequence')::INTEGER), '[]'::JSONB)
  INTO v_result_items
  FROM JSONB_ARRAY_ELEMENTS(v_final_lines) line;

  v_result := JSONB_BUILD_OBJECT(
    'success', true,
    'idempotentReplay', false,
    'operationId', v_operation_id,
    'orderId', v_order_id,
    'orderNumber', v_order_number,
    'customerName', v_customer_name,
    'warehouseId', p_warehouse_id,
    'branchId', p_branch_id,
    'cashShiftId', v_shift_id,
    'subtotalInMinorUnits', v_subtotal,
    'discountInMinorUnits', COALESCE(p_discount_in_minor_units, 0),
    'totalInMinorUnits', v_total,
    'amountPaidInMinorUnits', v_paid,
    'changeDueInMinorUnits', v_change,
    'paymentMethod', v_payment_method,
    'paymentStatus', CASE WHEN v_payment_method = 'debt' THEN 'unpaid' ELSE 'paid' END,
    'items', v_result_items,
    'message', 'تم حفظ بيع نقطة البيع بالإصدار المحمي وخصم الوحدات الأساسية بدقة.'
  );

  INSERT INTO public.business_operations (
    id, operation_type, idempotency_key, request_fingerprint, initiated_by,
    result_snapshot, completed_at, request_identity_version,
    request_identity_snapshot, actor_scope_type, actor_scope_hash
  ) VALUES (
    v_operation_id, 'phase3_pos_sale_v1', v_key, v_fingerprint, v_user_id,
    v_result, NOW(), 301, v_canonical_request, 'erp_user', v_actor_hash
  );

  BEGIN
    INSERT INTO public.orders (
      id, order_number, customer_id, customer_name_snapshot, branch_id,
      warehouse_id, status, payment_method, payment_status,
      subtotal_in_minor_units, delivery_fee_in_minor_units,
      discount_in_minor_units, total_in_minor_units,
      amount_paid_in_minor_units, change_due_in_minor_units,
      internal_notes, source, idempotency_key, operation_id
    ) VALUES (
      v_order_id, v_order_number, p_customer_id, v_customer_name, p_branch_id,
      p_warehouse_id, 'completed', v_payment_method,
      CASE WHEN v_payment_method = 'debt' THEN 'unpaid' ELSE 'paid' END,
      v_subtotal, 0, COALESCE(p_discount_in_minor_units, 0), v_total,
      v_paid, v_change, 'بيع POS V2 محمي', 'pos', v_key, v_operation_id
    );
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
    IF v_constraint_name = 'idx_orders_idempotency_key' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_IDEMPOTENCY_CONFLICT: Operation identity is unavailable.';
    END IF;
    RAISE;
  END;

  FOR v_line IN
    SELECT value FROM JSONB_ARRAY_ELEMENTS(v_final_lines)
    ORDER BY (value->>'line_sequence')::INTEGER
  LOOP
    INSERT INTO public.order_items (
      id, order_id, product_id, product_name_snapshot, sku_snapshot,
      quantity, unit_price_in_minor_units, line_total_in_minor_units,
      unit_cost_in_minor_units, cogs_in_minor_units, profit_in_minor_units,
      sale_package_quantity, units_per_sale_package,
      sale_package_name_snapshot, sale_package_price_in_minor_units,
      commercial_line_kind, family_product_id, parcel_configuration_id,
      parcel_configuration_revision, base_unit_name_snapshot,
      allocated_discount_snapshot_in_minor_units,
      net_refundable_amount_snapshot_in_minor_units,
      unit_cost_snapshot_in_minor_units_exact, exact_cogs_snapshot_in_minor_units,
      cost_finalized_at
    ) VALUES (
      (v_line->>'order_item_id')::UUID, v_order_id,
      (v_line->>'product_id')::UUID, v_line->>'product_name_snapshot',
      v_line->>'sku_snapshot',
      CASE WHEN v_line->>'commercial_line_kind' = 'configurable_parcel'
        THEN (v_line->>'commercial_quantity')::INTEGER
        ELSE (v_line->>'base_quantity')::INTEGER END,
      (v_line->>'unit_price_in_minor_units')::BIGINT,
      (v_line->>'gross_amount_in_minor_units')::BIGINT,
      (v_line->>'unit_cost_in_minor_units')::BIGINT,
      (v_line->>'cogs_in_minor_units')::BIGINT,
      (v_line->>'profit_in_minor_units')::BIGINT,
      (v_line->>'commercial_quantity')::INTEGER,
      (v_line->>'units_per_parcel')::INTEGER,
      v_line->>'parcel_unit_name_snapshot',
      (v_line->>'unit_price_in_minor_units')::BIGINT,
      v_line->>'commercial_line_kind',
      NULLIF(v_line->>'family_product_id', '')::UUID,
      NULLIF(v_line->>'parcel_configuration_id', '')::UUID,
      NULLIF(v_line->>'configuration_revision', '')::INTEGER,
      v_line->>'base_unit_name_snapshot',
      (v_line->>'allocated_discount_in_minor_units')::BIGINT,
      (v_line->>'net_refundable_amount_in_minor_units')::BIGINT,
      (v_line->>'unit_cost_snapshot_in_minor_units_exact')::NUMERIC(24,6),
      (v_line->>'exact_cogs_snapshot_in_minor_units')::NUMERIC(30,6),
      CASE WHEN v_line->>'commercial_line_kind' IN ('base_unit','legacy_single_sku_parcel')
        THEN clock_timestamp() ELSE NULL END
    );

    -- The legacy insert trigger snapshots product cost.  Replace that draft
    -- value before any Parcel child exists, using the already planned COGS.
    UPDATE public.order_items
    SET unit_cost_in_minor_units = (v_line->>'unit_cost_in_minor_units')::BIGINT,
      cogs_in_minor_units = (v_line->>'cogs_in_minor_units')::BIGINT,
      profit_in_minor_units = (v_line->>'profit_in_minor_units')::BIGINT
    WHERE id = (v_line->>'order_item_id')::UUID;

    IF v_line->>'commercial_line_kind' = 'configurable_parcel' THEN
      FOR v_instance IN
        SELECT value FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances')
        ORDER BY (value->>'instance_sequence')::INTEGER
      LOOP
        INSERT INTO public.order_parcel_instances (
          id, order_item_id, order_id, operation_id, parcel_configuration_id,
          family_product_id, instance_sequence, configuration_revision,
          units_per_parcel_snapshot, parcel_unit_name_snapshot,
          gross_amount_snapshot_in_minor_units,
          allocated_discount_snapshot_in_minor_units,
          net_refundable_amount_snapshot_in_minor_units,
          cogs_snapshot_in_minor_units, composition_fingerprint
        ) VALUES (
          (v_instance->>'instance_id')::UUID,
          (v_line->>'order_item_id')::UUID, v_order_id, v_operation_id,
          (v_line->>'parcel_configuration_id')::UUID,
          (v_line->>'family_product_id')::UUID,
          (v_instance->>'instance_sequence')::INTEGER,
          (v_instance->>'configuration_revision')::INTEGER,
          (v_instance->>'units_per_parcel')::INTEGER,
          v_line->>'parcel_unit_name_snapshot',
          (v_instance->>'gross_amount_in_minor_units')::BIGINT,
          (v_instance->>'allocated_discount_in_minor_units')::BIGINT,
          (v_instance->>'net_refundable_amount_in_minor_units')::BIGINT,
          (v_instance->>'cogs_in_minor_units')::BIGINT,
          v_instance->>'composition_fingerprint'
        );

        FOR v_component IN
          SELECT value FROM JSONB_ARRAY_ELEMENTS(v_instance->'components')
          ORDER BY (value->>'product_id')::UUID
        LOOP
          INSERT INTO public.order_parcel_components (
            id, parcel_instance_id, operation_id, product_id, base_quantity,
            product_name_snapshot, sku_snapshot, base_unit_name_snapshot,
            unit_cost_snapshot_in_minor_units, cogs_snapshot_in_minor_units
          ) VALUES (
            (v_component->>'component_id')::UUID,
            (v_instance->>'instance_id')::UUID, v_operation_id,
            (v_component->>'product_id')::UUID,
            (v_component->>'base_quantity')::INTEGER,
            v_component->>'product_name_snapshot', v_component->>'sku_snapshot',
            v_component->>'base_unit_name_snapshot',
            (v_component->>'unit_cost_in_minor_units_exact')::NUMERIC(24,6),
            (v_component->>'allocated_cogs_in_minor_units')::BIGINT
          );
        END LOOP;
        PERFORM public.finalize_order_parcel_instance_internal(
          (v_instance->>'instance_id')::UUID
        );
      END LOOP;
    END IF;
  END LOOP;

  -- Apply the planned stock effects in deterministic commercial/component
  -- order.  Every balance was already checked and locked above.
  FOR v_line IN
    SELECT value FROM JSONB_ARRAY_ELEMENTS(v_final_lines)
    ORDER BY (value->>'line_sequence')::INTEGER
  LOOP
    IF v_line->>'commercial_line_kind' <> 'configurable_parcel' THEN
      v_movement_quantity := (v_line->>'base_quantity')::INTEGER;
      SELECT on_hand_quantity INTO v_on_hand
      FROM public.inventory_balances
      WHERE warehouse_id = p_warehouse_id
        AND product_id = (v_line->>'product_id')::UUID
      FOR UPDATE;
      v_balance_after := v_on_hand - v_movement_quantity;
      UPDATE public.inventory_balances
      SET on_hand_quantity = v_balance_after, updated_at = NOW()
      WHERE warehouse_id = p_warehouse_id
        AND product_id = (v_line->>'product_id')::UUID;
      INSERT INTO public.inventory_movements (
        warehouse_id, product_id, movement_type, quantity,
        balance_before, balance_after, reference_type, reference_id,
        notes, created_by, operation_id
      ) VALUES (
        p_warehouse_id, (v_line->>'product_id')::UUID,
        'sales_deduction', -v_movement_quantity, v_on_hand, v_balance_after,
        'pos_sale', v_order_id, 'بيع POS V2 رقم ' || v_order_number,
        v_user_id, v_operation_id
      );
    ELSE
      FOR v_instance IN
        SELECT value FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances')
        ORDER BY (value->>'instance_sequence')::INTEGER
      LOOP
        FOR v_component IN
          SELECT value FROM JSONB_ARRAY_ELEMENTS(v_instance->'components')
          ORDER BY (value->>'product_id')::UUID
        LOOP
          v_movement_quantity := (v_component->>'base_quantity')::INTEGER;
          SELECT on_hand_quantity INTO v_on_hand
          FROM public.inventory_balances
          WHERE warehouse_id = p_warehouse_id
            AND product_id = (v_component->>'product_id')::UUID
          FOR UPDATE;
          v_balance_after := v_on_hand - v_movement_quantity;
          UPDATE public.inventory_balances
          SET on_hand_quantity = v_balance_after, updated_at = NOW()
          WHERE warehouse_id = p_warehouse_id
            AND product_id = (v_component->>'product_id')::UUID;
          INSERT INTO public.inventory_movements (
            warehouse_id, product_id, movement_type, quantity,
            balance_before, balance_after, reference_type, reference_id,
            notes, created_by, operation_id, parcel_component_id
          ) VALUES (
            p_warehouse_id, (v_component->>'product_id')::UUID,
            'sales_deduction', -v_movement_quantity, v_on_hand, v_balance_after,
            'pos_sale', v_order_id, 'مكوّن طرد POS V2 رقم ' || v_order_number,
            v_user_id, v_operation_id, (v_component->>'component_id')::UUID
          );
        END LOOP;
      END LOOP;
    END IF;
  END LOOP;

  INSERT INTO public.order_status_history (
    order_id, old_status, new_status, changed_by, notes
  ) VALUES (
    v_order_id, NULL, 'completed', v_user_id,
    'بيع POS V2 مكتمل وخصم ذري للوحدات الأساسية'
  );

  INSERT INTO public.audit_logs (
    user_id, action, entity_name, entity_id, details
  ) VALUES (
    v_user_id, 'CREATE_POS_SALE_V2', 'orders', v_order_id,
    JSONB_BUILD_OBJECT(
      'operation_id', v_operation_id,
      'order_number', v_order_number,
      'cash_shift_id', v_shift_id,
      'subtotal_in_minor_units', v_subtotal,
      'discount_in_minor_units', COALESCE(p_discount_in_minor_units, 0),
      'total_in_minor_units', v_total,
      'commercial_lines', JSONB_ARRAY_LENGTH(v_final_lines)
    )
  );

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tb215_exchange_return_internal(p_order_id uuid, p_idempotency_key text, p_items jsonb, p_reason text, p_refund_method text DEFAULT NULL::text, p_reference_number text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
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
  v_order_item public.order_items%ROWTYPE;
  v_instance public.order_parcel_instances%ROWTYPE;
  v_component_row public.order_parcel_components%ROWTYPE;
  v_creation_type TEXT;
  v_completion_at TIMESTAMPTZ;
  v_shift_id UUID;
  v_product_ids UUID[];
  v_item JSONB;
  v_component JSONB;
  v_prepared_items JSONB := '[]'::JSONB;
  v_prepared_components JSONB;
  v_inventory_sources JSONB := '[]'::JSONB;
  v_operation_id UUID := gen_random_uuid();
  v_return_event_id UUID := gen_random_uuid();
  v_return_item_id UUID;
  v_return_number TEXT;
  v_scope TEXT;
  v_quantity INTEGER;
  v_accepted INTEGER;
  v_rejected INTEGER;
  v_accepted_total INTEGER;
  v_rejected_total INTEGER;
  v_actual_component_count INTEGER;
  v_prior_quantity INTEGER;
  v_prior_refund BIGINT;
  v_prior_cogs BIGINT;
  v_new_cumulative INTEGER;
  v_target_refund BIGINT;
  v_target_cogs BIGINT;
  v_item_refund BIGINT;
  v_item_cogs BIGINT;
  v_unit_cost_exact NUMERIC(24, 6);
  v_historical_value NUMERIC(30, 6);
  v_raw_damage BIGINT;
  v_applied_damage BIGINT;
  v_item_stock_disposition TEXT;
  v_total_entitlement BIGINT := 0;
  v_total_raw_damage BIGINT := 0;
  v_total_applied_damage BIGINT := 0;
  v_financial RECORD;
  v_debt_reduction BIGINT;
  v_money_refund BIGINT;
  v_method TEXT;
  v_reference TEXT;
  v_result JSONB;
  v_inventory_result JSONB;
  v_now TIMESTAMPTZ;
BEGIN
  PERFORM public.tb215_assert_exchange_return_admission_internal(p_order_id,p_idempotency_key,p_items,p_reason,p_refund_method,p_reference_number,p_notes);
  -- Authorization deliberately precedes replay and every business lock.
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin'], 'تسوية مرتجع مبيعات Phase 4.2'
  );
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'PHASE42_ACTOR_REQUIRED: Authenticated ERP actor is required.';
  END IF;

  v_key := public.phase4_canonicalize_idempotency_key_internal(
    p_idempotency_key
  );
  v_canonical := public.tb215_exchange_canonical_return_internal(
    p_order_id, p_items, p_reason, p_refund_method,
    p_reference_number, p_notes
  );
  v_actor_hash := public.phase3_actor_scope_hash_internal(
    'erp_user', v_user_id, NULL, NULL
  );
  v_fingerprint := public.phase3_request_fingerprint_internal(v_canonical);

  -- A committed operation is immutable truth and replays before 48-hour,
  -- Shift, payment, inventory or any other current-state eligibility check.
  v_replay := public.phase4_resolve_operation_replay_internal(
    'phase4_return_v1', v_key, v_actor_hash, v_fingerprint
  );
  IF v_replay->>'decision' = 'REPLAY' THEN
    RETURN v_replay->'result_snapshot';
  END IF;

  v_method := v_canonical->>'refund_method';
  v_reference := v_canonical->>'reference_number';
  v_shift_id := public.phase4_lock_customer_order_context_internal(
    p_order_id, v_method IS NOT NULL, false
  );

  SELECT customer_order.* INTO v_order
  FROM public.orders customer_order
  WHERE customer_order.id = p_order_id
  FOR UPDATE;
  IF NOT FOUND OR v_order.status IS DISTINCT FROM 'completed'
    OR v_order.branch_id IS NULL OR v_order.warehouse_id IS NULL
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE42_ORIGINAL_SALE_INVALID: Return requires one completed sale with branch and warehouse evidence.';
  END IF;
  SELECT operation.operation_type INTO v_creation_type
  FROM public.business_operations operation
  WHERE operation.id = v_order.operation_id
  FOR SHARE;
  IF v_creation_type IS NULL OR v_creation_type NOT IN (
    'phase3_pos_sale_v1', 'phase3_customer_reservation_v1'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE42_SALE_CONTRACT_UNSUPPORTED: Only proven Phase-3 POS V2 and Customer V2 sales use this coordinator.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM JSONB_ARRAY_ELEMENTS(v_canonical->'items') item
    GROUP BY item->>'return_scope', item->>'order_item_id',
      COALESCE(item->>'parcel_instance_id', '')
    HAVING COUNT(*) > 1
  ) OR EXISTS (
    SELECT 1
    FROM JSONB_ARRAY_ELEMENTS(v_canonical->'items') item
    CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(
      COALESCE(item->'components', '[]'::JSONB)
    ) component
    GROUP BY component->>'parcel_component_id'
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE42_RETURN_IDENTITY_DUPLICATE: Return source identities must be unique.';
  END IF;

  SELECT ARRAY_AGG(product_id ORDER BY product_id) INTO v_product_ids
  FROM (
    SELECT DISTINCT order_item.product_id
    FROM JSONB_ARRAY_ELEMENTS(v_canonical->'items') item
    JOIN public.order_items order_item
      ON order_item.id = (item->>'order_item_id')::UUID
      AND order_item.order_id = p_order_id
    WHERE item->>'return_scope' = 'base_unit'
    UNION
    SELECT DISTINCT parcel_component.product_id
    FROM JSONB_ARRAY_ELEMENTS(v_canonical->'items') item
    CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(
      COALESCE(item->'components', '[]'::JSONB)
    ) component
    JOIN public.order_parcel_components parcel_component
      ON parcel_component.id = (component->>'parcel_component_id')::UUID
    JOIN public.order_parcel_instances parcel_instance
      ON parcel_instance.id = parcel_component.parcel_instance_id
      AND parcel_instance.order_id = p_order_id
    WHERE item->>'return_scope' = 'parcel_instance'
  ) products
  WHERE product_id IS NOT NULL;
  IF COALESCE(CARDINALITY(v_product_ids), 0) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE42_RETURN_PRODUCTS_UNPROVEN: No authoritative returned SKU set was found.';
  END IF;
  PERFORM public.phase2_lock_inventory_products_internal(v_product_ids);

  v_completion_at := public.phase4_authoritative_completion_internal(p_order_id);
  IF clock_timestamp() > v_completion_at + INTERVAL '48 hours' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_RETURN_WINDOW_EXPIRED: A new Return cannot be settled after the original 48-hour window.';
  END IF;

  FOR v_item IN
    SELECT value FROM JSONB_ARRAY_ELEMENTS(v_canonical->'items')
    ORDER BY value->>'order_item_id', value->>'return_scope',
      COALESCE(value->>'parcel_instance_id', '')
  LOOP
    v_scope := v_item->>'return_scope';
    SELECT order_item.* INTO v_order_item
    FROM public.order_items order_item
    WHERE order_item.id = (v_item->>'order_item_id')::UUID
      AND order_item.order_id = p_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '23503',
        MESSAGE = 'PHASE42_ORDER_ITEM_INVALID: Return item does not belong to the locked sale.';
    END IF;
    v_return_item_id := gen_random_uuid();

    IF v_scope = 'base_unit' THEN
      v_quantity := (v_item->>'quantity')::INTEGER;
      PERFORM public.package_d_assert_whole_single_sku_quantity_internal(v_order_item.id,v_quantity);
      IF v_order_item.commercial_line_kind IS NULL OR v_order_item.commercial_line_kind NOT IN ('base_unit','legacy_single_sku_parcel')
        OR v_order_item.product_id IS NULL
        OR v_order_item.quantity <= 0
        OR v_order_item.net_refundable_amount_snapshot_in_minor_units IS NULL
        OR v_order_item.cogs_in_minor_units IS NULL
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE42_BASE_SALE_EVIDENCE_MISSING: Base Unit sale evidence is incomplete.';
      END IF;

      SELECT COALESCE(SUM(item.returned_quantity), 0)::INTEGER,
        COALESCE(SUM(item.refund_amount_snapshot_in_minor_units + item.applied_customer_damage_deduction_in_minor_units), 0)::BIGINT,
        COALESCE(SUM(item.original_cogs_snapshot_in_minor_units), 0)::BIGINT
      INTO v_prior_quantity, v_prior_refund, v_prior_cogs
      FROM public.sales_return_items item
      JOIN public.sales_return_events event
        ON event.id = item.sales_return_event_id
      WHERE item.order_item_id = v_order_item.id
        AND item.return_scope = 'base_unit'
        AND event.settlement_status = 'settled';
      v_new_cumulative := v_prior_quantity + v_quantity;
      IF v_new_cumulative > v_order_item.quantity THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED: Requested Base Unit quantity exceeds remaining Return capacity.';
      END IF;
      v_target_refund := CASE WHEN v_new_cumulative = v_order_item.quantity
        THEN v_order_item.net_refundable_amount_snapshot_in_minor_units
        ELSE FLOOR(
          v_order_item.net_refundable_amount_snapshot_in_minor_units::NUMERIC
            * v_new_cumulative::NUMERIC / v_order_item.quantity::NUMERIC
        )::BIGINT END;
      v_target_cogs := CASE WHEN v_new_cumulative = v_order_item.quantity
        THEN v_order_item.cogs_in_minor_units
        ELSE FLOOR(v_order_item.cogs_in_minor_units::NUMERIC
          * v_new_cumulative::NUMERIC / v_order_item.quantity::NUMERIC
        )::BIGINT END;
      v_item_refund := v_target_refund - v_prior_refund;
      v_item_cogs := v_target_cogs - v_prior_cogs;
      v_rejected := COALESCE((v_item->>'customer_damage_quantity')::INTEGER,0);
      v_accepted := v_quantity-v_rejected;
      -- One inspected damaged carton per logical item prevents one carton's
      -- damage from consuming another carton's refundable entitlement.
      IF v_rejected>0 AND v_quantity IS DISTINCT FROM v_order_item.units_per_sale_package THEN
        RAISE EXCEPTION USING ERRCODE='22023',
          MESSAGE='PACKAGE_D_CARTON_DAMAGE_INSPECT_ONE: افحص ضرر العميل بمرتجع مستقل لكل كرتونة حتى يبقى الخصم ضمن استحقاقها الأصلي.';
      END IF;
      IF v_rejected>0 AND v_order_item.commercial_line_kind IS DISTINCT FROM 'legacy_single_sku_parcel' THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PACKAGE_D_CARTON_INSPECTION_INVALID: Damage inspection requires a carton.';
      END IF;
      IF v_rejected>0 AND v_order_item.effective_standalone_unit_sale_price_snapshot_in_minor_units IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='P0001',
          MESSAGE='PACKAGE_D_CARTON_DAMAGE_PRICE_MISSING: هذا البيع القديم لا يحتوي سعر القطعة التاريخي؛ لا يمكن تسوية ضرر العميل. مرتجع السليم وعيب المورد متاحان.';
      END IF;
      v_raw_damage := v_rejected::BIGINT*COALESCE(v_order_item.effective_standalone_unit_sale_price_snapshot_in_minor_units,0);
      v_applied_damage := LEAST(v_item_refund,v_raw_damage);
      v_item_refund := v_item_refund-v_applied_damage;
      IF v_item_refund < 0 OR v_item_cogs < 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE42_CUMULATIVE_ALLOCATION_INVALID: Historical partial allocations are contradictory.';
      END IF;

      IF v_creation_type = 'phase3_customer_reservation_v1' THEN
        IF v_order_item.unit_cost_snapshot_in_minor_units_exact IS NULL
          OR v_order_item.exact_cogs_snapshot_in_minor_units IS NULL
          OR v_order_item.cost_finalized_at IS NULL
        THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'PHASE42_HISTORICAL_COST_MISSING: Customer V2 exact historical cost is missing.';
        END IF;
        v_unit_cost_exact := v_order_item.unit_cost_snapshot_in_minor_units_exact;
      ELSE
        IF v_order_item.unit_cost_in_minor_units IS NULL THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'PHASE42_HISTORICAL_COST_MISSING: POS V2 historical cost is missing.';
        END IF;
        v_unit_cost_exact := COALESCE(v_order_item.unit_cost_snapshot_in_minor_units_exact,
          v_order_item.unit_cost_in_minor_units::NUMERIC);
      END IF;
      v_item_stock_disposition := v_item->>'stock_disposition';
      IF v_item_stock_disposition = 'restock' AND v_accepted>0 THEN
        v_historical_value := ROUND(v_unit_cost_exact * v_accepted, 6);
        v_inventory_sources := v_inventory_sources || JSONB_BUILD_ARRAY(
          JSONB_BUILD_OBJECT(
            'source_kind', 'base_order_item',
            'source_id', v_order_item.id,
            'return_item_id', v_return_item_id,
            'product_id', v_order_item.product_id,
            'quantity', v_accepted,
            'historical_value_exact', v_historical_value
          )
        );
      END IF;

      v_prepared_items := v_prepared_items || JSONB_BUILD_ARRAY(
        JSONB_BUILD_OBJECT(
          'id', v_return_item_id,
          'return_scope', 'base_unit',
          'order_item_id', v_order_item.id,
          'product_id', v_order_item.product_id,
          'returned_quantity', v_quantity,
          'refund_amount', v_item_refund,
          'stock_disposition', v_item_stock_disposition,
          'accepted_quantity', v_accepted,
          'rejected_quantity', v_rejected,
          'original_cogs', v_item_cogs,
          'raw_damage', v_raw_damage,
          'applied_damage', v_applied_damage,
          'components', '[]'::JSONB
        )
      );
      v_total_entitlement := v_total_entitlement + v_item_refund;
      v_total_raw_damage := v_total_raw_damage + v_raw_damage;
      v_total_applied_damage := v_total_applied_damage + v_applied_damage;
    ELSE
      SELECT instance.* INTO v_instance
      FROM public.order_parcel_instances instance
      WHERE instance.id = (v_item->>'parcel_instance_id')::UUID
        AND instance.order_item_id = v_order_item.id
        AND instance.order_id = p_order_id
      FOR UPDATE;
      IF NOT FOUND
        OR v_order_item.commercial_line_kind IS DISTINCT FROM 'configurable_parcel'
        OR v_instance.finalized_at IS NULL
        OR v_instance.net_refundable_amount_snapshot_in_minor_units IS NULL
        OR v_instance.cogs_snapshot_in_minor_units IS NULL
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE42_PARCEL_SALE_EVIDENCE_MISSING: Parcel sale evidence is incomplete.';
      END IF;
      SELECT COUNT(*)::INTEGER INTO v_actual_component_count
      FROM public.order_parcel_components component
      WHERE component.parcel_instance_id = v_instance.id;
      IF v_actual_component_count IS DISTINCT FROM
          JSONB_ARRAY_LENGTH(v_item->'components') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE42_PARCEL_INSPECTION_INCOMPLETE: Every historical Parcel Component must be classified.';
      END IF;

      v_prepared_components := '[]'::JSONB;
      v_accepted_total := 0;
      v_rejected_total := 0;
      v_raw_damage := 0;
      v_item_stock_disposition := 'damaged';
      FOR v_component IN
        SELECT value FROM JSONB_ARRAY_ELEMENTS(v_item->'components')
        ORDER BY value->>'parcel_component_id'
      LOOP
        SELECT component.* INTO v_component_row
        FROM public.order_parcel_components component
        WHERE component.id = (v_component->>'parcel_component_id')::UUID
          AND component.parcel_instance_id = v_instance.id
        FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION USING ERRCODE = '23503',
            MESSAGE = 'PHASE42_PARCEL_COMPONENT_INVALID: Component does not belong to the returned Parcel.';
        END IF;
        v_accepted := (v_component->>'accepted_quantity')::INTEGER;
        v_rejected := (v_component->>'rejected_quantity')::INTEGER;
        IF v_accepted + v_rejected IS DISTINCT FROM v_component_row.base_quantity
          OR (v_rejected > 0 AND
            v_component_row.effective_standalone_unit_sale_price_snapshot_in_minor_units
              IS NULL)
        THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'PHASE42_PARCEL_COMPONENT_EVIDENCE_INVALID: Component quantity or historical effective standalone price is missing.';
        END IF;
        IF v_creation_type = 'phase3_customer_reservation_v1'
          AND (v_component_row.exact_cogs_snapshot_in_minor_units IS NULL
            OR v_component_row.cost_finalized_at IS NULL)
        THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'PHASE42_HISTORICAL_COST_MISSING: Customer V2 Parcel exact historical cost is missing.';
        END IF;
        v_accepted_total := v_accepted_total + v_accepted;
        v_rejected_total := v_rejected_total + v_rejected;
        v_raw_damage := v_raw_damage + v_rejected::BIGINT
          * COALESCE(
            v_component_row.effective_standalone_unit_sale_price_snapshot_in_minor_units,
            0
          );
        IF v_accepted > 0
          AND v_component->>'accepted_condition' = 'sellable'
          AND v_component->>'accepted_stock_disposition' = 'restock'
        THEN
          v_item_stock_disposition := 'restock';
          v_unit_cost_exact := CASE
            WHEN v_component_row.exact_cogs_snapshot_in_minor_units IS NOT NULL
              THEN ROUND(v_component_row.exact_cogs_snapshot_in_minor_units
                / v_component_row.base_quantity::NUMERIC, 6)
            ELSE v_component_row.unit_cost_snapshot_in_minor_units
          END;
          IF v_unit_cost_exact IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001',
              MESSAGE = 'PHASE42_HISTORICAL_COST_MISSING: Parcel Component historical cost is missing.';
          END IF;
          v_inventory_sources := v_inventory_sources || JSONB_BUILD_ARRAY(
            JSONB_BUILD_OBJECT(
              'source_kind', 'parcel_component',
              'source_id', v_component_row.id,
              'return_item_id', v_return_item_id,
              'product_id', v_component_row.product_id,
              'quantity', v_accepted,
              'historical_value_exact', ROUND(v_unit_cost_exact * v_accepted, 6)
            )
          );
        END IF;
        v_prepared_components := v_prepared_components || JSONB_BUILD_ARRAY(
          JSONB_BUILD_OBJECT(
            'parcel_component_id', v_component_row.id,
            'original_sale_operation_id', v_component_row.operation_id,
            'product_id', v_component_row.product_id,
            'original_quantity', v_component_row.base_quantity,
            'accepted_quantity', v_accepted,
            'rejected_quantity', v_rejected,
            'accepted_condition', v_component->>'accepted_condition',
            'accepted_stock_disposition',
              v_component->>'accepted_stock_disposition',
            'rejection_reason', v_component->>'rejection_reason',
            'rejected_stock_disposition',
              v_component->>'rejected_stock_disposition'
          )
        );
      END LOOP;
      IF v_accepted_total + v_rejected_total
          IS DISTINCT FROM v_instance.units_per_parcel_snapshot THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE42_PARCEL_INSPECTION_INCOMPLETE: Parcel inspection does not account for every historical Base Unit.';
      END IF;
      v_applied_damage := LEAST(
        v_instance.net_refundable_amount_snapshot_in_minor_units, v_raw_damage
      );
      v_item_refund :=
        v_instance.net_refundable_amount_snapshot_in_minor_units
          - v_applied_damage;
      v_prepared_items := v_prepared_items || JSONB_BUILD_ARRAY(
        JSONB_BUILD_OBJECT(
          'id', v_return_item_id,
          'return_scope', 'parcel_instance',
          'order_item_id', v_order_item.id,
          'parcel_instance_id', v_instance.id,
          'returned_quantity', 1,
          'refund_amount', v_item_refund,
          'stock_disposition', v_item_stock_disposition,
          'accepted_quantity', v_accepted_total,
          'rejected_quantity', v_rejected_total,
          'original_cogs', v_instance.cogs_snapshot_in_minor_units,
          'raw_damage', v_raw_damage,
          'applied_damage', v_applied_damage,
          'components', v_prepared_components
        )
      );
      v_total_entitlement := v_total_entitlement + v_item_refund;
      v_total_raw_damage := v_total_raw_damage + v_raw_damage;
      v_total_applied_damage := v_total_applied_damage + v_applied_damage;
    END IF;
  END LOOP;

  SELECT * INTO v_financial
  FROM public.phase42_order_financial_position_internal(p_order_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE42_FINANCIAL_POSITION_UNAVAILABLE: Locked sale financial position is unavailable.';
  END IF;
  v_debt_reduction := LEAST(
    v_total_entitlement, v_financial.merchandise_debt_in_minor_units
  );
  v_money_refund := v_total_entitlement - v_debt_reduction;
  IF v_money_refund > v_financial.refundable_collected_in_minor_units THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE42_FINANCIAL_EVIDENCE_CONTRADICTORY: Return exceeds same-sale refundable collected funds.';
  END IF;
  IF (v_money_refund = 0 AND (v_method IS NOT NULL OR v_reference IS NOT NULL))
    OR (v_money_refund > 0 AND (
      v_method IS NULL OR v_method NOT IN ('cash', 'cliq', 'exchange_credit')
      OR v_shift_id IS NULL
      OR (v_method = 'cliq' AND v_reference IS NULL)
    ))
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE42_REFUND_METHOD_INVALID: Refund method must match the authoritative monetary outcome.';
  END IF;

  v_now := clock_timestamp();
  -- Do not consume a non-transactional sequence: an injected failure must
  -- leave no externally visible Return-number side effect. The operation UUID
  -- is already unique and transaction-local until commit.
  v_return_number := 'SRT4-' || TO_CHAR(v_now, 'YYYYMMDD') || '-'
    || UPPER(SUBSTRING(REGEXP_REPLACE(v_operation_id::TEXT, '-', '', 'g') FROM 1 FOR 12));
  v_result := JSONB_BUILD_OBJECT(
    'success', true,
    'idempotentReplay', false,
    'operationId', v_operation_id,
    'returnId', v_return_event_id,
    'returnNumber', v_return_number,
    'orderId', p_order_id,
    'merchandiseEntitlementInMinorUnits', v_total_entitlement,
    'debtReductionInMinorUnits', v_debt_reduction,
    'moneyRefundInMinorUnits', v_money_refund,
    'refundMethod', CASE WHEN v_money_refund > 0 THEN v_method END,
    'deliveryRefundInMinorUnits', 0,
    'taxRefundInMinorUnits', 0
  );

  INSERT INTO public.business_operations(
    id, operation_type, idempotency_key, request_fingerprint, initiated_by,
    result_snapshot, completed_at, request_identity_version,
    request_identity_snapshot, actor_scope_type, actor_scope_hash
  ) VALUES (
    v_operation_id, 'phase4_return_v1', v_key, v_fingerprint, v_user_id,
    v_result, v_now, 401, v_canonical, 'erp_user', v_actor_hash
  );

  INSERT INTO public.sales_return_events(
    id, return_number, operation_id, order_id, branch_id, warehouse_id,
    cash_shift_id, reason, refund_method,
    merchandise_refund_amount_in_minor_units, reference_number, notes,
    created_by, contract_version, settlement_status,
    outstanding_debt_before_snapshot_in_minor_units,
    net_collected_before_snapshot_in_minor_units,
    debt_reduction_amount_in_minor_units,
    money_refund_amount_in_minor_units,
    raw_customer_damage_deduction_in_minor_units,
    applied_customer_damage_deduction_in_minor_units,
    settlement_coordinator_version
  ) VALUES (
    v_return_event_id, v_return_number, v_operation_id, p_order_id,
    v_order.branch_id, v_order.warehouse_id,
    CASE WHEN v_money_refund > 0 THEN v_shift_id END,
    v_canonical->>'reason', CASE WHEN v_money_refund > 0 THEN v_method END,
    v_total_entitlement,
    CASE WHEN v_money_refund > 0 AND v_method = 'cliq'
      THEN v_reference END,
    v_canonical->>'notes', v_user_id, 401, 'draft',
    v_financial.merchandise_debt_in_minor_units,
    v_financial.refundable_collected_in_minor_units,
    v_debt_reduction, v_money_refund, v_total_raw_damage,
    v_total_applied_damage, 402
  );

  FOR v_item IN
    SELECT value FROM JSONB_ARRAY_ELEMENTS(v_prepared_items)
    ORDER BY value->>'order_item_id', value->>'id'
  LOOP
    INSERT INTO public.sales_return_items(
      id, sales_return_event_id, operation_id, order_id, order_item_id,
      return_scope, parcel_instance_id, product_id, returned_quantity,
      refund_amount_snapshot_in_minor_units, stock_disposition,
      accepted_base_quantity, rejected_base_quantity,
      original_cogs_snapshot_in_minor_units,
      raw_customer_damage_deduction_in_minor_units,
      applied_customer_damage_deduction_in_minor_units
    ) VALUES (
      (v_item->>'id')::UUID, v_return_event_id, v_operation_id, p_order_id,
      (v_item->>'order_item_id')::UUID, v_item->>'return_scope',
      (v_item->>'parcel_instance_id')::UUID,
      (v_item->>'product_id')::UUID,
      (v_item->>'returned_quantity')::INTEGER,
      (v_item->>'refund_amount')::BIGINT,
      v_item->>'stock_disposition',
      (v_item->>'accepted_quantity')::INTEGER,
      (v_item->>'rejected_quantity')::INTEGER,
      (v_item->>'original_cogs')::BIGINT,
      (v_item->>'raw_damage')::BIGINT,
      (v_item->>'applied_damage')::BIGINT
    );

    IF v_item->>'return_scope' = 'base_unit' THEN
      INSERT INTO public.sales_aftercare_consumptions(
        operation_id, return_item_id, source_kind, source_id, product_id,
        consumed_quantity, consumption_kind
      ) VALUES (
        v_operation_id, (v_item->>'id')::UUID, 'base_order_item',
        (v_item->>'order_item_id')::UUID, (v_item->>'product_id')::UUID,
        (v_item->>'returned_quantity')::INTEGER, 'return'
      );
    ELSE
      FOR v_component IN
        SELECT value FROM JSONB_ARRAY_ELEMENTS(v_item->'components')
        ORDER BY value->>'parcel_component_id'
      LOOP
        INSERT INTO public.sales_return_component_inspections(
          sales_return_item_id, return_operation_id, parcel_component_id,
          original_sale_operation_id, product_id, accepted_quantity,
          rejected_quantity, accepted_condition,
          accepted_stock_disposition, rejection_reason,
          rejected_stock_disposition
        ) VALUES (
          (v_item->>'id')::UUID, v_operation_id,
          (v_component->>'parcel_component_id')::UUID,
          (v_component->>'original_sale_operation_id')::UUID,
          (v_component->>'product_id')::UUID,
          (v_component->>'accepted_quantity')::INTEGER,
          (v_component->>'rejected_quantity')::INTEGER,
          v_component->>'accepted_condition',
          v_component->>'accepted_stock_disposition',
          v_component->>'rejection_reason',
          v_component->>'rejected_stock_disposition'
        );
        INSERT INTO public.sales_aftercare_consumptions(
          operation_id, return_item_id, source_kind, source_id, product_id,
          consumed_quantity, consumption_kind
        ) VALUES (
          v_operation_id, (v_item->>'id')::UUID, 'parcel_component',
          (v_component->>'parcel_component_id')::UUID,
          (v_component->>'product_id')::UUID,
          (v_component->>'original_quantity')::INTEGER, 'return'
        );
      END LOOP;
    END IF;
  END LOOP;

  IF v_money_refund > 0 AND v_method<>'exchange_credit' THEN
    UPDATE public.cash_shifts
    SET cash_refunds_in_minor_units = cash_refunds_in_minor_units
        + CASE WHEN v_method = 'cash' THEN v_money_refund ELSE 0 END,
      cliq_refunds_in_minor_units = cliq_refunds_in_minor_units
        + CASE WHEN v_method = 'cliq' THEN v_money_refund ELSE 0 END,
      updated_at = clock_timestamp()
    WHERE id = v_shift_id AND status = 'open';
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '40001',
        MESSAGE = 'PHASE4_LOCK_PLAN_CHANGED_RETRY: Refund Shift is no longer open.';
    END IF;
  END IF;

  v_inventory_result := public.phase42_apply_return_inventory_internal(
    v_operation_id, v_return_event_id, v_order.warehouse_id,
    v_inventory_sources, v_user_id
  );

  INSERT INTO public.phase42_return_settlement_guards(
    transaction_id, operation_id, return_event_id
  ) VALUES (pg_current_xact_id(), v_operation_id, v_return_event_id);

  INSERT INTO public.phase42_return_settlement_evidence(
    operation_id, return_event_id, order_id, result_snapshot,
    inventory_effects_snapshot
  ) VALUES (
    v_operation_id, v_return_event_id, p_order_id, v_result,
    public.phase42_inventory_effects_snapshot_internal(v_operation_id)
  );

  PERFORM public.phase4_finalize_aftercare_operation_internal(v_operation_id);
  DELETE FROM public.phase42_return_settlement_guards
  WHERE transaction_id = pg_current_xact_id()
    AND operation_id = v_operation_id;

  INSERT INTO public.audit_logs(user_id, action, entity_name, entity_id, details)
  VALUES (
    v_user_id, 'SETTLE_PHASE42_SALES_RETURN', 'sales_return_events',
    v_return_event_id, JSONB_BUILD_OBJECT(
      'operation_id', v_operation_id,
      'order_id', p_order_id,
      'debt_reduction_in_minor_units', v_debt_reduction,
      'money_refund_in_minor_units', v_money_refund,
      'refund_method', CASE WHEN v_money_refund > 0 THEN v_method END,
      'inventory_effects', v_inventory_result
    )
  );
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tb215_exchange_finalize_internal(p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_operation public.business_operations%ROWTYPE;
  v_source RECORD;
  v_item RECORD;
  v_order_item public.order_items%ROWTYPE;
  v_return_event public.sales_return_events%ROWTYPE;
  v_replacement_event public.sales_replacement_events%ROWTYPE;
  v_capacity INTEGER;
  v_consumed INTEGER;
  v_completion_at TIMESTAMPTZ;
  v_item_count INTEGER;
  v_other_settled INTEGER;
  v_original_entitlement BIGINT;
  v_original_cogs BIGINT;
  v_total_units INTEGER;
  v_accepted_units INTEGER;
  v_rejected_units INTEGER;
  v_raw_damage BIGINT;
  v_expected_applied_damage BIGINT;
  v_item_refund_total BIGINT;
  v_item_raw_total BIGINT;
  v_item_applied_total BIGINT;
  v_current_consumption INTEGER;
  v_cumulative_quantity INTEGER;
  v_cumulative_refund BIGINT;
  v_cumulative_cogs BIGINT;
  v_return_count INTEGER;
  v_replacement_count INTEGER;
  v_now TIMESTAMPTZ;
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22004',
      MESSAGE = 'PHASE4_OPERATION_REQUIRED: Operation identity is required.';
  END IF;

  -- Reacquire the same transaction-scoped root gate before locking the
  -- operation/header. This covers finalization of a draft committed by an
  -- earlier transaction while remaining re-entrant for create+finalize.
  PERFORM public.phase4_lock_aftercare_operation_order_internal(
    p_operation_id, NULL
  );

  SELECT * INTO v_operation
  FROM public.business_operations operation
  WHERE operation.id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503',
      MESSAGE = 'PHASE4_OPERATION_NOT_FOUND: Business operation does not exist.';
  END IF;

  IF v_operation.idempotency_key IS NULL
    OR v_operation.request_fingerprint IS NULL
    OR v_operation.request_identity_version IS DISTINCT FROM 401
    OR v_operation.request_identity_snapshot IS NULL
    OR v_operation.actor_scope_type IS NULL
    OR v_operation.actor_scope_hash IS NULL
    OR v_operation.result_snapshot IS NULL
    OR v_operation.completed_at IS NULL
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_OPERATION_EVIDENCE_INCOMPLETE: Immutable request/result evidence is required before finalization.';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_return_count
  FROM public.sales_return_events event
  WHERE event.operation_id = p_operation_id;
  SELECT COUNT(*)::INTEGER INTO v_replacement_count
  FROM public.sales_replacement_events event
  WHERE event.operation_id = p_operation_id;

  IF (v_operation.operation_type = 'phase4_return_v1'
      AND (v_return_count <> 1 OR v_replacement_count <> 0))
    OR (v_operation.operation_type = 'phase4_replacement_v1'
      AND (v_replacement_count <> 1 OR v_return_count <> 0))
    OR v_operation.operation_type NOT IN (
      'phase4_return_v1', 'phase4_replacement_v1'
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_OPERATION_SHAPE_INVALID: Operation type and aftercare evidence do not match.';
  END IF;

  PERFORM set_config(
    'nawasrah.phase4_finalization_operation_id', p_operation_id::TEXT, true
  );

  IF v_return_count = 1 THEN
    SELECT * INTO v_return_event
    FROM public.sales_return_events event
    WHERE event.operation_id = p_operation_id
    FOR UPDATE;

    PERFORM public.tb215_assert_exchange_return_event_internal(v_return_event.id);

    IF v_return_event.contract_version IS DISTINCT FROM 401
      OR v_return_event.settlement_status NOT IN ('draft', 'inspected')
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_RETURN_NOT_FINALIZABLE: Return is not a valid versioned draft.';
    END IF;

    PERFORM public.phase4_assert_aftercare_operation_binding_internal(
      v_operation.id, 'return', v_return_event.id,
      v_return_event.contract_version
    );

    IF v_return_event.outstanding_debt_before_snapshot_in_minor_units IS NULL
      OR v_return_event.net_collected_before_snapshot_in_minor_units IS NULL
      OR v_return_event.debt_reduction_amount_in_minor_units IS NULL
      OR v_return_event.money_refund_amount_in_minor_units IS NULL
      OR (v_return_event.money_refund_amount_in_minor_units = 0 AND (
        v_return_event.refund_method IS NOT NULL
        OR v_return_event.cash_shift_id IS NOT NULL
        OR v_return_event.reference_number IS NOT NULL
      ))
      OR (v_return_event.money_refund_amount_in_minor_units > 0 AND (
        v_return_event.refund_method NOT IN ('cash', 'cliq', 'exchange_credit')
        OR v_return_event.cash_shift_id IS NULL
        OR (v_return_event.refund_method = 'cliq'
          AND NULLIF(BTRIM(v_return_event.reference_number), '') IS NULL)
      ))
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_RETURN_FINANCIAL_EVIDENCE_INCOMPLETE: Versioned Return financial evidence is incomplete.';
    END IF;

    PERFORM 1 FROM public.orders customer_order
    WHERE customer_order.id = v_return_event.order_id FOR UPDATE;
    v_completion_at := public.phase4_authoritative_completion_internal(
      v_return_event.order_id
    );

    SELECT COUNT(*)::INTEGER INTO v_item_count
    FROM public.sales_return_items item
    WHERE item.sales_return_event_id = v_return_event.id
      AND item.operation_id = p_operation_id;
    IF v_item_count = 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_RETURN_ITEMS_REQUIRED: Return requires immutable item evidence.';
    END IF;

    FOR v_item IN
      SELECT item.* FROM public.sales_return_items item
      WHERE item.sales_return_event_id = v_return_event.id
        AND item.operation_id = p_operation_id
      ORDER BY item.order_item_id, item.id
    LOOP
      SELECT * INTO v_order_item FROM public.order_items item
      WHERE item.id = v_item.order_item_id FOR UPDATE;

      IF v_item.return_scope = 'parcel_instance' THEN
        SELECT instance.net_refundable_amount_snapshot_in_minor_units,
          instance.cogs_snapshot_in_minor_units,
          instance.units_per_parcel_snapshot
        INTO v_original_entitlement, v_original_cogs, v_total_units
        FROM public.order_parcel_instances instance
        WHERE instance.id = v_item.parcel_instance_id
          AND instance.order_item_id = v_item.order_item_id
        FOR UPDATE;

        SELECT COUNT(*)::INTEGER INTO v_other_settled
        FROM public.sales_return_items other_item
        JOIN public.sales_return_events other_event
          ON other_event.id = other_item.sales_return_event_id
        WHERE other_item.parcel_instance_id = v_item.parcel_instance_id
          AND other_item.id <> v_item.id
          AND other_event.settlement_status = 'settled';
        IF v_other_settled > 0 THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'PHASE4_PARCEL_RETURN_ALREADY_CONSUMED: Original Parcel Return identity was already settled.';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM public.order_parcel_components component
          LEFT JOIN public.sales_return_component_inspections inspection
            ON inspection.parcel_component_id = component.id
            AND inspection.sales_return_item_id = v_item.id
          WHERE component.parcel_instance_id = v_item.parcel_instance_id
            AND (inspection.id IS NULL
              OR inspection.accepted_quantity + inspection.rejected_quantity
                <> component.base_quantity
              OR (inspection.accepted_quantity > 0 AND (
                inspection.accepted_condition IS NULL
                OR inspection.accepted_stock_disposition IS NULL
                OR (inspection.accepted_condition = 'sellable'
                  AND inspection.accepted_stock_disposition <> 'restock')
                OR (inspection.accepted_condition = 'supplier_defect'
                  AND inspection.accepted_stock_disposition <> 'non_sellable')
              ))
              OR (inspection.rejected_quantity > 0 AND (
                inspection.rejection_reason IS NULL
                OR inspection.rejection_reason <> 'customer_damage'
                OR inspection.rejected_stock_disposition IS NULL
                OR inspection.rejected_stock_disposition <> 'returned_to_customer'
              )))
        ) THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'PHASE4_PARCEL_INSPECTION_INCOMPLETE: Every original Component quantity must be classified before settlement.';
        END IF;

        SELECT COALESCE(SUM(inspection.accepted_quantity), 0)::INTEGER,
          COALESCE(SUM(inspection.rejected_quantity), 0)::INTEGER,
          COALESCE(SUM(inspection.raw_customer_damage_deduction_in_minor_units), 0)::BIGINT
        INTO v_accepted_units, v_rejected_units, v_raw_damage
        FROM public.sales_return_component_inspections inspection
        WHERE inspection.sales_return_item_id = v_item.id;
        v_expected_applied_damage := LEAST(v_original_entitlement, v_raw_damage);

        IF v_accepted_units + v_rejected_units <> v_total_units
          OR v_item.accepted_base_quantity IS DISTINCT FROM v_accepted_units
          OR v_item.rejected_base_quantity IS DISTINCT FROM v_rejected_units
          OR v_item.raw_customer_damage_deduction_in_minor_units
            IS DISTINCT FROM v_raw_damage
          OR v_item.applied_customer_damage_deduction_in_minor_units
            IS DISTINCT FROM v_expected_applied_damage
          OR v_item.refund_amount_snapshot_in_minor_units
            IS DISTINCT FROM v_original_entitlement - v_expected_applied_damage
          OR v_item.original_cogs_snapshot_in_minor_units
            IS DISTINCT FROM v_original_cogs
        THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'PHASE4_PARCEL_SETTLEMENT_EVIDENCE_INVALID: Parcel accepted/rejected, refund, damage, or COGS evidence does not reconcile.';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM public.order_parcel_components component
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(consumption.consumed_quantity), 0)::INTEGER quantity
            FROM public.sales_aftercare_consumptions consumption
            CROSS JOIN LATERAL public.phase4_aftercare_source_root_internal(
              consumption.source_kind, consumption.source_id,
              consumption.product_id
            ) root
            WHERE consumption.operation_id = p_operation_id
              AND consumption.return_item_id = v_item.id
              AND root.root_kind = 'parcel_component'
              AND root.root_id = component.id
              AND root.product_id = component.product_id
              AND consumption.consumption_kind = 'return'
              AND consumption.consumption_state = 'draft'
          ) used ON true
          WHERE component.parcel_instance_id = v_item.parcel_instance_id
            AND used.quantity <> component.base_quantity
        ) THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'PHASE4_PARCEL_CONSUMPTION_INCOMPLETE: Whole Parcel settlement must consume every original Component quantity.';
        END IF;
      ELSE
        v_total_units := v_order_item.quantity;
        v_original_entitlement :=
          v_order_item.net_refundable_amount_snapshot_in_minor_units;
        v_original_cogs := v_order_item.cogs_in_minor_units;

        IF v_original_entitlement IS NULL
          OR v_item.accepted_base_quantity + v_item.rejected_base_quantity
            IS DISTINCT FROM v_item.returned_quantity
      OR (v_order_item.commercial_line_kind IS DISTINCT FROM 'legacy_single_sku_parcel'
        AND (COALESCE(v_item.raw_customer_damage_deduction_in_minor_units, 0) <> 0
          OR COALESCE(v_item.applied_customer_damage_deduction_in_minor_units, 0) <> 0))
        THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'PHASE4_BASE_RETURN_EVIDENCE_INVALID: Base Unit Return evidence is incomplete or unsupported.';
        END IF;

        SELECT COALESCE(SUM(consumption.consumed_quantity), 0)::INTEGER
        INTO v_current_consumption
        FROM public.sales_aftercare_consumptions consumption
        CROSS JOIN LATERAL public.phase4_aftercare_source_root_internal(
          consumption.source_kind, consumption.source_id,
          consumption.product_id
        ) root
        WHERE consumption.operation_id = p_operation_id
          AND consumption.return_item_id = v_item.id
          AND root.root_kind = 'base_order_item'
          AND root.root_id = v_item.order_item_id
          AND root.product_id = v_item.product_id
          AND consumption.consumption_kind = 'return'
          AND consumption.consumption_state = 'draft';
        IF v_current_consumption IS DISTINCT FROM v_item.returned_quantity THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'PHASE4_BASE_RETURN_CONSUMPTION_INVALID: Logical Base Unit consumption does not match the Return quantity.';
        END IF;

        SELECT COALESCE(SUM(consumed.item_quantity), 0)::INTEGER,
          COALESCE(SUM(consumed.item_refund), 0)::BIGINT,
          COALESCE(SUM(consumed.item_cogs), 0)::BIGINT
        INTO v_cumulative_quantity, v_cumulative_refund, v_cumulative_cogs
        FROM (
          SELECT item.id,
            SUM(consumption.consumed_quantity)::INTEGER AS item_quantity,
            item.refund_amount_snapshot_in_minor_units
              + item.applied_customer_damage_deduction_in_minor_units AS item_refund,
            item.original_cogs_snapshot_in_minor_units AS item_cogs
          FROM public.sales_aftercare_consumptions consumption
          JOIN public.sales_return_items item
            ON item.id = consumption.return_item_id
          JOIN public.sales_return_events event
            ON event.id = item.sales_return_event_id
          CROSS JOIN LATERAL public.phase4_aftercare_source_root_internal(
            consumption.source_kind, consumption.source_id,
            consumption.product_id
          ) root
          WHERE root.root_kind = 'base_order_item'
            AND root.root_id = v_item.order_item_id
            AND consumption.consumption_kind = 'return'
            AND (consumption.consumption_state = 'settled'
              OR (consumption.operation_id = p_operation_id
                AND consumption.consumption_state = 'draft'))
            AND event.settlement_status <> 'cancelled'
          GROUP BY item.id, item.refund_amount_snapshot_in_minor_units, item.applied_customer_damage_deduction_in_minor_units,
            item.original_cogs_snapshot_in_minor_units
        ) consumed;

        IF v_cumulative_quantity > v_total_units
          OR v_cumulative_refund > v_original_entitlement
          OR v_cumulative_cogs > v_original_cogs
          OR (v_cumulative_quantity = v_total_units
            AND (v_cumulative_refund <> v_original_entitlement
              OR v_cumulative_cogs <> v_original_cogs))
        THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'PHASE4_BASE_RETURN_CUMULATIVE_BOUND_INVALID: Quantity, refund, COGS, or final residual exceeds the immutable sale bounds.';
        END IF;
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM public.sales_aftercare_consumptions consumption
      WHERE consumption.operation_id = p_operation_id
        AND consumption.consumption_state = 'draft'
        AND NOT EXISTS (
          SELECT 1
          FROM public.sales_return_items item
          CROSS JOIN LATERAL public.phase4_aftercare_source_root_internal(
            consumption.source_kind, consumption.source_id,
            consumption.product_id
          ) root
          WHERE item.id = consumption.return_item_id
            AND item.operation_id = p_operation_id
            AND consumption.consumption_kind = 'return'
            AND consumption.replacement_item_id IS NULL
            AND (
              (item.return_scope = 'base_unit'
                AND consumption.product_id = item.product_id
                AND root.root_kind = 'base_order_item'
                AND root.root_id = item.order_item_id
                AND root.product_id = item.product_id)
              OR (item.return_scope = 'parcel_instance'
                AND root.root_kind = 'parcel_component'
                AND root.product_id = consumption.product_id
                AND EXISTS (
                  SELECT 1
                  FROM public.order_parcel_components component
                  WHERE component.id = root.root_id
                    AND component.parcel_instance_id = item.parcel_instance_id
                    AND component.product_id = consumption.product_id
                ))
            )
        )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_RETURN_CONSUMPTION_SCOPE_INVALID: Return consumption contains an unauthorized logical source.';
    END IF;

    SELECT COALESCE(SUM(item.refund_amount_snapshot_in_minor_units), 0)::BIGINT,
      COALESCE(SUM(item.raw_customer_damage_deduction_in_minor_units), 0)::BIGINT,
      COALESCE(SUM(item.applied_customer_damage_deduction_in_minor_units), 0)::BIGINT
    INTO v_item_refund_total, v_item_raw_total, v_item_applied_total
    FROM public.sales_return_items item
    WHERE item.sales_return_event_id = v_return_event.id;

    IF v_return_event.merchandise_refund_amount_in_minor_units
        IS DISTINCT FROM v_item_refund_total
      OR v_return_event.raw_customer_damage_deduction_in_minor_units
        IS DISTINCT FROM v_item_raw_total
      OR v_return_event.applied_customer_damage_deduction_in_minor_units
        IS DISTINCT FROM v_item_applied_total
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_RETURN_FINANCIAL_RECONCILIATION_FAILED: Return item and event financial evidence do not reconcile.';
    END IF;
  ELSE
    SELECT * INTO v_replacement_event
    FROM public.sales_replacement_events event
    WHERE event.operation_id = p_operation_id
    FOR UPDATE;

    IF v_replacement_event.contract_version IS DISTINCT FROM 401 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_REPLACEMENT_NOT_FINALIZABLE: Replacement is not a valid versioned draft.';
    END IF;
    PERFORM public.phase4_assert_aftercare_operation_binding_internal(
      v_operation.id, 'replacement', v_replacement_event.id,
      v_replacement_event.contract_version
    );
    IF v_replacement_event.replacement_status <> 'draft' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_REPLACEMENT_NOT_FINALIZABLE: Replacement is not a draft.';
    END IF;

    PERFORM 1 FROM public.orders customer_order
    WHERE customer_order.id = v_replacement_event.root_order_id FOR UPDATE;
    v_completion_at := public.phase4_authoritative_completion_internal(
      v_replacement_event.root_order_id
    );
    IF v_completion_at IS DISTINCT FROM
        v_replacement_event.original_completed_at_snapshot THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_REPLACEMENT_WINDOW_INVALID: Replacement must use the original completion evidence.';
    END IF;

    SELECT COUNT(*)::INTEGER INTO v_item_count
    FROM public.sales_replacement_items item
    WHERE item.replacement_event_id = v_replacement_event.id
      AND item.operation_id = p_operation_id;
    IF v_item_count = 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_REPLACEMENT_ITEMS_REQUIRED: Replacement requires immutable item evidence.';
    END IF;

    FOR v_item IN
      SELECT item.* FROM public.sales_replacement_items item
      WHERE item.replacement_event_id = v_replacement_event.id
      ORDER BY item.id
    LOOP
      SELECT COALESCE(SUM(consumption.consumed_quantity), 0)::INTEGER
      INTO v_current_consumption
      FROM public.sales_aftercare_consumptions consumption
      WHERE consumption.operation_id = p_operation_id
        AND consumption.replacement_item_id = v_item.id
        AND consumption.consumption_kind = 'replacement'
        AND consumption.consumption_state = 'draft'
        AND consumption.product_id = v_item.product_id
        AND (
          (v_item.parent_replacement_item_id IS NULL
            AND consumption.source_kind = CASE
              WHEN v_item.root_parcel_component_id IS NULL
                THEN 'base_order_item' ELSE 'parcel_component' END
            AND consumption.source_id = COALESCE(
              v_item.root_parcel_component_id, v_item.root_order_item_id
            ))
          OR (v_item.parent_replacement_item_id IS NOT NULL
            AND consumption.source_kind = 'replacement_item'
            AND consumption.source_id = v_item.parent_replacement_item_id)
        );
      IF v_current_consumption IS DISTINCT FROM v_item.quantity THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE4_REPLACEMENT_CONSUMPTION_INVALID: Replacement must consume the exact current physical lineage quantity.';
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM public.sales_aftercare_consumptions consumption
      WHERE consumption.operation_id = p_operation_id
        AND consumption.consumption_state = 'draft'
        AND NOT EXISTS (
          SELECT 1
          FROM public.sales_replacement_items item
          WHERE item.id = consumption.replacement_item_id
            AND item.operation_id = p_operation_id
            AND consumption.consumption_kind = 'replacement'
            AND consumption.return_item_id IS NULL
            AND consumption.product_id = item.product_id
            AND (
              (item.parent_replacement_item_id IS NULL
                AND consumption.source_kind = CASE
                  WHEN item.root_parcel_component_id IS NULL
                    THEN 'base_order_item' ELSE 'parcel_component' END
                AND consumption.source_id = COALESCE(
                  item.root_parcel_component_id, item.root_order_item_id
                ))
              OR (item.parent_replacement_item_id IS NOT NULL
                AND consumption.source_kind = 'replacement_item'
                AND consumption.source_id = item.parent_replacement_item_id)
            )
        )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_REPLACEMENT_CONSUMPTION_SCOPE_INVALID: Replacement consumption contains an unauthorized logical source.';
    END IF;
  END IF;

  -- Stable advisory identity serializes an otherwise absent source row without
  -- inventing physical serial numbers.
  FOR v_source IN
    SELECT consumption.source_kind, consumption.source_id,
      consumption.product_id
    FROM public.sales_aftercare_consumptions consumption
    WHERE consumption.operation_id = p_operation_id
      AND consumption.consumption_state = 'draft'
    GROUP BY consumption.source_kind, consumption.source_id,
      consumption.product_id
    ORDER BY consumption.source_kind, consumption.source_id,
      consumption.product_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('phase4-aftercare|' || v_source.source_kind || '|'
        || v_source.source_id::TEXT, 0)
    );

    IF v_source.source_kind = 'base_order_item' THEN
      SELECT item.quantity INTO v_capacity
      FROM public.order_items item
      WHERE item.id = v_source.source_id
        AND item.product_id = v_source.product_id
        AND item.commercial_line_kind IN ('base_unit','legacy_single_sku_parcel')
      FOR UPDATE;
    ELSIF v_source.source_kind = 'parcel_component' THEN
      SELECT component.base_quantity INTO v_capacity
      FROM public.order_parcel_components component
      WHERE component.id = v_source.source_id
        AND component.product_id = v_source.product_id
      FOR UPDATE;
    ELSE
      SELECT replacement.quantity INTO v_capacity
      FROM public.sales_replacement_items replacement
      WHERE replacement.id = v_source.source_id
        AND replacement.product_id = v_source.product_id
      FOR UPDATE;
    END IF;

    IF v_capacity IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'PHASE4_AFTERCARE_SOURCE_INVALID: Commercial source identity is not valid.';
    END IF;

    PERFORM 1 FROM public.sales_aftercare_consumptions consumption
    WHERE consumption.source_kind = v_source.source_kind
      AND consumption.source_id = v_source.source_id
    ORDER BY consumption.id FOR UPDATE;

    SELECT COALESCE(SUM(consumption.consumed_quantity), 0)::INTEGER
    INTO v_consumed
    FROM public.sales_aftercare_consumptions consumption
    WHERE consumption.source_kind = v_source.source_kind
      AND consumption.source_id = v_source.source_id
      AND (consumption.consumption_state = 'settled'
        OR (consumption.operation_id = p_operation_id
          AND consumption.consumption_state = 'draft'));

    IF v_consumed > v_capacity THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED: Requested quantity exceeds the remaining original commercial source.';
    END IF;
  END LOOP;

  -- The eligibility clock is sampled only after the complete source set is
  -- locked.  Time spent waiting for locks cannot preserve an expired new
  -- operation.  A committed replay is resolved by its coordinator before this
  -- new-operation finalizer is entered.
  v_now := clock_timestamp();
  IF v_return_count = 1
    AND v_now > v_completion_at + INTERVAL '48 hours'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_RETURN_WINDOW_EXPIRED: A new Return cannot be finalized after the original 48-hour window.';
  END IF;
  IF v_replacement_count = 1
    AND v_now > v_completion_at + INTERVAL '48 hours'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_REPLACEMENT_WINDOW_INVALID: Replacement is outside the original 48-hour window.';
  END IF;

  IF v_return_count = 1 THEN
    UPDATE public.sales_return_events event
    SET settlement_status = 'settled', settled_at = v_now
    WHERE event.id = v_return_event.id
      AND event.operation_id = p_operation_id
      AND event.settlement_status IN ('draft', 'inspected');
  END IF;

  IF v_replacement_count = 1 THEN
    UPDATE public.sales_replacement_events event
    SET replacement_status = 'settled', settled_at = v_now
    WHERE event.id = v_replacement_event.id
      AND event.operation_id = p_operation_id
      AND event.replacement_status = 'draft';
  END IF;

  UPDATE public.sales_aftercare_consumptions
  SET consumption_state = 'settled', settled_at = v_now
  WHERE operation_id = p_operation_id AND consumption_state = 'draft';

  RETURN JSONB_BUILD_OBJECT(
    'operationId', p_operation_id,
    'settledAt', v_now,
    'consumptionCount', (
      SELECT COUNT(*) FROM public.sales_aftercare_consumptions
      WHERE operation_id = p_operation_id AND consumption_state = 'settled'
    )
  );
END;
$function$;

ALTER FUNCTION public.phase4_finalize_aftercare_operation_foundation_internal(UUID) RENAME TO tb215_finalize_before_exchange_internal;
CREATE FUNCTION public.phase4_finalize_aftercare_operation_foundation_internal(p_operation_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.sales_return_events e WHERE e.operation_id=p_operation_id AND e.refund_method='exchange_credit') THEN
  RETURN public.tb215_exchange_finalize_internal(p_operation_id);
 END IF;
 RETURN public.tb215_finalize_before_exchange_internal(p_operation_id);
END $$;

CREATE FUNCTION public.tb215_exchange_manifest_internal(p_operation_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('plan',to_jsonb(p)-'created_at'-'original_completed_at'||jsonb_build_object('createdAtEpoch',extract(epoch from p.created_at),'originalCompletedEpoch',extract(epoch from p.original_completed_at)),
  'result',to_jsonb(r),'newCreation',jsonb_build_object('id',b.id,'identity',b.request_identity_snapshot,'result',b.result_snapshot),
  'returnCreation',jsonb_build_object('id',ret.id,'identity',ret.request_identity_snapshot,'result',ret.result_snapshot))
 FROM public.aftercare215_exchanges p JOIN public.aftercare215_exchange_results r ON r.operation_id=p.operation_id
 JOIN public.orders o ON o.id=r.new_order_id JOIN public.business_operations b ON b.id=o.operation_id
 JOIN public.business_operations ret ON ret.id=r.return_operation_id WHERE p.operation_id=p_operation_id;
$$;

CREATE FUNCTION public.tb215_assert_exchange_internal(p_operation_id UUID)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ctx public.aftercare215_exchanges%ROWTYPE; r public.aftercare215_exchange_results%ROWTYPE; b public.business_operations%ROWTYPE;
 sale public.orders%ROWTYPE; creation public.business_operations%ROWTYPE; ret public.business_operations%ROWTYPE; item public.order_items%ROWTYPE;
 plan JSONB; parent_identity JSONB; expected_total BIGINT; entitlement BIGINT; credit BIGINT; difference BIGINT; return_event UUID; loss BIGINT;
BEGIN
 SELECT * INTO ctx FROM public.aftercare215_exchanges WHERE operation_id=p_operation_id;
 SELECT * INTO r FROM public.aftercare215_exchange_results WHERE operation_id=p_operation_id;
 SELECT * INTO b FROM public.business_operations WHERE id=p_operation_id;
 IF ctx.operation_id IS NULL OR r.operation_id IS NULL OR b.id IS NULL THEN RAISE EXCEPTION 'AFTERCARE215_EXCHANGE_EVIDENCE_INVALID'; END IF;
 plan:=ctx.prepared_plan;expected_total:=(plan->>'newTotalInMinorUnits')::BIGINT;entitlement:=(plan->'returnPlan'->>'entitlementInMinorUnits')::BIGINT;
 credit:=LEAST(expected_total,entitlement);difference:=expected_total-entitlement;
 parent_identity:=jsonb_build_object('request',plan->'request','previewFingerprint',ctx.preview_fingerprint);
 IF b.operation_type IS DISTINCT FROM 'aftercare215_exchange' OR b.initiated_by IS DISTINCT FROM ctx.created_by OR b.idempotency_key IS DISTINCT FROM ctx.idempotency_key
  OR b.request_identity_version IS DISTINCT FROM 215 OR b.request_identity_snapshot IS DISTINCT FROM parent_identity
  OR b.request_fingerprint IS DISTINCT FROM encode(extensions.digest(parent_identity::TEXT,'sha256'),'hex')
  OR ctx.preview_fingerprint IS DISTINCT FROM encode(extensions.digest(plan::TEXT,'sha256'),'hex')
  OR b.result_snapshot->>'evidenceFingerprint' IS DISTINCT FROM encode(extensions.digest(public.tb215_exchange_manifest_internal(p_operation_id)::TEXT,'sha256'),'hex')
  OR b.result_snapshot-'evidenceFingerprint' IS DISTINCT FROM public.tb215_exchange_public_result_internal(p_operation_id)
  OR b.completed_at IS DISTINCT FROM ctx.created_at OR ctx.order_id IS DISTINCT FROM(plan->>'orderId')::UUID
  OR(plan->>'internalCreditInMinorUnits')::BIGINT IS DISTINCT FROM credit
  OR(plan->>'differenceInMinorUnits')::BIGINT IS DISTINCT FROM difference
  OR(plan->>'moneyReceivedInMinorUnits')::BIGINT IS DISTINCT FROM GREATEST(difference,0)
  OR(plan->>'moneyRefundInMinorUnits')::BIGINT IS DISTINCT FROM GREATEST(-difference,0)
 THEN RAISE EXCEPTION 'AFTERCARE215_EXCHANGE_EVIDENCE_INVALID'; END IF;
 SELECT * INTO sale FROM public.orders WHERE id=r.new_order_id;
 SELECT * INTO creation FROM public.business_operations WHERE id=sale.operation_id;
 SELECT * INTO ret FROM public.business_operations WHERE id=r.return_operation_id;
 IF sale.id IS NULL OR creation.id IS NULL OR ret.id IS NULL OR sale.payment_method IS DISTINCT FROM 'exchange_credit' OR sale.source IS DISTINCT FROM 'pos'
  OR sale.total_in_minor_units IS DISTINCT FROM expected_total OR sale.amount_paid_in_minor_units IS DISTINCT FROM expected_total
  OR sale.cash_shift_id IS DISTINCT FROM(plan->>'cashShiftId')::UUID
  OR sale.customer_id IS DISTINCT FROM(plan->>'customerId')::UUID OR sale.warehouse_id IS DISTINCT FROM(plan->>'warehouseId')::UUID
  OR sale.branch_id IS DISTINCT FROM(plan->>'branchId')::UUID
  OR creation.idempotency_key IS DISTINCT FROM ctx.pos_key OR creation.initiated_by IS DISTINCT FROM ctx.created_by
  OR creation.operation_type IS DISTINCT FROM 'phase3_pos_sale_v1' OR creation.request_identity_snapshot->>'payment_method' IS DISTINCT FROM 'exchange_credit'
  OR creation.request_fingerprint IS DISTINCT FROM public.phase3_request_fingerprint_internal(creation.request_identity_snapshot)
  OR creation.request_identity_snapshot->'lines' IS DISTINCT FROM public.phase3_canonicalize_sale_request_internal(creation.request_identity_snapshot)->'lines'
  OR(creation.result_snapshot->>'orderId')::UUID IS DISTINCT FROM sale.id
  OR(creation.result_snapshot->>'totalInMinorUnits')::BIGINT IS DISTINCT FROM expected_total
  OR creation.result_snapshot->>'paymentMethod' IS DISTINCT FROM 'exchange_credit'
  OR ret.initiated_by IS DISTINCT FROM ctx.created_by OR ret.idempotency_key IS DISTINCT FROM ctx.return_key
  OR ret.operation_type IS DISTINCT FROM 'phase4_return_v1'
  OR(SELECT count(*) FROM public.order_items WHERE order_id=sale.id)<>1
 THEN RAISE EXCEPTION 'AFTERCARE215_EXCHANGE_EVIDENCE_INVALID'; END IF;
 SELECT * INTO STRICT item FROM public.order_items WHERE order_id=sale.id;
 IF item.product_id IS DISTINCT FROM(plan->>'productId')::UUID OR item.commercial_line_kind IS DISTINCT FROM plan->'line'->>'commercial_line_kind'
  OR item.quantity IS DISTINCT FROM(plan->>'baseQuantity')::INTEGER
  OR item.exact_cogs_snapshot_in_minor_units IS DISTINCT FROM(plan->>'newCogsExact')::NUMERIC
  OR item.cogs_in_minor_units IS DISTINCT FROM(plan->>'newCogsInMinorUnits')::BIGINT
  OR(SELECT COALESCE(sum(quantity),0) FROM public.inventory_movements WHERE operation_id=creation.id AND product_id=item.product_id
    AND reference_type='pos_sale' AND reference_id=sale.id AND warehouse_id=sale.warehouse_id AND movement_type='sales_deduction') IS DISTINCT FROM -item.quantity::BIGINT
 THEN RAISE EXCEPTION 'AFTERCARE215_EXCHANGE_EVIDENCE_INVALID'; END IF;
 SELECT id INTO STRICT return_event FROM public.sales_return_events WHERE operation_id=r.return_operation_id;
 PERFORM public.tb215_assert_exchange_return_event_internal(return_event);
 PERFORM public.phase42_assert_operational_return_evidence_internal(r.return_operation_id,true);
 IF(SELECT COALESCE(sum(historical_restock_value_in_minor_units_exact),0) FROM public.phase42_return_inventory_effects WHERE operation_id=r.return_operation_id)
   IS DISTINCT FROM(plan->'returnPlan'->>'goodRestockValueExact')::NUMERIC
  OR(SELECT COALESCE(sum(loss_in_minor_units),0) FROM public.inventory_damage_events WHERE return_event_id=return_event AND origin='customer_return')
   IS DISTINCT FROM(plan->'returnPlan'->>'badLossInMinorUnits')::NUMERIC
  OR(r.supplier_operation_id IS NULL) IS DISTINCT FROM(jsonb_array_length(plan->'request'->'returnRequest'->'supplierAssignments')=0)
 THEN RAISE EXCEPTION 'AFTERCARE215_EXCHANGE_EVIDENCE_INVALID'; END IF;
 IF r.supplier_operation_id IS NOT NULL THEN
  PERFORM public.sr208_assert_operation_internal(r.supplier_operation_id);
  IF NOT EXISTS(SELECT 1 FROM public.business_operations tail WHERE tail.id=r.supplier_operation_id AND tail.initiated_by=ctx.created_by
   AND tail.request_identity_snapshot=jsonb_build_object('action','customer_return_subset215','returnOperationId',r.return_operation_id,'supplierAssignments',plan->'request'->'returnRequest'->'supplierAssignments'))
  THEN RAISE EXCEPTION 'AFTERCARE215_EXCHANGE_EVIDENCE_INVALID'; END IF;
 END IF;
END $$;

CREATE FUNCTION public.settle_sales_exchange_v1(p_payload JSONB,p_idempotency_key TEXT,p_preview_fingerprint TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_variable
DECLARE actor UUID:=auth.uid(); request JSONB; plan JSONB; identity JSONB; fingerprint TEXT; key TEXT; actor_hash TEXT;
 operation UUID:=gen_random_uuid(); old public.business_operations%ROWTYPE; pos_key TEXT; return_key TEXT; return_actor_hash TEXT;
 pos_result JSONB; return_result JSONB; supplier_operation UUID; result JSONB; at TIMESTAMPTZ:=clock_timestamp(); base JSONB; discovered_customer UUID; locked_customer UUID;
BEGIN
 PERFORM public.assert_erp_role(ARRAY['owner','admin'],'تأكيد تبديل بصنف آخر');
 IF auth.role() IS DISTINCT FROM 'authenticated' OR actor IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='AFTERCARE215_ROLE_DENIED'; END IF;
 request:=public.tb215_canonical_exchange_internal(p_payload);
 IF jsonb_array_length(request->'returnRequest'->'supplierAssignments')>0 THEN PERFORM public.sr208_assert_role_internal('customer_return'); END IF;
 key:=public.phase4_canonicalize_idempotency_key_internal(p_idempotency_key);
 IF length(key)>200 OR COALESCE(p_preview_fingerprint,'')!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'AFTERCARE215_PREVIEW_REQUIRED'; END IF;
 identity:=jsonb_build_object('request',request,'previewFingerprint',p_preview_fingerprint);fingerprint:=encode(extensions.digest(identity::TEXT,'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('aftercare215|'||actor::TEXT||'|'||key,0));
 SELECT * INTO old FROM public.business_operations WHERE operation_type='aftercare215_exchange' AND initiated_by=actor AND idempotency_key=key;
 IF FOUND THEN
  IF old.request_fingerprint IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'AFTERCARE215_IDEMPOTENCY_CONFLICT'; END IF;
  PERFORM public.tb215_assert_exchange_internal(old.id);
  RETURN(old.result_snapshot-'evidenceFingerprint')||jsonb_build_object('idempotentReplay',true);
 END IF;
 pos_key:='aftercare215-exchange-pos-'||encode(extensions.digest(actor::TEXT||'|'||key,'sha256'),'hex');
 return_key:='aftercare215-exchange-return-'||encode(extensions.digest(actor::TEXT||'|'||key,'sha256'),'hex');
 actor_hash:=public.phase3_actor_scope_hash_internal('erp_user',actor,NULL,NULL);
 -- All inner identity locks precede order/shift and the combined product set.
 PERFORM pg_advisory_xact_lock(hashtext(pos_key));
 PERFORM pg_advisory_xact_lock(hashtextextended('phase4-operation|phase4_return_v1|'||actor_hash||'|'||return_key,0));
 IF EXISTS(SELECT 1 FROM public.business_operations WHERE idempotency_key IN(pos_key,return_key))
  OR EXISTS(SELECT 1 FROM public.orders WHERE idempotency_key=pos_key)
  OR EXISTS(SELECT 1 FROM public.pos_uncommitted_attempt_cancellations WHERE actor_id=actor AND idempotency_key=pos_key)
 THEN RAISE EXCEPTION 'AFTERCARE215_LEGACY_KEY_CONFLICT'; END IF;
 -- Match collection/POS parent ordering before taking order,shift or stock.
 SELECT customer_id INTO discovered_customer FROM public.orders WHERE id=(request->'returnRequest'->'baseRequest'->>'order_id')::UUID;
 IF discovered_customer IS NOT NULL THEN PERFORM 1 FROM public.customers WHERE id=discovered_customer FOR UPDATE; END IF;
 PERFORM public.phase4_lock_customer_order_context_internal((request->'returnRequest'->'baseRequest'->>'order_id')::UUID,true,false);
 SELECT customer_id INTO locked_customer FROM public.orders WHERE id=(request->'returnRequest'->'baseRequest'->>'order_id')::UUID;
 IF locked_customer IS DISTINCT FROM discovered_customer THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='AFTERCARE215_CUSTOMER_CHANGED_RETRY'; END IF;
 plan:=public.tb215_prepare_exchange_internal(request);
 PERFORM public.phase2_lock_inventory_products_internal(ARRAY(
  SELECT DISTINCT id FROM(SELECT (s->>'product_id')::UUID id FROM jsonb_array_elements(plan->'returnPlan'->'physicalSources') s
   UNION SELECT (plan->>'productId')::UUID) ids ORDER BY id));
 plan:=public.tb215_prepare_exchange_internal(request);
 IF encode(extensions.digest(plan::TEXT,'sha256'),'hex') IS DISTINCT FROM p_preview_fingerprint THEN RAISE EXCEPTION 'AFTERCARE215_PREVIEW_CHANGED'; END IF;
 IF jsonb_array_length(plan->'issues')>0 THEN RAISE EXCEPTION 'AFTERCARE215_FIELDS_REQUIRED'; END IF;
 INSERT INTO public.aftercare215_exchanges(operation_id,created_by,transaction_id,order_id,idempotency_key,return_key,pos_key,prepared_plan,preview_fingerprint,original_completed_at,created_at)
 VALUES(operation,actor,pg_current_xact_id(),(plan->>'orderId')::UUID,key,return_key,pos_key,plan,p_preview_fingerprint,
  (plan->'returnPlan'->'order'->>'completedAt')::TIMESTAMPTZ,at);
 pos_result:=public.tb215_exchange_pos_internal((plan->>'warehouseId')::UUID,(plan->>'branchId')::UUID,(plan->>'customerId')::UUID,
  plan->>'customerName','exchange_credit',jsonb_build_array(plan->'line'),0,0,pos_key);
 base:=plan->'returnPlan'->'request'->'baseRequest';
 return_result:=public.tb215_exchange_return_internal((plan->>'orderId')::UUID,return_key,base->'items',base->>'reason','exchange_credit',NULL,base->>'notes');
 supplier_operation:=public.tb215_hold_return_subset_internal((return_result->>'operationId')::UUID,request->'returnRequest'->'supplierAssignments',return_key,base->>'reason');
 INSERT INTO public.aftercare215_exchange_results(operation_id,return_operation_id,new_order_id,supplier_operation_id)
 VALUES(operation,(return_result->>'operationId')::UUID,(pos_result->>'orderId')::UUID,supplier_operation);
 result:=public.tb215_exchange_public_result_internal(operation)||jsonb_build_object('evidenceFingerprint',encode(extensions.digest(public.tb215_exchange_manifest_internal(operation)::TEXT,'sha256'),'hex'));
 INSERT INTO public.business_operations(id,operation_type,idempotency_key,request_fingerprint,initiated_by,result_snapshot,completed_at,request_identity_version,request_identity_snapshot,actor_scope_type,actor_scope_hash)
 VALUES(operation,'aftercare215_exchange',key,fingerprint,actor,result,at,215,identity,'erp_user',actor_hash);
 PERFORM public.tb215_assert_exchange_internal(operation);
 RETURN(result-'evidenceFingerprint')||jsonb_build_object('idempotentReplay',false);
END $$;

CREATE FUNCTION public.tb215_exchange_completion_guard_internal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN PERFORM public.tb215_assert_exchange_internal(NEW.operation_id);RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER aftercare215_exchange_complete AFTER INSERT ON public.aftercare215_exchanges DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION public.tb215_exchange_completion_guard_internal();
CREATE FUNCTION public.tb215_exchange_financial_adjustment_internal(p_facts JSONB,p_branch_id UUID,p_start TIMESTAMPTZ,p_end TIMESTAMPTZ,p_timezone TEXT,p_verify BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result JSONB:=p_facts; false_collections BIGINT; credit_refunds BIGINT; cash_in BIGINT; cliq_in BIGINT; cash_out BIGINT; cliq_out BIGINT;
 day JSONB; days JSONB:='[]'; day_false BIGINT; day_cash BIGINT; day_cliq BIGINT; day_date DATE;
BEGIN
 IF p_verify THEN PERFORM public.tb215_assert_exchange_internal(x.operation_id) FROM public.aftercare215_exchanges x
  JOIN public.aftercare215_exchange_results r ON r.operation_id=x.operation_id JOIN public.orders o ON o.id=r.new_order_id
  JOIN public.business_operations b ON b.id=o.operation_id JOIN public.sales_return_events e ON e.operation_id=r.return_operation_id
  WHERE(p_branch_id IS NULL OR o.branch_id=p_branch_id) AND(x.created_at>=p_start AND x.created_at<p_end OR b.completed_at>=p_start AND b.completed_at<p_end OR e.settled_at>=p_start AND e.settled_at<p_end); END IF;
 SELECT COALESCE(sum(o.total_in_minor_units) FILTER(WHERE b.completed_at>=p_start AND b.completed_at<p_end),0),
  COALESCE(sum((x.prepared_plan->>'internalCreditInMinorUnits')::BIGINT) FILTER(WHERE e.settled_at>=p_start AND e.settled_at<p_end),0),
  COALESCE(sum((x.prepared_plan->>'moneyReceivedInMinorUnits')::BIGINT) FILTER(WHERE x.created_at>=p_start AND x.created_at<p_end AND x.prepared_plan->>'differenceMethod'='cash'),0),
  COALESCE(sum((x.prepared_plan->>'moneyReceivedInMinorUnits')::BIGINT) FILTER(WHERE x.created_at>=p_start AND x.created_at<p_end AND x.prepared_plan->>'differenceMethod'='cliq'),0),
  COALESCE(sum((x.prepared_plan->>'moneyRefundInMinorUnits')::BIGINT) FILTER(WHERE x.created_at>=p_start AND x.created_at<p_end AND x.prepared_plan->>'differenceMethod'='cash'),0),
  COALESCE(sum((x.prepared_plan->>'moneyRefundInMinorUnits')::BIGINT) FILTER(WHERE x.created_at>=p_start AND x.created_at<p_end AND x.prepared_plan->>'differenceMethod'='cliq'),0)
 INTO false_collections,credit_refunds,cash_in,cliq_in,cash_out,cliq_out
 FROM public.aftercare215_exchanges x JOIN public.aftercare215_exchange_results r ON r.operation_id=x.operation_id
 JOIN public.orders o ON o.id=r.new_order_id JOIN public.business_operations b ON b.id=o.operation_id
 JOIN public.sales_return_events e ON e.operation_id=r.return_operation_id WHERE p_branch_id IS NULL OR o.branch_id=p_branch_id;
 result:=jsonb_set(result,'{sales,refundsInMinorUnits}',to_jsonb((result->'sales'->>'refundsInMinorUnits')::BIGINT-credit_refunds));
 result:=jsonb_set(result,'{cashFlow,customerCollections,otherInMinorUnits}',to_jsonb((result->'cashFlow'->'customerCollections'->>'otherInMinorUnits')::BIGINT-false_collections));
 result:=jsonb_set(result,'{cashFlow,customerCollections,totalInMinorUnits}',to_jsonb((result->'cashFlow'->'customerCollections'->>'totalInMinorUnits')::BIGINT-false_collections+cash_in+cliq_in));
 result:=jsonb_set(result,'{cashFlow,customerCollections,cashInMinorUnits}',to_jsonb((result->'cashFlow'->'customerCollections'->>'cashInMinorUnits')::BIGINT+cash_in));
 result:=jsonb_set(result,'{cashFlow,customerCollections,cliqInMinorUnits}',to_jsonb((result->'cashFlow'->'customerCollections'->>'cliqInMinorUnits')::BIGINT+cliq_in));
 result:=jsonb_set(result,'{cashFlow,cashCollectedInMinorUnits}',to_jsonb((result->'cashFlow'->>'cashCollectedInMinorUnits')::BIGINT+cash_in));
 result:=jsonb_set(result,'{cashFlow,cliqCollectedInMinorUnits}',to_jsonb((result->'cashFlow'->>'cliqCollectedInMinorUnits')::BIGINT+cliq_in));
 result:=jsonb_set(result,'{cashFlow,cashRefundedInMinorUnits}',to_jsonb((result->'cashFlow'->>'cashRefundedInMinorUnits')::BIGINT+cash_out));
 result:=jsonb_set(result,'{cashFlow,cliqRefundedInMinorUnits}',to_jsonb((result->'cashFlow'->>'cliqRefundedInMinorUnits')::BIGINT+cliq_out));
 result:=jsonb_set(result,'{cashFlow,cashNetFlowInMinorUnits}',to_jsonb((result->'cashFlow'->>'cashNetFlowInMinorUnits')::BIGINT+cash_in-cash_out));
 result:=jsonb_set(result,'{cashFlow,cliqNetFlowInMinorUnits}',to_jsonb((result->'cashFlow'->>'cliqNetFlowInMinorUnits')::BIGINT+cliq_in-cliq_out));
 FOR day IN SELECT value FROM jsonb_array_elements(result->'dailyBreakdown') LOOP
  day_date:=(day->>'date')::DATE;
  SELECT COALESCE(sum(o.total_in_minor_units) FILTER(WHERE b.completed_at>=p_start AND b.completed_at<p_end AND(b.completed_at AT TIME ZONE p_timezone)::DATE=day_date),0),
   COALESCE(sum((x.prepared_plan->>'moneyReceivedInMinorUnits')::BIGINT) FILTER(WHERE x.created_at>=p_start AND x.created_at<p_end AND(x.created_at AT TIME ZONE p_timezone)::DATE=day_date AND x.prepared_plan->>'differenceMethod'='cash'),0),
   COALESCE(sum((x.prepared_plan->>'moneyReceivedInMinorUnits')::BIGINT) FILTER(WHERE x.created_at>=p_start AND x.created_at<p_end AND(x.created_at AT TIME ZONE p_timezone)::DATE=day_date AND x.prepared_plan->>'differenceMethod'='cliq'),0)
  INTO day_false,day_cash,day_cliq FROM public.aftercare215_exchanges x JOIN public.aftercare215_exchange_results r ON r.operation_id=x.operation_id
  JOIN public.orders o ON o.id=r.new_order_id JOIN public.business_operations b ON b.id=o.operation_id WHERE p_branch_id IS NULL OR o.branch_id=p_branch_id;
  day:=jsonb_set(day,'{customerCollections,otherInMinorUnits}',to_jsonb((day->'customerCollections'->>'otherInMinorUnits')::BIGINT-day_false));
  day:=jsonb_set(day,'{customerCollections,totalInMinorUnits}',to_jsonb((day->'customerCollections'->>'totalInMinorUnits')::BIGINT-day_false+day_cash+day_cliq));
  day:=jsonb_set(day,'{customerCollections,cashInMinorUnits}',to_jsonb((day->'customerCollections'->>'cashInMinorUnits')::BIGINT+day_cash));
  day:=jsonb_set(day,'{customerCollections,cliqInMinorUnits}',to_jsonb((day->'customerCollections'->>'cliqInMinorUnits')::BIGINT+day_cliq));
  day:=jsonb_set(day,'{cashCollectedInMinorUnits}',to_jsonb((day->>'cashCollectedInMinorUnits')::BIGINT+day_cash));
  day:=jsonb_set(day,'{cliqCollectedInMinorUnits}',to_jsonb((day->>'cliqCollectedInMinorUnits')::BIGINT+day_cliq));
  days:=days||jsonb_build_array(day);
 END LOOP;
 RETURN jsonb_set(result,'{dailyBreakdown}',days);
END $$;

ALTER FUNCTION public.get_cash_shift_summary(UUID) RENAME TO tb215_shift_before_exchange_internal;
CREATE FUNCTION public.get_cash_shift_summary(p_shift_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result JSONB; status TEXT; cash_in BIGINT; cliq_in BIGINT; cash_out BIGINT; cliq_out BIGINT;
BEGIN
 result:=public.tb215_shift_before_exchange_internal(p_shift_id);
 SELECT s.status INTO status FROM public.cash_shifts s WHERE s.id=p_shift_id;
 IF status IS DISTINCT FROM 'open' THEN RETURN result; END IF;
 SELECT COALESCE(sum((x.prepared_plan->>'moneyReceivedInMinorUnits')::BIGINT) FILTER(WHERE x.prepared_plan->>'differenceMethod'='cash'),0),
  COALESCE(sum((x.prepared_plan->>'moneyReceivedInMinorUnits')::BIGINT) FILTER(WHERE x.prepared_plan->>'differenceMethod'='cliq'),0),
  COALESCE(sum((x.prepared_plan->>'moneyRefundInMinorUnits')::BIGINT) FILTER(WHERE x.prepared_plan->>'differenceMethod'='cash'),0),
  COALESCE(sum((x.prepared_plan->>'moneyRefundInMinorUnits')::BIGINT) FILTER(WHERE x.prepared_plan->>'differenceMethod'='cliq'),0)
 INTO cash_in,cliq_in,cash_out,cliq_out FROM public.aftercare215_exchanges x JOIN public.aftercare215_exchange_results r ON r.operation_id=x.operation_id
 WHERE(x.prepared_plan->>'cashShiftId')::UUID=p_shift_id;
 result:=jsonb_set(result,'{cashSalesInMinorUnits}',to_jsonb((result->>'cashSalesInMinorUnits')::BIGINT+cash_in));
 result:=jsonb_set(result,'{cliqSalesInMinorUnits}',to_jsonb((result->>'cliqSalesInMinorUnits')::BIGINT+cliq_in));
 result:=jsonb_set(result,'{cashRefundsInMinorUnits}',to_jsonb((result->>'cashRefundsInMinorUnits')::BIGINT+cash_out));
 result:=jsonb_set(result,'{cliqRefundsInMinorUnits}',to_jsonb((result->>'cliqRefundsInMinorUnits')::BIGINT+cliq_out));
 RETURN jsonb_set(result,'{expectedCashInMinorUnits}',to_jsonb((result->>'expectedCashInMinorUnits')::BIGINT+cash_in-cash_out));
END $$;
-- Keep the original aftercare deadline across an exchange; the new sale's
-- accounting time remains its own completion time for sales/collection facts.
ALTER FUNCTION public.phase4_authoritative_completion_internal(UUID) RENAME TO tb215_completion_before_exchange_internal;
CREATE FUNCTION public.phase4_authoritative_completion_internal(p_order_id UUID)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE completed TIMESTAMPTZ; original TIMESTAMPTZ;
BEGIN
 completed:=public.tb215_completion_before_exchange_internal(p_order_id);
 SELECT x.original_completed_at INTO original FROM public.aftercare215_exchange_results r JOIN public.aftercare215_exchanges x ON x.operation_id=r.operation_id
 WHERE r.new_order_id=p_order_id;
 RETURN LEAST(completed,COALESCE(original,completed));
END $$;
CREATE FUNCTION public.tb215_inspection_public_result_internal(p_operation_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('success',true,'contractVersion',215,'operationId',i.operation_id,'orderId',i.order_id,'replacementId',e.id,
  'issuedQuantity',(SELECT COALESCE(sum(f.issued_quantity),0) FROM public.phase43_replacement_inventory_effects f WHERE f.operation_id=i.replacement_operation_id),
  'restockedQuantity',(SELECT sum(m.good_quantity) FROM public.aftercare215_inspection_items m WHERE m.operation_id=i.operation_id),
  'badQuantity',(SELECT sum(m.bad_quantity) FROM public.aftercare215_inspection_items m WHERE m.operation_id=i.operation_id),
  'caseIds',to_jsonb(ARRAY(SELECT m.supplier_case_id FROM public.aftercare215_inspection_items m JOIN public.phase43_replacement_inventory_effects f ON f.replacement_item_id=m.replacement_item_id
   WHERE m.operation_id=i.operation_id AND m.supplier_case_id IS NOT NULL ORDER BY f.product_id,f.source_kind,f.source_id)),
  'moneyDifferenceInMinorUnits',0)
 FROM public.aftercare215_inspections i JOIN public.sales_replacement_events e ON e.operation_id=i.replacement_operation_id WHERE i.operation_id=p_operation_id;
$$;
CREATE FUNCTION public.tb215_return_public_result_internal(p_operation_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('success',true,'contractVersion',215,'operationId',c.operation_id,'returnOperationId',r.return_operation_id,
  'returnId',b.result_snapshot->'returnId','returnNumber',b.result_snapshot->'returnNumber','orderId',b.result_snapshot->'orderId',
  'entitlementInMinorUnits',(b.result_snapshot->>'merchandiseEntitlementInMinorUnits')::BIGINT::TEXT,
  'debtReductionInMinorUnits',(b.result_snapshot->>'debtReductionInMinorUnits')::BIGINT::TEXT,
  'moneyRefundInMinorUnits',(b.result_snapshot->>'moneyRefundInMinorUnits')::BIGINT::TEXT,'refundMethod',b.result_snapshot->'refundMethod',
  'goodQuantity',c.prepared_plan->'goodQuantity','badQuantity',c.prepared_plan->'badQuantity','customerDamageQuantity',c.prepared_plan->'customerDamageQuantity')
 FROM public.aftercare215_return_contexts c JOIN public.aftercare215_return_results r ON r.operation_id=c.operation_id
 JOIN public.business_operations b ON b.id=r.return_operation_id WHERE c.operation_id=p_operation_id;
$$;
CREATE FUNCTION public.tb215_exchange_public_result_internal(p_operation_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('success',true,'operationId',x.operation_id,'originalOrderId',x.prepared_plan->'orderId','newOrderId',r.new_order_id,
  'newOrderNumber',o.order_number,'returnId',ret.result_snapshot->'returnId','returnNumber',ret.result_snapshot->'returnNumber',
  'internalCreditInMinorUnits',x.prepared_plan->'internalCreditInMinorUnits','newTotalInMinorUnits',x.prepared_plan->'newTotalInMinorUnits',
  'moneyReceivedInMinorUnits',x.prepared_plan->'moneyReceivedInMinorUnits','moneyRefundInMinorUnits',x.prepared_plan->'moneyRefundInMinorUnits',
  'differenceMethod',x.prepared_plan->'differenceMethod','referenceNumber',x.prepared_plan->'referenceNumber')
 FROM public.aftercare215_exchanges x JOIN public.aftercare215_exchange_results r ON r.operation_id=x.operation_id
 JOIN public.orders o ON o.id=r.new_order_id JOIN public.business_operations ret ON ret.id=r.return_operation_id WHERE x.operation_id=p_operation_id;
$$;
CREATE OR REPLACE FUNCTION public.get_cash_shift_movement_page(p_shift_id uuid, p_kind text, p_method text DEFAULT 'cash'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_shift public.cash_shifts%ROWTYPE;
  v_summary JSONB;
  v_key TEXT;
  v_canonical BIGINT;
  v_end TIMESTAMPTZ;
  v_result JSONB;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','accountant'], 'عرض تفاصيل حركة الوردية');
  IF p_shift_id IS NULL OR p_kind IS NULL OR p_method IS NULL
    OR p_kind NOT IN ('sales','receipts','supplier_payments','expenses','refunds','withdrawals','withdrawal_returns')
    OR p_method NOT IN ('cash','cliq','card')
    OR (p_method='card' AND p_kind<>'sales')
    OR (p_kind IN ('withdrawals','withdrawal_returns') AND p_method<>'cash')
    OR p_page IS NULL OR p_page<1 OR p_page>1000000
    OR p_page_size IS NULL OR p_page_size<1 OR p_page_size>100
  THEN RAISE EXCEPTION 'معايير تفاصيل الوردية غير صالحة.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_shift FROM public.cash_shifts WHERE id=p_shift_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الوردية المحددة غير موجودة.' USING ERRCODE='22023'; END IF;
  v_summary:=public.get_cash_shift_summary(p_shift_id);
  v_end:=CASE WHEN v_shift.status='open' THEN NOW() ELSE COALESCE(v_shift.closed_at,NOW()) END;
  v_key:=CASE p_kind
    WHEN 'sales' THEN p_method||'SalesInMinorUnits'
    WHEN 'receipts' THEN p_method||'ReceiptsInMinorUnits'
    WHEN 'supplier_payments' THEN p_method||'SupplierPaymentsInMinorUnits'
    WHEN 'expenses' THEN p_method||'ExpensesInMinorUnits'
    WHEN 'refunds' THEN p_method||'RefundsInMinorUnits'
    WHEN 'withdrawals' THEN 'ownerWithdrawalsInMinorUnits'
    WHEN 'withdrawal_returns' THEN 'ownerWithdrawalReturnsInMinorUnits' END;
  v_canonical:=(v_summary->>v_key)::BIGINT;
  -- 044 fallback attribution and 078 reversal predicates are retained exactly.
  -- In particular a legacy reversed receipt with NULL shift still belongs to
  -- the old aggregate; it is labelled, never silently corrected by this reader.
  WITH attributed_sales AS (
    SELECT o.id,o.order_number,o.payment_method,o.total_in_minor_units,
      COALESCE((SELECT MIN(h.created_at) FROM public.order_status_history h
        WHERE h.order_id=o.id AND h.new_status='completed'),o.updated_at) at,
      o.cash_shift_id
    FROM public.orders o WHERE p_kind='sales' AND o.branch_id=v_shift.branch_id
      AND o.status IN ('completed','returned')
      AND (o.payment_method::TEXT=p_method OR (p_method='cash' AND o.payment_method='cash_on_delivery'))
  ), evidence(source,id,reference,at,method,amount,note) AS (
    SELECT 'order'::TEXT,o.id,o.order_number,o.at,p_method,o.total_in_minor_units,NULL::TEXT
    FROM attributed_sales o WHERE o.cash_shift_id=p_shift_id OR
      (o.cash_shift_id IS NULL AND o.at>=v_shift.opened_at AND o.at<=v_end)
    UNION ALL
    SELECT 'customer_payment',cp.id,o.order_number,cp.created_at,cp.payment_method::TEXT,cp.amount_in_minor_units,
      CASE WHEN cp.is_reversed THEN 'سند تاريخي بلا وردية؛ محفوظ ضمن إجمالي القارئ القديم' END
    FROM public.customer_payments cp JOIN public.orders o ON o.id=cp.order_id
    WHERE p_kind='receipts' AND cp.payment_method::TEXT=p_method AND o.branch_id=v_shift.branch_id
      AND o.payment_method='debt' AND (cp.cash_shift_id=p_shift_id OR
        (cp.cash_shift_id IS NULL AND cp.created_at>=v_shift.opened_at AND cp.created_at<=v_end))
      AND NOT (COALESCE(cp.is_reversed,false) AND cp.cash_shift_id IS NOT NULL)
    UNION ALL
    SELECT 'opening_collection',c.id,c.operation_number,c.created_at,c.payment_method::TEXT,c.opening_amount_in_minor_units,'تحصيل دين البداية'
    FROM public.customer_collection_operations c WHERE p_kind='receipts' AND c.cash_shift_id=p_shift_id
      AND NOT c.is_reversed AND c.payment_method::TEXT=p_method AND c.opening_amount_in_minor_units>0
    UNION ALL
    SELECT 'cheque_collection',c.id,c.operation_number,c.created_at,c.payment_method::TEXT,c.compensation_amount_in_minor_units,'تحصيل تعويض شيك'
    FROM public.customer_collection_operations c WHERE p_kind='receipts' AND c.cash_shift_id=p_shift_id
      AND NOT c.is_reversed AND c.payment_method::TEXT=p_method AND c.compensation_amount_in_minor_units>0
    UNION ALL
    SELECT 'supplier_payment',sp.id,COALESCE(sr.receipt_number,po.purchase_order_number,sp.id::TEXT),sp.payment_date,sp.payment_method::TEXT,sp.amount_in_minor_units,NULL::TEXT
    FROM public.supplier_payments sp LEFT JOIN public.purchase_orders po ON po.id=sp.purchase_order_id
      LEFT JOIN public.supplier_receipts sr ON sr.id=sp.supplier_receipt_id
    WHERE p_kind='supplier_payments' AND sp.payment_method::TEXT=p_method
      AND COALESCE(po.branch_id,sr.branch_id)=v_shift.branch_id AND NOT COALESCE(sp.is_reversed,false)
      AND (sp.cash_shift_id=p_shift_id OR (sp.cash_shift_id IS NULL AND sp.payment_date>=v_shift.opened_at AND sp.payment_date<=v_end))
    UNION ALL
    SELECT 'supplier_opening_payment',sp.id,sp.id::TEXT,sp.payment_date,sp.payment_method::TEXT,sp.amount_in_minor_units,'دفعة دين بداية لمورد'
    FROM public.supplier_opening_payments l JOIN public.supplier_payments sp ON sp.id=l.supplier_payment_id
    WHERE p_kind='supplier_payments' AND l.cash_shift_id=p_shift_id AND sp.payment_method::TEXT=p_method AND NOT COALESCE(sp.is_reversed,false)
    UNION ALL
    SELECT 'supplier_cheque_payment',sp.id,c.reference,sp.payment_date,sp.payment_method::TEXT,l.amount_in_minor_units,'دفعة تعويض شيك لمورد'
    FROM public.supplier_cheque_claim_payments l JOIN public.supplier_payments sp ON sp.id=l.supplier_payment_id
      JOIN public.cheque_compensation_claims c ON c.id=l.claim_id
    WHERE p_kind='supplier_payments' AND l.cash_shift_id=p_shift_id AND sp.payment_method::TEXT=p_method AND NOT sp.is_reversed
    UNION ALL
    SELECT 'expense',e.id,e.expense_number,e.created_at,e.payment_method::TEXT,e.amount_in_minor_units,e.description
    FROM public.operational_expenses e WHERE p_kind='expenses' AND e.shift_id=p_shift_id
      AND e.payment_method::TEXT=p_method AND NOT COALESCE(e.is_reversed,false)
    UNION ALL
    SELECT 'legacy_return',r.id,r.return_number,r.created_at,r.refund_method::TEXT,r.refund_amount_in_minor_units,'مرتجع تاريخي'
    FROM public.sales_returns r WHERE p_kind='refunds' AND r.cash_shift_id=p_shift_id AND r.refund_method::TEXT=p_method
    UNION ALL
    SELECT 'return_event',r.id,r.id::TEXT,r.created_at,r.refund_method::TEXT,r.money_refund_amount_in_minor_units,'مبلغ مسترد مسوّى'
    FROM public.sales_return_events r WHERE p_kind='refunds' AND r.cash_shift_id=p_shift_id AND r.refund_method::TEXT=p_method
      AND r.settlement_status='settled' AND r.money_refund_amount_in_minor_units>0
    UNION ALL
    SELECT 'order',o.id,o.order_number,x.created_at,p_method,(x.prepared_plan->>'moneyReceivedInMinorUnits')::BIGINT,'فرق مستلم من تبديل بصنف آخر'
    FROM public.aftercare215_exchanges x JOIN public.aftercare215_exchange_results result ON result.operation_id=x.operation_id JOIN public.orders o ON o.id=result.new_order_id
    WHERE p_kind='sales' AND(x.prepared_plan->>'cashShiftId')::UUID=p_shift_id AND x.prepared_plan->>'differenceMethod'=p_method
     AND(x.prepared_plan->>'moneyReceivedInMinorUnits')::BIGINT>0
    UNION ALL
    SELECT 'return_event',r.id,r.return_number,x.created_at,p_method,(x.prepared_plan->>'moneyRefundInMinorUnits')::BIGINT,'فرق مرجع من تبديل بصنف آخر'
    FROM public.aftercare215_exchanges x JOIN public.aftercare215_exchange_results result ON result.operation_id=x.operation_id JOIN public.sales_return_events r ON r.operation_id=result.return_operation_id
    WHERE p_kind='refunds' AND(x.prepared_plan->>'cashShiftId')::UUID=p_shift_id AND x.prepared_plan->>'differenceMethod'=p_method
     AND(x.prepared_plan->>'moneyRefundInMinorUnits')::BIGINT>0
    UNION ALL
    SELECT 'owner_withdrawal',w.id,w.withdrawal_number,w.created_at,'cash',w.amount_in_minor_units,'سحب مالك'
    FROM public.owner_cash_withdrawals w WHERE p_kind='withdrawals' AND w.cash_shift_id=p_shift_id
    UNION ALL
    SELECT 'owner_withdrawal_return',r.id,w.withdrawal_number,r.reversed_at,'cash',r.amount_in_minor_units,
      'إرجاع سحب من '||s.shift_number
    FROM public.owner_cash_withdrawal_reversals r JOIN public.owner_cash_withdrawals w ON w.id=r.withdrawal_id
      JOIN public.cash_shifts s ON s.id=w.cash_shift_id
    WHERE p_kind='withdrawal_returns' AND r.effective_shift_id=p_shift_id AND r.voided_at IS NULL
  ), totals AS (
    SELECT COUNT(*) count,COALESCE(SUM(amount),0) amount FROM evidence
  ), page AS (
    SELECT * FROM evidence ORDER BY at DESC,id DESC,source
    LIMIT p_page_size OFFSET ((p_page::BIGINT-1)*p_page_size)
  ) SELECT jsonb_build_object(
    'shiftId',p_shift_id,'kind',p_kind,'method',p_method,'generatedAt',NOW(),
    'shiftStatus',v_shift.status,'canonicalAmountInMinorUnits',v_canonical,
    'totalAmountInMinorUnits',totals.amount,'totalCount',totals.count,
    'page',p_page,'pageSize',p_page_size,'totalPages',GREATEST(1,CEIL(totals.count::NUMERIC/p_page_size)),
    'evidenceStatus',CASE WHEN v_canonical IS NULL THEN 'unavailable' WHEN v_canonical=totals.amount THEN 'matched' ELSE 'mismatch' END,
    'rows',COALESCE((SELECT jsonb_agg(jsonb_build_object('source',source,'id',id,'reference',reference,
      'at',at,'method',method,'amountInMinorUnits',amount,'note',note)||public.trial212_cash_metadata_internal(source,id) ORDER BY at DESC,id DESC,source) FROM page),'[]'::JSONB)
  ) INTO v_result FROM totals;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public._get_cash_shift_closing_report_before_snapshot(p_shift_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_report JSONB;
  v_base_report JSONB;
  v_event_count INTEGER := 0;
  v_exchange_refund_count INTEGER := 0;
  v_internal_exchange_credit BIGINT := 0;
  v_breakdown JSONB;
  v_quantity_breakdown JSONB;
  v_shift public.cash_shifts%ROWTYPE;
  v_gross BIGINT;
  v_credit BIGINT;
  v_first_cash BIGINT;
  v_first_cliq BIGINT;
  v_first_total BIGINT;
  v_direct_collected BIGINT;
  v_unproven INTEGER;
  v_debt_reduction BIGINT;
  v_return_entitlement BIGINT;
BEGIN
  v_report := public._get_cash_shift_closing_report_before_return_events(p_shift_id);
  IF COALESCE(v_report->>'success', 'false') <> 'true' THEN
    RETURN v_report;
  END IF;
  SELECT COUNT(*)::INTEGER INTO v_event_count
  FROM public.sales_return_events
  WHERE cash_shift_id = p_shift_id
    AND settlement_status = 'settled'
    AND money_refund_amount_in_minor_units > 0 AND refund_method<>'exchange_credit';
  SELECT count(*) INTO v_exchange_refund_count FROM public.aftercare215_exchanges x JOIN public.aftercare215_exchange_results r ON r.operation_id=x.operation_id
  WHERE(x.prepared_plan->>'cashShiftId')::UUID=p_shift_id AND(x.prepared_plan->>'moneyRefundInMinorUnits')::BIGINT>0;
  v_event_count:=v_event_count+v_exchange_refund_count;

  IF v_event_count > 0 THEN
    WITH combined AS (
      SELECT
        item->>'refundMethod' AS refund_method,
        item->>'stockDisposition' AS stock_disposition,
        COALESCE((item->>'count')::INTEGER, 0) AS item_count,
        COALESCE((item->>'amountInMinorUnits')::BIGINT, 0) AS amount
      FROM jsonb_array_elements(COALESCE(v_report->'returnBreakdown', '[]'::JSONB)) item
      UNION ALL
      SELECT
        return_event.refund_method,
        CASE WHEN EXISTS (
          SELECT 1 FROM public.sales_return_items return_item
          WHERE return_item.sales_return_event_id = return_event.id
            AND return_item.stock_disposition = 'damaged'
        ) THEN 'damaged' ELSE 'restock' END,
        1,
        return_event.money_refund_amount_in_minor_units
      FROM public.sales_return_events return_event
      WHERE return_event.cash_shift_id = p_shift_id
        AND return_event.settlement_status = 'settled'
        AND return_event.money_refund_amount_in_minor_units > 0 AND return_event.refund_method<>'exchange_credit'
      UNION ALL
      SELECT x.prepared_plan->>'differenceMethod',CASE WHEN EXISTS(SELECT 1 FROM public.sales_return_items i WHERE i.sales_return_event_id=e.id AND i.stock_disposition='damaged') THEN 'damaged' ELSE 'restock' END,
       1,(x.prepared_plan->>'moneyRefundInMinorUnits')::BIGINT
      FROM public.aftercare215_exchanges x JOIN public.aftercare215_exchange_results r ON r.operation_id=x.operation_id JOIN public.sales_return_events e ON e.operation_id=r.return_operation_id
      WHERE(x.prepared_plan->>'cashShiftId')::UUID=p_shift_id AND(x.prepared_plan->>'moneyRefundInMinorUnits')::BIGINT>0
    ), grouped AS (
      SELECT refund_method, stock_disposition,
        SUM(item_count)::INTEGER AS item_count, SUM(amount)::BIGINT AS amount
      FROM combined
      GROUP BY refund_method, stock_disposition
    )
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'refundMethod', refund_method,
        'stockDisposition', stock_disposition,
        'count', item_count,
        'amountInMinorUnits', amount
      ) ORDER BY amount DESC, refund_method, stock_disposition
    ), '[]'::JSONB)
    INTO v_breakdown
    FROM grouped;

    v_report := jsonb_set(v_report, '{returnBreakdown}', v_breakdown, true);
    v_report := jsonb_set(
      v_report,
      '{outflows,returnCount}',
      to_jsonb(COALESCE((v_report #>> '{outflows,returnCount}')::INTEGER, 0) + v_event_count),
      true
    );
  END IF;

  WITH quantities AS (
    -- Modern allocated returns preserve three independent buckets per physical
    -- leaf. A root inspection's accepted disposition cannot classify all its
    -- accepted quantity: it may contain both sellable and supplier-defect units.
    SELECT e.id AS event_id, (leaf->>'product_id')::UUID AS product_id,
      (leaf->>'sellable_restock_quantity')::INTEGER AS sellable,
      (leaf->>'defect_non_sellable_quantity')::INTEGER AS defect,
      (leaf->>'customer_damage_quantity')::INTEGER AS damage
    FROM public.sales_return_events e
    JOIN public.business_operations op ON op.id = e.operation_id
    CROSS JOIN LATERAL jsonb_array_elements(op.request_identity_snapshot->'physical_sources') leaf
    WHERE e.cash_shift_id = p_shift_id AND e.settlement_status = 'settled' AND e.contract_version = 401
      AND jsonb_typeof(op.request_identity_snapshot->'physical_sources') = 'array'
    UNION ALL
    SELECT e.id, i.product_id,
      CASE WHEN i.stock_disposition = 'restock' THEN i.accepted_base_quantity ELSE 0 END,
      CASE WHEN i.stock_disposition = 'damaged' THEN i.accepted_base_quantity ELSE 0 END,
      i.rejected_base_quantity
    FROM public.sales_return_events e
    JOIN public.sales_return_items i ON i.sales_return_event_id = e.id
    JOIN public.business_operations op ON op.id = e.operation_id
    WHERE e.cash_shift_id = p_shift_id AND e.settlement_status = 'settled' AND e.contract_version = 401
      AND i.return_scope = 'base_unit'
      AND NOT (op.request_identity_snapshot ? 'physical_sources')
    UNION ALL
    SELECT e.id, c.product_id,
      CASE WHEN c.accepted_stock_disposition = 'restock' THEN c.accepted_quantity ELSE 0 END,
      CASE WHEN c.accepted_stock_disposition = 'non_sellable' THEN c.accepted_quantity ELSE 0 END,
      c.rejected_quantity
    FROM public.sales_return_events e
    JOIN public.sales_return_items i ON i.sales_return_event_id = e.id
    JOIN public.sales_return_component_inspections c ON c.sales_return_item_id = i.id
    JOIN public.business_operations op ON op.id = e.operation_id
    WHERE e.cash_shift_id = p_shift_id AND e.settlement_status = 'settled' AND e.contract_version = 401
      AND NOT (op.request_identity_snapshot ? 'physical_sources')
    UNION ALL
    SELECT e.id, i.product_id,
      CASE WHEN e.stock_disposition = 'restock' THEN i.quantity ELSE 0 END,
      CASE WHEN e.stock_disposition = 'damaged' THEN i.quantity ELSE 0 END,
      0
    FROM public.sales_returns e
    JOIN public.order_items i ON i.order_id = e.order_id
    WHERE e.cash_shift_id = p_shift_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'eventId', q.event_id, 'productId', q.product_id,
    'productName', COALESCE(p.name_ar, 'صنف تاريخي'),
    'sellableQuantity', q.sellable, 'defectQuantity', q.defect,
    'customerDamageQuantity', q.damage) ORDER BY q.event_id, q.product_id), '[]'::JSONB)
  INTO v_quantity_breakdown
  FROM quantities q LEFT JOIN public.products p ON p.id = q.product_id;

  -- Preserve the full131 Return projection even if only133 sales enrichment fails.
  v_report := v_report || jsonb_build_object('returnQuantityBreakdown',v_quantity_breakdown);
  v_base_report:=v_report;
  BEGIN

  SELECT * INTO STRICT v_shift FROM public.cash_shifts WHERE id=p_shift_id;
  SELECT COALESCE(sum((x.prepared_plan->>'internalCreditInMinorUnits')::BIGINT),0) INTO v_internal_exchange_credit
  FROM public.aftercare215_exchanges x JOIN public.aftercare215_exchange_results r ON r.operation_id=x.operation_id
  WHERE(x.prepared_plan->>'cashShiftId')::UUID=p_shift_id;

  -- Completion-time truth is immutable. Later receipts/refunds do not turn
  -- newly-sold credit into a different sale. Existing cash/receipt/reconciliation
  -- fields in v_report are never rewritten by this presentation change.
  WITH first_completion AS MATERIALIZED (
    SELECT order_id,MAX(created_at) AS at FROM public.order_status_history
    WHERE new_status='completed' GROUP BY order_id
  ), completions AS MATERIALIZED (
    SELECT DISTINCT ON (operation.result_snapshot->>'order_id')
      operation.result_snapshot->>'order_id' AS order_key,
      operation.result_snapshot,operation.request_identity_snapshot
    FROM public.business_operations operation
    WHERE operation.operation_type='phase3_customer_completion_v1'
      AND operation.result_snapshot->>'order_id'=operation.request_identity_snapshot->>'order_id'
      AND operation.completed_at IS NOT NULL
    ORDER BY operation.result_snapshot->>'order_id',operation.completed_at,operation.id
  ), selected AS (
    SELECT customer_order.*,creation.operation_type,creation.result_snapshot AS creation_result,
      completion.result_snapshot AS completion_result,completion.request_identity_snapshot AS completion_request
    FROM public.orders customer_order
    LEFT JOIN first_completion ON first_completion.order_id=customer_order.id
    LEFT JOIN public.business_operations creation ON creation.id=customer_order.operation_id
    LEFT JOIN completions completion ON completion.order_key=customer_order.id::TEXT
    WHERE customer_order.branch_id=v_shift.branch_id
      AND customer_order.status IN('completed','returned')
      AND (customer_order.cash_shift_id=p_shift_id OR (
        customer_order.cash_shift_id IS NULL AND COALESCE(first_completion.at,customer_order.updated_at)>=v_shift.opened_at
        AND COALESCE(first_completion.at,customer_order.updated_at)<=COALESCE(v_shift.closed_at,NOW())
      ))
  ), anchors AS (
    SELECT selected.*,
      CASE WHEN operation_type='phase3_pos_sale_v1'
        THEN (creation_result->>'amountPaidInMinorUnits')::BIGINT
        WHEN operation_type='phase3_customer_reservation_v1'
        THEN (completion_result->>'amount_paid_in_minor_units')::BIGINT
        WHEN payment_method IN('cash','cash_on_delivery','cliq','card') THEN total_in_minor_units
        ELSE 0 END AS initial_collected,
      CASE WHEN operation_type='phase3_customer_reservation_v1'
        THEN NULLIF(completion_result->>'customer_payment_number','') END AS first_voucher_number
    FROM selected
  ), bound AS (
    SELECT anchors.*,payment.id AS first_payment_id,payment.amount_in_minor_units AS first_amount,
      payment.payment_method AS first_method,payment.order_id AS first_order_id,
      payment.cash_shift_id AS first_shift_id
    FROM anchors LEFT JOIN public.customer_payments payment ON payment.payment_number=anchors.first_voucher_number
  )
  SELECT COALESCE(SUM(total_in_minor_units),0)::BIGINT,
    COALESCE(SUM(total_in_minor_units-initial_collected),0)::BIGINT,
    COALESCE(SUM(first_amount) FILTER(WHERE first_method='cash'),0)::BIGINT,
    COALESCE(SUM(first_amount) FILTER(WHERE first_method='cliq'),0)::BIGINT,
    COUNT(*) FILTER(WHERE initial_collected IS NULL OR initial_collected<0
      OR initial_collected>total_in_minor_units OR (
        first_voucher_number IS NOT NULL AND (
          first_payment_id IS NULL OR first_order_id IS DISTINCT FROM id
          OR first_shift_id IS DISTINCT FROM p_shift_id OR first_amount IS DISTINCT FROM initial_collected
          OR first_method IS DISTINCT FROM completion_request->>'payment_method'
          OR first_method NOT IN('cash','cliq')
        )
      ))::INTEGER
  INTO v_gross,v_credit,v_first_cash,v_first_cliq,v_unproven
  FROM bound;

  v_first_total:=v_first_cash+v_first_cliq;
  v_direct_collected:=COALESCE((v_report#>>'{shift,cashSalesInMinorUnits}')::BIGINT,0)
    +COALESCE((v_report#>>'{shift,cliqSalesInMinorUnits}')::BIGINT,0)
    +COALESCE((v_report#>>'{shift,cardSalesInMinorUnits}')::BIGINT,0);
  IF v_unproven<>0 OR v_gross<>v_direct_collected+v_first_total+v_credit+v_internal_exchange_credit THEN
    RAISE EXCEPTION 'PHASE133_CLOSING_SALES_EVIDENCE_MISMATCH: لا يمكن إثبات توزيع مبيعات الوردية.';
  END IF;

  -- Existing refunds contain legacy + modern money exactly once. Debt-only
  -- Returns have no cash_shift_id; use authoritative settlement time inside
  -- this branch's non-overlapping shift window. No drawer projection changes.
  SELECT COALESCE(SUM(event.debt_reduction_amount_in_minor_units),0)::BIGINT
  INTO v_debt_reduction
  FROM public.sales_return_events event
  JOIN public.orders customer_order ON customer_order.id=event.order_id
  JOIN public.business_operations creation ON creation.id=customer_order.operation_id
  WHERE event.contract_version=401 AND event.settlement_status='settled'
    AND creation.operation_type IN('phase3_pos_sale_v1','phase3_customer_reservation_v1')
    AND event.branch_id=v_shift.branch_id
    AND (event.cash_shift_id=p_shift_id OR (
      event.cash_shift_id IS NULL AND event.settled_at>=v_shift.opened_at
      AND event.settled_at<COALESCE(v_shift.closed_at,NOW())
    ));
  v_return_entitlement:=COALESCE((v_report#>>'{sales,refundsInMinorUnits}')::BIGINT,0)+v_debt_reduction+v_internal_exchange_credit;

  v_report:=jsonb_set(v_report,'{sales}',(v_report->'sales')||jsonb_build_object(
    'salesDefinitionVersion',CASE WHEN v_internal_exchange_credit>0 THEN 215 ELSE 133 END,
    'grossSalesInMinorUnits',v_gross,
    'collectedDirectSalesInMinorUnits',v_direct_collected,
    'initialReceiptPaymentsInMinorUnits',v_first_total,
    'initialReceiptCashInMinorUnits',v_first_cash,
    'initialReceiptCliqInMinorUnits',v_first_cliq,
    'creditSalesInMinorUnits',v_credit,
    'returnEntitlementInMinorUnits',v_return_entitlement,
    'debtReductionInMinorUnits',v_debt_reduction,
    'netSalesInMinorUnits',v_gross-v_return_entitlement
  ));
  IF v_internal_exchange_credit>0 THEN
    v_report:=jsonb_set(v_report,'{sales}',(v_report->'sales')||jsonb_build_object('internalExchangeCreditInMinorUnits',v_internal_exchange_credit));
  END IF;
  v_report:=jsonb_set(v_report,'{collections}',(v_report->'collections')||jsonb_build_object(
    'initialPaymentsInMinorUnits',v_first_total,
    'initialCashInMinorUnits',v_first_cash,
    'initialCliqInMinorUnits',v_first_cliq
  ));
  RETURN v_report || jsonb_build_object('returnQuantityBreakdown', v_quantity_breakdown,'salesDetailStatus','available');
  EXCEPTION WHEN query_canceled THEN
    RETURN v_base_report || jsonb_build_object('salesDetailStatus','unavailable','salesDetailMessage','تفصيل غير متاح');
  WHEN OTHERS THEN
    RETURN v_base_report || jsonb_build_object('salesDetailStatus','unavailable','salesDetailMessage','تفصيل غير متاح');
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_public_pos_receipt(p_receipt_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_receipt JSONB;
BEGIN
  IF p_receipt_token IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'رابط الإيصال غير صحيح.');
  END IF;

  SELECT jsonb_build_object(
    'success', true,
    'orderNumber', o.order_number, 'createdAt', o.created_at, 'status', o.status,
    'paymentMethod', o.payment_method, 'paymentStatus', o.payment_status,
    'subtotalInMinorUnits', o.subtotal_in_minor_units,
    'discountInMinorUnits', o.discount_in_minor_units,
    'totalInMinorUnits', o.total_in_minor_units,
    'branch', jsonb_build_object('name', COALESCE(b.name_ar, 'محلات النواصرة'),
      'address', COALESCE(b.address, ''), 'phone', COALESCE(b.phone, '')),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'productName', oi.product_name_snapshot, 'sku', COALESCE(oi.sku_snapshot, ''),
        'packageQuantity', COALESCE(oi.sale_package_quantity, oi.quantity),
        'packageName', COALESCE(oi.sale_package_name_snapshot, 'طرد'),
        'unitsPerPackage', COALESCE(oi.units_per_sale_package, 1),
        'packagePriceInMinorUnits', COALESCE(oi.sale_package_price_in_minor_units, oi.unit_price_in_minor_units),
        'lineTotalInMinorUnits', oi.line_total_in_minor_units,
        'commercialLineKind', oi.commercial_line_kind,
        'baseQuantity', CASE WHEN oi.commercial_line_kind = 'configurable_parcel'
          THEN (SELECT SUM(c.base_quantity) FROM public.order_parcel_instances i
            JOIN public.order_parcel_components c ON c.parcel_instance_id = i.id
            WHERE i.order_item_id = oi.id AND i.order_id = o.id)
          ELSE oi.quantity END,
        'baseUnitName', oi.base_unit_name_snapshot,
        'parcelInstances', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('components', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'name', c.product_name_snapshot, 'quantity', c.base_quantity,
              'unitName', c.base_unit_name_snapshot
            ) ORDER BY c.product_name_snapshot, c.product_id)
            FROM public.order_parcel_components c WHERE c.parcel_instance_id = i.id
          ), '[]'::JSONB)) ORDER BY i.instance_sequence)
          FROM public.order_parcel_instances i
          WHERE i.order_item_id = oi.id AND i.order_id = o.id
        ), '[]'::JSONB)
      ) ORDER BY oi.created_at, oi.id)
      FROM public.order_items oi WHERE oi.order_id = o.id
    ), '[]'::JSONB)
  ) INTO v_receipt
  FROM public.orders o LEFT JOIN public.branches b ON b.id = o.branch_id
  WHERE o.public_receipt_token = p_receipt_token
    AND o.source = 'pos' AND o.status IN ('completed', 'returned');

  IF v_receipt IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'الإيصال غير موجود أو لم يعد متاحاً.');
  END IF;
  SELECT CASE WHEN x.operation_id IS NULL THEN v_receipt ELSE v_receipt||jsonb_build_object('exchange',jsonb_build_object(
   'internalCreditInMinorUnits',x.prepared_plan->'internalCreditInMinorUnits','newTotalInMinorUnits',x.prepared_plan->'newTotalInMinorUnits',
   'moneyReceivedInMinorUnits',x.prepared_plan->'moneyReceivedInMinorUnits','moneyRefundInMinorUnits',x.prepared_plan->'moneyRefundInMinorUnits',
   'differenceMethod',x.prepared_plan->'differenceMethod','referenceNumber',x.prepared_plan->'referenceNumber')) END INTO v_receipt
  FROM public.orders o LEFT JOIN public.aftercare215_exchange_results r ON r.new_order_id=o.id
  LEFT JOIN public.aftercare215_exchanges x ON x.operation_id=r.operation_id WHERE o.public_receipt_token=p_receipt_token;
  RETURN v_receipt;
END;
$function$;

DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['aftercare215_inspections','aftercare215_inspection_items','supplier215_credits','aftercare215_return_contexts','aftercare215_return_results','aftercare215_exchanges','aftercare215_exchange_results'] LOOP
  EXECUTE format('ALTER TABLE public.%I OWNER TO postgres',t);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.inventory_damage_reject_mutation_internal()',t||'_immutable',t);
  EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.inventory_damage_reject_mutation_internal()',t||'_no_truncate',t);
 END LOOP;
END $$;
ALTER FUNCTION public.tb215_canonical_inspection_internal(JSONB) OWNER TO postgres;
ALTER FUNCTION public.tb215_canonical_exchange_internal(JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tb215_canonical_exchange_internal(JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.tb215_prepare_exchange_internal(JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tb215_prepare_exchange_internal(JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.preview_sales_exchange_v1(JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.preview_sales_exchange_v1(JSONB) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.preview_sales_exchange_v1(JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.tb215_canonical_inspection_internal(JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.tb215_prepare_inspection_internal(JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tb215_prepare_inspection_internal(JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.tb215_read_sale_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tb215_read_sale_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.tb215_inspection_manifest_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tb215_inspection_manifest_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.tb215_assert_inspection_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tb215_assert_inspection_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.preview_inspected_sales_replacement_v2(JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.preview_inspected_sales_replacement_v2(JSONB) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.preview_inspected_sales_replacement_v2(JSONB) TO authenticated;
ALTER FUNCTION public.settle_inspected_sales_replacement_v2(JSONB,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.settle_inspected_sales_replacement_v2(JSONB,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.settle_inspected_sales_replacement_v2(JSONB,TEXT,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.tb215_supplier_evidence_before215_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.tb215_source_before215_internal(TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.tb215_blocked_before215_internal(TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.tb215_damage_candidates_before215_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.sr211_source_internal(TEXT,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sr211_source_internal(TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.sr211_blocked_internal(TEXT,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sr211_blocked_internal(TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.get_aftercare_damage_candidates_v1(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_aftercare_damage_candidates_v1(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_aftercare_damage_candidates_v1(UUID) TO authenticated;
ALTER FUNCTION public.tb215_supplier_membership_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tb215_supplier_membership_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.tb215_supplier_balance_before215_internal() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.phase133_supplier_balance_evidence_internal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.phase133_supplier_balance_evidence_internal() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.tb215_credit_plan_internal(TEXT,JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tb215_credit_plan_internal(TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.preview_supplier_replacement_credit_v1(TEXT,JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.preview_supplier_replacement_credit_v1(TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.preview_supplier_replacement_credit_v1(TEXT,JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.tb215_append_before215_internal(UUID,UUID,TEXT,INTEGER,INTEGER,BIGINT,INTEGER,TEXT,TIMESTAMPTZ,UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.sr208_append_event_internal(UUID,UUID,TEXT,INTEGER,INTEGER,BIGINT,INTEGER,TEXT,TIMESTAMPTZ,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sr208_append_event_internal(UUID,UUID,TEXT,INTEGER,INTEGER,BIGINT,INTEGER,TEXT,TIMESTAMPTZ,UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.tb215_assert_supplier_credit_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tb215_assert_supplier_credit_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.settle_supplier_replacement_credit_v1(TEXT,JSONB,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.settle_supplier_replacement_credit_v1(TEXT,JSONB,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.settle_supplier_replacement_credit_v1(TEXT,JSONB,TEXT,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.tb215_supplier_writer_before215_internal(TEXT,JSONB,TEXT) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.execute_supplier_replacement_v1(TEXT,JSONB,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.execute_supplier_replacement_v1(TEXT,JSONB,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.execute_supplier_replacement_v1(TEXT,JSONB,TEXT) TO authenticated;
ALTER FUNCTION public.get_supplier_replacement_credits_v1(UUID,INTEGER,INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_supplier_replacement_credits_v1(UUID,INTEGER,INTEGER) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_supplier_replacement_credits_v1(UUID,INTEGER,INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION public.tb215_case_dto_before215_internal(UUID,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.sr208_case_dto_internal(UUID,BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sr208_case_dto_internal(UUID,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.tb215_assert_return_allocation_internal(JSONB,JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tb215_assert_return_allocation_internal(JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.tb215_return_source_cost_internal(UUID,JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tb215_return_source_cost_internal(UUID,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.tb215_canonical_return_internal(JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tb215_canonical_return_internal(JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.tb215_prepare_return_internal(JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tb215_prepare_return_internal(JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.preview_admin_sales_return_v2(JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.preview_admin_sales_return_v2(JSONB) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.preview_admin_sales_return_v2(JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.tb215_return_allocation_before215_internal(JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.phase43_assert_return_allocation_contract_internal(JSONB,JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.phase43_assert_return_allocation_contract_internal(JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.tb215_hold_return_subset_internal(UUID,JSONB,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tb215_hold_return_subset_internal(UUID,JSONB,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.tb215_return_manifest_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tb215_return_manifest_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.tb215_assert_return_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tb215_assert_return_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.settle_admin_sales_return_v2(JSONB,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.settle_admin_sales_return_v2(JSONB,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.settle_admin_sales_return_v2(JSONB,TEXT,TEXT) TO authenticated;
ALTER FUNCTION public.tb215_guard_return_context_internal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tb215_guard_return_context_internal() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.sr208_assert_operation_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sr208_assert_operation_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.tb215_financial_facts_before215_internal(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.phase6_financial_facts_internal(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.phase6_financial_facts_internal(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;

DO $$ DECLARE f RECORD; BEGIN
 FOR f IN SELECT p.oid::regprocedure identity FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY(ARRAY['tb215_active_exchange_internal','tb215_assert_exchange_pos_admission_internal','tb215_assert_exchange_return_admission_internal','tb215_exchange_canonical_return_internal','tb215_assert_exchange_return_event_internal','tb215_guard_exchange_return_insert_internal','tb215_exchange_pos_internal','tb215_exchange_return_internal','tb215_exchange_finalize_internal']) LOOP
 EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',f.identity);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.identity);
 END LOOP;
END $$;

DO $$ DECLARE f RECORD; BEGIN FOR f IN SELECT p.oid::regprocedure identity FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY(ARRAY['phase4_finalize_aftercare_operation_foundation_internal','tb215_exchange_manifest_internal','tb215_assert_exchange_internal','settle_sales_exchange_v1','tb215_exchange_completion_guard_internal','tb215_finalize_before_exchange_internal']) LOOP EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',f.identity);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.identity); END LOOP;END $$;
GRANT EXECUTE ON FUNCTION public.settle_sales_exchange_v1(JSONB,TEXT,TEXT) TO authenticated;

ALTER FUNCTION public.tb215_exchange_financial_adjustment_internal(JSONB,UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tb215_exchange_financial_adjustment_internal(JSONB,UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.tb215_shift_before_exchange_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_cash_shift_summary(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_cash_shift_summary(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.tb215_completion_before_exchange_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.phase4_authoritative_completion_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.tb215_inspection_public_result_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tb215_inspection_public_result_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.tb215_return_public_result_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tb215_return_public_result_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.tb215_exchange_public_result_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tb215_exchange_public_result_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
