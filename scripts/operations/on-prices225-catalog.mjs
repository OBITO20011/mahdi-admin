import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {catalogDifference} from '../testing/schema-catalog.mjs';
import {assertReady224Catalog} from './inventory224-catalog.mjs';

export const price225StateTable='product_sale_pricing_state225';
export const price225Migration='225_on_independent_prices.sql';
export const price225CandidatePath='docs/design/on-independent-prices225/225_on_independent_prices.candidate.sql';
export const price225FunctionNames=Object.freeze([
 'create_product_family_with_flavors_v4',
 'create_product_with_opening_stock_v7',
 'get_pos_parcel_options225',
 'get_product_pricing_context225',
 'get_public_parcel_options225',
 'get_receipt_pricing_warnings225',
 'price225_assert_context_internal',
 'price225_assert_prices_internal',
 'price225_create_loss_confirmation_internal',
 'price225_filter_parcel_options_internal',
 'price225_guard_new_parcel_internal',
 'price225_loss_confirmation_internal',
 'price225_record_state_internal',
 'public_storefront_catalog_page225',
 'public_storefront_merchandising225',
 'search_pos_products225',
 'update_product_master_v7',
]);
const constraints=Object.freeze([
 `${price225StateTable}_check`,`${price225StateTable}_check1`,
 `${price225StateTable}_original_parcel_price_check`,`${price225StateTable}_original_unit_price_check`,
 `${price225StateTable}_pkey`,`${price225StateTable}_product_id_fkey`,
]);
const publicReaders=new Set(['public_storefront_catalog_page225','public_storefront_merchandising225','get_public_parcel_options225']);
const functionName=row=>row.identity.slice(0,row.identity.indexOf('('));
const stateObject=row=>row.schema==='public'&&(row.table??row.name)===price225StateTable;
const newFunction=row=>row.schema==='public'&&price225FunctionNames.includes(functionName(row));
const newTrigger=row=>row.schema==='public'&&row.table==='order_items'&&row.name==='trg_price225_guard_new_parcel';

/** @param {{notificationTriggerEnabled?:string}} [options] */
export function price225Through224Catalog(catalog,options){
 const rows=catalog.functions.filter(newFunction);
 assert.deepEqual(rows.map(functionName).sort(),[...price225FunctionNames],'PRICES225_EXACT_NEW_FUNCTIONS');
 for(const row of rows){
  const name=functionName(row);
  assert.equal(row.owner,'postgres','PRICES225_FUNCTION_OWNER');
  assert.equal(row.kind,'f','PRICES225_FUNCTION_KIND');
  assert.deepEqual(row.configuration,['search_path=pg_catalog, public'],'PRICES225_FUNCTION_SEARCH_PATH');
  const rights=name.startsWith('price225_')?['postgres=X/postgres']:
   publicReaders.has(name)?['anon=X/postgres','authenticated=X/postgres','postgres=X/postgres']:
    ['authenticated=X/postgres','postgres=X/postgres'];
  assert.deepEqual([...row.acl??[]].sort(),rights,'PRICES225_FUNCTION_ACL');
  assert.match(row.definition,/\bSECURITY DEFINER\b/u,'PRICES225_DEFINER_REQUIRED');
 }
 const tables=catalog.tables.filter(stateObject);
 assert.equal(tables.length,1,'PRICES225_EXACT_STATE_TABLE');
 assert.equal(tables[0].kind,'r');assert.equal(tables[0].owner,'postgres');
 assert.equal(tables[0].rls,true);assert.equal(tables[0].forceRls,false);
 assert.deepEqual(tables[0].acl,['postgres=arwdDxtm/postgres'],'PRICES225_STATE_TABLE_ACL');
 const tableConstraints=catalog.constraints.filter(stateObject);
 assert.deepEqual(tableConstraints.map(row=>row.name).sort(),[...constraints].sort(),'PRICES225_EXACT_STATE_CONSTRAINTS');
 assert.deepEqual(catalog.indexes.filter(stateObject).map(row=>row.name),[`${price225StateTable}_pkey`]);
 assert.deepEqual(catalog.policies.filter(stateObject),[],'PRICES225_NO_DIRECT_ROW_ACCESS');
 const triggers=catalog.triggers.filter(newTrigger);
 assert.equal(triggers.length,1,'PRICES225_EXACT_NEW_LINE_GUARD');
 assert.equal(triggers[0].enabled,'O','PRICES225_NEW_LINE_GUARD_ENABLED');
 const before=structuredClone(catalog);
 before.functions=before.functions.filter(row=>!newFunction(row));
 for(const section of ['tables','constraints','indexes'])before[section]=before[section].filter(row=>!stateObject(row));
 before.triggers=before.triggers.filter(row=>!newTrigger(row));
 assertReady224Catalog(before,options);
 return before;
}

/** @param {{notificationTriggerEnabled?:string}} [options] */
export function assertPrice225Additive(before,after,options){
 assert.deepEqual(price225Through224Catalog(after,options),before,'PRICES225_CHANGED_EXISTING_CATALOG');
 return catalogDifference(before,after);
}

export function readPrice225CandidatePins(){
 const pins=JSON.parse(readFileSync(new URL('../../docs/design/on-independent-prices225/catalog225-candidate-pins.json',import.meta.url),'utf8'));
 assert.equal(pins.format,1);assert.equal(pins.beforeCeiling,224);assert.equal(pins.migrationCeiling,225);
 assert.equal(pins.migrationSha256,sha256(canonicalLf(readFileSync(new URL('../../'+price225CandidatePath,import.meta.url),'utf8'))),'PRICES225_CANDIDATE_PIN_CHANGED');
 assert.equal(pins.migrationSha256,sha256(readFileSync(new URL('../../supabase/migrations/'+price225Migration,import.meta.url))),'PRICES225_ACTIVE_MIGRATION_PIN_CHANGED');
 assert.equal(pins.base224PinsSha256,sha256(canonicalLf(readFileSync(new URL('../../docs/design/inventory224/catalog224-pins.json',import.meta.url),'utf8'))),'PRICES225_BASE224_PINS_CHANGED');
 return pins;
}

/** @param {{notificationTriggerEnabled?:string}} [options] */
export function assertReady225CandidateCatalog(catalog,options){
 const before=price225Through224Catalog(catalog,options);
 const pins=readPrice225CandidatePins();
 assert.deepEqual(catalogDifference(before,catalog),pins.changes,'PRICES225_EXACT_ADDITIVE_CATALOG_PIN');
 return catalog;
}
