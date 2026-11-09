-- QUARANTINED phase2. A new activation epoch, never a reopening of GoLive047.
-- All existing orders/payments/debts and the eight approved bridges stay intact.
CREATE TABLE sales_lite2.opening_epochs(
 id UUID PRIMARY KEY,request_key TEXT NOT NULL UNIQUE REFERENCES sales_lite1.requests(key),
 activated_at TIMESTAMPTZ NOT NULL,created_by UUID NOT NULL REFERENCES public.profiles(id),
 manifest JSONB NOT NULL,preview_sha256 TEXT NOT NULL CHECK(preview_sha256~'^[a-f0-9]{64}$')
);
CREATE TABLE sales_lite2.opening_epoch_items(
 epoch_id UUID NOT NULL REFERENCES sales_lite2.opening_epochs(id),
 product_id UUID NOT NULL REFERENCES public.products(id),warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),
 previous_quantity INTEGER NOT NULL CHECK(previous_quantity>=0),actual_quantity INTEGER NOT NULL CHECK(actual_quantity>=0),
 previous_cost BIGINT NOT NULL,previous_wac NUMERIC(24,6),unit_cost BIGINT NOT NULL CHECK(unit_cost>=0),
 movement_id UUID REFERENCES public.inventory_movements(id),PRIMARY KEY(epoch_id,product_id,warehouse_id)
);
DO $$ DECLARE t TEXT;BEGIN
 FOREACH t IN ARRAY ARRAY['opening_epochs','opening_epoch_items'] LOOP
  EXECUTE format('ALTER TABLE sales_lite2.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE sales_lite2.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER lite2_immutable BEFORE UPDATE OR DELETE ON sales_lite2.%I FOR EACH ROW EXECUTE FUNCTION sales_lite1.immutable()',t);
  EXECUTE format('CREATE TRIGGER lite2_no_truncate BEFORE TRUNCATE ON sales_lite2.%I FOR EACH STATEMENT EXECUTE FUNCTION sales_lite1.immutable()',t);
 END LOOP;
END $$;

CREATE FUNCTION sales_lite2.epoch_request(p_rows JSONB,p_notes TEXT) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE row JSONB;canonical JSONB:='[]';quantity BIGINT;cost BIGINT;pid UUID;wid UUID;
BEGIN
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 10000
 OR octet_length(p_rows::TEXT)>2097152 OR length(COALESCE(btrim(p_notes),'')) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'LITE2_EPOCH_INPUT_INVALID';END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF jsonb_typeof(row) IS DISTINCT FROM 'object' OR(row-ARRAY['productId','warehouseId','actualQuantity','unitCostInMinorUnits'])<>'{}'::JSONB
  OR COALESCE(row->>'actualQuantity','')!~'^(0|[1-9][0-9]{0,9})$' OR COALESCE(row->>'unitCostInMinorUnits','')!~'^(0|[1-9][0-9]{0,11})$'
  THEN RAISE EXCEPTION 'LITE2_EPOCH_ROW_INVALID';END IF;
  pid:=public.phase3_require_uuid_internal(row->>'productId','epoch product');wid:=public.phase3_require_uuid_internal(row->>'warehouseId','epoch warehouse');
  quantity:=(row->>'actualQuantity')::BIGINT;cost:=(row->>'unitCostInMinorUnits')::BIGINT;
  IF quantity>2147483647 OR(quantity>0 AND cost<=0) THEN RAISE EXCEPTION 'LITE2_EPOCH_COST_QUANTITY_INVALID';END IF;
  -- Validation stays row-specific; aggregate once instead of copying an ever-growing JSON array.
 END LOOP;
 SELECT jsonb_agg(jsonb_build_object('productId',(x->>'productId')::UUID,'warehouseId',(x->>'warehouseId')::UUID,'actualQuantity',(x->>'actualQuantity')::BIGINT,'unitCostInMinorUnits',(x->>'unitCostInMinorUnits')::BIGINT)) INTO canonical FROM jsonb_array_elements(p_rows) x;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(canonical) x GROUP BY x->>'productId',x->>'warehouseId' HAVING count(*)>1)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(canonical) x GROUP BY x->>'productId' HAVING count(DISTINCT x->>'unitCostInMinorUnits')>1)
 THEN RAISE EXCEPTION 'LITE2_EPOCH_DUPLICATE_OR_COST_CONFLICT';END IF;
 RETURN jsonb_build_object('notes',btrim(p_notes),'rows',(SELECT jsonb_agg(x ORDER BY x->>'productId',x->>'warehouseId') FROM jsonb_array_elements(canonical) x));
END $$;
REVOKE ALL ON FUNCTION sales_lite2.epoch_request(JSONB,TEXT) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION sales_lite2.prepare_epoch(p_request JSONB) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE state JSONB;lines JSONB;
BEGIN
 IF NOT sales_lite1.enabled() THEN RAISE EXCEPTION 'LITE1_MODE_DISABLED';END IF;
 SELECT to_jsonb(s) INTO STRICT state FROM public.go_live_setup_state s WHERE id;
 IF state->>'finished_at' IS NULL THEN RAISE EXCEPTION 'LITE2_EPOCH_GO_LIVE_NOT_FINISHED';END IF;
 IF EXISTS(SELECT 1 FROM public.cash_shifts WHERE status='open')
 OR EXISTS(SELECT 1 FROM public.orders WHERE status NOT IN('completed','cancelled','expired','returned'))
 THEN RAISE EXCEPTION 'LITE1_MODE_REQUIRES_QUIESCENCE';END IF;
 IF EXISTS(SELECT 1 FROM public.inventory_balances WHERE reserved_quantity<>0)
 OR EXISTS(SELECT 1 FROM public.order_inventory_reservations WHERE reservation_state='active') THEN RAISE EXCEPTION 'LITE2_EPOCH_RESERVATIONS_EXIST';END IF;
 -- Never discard forgotten stock in inactive warehouses/products silently.
 IF EXISTS(SELECT 1 FROM public.inventory_balances b JOIN public.products p ON p.id=b.product_id JOIN public.warehouses w ON w.id=b.warehouse_id
 JOIN public.branches branch ON branch.id=w.branch_id WHERE b.on_hand_quantity<>0 AND(NOT p.is_active OR p.is_flavor_master OR NOT w.is_active OR NOT branch.is_active))
 THEN RAISE EXCEPTION 'LITE2_EPOCH_INACTIVE_STOCK_REVIEW';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_request->'rows') x
 LEFT JOIN public.products p ON p.id=(x->>'productId')::UUID
 LEFT JOIN public.warehouses w ON w.id=(x->>'warehouseId')::UUID LEFT JOIN public.branches branch ON branch.id=w.branch_id
 WHERE p.id IS NULL OR NOT p.is_active OR p.is_flavor_master OR p.unit_id IS NULL OR w.id IS NULL OR NOT w.is_active OR branch.id IS NULL OR NOT branch.is_active)
 THEN RAISE EXCEPTION 'LITE2_EPOCH_PRODUCT_WAREHOUSE_INVALID';END IF;
 IF EXISTS(SELECT 1 FROM public.products p CROSS JOIN public.warehouses w JOIN public.branches branch ON branch.id=w.branch_id
 WHERE p.is_active AND NOT p.is_flavor_master AND w.is_active AND branch.is_active
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_request->'rows') x WHERE(x->>'productId')::UUID=p.id AND(x->>'warehouseId')::UUID=w.id))
 THEN RAISE EXCEPTION 'LITE2_EPOCH_COMPLETE_COUNT_REQUIRED';END IF;
 SELECT jsonb_agg(x||jsonb_build_object('previousQuantity',COALESCE(b.on_hand_quantity,0),'previousCost',p.cost_price_in_minor_units,
  'previousWac',p.wac_cost_in_minor_units_exact,'productUpdatedAt',p.updated_at,'unitsPerPurchasePackage',p.units_per_purchase_unit)
  ORDER BY x->>'productId',x->>'warehouseId') INTO lines
 FROM jsonb_array_elements(p_request->'rows') x JOIN public.products p ON p.id=(x->>'productId')::UUID
 LEFT JOIN public.inventory_balances b ON b.product_id=p.id AND b.warehouse_id=(x->>'warehouseId')::UUID;
 RETURN jsonb_build_object('request',p_request,'lines',lines,'goLiveState',state,'itemCount',jsonb_array_length(lines),
  'totalQuantity',(SELECT sum((x->>'actualQuantity')::BIGINT)::TEXT FROM jsonb_array_elements(lines) x),
  'totalValueExact',(SELECT sum((x->>'actualQuantity')::NUMERIC*(x->>'unitCostInMinorUnits')::NUMERIC)::TEXT FROM jsonb_array_elements(lines) x));
END $$;
REVOKE ALL ON FUNCTION sales_lite2.prepare_epoch(JSONB) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.lite1_preview_epoch2(p_rows JSONB,p_notes TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE plan JSONB;
BEGIN
 PERFORM sales_lite1.owner();IF auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' THEN RAISE EXCEPTION 'LITE2_OWNER_AAL2_REQUIRED';END IF;
 plan:=sales_lite2.prepare_epoch(sales_lite2.epoch_request(p_rows,p_notes));
 RETURN (plan-ARRAY['request','goLiveState'])||jsonb_build_object('contractVersion','sales-only-epoch2-v1','previewFingerprint',encode(extensions.digest(plan::TEXT,'sha256'),'hex'));
END $$;
REVOKE ALL ON FUNCTION public.lite1_preview_epoch2(JSONB,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_preview_epoch2(JSONB,TEXT) TO authenticated;

CREATE FUNCTION public.lite1_activate_epoch2(p_rows JSONB,p_notes TEXT,p_key TEXT,p_preview TEXT,p_confirmation TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE request JSONB;identity JSONB;fingerprint TEXT;r sales_lite1.requests;plan JSONB;line JSONB;result JSONB;
 eid UUID:=gen_random_uuid();at TIMESTAMPTZ;delta INTEGER;movement UUID;pid UUID;wid UUID;
BEGIN
 PERFORM sales_lite1.owner();IF auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' THEN RAISE EXCEPTION 'LITE2_OWNER_AAL2_REQUIRED';END IF;
 IF p_key IS NULL OR length(p_key) NOT BETWEEN 8 AND 128 OR COALESCE(p_preview,'')!~'^[a-f0-9]{64}$'
 OR p_confirmation IS DISTINCT FROM 'تفعيل المحاسبة بالجرد المعتمد' THEN RAISE EXCEPTION 'LITE2_EPOCH_CONFIRMATION_REQUIRED';END IF;
 request:=sales_lite2.epoch_request(p_rows,p_notes);identity:=jsonb_build_object('request',request,'preview',p_preview);
 fingerprint:=encode(extensions.digest(identity::TEXT,'sha256'),'hex');PERFORM pg_advisory_xact_lock(hashtextextended(p_key,0));
 SELECT * INTO r FROM sales_lite1.requests WHERE key=p_key;
 IF FOUND THEN
  IF r.kind<>'epoch2' OR r.actor IS DISTINCT FROM auth.uid() OR r.fingerprint<>fingerprint OR r.result IS NULL THEN RAISE EXCEPTION 'LITE1_IDEMPOTENCY_CONFLICT';END IF;
  RETURN r.result;
 END IF;
 IF EXISTS(SELECT 1 FROM public.business_operations WHERE idempotency_key=p_key) OR EXISTS(SELECT 1 FROM public.orders WHERE idempotency_key=p_key) THEN RAISE EXCEPTION 'LITE1_IDEMPOTENCY_CONFLICT';END IF;
 BEGIN
  PERFORM 1 FROM sales_lite1.mode WHERE id FOR UPDATE NOWAIT;
  -- Prevent catalog/warehouse/balance phantoms during the short activation.
  -- No new trigger, global setting or relaxed legacy writer is necessary.
  LOCK TABLE public.products,public.warehouses,public.branches,public.inventory_balances IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'LITE2_EPOCH_BUSY';END;
 plan:=sales_lite2.prepare_epoch(request);
 IF encode(extensions.digest(plan::TEXT,'sha256'),'hex')<>p_preview THEN RAISE EXCEPTION 'LITE2_EPOCH_PREVIEW_CHANGED';END IF;
 INSERT INTO sales_lite1.requests VALUES(p_key,'epoch2',fingerprint,auth.uid(),NULL);
 at:=clock_timestamp();INSERT INTO sales_lite2.opening_epochs VALUES(eid,p_key,at,auth.uid(),plan,p_preview);
 -- Mode, physical counts and costs commit atomically. Any error rolls back ALL.
 -- The original inventory/cost guards now admit only ordinary full-mode work.
 UPDATE sales_lite1.mode SET full_accounting=true WHERE id;
 -- One cost per SKU was already validated across every warehouse. Update each
 -- product once, not once per warehouse; keep all ordinary triggers enabled.
 UPDATE public.products p SET cost_price_in_minor_units=c.cost,
  wac_cost_in_minor_units_exact=c.cost::NUMERIC,updated_at=at
 FROM (SELECT DISTINCT (x->>'productId')::UUID pid,(x->>'unitCostInMinorUnits')::BIGINT cost FROM jsonb_array_elements(plan->'lines') x) c WHERE p.id=c.pid;
 FOR line IN SELECT value FROM jsonb_array_elements(plan->'lines') LOOP
  pid:=(line->>'productId')::UUID;wid:=(line->>'warehouseId')::UUID;
  INSERT INTO public.inventory_balances(product_id,warehouse_id,on_hand_quantity,reserved_quantity,updated_at)
   VALUES(pid,wid,(line->>'actualQuantity')::INTEGER,0,at)
   ON CONFLICT(product_id,warehouse_id) DO UPDATE SET on_hand_quantity=EXCLUDED.on_hand_quantity,updated_at=EXCLUDED.updated_at;
  delta:=(line->>'actualQuantity')::INTEGER-(line->>'previousQuantity')::INTEGER;movement:=NULL;
  IF delta<>0 THEN
   INSERT INTO public.inventory_movements(product_id,warehouse_id,movement_type,quantity,balance_before,balance_after,reference_type,reference_id,notes,created_by,created_at)
   VALUES(pid,wid,'opening_balance',delta,(line->>'previousQuantity')::INTEGER,(line->>'actualQuantity')::INTEGER,'sales_lite2_opening_epoch',eid,request->>'notes',auth.uid(),at) RETURNING id INTO movement;
  END IF;
  INSERT INTO sales_lite2.opening_epoch_items VALUES(eid,pid,wid,(line->>'previousQuantity')::INTEGER,(line->>'actualQuantity')::INTEGER,
   (line->>'previousCost')::BIGINT,(line->>'previousWac')::NUMERIC,(line->>'unitCostInMinorUnits')::BIGINT,movement);
 END LOOP;
 INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details) VALUES(auth.uid(),'LITE2_OPENING_EPOCH','sales_lite2.opening_epochs',eid,
  jsonb_build_object('preview',p_preview,'itemCount',plan->'itemCount','activatedAt',at));
 result:=jsonb_build_object('success',true,'epochId',eid,'activatedAt',at,'fullAccounting',true,'itemCount',plan->'itemCount',
  'totalQuantity',plan->'totalQuantity','totalValueExact',plan->'totalValueExact');
 RETURN sales_lite1.finish(p_key,result);
END $$;
REVOKE ALL ON FUNCTION public.lite1_activate_epoch2(JSONB,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_activate_epoch2(JSONB,TEXT,TEXT,TEXT,TEXT) TO authenticated;
-- Owner's activation worksheet only. Not a normal stock/cost screen.
CREATE FUNCTION public.lite1_epoch_catalog2() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rows JSONB;
BEGIN
 PERFORM sales_lite1.owner();IF auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' THEN RAISE EXCEPTION 'LITE2_OWNER_AAL2_REQUIRED';END IF;
 IF NOT sales_lite1.enabled() THEN RAISE EXCEPTION 'LITE1_MODE_DISABLED';END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('productId',p.id,'warehouseId',w.id,'sku',p.sku,'productName',p.name_ar,
  'warehouseName',w.name_ar,'baseUnitName',COALESCE(u.name_ar,'باكيت'),'previousQuantity',COALESCE(b.on_hand_quantity,0)) ORDER BY p.id,w.id),'[]'::JSONB) INTO rows
 FROM public.products p CROSS JOIN public.warehouses w JOIN public.branches branch ON branch.id=w.branch_id
 LEFT JOIN public.units u ON u.id=p.unit_id LEFT JOIN public.inventory_balances b ON b.product_id=p.id AND b.warehouse_id=w.id
 WHERE p.is_active AND NOT p.is_flavor_master AND w.is_active AND branch.is_active;
 IF jsonb_array_length(rows) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'LITE2_EPOCH_INPUT_INVALID';END IF;
 RETURN jsonb_build_object('contractVersion','sales-only-epoch-catalog2-v1','fullAccounting',false,'itemCount',jsonb_array_length(rows),'rows',rows);
END $$;
REVOKE ALL ON FUNCTION public.lite1_epoch_catalog2() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_epoch_catalog2() TO authenticated;
