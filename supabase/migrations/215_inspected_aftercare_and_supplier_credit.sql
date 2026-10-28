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
 RETURN facts;
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
 result:=jsonb_build_object('success',true,'contractVersion',215,'operationId',operation,'returnOperationId',inner_operation,'returnId',inner_result->'returnId',
  'returnNumber',inner_result->'returnNumber','orderId',inner_result->'orderId','entitlementInMinorUnits',(inner_result->>'merchandiseEntitlementInMinorUnits')::BIGINT::TEXT,
  'debtReductionInMinorUnits',(inner_result->>'debtReductionInMinorUnits')::BIGINT::TEXT,'moneyRefundInMinorUnits',(inner_result->>'moneyRefundInMinorUnits')::BIGINT::TEXT,
  'refundMethod',inner_result->'refundMethod','goodQuantity',plan->'goodQuantity','badQuantity',plan->'badQuantity','customerDamageQuantity',plan->'customerDamageQuantity',
  'evidenceFingerprint',encode(extensions.digest(public.tb215_return_manifest_internal(operation)::TEXT,'sha256'),'hex'));
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

DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['aftercare215_inspections','aftercare215_inspection_items','supplier215_credits','aftercare215_return_contexts','aftercare215_return_results'] LOOP
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

COMMIT;
