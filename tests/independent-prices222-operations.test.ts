import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assert222History,upgrade222Arguments} from '../scripts/operations/frankfurt-owner-upgrade222.mjs';
import {assert222SourceRowsPreserved} from '../scripts/operations/upgrade222-data.mjs';
import {assertReady222Catalog} from '../scripts/operations/frankfurt-reference222.mjs';
import {reset222Arguments} from '../scripts/operations/frankfurt-owner-reset222.mjs';
import {assertSupportedResetReference} from '../scripts/operations/operational-schema.mjs';
import {manifestDigest,migrationManifest} from '../scripts/testing/maintenance-db-contract.mjs';
import {verifyD1Ci} from '../scripts/operations/d1-reference222-ci.mjs';
import {predecessor220Jobs,owner220DeliveryJobs} from '../scripts/operations/d1-reference220-ci.mjs';

test('222 admits precisely complete220 then222 and rejects the reserved221 or truncated/unknown histories',async()=>{
 const manifest=await migrationManifest(process.cwd()),base=manifest.filter(m=>Number(m.name.slice(0,3))<=220).map(m=>m.name.slice(0,3)),reference={prefixes:{220:{appliedVersions:base}},appliedVersions:[...base,'222']};
 assert.equal(base.length,181);assert.equal(reference.appliedVersions.length,182);assert.deepEqual(assert222History(base,reference),['222']);assert.deepEqual(assert222History(reference.appliedVersions,reference),[]);
 for(const history of [base.slice(1),[...base,'221'],[...base,'221','222'],[...base,'223'],[...base.slice(0,-1),'222']])assert.throws(()=>assert222History(history,reference));
 assert.throws(()=>upgrade222Arguments(['--apply']));assert.throws(()=>upgrade222Arguments(['--verify-only']));
 assert.equal(reset222Arguments([]).mode,'plan');for(const args of [['--target','anything'],['--apply'],['--resume'],['--reference','local-reference-through220-ready.json']])assert.throws(()=>reset222Arguments(args));
});
test('222 source preservation covers lite/public/Auth rows;not only former full tables',()=>{
 const tables={'public.products':{rows:10,hash:'products'},'sales_lite1.mode':{rows:1,hash:'OFF'},'sales_lite1.returns':{rows:2,hash:'refunds'},'auth.users':{rows:1,hash:'owner'},'supabase_migrations.schema_migrations':{rows:181,hash:'220'}};
 const after={tables:{...tables,'supabase_migrations.schema_migrations':{rows:182,hash:'222'}}};assert222SourceRowsPreserved({tables},after);
 for(const name of Object.keys(tables).filter(n=>n!=='supabase_migrations.schema_migrations')){const bad=structuredClone(after);bad.tables[name].hash='changed';assert.throws(()=>assert222SourceRowsPreserved({tables},bad),/ANY_EXISTING_ROWS_CHANGED/);}
});
test('versioned220 reference remains exact prefix;future SQL and an altered prefix are never admitted',async()=>{
 const manifest=(await migrationManifest(process.cwd())).filter(m=>Number(m.name.slice(0,3))<=220),reference={migrationCeiling:220,manifest,manifestDigest:manifestDigest(manifest)};
 assertSupportedResetReference(reference);assert.throws(()=>assertSupportedResetReference({...reference,manifest:manifest.slice(1)}));assert.throws(()=>assertSupportedResetReference({...reference,migrationCeiling:221}));
});
test('222 exact catalog rejects injected body/owner/config/ACL and unknown functions',()=>{
 const catalog=JSON.parse(readFileSync('docs/operations/TABLE_ACCESS_AFTER_222.json','utf8')).catalog;assertReady222Catalog(catalog);
 const index=catalog.functions.findIndex((f:{identity:string})=>f.identity.startsWith('update_product_master_v6('));assert.ok(index>=0);
 for(const field of ['definition','owner','configuration','acl']){const bad=structuredClone(catalog);bad.functions[index][field]=field==='definition'?bad.functions[index][field]+' ':field==='owner'?'unapproved':field==='configuration'?['search_path=public']:['=X/postgres'];assert.throws(()=>assertReady222Catalog(bad));}
 const bad=structuredClone(catalog);bad.functions.push({...bad.functions[index],identity:'unexpected_writer222()'});assert.throws(()=>assertReady222Catalog(bad));
});
test('D1 requires all existing FULL workflows plus both exact-head222 jobs;missing/red/skipped/stale is refused',async()=>{
 const head='a'.repeat(40),names=['Nawasrah code quality','Nawasrah secret scanning','Nawasrah complete backup recovery','Nawasrah lite220 owner tools','Quarantined sales-only phase1','Nawasrah independent prices222'];
 const runs=names.map((name,i)=>({id:i+1,name,head_sha:head,head_branch:'main',event:'push',status:'completed',conclusion:'success'}));
 let mutation='none';
 const get=async(route:string)=>{
  if(route==='git/ref/heads/main')return{object:{sha:head}};
  if(route.startsWith('actions/runs?'))return{workflow_runs:mutation==='missing-run'?runs.slice(0,-1):runs};
  const id=Number(route.split('/')[2]);
  const jobNames=id===4?owner220DeliveryJobs:id===5?predecessor220Jobs:id===6?['Independent222 prices and full-mode parity','Independent222 owner protection and RESET']:['legacy'];
  const jobs=jobNames.map(name=>({name,head_sha:head,status:'completed',conclusion:'success'}));
  if(id===6){if(mutation==='missing-job')jobs.pop();if(mutation==='red')jobs[0].conclusion='failure';if(mutation==='skipped')jobs[0].conclusion='skipped';if(mutation==='stale')jobs[0].head_sha='b'.repeat(40);if(mutation==='extra')jobs.push(jobs[0]);}
  return{jobs};
 };
 assert.equal((await verifyD1Ci('',head,{get,verifyJobs:()=>{}})).head,head);
 for(mutation of ['missing-run','missing-job','red','skipped','stale','extra'])await assert.rejects(()=>verifyD1Ci('',head,{get,verifyJobs:()=>{}}),/D1_CI_NOT_FULL_GREEN/);
});
