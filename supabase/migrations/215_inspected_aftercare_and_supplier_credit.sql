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
 result:=jsonb_build_object('success',true,'contractVersion',215,'operationId',op,'orderId',request->'orderId','replacementId',issued->'replacementId',
  'issuedQuantity',issued->'issuedQuantity','restockedQuantity',(SELECT sum(good_quantity) FROM public.aftercare215_inspection_items WHERE operation_id=op),
  'badQuantity',(SELECT sum(bad_quantity) FROM public.aftercare215_inspection_items WHERE operation_id=op),'caseIds',to_jsonb(cases),
  'moneyDifferenceInMinorUnits',0,'evidenceFingerprint',encode(extensions.digest(public.tb215_inspection_manifest_internal(op)::TEXT,'sha256'),'hex'));
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
  JOIN public.orders o ON o.id=i.order_id WHERE(p_branch_id IS NULL OR o.branch_id=p_branch_id) AND i.created_at>=p_period_start AND i.created_at<p_period_end; END IF;
 SELECT COALESCE(sum(i.good_recovery_in_minor_units),0)::BIGINT INTO recovery FROM public.aftercare215_inspections i JOIN public.orders o ON o.id=i.order_id
  WHERE(p_branch_id IS NULL OR o.branch_id=p_branch_id) AND i.created_at>=p_period_start AND i.created_at<p_period_end;
 FOREACH k IN ARRAY ARRAY['restockRecoveryInMinorUnits','aftercareAdjustedMarginInMinorUnits','netProfitInMinorUnits'] LOOP
  facts:=jsonb_set(facts,ARRAY['sales',k],to_jsonb((facts->'sales'->>k)::BIGINT+recovery));
 END LOOP;
 RETURN facts;
END $$;

DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['aftercare215_inspections','aftercare215_inspection_items'] LOOP
  EXECUTE format('ALTER TABLE public.%I OWNER TO postgres',t);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.inventory_damage_reject_mutation_internal()',t||'_immutable',t);
  EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.inventory_damage_reject_mutation_internal()',t||'_no_truncate',t);
 END LOOP;
END $$;
ALTER FUNCTION public.tb215_canonical_inspection_internal(JSONB) OWNER TO postgres;
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
ALTER FUNCTION public.sr208_assert_operation_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sr208_assert_operation_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.tb215_financial_facts_before215_internal(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.phase6_financial_facts_internal(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.phase6_financial_facts_internal(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
