import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {storefrontSource,catalogSignature,parcelSignature} from '../scripts/testing/sales-only-phase2-storefront.mjs';
function original(path:string,signature:string,name:string,delimiter:string,replace=false){
 const text=readFileSync(path,'utf8').replaceAll('\r\n','\n'),start=text.indexOf(`CREATE${replace?' OR REPLACE':''} FUNCTION public.${name}(`),tail=text.slice(start),begin=tail.indexOf('AS '+delimiter)+3+delimiter.length,end=tail.indexOf(delimiter+';',begin);
 assert.ok(start>=0&&begin>0&&end>begin);return {signature,source:tail.slice(begin,end)};
}
test('public parallel sources preserve pinned219 catalog and117 parcel except seven/nine explicit hunks;unknown source refused',()=>{
 for(const [kind,row,count]of [
  ['catalog',original('supabase/migrations/209_product_sale_methods.sql',catalogSignature,'get_public_storefront_catalog_page','$function$',true),7],
  ['parcel',original('supabase/migrations/117_customer_public_configurable_parcel_read_contract.sql',parcelSignature,'get_public_configurable_parcel_options','$$'),9],
 ] as const){const {body,hunks}=storefrontSource(row,kind);let expected=row.source;for(const hunk of hunks){assert.equal(expected.split(hunk.from).length,2);expected=expected.replace(hunk.from,()=>hunk.to);}assert.equal(body,expected);assert.equal(hunks.length,count);
  assert.doesNotMatch(body,/inventory_balances|wac_cost/);assert.match(body,/sales_lite1.available/);assert.match(body,/'availableQuantity',NULL/);assert.match(body,/'quantityTracked',false/);
  assert.throws(()=>storefrontSource({...row,source:row.source+'UNKNOWN'},kind),/STOREFRONT_FROZEN_SOURCE_DRIFT/);
 }
 const sql=readFileSync('docs/design/sales-only-phase2/storefront-readers.sql','utf8');
 for(const name of ['get_public_storefront_catalog_page','get_public_configurable_parcel_options','get_public_storefront_merchandising'])assert.ok(sql.includes('RETURN public.'+name));
 assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|ALTER)\b/u);assert.match(sql,/REVOKE ALL/);assert.match(sql,/cardinality\(p_product_ids\)>48/);assert.match(sql,/length\(COALESCE\(p_search,''\)\)>500/);
});
