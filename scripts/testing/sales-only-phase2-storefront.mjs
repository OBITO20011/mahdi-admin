import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sha256} from './sales-only-phase1-bridges.mjs';
const pins=JSON.parse(readFileSync(new URL('../../docs/design/sales-only-phase1/frozen-functions.json',import.meta.url),'utf8'));
export const catalogSignature='get_public_storefront_catalog_page(integer,integer,uuid,text,text,text,uuid,uuid,uuid[])';
export const parcelSignature='package_d_public_parcel_options_before_policy_internal(uuid[])';
export function storefrontSource(row,kind){
 const signature=kind==='catalog'?catalogSignature:parcelSignature;
 assert.equal(row.signature,signature);assert.equal(sha256(row.source),pins.functions[signature].sourceSha256,'STOREFRONT_FROZEN_SOURCE_DRIFT');
 let body=row.source;const hunks=[];
 const once=(from,to)=>{assert.equal(body.split(from).length,2,'STOREFRONT_EXACT_HUNK:'+from.slice(0,70));body=body.split(from).join(to);hunks.push({from,to});};
 const section=(start,end,replacement)=>{const a=body.indexOf(start),b=body.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);once(body.slice(a,b),replacement);};
 if(kind==='catalog'){
  section('  WITH stock_by_product AS (','  sales_by_product AS (','  WITH');
  once('      COALESCE(stock.available_quantity, 0)::INTEGER AS available_quantity,','      sales_lite1.available(p.id) AS manual_available,');
  once('    LEFT JOIN stock_by_product stock ON stock.product_id = p.id\n','');
  section('      COALESCE(SUM(\n        FLOOR(available_quantity::NUMERIC / units_per_sale_unit)','      MAX(created_at) AS created_at,',
   '      NULL::INTEGER AS available_sale_packages,\n      BOOL_OR(NOT is_flavor_master AND manual_available) AS is_available,\n      false AS is_low_stock,\n');
  once("          'availableQuantity', available_quantity,\n          'availableSalePackages', FLOOR(available_quantity::NUMERIC / units_per_sale_unit),",
   "          'quantityTracked',false,\n          'manualAvailable',manual_available,\n          'availableQuantity',NULL,\n          'availableSalePackages',NULL,");
  once("          'isAvailable', available_quantity >= units_per_sale_unit AND NOT is_flavor_master,","          'isAvailable', manual_available AND NOT is_flavor_master,");
  once("      'availableSalePackages', (SELECT COALESCE(SUM(available_sale_packages), 0) FROM matching_families),","      'quantityTracked',false,\n      'availableSalePackages',NULL,");
 }else{
  once('      AND component.wac_cost_in_minor_units_exact IS NOT NULL\n','');
  once('      COALESCE(balance.available_quantity, 0)::INTEGER AS available_quantity','      sales_lite1.available(component.id) AS manual_available');
  once('    LEFT JOIN public.inventory_balances balance\n      ON balance.warehouse_id = warehouse.id\n      AND balance.product_id = component.id\n','');
  once('      AND family.is_active\n','      AND family.is_active\n      AND sales_lite1.available(family.id)\n');
  once('    WHERE component.units_per_sale_unit > 0','    WHERE sales_lite1.available(component.id)\n      AND EXISTS(SELECT 1 FROM public.product_parcel_allowed_components allowed WHERE allowed.configuration_id=configuration.parcel_configuration_id AND allowed.product_id=component.id)\n      AND component.units_per_sale_unit > 0');
  once('      SUM(component.available_quantity)::BIGINT AS total_available_quantity,\n','');
  once("          'availableQuantity', component.available_quantity","          'quantityTracked',false,\n          'manualAvailable',component.manual_available,\n          'availableQuantity',NULL");
  once('    HAVING SUM(component.available_quantity) >= component.units_per_parcel\n','');
  once("        'components', option_group.components","        'quantityTracked',false,\n        'components', option_group.components");
 }
 assert.doesNotMatch(body,/inventory_balances|stock_by_product|wac_cost|COALESCE\(stock\./u);
 return {body,hunks};
}
export function storefrontSql(rows){
 const catalog=rows.find(r=>r.signature===catalogSignature),parcel=rows.find(r=>r.signature===parcelSignature);assert.ok(catalog&&parcel);
 return `CREATE FUNCTION sales_lite2.catalog_page(p_limit integer,p_offset integer,p_category_id uuid,p_search text,p_availability text,p_sort text,p_brand_id uuid,p_sale_unit_id uuid,p_product_ids uuid[])
 RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $catalog$${storefrontSource(catalog,'catalog').body}$catalog$;
 REVOKE ALL ON FUNCTION sales_lite2.catalog_page(integer,integer,uuid,text,text,text,uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
 CREATE FUNCTION sales_lite2.parcel_options(p_family_product_ids UUID[])
 RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $parcel$${storefrontSource(parcel,'parcel').body}$parcel$;
 REVOKE ALL ON FUNCTION sales_lite2.parcel_options(UUID[]) FROM PUBLIC,anon,authenticated,service_role;
 `+readFileSync(new URL('../../docs/design/sales-only-phase2/storefront-readers.sql',import.meta.url),'utf8');
}
