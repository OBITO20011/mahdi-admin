-- LOCAL incomplete223 lifecycle prototype. Apply only after prototype223.sql
-- on the fixed disposable test database. Returns and customer text await owner
-- decisions;this file is not an active migration or an owner tool.
BEGIN;

CREATE FUNCTION sales_lite3.effective_available223(p_product UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT sales_lite1.available(p_product) AND NOT EXISTS(
  SELECT 1 FROM sales_lite3.quantity_counters c JOIN public.products p ON p.id=c.product_id
  WHERE c.product_id=p_product AND c.enabled AND(c.quantity=0 OR c.unit_id IS DISTINCT FROM p.unit_id)
 )
$$;

CREATE FUNCTION sales_lite3.plan_quantities223(p_plan JSONB) RETURNS TABLE(product_id UUID,required_quantity BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT required.product_id,sum(required.quantity)::BIGINT FROM(
  SELECT(l->>'product_id')::UUID AS product_id,(l->>'base_quantity')::BIGINT AS quantity
  FROM jsonb_array_elements(p_plan->'lines') l WHERE l->>'commercial_line_kind'<>'configurable_parcel'
  UNION ALL
  SELECT(c->>'product_id')::UUID,(c->>'base_quantity')::BIGINT
  FROM jsonb_array_elements(p_plan->'lines') l
  CROSS JOIN LATERAL jsonb_array_elements(l->'parcel_instances') i
  CROSS JOIN LATERAL jsonb_array_elements(i->'components') c
  WHERE l->>'commercial_line_kind'='configurable_parcel'
 ) required GROUP BY required.product_id ORDER BY required.product_id
$$;

-- The existing POS writer already locks all products/parents in UUID order.
-- Aggregate every ordinary/parcel/component line before materialization, so a
-- repeated product on multiple lines needs one explicit shortage confirmation.
CREATE FUNCTION sales_lite3.confirm_plan223(p_plan JSONB,p_existing UUID[],p_confirmed JSONB) RETURNS UUID[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r RECORD;confirmed UUID[]:=p_existing;
BEGIN
 FOR r IN
  SELECT required.product_id,required.required_quantity,c.quantity FROM sales_lite3.plan_quantities223(p_plan) required
  JOIN sales_lite3.quantity_counters c ON c.product_id=required.product_id AND c.enabled
  WHERE required.required_quantity>c.quantity ORDER BY required.product_id
 LOOP
  IF NOT COALESCE(p_confirmed @> jsonb_build_array(r.product_id),false) THEN
   RAISE EXCEPTION 'LITE1_UNAVAILABLE_CONFIRM_REQUIRED: QUANTITY223_SHORTAGE';
  END IF;
  IF NOT r.product_id=ANY(COALESCE(confirmed,'{}'::UUID[])) THEN confirmed:=array_append(confirmed,r.product_id);END IF;
 END LOOP;
 RETURN confirmed;
END $$;

CREATE FUNCTION public.lite3_pos_quantity_check223(p_lines JSONB) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE plan JSONB;rows JSONB;
BEGIN
 PERFORM sales_lite3.assert_owner223();
 plan:=sales_lite2.plan(p_lines,'admin_pos',0);
 SELECT COALESCE(jsonb_agg(jsonb_build_object('productId',p.id,'name',p.name_ar,'unitName',COALESCE(u.name_ar,'باكيت'),
  'quantity',c.quantity,'required',r.required_quantity,'revision',c.revision) ORDER BY p.id),'[]') INTO rows
 FROM sales_lite3.plan_quantities223(plan) r
 JOIN sales_lite3.quantity_counters c ON c.product_id=r.product_id AND c.enabled
 JOIN public.products p ON p.id=r.product_id LEFT JOIN public.units u ON u.id=p.unit_id
 WHERE c.quantity<r.required_quantity;
 RETURN jsonb_build_object('contractVersion','optional-quantity223-v1','fullAccounting',false,'shortages',rows);
END $$;
REVOKE ALL ON FUNCTION public.lite3_pos_quantity_check223(JSONB) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite3_pos_quantity_check223(JSONB) TO authenticated;

CREATE FUNCTION sales_lite3.consume223(p_order UUID,p_product UUID,p_quantity BIGINT,p_source_type TEXT,p_source_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c sales_lite3.quantity_counters;p public.products;o public.orders;
 available BIGINT;shortage BIGINT;proof UUID[];unit_name TEXT;configuration JSONB;
BEGIN
 IF NOT sales_lite1.enabled() OR NOT sales_lite1.is_order(p_order) THEN RETURN;END IF;
 IF p_quantity IS NULL OR p_quantity<=0 THEN RAISE EXCEPTION 'QUANTITY223_SALE_QUANTITY_INVALID';END IF;
 SELECT * INTO STRICT p FROM public.products WHERE id=p_product FOR UPDATE;
 SELECT * INTO c FROM sales_lite3.quantity_counters WHERE product_id=p_product FOR UPDATE;
 IF NOT FOUND OR NOT c.enabled THEN RETURN;END IF;
 IF c.unit_id IS DISTINCT FROM p.unit_id THEN RAISE EXCEPTION 'QUANTITY223_UNIT_REVIEW_REQUIRED';END IF;
 IF EXISTS(SELECT 1 FROM sales_lite3.quantity_events WHERE kind='sale' AND source_type=p_source_type AND source_id=p_source_id AND product_id=p_product) THEN
  RAISE EXCEPTION 'QUANTITY223_DUPLICATE_DEBIT';
 END IF;
 SELECT * INTO STRICT o FROM public.orders WHERE id=p_order;
 shortage:=GREATEST(p_quantity-c.quantity,0);available:=LEAST(p_quantity,c.quantity);
 IF shortage>0 THEN
  IF o.source='website' THEN RAISE EXCEPTION 'QUANTITY223_INSUFFICIENT';END IF;
  IF o.source<>'pos' THEN RAISE EXCEPTION 'QUANTITY223_SOURCE_INVALID';END IF;
  SELECT unavailable_confirmed INTO STRICT proof FROM sales_lite1.orders WHERE order_id=o.id;
  IF NOT COALESCE(p_product=ANY(proof),false) THEN RAISE EXCEPTION 'LITE1_UNAVAILABLE_CONFIRM_REQUIRED: QUANTITY223_SHORTAGE';END IF;
 END IF;
 SELECT COALESCE(name_ar,'باكيت') INTO unit_name FROM public.units WHERE id=c.unit_id;
 configuration:=jsonb_build_object('enabled',c.enabled,'threshold',c.low_threshold,'unitId',c.unit_id);
 UPDATE sales_lite3.quantity_counters SET quantity=c.quantity-available,revision=c.revision+1,updated_by=auth.uid(),updated_at=clock_timestamp() WHERE product_id=p_product;
 INSERT INTO sales_lite3.quantity_events(product_id,sku_snapshot,name_snapshot,unit_id,unit_name_snapshot,kind,source_type,source_id,order_id,
  quantity_before,quantity_after,requested_quantity,applied_quantity,shortage_quantity,revision_before,revision_after,configuration_before,configuration_after,created_by)
 VALUES(p.id,p.sku,p.name_ar,c.unit_id,COALESCE(unit_name,'باكيت'),'sale',p_source_type,p_source_id,o.id,
  c.quantity,c.quantity-available,p_quantity,available,shortage,c.revision,c.revision+1,configuration,configuration,auth.uid());
 IF shortage>0 THEN
  INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details)
  VALUES(auth.uid(),'OPTIONAL_QUANTITY_SHORTAGE','orders',o.id,jsonb_build_object('productId',p.id,'requested',p_quantity,'before',c.quantity,'deducted',available,'unavailableConfirmed',true,'shortage',shortage));
 END IF;
END $$;

CREATE FUNCTION sales_lite3.item_debit223() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF NEW.commercial_line_kind IS DISTINCT FROM 'configurable_parcel' THEN
  PERFORM sales_lite3.consume223(NEW.order_id,NEW.product_id,NEW.quantity,'order_item',NEW.id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER optional_quantity_item223 AFTER INSERT ON public.order_items
FOR EACH ROW EXECUTE FUNCTION sales_lite3.item_debit223();

CREATE FUNCTION sales_lite3.component_debit223() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE order_id UUID;
BEGIN
 IF NOT sales_lite1.enabled() THEN RETURN NEW;END IF;
 SELECT i.order_id INTO STRICT order_id FROM public.order_parcel_instances i WHERE i.id=NEW.parcel_instance_id;
 PERFORM sales_lite3.consume223(order_id,NEW.product_id,NEW.base_quantity,'parcel_component',NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER optional_quantity_component223 AFTER INSERT ON public.order_parcel_components
FOR EACH ROW EXECUTE FUNCTION sales_lite3.component_debit223();

CREATE FUNCTION sales_lite3.cancel_credit223() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r RECORD;c sales_lite3.quantity_counters;p public.products;configuration JSONB;unit_name TEXT;
BEGIN
 IF NOT sales_lite1.enabled() OR NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status<>'cancelled'
 OR NOT sales_lite1.is_order(NEW.id) THEN RETURN NEW;END IF;
 -- A full order has no new provenance and returns above without any effect.
 -- Product locking follows the same UUID order as creation/manual correction.
 FOR r IN
  SELECT product_id,sum(applied_quantity)::BIGINT AS quantity FROM sales_lite3.quantity_events
  WHERE order_id=NEW.id AND kind='sale' GROUP BY product_id ORDER BY product_id
 LOOP
  IF EXISTS(SELECT 1 FROM sales_lite3.quantity_events WHERE kind='cancel' AND source_type='order_cancel' AND source_id=NEW.id AND product_id=r.product_id) THEN
   RAISE EXCEPTION 'QUANTITY223_DUPLICATE_CANCEL';
  END IF;
  SELECT * INTO STRICT p FROM public.products WHERE id=r.product_id FOR UPDATE;
  SELECT * INTO STRICT c FROM sales_lite3.quantity_counters WHERE product_id=r.product_id FOR UPDATE;
  IF c.unit_id IS DISTINCT FROM p.unit_id THEN RAISE EXCEPTION 'QUANTITY223_UNIT_REVIEW_REQUIRED';END IF;
  SELECT COALESCE(name_ar,'باكيت') INTO unit_name FROM public.units WHERE id=c.unit_id;
  configuration:=jsonb_build_object('enabled',c.enabled,'threshold',c.low_threshold,'unitId',c.unit_id);
  UPDATE sales_lite3.quantity_counters SET quantity=c.quantity+r.quantity,revision=c.revision+1,
   low_sent=CASE WHEN c.quantity+r.quantity>=c.low_threshold THEN false ELSE c.low_sent END,
   zero_sent=CASE WHEN c.quantity+r.quantity>0 THEN false ELSE c.zero_sent END,
   updated_by=auth.uid(),updated_at=clock_timestamp() WHERE product_id=r.product_id;
  INSERT INTO sales_lite3.quantity_events(product_id,sku_snapshot,name_snapshot,unit_id,unit_name_snapshot,kind,source_type,source_id,order_id,
   quantity_before,quantity_after,requested_quantity,applied_quantity,shortage_quantity,revision_before,revision_after,configuration_before,configuration_after,created_by)
  VALUES(p.id,p.sku,p.name_ar,c.unit_id,COALESCE(unit_name,'باكيت'),'cancel','order_cancel',NEW.id,NEW.id,
   c.quantity,c.quantity+r.quantity,r.quantity,r.quantity,0,c.revision,c.revision+1,configuration,configuration,auth.uid());
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER optional_quantity_cancel223 AFTER UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION sales_lite3.cancel_credit223();

CREATE FUNCTION sales_lite3.alert_transition223() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE event_type TEXT;p public.products;unit_name TEXT;changed BOOLEAN;
BEGIN
 IF NOT sales_lite1.enabled() OR NOT NEW.enabled THEN RETURN NEW;END IF;
 changed:=TG_OP='INSERT';
 IF TG_OP='UPDATE' THEN changed:=NOT OLD.enabled OR NEW.quantity<OLD.quantity OR NEW.low_threshold>OLD.low_threshold;END IF;
 IF NOT changed THEN RETURN NEW;END IF;
 IF NEW.quantity=0 AND NOT NEW.zero_sent THEN event_type:='out_of_stock';
 ELSIF NEW.quantity>0 AND NEW.low_threshold>0 AND NEW.quantity<NEW.low_threshold AND NOT NEW.low_sent THEN event_type:='low_stock';
 ELSE RETURN NEW;END IF;
 SELECT * INTO STRICT p FROM public.products WHERE id=NEW.product_id;
 SELECT COALESCE(name_ar,'باكيت') INTO unit_name FROM public.units WHERE id=NEW.unit_id;
 PERFORM public.enqueue_automation_event('quantity223:'||event_type||':'||NEW.product_id::TEXT||':'||NEW.revision::TEXT,event_type,NEW.product_id,
  jsonb_build_object('audience','owner','quantitySource','sales_only_counter','accountingTracked',false,
   'productId',p.id,'productName',p.name_ar,'sku',p.sku,'availableQuantity',NEW.quantity,'unitName',COALESCE(unit_name,'باكيت'),'thresholdQuantity',NEW.low_threshold));
 UPDATE sales_lite3.quantity_counters SET low_sent=true,zero_sent=CASE WHEN event_type='out_of_stock' THEN true ELSE zero_sent END
 WHERE product_id=NEW.product_id;
 RETURN NEW;
END $$;
CREATE TRIGGER optional_quantity_alert223 AFTER INSERT OR UPDATE OF quantity,enabled,low_threshold ON sales_lite3.quantity_counters
FOR EACH ROW EXECUTE FUNCTION sales_lite3.alert_transition223();

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sales_lite3 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
