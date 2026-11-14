// A narrow additive catalog: remove exactly the four reviewed new functions,
// then apply the unchanged strict220 admission (including its four-ACL profile).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sha256,canonicalLf} from '../testing/maintenance-db-contract.mjs';
import {assertReady220Catalog} from './frankfurt-reference220.mjs';

export const independentPrices222Name='222_independent_lite_parcel_prices.sql';
export const price222FunctionNames=Object.freeze([
 'public.create_product_family_with_flavors_v3',
 'public.create_product_with_opening_stock_v6',
 'public.update_product_master_v6',
 'sales_lite1.assert_prices222',
]);
const name=row=>row.schema+'.'+row.identity.slice(0,row.identity.indexOf('('));
const isNew=row=>price222FunctionNames.includes(name(row));
export function price222NewFunctions(catalog){
 const rows=catalog.functions.filter(isNew);
 assert.deepEqual(rows.map(name).sort(),[...price222FunctionNames],'PRICES222_EXACT_NEW_FUNCTIONS_REQUIRED');
 for(const row of rows){
  const privateHelper=row.schema==='sales_lite1';
  assert.equal(row.owner,'postgres','PRICES222_FUNCTION_OWNER');
  assert.equal(row.kind,'f','PRICES222_FUNCTION_KIND');
  assert.deepEqual(row.configuration,[privateHelper?'search_path=pg_catalog, public':'search_path=public, pg_temp'],'PRICES222_FUNCTION_CONFIG');
  assert.deepEqual([...row.acl??[]].sort(),privateHelper?['postgres=X/postgres']:['authenticated=X/postgres','postgres=X/postgres'],'PRICES222_FUNCTION_ACL');
  assert.match(row.definition,/LANGUAGE plpgsql\s+SECURITY DEFINER/u,'PRICES222_DEFINER_REQUIRED');
 }
 return rows;
}
export function price222Through220Catalog(catalog,options){
 price222NewFunctions(catalog);
 const before={...catalog,functions:catalog.functions.filter(row=>!isNew(row))};
 assertReady220Catalog(before,options);
 return before;
}
export function assertPrice222Additive(before,after,options){
 assert.deepEqual(price222Through220Catalog(after,options),before,'PRICES222_CHANGED_EXISTING_CATALOG');
 return after;
}
export function price222FunctionSnapshot(catalog){
 return price222NewFunctions(catalog).map(({definition,...metadata})=>({...metadata,definitionSha256:sha256(definition)}));
}
export function readPrice222Pins(){
 const pins=JSON.parse(readFileSync(new URL('../../docs/design/independent-parcel-prices222/catalog222-pins.json',import.meta.url),'utf8'));
 assert.equal(pins.format,1);assert.equal(pins.migrationCeiling,222);assert.equal(pins.beforeCeiling,220);
 assert.equal(pins.publicFunctions,683);assert.equal(pins.privateFunctions,39);assert.equal(pins.freshIncrementalDifferences,0);
 assert.equal(pins.migrationSha256,sha256(canonicalLf(readFileSync(new URL('../../supabase/migrations/'+independentPrices222Name,import.meta.url),'utf8'))),'PRICES222_MIGRATION_PIN_DRIFT');
 assert.equal(pins.base220PinsSha256,sha256(canonicalLf(readFileSync(new URL('../../docs/design/sales-only-phase3/catalog220-pins.json',import.meta.url),'utf8'))),'PRICES222_BASE220_PIN_DRIFT');
 return pins;
}
export function assertReady222Catalog(catalog,options){
 const pins=readPrice222Pins();
 price222Through220Catalog(catalog,options);
 assert.deepEqual(price222FunctionSnapshot(catalog),pins.functions,'PRICES222_EXACT_NEW_DEFINITIONS');
 return catalog;
}
