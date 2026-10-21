BEGIN;

-- Owner Phase C9. An in-kind asset, never a supplier payable or payment.
-- Historical 001-207 evidence and financial return writers are untouched.
CREATE TABLE IF NOT EXISTS public.supplier_replacement_cases (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 operation_id UUID NOT NULL REFERENCES public.business_operations(id) DEFERRABLE INITIALLY DEFERRED,
 supplier_id UUID REFERENCES public.suppliers(id) ON DELETE RESTRICT,
 product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
 warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
 branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
 origin TEXT NOT NULL CHECK(origin IN ('shop','customer_return','shop_damage')),
 damage_event_id UUID UNIQUE REFERENCES public.inventory_damage_events(id) ON DELETE RESTRICT,
 quantity INTEGER NOT NULL CHECK(quantity>0),
 commercial_quantity INTEGER NOT NULL CHECK(commercial_quantity>0),
 units_per_commercial_unit INTEGER NOT NULL CHECK(units_per_commercial_unit>0),
 unit_name TEXT NOT NULL CHECK(length(btrim(unit_name))>0),
 base_unit_name TEXT NOT NULL CHECK(length(btrim(base_unit_name))>0),
 unit_cost_in_minor_units_exact NUMERIC(24,6) NOT NULL CHECK(unit_cost_in_minor_units_exact>=0),
 occurred_at TIMESTAMPTZ NOT NULL,
 created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 CHECK(quantity::BIGINT=commercial_quantity::BIGINT*units_per_commercial_unit),
 CHECK((origin='shop' AND supplier_id IS NOT NULL AND damage_event_id IS NULL)
   OR (origin='customer_return' AND supplier_id IS NOT NULL AND damage_event_id IS NOT NULL)
   OR (origin='shop_damage' AND supplier_id IS NULL AND damage_event_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS public.supplier_replacement_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id UUID NOT NULL REFERENCES public.supplier_replacement_cases(id) ON DELETE RESTRICT,
 operation_id UUID NOT NULL REFERENCES public.business_operations(id) DEFERRABLE INITIALLY DEFERRED,
 action TEXT NOT NULL CHECK(action IN ('send','immediate','receive','writeoff','damage','reverse')),
 quantity INTEGER NOT NULL CHECK(quantity>0),
 held_delta INTEGER NOT NULL,
 -- Supplement to immutable201 loss: negative = recovery/reclassification.
 expense_delta_in_minor_units BIGINT NOT NULL DEFAULT 0,
 reverses_event_id UUID UNIQUE REFERENCES public.supplier_replacement_events(id) ON DELETE RESTRICT,
 previous_event_id UUID UNIQUE REFERENCES public.supplier_replacement_events(id) ON DELETE RESTRICT,
 reason TEXT NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 3 AND 500),
 occurred_at TIMESTAMPTZ NOT NULL,
 created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 CHECK((action='reverse')=(reverses_event_id IS NOT NULL)),
 CHECK(action='reverse' OR(action='send' AND held_delta=quantity) OR(action IN('receive','writeoff') AND held_delta=-quantity) OR(action IN('immediate','damage') AND held_delta=0)),
 CHECK(abs(held_delta)<=quantity)
);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_replacement208_first_event
 ON public.supplier_replacement_events(case_id) WHERE previous_event_id IS NULL;
CREATE INDEX IF NOT EXISTS supplier_replacement208_case_events ON public.supplier_replacement_events(case_id);
CREATE INDEX IF NOT EXISTS supplier_replacement208_period ON public.supplier_replacement_events(occurred_at,case_id);
CREATE INDEX IF NOT EXISTS supplier_replacement208_supplier ON public.supplier_replacement_cases(supplier_id,occurred_at,id);
CREATE INDEX IF NOT EXISTS supplier_replacement208_branch ON public.supplier_replacement_cases(branch_id,occurred_at,id);
CREATE INDEX IF NOT EXISTS supplier_replacement208_case_operation ON public.supplier_replacement_cases(operation_id);
CREATE INDEX IF NOT EXISTS supplier_replacement208_event_operation ON public.supplier_replacement_events(operation_id);
CREATE TABLE IF NOT EXISTS public.supplier_replacement_inventory_effects (
 event_id UUID PRIMARY KEY REFERENCES public.supplier_replacement_events(id) ON DELETE RESTRICT,
 product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
 warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
 on_hand_before INTEGER NOT NULL CHECK(on_hand_before>=0),
 on_hand_after INTEGER NOT NULL CHECK(on_hand_after>=0),
 reserved_before INTEGER NOT NULL CHECK(reserved_before>=0),
 wac_before NUMERIC(24,6), wac_after NUMERIC(24,6),
 cost_before BIGINT NOT NULL CHECK(cost_before>=0), cost_after BIGINT NOT NULL CHECK(cost_after>=0),
 movement_ids UUID[] NOT NULL CHECK(array_position(movement_ids,NULL) IS NULL),
 post_inventory_fingerprint TEXT NOT NULL CHECK(post_inventory_fingerprint~'^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_replacement208_key
 ON public.business_operations(initiated_by,idempotency_key) WHERE operation_type='supplier_replacement208';

-- All quantities AND values are RPC-only. In particular service_role does not
-- receive Supabase's default table/function privileges for this private ledger.
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['supplier_replacement_cases','supplier_replacement_events','supplier_replacement_inventory_effects'] LOOP
  EXECUTE format('ALTER TABLE public.%I OWNER TO postgres',t);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=('public.'||t)::regclass AND tgname=t||'_immutable') THEN
   EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.inventory_damage_reject_mutation_internal()',t||'_immutable',t);
   EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.inventory_damage_reject_mutation_internal()',t||'_no_truncate',t);
  END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.sr208_assert_role_internal(p_action TEXT)
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='SUPPLIER_REPLACEMENT_ROLE_DENIED';
 END IF;
 IF p_action='reverse' THEN
  IF NOT public.has_erp_role(ARRAY['owner']) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='SUPPLIER_REPLACEMENT_OWNER_ONLY'; END IF;
  RETURN public.assert_reversal_owner('عكس استبدال المورد والتالف');
 ELSIF p_action IN ('writeoff','customer_return','values') THEN
  IF NOT public.has_erp_role(ARRAY['owner']) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='SUPPLIER_REPLACEMENT_OWNER_ONLY'; END IF;
  PERFORM public.assert_erp_role(ARRAY['owner'],'استبدال المورد والتالف');
 ELSIF p_action='shop_damage' THEN
  PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','warehouse_keeper'],'تلف المحل');
 ELSIF p_action IN ('shop_pending','shop_immediate','receive','read') THEN
  IF NOT public.has_erp_role(ARRAY['owner','manager','warehouse_keeper']) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='SUPPLIER_REPLACEMENT_ROLE_DENIED';
  END IF;
  PERFORM public.assert_erp_role(ARRAY['owner','manager','warehouse_keeper'],'استبدال المورد');
 ELSE RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_ACTION_INVALID';
 END IF;
 RETURN auth.uid();
END $$;

CREATE OR REPLACE FUNCTION public.sr208_operation_manifest_internal(p_operation_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object(
  'cases',(SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') FROM public.supplier_replacement_cases c WHERE c.operation_id=p_operation_id OR EXISTS(SELECT 1 FROM public.supplier_replacement_events e WHERE e.case_id=c.id AND e.operation_id=p_operation_id)),
  'events',(SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') FROM public.supplier_replacement_events e WHERE e.operation_id=p_operation_id),
  'effects',(SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.event_id),'[]') FROM public.supplier_replacement_inventory_effects f JOIN public.supplier_replacement_events e ON e.id=f.event_id WHERE e.operation_id=p_operation_id),
  'movements',(SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]') FROM public.inventory_movements m WHERE EXISTS(
    SELECT 1 FROM public.supplier_replacement_inventory_effects f JOIN public.supplier_replacement_events e ON e.id=f.event_id WHERE e.operation_id=p_operation_id AND m.id=ANY(f.movement_ids))),
  'damageSources',(SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.id),'[]') FROM public.inventory_damage_events d WHERE EXISTS(
    SELECT 1 FROM public.supplier_replacement_cases c JOIN public.supplier_replacement_events e ON e.case_id=c.id WHERE e.operation_id=p_operation_id AND c.damage_event_id=d.id)));
$$;

CREATE OR REPLACE FUNCTION public.sr208_assert_operation_internal(p_operation_id UUID)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.business_operations%ROWTYPE; m JSONB;
BEGIN
 SELECT * INTO b FROM public.business_operations WHERE id=p_operation_id;
 m:=public.sr208_operation_manifest_internal(p_operation_id);
 IF b.operation_type IS DISTINCT FROM 'supplier_replacement208' OR b.completed_at IS NULL
  OR b.request_identity_version IS DISTINCT FROM 208 OR b.request_identity_snapshot IS NULL
  OR b.request_fingerprint IS DISTINCT FROM encode(extensions.digest(b.request_identity_snapshot::TEXT,'sha256'),'hex')
  OR b.result_snapshot->>'evidenceFingerprint' IS DISTINCT FROM encode(extensions.digest(m::TEXT,'sha256'),'hex')
  OR b.result_snapshot->'caseIds' IS DISTINCT FROM (SELECT jsonb_agg(x->'id' ORDER BY x->>'id') FROM jsonb_array_elements(m->'cases') x)
  OR b.result_snapshot->'eventIds' IS DISTINCT FROM (SELECT jsonb_agg(x->'id' ORDER BY x->>'id') FROM jsonb_array_elements(m->'events') x)
  OR jsonb_array_length(m->'events')=0
  OR jsonb_array_length(m->'events')<>jsonb_array_length(m->'effects') THEN
  RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_EVIDENCE_INVALID';
 END IF;
 IF b.result_snapshot->>'returnOperationId' IS NOT NULL THEN
  PERFORM public.phase42_assert_operational_return_evidence_internal((b.result_snapshot->>'returnOperationId')::UUID,true);
  IF b.result_snapshot->'returnResult' IS DISTINCT FROM (SELECT result_snapshot FROM public.business_operations WHERE id=(b.result_snapshot->>'returnOperationId')::UUID) THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_EVIDENCE_INVALID'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.supplier_replacement_cases c
  WHERE c.id IN(SELECT (x->>'id')::UUID FROM jsonb_array_elements(m->'cases') x)
   AND (NOT EXISTS(SELECT 1 FROM public.supplier_replacement_events e WHERE e.case_id=c.id AND e.previous_event_id IS NULL)
    OR COALESCE((SELECT sum(e.held_delta) FROM public.supplier_replacement_events e WHERE e.case_id=c.id),-1) NOT BETWEEN 0 AND c.quantity))
  OR EXISTS(SELECT 1 FROM public.supplier_replacement_events e
   JOIN public.supplier_replacement_cases c ON c.id=e.case_id
   LEFT JOIN public.supplier_replacement_events prior ON prior.id=e.previous_event_id
   LEFT JOIN public.supplier_replacement_events original ON original.id=e.reverses_event_id
   JOIN public.supplier_replacement_inventory_effects f ON f.event_id=e.id
   WHERE e.operation_id=p_operation_id AND(e.created_by IS DISTINCT FROM b.initiated_by
    OR(prior.id IS NOT NULL AND prior.case_id<>e.case_id)
    OR f.product_id<>c.product_id OR f.warehouse_id<>c.warehouse_id
    OR(e.action='reverse' AND(original.case_id<>e.case_id OR original.action='reverse' OR original.quantity<>e.quantity OR original.held_delta<>-e.held_delta))
    OR COALESCE((SELECT sum(mv.quantity) FROM public.inventory_movements mv WHERE mv.id=ANY(f.movement_ids)),0)<>f.on_hand_after-f.on_hand_before
    OR cardinality(f.movement_ids)<>(SELECT count(*) FROM public.inventory_movements mv WHERE mv.id=ANY(f.movement_ids) AND mv.product_id=c.product_id AND mv.warehouse_id=c.warehouse_id))) THEN
  RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_EVIDENCE_INVALID';
 END IF;
 PERFORM public.phase42_assert_operational_return_evidence_internal(s.operation_id,true)
 FROM public.sales_return_events s WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(m->'damageSources') d WHERE (d->>'return_event_id')::UUID=s.id);
END $$;

-- Constant-size evidence, independent of transaction-start timestamps. A
-- completed C9 inverse pair is neutral only after both manifests validate.
CREATE OR REPLACE FUNCTION public.sr208_inventory_fingerprint_internal(p_product_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH neutral AS (
  SELECT unnest(f.movement_ids) id FROM public.supplier_replacement_events r
  JOIN public.supplier_replacement_events e ON e.id=r.reverses_event_id
  JOIN public.supplier_replacement_inventory_effects f ON f.event_id IN(e.id,r.id)
  WHERE e.action<>'reverse' AND r.action='reverse'
 ), facts AS (
  SELECT jsonb_build_object('product',(SELECT jsonb_build_object('wac',wac_cost_in_minor_units_exact,'cost',cost_price_in_minor_units) FROM public.products WHERE id=p_product_id),
   'balances',(SELECT COALESCE(jsonb_agg(jsonb_build_array(warehouse_id,on_hand_quantity,reserved_quantity) ORDER BY warehouse_id),'[]') FROM public.inventory_balances WHERE product_id=p_product_id),
   'movements',(SELECT COALESCE(jsonb_agg(jsonb_build_array(m.id,m.warehouse_id,m.movement_type,m.quantity,m.balance_before,m.balance_after,m.reference_type,m.reference_id) ORDER BY m.id),'[]')
    FROM public.inventory_movements m WHERE m.product_id=p_product_id AND NOT EXISTS(SELECT 1 FROM neutral n WHERE n.id=m.id))) AS data
 ) SELECT encode(extensions.digest(data::TEXT,'sha256'),'hex') FROM facts;
$$;

CREATE OR REPLACE FUNCTION public.sr208_case_dto_internal(p_case_id UUID,p_values BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.supplier_replacement_cases%ROWTYPE; pending BIGINT; received BIGINT; lost BIGINT; result JSONB;
BEGIN
 SELECT * INTO STRICT c FROM public.supplier_replacement_cases WHERE id=p_case_id;
 SELECT COALESCE(sum(held_delta),0),COALESCE(sum(CASE WHEN action='receive' THEN quantity WHEN action='reverse' AND reverses_event_id IN(SELECT id FROM public.supplier_replacement_events WHERE action='receive') THEN -quantity ELSE 0 END),0),
 COALESCE(sum(CASE WHEN action='writeoff' THEN quantity WHEN action='reverse' AND reverses_event_id IN(SELECT id FROM public.supplier_replacement_events WHERE action='writeoff') THEN -quantity ELSE 0 END),0)
 INTO pending,received,lost FROM public.supplier_replacement_events WHERE case_id=c.id;
 result:=jsonb_build_object('id',c.id,'supplierId',c.supplier_id,'supplierName',(SELECT company_name FROM public.suppliers WHERE id=c.supplier_id),
  'productId',c.product_id,'productName',(SELECT name_ar FROM public.products WHERE id=c.product_id),'warehouseId',c.warehouse_id,'branchId',c.branch_id,
  'origin',c.origin,'quantity',c.quantity,'commercialQuantity',c.commercial_quantity,'unitsPerCommercialUnit',c.units_per_commercial_unit,
  'unitName',c.unit_name,'baseUnitName',c.base_unit_name,'pendingQuantity',pending,'receivedQuantity',received,'writtenOffQuantity',lost,'occurredAt',c.occurred_at,
  'events',(SELECT COALESCE(jsonb_agg((jsonb_build_object('id',e.id,'action',e.action,'quantity',e.quantity,'heldDelta',e.held_delta,'occurredAt',e.occurred_at,
   'reversesEventId',e.reverses_event_id,'isReversed',EXISTS(SELECT 1 FROM public.supplier_replacement_events r WHERE r.reverses_event_id=e.id))||CASE WHEN p_values THEN jsonb_build_object('reason',e.reason) ELSE '{}'::JSONB END) ORDER BY e.occurred_at,e.id),'[]')
   FROM public.supplier_replacement_events e WHERE e.case_id=c.id AND (p_values OR e.action<>'reverse')));
 -- No embedded internal result/effect/cost/reversal reason for a staff DTO.
 IF p_values THEN result:=result||jsonb_build_object('unitCostInMinorUnitsExact',c.unit_cost_in_minor_units_exact::TEXT,
  'pendingValueInMinorUnitsExact',(pending*c.unit_cost_in_minor_units_exact)::TEXT); END IF;
 RETURN result;
END $$;

-- Caller has already locked the full product set with the canonical helper.
-- A single effect records exact inventory fields, never a whole product row.
CREATE OR REPLACE FUNCTION public.sr208_append_event_internal(
 p_operation_id UUID,p_case_id UUID,p_action TEXT,p_quantity INTEGER,p_held_delta INTEGER,p_expense BIGINT,
 p_stock_delta INTEGER,p_reason TEXT,p_at TIMESTAMPTZ,p_reverses UUID DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.supplier_replacement_cases%ROWTYPE; p public.products%ROWTYPE;
 f public.supplier_replacement_inventory_effects%ROWTYPE; last_id UUID; event_id UUID:=gen_random_uuid();
 before_qty INTEGER; reserved INTEGER; after_qty INTEGER; global_qty BIGINT; new_wac NUMERIC(24,6); new_cost BIGINT;
 movements UUID[]:='{}'::UUID[]; movement_id UUID; first_qty INTEGER;
BEGIN
 SELECT * INTO STRICT c FROM public.supplier_replacement_cases WHERE id=p_case_id;
 SELECT * INTO STRICT p FROM public.products WHERE id=c.product_id;
 SELECT e.id INTO last_id FROM public.supplier_replacement_events e WHERE e.case_id=c.id
  AND NOT EXISTS(SELECT 1 FROM public.supplier_replacement_events n WHERE n.previous_event_id=e.id);
 SELECT on_hand_quantity,reserved_quantity INTO before_qty,reserved FROM public.inventory_balances WHERE product_id=c.product_id AND warehouse_id=c.warehouse_id;
 IF NOT FOUND THEN
  INSERT INTO public.inventory_balances(product_id,warehouse_id,on_hand_quantity,reserved_quantity) VALUES(c.product_id,c.warehouse_id,0,0);
  before_qty:=0;reserved:=0;
 END IF;
 after_qty:=before_qty+p_stock_delta;new_wac:=p.wac_cost_in_minor_units_exact;new_cost:=p.cost_price_in_minor_units;
 IF p_action='damage' THEN
  -- The existing201 writer already performed/captured the one physical out.
  SELECT m.balance_before,m.balance_after,ARRAY[m.id] INTO STRICT before_qty,after_qty,movements
  FROM public.inventory_damage_events d JOIN public.inventory_movements m ON m.id=d.movement_id WHERE d.id=c.damage_event_id;
 END IF;
 IF after_qty<reserved THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_STOCK_RESERVED'; END IF;
 IF p_reverses IS NOT NULL THEN
  SELECT * INTO STRICT f FROM public.supplier_replacement_inventory_effects WHERE supplier_replacement_inventory_effects.event_id=p_reverses;
  IF public.sr208_inventory_fingerprint_internal(c.product_id) IS DISTINCT FROM f.post_inventory_fingerprint THEN
   RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_LATER_MOVEMENT';
  END IF;
  IF before_qty IS DISTINCT FROM f.on_hand_after OR reserved IS DISTINCT FROM f.reserved_before
   OR p.wac_cost_in_minor_units_exact IS DISTINCT FROM f.wac_after OR p.cost_price_in_minor_units IS DISTINCT FROM f.cost_after THEN
   RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_INVENTORY_CHANGED';
  END IF;
  after_qty:=f.on_hand_before;new_wac:=f.wac_before;new_cost:=f.cost_before;
 ELSIF p_stock_delta>0 THEN
  SELECT COALESCE(sum(on_hand_quantity),0) INTO global_qty FROM public.inventory_balances WHERE product_id=c.product_id;
  new_wac:=round((global_qty*COALESCE(p.wac_cost_in_minor_units_exact,p.cost_price_in_minor_units::NUMERIC)+p_stock_delta*c.unit_cost_in_minor_units_exact)/(global_qty+p_stock_delta),6);
  new_cost:=round(new_wac)::BIGINT;
 END IF;
 INSERT INTO public.supplier_replacement_events(id,case_id,operation_id,action,quantity,held_delta,expense_delta_in_minor_units,
  reverses_event_id,previous_event_id,reason,occurred_at,created_by)
 VALUES(event_id,c.id,p_operation_id,p_action,p_quantity,p_held_delta,p_expense,p_reverses,last_id,p_reason,p_at,auth.uid());
 IF p_action='immediate' OR (p_action='reverse' AND EXISTS(SELECT 1 FROM public.supplier_replacement_events WHERE id=p_reverses AND action='immediate')) THEN
  first_qty:=before_qty-p_quantity;
  IF first_qty<reserved THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_STOCK_RESERVED'; END IF;
  INSERT INTO public.inventory_movements(warehouse_id,product_id,movement_type,quantity,balance_before,balance_after,reference_type,reference_id,notes,created_by)
  VALUES(c.warehouse_id,c.product_id,'adjustment_subtract',-p_quantity,before_qty,first_qty,'supplier_replacement208',event_id,'استبدال مورد فوري: خروج',auth.uid()) RETURNING id INTO movement_id;
  movements:=array_append(movements,movement_id);
  INSERT INTO public.inventory_movements(warehouse_id,product_id,movement_type,quantity,balance_before,balance_after,reference_type,reference_id,notes,created_by)
  VALUES(c.warehouse_id,c.product_id,'adjustment_add',p_quantity,first_qty,before_qty,'supplier_replacement208',event_id,'استبدال مورد فوري: دخول',auth.uid()) RETURNING id INTO movement_id;
  movements:=array_append(movements,movement_id);
 ELSIF p_action<>'damage' AND after_qty<>before_qty THEN
  INSERT INTO public.inventory_movements(warehouse_id,product_id,movement_type,quantity,balance_before,balance_after,reference_type,reference_id,notes,created_by)
  VALUES(c.warehouse_id,c.product_id,CASE WHEN after_qty>before_qty THEN 'adjustment_add' ELSE 'adjustment_subtract' END,after_qty-before_qty,before_qty,after_qty,
   'supplier_replacement208',event_id,CASE WHEN p_action='reverse' THEN 'عكس استبدال مورد' ELSE 'استبدال مورد' END,auth.uid()) RETURNING id INTO movement_id;
  movements:=array_append(movements,movement_id);
 END IF;
 UPDATE public.inventory_balances SET on_hand_quantity=after_qty,updated_at=NOW() WHERE product_id=c.product_id AND warehouse_id=c.warehouse_id;
 IF new_wac IS DISTINCT FROM p.wac_cost_in_minor_units_exact OR new_cost IS DISTINCT FROM p.cost_price_in_minor_units THEN
  UPDATE public.products SET wac_cost_in_minor_units_exact=new_wac,cost_price_in_minor_units=new_cost,updated_at=NOW() WHERE id=c.product_id;
 END IF;
 INSERT INTO public.supplier_replacement_inventory_effects(event_id,product_id,warehouse_id,on_hand_before,on_hand_after,reserved_before,wac_before,wac_after,cost_before,cost_after,movement_ids,post_inventory_fingerprint)
 VALUES(event_id,c.product_id,c.warehouse_id,before_qty,after_qty,reserved,p.wac_cost_in_minor_units_exact,new_wac,p.cost_price_in_minor_units,new_cost,movements,public.sr208_inventory_fingerprint_internal(c.product_id));
 RETURN event_id;
END $$;

CREATE OR REPLACE FUNCTION public.execute_supplier_replacement_v1(p_action TEXT,p_payload JSONB,p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_variable
DECLARE
 actor UUID; k TEXT:=btrim(p_idempotency_key); request JSONB; fingerprint TEXT; operation_id UUID:=gen_random_uuid();
 existing public.business_operations%ROWTYPE; c public.supplier_replacement_cases%ROWTYPE;
 e public.supplier_replacement_events%ROWTYPE; f public.supplier_replacement_inventory_effects%ROWTYPE;
 d public.inventory_damage_events%ROWTYPE; p public.products%ROWTYPE;
 reason TEXT; allowed TEXT[]; supplier_id UUID; product_id UUID; warehouse_id UUID; branch_id UUID;
 commercial INTEGER; units INTEGER; qty INTEGER; held BIGINT; written BIGINT; expense BIGINT:=0; stock_delta INTEGER:=0;
 case_id UUID; event_at TIMESTAMPTZ; before_qty INTEGER; cost NUMERIC(24,6);
 case_ids UUID[]:='{}'::UUID[]; return_result JSONB; financial_request JSONB; financial_replay JSONB; return_operation UUID; return_event UUID;
 assignments JSONB; item JSONB; result JSONB; manifest JSONB; order_id UUID; current_values BOOLEAN;
BEGIN
 actor:=public.sr208_assert_role_internal(p_action);current_values:=public.has_erp_role(ARRAY['owner']);
 IF k IS NULL OR char_length(k) NOT BETWEEN 16 AND 200 THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_KEY_INVALID'; END IF;
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_REQUEST_INVALID'; END IF;
 reason:=NULLIF(btrim(p_payload->>'reason'),'');
 IF reason IS NULL OR char_length(reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_REASON_INVALID'; END IF;
 allowed:=CASE WHEN p_action IN ('shop_pending','shop_immediate') THEN ARRAY['supplierId','productId','warehouseId','quantity','unit','reason']
  WHEN p_action='shop_damage' THEN ARRAY['productId','warehouseId','quantity','unit','reason','reasonCode']
  WHEN p_action IN ('receive','writeoff') THEN ARRAY['caseId','quantity','reason']
  WHEN p_action='reverse' THEN ARRAY['eventId','reason']
  ELSE ARRAY['orderId','items','physicalSources','reason','refundMethod','referenceNumber','notes','supplierAssignments'] END;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) x WHERE NOT x=ANY(allowed)) THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_FIELD_INVALID'; END IF;
 request:=jsonb_build_object('action',p_action,'payload',p_payload||jsonb_build_object('reason',reason));
 IF p_action='customer_return' THEN
  order_id:=(p_payload->>'orderId')::UUID;
  PERFORM set_config('nawasrah.phase43_return_physical_sources',public.phase43_canonicalize_return_physical_sources_internal(p_payload->'physicalSources')::TEXT,true);
  financial_request:=public.phase42_canonicalize_return_request_internal(order_id,p_payload->'items',reason,
   p_payload->>'refundMethod',p_payload->>'referenceNumber',p_payload->>'notes');
  IF jsonb_typeof(p_payload->'supplierAssignments') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'supplierAssignments') NOT BETWEEN 1 AND 100 THEN
   RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_RETURN_ASSIGNMENTS_INVALID';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'supplierAssignments') LOOP
   IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>3
    OR NULLIF(item->>'supplierId','') IS NULL OR NULLIF(item->>'sourceId','') IS NULL
    OR item->>'sourceKind' NOT IN ('base_order_item','parcel_component','replacement_item') THEN
    RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_RETURN_ASSIGNMENTS_INVALID';
   END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'supplierAssignments') x GROUP BY x->>'sourceKind',(x->>'sourceId')::UUID HAVING count(*)<>1) THEN
   RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_RETURN_ASSIGNMENTS_INVALID';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('sourceKind',x->>'sourceKind','sourceId',(x->>'sourceId')::UUID,'supplierId',(x->>'supplierId')::UUID) ORDER BY x->>'sourceKind',(x->>'sourceId')::UUID)
  INTO assignments FROM jsonb_array_elements(p_payload->'supplierAssignments') x;
  request:=jsonb_build_object('action',p_action,'financialRequest',financial_request,'supplierAssignments',assignments);
  -- Exactly the old canonical key/lock/evidence helper, before ANY order or
  -- inventory lock. A previously standalone return cannot acquire a C9 tail.
  financial_replay:=public.phase4_resolve_operation_replay_internal('phase4_return_v1',k,
   public.phase3_actor_scope_hash_internal('erp_user',actor,NULL,NULL),public.phase3_request_fingerprint_internal(financial_request));
 END IF;
 fingerprint:=encode(extensions.digest(request::TEXT,'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('supplier-replacement208|'||actor::TEXT||'|'||k,0));
 SELECT * INTO existing FROM public.business_operations WHERE operation_type='supplier_replacement208' AND initiated_by=actor AND idempotency_key=k;
 IF FOUND THEN
  IF existing.request_fingerprint IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_IDEMPOTENCY_CONFLICT'; END IF;
  PERFORM public.sr208_assert_operation_internal(existing.id);
  IF p_action='customer_return' AND (financial_replay->>'decision' IS DISTINCT FROM 'REPLAY'
   OR financial_replay->>'operation_id' IS DISTINCT FROM existing.result_snapshot->>'returnOperationId') THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_EVIDENCE_INVALID'; END IF;
  SELECT array_agg(x::UUID ORDER BY x::UUID) INTO case_ids FROM jsonb_array_elements_text(existing.result_snapshot->'caseIds') x;
  result:=jsonb_build_object('success',true,'contractVersion',208,'action',p_action,'idempotencyKey',k,'operationId',existing.id,'idempotent',true,
   'cases',(SELECT COALESCE(jsonb_agg(public.sr208_case_dto_internal(v,current_values) ORDER BY v),'[]') FROM unnest(case_ids) v));
  IF p_action='customer_return' THEN result:=result||jsonb_build_object('returnResult',existing.result_snapshot->'returnResult'); END IF;
  RETURN result;
 END IF;
 IF p_action='customer_return' AND financial_replay->>'decision' IS DISTINCT FROM 'NEW' THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_RETURN_IDENTITY_CONFLICT'; END IF;
 IF p_action IN ('shop_pending','shop_immediate','shop_damage') THEN
  product_id:=(p_payload->>'productId')::UUID;warehouse_id:=(p_payload->>'warehouseId')::UUID;
  supplier_id:=(p_payload->>'supplierId')::UUID;
  IF p_payload->>'unit' IS NULL OR p_payload->>'unit' NOT IN ('base','parcel')
   OR jsonb_typeof(p_payload->'quantity') IS DISTINCT FROM 'number' OR (p_payload->>'quantity')!~'^[1-9][0-9]*$' THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_QUANTITY_INVALID'; END IF;
  commercial:=(p_payload->>'quantity')::INTEGER;
  -- Warehouse table access precedes inventory locks, matching199 disable.
  SELECT w.branch_id INTO branch_id FROM public.warehouses w JOIN public.branches b ON b.id=w.branch_id AND b.is_active WHERE w.id=warehouse_id AND w.is_active;
  IF branch_id IS NULL THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_WAREHOUSE_INVALID'; END IF;
  IF p_action<>'shop_damage' THEN
   PERFORM 1 FROM public.suppliers s WHERE s.id=supplier_id AND s.is_active;
   IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_SUPPLIER_INVALID'; END IF;
  END IF;
  PERFORM public.phase2_lock_inventory_products_internal(ARRAY[product_id]);
  IF p_action<>'shop_damage' THEN
   -- Canonical receipt cancellation locks inventory BEFORE suppliers. Taking
   -- a blocking supplier FK lock first would invert that hierarchy. Acquire
   -- the parent late without waiting; this also avoids cross-domain customer
   -- financial cycles in the atomic-return path below.
   BEGIN
    PERFORM 1 FROM public.suppliers s WHERE s.id=supplier_id AND s.is_active FOR SHARE NOWAIT;
   EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='SUPPLIER_REPLACEMENT_PARENT_BUSY_RETRY: تغيّر قفل المورد؛ أعد نفس المحاولة.';
   END;
   IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_SUPPLIER_INVALID'; END IF;
  END IF;
  SELECT * INTO p FROM public.products WHERE id=product_id AND is_active AND NOT COALESCE(is_flavor_master,false);
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_PRODUCT_INVALID'; END IF;
  units:=CASE WHEN p_payload->>'unit'='parcel' THEN p.units_per_sale_unit ELSE 1 END;
  IF units IS NULL OR units<1 OR commercial::BIGINT*units>2147483647 THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_QUANTITY_INVALID'; END IF;
  qty:=commercial*units;cost:=COALESCE(p.wac_cost_in_minor_units_exact,p.cost_price_in_minor_units::NUMERIC);
  SELECT on_hand_quantity INTO before_qty FROM public.inventory_balances WHERE inventory_balances.product_id=product_id AND inventory_balances.warehouse_id=warehouse_id;
  IF before_qty IS NULL OR before_qty-COALESCE((SELECT reserved_quantity FROM public.inventory_balances WHERE inventory_balances.product_id=product_id AND inventory_balances.warehouse_id=warehouse_id),0)<qty THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_STOCK_RESERVED'; END IF;
  event_at:=clock_timestamp();
  IF p_action='shop_damage' THEN
   IF p_payload->>'reasonCode' IS NULL OR p_payload->>'reasonCode' NOT IN ('shop_breakage','expired','storage_damage','other') THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_DAMAGE_REASON_INVALID'; END IF;
   result:=public.adjust_inventory_stock(warehouse_id,product_id,before_qty-qty,
    CASE p_payload->>'reasonCode' WHEN 'shop_breakage' THEN 'انكسر بالمحل' WHEN 'expired' THEN 'انتهت الصلاحية' WHEN 'storage_damage' THEN 'تلف تخزين' ELSE 'أخرى' END||': '||reason,
    CASE WHEN p_payload->>'reasonCode'='expired' THEN 'expired' ELSE 'damage' END);
   SELECT * INTO STRICT d FROM public.inventory_damage_events WHERE movement_id=(result->>'movementId')::UUID;
   event_at:=d.occurred_at;
  END IF;
  INSERT INTO public.supplier_replacement_cases(operation_id,supplier_id,product_id,warehouse_id,branch_id,origin,damage_event_id,quantity,commercial_quantity,units_per_commercial_unit,unit_name,base_unit_name,unit_cost_in_minor_units_exact,occurred_at,created_by)
  VALUES(operation_id,supplier_id,product_id,warehouse_id,branch_id,CASE WHEN p_action='shop_damage' THEN 'shop_damage' ELSE 'shop' END,
   CASE WHEN p_action='shop_damage' THEN d.id END,qty,commercial,units,
   CASE WHEN p_payload->>'unit'='parcel' THEN 'طرد' ELSE COALESCE((SELECT name_ar FROM public.units WHERE id=p.unit_id),'باكيت') END,
   COALESCE((SELECT name_ar FROM public.units WHERE id=p.unit_id),'باكيت'),cost,event_at,actor) RETURNING id INTO case_id;
  PERFORM public.sr208_append_event_internal(operation_id,case_id,CASE p_action WHEN 'shop_pending' THEN 'send' WHEN 'shop_immediate' THEN 'immediate' ELSE 'damage' END,
   qty,CASE WHEN p_action='shop_pending' THEN qty ELSE 0 END,0,CASE WHEN p_action='shop_pending' THEN -qty ELSE 0 END,reason,event_at);
  case_ids:=ARRAY[case_id];
 ELSIF p_action IN ('receive','writeoff','reverse') THEN
  IF p_action='reverse' THEN
   SELECT * INTO e FROM public.supplier_replacement_events WHERE id=(p_payload->>'eventId')::UUID;
   IF NOT FOUND OR e.action='reverse' THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_EVENT_INVALID'; END IF;
   case_id:=e.case_id;
  ELSE case_id:=(p_payload->>'caseId')::UUID; END IF;
  SELECT * INTO c FROM public.supplier_replacement_cases WHERE id=case_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_CASE_INVALID'; END IF;
  PERFORM 1 FROM public.warehouses WHERE id=c.warehouse_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('supplier-replacement208-case|'||case_id::TEXT,0));
  PERFORM 1 FROM public.supplier_replacement_cases WHERE id=case_id FOR SHARE;
  PERFORM public.phase2_lock_inventory_products_internal(ARRAY[c.product_id]);
  -- Verify every product-local C9 inverse pair before excluding its movements.
  PERFORM public.sr208_assert_operation_internal(v.operation_id)
   FROM (SELECT DISTINCT ev.operation_id FROM public.supplier_replacement_events ev JOIN public.supplier_replacement_cases sc ON sc.id=ev.case_id WHERE sc.product_id=c.product_id) v;
  SELECT COALESCE(sum(held_delta),0) INTO held FROM public.supplier_replacement_events WHERE supplier_replacement_events.case_id=case_id;
  IF p_action='reverse' THEN
   IF EXISTS(SELECT 1 FROM public.supplier_replacement_events WHERE reverses_event_id=e.id) THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_ALREADY_REVERSED'; END IF;
   -- No live descendant may be discarded by reversing an earlier event.
   IF EXISTS(WITH RECURSIVE descendants AS (SELECT id,action FROM public.supplier_replacement_events WHERE previous_event_id=e.id UNION ALL
    SELECT n.id,n.action FROM public.supplier_replacement_events n JOIN descendants x ON n.previous_event_id=x.id)
    SELECT 1 FROM descendants x WHERE x.action<>'reverse' AND NOT EXISTS(SELECT 1 FROM public.supplier_replacement_events r WHERE r.reverses_event_id=x.id)) THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_DEPENDENCY'; END IF;
   IF held-e.held_delta<0 THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_DEPENDENCY'; END IF;
   SELECT * INTO STRICT f FROM public.supplier_replacement_inventory_effects WHERE supplier_replacement_inventory_effects.event_id=e.id;
   expense:=-e.expense_delta_in_minor_units;
   IF e.action='damage' THEN expense:=-((SELECT loss_in_minor_units FROM public.inventory_damage_events WHERE id=c.damage_event_id)); END IF;
   PERFORM public.sr208_append_event_internal(operation_id,c.id,'reverse',e.quantity,-e.held_delta,expense,f.on_hand_before-f.on_hand_after,reason,clock_timestamp(),e.id);
  ELSE
   IF jsonb_typeof(p_payload->'quantity') IS DISTINCT FROM 'number' OR (p_payload->>'quantity')!~'^[1-9][0-9]*$' THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_QUANTITY_INVALID'; END IF;
   qty:=(p_payload->>'quantity')::INTEGER;
   IF qty>held THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_EXCEEDS_PENDING'; END IF;
   IF p_action='writeoff' THEN
    SELECT COALESCE(sum(CASE WHEN ev.action='writeoff' THEN ev.quantity WHEN ev.action='reverse' AND original.action='writeoff' THEN -ev.quantity ELSE 0 END),0)
    INTO written FROM public.supplier_replacement_events ev LEFT JOIN public.supplier_replacement_events original ON original.id=ev.reverses_event_id WHERE ev.case_id=c.id;
    expense:=round((written+qty)*c.unit_cost_in_minor_units_exact)::BIGINT-round(written*c.unit_cost_in_minor_units_exact)::BIGINT;
   ELSE stock_delta:=qty; END IF;
   PERFORM public.sr208_append_event_internal(operation_id,c.id,p_action,qty,-qty,expense,stock_delta,reason,clock_timestamp());
  END IF;
  case_ids:=ARRAY[c.id];
 ELSE
  -- Discover supplier parents without a blocking row lock. The financial
  -- coordinator owns order/shift/inventory acquisition; no earlier supplier
  -- lock may reverse the canonical receipt-cancellation hierarchy.
  FOR supplier_id IN SELECT DISTINCT (x->>'supplierId')::UUID FROM jsonb_array_elements(assignments) x ORDER BY 1 LOOP
   PERFORM 1 FROM public.suppliers s WHERE s.id=supplier_id AND s.is_active;
   IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_SUPPLIER_INVALID'; END IF;
  END LOOP;
  PERFORM 1 FROM public.warehouses w JOIN public.orders o ON o.warehouse_id=w.id WHERE o.id=order_id;
  return_result:=public.settle_admin_sales_return_v1(order_id,k,p_payload->'items',p_payload->'physicalSources',reason,
   p_payload->>'refundMethod',p_payload->>'referenceNumber',p_payload->>'notes');
  FOR supplier_id IN SELECT DISTINCT (x->>'supplierId')::UUID FROM jsonb_array_elements(assignments) x ORDER BY 1 LOOP
   BEGIN
    PERFORM 1 FROM public.suppliers s WHERE s.id=supplier_id AND s.is_active FOR SHARE NOWAIT;
   EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='SUPPLIER_REPLACEMENT_PARENT_BUSY_RETRY: تغيّر قفل المورد؛ أعد نفس المحاولة.';
   END;
   IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_SUPPLIER_INVALID'; END IF;
  END LOOP;
  SELECT b.id,se.id INTO return_operation,return_event FROM public.business_operations b JOIN public.sales_return_events se ON se.operation_id=b.id
   WHERE b.operation_type='phase4_return_v1' AND b.actor_scope_hash=public.phase3_actor_scope_hash_internal('erp_user',actor,NULL,NULL)
    AND public.phase4_canonicalize_idempotency_key_internal(b.idempotency_key)=public.phase4_canonicalize_idempotency_key_internal(k);
  IF return_event IS NULL THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_RETURN_EVIDENCE_INVALID'; END IF;
  IF (SELECT count(*) FROM public.inventory_damage_events WHERE return_event_id=return_event)<>jsonb_array_length(assignments)
   OR EXISTS(SELECT 1 FROM public.inventory_damage_events de WHERE de.return_event_id=return_event AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(assignments) x WHERE x->>'sourceKind'=de.source_kind AND (x->>'sourceId')::UUID=de.source_id)) THEN
   RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_RETURN_ASSIGNMENTS_MISMATCH';
  END IF;
  -- Canonical return has already discovered AND locked every physical leaf.
  -- It must remain the only stock/financial writer for the customer return.
  FOR d IN SELECT de.* FROM public.inventory_damage_events de WHERE de.return_event_id=return_event ORDER BY de.product_id,de.source_kind,de.source_id LOOP
   SELECT (x->>'supplierId')::UUID INTO supplier_id FROM jsonb_array_elements(assignments) x WHERE x->>'sourceKind'=d.source_kind AND (x->>'sourceId')::UUID=d.source_id;
   INSERT INTO public.supplier_replacement_cases(operation_id,supplier_id,product_id,warehouse_id,branch_id,origin,damage_event_id,quantity,commercial_quantity,units_per_commercial_unit,unit_name,base_unit_name,unit_cost_in_minor_units_exact,occurred_at,created_by)
   VALUES(operation_id,supplier_id,d.product_id,d.warehouse_id,d.branch_id,'customer_return',d.id,d.quantity,d.quantity,1,
    COALESCE((SELECT u.name_ar FROM public.products pr LEFT JOIN public.units u ON u.id=pr.unit_id WHERE pr.id=d.product_id),'باكيت'),
    COALESCE((SELECT u.name_ar FROM public.products pr LEFT JOIN public.units u ON u.id=pr.unit_id WHERE pr.id=d.product_id),'باكيت'),d.unit_cost_in_minor_units_exact,d.occurred_at,actor) RETURNING id INTO case_id;
   PERFORM public.sr208_append_event_internal(operation_id,case_id,'send',d.quantity,d.quantity,-d.loss_in_minor_units,0,reason,d.occurred_at);
   case_ids:=array_append(case_ids,case_id);
  END LOOP;
 END IF;
 -- Store only the commitment and safe membership IDs in the existing shared
 -- operation envelope. Private costs/effects never escape into that table.
 manifest:=public.sr208_operation_manifest_internal(operation_id);
 result:=jsonb_build_object('evidenceFingerprint',encode(extensions.digest(manifest::TEXT,'sha256'),'hex'),
  'caseIds',(SELECT jsonb_agg(x->'id' ORDER BY x->>'id') FROM jsonb_array_elements(manifest->'cases') x),
  'eventIds',(SELECT jsonb_agg(x->'id' ORDER BY x->>'id') FROM jsonb_array_elements(manifest->'events') x));
 IF p_action='customer_return' THEN result:=result||jsonb_build_object('returnOperationId',return_operation,'returnResult',return_result); END IF;
 INSERT INTO public.business_operations(id,operation_type,idempotency_key,request_fingerprint,request_identity_version,request_identity_snapshot,initiated_by,result_snapshot,completed_at)
 VALUES(operation_id,'supplier_replacement208',k,fingerprint,208,request,actor,result,clock_timestamp());
 PERFORM public.sr208_assert_operation_internal(operation_id);
 INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details) VALUES(actor,'SUPPLIER_REPLACEMENT208','business_operations',operation_id,jsonb_build_object('action',p_action,'caseIds',case_ids));
 result:=jsonb_build_object('success',true,'contractVersion',208,'action',p_action,'idempotencyKey',k,'operationId',operation_id,'idempotent',false,
  'cases',(SELECT COALESCE(jsonb_agg(public.sr208_case_dto_internal(v,current_values) ORDER BY v),'[]') FROM unnest(case_ids) v));
 IF p_action='customer_return' THEN result:=result||jsonb_build_object('returnResult',return_result); END IF;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.get_supplier_replacements_page_v1(
 p_supplier_id UUID DEFAULT NULL,p_branch_id UUID DEFAULT NULL,p_status TEXT DEFAULT 'pending',p_page INTEGER DEFAULT 1,p_page_size INTEGER DEFAULT 25)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ids UUID[]; result JSONB; values_allowed BOOLEAN; pending BIGINT; pending_value NUMERIC; total BIGINT;
BEGIN
 PERFORM public.sr208_assert_role_internal('read');values_allowed:=public.has_erp_role(ARRAY['owner']);
 IF p_status IS NULL OR p_status NOT IN ('pending','closed','all') OR p_page IS NULL OR p_page<1 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_PAGE_INVALID';
 END IF;
 -- The ledger is derived, never a writable pending-balance cache.
 WITH balances AS (
  SELECT c.id,c.occurred_at,COALESCE(sum(e.held_delta),0) held FROM public.supplier_replacement_cases c
  JOIN public.supplier_replacement_events e ON e.case_id=c.id
  WHERE (c.origin<>'shop_damage' OR p_status='all') AND (p_supplier_id IS NULL OR c.supplier_id=p_supplier_id) AND(p_branch_id IS NULL OR c.branch_id=p_branch_id)
  GROUP BY c.id
 ), filtered AS(SELECT * FROM balances WHERE p_status='all' OR(p_status='pending' AND held>0) OR(p_status='closed' AND held=0))
 SELECT (SELECT count(*) FROM filtered),ARRAY(SELECT id FROM filtered ORDER BY occurred_at,id LIMIT p_page_size OFFSET(p_page::BIGINT-1)*p_page_size)
 INTO total,ids;
 PERFORM public.sr208_assert_operation_internal(x.operation_id) FROM (
  SELECT DISTINCT e.operation_id FROM public.supplier_replacement_events e JOIN public.supplier_replacement_cases c ON c.id=e.case_id
  WHERE (c.origin<>'shop_damage' OR p_status='all') AND(p_supplier_id IS NULL OR c.supplier_id=p_supplier_id) AND(p_branch_id IS NULL OR c.branch_id=p_branch_id)
  UNION SELECT c.operation_id FROM public.supplier_replacement_cases c
  WHERE (c.origin<>'shop_damage' OR p_status='all') AND(p_supplier_id IS NULL OR c.supplier_id=p_supplier_id) AND(p_branch_id IS NULL OR c.branch_id=p_branch_id)
 ) x;
 SELECT COALESCE(sum(e.held_delta),0),COALESCE(sum(e.held_delta*c.unit_cost_in_minor_units_exact),0) INTO pending,pending_value
 FROM public.supplier_replacement_cases c JOIN public.supplier_replacement_events e ON e.case_id=c.id
 WHERE c.origin<>'shop_damage' AND (p_supplier_id IS NULL OR c.supplier_id=p_supplier_id) AND(p_branch_id IS NULL OR c.branch_id=p_branch_id);
 result:=jsonb_build_object('contractVersion',208,'page',p_page,'pageSize',p_page_size,'totalCount',total,
  'pendingQuantity',pending,'cases',(SELECT COALESCE(jsonb_agg(public.sr208_case_dto_internal(v,values_allowed) ORDER BY c.occurred_at,c.id),'[]')
   FROM unnest(ids) v JOIN public.supplier_replacement_cases c ON c.id=v));
 IF values_allowed THEN result:=result||jsonb_build_object('pendingValueInMinorUnitsExact',pending_value::TEXT); END IF;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.get_supplier_replacement_options_v1(p_action TEXT,p_product_search TEXT DEFAULT '',p_supplier_search TEXT DEFAULT '',p_product_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE products JSONB; suppliers JSONB; product_ids UUID[]; receiving JSONB;
BEGIN
 PERFORM public.sr208_assert_role_internal(p_action);
 IF p_action NOT IN('shop_pending','shop_immediate','shop_damage','customer_return') OR length(COALESCE(p_product_search,''))>200 OR length(COALESCE(p_supplier_search,''))>200 THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_OPTIONS_INVALID'; END IF;
 WITH page AS(SELECT p.* FROM public.products p WHERE p.is_active AND NOT COALESCE(p.is_flavor_master,false)
  AND(p_product_id IS NULL OR p.id=p_product_id) AND(p_product_search IS NULL OR p_product_search='' OR p.name_ar ILIKE '%'||p_product_search||'%' OR p.sku ILIKE '%'||p_product_search||'%')
  ORDER BY p.name_ar,p.id LIMIT 50)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name_ar,'sku',p.sku,'baseUnitName',COALESCE(u.name_ar,'باكيت'),'unitsPerParcel',p.units_per_sale_unit) ORDER BY p.name_ar,p.id),'[]'),array_agg(p.id ORDER BY p.id)
 INTO products,product_ids FROM page p LEFT JOIN public.units u ON u.id=p.unit_id;
 IF cardinality(product_ids)>0 THEN receiving:=public.get_receiving_purchase_context(product_ids); END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'name',s.company_name) ORDER BY s.company_name,s.id),'[]') INTO suppliers
 FROM(SELECT id,company_name FROM public.suppliers WHERE is_active AND(p_supplier_search IS NULL OR p_supplier_search='' OR company_name ILIKE '%'||p_supplier_search||'%') ORDER BY company_name,id LIMIT 100) s;
 RETURN jsonb_build_object('contractVersion',208,'products',products,'suppliers',CASE WHEN p_action='shop_damage' THEN '[]'::JSONB ELSE suppliers END,
  'warehouses',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',w.id,'branchId',w.branch_id,'name',w.name_ar) ORDER BY w.name_ar,w.id),'[]') FROM public.warehouses w JOIN public.branches b ON b.id=w.branch_id AND b.is_active WHERE w.is_active),
  'lastSuppliers',(SELECT COALESCE(jsonb_agg(jsonb_build_object('productId',x->>'productId','supplierId',x->'lastPurchase'->>'supplierId','supplierName',x->'lastPurchase'->>'supplierName')),'[]') FROM jsonb_array_elements(COALESCE(receiving->'products','[]')) x));
END $$;

CREATE OR REPLACE FUNCTION public.preview_supplier_replacement_v1(p_action TEXT,p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.supplier_replacement_cases%ROWTYPE; p public.products%ROWTYPE; e public.supplier_replacement_events%ROWTYPE;
 f public.supplier_replacement_inventory_effects%ROWTYPE; qty INTEGER; available INTEGER; held BIGINT; result JSONB; blocked TEXT; units INTEGER;
BEGIN
 PERFORM public.sr208_assert_role_internal(p_action);
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_REQUEST_INVALID'; END IF;
 IF p_action IN ('shop_pending','shop_immediate','shop_damage') THEN
  SELECT * INTO STRICT p FROM public.products WHERE id=(p_payload->>'productId')::UUID;
  IF jsonb_typeof(p_payload->'quantity') IS DISTINCT FROM 'number' OR (p_payload->>'quantity')!~'^[1-9][0-9]*$'
   OR p_payload->>'unit' IS NULL OR p_payload->>'unit' NOT IN ('base','parcel') THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_QUANTITY_INVALID'; END IF;
  units:=CASE WHEN p_payload->>'unit'='parcel' THEN p.units_per_sale_unit ELSE 1 END;
  qty:=(p_payload->>'quantity')::INTEGER*units;
  SELECT available_quantity INTO available FROM public.inventory_balances WHERE product_id=p.id AND warehouse_id=(p_payload->>'warehouseId')::UUID;
  available:=COALESCE(available,0);
  IF NOT p.is_active OR COALESCE(p.is_flavor_master,false) THEN blocked:='الصنف غير متاح للحركة.';
  ELSIF NOT EXISTS(SELECT 1 FROM public.warehouses w JOIN public.branches b ON b.id=w.branch_id AND b.is_active WHERE w.id=(p_payload->>'warehouseId')::UUID AND w.is_active) THEN blocked:='المستودع غير متاح للحركة.';
  ELSIF p_action<>'shop_damage' AND NOT EXISTS(SELECT 1 FROM public.suppliers WHERE id=(p_payload->>'supplierId')::UUID AND is_active) THEN blocked:='اختر مورداً نشطاً.';
  ELSIF qty>available THEN blocked:='الكمية أكبر من المتاح غير المحجوز.'; END IF;
  result:=jsonb_build_object('contractVersion',208,'action',p_action,'quantity',qty,'availableQuantity',available,
   'eligible',blocked IS NULL,'blockedReason',blocked,'unitName',CASE WHEN p_payload->>'unit'='parcel' THEN 'طرد' ELSE COALESCE((SELECT name_ar FROM public.units WHERE id=p.unit_id),'باكيت') END);
  IF public.has_erp_role(ARRAY['owner']) THEN result:=result||jsonb_build_object('valueInMinorUnitsExact',(qty*COALESCE(p.wac_cost_in_minor_units_exact,p.cost_price_in_minor_units::NUMERIC))::TEXT); END IF;
 ELSE
  IF p_action='reverse' THEN
   SELECT * INTO STRICT e FROM public.supplier_replacement_events WHERE id=(p_payload->>'eventId')::UUID;
   SELECT * INTO STRICT c FROM public.supplier_replacement_cases WHERE id=e.case_id;
   SELECT * INTO STRICT f FROM public.supplier_replacement_inventory_effects WHERE event_id=e.id;
   IF e.action='reverse' OR EXISTS(SELECT 1 FROM public.supplier_replacement_events WHERE reverses_event_id=e.id) THEN blocked:='الحدث معكوس أو هو حدث عكس.';
   ELSIF public.sr208_inventory_fingerprint_internal(c.product_id) IS DISTINCT FROM f.post_inventory_fingerprint THEN blocked:='تحرك المخزون أو الحجز أو التكلفة بعد الحدث.';
   ELSIF EXISTS(WITH RECURSIVE descendants AS(SELECT id,action FROM public.supplier_replacement_events WHERE previous_event_id=e.id UNION ALL
    SELECT n.id,n.action FROM public.supplier_replacement_events n JOIN descendants d ON n.previous_event_id=d.id)
    SELECT 1 FROM descendants d WHERE d.action<>'reverse' AND NOT EXISTS(SELECT 1 FROM public.supplier_replacement_events r WHERE r.reverses_event_id=d.id)) THEN blocked:='للحدث عمليات لاحقة؛ اعكسها أولاً.'; END IF;
  ELSE
   SELECT * INTO STRICT c FROM public.supplier_replacement_cases WHERE id=(p_payload->>'caseId')::UUID;
   IF jsonb_typeof(p_payload->'quantity') IS DISTINCT FROM 'number' OR (p_payload->>'quantity')!~'^[1-9][0-9]*$' THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_QUANTITY_INVALID'; END IF;
   qty:=(p_payload->>'quantity')::INTEGER;
   SELECT sum(held_delta) INTO held FROM public.supplier_replacement_events WHERE case_id=c.id;
   IF qty>held THEN blocked:='الكمية أكبر من المعلّق المتبقي.'; END IF;
  END IF;
  PERFORM public.sr208_assert_operation_internal(v.operation_id) FROM(SELECT DISTINCT operation_id FROM public.supplier_replacement_events WHERE case_id=c.id) v;
  result:=jsonb_build_object('contractVersion',208,'action',p_action,'eligible',blocked IS NULL,'blockedReason',blocked,'case',public.sr208_case_dto_internal(c.id,public.has_erp_role(ARRAY['owner'])));
 END IF;
 RETURN result;
END $$;

-- Preserve201's strict nonnegative legacy contract and reader. Version208
-- explicitly represents gross expense, recoveries and signed net; an inverse
-- in a later period is a credit in that period, never clamped to zero.
DO $$ BEGIN
 IF to_regprocedure('public.phase6_financial_facts_before208_internal(uuid,timestamptz,timestamptz,text,boolean)') IS NULL THEN
  ALTER FUNCTION public.phase6_financial_facts_internal(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,BOOLEAN) RENAME TO phase6_financial_facts_before208_internal;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.phase6_financial_facts_internal(p_branch_id UUID,p_period_start TIMESTAMPTZ,p_period_end TIMESTAMPTZ,p_timezone TEXT,p_verify_evidence BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE facts JSONB; old_damage JSONB; damage JSONB; reasons JSONB; delta BIGINT; gross BIGINT; recovered BIGINT;
BEGIN
 facts:=public.phase6_financial_facts_before208_internal(p_branch_id,p_period_start,p_period_end,p_timezone,p_verify_evidence);
 old_damage:=facts->'sales'->'damageLosses';
 IF p_verify_evidence THEN
  PERFORM public.sr208_assert_operation_internal(x.operation_id) FROM(
   SELECT DISTINCT e.operation_id FROM public.supplier_replacement_events e JOIN public.supplier_replacement_cases c ON c.id=e.case_id
   WHERE (p_branch_id IS NULL OR c.branch_id=p_branch_id) AND e.occurred_at>=p_period_start AND e.occurred_at<p_period_end
   UNION SELECT c.operation_id FROM public.supplier_replacement_cases c
   WHERE(p_branch_id IS NULL OR c.branch_id=p_branch_id) AND c.occurred_at>=p_period_start AND c.occurred_at<p_period_end) x;
 END IF;
 SELECT COALESCE(sum(e.expense_delta_in_minor_units),0),COALESCE(sum(GREATEST(e.expense_delta_in_minor_units,0)),0),COALESCE(-sum(LEAST(e.expense_delta_in_minor_units,0)),0)
 INTO delta,gross,recovered FROM public.supplier_replacement_events e JOIN public.supplier_replacement_cases c ON c.id=e.case_id
 WHERE (p_branch_id IS NULL OR c.branch_id=p_branch_id) AND e.occurred_at>=p_period_start AND e.occurred_at<p_period_end;
 WITH rows AS(
  SELECT CASE WHEN e.action='writeoff' THEN 'supplier_writeoff'
   WHEN e.action='send' THEN 'customer_return_supplier_hold'
   WHEN original.action='writeoff' THEN 'supplier_writeoff_reversal'
   WHEN original.action='damage' THEN 'shop_damage_reversal' ELSE 'customer_return_supplier_hold_reversal' END code,
   e.quantity,e.expense_delta_in_minor_units amount
  FROM public.supplier_replacement_events e JOIN public.supplier_replacement_cases c ON c.id=e.case_id
  LEFT JOIN public.supplier_replacement_events original ON original.id=e.reverses_event_id
  WHERE(p_branch_id IS NULL OR c.branch_id=p_branch_id) AND e.occurred_at>=p_period_start AND e.occurred_at<p_period_end
   AND(e.expense_delta_in_minor_units<>0 OR e.action='writeoff')
 ), grouped AS(SELECT code,count(*) count,sum(quantity) quantity,sum(amount) amount,sum(GREATEST(amount,0)) gross,-sum(LEAST(amount,0)) recovered FROM rows GROUP BY code)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('code',code,'count',count,'quantity',quantity,'amountInMinorUnits',amount,'alreadyIncludedInMinorUnits',0,
  'grossInMinorUnits',g.gross,'recoveredInMinorUnits',g.recovered) ORDER BY code),'[]') INTO reasons FROM grouped g;
 SELECT COALESCE(jsonb_agg(x||jsonb_build_object('grossInMinorUnits',(x->>'amountInMinorUnits')::BIGINT,'recoveredInMinorUnits',0)),'[]')||reasons
 INTO reasons FROM jsonb_array_elements(old_damage->'reasons') x;
 damage:=jsonb_build_object('contractVersion',208,'grossInMinorUnits',(old_damage->>'totalInMinorUnits')::BIGINT+gross,'recoveredInMinorUnits',recovered,
  'totalInMinorUnits',(old_damage->>'totalInMinorUnits')::BIGINT+delta,'additionalInMinorUnits',(old_damage->>'additionalInMinorUnits')::BIGINT+delta,
  'alreadyIncludedInMinorUnits',(old_damage->>'alreadyIncludedInMinorUnits')::BIGINT,'reasons',reasons);
 facts:=jsonb_set(facts,'{sales,damageLosses}',damage);
 facts:=jsonb_set(facts,'{sales,netProfitInMinorUnits}',to_jsonb((facts->'sales'->>'netProfitInMinorUnits')::BIGINT-delta));
 RETURN facts;
END $$;

-- Explicit function ownership and ACL; no dynamic function DDL.
ALTER FUNCTION public.sr208_assert_role_internal(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sr208_assert_role_internal(TEXT) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.sr208_operation_manifest_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sr208_operation_manifest_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.sr208_assert_operation_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sr208_assert_operation_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.sr208_inventory_fingerprint_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sr208_inventory_fingerprint_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.sr208_case_dto_internal(UUID,BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sr208_case_dto_internal(UUID,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.sr208_append_event_internal(UUID,UUID,TEXT,INTEGER,INTEGER,BIGINT,INTEGER,TEXT,TIMESTAMPTZ,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sr208_append_event_internal(UUID,UUID,TEXT,INTEGER,INTEGER,BIGINT,INTEGER,TEXT,TIMESTAMPTZ,UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.execute_supplier_replacement_v1(TEXT,JSONB,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.execute_supplier_replacement_v1(TEXT,JSONB,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.execute_supplier_replacement_v1(TEXT,JSONB,TEXT) TO authenticated;
ALTER FUNCTION public.get_supplier_replacements_page_v1(UUID,UUID,TEXT,INTEGER,INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_supplier_replacements_page_v1(UUID,UUID,TEXT,INTEGER,INTEGER) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_supplier_replacements_page_v1(UUID,UUID,TEXT,INTEGER,INTEGER) TO authenticated;
ALTER FUNCTION public.get_supplier_replacement_options_v1(TEXT,TEXT,TEXT,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_supplier_replacement_options_v1(TEXT,TEXT,TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_supplier_replacement_options_v1(TEXT,TEXT,TEXT,UUID) TO authenticated;
ALTER FUNCTION public.preview_supplier_replacement_v1(TEXT,JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.preview_supplier_replacement_v1(TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.preview_supplier_replacement_v1(TEXT,JSONB) TO authenticated;
ALTER FUNCTION public.phase6_financial_facts_before208_internal(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.phase6_financial_facts_before208_internal(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.phase6_financial_facts_internal(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.phase6_financial_facts_internal(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
