import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {catalogDifference} from '../testing/schema-catalog.mjs';
import {assertReady223Catalog} from './optional-quantity223-catalog.mjs';

export const inventory224Migration='224_optional_quantity_inventory_reader.sql';
export const inventory224Identity='lite3_counters224(p_search text, p_filter text, p_page integer, p_page_size integer)';
const pinFile=new URL('../../docs/design/inventory224/catalog224-pins.json',import.meta.url);
export const migration224Sha256=()=>sha256(canonicalLf(readFileSync(new URL('../../supabase/migrations/'+inventory224Migration,import.meta.url),'utf8')));

export function inventory224CatalogDelta(before,after,dates){
 const changes=catalogDifference(before,after,dates);
 assert.equal(changes.length,1,'INVENTORY224_EXACTLY_ONE_ADDITIVE_READER');
 const change=changes[0];
 assert.equal(change.section,'functions');assert.equal(change.before,null,'INVENTORY224_NO_EXISTING_FUNCTION_CHANGE');
 const row=change.after;assert.ok(row);
 assert.equal(row.schema,'public');assert.equal(row.identity,inventory224Identity);assert.equal(row.kind,'f');
 assert.equal(row.owner,'postgres');assert.deepEqual([...row.acl].sort(),['authenticated=X/postgres','postgres=X/postgres']);
 assert.deepEqual(row.configuration,['search_path=pg_catalog, public']);
 assert.match(row.definition,/\bSTABLE SECURITY DEFINER\b/u);
 return changes;
}

function pins(){
 const result=JSON.parse(readFileSync(pinFile,'utf8'));assert.equal(result.format,1);
 assert.equal(result.migrationSha256,migration224Sha256(),'INVENTORY224_MIGRATION_PIN_CHANGED');
 assert.equal(result.base223PinSha256,sha256(canonicalLf(readFileSync(new URL('../../docs/design/off-quantity-counter223/catalog223-pins.json',import.meta.url),'utf8'))));
 return result;
}
export function assertInventory224CatalogDelta(before,after,dates){
 assert.deepEqual(inventory224CatalogDelta(before,after,dates),pins().changes,'INVENTORY224_READER_CATALOG_PIN_CHANGED');
}
export function assertReady224Catalog(catalog,options){
 const before=structuredClone(catalog);
 const rows=before.functions.filter(row=>row.schema==='public'&&row.identity===inventory224Identity);
 assert.equal(rows.length,1,'INVENTORY224_READER_MISSING_OR_DUPLICATED');
 before.functions=before.functions.filter(row=>!(row.schema==='public'&&row.identity===inventory224Identity));
 assertReady223Catalog(before,options);
 assertInventory224CatalogDelta(before,catalog);
 return catalog;
}
