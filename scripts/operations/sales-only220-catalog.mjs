// Literal public+private function and private-object commitments generated from
// an independently compared fresh220/219->220 build,never from a hosted target.
import assert from 'node:assert/strict';
import {frozen220TriggerAclProfile,expectFrankfurt220TriggerAcl} from './frozen220-trigger-acl.mjs';
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
 assert.equal(p.publicFunctions,680);assert.equal(p.privateFunctions,38);assert.equal(p.frozenBodies,627);assert.equal(p.bridges,9);assert.equal(p.freshIncrementalDifferences,0);return p;
}
export function assertSalesOnly220PublicGuards(triggers,{notificationTriggerEnabled='O'}={}){
 assert.ok(['O','D'].includes(notificationTriggerEnabled),'LITE220_NOTIFICATION_TRIGGER_STATE_REQUIRED');
 const p=readSalesOnly220Pins();const expected=structuredClone(p.publicTriggers),notification=expected.filter(r=>r.table==='orders'&&r.name==='trg_notify_new_website_order_push');assert.equal(notification.length,1);assert.equal(notification[0].enabled,'O');notification[0].enabled=notificationTriggerEnabled;
 assert.deepEqual(triggers.filter(r=>r.schema==='public'),expected,'LITE220_EXACT_PUBLIC_GUARDS');
}
export function assertSalesOnly220Catalog(catalog,options){
 const p=readSalesOnly220Pins();
 const profile=frozen220TriggerAclProfile(catalog.functions);
 const expected=profile==='frankfurt'?expectFrankfurt220TriggerAcl(p.functions):p.functions;
 assert.deepEqual(salesOnly220FunctionSnapshot(catalog),expected,'LITE220_EXACT_PUBLIC_PRIVATE_FUNCTIONS');
 assert.deepEqual(salesOnly220PrivateSnapshot(catalog),p.privateObjects,'LITE220_EXACT_PRIVATE_OBJECTS');
 assertSalesOnly220PublicGuards(catalog.triggers,options);
 return catalog;
}
