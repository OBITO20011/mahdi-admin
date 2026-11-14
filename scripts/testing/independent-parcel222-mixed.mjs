import assert from 'node:assert/strict';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';

/** Stored discounted family parcel, real POS and real service-role guest order. */
export async function verifyIndependentParcel222Mixed({json,id,q,j,executor},report){
 const before=await readApplicationFingerprint(executor);
 const result=await json(`BEGIN;
 SELECT set_config('request.jwt.claims',${j({sub:id(1),role:'authenticated',aal:'aal2'})}::TEXT,true);
 SET LOCAL ROLE authenticated;
 DO $family$
 DECLARE made JSONB;master UUID;a UUID;b UUID;packet UUID;outer_unit UUID;configuration JSONB;lines JSONB;sale JSONB;
 BEGIN
  SELECT id INTO STRICT packet FROM public.units WHERE code='PKT';
  SELECT id INTO STRICT outer_unit FROM public.units WHERE code='CTN';
  made:=public.create_product_family_with_flavors_v3(p_sku:='PRICE222-MIX',p_name_ar:='عائلة طرد مخفض',p_category_id:=${q(id(11))},
   p_unit_id:=packet,p_purchase_unit_id:=packet,p_units_per_purchase_unit:=1,p_sale_unit_id:=outer_unit,p_units_per_sale_unit:=20,
   p_default_sale_price_in_minor_units:=17000,p_sale_price_in_minor_units:=900,p_warehouse_id:=${q(id(201))},
   p_flavors:='[{"nameAr":"أ","openingSalePackages":0},{"nameAr":"ب","openingSalePackages":0}]'::JSONB);
  master:=(made->>'productId')::UUID;
  SELECT id INTO STRICT a FROM public.products WHERE flavor_master_product_id=master AND flavor_name_ar='أ';
  SELECT id INTO STRICT b FROM public.products WHERE flavor_master_product_id=master AND flavor_name_ar='ب';
  configuration:=(public.save_product_parcel_configuration_v1(master,'configurable_mix',true,20,ARRAY[a,b]))->'configuration';
  PERFORM public.set_configurable_parcel_feature_state_v1('ENABLED');
  PERFORM public.finish_go_live_setup_v1('إنهاء بداية التشغيل');
  PERFORM public.open_cash_shift(${q(id(200))},0);
  lines:=jsonb_build_array(jsonb_build_object('commercial_line_kind','base_unit','product_id',a,'base_quantity',1,'expected_unit_price_in_minor_units',900),
   jsonb_build_object('commercial_line_kind','configurable_parcel','family_product_id',master,'parcel_configuration_id',configuration->>'id',
    'configuration_revision',configuration->'configuration_revision','expected_unit_price_in_minor_units',17000,
    'parcel_instances',jsonb_build_array(jsonb_build_object('components',jsonb_build_array(jsonb_build_object('product_id',a,'base_quantity',10),jsonb_build_object('product_id',b,'base_quantity',10))))));
  sale:=public.lite1_pos2(jsonb_build_object('branchId',${q(id(200))},'warehouseId',${q(id(201))},'customerId',${q(id(401))},'paymentMethod','cash','lines',lines,'discountInMinorUnits',0,'amountReceivedInMinorUnits',17900),gen_random_uuid()::TEXT);
  IF (sale->>'totalInMinorUnits')::BIGINT<>17900 THEN RAISE EXCEPTION 'PRICES222_MIX_POS_PRICE';END IF;
  PERFORM set_config('nawasrah.price222_lines',lines::TEXT,true);
  PERFORM set_config('nawasrah.price222_pos',(sale->>'orderId'),true);
  PERFORM set_config('nawasrah.price222_master',master::TEXT,true);
 END $family$;
 RESET ROLE;
 SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
 -- Read-only quote oracle; the public guest writer below still runs as service_role.
 SELECT set_config('nawasrah.price222_quote',sales_lite2.plan(current_setting('nawasrah.price222_lines')::JSONB,'customer_v2',0,NULL,'0796622200','inside_ramtha')::TEXT,true);
 SET LOCAL ROLE service_role;
 DO $guest$
 DECLARE request JSONB;quote JSONB:=current_setting('nawasrah.price222_quote')::JSONB;saved JSONB;
 BEGIN
  request:=jsonb_build_object('phoneHash',repeat('c',64),'sessionHash',repeat('d',64),
   'recipient',jsonb_build_object('fullName','مستلم اختبار الخصم','phone','0796622200','governorate','إربد','city','الرمثا','area','حي الاختبار','street','شارع الاختبار'),
   'lines',current_setting('nawasrah.price222_lines')::JSONB,'promotionCode',NULL,'paymentMethod','cash_on_delivery','deliveryZone','inside_ramtha','expectedQuote',quote-'lines');
  saved:=public.lite1_guest2(request,gen_random_uuid()::TEXT);
  IF (saved->>'total')::BIGINT<>18900 OR (saved->>'delivery_fee')::BIGINT<>1000 THEN RAISE EXCEPTION 'PRICES222_MIX_GUEST_PRICE:%',saved;END IF;
  PERFORM set_config('nawasrah.price222_guest',saved->>'order_id',true);
 END $guest$;
 RESET ROLE;
 DO $proof$
 DECLARE oid UUID;prices BIGINT[];master UUID:=current_setting('nawasrah.price222_master')::UUID;
 BEGIN
  FOREACH oid IN ARRAY ARRAY[current_setting('nawasrah.price222_pos')::UUID,current_setting('nawasrah.price222_guest')::UUID] LOOP
   SELECT array_agg(unit_price_in_minor_units ORDER BY unit_price_in_minor_units) INTO prices FROM public.order_items WHERE order_id=oid;
   IF prices IS DISTINCT FROM ARRAY[900,17000]::BIGINT[] THEN RAISE EXCEPTION 'PRICES222_MIX_SAVED_PRICES:%',prices;END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.inventory_movements WHERE product_id IN(SELECT id FROM public.products WHERE id=master OR flavor_master_product_id=master))
   OR EXISTS(SELECT 1 FROM public.order_inventory_reservations WHERE order_id IN(current_setting('nawasrah.price222_pos')::UUID,current_setting('nawasrah.price222_guest')::UUID)) THEN RAISE EXCEPTION 'PRICES222_MIX_STOCK_EFFECT';END IF;
 END $proof$;
 SELECT jsonb_build_object('single',900,'mixedParcel',17000,'posTotal',17900,'guestTotal',18900,'deliveryFee',1000,'storedLinePrices',jsonb_build_array(900,17000));
 ROLLBACK;`);
 assert.deepEqual(result,{single:900,mixedParcel:17000,posTotal:17900,guestTotal:18900,deliveryFee:1000,storedLinePrices:[900,17000]});
 assert.deepEqual((await readApplicationFingerprint(executor)).tables,before.tables,'PRICES222_MIX_ROLLBACK');
 report.cases.push({name:'discounted mixed-flavor parcel and single:actual POS+guest with delivery+saved prices/no stock;rollback',passed:true,result});
}
