import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertReady223Catalog,quantity223Tables} from '../scripts/operations/optional-quantity223-catalog.mjs';
import {assert223SourceRowsPreserved} from '../scripts/operations/upgrade223-data.mjs';
import {assertOperationalHistory,operationalManifest} from '../scripts/operations/operational-schema.mjs';
import {reset223Arguments} from '../scripts/operations/frankfurt-owner-reset223.mjs';
import {upgrade223Arguments} from '../scripts/operations/frankfurt-owner-upgrade223.mjs';
import {sourceBeforeOptionalQuantity223,quantity223SourcePins} from '../scripts/audit/source-before-optional-quantity223.mjs';
import {pathsBeforeIndependentPrices222} from '../scripts/audit/source-before-independent-prices222.mjs';
import {verifyD1Ci} from '../scripts/operations/d1-reference223-ci.mjs';
import {owner220DeliveryJobs,predecessor220Jobs} from '../scripts/operations/d1-reference220-ci.mjs';
import {assertExternalDependents as assert222Dependents} from '../scripts/operations/reset222-foundation.mjs';

const read=(file:string)=>readFileSync(file,'utf8');

test('legacy222 RESET keeps only its previously admitted literal213 metadata policy after223 advances the ceiling',()=>{
 const row={class:'pg_policy',schema:'storage',relation:'storage.objects',policy:'ERP staff can read own product image metadata',description:'existing213 metadata policy'};
 assert.doesNotThrow(()=>assert222Dependents([row],222));
 for(const changed of [{...row,policy:'unknown policy'},{...row,schema:'public'},{...row,relation:'storage.other'},{...row,class:'unknown'}])
  assert.throws(()=>assert222Dependents([changed],222),/UNREVIEWED_EXTERNAL_DROP_DEPENDENT/);
});

test('223 catalog pins reject one byte, ACL, or new trigger on prior or counter objects',()=>{
 const {catalog}=JSON.parse(read('docs/operations/TABLE_ACCESS_AFTER_223.json'));
 assert.doesNotThrow(()=>assertReady223Catalog(catalog));
 for(const [schema,name] of [['public','lite3_set_counter223'],['public','lite1_pos2'],['sales_lite2','pos'],['sales_lite3','consume223']]){
  const modified=structuredClone(catalog);
  const row=modified.functions.find((r:{schema:string;identity:string})=>r.schema===schema&&r.identity.startsWith(name+'('));
  assert.ok(row);
  row.definition+=' ';
  assert.throws(()=>assertReady223Catalog(modified));
 }
 const acl=structuredClone(catalog);
 acl.tables.find((r:{schema:string;name:string})=>r.schema==='sales_lite3'&&r.name==='quantity_events').acl=['anon=r/postgres'];
 assert.throws(()=>assertReady223Catalog(acl));
 const trigger=structuredClone(catalog);
 trigger.triggers.find((r:{name:string})=>r.name==='optional_quantity_cancel223').enabled='D';
 assert.throws(()=>assertReady223Catalog(trigger));
});

test('223 upgrade preserves existing row hashes and requires three empty counter tables',()=>{
 const before={tables:{'public.orders':{rows:2,hash:'known'}}};
 const empty=Object.fromEntries(quantity223Tables.map(table=>['sales_lite3.'+table,{rows:0,hash:'d41d8cd98f00b204e9800998ecf8427e'}]));
 const after:{tables:Record<string,{rows:number;hash:string}>}={tables:{...before.tables,...empty}};
 assert.doesNotThrow(()=>assert223SourceRowsPreserved(before,after));
 for(const key of Object.keys(empty)){
  const dirty=structuredClone(after);
  dirty.tables[key].rows=1;
  assert.throws(()=>assert223SourceRowsPreserved(before,dirty),/UPGRADE223_COUNTER_NOT_EMPTY/);
 }
 assert.throws(()=>assert223SourceRowsPreserved(before,{tables:{...after.tables,'public.orders':{rows:2,hash:'changed'}}}),/EXISTING_APPLICATION_ROWS_CHANGED/);
});

test('223 allows exact 222 archives and refuses reserved versions or wrong matching tool inputs',async()=>{
 const manifest=(await operationalManifest()).filter((m:{name:string})=>Number(m.name.slice(0,3))<=223);
 const versions=manifest.map((m:{name:string})=>m.name.slice(0,3));
 assert.equal(manifest.at(-1)?.name,'223_optional_sales_quantity.sql');
 assert.deepEqual(await assertOperationalHistory(versions),{ceiling:223,files:183});
 assert.deepEqual(await assertOperationalHistory(versions.slice(0,-1)),{ceiling:222,files:182});
 await assert.rejects(assertOperationalHistory([...versions.slice(0,-2),'221',...versions.slice(-2)]));
 assert.equal(reset223Arguments([]).mode,'plan');
 assert.throws(()=>reset223Arguments(['--reference','local-reference-through222-ready.json']));
 assert.throws(()=>upgrade223Arguments(['--apply']),/UPGRADE223_BEFORE_BACKUP_REQUIRED/);
 assert.throws(()=>upgrade223Arguments(['--verify-only']),/UPGRADE223_BACKUP_RESTORE_APPLY_REPORT_REQUIRED/);
});

test('historical 222 projection recognises reviewed counter changes and leaves unknown bytes visible',()=>{
 for(const file of ['src/features/pos/PosView.tsx','src/services/supabase/optionalQuantity.service.ts','supabase/migrations/223_optional_sales_quantity.sql']){
  const raw=read(file),pin=quantity223SourcePins[file];
  assert.ok(pin);
  assert.equal(sourceBeforeOptionalQuantity223(file,raw),pin.beforeText);
  const unknown=raw+'\nUNKNOWN_BYTE';
  assert.equal(sourceBeforeOptionalQuantity223(file,unknown),unknown);
 }
 // This 222 path did not exist in main52. The 223 layer must leave its
 // preceding bytes to the exact 222 layer, which removes only its known addition.
 assert.deepEqual(pathsBeforeIndependentPrices222(['scripts/operations/build-acl-reference222.mjs'],
  '52c9a8b53f9e1d2bad504c88f9c6255547b09e7c'),[]);
});

test('D1 requires both exact-head223 jobs plus every preceding full workflow without skipped, duplicate or stale admission',async()=>{
 const head='a'.repeat(40),names=['Nawasrah code quality','Nawasrah secret scanning','Nawasrah complete backup recovery','Nawasrah lite220 owner tools','Quarantined sales-only phase1','Nawasrah independent prices222','Nawasrah optional quantity223'];
 const runs=names.map((name,i)=>({id:i+1,name,head_sha:head,head_branch:'main',event:'push',status:'completed',conclusion:'success'}));
 let mutation='none';
 const get=async(route:string)=>{
  if(route==='git/ref/heads/main')return{object:{sha:head}};
  if(route.startsWith('actions/runs?'))return{workflow_runs:mutation==='missing-run'?runs.slice(0,-1):runs};
  const id=Number(route.split('/')[2]);
  const jobNames=id===4?owner220DeliveryJobs:id===5?predecessor220Jobs:id===6?['Independent222 prices and full-mode parity','Independent222 owner protection and RESET']:id===7?['Optional223 database and browser lifecycle','Optional223 owner protection and RESET']:['legacy'];
  const jobs=jobNames.map(name=>({name,head_sha:head,status:'completed',conclusion:'success'}));
  if(id===7){
   if(mutation==='missing-job')jobs.pop();
   if(mutation==='red')jobs[0].conclusion='failure';
   if(mutation==='skipped')jobs[0].conclusion='skipped';
   if(mutation==='stale')jobs[0].head_sha='b'.repeat(40);
   if(mutation==='extra')jobs.push(jobs[0]);
  }
  if(id===6&&mutation==='prior-red')jobs[0].conclusion='failure';
  return{jobs};
 };
 assert.equal((await verifyD1Ci('',head,{get,verifyJobs:()=>{}})).head,head);
 for(mutation of ['missing-run','missing-job','red','skipped','stale','extra','prior-red'])
  await assert.rejects(()=>verifyD1Ci('',head,{get,verifyJobs:()=>{}}),/D1_CI_NOT_FULL_GREEN/);
});
