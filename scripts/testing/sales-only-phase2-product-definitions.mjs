import assert from 'node:assert/strict';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';

/** Exercise the existing product writers under real lite guards. Transaction
 * rolls back before the opening-epoch fixture;no active migration/new RPC. */
export async function verifyLiteProductDefinitions({sql,id,q,j,executor},report){
 const before=await readApplicationFingerprint(executor);
 await sql(`BEGIN;SELECT set_config('request.jwt.claims',${j({sub:id(1),role:'authenticated',aal:'aal2'})}::text,true);SET LOCAL ROLE authenticated;
 DO $probe$ DECLARE seed public.products;created JSONB;family JSONB;ordinary UUID;master UUID;BEGIN
 SELECT * INTO STRICT seed FROM public.products WHERE id=${q(id(103))};
 created:=public.create_product_with_opening_stock_v5(p_sku:='LITEUI-ORDINARY',p_name_ar:='منتج بلا تكلفة للاختبار',p_category_id:=seed.category_id,p_unit_id:=seed.unit_id,
  p_purchase_unit_id:=seed.purchase_unit_id,p_units_per_purchase_unit:=5,p_default_purchase_price_in_minor_units:=0,
  p_sale_unit_id:=seed.sale_unit_id,p_units_per_sale_unit:=5,p_default_sale_price_in_minor_units:=5000,p_cost_price_in_minor_units:=0,
  p_min_stock_level:=0,p_max_stock_level:=NULL,p_warehouse_id:=${q(id(201))},p_opening_quantity:=0,p_parcel_only:=false);
 ordinary:=(created->>'product_id')::UUID;
 IF ordinary IS NULL OR NOT EXISTS(SELECT 1 FROM public.products WHERE id=ordinary AND cost_price_in_minor_units=0 AND default_purchase_price_in_minor_units=0 AND units_per_sale_unit=5 AND default_sale_price_in_minor_units=5000) THEN RAISE EXCEPTION 'LITE_PRODUCT_EXISTING_CREATE_CONTRACT';END IF;
 family:=public.create_product_family_with_flavors_v2(p_sku:='LITEUI-FAMILY',p_name_ar:='عائلة بلا تكلفة للاختبار',p_category_id:=seed.category_id,p_unit_id:=seed.unit_id,
  p_purchase_unit_id:=seed.purchase_unit_id,p_units_per_purchase_unit:=5,p_default_purchase_price_in_minor_units:=0,
  p_sale_unit_id:=seed.sale_unit_id,p_units_per_sale_unit:=5,p_default_sale_price_in_minor_units:=5000,p_cost_price_in_minor_units:=0,
  p_min_stock_level:=0,p_warehouse_id:=${q(id(201))},p_flavors:='[{"nameAr":"نكهة أولى","openingSalePackages":0},{"nameAr":"نكهة ثانية","openingSalePackages":0}]'::JSONB,p_parcel_only:=false);
 master:=(family->>'productId')::UUID;
 IF master IS NULL OR (SELECT count(*) FROM public.products WHERE flavor_master_product_id=master AND cost_price_in_minor_units=0)<>2 THEN RAISE EXCEPTION 'LITE_PRODUCT_EXISTING_FAMILY_CONTRACT';END IF;
 IF EXISTS(SELECT 1 FROM public.inventory_balances WHERE product_id IN(ordinary,master) OR product_id IN(SELECT id FROM public.products WHERE flavor_master_product_id=master) GROUP BY product_id HAVING sum(on_hand_quantity)<>0 OR sum(reserved_quantity)<>0)
  OR EXISTS(SELECT 1 FROM public.inventory_movements WHERE product_id IN(ordinary,master) OR product_id IN(SELECT id FROM public.products WHERE flavor_master_product_id=master)) THEN RAISE EXCEPTION 'LITE_PRODUCT_UNEXPECTED_STOCK';END IF;
 PERFORM public.update_product_master_v5(seed.id,seed.updated_at,seed.sku,seed.barcode,seed.name_ar||' تعديل نصي',seed.description,seed.category_id,seed.brand_id,seed.unit_id,
  seed.purchase_unit_id,seed.units_per_purchase_unit,seed.default_purchase_price_in_minor_units,seed.sale_unit_id,seed.units_per_sale_unit,seed.default_sale_price_in_minor_units,
  seed.cost_price_in_minor_units,seed.min_stock_level,seed.max_stock_level,seed.is_active,NULL,seed.parcel_only);
 IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=seed.id AND cost_price_in_minor_units IS NOT DISTINCT FROM seed.cost_price_in_minor_units AND wac_cost_in_minor_units_exact IS NOT DISTINCT FROM seed.wac_cost_in_minor_units_exact) THEN RAISE EXCEPTION 'LITE_PRODUCT_HISTORIC_COST_CHANGED';END IF;
 END $probe$;ROLLBACK;`);
 const after=await readApplicationFingerprint(executor);
 assert.deepEqual(after.tables,before.tables,'PRODUCT_PROBE_ROLLBACK_ALL_APPLICATION_ROWS');
 report.cases.push({name:'existing product+family writers accept zero cost/zero stock under lite guards;ordinary+twoflavors;existing product edit preserves historic cost/WAC;all publicrows rolledback',passed:true});
}
