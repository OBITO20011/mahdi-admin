import assert from 'node:assert/strict';
import {tsImport} from 'tsx/esm/api';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';

/** Fresh owned fixture only. Real public writers, then ROLLBACK before assertions. */
export async function verifyLiteParcelCapacityPath({json,id,q,j,executor},report,{full=false}={}){
 const before=await readApplicationFingerprint(executor);
 const proof=await json(`BEGIN;SELECT set_config('request.jwt.claims',${j({sub:id(1),role:'authenticated',aal:'aal2'})}::TEXT,true);SET LOCAL ROLE authenticated;
 DO $proof$
 DECLARE old_unit UUID;packet UUID;master UUID;p public.products;created JSONB;
 BEGIN
  old_unit:=(public.save_product_unit('طرد','TEST-PARCEL-UNIT',1,NULL)->>'unitId')::UUID;
  SELECT id INTO STRICT packet FROM public.units WHERE code='PKT';
  created:=public.create_product_family_with_flavors_v2(p_sku:='TEST-PARCEL-REGRESSION',p_name_ar:='عائلة نكهات وهمية',p_category_id:=${q(id(11))}::UUID,p_unit_id:=old_unit,p_purchase_unit_id:=old_unit,p_units_per_purchase_unit:=1,p_default_purchase_price_in_minor_units:=0,p_sale_unit_id:=old_unit,p_units_per_sale_unit:=1,p_default_sale_price_in_minor_units:=1100,p_cost_price_in_minor_units:=0,p_min_stock_level:=0,p_max_stock_level:=NULL,p_warehouse_id:=${q(id(201))}::UUID,p_flavors:=(SELECT jsonb_agg(jsonb_build_object('nameAr','نكهة وهمية '||n,'openingSalePackages',0)) FROM generate_series(1,12) n),p_parcel_only:=false);
  master:=(created->>'productId')::UUID;SELECT * INTO STRICT p FROM public.products WHERE id=master;
  PERFORM public.update_product_master_v5(p.id,p.updated_at,p.sku,p.barcode,p.name_ar,p.description,p.category_id,p.brand_id,packet,packet,1,p.default_purchase_price_in_minor_units,packet,1,1100,p.cost_price_in_minor_units,p.min_stock_level,p.max_stock_level,p.is_active,NULL,false);
  PERFORM public.set_configurable_parcel_feature_state_v1('ENABLED');
  PERFORM set_config('nawasrah.parcel_unit_fixture_master',master::TEXT,true);
 END $proof$;
 RESET ROLE;SELECT set_config('nawasrah.parcel_unit_fixture_audit',(SELECT count(*)::TEXT FROM public.audit_logs),true);
 SET LOCAL ROLE authenticated;DO $save$
 DECLARE master UUID:=current_setting('nawasrah.parcel_unit_fixture_master')::UUID;allowed UUID[];
 BEGIN
  SELECT array_agg(id ORDER BY id) INTO allowed FROM public.products WHERE flavor_master_product_id=master;
  PERFORM public.save_product_parcel_configuration_v1(master,'configurable_mix',true,7,allowed);
  PERFORM public.save_product_parcel_configuration_v1(master,'configurable_mix',true,7,allowed);
 END $save$;RESET ROLE;
 SELECT jsonb_build_object('rows',(SELECT jsonb_agg(jsonb_build_object('n',r.units_per_sale_unit,'base',u.name_ar,'sale',s.name_ar,'sp',r.sale_price_in_minor_units,'dsp',r.default_sale_price_in_minor_units,'parcelOnly',r.parcel_only)) FROM public.products r JOIN public.units u ON u.id=r.unit_id JOIN public.units s ON s.id=r.sale_unit_id WHERE r.id=current_setting('nawasrah.parcel_unit_fixture_master')::UUID OR r.flavor_master_product_id=current_setting('nawasrah.parcel_unit_fixture_master')::UUID),'configurationAuditRows',(SELECT count(*) FROM public.audit_logs)-current_setting('nawasrah.parcel_unit_fixture_audit')::BIGINT,'clientProduct',jsonb_build_object('id',current_setting('nawasrah.parcel_unit_fixture_master'),'sku','TEST-PARCEL-REGRESSION','nameAr','عائلة نكهات وهمية','unitNameAr','باكيت','saleUnitNameAr','باكيت','unitsPerSalePackage',7,'salePriceInMinorUnits',1100,'salePackagePriceInMinorUnits',1100,'quantityTracked',false,'availableQuantity',NULL,'availableSalePackages',NULL,'isAvailable',true,'parcelOnly',false));ROLLBACK;`);
 assert.deepEqual((await readApplicationFingerprint(executor)).tables,before.tables,'PARCEL_CAPACITY_ROLLBACK');
 assert.equal(proof.rows.length,13);assert.ok(proof.rows.every(r=>r.n===7&&r.base==='باكيت'&&r.sale==='باكيت'&&r.sp===1100&&r.dsp===1100&&r.parcelOnly===false));assert.equal(proof.configurationAuditRows,0);
 report.cases.push({name:full?'full shared209 capacity exposure (unchanged)':'OFF rename→enable→save twice;13rows keep1100;rollback',passed:true,rows:proof.rows.length,configurationAuditRows:proof.configurationAuditRows,rolledBack:true});
 const cart=await tsImport('../../customer-web/src/utils/cart.ts',import.meta.url);
 if(full){assert.doesNotThrow(()=>cart.createCartItem({...proof.clientProduct,quantityTracked:undefined,availableQuantity:100,availableSalePackages:10}));return;}
 assert.throws(()=>cart.createCartItem(proof.clientProduct),/سعر.*الطرد/,'LITE_PARCEL_CAPACITY_GUARD_MISSING');
 assert.doesNotThrow(()=>cart.createCartItem({...proof.clientProduct,saleUnitNameAr:'صندوق',salePackagePriceInMinorUnits:7700}));
 report.cases.push({name:'actual OFF client rejects unsafe new parcel line;valid7700 package accepted',passed:true});

 if(!full){
  const transition=await json(`BEGIN;SELECT set_config('request.jwt.claims',${j({sub:id(1),role:'authenticated',aal:'aal2'})}::TEXT,true);SET LOCAL ROLE authenticated;
  DO $transition$
  DECLARE packet UUID;box UUID;master UUID;p public.products;selected UUID[];created JSONB;
  BEGIN
   SELECT id INTO STRICT packet FROM public.units WHERE code='PKT';
   box:=(public.save_product_unit('صندوق اختبار الطرد','TEST-PARCEL-BOX',1,NULL)->>'unitId')::UUID;
   created:=public.create_product_family_with_flavors_v2(p_sku:='TEST-PARCEL-CONVERSION',p_name_ar:='عائلة طرد وهمية',p_category_id:=${q(id(11))}::UUID,p_unit_id:=packet,p_purchase_unit_id:=packet,p_units_per_purchase_unit:=1,p_default_purchase_price_in_minor_units:=0,p_sale_unit_id:=packet,p_units_per_sale_unit:=1,p_default_sale_price_in_minor_units:=1100,p_cost_price_in_minor_units:=0,p_min_stock_level:=0,p_max_stock_level:=NULL,p_warehouse_id:=${q(id(201))}::UUID,p_flavors:='[{"nameAr":"نكهة اختبار","openingSalePackages":0}]'::JSONB,p_parcel_only:=false);
   master:=(created->>'productId')::UUID;SELECT * INTO STRICT p FROM public.products WHERE id=master;
   PERFORM public.update_product_master_v5(p.id,p.updated_at,p.sku,p.barcode,p.name_ar,p.description,p.category_id,p.brand_id,packet,packet,1,p.default_purchase_price_in_minor_units,box,7,7700,p.cost_price_in_minor_units,p.min_stock_level,p.max_stock_level,p.is_active,NULL,false);
   SELECT array_agg(id) INTO selected FROM public.products WHERE flavor_master_product_id=master;
   PERFORM public.save_product_parcel_configuration_v1(master,'configurable_mix',true,7,selected);
   PERFORM set_config('nawasrah.parcel_unit_fixture_master',master::TEXT,true);
  END $transition$;RESET ROLE;
  SELECT jsonb_agg(jsonb_build_object('n',p.units_per_sale_unit,'base',u.code,'outer',s.code,'basePrice',p.sale_price_in_minor_units,'parcelPrice',p.default_sale_price_in_minor_units,'only',p.parcel_only))
  FROM public.products p JOIN public.units u ON u.id=p.unit_id JOIN public.units s ON s.id=p.sale_unit_id
  WHERE p.id=current_setting('nawasrah.parcel_unit_fixture_master')::UUID OR p.flavor_master_product_id=current_setting('nawasrah.parcel_unit_fixture_master')::UUID;ROLLBACK;`);
  assert.deepEqual(transition,Array.from({length:2},()=>({n:7,base:'PKT',outer:'TEST-PARCEL-BOX',basePrice:1100,parcelPrice:7700,only:false})));
  assert.deepEqual((await readApplicationFingerprint(executor)).tables,before.tables,'PARCEL_CONVERSION_ROLLBACK');
  report.cases.push({name:'existing product writer defines a distinct 7.700 parcel, retains 1.100 per unit, propagates to flavor and rolls back',passed:true});
 }

}
