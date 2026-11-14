import assert from 'node:assert/strict';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';

/** Actual PostgreSQL, including subtransaction rollback on every refusal. */
export async function verifyIndependentParcel222Writers({json,sql,id,q,j,executor},report){
 const before=await readApplicationFingerprint(executor);
 const proof=await json(`BEGIN;
 SELECT set_config('request.jwt.claims',${j({sub:id(1),role:'authenticated',aal:'aal2'})}::TEXT,true);
 CREATE FUNCTION pg_temp.price222_audit_count() RETURNS BIGINT LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS 'SELECT count(*) FROM public.audit_logs';
 CREATE FUNCTION pg_temp.price222_audit_matches(p_id UUID) RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT EXISTS(SELECT 1 FROM public.audit_logs WHERE entity_id=p_id AND action='SET_PRODUCT_INDEPENDENT_PRICES' AND details->>'singlePrice'='900' AND details->>'parcelPrice'='17000') $$;
 SET LOCAL ROLE authenticated;
 CREATE TEMP TABLE price222_proof(result JSONB);
 DO $proof$
 DECLARE packet UUID;outer_unit UUID;p public.products;made JSONB;pid UUID;family UUID;
  old_version TIMESTAMPTZ;old_row JSONB;old_audits BIGINT;refused INTEGER:=0;n INTEGER;
  candidate BIGINT;single_price BIGINT;expected TEXT;actual TEXT;actual_detail TEXT;
 BEGIN
  SELECT id INTO STRICT packet FROM public.units WHERE code='PKT';
  outer_unit:=(public.save_product_unit('صندوق اختبار الخصم','PRICE222-BOX',1,NULL)->>'unitId')::UUID;
  made:=public.create_product_with_opening_stock_v6(p_sku:='PRICE222-NEW',p_name_ar:='باكيت اختبار السعر',p_category_id:=${q(id(11))}::UUID,
   p_unit_id:=packet,p_purchase_unit_id:=packet,p_units_per_purchase_unit:=1,p_sale_unit_id:=outer_unit,p_units_per_sale_unit:=20,
   p_default_sale_price_in_minor_units:=17000,p_sale_price_in_minor_units:=900,p_cost_price_in_minor_units:=0,p_warehouse_id:=${q(id(201))}::UUID);
  pid:=(made->>'product_id')::UUID;SELECT * INTO STRICT p FROM public.products WHERE id=pid;
  IF p.sale_price_in_minor_units<>900 OR p.default_sale_price_in_minor_units<>17000 THEN RAISE EXCEPTION 'PRICES222_CREATE_DISCOUNT';END IF;
  old_version:=p.updated_at-INTERVAL '1 second';
  -- Changing only the explicit single price must not recalculate the parcel.
  PERFORM public.update_product_master_v6(p.id,p.updated_at,p.sku,p.barcode,p.name_ar,p.description,p.category_id,p.brand_id,p.unit_id,p.purchase_unit_id,p.units_per_purchase_unit,p.default_purchase_price_in_minor_units,p.sale_unit_id,20,17000,p.cost_price_in_minor_units,p.min_stock_level,p.max_stock_level,p.is_active,NULL,950,false);
  SELECT * INTO STRICT p FROM public.products WHERE id=pid;
  IF p.sale_price_in_minor_units<>950 OR p.default_sale_price_in_minor_units<>17000 THEN RAISE EXCEPTION 'PRICES222_INDEPENDENCE_OR_VERSION';END IF;
  -- A stale CAS cannot consume an edit or add audit rows.
  BEGIN
   PERFORM public.update_product_master_v6(p.id,old_version,p.sku,p.barcode,p.name_ar,p.description,p.category_id,p.brand_id,p.unit_id,p.purchase_unit_id,p.units_per_purchase_unit,p.default_purchase_price_in_minor_units,p.sale_unit_id,20,17000,p.cost_price_in_minor_units,p.min_stock_level,p.max_stock_level,p.is_active,NULL,900,false);
   RAISE EXCEPTION 'PRICES222_STALE_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
   IF SQLERRM NOT LIKE 'PRODUCT_EDIT_CONFLICT:%' THEN RAISE;END IF;
   GET STACKED DIAGNOSTICS actual_detail=PG_EXCEPTION_DETAIL;
   IF actual_detail::JSONB->>'salePriceInMinorUnits' IS DISTINCT FROM '950' THEN RAISE EXCEPTION 'PRICES222_CONFLICT_MISSING_SINGLE_PRICE';END IF;
  END;
  old_audits:=pg_temp.price222_audit_count();old_row:=to_jsonb(p);
  FOR n IN 1..5 LOOP
   candidate:=CASE n WHEN 1 THEN 950 WHEN 2 THEN 19001 WHEN 3 THEN 0 WHEN 4 THEN -1 ELSE 17000 END;
   single_price:=CASE WHEN n=5 THEN 0 ELSE 950 END;
   expected:=CASE n WHEN 1 THEN 'PRICES222_UNSAFE_PARCEL_PRICE' WHEN 2 THEN 'PRICES222_PARCEL_PRICE_TOO_HIGH' ELSE 'PRICES222_POSITIVE_PRICE_REQUIRED' END;
   BEGIN
    PERFORM public.update_product_master_v6(p.id,p.updated_at,p.sku,p.barcode,p.name_ar,p.description,p.category_id,p.brand_id,p.unit_id,p.purchase_unit_id,p.units_per_purchase_unit,p.default_purchase_price_in_minor_units,p.sale_unit_id,20,candidate,p.cost_price_in_minor_units,p.min_stock_level,p.max_stock_level,p.is_active,NULL,single_price,false);
    RAISE EXCEPTION 'PRICES222_INVALID_ACCEPTED';
   EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual=MESSAGE_TEXT;
    IF actual NOT LIKE expected||':%' THEN RAISE;END IF;
    refused:=refused+1;
   END;
   IF (SELECT to_jsonb(r) FROM public.products r WHERE id=pid) IS DISTINCT FROM old_row
    OR pg_temp.price222_audit_count()<>old_audits THEN RAISE EXCEPTION 'PRICES222_REFUSAL_WROTE';END IF;
  END LOOP;
  made:=public.create_product_family_with_flavors_v3(p_sku:='PRICE222-FAMILY',p_name_ar:='عائلة اختبار الخصم',p_category_id:=${q(id(11))}::UUID,
   p_unit_id:=packet,p_purchase_unit_id:=packet,p_units_per_purchase_unit:=1,p_sale_unit_id:=outer_unit,p_units_per_sale_unit:=20,
   p_default_sale_price_in_minor_units:=17000,p_sale_price_in_minor_units:=900,p_cost_price_in_minor_units:=0,p_warehouse_id:=${q(id(201))}::UUID,
   p_flavors:='[{"nameAr":"أ","openingSalePackages":0},{"nameAr":"ب","openingSalePackages":0}]'::JSONB);
  family:=(made->>'productId')::UUID;
  IF (SELECT count(*) FROM public.products WHERE (id=family OR flavor_master_product_id=family) AND sale_price_in_minor_units=900 AND wholesale_price_in_minor_units=900 AND default_sale_price_in_minor_units=17000)<>3 THEN RAISE EXCEPTION 'PRICES222_FAMILY_INHERITANCE';END IF;
  IF NOT pg_temp.price222_audit_matches(family) THEN RAISE EXCEPTION 'PRICES222_FINAL_AUDIT_MISSING';END IF;
  SELECT * INTO STRICT p FROM public.products WHERE id=family;
  PERFORM public.update_product_master_v6(p.id,p.updated_at,p.sku,p.barcode,p.name_ar,p.description,p.category_id,p.brand_id,p.unit_id,p.purchase_unit_id,p.units_per_purchase_unit,p.default_purchase_price_in_minor_units,p.sale_unit_id,20,16000,p.cost_price_in_minor_units,p.min_stock_level,p.max_stock_level,p.is_active,NULL,950,false);
  IF (SELECT count(*) FROM public.products WHERE (id=family OR flavor_master_product_id=family) AND sale_price_in_minor_units=950 AND wholesale_price_in_minor_units=950 AND default_sale_price_in_minor_units=16000)<>3 THEN RAISE EXCEPTION 'PRICES222_FAMILY_EDIT_INHERITANCE';END IF;
  INSERT INTO price222_proof VALUES(jsonb_build_object('createdSingle',900,'createdParcel',17000,'changedSingle',950,'unchangedParcel',17000,'refusedWithoutWrites',refused,'staleRefused',true,'familyRows',3,'audit',true));
 END $proof$;
 SELECT jsonb_agg(result) FROM price222_proof;ROLLBACK;`);
 assert.equal(proof.length,1);assert.equal(proof[0].refusedWithoutWrites,5);
 assert.deepEqual((await readApplicationFingerprint(executor)).tables,before.tables,'PRICES222_WRITERS_ROLLBACK');
 report.cases.push({name:'explicit prices/create+family+audit+CAS/five invalid edits atomic;rollback',passed:true,proof});
 const grants=await json(`SELECT jsonb_build_object('publicWriters',(SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('update_product_master_v6','create_product_with_opening_stock_v6','create_product_family_with_flavors_v3')),'anon',(SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('update_product_master_v6','create_product_with_opening_stock_v6','create_product_family_with_flavors_v3') AND has_function_privilege('anon',oid,'execute')),'service',(SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('update_product_master_v6','create_product_with_opening_stock_v6','create_product_family_with_flavors_v3') AND has_function_privilege('service_role',oid,'execute')),'helper',has_function_privilege('authenticated','sales_lite1.assert_prices222(uuid,uuid,integer,bigint,bigint,boolean)','execute'));`);
 assert.deepEqual(grants,{publicWriters:3,anon:0,service:0,helper:false});
 // A role with a valid JWT but no ERP authorization cannot use the new writer.
 await assert.rejects(sql(`BEGIN;SELECT set_config('request.jwt.claims',${j({sub:id(9999),role:'authenticated',aal:'aal2'})}::TEXT,true);SET LOCAL ROLE authenticated;SELECT public.create_product_with_opening_stock_v6('PRICE222-DENIED',p_sale_price_in_minor_units:=900);ROLLBACK;`),/ليس لديك صلاحية/);
 report.cases.push({name:'new writer ACLs/private helper and unauthorized authenticated rejection',passed:true,grants});
}
