-- QUARANTINED phase2. Installed only after the local219 guard in commercialSql.
-- Private monetary planner: no movements, inventory locks, costs or writes.
CREATE FUNCTION sales_lite2.plan(
 p_lines JSONB,p_channel TEXT,p_discount BIGINT DEFAULT 0,
 p_promotion TEXT DEFAULT NULL,p_phone TEXT DEFAULT NULL,p_delivery_zone TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,extensions AS $plan$
DECLARE
 canonical JSONB;line JSONB;quoted JSONB:='[]';quote JSONB;
 product public.products;settings public.storefront_settings;
 price BIGINT;quantity INTEGER;size INTEGER;gross BIGINT;subtotal BIGINT:=0;
 discount BIGINT;delivery BIGINT:=0;seq INTEGER:=0;weights JSONB;
 result_lines JSONB:='[]';plan_lines JSONB:='[]';allocation BIGINT;
 instance JSONB;instances JSONB;instance_weights JSONB;instance_discount BIGINT;
BEGIN
 IF p_channel IS NULL OR p_channel NOT IN('admin_pos','customer_v2') THEN RAISE EXCEPTION 'LITE2_CHANNEL_INVALID';END IF;
 IF p_discount IS NULL OR p_discount<0 OR(p_channel='admin_pos' AND p_promotion IS NOT NULL)
 OR(p_channel='customer_v2' AND p_discount<>0) THEN RAISE EXCEPTION 'LITE2_DISCOUNT_CONTEXT_INVALID';END IF;
 canonical:=public.phase3_canonicalize_sale_request_internal(jsonb_build_object(
  'contract_version','phase3-sale-v1','actor_scope_type',CASE WHEN p_channel='admin_pos' THEN 'erp_user' ELSE 'guest_gateway' END,
  'actor_scope_hash',repeat('0',64),'operation_source',CASE WHEN p_channel='admin_pos' THEN 'admin_pos' ELSE 'customer_reservation' END,
  'warehouse_id','00000000-0000-0000-0000-000000000001','order_discount_in_minor_units',p_discount,'lines',p_lines));
 FOR line IN SELECT value FROM jsonb_array_elements(canonical->'lines') ORDER BY value::TEXT LOOP
  IF line->>'price_authority'<>'server_catalog' OR(line->>'line_discount_in_minor_units')::BIGINT<>0 THEN RAISE EXCEPTION 'LITE2_SERVER_PRICE_REQUIRED';END IF;
  SELECT * INTO product FROM public.products WHERE id=COALESCE(line->>'product_id',line->>'family_product_id')::UUID AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_PRODUCT_INVALID';END IF;
  IF line->>'commercial_line_kind'='base_unit' THEN
   IF public.parcel209_effective_only_internal(product.id) THEN RAISE EXCEPTION 'PARCEL209_UNIT_SALE_FORBIDDEN';END IF;
   price:=product.sale_price_in_minor_units;quantity:=(line->>'base_quantity')::INTEGER;size:=1;
  ELSE
   price:=product.default_sale_price_in_minor_units;quantity:=(line->>'parcel_quantity')::INTEGER;size:=product.units_per_sale_unit;
  END IF;
  IF price IS NULL OR price<0 THEN RAISE EXCEPTION 'LITE2_PRICE_INVALID';END IF;
  gross:=price*quantity::BIGINT;subtotal:=subtotal+gross;
  -- Preview reuses the exact existing family/configuration/capacity/price and
  -- promotion checks. POS has no promotion-code contract. Guest keeps original
  -- expected-price evidence, so a stale quote cannot be silently corrected.
  IF p_channel='admin_pos' THEN quoted:=quoted||jsonb_build_array(line||jsonb_build_object('expected_unit_price_in_minor_units',price));END IF;
  seq:=seq+1;
  plan_lines:=plan_lines||jsonb_build_array(jsonb_build_object(
   'line_sequence',seq,'line',line,'product_id',product.id,'commercial_line_kind',line->>'commercial_line_kind',
   'commercial_quantity',quantity,'base_quantity',quantity::BIGINT*size,'units_per_parcel',size,
   'unit_price_in_minor_units',price,'gross_amount_in_minor_units',gross));
 END LOOP;
 quote:=sales_lite2.preview(CASE WHEN p_channel='admin_pos' THEN quoted ELSE p_lines END,p_promotion,p_phone);
 IF(quote->>'merchandiseSubtotalInMinorUnits')::BIGINT IS DISTINCT FROM subtotal THEN RAISE EXCEPTION 'LITE2_INTERNAL_PRICE_MISMATCH';END IF;
 discount:=CASE WHEN p_channel='admin_pos' THEN p_discount ELSE(quote->>'promotionDiscountInMinorUnits')::BIGINT END;
 IF discount>subtotal THEN RAISE EXCEPTION 'PHASE3_POS_DISCOUNT_EXCEEDS_SUBTOTAL';END IF;
 IF p_channel='customer_v2' THEN
  IF p_delivery_zone IS NULL OR p_delivery_zone NOT IN('inside_ramtha','outside_ramtha') THEN RAISE EXCEPTION 'LITE2_DELIVERY_ZONE_INVALID';END IF;
  SELECT * INTO settings FROM public.storefront_settings WHERE id='00000000-0000-0000-0000-000000000001' FOR SHARE;
  IF NOT FOUND OR NOT settings.orders_enabled THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_ORDERS_DISABLED';END IF;
  IF subtotal<settings.minimum_order_in_minor_units THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_MINIMUM_ORDER_NOT_MET';END IF;
  delivery:=CASE p_delivery_zone WHEN 'inside_ramtha' THEN settings.inside_ramtha_delivery_fee_in_minor_units ELSE settings.outside_ramtha_delivery_fee_in_minor_units END;
 ELSIF p_delivery_zone IS NOT NULL THEN RAISE EXCEPTION 'LITE2_POS_DELIVERY_INVALID';END IF;
 SELECT jsonb_agg(jsonb_build_object('key',value->>'line_sequence','weight',(value->>'gross_amount_in_minor_units')::BIGINT) ORDER BY(value->>'line_sequence')::INTEGER) INTO weights FROM jsonb_array_elements(plan_lines);
 FOR line IN SELECT value FROM jsonb_array_elements(plan_lines) ORDER BY(value->>'line_sequence')::INTEGER LOOP
  SELECT allocated_amount INTO allocation FROM public.phase2_allocate_largest_remainder_internal(discount,weights) WHERE allocation_key=line->>'line_sequence';
  instances:='[]';
  IF line->>'commercial_line_kind'='configurable_parcel' THEN
   SELECT jsonb_agg(jsonb_build_object('key',value->>'instance_sequence','weight',(line->>'unit_price_in_minor_units')::BIGINT) ORDER BY(value->>'instance_sequence')::INTEGER) INTO instance_weights FROM jsonb_array_elements(line#>'{line,parcel_instances}');
   FOR instance IN SELECT value FROM jsonb_array_elements(line#>'{line,parcel_instances}') ORDER BY(value->>'instance_sequence')::INTEGER LOOP
    SELECT allocated_amount INTO instance_discount FROM public.phase2_allocate_largest_remainder_internal(allocation,instance_weights) WHERE allocation_key=instance->>'instance_sequence';
    instances:=instances||jsonb_build_array(instance||jsonb_build_object('gross_amount_in_minor_units',(line->>'unit_price_in_minor_units')::BIGINT,'allocated_discount_in_minor_units',instance_discount,'net_refundable_amount_in_minor_units',(line->>'unit_price_in_minor_units')::BIGINT-instance_discount));
   END LOOP;
  END IF;
  result_lines:=result_lines||jsonb_build_array(line||jsonb_build_object('allocated_discount_in_minor_units',allocation,'net_refundable_amount_in_minor_units',(line->>'gross_amount_in_minor_units')::BIGINT-allocation,'parcel_instances',instances));
 END LOOP;
 RETURN jsonb_build_object('subtotalInMinorUnits',subtotal,'discountInMinorUnits',discount,'deliveryFeeInMinorUnits',delivery,'totalInMinorUnits',subtotal-discount+delivery,'lines',result_lines);
END $plan$;
REVOKE ALL ON FUNCTION sales_lite2.plan(JSONB,TEXT,BIGINT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
