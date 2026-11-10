// Literal public+private function and private-object commitments generated from
// an independently compared fresh220/219->220 build,never from a hosted target.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sha256,canonicalLf} from '../testing/maintenance-db-contract.mjs';
import {salesOnly220Name} from '../testing/sales-only220-compiler.mjs';
export const salesOnlySchemas=Object.freeze(['sales_lite1','sales_lite2']);
const key=r=>(r.schema??'')+'.'+(r.identity??r.name??'');
const sorted=rows=>rows.sort((a,b)=>key(a)<key(b)?-1:key(a)>key(b)?1:0);
export function salesOnly220FunctionSnapshot(catalog){
 return sorted(catalog.functions.filter(f=>['public',...salesOnlySchemas].includes(f.schema)).map(({definition,...metadata})=>({...metadata,definitionSha256:sha256(definition)})));
}
export function salesOnly220PrivateSnapshot(catalog){
 return Object.fromEntries(Object.entries(catalog).map(([section,rows])=>[section,rows.filter(r=>salesOnlySchemas.includes(r.schema)||(section==='schemas'&&salesOnlySchemas.includes(r.name)))]));
}
export function readSalesOnly220Pins(){
 const p=JSON.parse(readFileSync(new URL('../../docs/design/sales-only-phase3/catalog220-pins.json',import.meta.url),'utf8'));
 assert.equal(p.migrationSha256,sha256(canonicalLf(readFileSync(new URL('../../supabase/migrations/'+salesOnly220Name,import.meta.url),'utf8'))),'LITE220_CATALOG_PINS_MIGRATION_DRIFT');
 assert.equal(p.publicFunctions,678);assert.equal(p.privateFunctions,35);assert.equal(p.frozenBodies,628);assert.equal(p.bridges,8);assert.equal(p.freshIncrementalDifferences,0);return p;
}
export function assertSalesOnly220Catalog(catalog){
 const p=readSalesOnly220Pins();
 assert.deepEqual(salesOnly220FunctionSnapshot(catalog),p.functions,'LITE220_EXACT_PUBLIC_PRIVATE_FUNCTIONS');
 assert.deepEqual(salesOnly220PrivateSnapshot(catalog),p.privateObjects,'LITE220_EXACT_PRIVATE_OBJECTS');
 assert.deepEqual(catalog.triggers.filter(r=>r.schema==='public'),p.publicTriggers,'LITE220_EXACT_PUBLIC_GUARDS');
 return catalog;
}
