-- QUARANTINED. New writer, same public ledger; no frozen219 function replaced.
CREATE TABLE sales_lite2.sales(
 order_id UUID PRIMARY KEY REFERENCES sales_lite1.orders(order_id),
 request_key TEXT NOT NULL UNIQUE REFERENCES sales_lite1.requests(key),
 plan JSONB NOT NULL,initial_payment_id UUID REFERENCES public.customer_payments(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE sales_lite2.sales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE sales_lite2.sales FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER lite2_immutable BEFORE UPDATE OR DELETE ON sales_lite2.sales FOR EACH ROW EXECUTE FUNCTION sales_lite1.immutable();
CREATE TRIGGER lite2_no_truncate BEFORE TRUNCATE ON sales_lite2.sales FOR EACH STATEMENT EXECUTE FUNCTION sales_lite1.immutable();

CREATE FUNCTION sales_lite2.pos(p_request JSONB,p_key TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $pos$
DECLARE
 replay JSONB;plan JSONB;line JSONB;instance JSONB;component JSONB;
 result JSONB;items JSONB:='[]';item JSONB;instances JSONB;proof_lines JSONB:='[]';proof_instances JSONB;proof_components JSONB;
 product public.products;leaf public.products;customer public.customers;
 bid UUID;wid UUID;cid UUID;shift_id UUID;oid UUID:=gen_random_uuid();op UUID:=gen_random_uuid();item_id UUID;instance_id UUID;component_id UUID;
 ids UUID[];unavailable UUID[]:='{}';pid UUID;name TEXT;method TEXT;paid BIGINT:=0;received BIGINT;change_due BIGINT:=0;
 payment JSONB;initial_method TEXT;initial_id UUID;initial_reference TEXT;initial_amount BIGINT;
 base_name TEXT;parcel_name TEXT;stored_quantity INTEGER;effective_price BIGINT;
BEGIN
 PERFORM sales_lite1.owner();
 IF jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR octet_length(p_request::TEXT)>65536
 OR(p_request-ARRAY['branchId','warehouseId','customerId','customerName','paymentMethod','lines','discountInMinorUnits','amountReceivedInMinorUnits','initialPayment','unavailableConfirmed'])<>'{}'::JSONB THEN RAISE EXCEPTION 'LITE2_REQUEST_INVALID';END IF;
 -- Preserve the raw-key coordinator used by the existing POS/partial writers,
 -- in addition to the private sealed-request guard introduced by phase1.
 PERFORM pg_advisory_xact_lock(hashtext(p_key));
 replay:=sales_lite1.lock_request(p_key,'pos2',p_request);IF replay IS NOT NULL THEN RETURN replay;END IF;
 bid:=(p_request->>'branchId')::UUID;wid:=(p_request->>'warehouseId')::UUID;cid:=NULLIF(p_request->>'customerId','')::UUID;
 method:=p_request->>'paymentMethod';received:=COALESCE((p_request->>'amountReceivedInMinorUnits')::BIGINT,0);
 IF method IS NULL OR method NOT IN('cash','cliq','debt') OR received<0 THEN RAISE EXCEPTION 'PHASE3_POS_PAYMENT_METHOD_INVALID';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.branches WHERE id=bid AND is_active)
 OR NOT EXISTS(SELECT 1 FROM public.warehouses WHERE id=wid AND branch_id=bid AND is_active) THEN RAISE EXCEPTION 'PHASE3_POS_LOCATION_INVALID';END IF;
 IF cid IS NOT NULL THEN
  SELECT * INTO customer FROM public.customers WHERE id=cid AND is_active AND NOT is_deleted AND NOT is_blocked FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PHASE3_POS_CUSTOMER_INVALID';END IF;name:=customer.full_name;
 ELSE name:=COALESCE(NULLIF(btrim(p_request->>'customerName'),''),'زبون نقدي');END IF;
 IF length(name)>120 THEN RAISE EXCEPTION 'LITE2_CUSTOMER_NAME_INVALID';END IF;
 IF method='debt' AND cid IS NULL THEN RAISE EXCEPTION 'PHASE3_POS_DEBT_CUSTOMER_REQUIRED';END IF;
 SELECT id INTO shift_id FROM public.cash_shifts WHERE branch_id=bid AND status='open' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PHASE3_POS_OPEN_SHIFT_REQUIRED';END IF;
 -- Validate/canonicalize first, then lock all products+parents in stable order
 -- and re-read commercial truth. No inventory rows or quantities are touched.
 plan:=sales_lite2.plan(p_request->'lines','admin_pos',COALESCE((p_request->>'discountInMinorUnits')::BIGINT,0));
 SELECT array_agg(DISTINCT id ORDER BY id) INTO ids FROM(
  SELECT(value->>'product_id')::UUID id FROM jsonb_array_elements(plan->'lines')
  UNION SELECT(c->>'product_id')::UUID FROM jsonb_array_elements(plan->'lines') l CROSS JOIN LATERAL jsonb_array_elements(l->'parcel_instances') i CROSS JOIN LATERAL jsonb_array_elements(i->'components') c
 ) x;
 PERFORM 1 FROM public.products WHERE id=ANY(ids) OR id IN(SELECT flavor_master_product_id FROM public.products WHERE id=ANY(ids)) ORDER BY id FOR UPDATE;
 plan:=sales_lite2.plan(p_request->'lines','admin_pos',COALESCE((p_request->>'discountInMinorUnits')::BIGINT,0));
 IF p_request?'unavailableConfirmed' AND jsonb_typeof(p_request->'unavailableConfirmed')<>'array' THEN RAISE EXCEPTION 'LITE2_CONFIRMATION_INVALID';END IF;
 FOREACH pid IN ARRAY ids LOOP
  IF NOT sales_lite1.available(pid) THEN
   IF NOT COALESCE(p_request->'unavailableConfirmed' @> jsonb_build_array(pid),false) THEN RAISE EXCEPTION 'LITE1_UNAVAILABLE_CONFIRM_REQUIRED';END IF;
   unavailable:=array_append(unavailable,pid);
  END IF;
 END LOOP;
 IF p_request?'initialPayment' THEN
  IF method<>'debt' OR jsonb_typeof(p_request->'initialPayment')<>'object'
  OR((p_request->'initialPayment')-ARRAY['amountInMinorUnits','method','referenceNumber'])<>'{}'::JSONB THEN RAISE EXCEPTION 'POS216_INITIAL_PAYMENT_INVALID';END IF;
  initial_amount:=(p_request#>>'{initialPayment,amountInMinorUnits}')::BIGINT;initial_method:=p_request#>>'{initialPayment,method}';initial_reference:=NULLIF(btrim(p_request#>>'{initialPayment,referenceNumber}'),'');
  IF initial_amount IS NULL OR initial_amount<=0 OR initial_amount>=(plan->>'totalInMinorUnits')::BIGINT OR initial_method IS NULL OR initial_method NOT IN('cash','cliq') OR length(COALESCE(initial_reference,''))>200 THEN RAISE EXCEPTION 'POS216_INITIAL_PAYMENT_INVALID';END IF;
 ELSIF method IN('cash','cliq') THEN paid:=(plan->>'totalInMinorUnits')::BIGINT;END IF;
 IF method='cash' AND received>0 AND received<paid THEN RAISE EXCEPTION 'PHASE3_POS_TENDER_INSUFFICIENT';END IF;
 IF method='cash' THEN change_due:=GREATEST(received-paid,0);END IF;
 -- Immutable operation envelope is inserted once, like the phase1 contract.
 -- The sealed request stores the complete DTO (including the subsequently
 -- generated partial-payment ID). Never UPDATE immutable business history.
 INSERT INTO public.business_operations(id,operation_type,idempotency_key,request_fingerprint,initiated_by,result_snapshot,completed_at)
 VALUES(op,'lite1_pos',p_key,(SELECT fingerprint FROM sales_lite1.requests WHERE key=p_key),auth.uid(),
  jsonb_build_object('success',true,'orderId',oid,'operationId',op,'contractVersion','lite2-pos-v1','totalInMinorUnits',(plan->>'totalInMinorUnits')::BIGINT,'accountingTracked',false),now());
 INSERT INTO sales_lite1.orders VALUES(oid,op,'{}',unavailable);
 INSERT INTO public.orders(id,order_number,customer_id,customer_name_snapshot,branch_id,warehouse_id,status,payment_method,payment_status,
  subtotal_in_minor_units,discount_in_minor_units,total_in_minor_units,amount_paid_in_minor_units,change_due_in_minor_units,source,idempotency_key,operation_id,cash_shift_id)
 VALUES(oid,'L2-'||oid::TEXT,cid,name,bid,wid,'completed',method,CASE WHEN method='debt' THEN 'unpaid' ELSE 'paid' END,
  (plan->>'subtotalInMinorUnits')::BIGINT,(plan->>'discountInMinorUnits')::BIGINT,(plan->>'totalInMinorUnits')::BIGINT,paid,change_due,'pos',p_key,op,shift_id);
 INSERT INTO sales_lite1.completions(order_id) VALUES(oid);
 FOR line IN SELECT value FROM jsonb_array_elements(plan->'lines') ORDER BY(value->>'line_sequence')::INTEGER LOOP
  SELECT * INTO STRICT product FROM public.products WHERE id=(line->>'product_id')::UUID;
  SELECT name_ar INTO base_name FROM public.units WHERE id=product.unit_id;
  SELECT name_ar INTO parcel_name FROM public.units WHERE id=product.sale_unit_id;
  base_name:=COALESCE(base_name,'وحدة');parcel_name:=CASE WHEN line->>'commercial_line_kind'='base_unit' THEN base_name ELSE COALESCE(parcel_name,'طرد') END;
  item_id:=gen_random_uuid();stored_quantity:=CASE WHEN line->>'commercial_line_kind'='configurable_parcel' THEN(line->>'commercial_quantity')::INTEGER ELSE(line->>'base_quantity')::INTEGER END;
  INSERT INTO public.order_items(id,order_id,product_id,product_name_snapshot,sku_snapshot,quantity,unit_price_in_minor_units,line_total_in_minor_units,
   sale_package_quantity,units_per_sale_package,sale_package_name_snapshot,sale_package_price_in_minor_units,commercial_line_kind,
   family_product_id,parcel_configuration_id,parcel_configuration_revision,base_unit_name_snapshot,allocated_discount_snapshot_in_minor_units,net_refundable_amount_snapshot_in_minor_units)
  VALUES(item_id,oid,product.id,product.name_ar,product.sku,stored_quantity,(line->>'unit_price_in_minor_units')::BIGINT,(line->>'gross_amount_in_minor_units')::BIGINT,
   (line->>'commercial_quantity')::INTEGER,(line->>'units_per_parcel')::INTEGER,parcel_name,(line->>'unit_price_in_minor_units')::BIGINT,line->>'commercial_line_kind',
   CASE WHEN line->>'commercial_line_kind'='configurable_parcel' THEN product.id END,NULLIF(line#>>'{line,parcel_configuration_id}','')::UUID,NULLIF(line#>>'{line,configuration_revision}','')::INTEGER,
   base_name,(line->>'allocated_discount_in_minor_units')::BIGINT,(line->>'net_refundable_amount_in_minor_units')::BIGINT);
  instances:='[]';proof_instances:='[]';
  FOR instance IN SELECT value FROM jsonb_array_elements(line->'parcel_instances') ORDER BY(value->>'instance_sequence')::INTEGER LOOP
   PERFORM public.phase3_assert_configurable_parcel_creation_allowed_internal('erp_user',auth.uid());
   instance_id:=gen_random_uuid();
   INSERT INTO public.order_parcel_instances(id,order_item_id,order_id,operation_id,parcel_configuration_id,family_product_id,instance_sequence,configuration_revision,
    units_per_parcel_snapshot,parcel_unit_name_snapshot,gross_amount_snapshot_in_minor_units,allocated_discount_snapshot_in_minor_units,net_refundable_amount_snapshot_in_minor_units,cogs_snapshot_in_minor_units,composition_fingerprint)
   VALUES(instance_id,item_id,oid,op,(line#>>'{line,parcel_configuration_id}')::UUID,product.id,(instance->>'instance_sequence')::INTEGER,(line#>>'{line,configuration_revision}')::INTEGER,
    (line->>'units_per_parcel')::INTEGER,parcel_name,(instance->>'gross_amount_in_minor_units')::BIGINT,(instance->>'allocated_discount_in_minor_units')::BIGINT,(instance->>'net_refundable_amount_in_minor_units')::BIGINT,0,
    public.phase3_request_fingerprint_internal(public.phase3_canonicalize_components_internal(instance->'components')));
   proof_components:='[]';
   FOR component IN SELECT value FROM jsonb_array_elements(instance->'components') ORDER BY(value->>'product_id')::UUID LOOP
    SELECT * INTO STRICT leaf FROM public.products WHERE id=(component->>'product_id')::UUID;
    effective_price:=public.phase4_effective_standalone_unit_price_internal(leaf.id,'admin_pos');
    component_id:=gen_random_uuid();
    INSERT INTO public.order_parcel_components(id,parcel_instance_id,operation_id,product_id,base_quantity,product_name_snapshot,sku_snapshot,base_unit_name_snapshot,unit_cost_snapshot_in_minor_units,cogs_snapshot_in_minor_units)
    VALUES(component_id,instance_id,op,leaf.id,(component->>'base_quantity')::INTEGER,leaf.name_ar,leaf.sku,base_name,0,0);
    proof_components:=proof_components||jsonb_build_array(component||jsonb_build_object('component_id',component_id,'product_name_snapshot',leaf.name_ar,'sku_snapshot',leaf.sku,'base_unit_name_snapshot',base_name,'effectiveStandaloneUnitPriceInMinorUnits',effective_price));
   END LOOP;
   PERFORM public.finalize_order_parcel_instance_internal(instance_id);
   instances:=instances||jsonb_build_array(instance||jsonb_build_object('instance_id',instance_id,'components',proof_components,'configuration_revision',(line#>>'{line,configuration_revision}')::INTEGER,'units_per_parcel',(line->>'units_per_parcel')::INTEGER));
   proof_instances:=proof_instances||jsonb_build_array(instance||jsonb_build_object('instance_id',instance_id,'components',proof_components));
  END LOOP;
  proof_lines:=proof_lines||jsonb_build_array(line||jsonb_build_object('orderItemId',item_id,'parcel_instances',proof_instances));
  item:=jsonb_build_object('id',item_id,'productId',product.id,'productName',product.name_ar,'sku',product.sku,'commercialLineKind',line->>'commercial_line_kind',
   'quantity',(line->>'commercial_quantity')::INTEGER,'baseQuantity',(line->>'base_quantity')::INTEGER,'unitsPerSalePackage',(line->>'units_per_parcel')::INTEGER,'salePackage',parcel_name,
   'unitPriceInMinorUnits',(line->>'unit_price_in_minor_units')::BIGINT,'lineTotalInMinorUnits',(line->>'gross_amount_in_minor_units')::BIGINT,
   'allocatedDiscountInMinorUnits',(line->>'allocated_discount_in_minor_units')::BIGINT,'netRefundableAmountInMinorUnits',(line->>'net_refundable_amount_in_minor_units')::BIGINT,'parcelInstances',instances,'accountingTracked',false);
  items:=items||jsonb_build_array(item);
 END LOOP;
 IF initial_amount IS NOT NULL THEN
  payment:=public.record_customer_order_payment_once(oid,initial_amount,initial_method,initial_reference,NULL,'lite2-initial-'||op::TEXT);
  initial_id:=(payment->>'payment_id')::UUID;paid:=initial_amount;
 END IF;
 result:=jsonb_build_object('success',true,'idempotentReplay',false,'orderId',oid,'operationId',op,'orderNumber','L2-'||oid::TEXT,'warehouseId',wid,'branchId',bid,'cashShiftId',shift_id,
  'customerName',name,'subtotalInMinorUnits',(plan->>'subtotalInMinorUnits')::BIGINT,'discountInMinorUnits',(plan->>'discountInMinorUnits')::BIGINT,'totalInMinorUnits',(plan->>'totalInMinorUnits')::BIGINT,
  'amountPaidInMinorUnits',paid,'changeDueInMinorUnits',change_due,'remainingInMinorUnits',(plan->>'totalInMinorUnits')::BIGINT-paid,'paymentMethod',method,
  'paymentStatus',CASE WHEN initial_amount IS NOT NULL THEN 'partially_paid' WHEN method='debt' THEN 'unpaid' ELSE 'paid' END,'items',items,'unavailableConfirmed',to_jsonb(unavailable),'accountingTracked',false);
 IF initial_id IS NOT NULL THEN result:=result||jsonb_build_object('initialPaymentMethod',initial_method,'initialPaymentId',initial_id);END IF;
 INSERT INTO sales_lite2.sales(order_id,request_key,plan,initial_payment_id) VALUES(oid,p_key,plan||jsonb_build_object('lines',proof_lines),initial_id);
 INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details) VALUES(auth.uid(),'LITE2_POS','orders',oid,jsonb_build_object('operationId',op,'unavailableConfirmed',to_jsonb(unavailable)));
 RETURN sales_lite1.finish(p_key,result);
END $pos$;
REVOKE ALL ON FUNCTION sales_lite2.pos(JSONB,TEXT) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.lite1_pos2(p_request JSONB,p_key TEXT) RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT sales_lite2.pos(p_request,p_key) $$;
REVOKE ALL ON FUNCTION public.lite1_pos2(JSONB,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_pos2(JSONB,TEXT) TO authenticated;
