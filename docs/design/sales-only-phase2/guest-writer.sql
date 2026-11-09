-- QUARANTINED phase2: same gateway envelope and ledger;no full writer replaced.
CREATE FUNCTION sales_lite2.guest(p_request JSONB,p_key TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $guest$
<<guest_context>>
DECLARE
 replay JSONB;plan JSONB;materialized JSONB;result JSONB;recipient JSONB;
 phone TEXT;name TEXT;method TEXT;zone TEXT;promotion TEXT;field TEXT;limit_length INTEGER;
 customer public.customers;cid UUID;bid UUID;wid UUID;oid UUID:=gen_random_uuid();op UUID:=gen_random_uuid();address_id UUID:=gen_random_uuid();tracking UUID:=gen_random_uuid();
 ids UUID[];pid UUID;promo_id UUID;reused BOOLEAN:=false;maps TEXT;lat DOUBLE PRECISION;lon DOUBLE PRECISION;recent INTEGER;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'PHASE3_ACTOR_NOT_AUTHORIZED';END IF;
 IF jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR octet_length(p_request::TEXT)>65536
 OR(p_request-ARRAY['phoneHash','sessionHash','recipient','lines','promotionCode','paymentMethod','deliveryZone','expectedQuote'])<>'{}'::JSONB
 OR p_key IS NULL OR p_key!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 OR COALESCE(p_request->>'phoneHash','')!~'^[0-9a-f]{64}$' OR COALESCE(p_request->>'sessionHash','')!~'^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'PHASE3_IDEMPOTENCY_INPUT_INVALID';END IF;
 recipient:=p_request->'recipient';
 IF jsonb_typeof(recipient) IS DISTINCT FROM 'object' OR(recipient-ARRAY['fullName','phone','governorate','city','area','street','building','addressNotes','googleMapsUrl','latitude','longitude','customerNotes'])<>'{}'::JSONB THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_INPUT_INVALID';END IF;
 name:=btrim(recipient->>'fullName');phone:=public.normalize_customer_phone(recipient->>'phone');
 IF name IS NULL OR length(name) NOT BETWEEN 2 AND 120 OR phone IS NULL OR phone!~'^07[789][0-9]{7}$' THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_INPUT_INVALID';END IF;
 FOREACH field IN ARRAY ARRAY['governorate','city','area','street','building','addressNotes','customerNotes'] LOOP
  limit_length:=CASE field WHEN 'governorate' THEN 80 WHEN 'city' THEN 80 WHEN 'area' THEN 120 WHEN 'street' THEN 300 WHEN 'building' THEN 120 WHEN 'addressNotes' THEN 500 ELSE 1000 END;
  IF(field IN('governorate','city','area','street') AND NULLIF(btrim(recipient->>field),'') IS NULL)
  OR length(COALESCE(btrim(recipient->>field),''))>limit_length THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_INPUT_INVALID';END IF;
 END LOOP;
 lat:=(recipient->>'latitude')::DOUBLE PRECISION;lon:=(recipient->>'longitude')::DOUBLE PRECISION;
 IF(lat IS NULL)<>(lon IS NULL) OR(lat IS NOT NULL AND(lat NOT BETWEEN -90 AND 90 OR lon NOT BETWEEN -180 AND 180)) THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_INPUT_INVALID';END IF;
 maps:=COALESCE(NULLIF(btrim(recipient->>'googleMapsUrl'),''),CASE WHEN lat IS NOT NULL THEN 'https://www.google.com/maps?q='||lat::TEXT||','||lon::TEXT END);
 IF maps IS NOT NULL AND(length(maps)>1000 OR maps!~*'^https://') THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_INPUT_INVALID';END IF;
 method:=lower(btrim(p_request->>'paymentMethod'));zone:=lower(btrim(p_request->>'deliveryZone'));promotion:=upper(NULLIF(btrim(p_request->>'promotionCode'),''));
 IF method IS NULL OR method NOT IN('cash_on_delivery','cliq') OR zone IS NULL OR zone NOT IN('inside_ramtha','outside_ramtha') THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_QUOTE_INVALID';END IF;
 IF zone='inside_ramtha' AND concat_ws(' ',recipient->>'governorate',recipient->>'city',recipient->>'area') NOT ILIKE '%الرمثا%' THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_DELIVERY_ZONE_MISMATCH';END IF;
 PERFORM pg_advisory_xact_lock(hashtext(p_key));
 replay:=sales_lite1.lock_request(p_key,'guest2',p_request);IF replay IS NOT NULL THEN RETURN replay;END IF;
 SELECT warehouse.branch_id,warehouse.id INTO bid,wid FROM public.warehouses warehouse JOIN public.branches branch ON branch.id=warehouse.branch_id
 WHERE warehouse.is_active AND branch.is_active ORDER BY warehouse.created_at,warehouse.id LIMIT 1;
 IF wid IS NULL THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_LOCATION_UNAVAILABLE';END IF;
 PERFORM pg_advisory_xact_lock(hashtext(phone)::BIGINT);
 SELECT * INTO customer FROM public.customers c WHERE public.normalize_customer_phone(c.phone)=guest_context.phone AND NOT is_deleted ORDER BY id LIMIT 1 FOR UPDATE;
 IF FOUND THEN
  IF NOT customer.is_active OR customer.is_blocked THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_UNAVAILABLE';END IF;
  cid:=customer.id;reused:=true;
 END IF;
 -- Same promotion row lock as full checkout: preview alone does not reserve
 -- quota. Lock before the final plan and insert redemption in this transaction.
 IF promotion IS NOT NULL THEN SELECT id INTO promo_id FROM public.promotion_codes WHERE code=promotion FOR UPDATE;END IF;
 plan:=sales_lite2.plan(p_request->'lines','customer_v2',0,promotion,phone,zone);
 SELECT array_agg(DISTINCT id ORDER BY id) INTO ids FROM(
  SELECT(value->>'product_id')::UUID id FROM jsonb_array_elements(plan->'lines')
  UNION SELECT(c->>'product_id')::UUID FROM jsonb_array_elements(plan->'lines') l CROSS JOIN LATERAL jsonb_array_elements(l->'parcel_instances') i CROSS JOIN LATERAL jsonb_array_elements(i->'components') c
 ) x;
 PERFORM 1 FROM public.products WHERE id=ANY(ids) OR id IN(SELECT flavor_master_product_id FROM public.products WHERE id=ANY(ids)) ORDER BY id FOR UPDATE;
 plan:=sales_lite2.plan(p_request->'lines','customer_v2',0,promotion,phone,zone);
 FOREACH pid IN ARRAY ids LOOP IF NOT sales_lite1.available(pid) THEN RAISE EXCEPTION 'LITE1_UNAVAILABLE_CONFIRM_REQUIRED';END IF;END LOOP;
 IF jsonb_typeof(p_request->'expectedQuote') IS DISTINCT FROM 'object'
 OR(p_request->'expectedQuote') IS DISTINCT FROM(plan-ARRAY['lines']) THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_QUOTE_STALE';END IF;
 SELECT count(*) INTO recent FROM public.orders o JOIN public.customers c ON c.id=o.customer_id WHERE o.source='website' AND public.normalize_customer_phone(c.phone)=guest_context.phone AND o.created_at>=now()-interval '10 minutes';
 IF recent>=3 THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_RATE_LIMITED';END IF;
 IF cid IS NULL THEN INSERT INTO public.customers(full_name,phone,governorate,customer_type,is_active,is_blocked,is_deleted)
 VALUES(name,phone,btrim(recipient->>'governorate'),'wholesale',true,false,false) RETURNING id INTO cid;END IF;
 -- H1: never overwrite an existing card or clear/replace its default address.
 -- This row is an order delivery snapshot, always non-default. The private
 -- recipient evidence retains the submitted name for manual owner comparison.
 INSERT INTO public.customer_addresses(id,customer_id,governorate,city,area,street,building,notes,latitude,longitude,formatted_address,google_maps_url,location_source,location_confirmed,is_default)
 VALUES(address_id,cid,btrim(recipient->>'governorate'),btrim(recipient->>'city'),btrim(recipient->>'area'),btrim(recipient->>'street'),NULLIF(btrim(recipient->>'building'),''),NULLIF(btrim(recipient->>'addressNotes'),''),lat,lon,
  concat_ws(' - ',btrim(recipient->>'governorate'),btrim(recipient->>'city'),btrim(recipient->>'area'),btrim(recipient->>'street'),NULLIF(btrim(recipient->>'building'),'')),maps,
  CASE WHEN lat IS NOT NULL THEN 'gps' WHEN maps IS NOT NULL THEN 'map_pin' ELSE 'manual' END,lat IS NOT NULL,false);
 result:=jsonb_build_object('success',true,'idempotent_replay',false,'contract_version','lite2-guest-v1','operation_id',op,'order_id',oid,'order_number','L2-'||oid::TEXT,
  'customer_id',cid,'customer_address_id',address_id,'customer_reused',reused,'status','new','subtotal',(plan->>'subtotalInMinorUnits')::BIGINT,'discount',(plan->>'discountInMinorUnits')::BIGINT,
  'delivery_fee',(plan->>'deliveryFeeInMinorUnits')::BIGINT,'total',(plan->>'totalInMinorUnits')::BIGINT,'promotion_code',promotion,'payment_method',method,'payment_status','unpaid',
  'tracking_token',tracking,'tracking_path','/#track='||tracking::TEXT,'accountingTracked',false);
 INSERT INTO public.business_operations(id,operation_type,idempotency_key,request_fingerprint,result_snapshot,completed_at)
 VALUES(op,'lite1_guest',p_key,(SELECT fingerprint FROM sales_lite1.requests WHERE key=p_key),result,now());
 INSERT INTO sales_lite1.orders VALUES(oid,op,recipient,'{}');
 INSERT INTO public.orders(id,order_number,customer_id,customer_address_id,customer_name_snapshot,branch_id,warehouse_id,status,payment_method,payment_status,
  subtotal_in_minor_units,delivery_fee_in_minor_units,discount_in_minor_units,total_in_minor_units,amount_paid_in_minor_units,source,idempotency_key,operation_id,
  delivery_zone,promotion_code_id,promotion_code_snapshot,tracking_token,customer_notes)
 VALUES(oid,'L2-'||oid::TEXT,cid,address_id,name,bid,wid,'new',method,'unpaid',(plan->>'subtotalInMinorUnits')::BIGINT,(plan->>'deliveryFeeInMinorUnits')::BIGINT,
  (plan->>'discountInMinorUnits')::BIGINT,(plan->>'totalInMinorUnits')::BIGINT,0,'website',p_key,op,zone,promo_id,promotion,tracking,NULLIF(btrim(recipient->>'customerNotes'),''));
 materialized:=sales_lite2.materialize(oid,op,plan,'customer_v2',phone,promotion);
 INSERT INTO sales_lite2.sales(order_id,request_key,plan) VALUES(oid,p_key,plan||jsonb_build_object('lines',materialized->'lines'));
 IF promo_id IS NOT NULL THEN INSERT INTO public.promotion_redemptions(promotion_code_id,order_id,customer_id,customer_phone,code_snapshot,discount_in_minor_units)
 VALUES(promo_id,oid,cid,phone,promotion,(plan->>'discountInMinorUnits')::BIGINT);END IF;
 INSERT INTO public.order_status_history(order_id,old_status,new_status,changed_by,notes) VALUES(oid,NULL,'new',NULL,'طلب دون تتبع مخزون');
 INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details) VALUES(NULL,'LITE2_GUEST','orders',oid,jsonb_build_object('operationId',op,'recipientChangeProposed',reused));
 RETURN sales_lite1.finish(p_key,result||jsonb_build_object('items',materialized->'items'));
END $guest$;
REVOKE ALL ON FUNCTION sales_lite2.guest(JSONB,TEXT) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.lite1_guest2(p_request JSONB,p_key TEXT) RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT sales_lite2.guest(p_request,p_key) $$;
REVOKE ALL ON FUNCTION public.lite1_guest2(JSONB,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_guest2(JSONB,TEXT) TO service_role;
