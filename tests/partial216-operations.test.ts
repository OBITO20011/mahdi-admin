import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {assert216History,upgrade216Versions} from '../scripts/operations/frankfurt-owner-upgrade216.mjs';
import {assertReady216Catalog} from '../scripts/operations/frankfurt-reference216.mjs';

test('216 accepts only complete215/216 history and refuses gaps,duplicates and later files',()=>{
 const base=JSON.parse(readFileSync('docs/operations/TABLE_ACCESS_AFTER_215.json','utf8')).manifest.map((n:string)=>n.slice(0,3));
 const reference={prefixes:{'215':{appliedVersions:base}},appliedVersions:[...base,'216']};
 assert.equal(base.length,177);assert.deepEqual(upgrade216Versions,['216']);assert.deepEqual(assert216History(base,reference),['216']);assert.deepEqual(assert216History(reference.appliedVersions,reference),[]);
 for(const history of[base.slice(1),base.slice(0,-1),[...base,'217'],[...base,'216','216'],[...base,'216','217']])assert.throws(()=>assert216History(history,reference));
});

test('216 admission rejects exposed private payment evidence and altered public writer ACL,path,owner or RLS',()=>{
 const catalog=JSON.parse(readFileSync('docs/operations/TABLE_ACCESS_AFTER_216.json','utf8')).catalog;assertReady216Catalog(catalog);
 for(const change of[
  (c:any)=>{c.tables.find((t:any)=>t.name==='pos216_initial_payments').rls=false;},
  (c:any)=>{c.tables.find((t:any)=>t.name==='pos216_initial_payments').acl.push('authenticated=r/postgres');},
  (c:any)=>{c.tables.find((t:any)=>t.name==='pos216_initial_payments').columns[0].acl=['anon=r/postgres'];},
  (c:any)=>{c.functions.find((f:any)=>f.identity.startsWith('create_pos_sale_with_initial_payment_v1(')).acl.push('service_role=X/postgres');},
  (c:any)=>{c.functions.find((f:any)=>f.identity.startsWith('create_pos_sale_with_initial_payment_v1(')).owner='supabase_admin';},
  (c:any)=>{c.functions.find((f:any)=>f.identity.startsWith('create_pos_sale_with_initial_payment_v1(')).configuration=[];},
  (c:any)=>{c.functions.find((f:any)=>f.identity.startsWith('tc216_reject_')).acl.push('authenticated=X/postgres');},
 ]){const changed=structuredClone(catalog);change(changed);assert.throws(()=>assertReady216Catalog(changed));}
});

test('216 required CI retains earlier jobs and includes actual browser DB and full operational rehearsals',()=>{
 const workflow=readFileSync('.github/workflows/quality.yml','utf8'),gate=readFileSync('scripts/testing/run-partial216-gates.mjs','utf8');
 assert.match(workflow,/aftercare215, partial216\]/);assert.match(workflow,/run-partial216-gates\.mjs/);
 for(const runner of['run-partial216-runtime','run-partial216-fullstack','run-table-access-diagnostic','run-service-access-diagnostic','build-acl-reference216','run-partial-upgrade216-runtime','run-reset216-resume-runtime','run-reset216-cli-contract'])assert.ok(gate.includes(runner),runner);
 const backup=readFileSync('scripts/testing/run-dual-backup-runtime.mjs','utf8');for(const literal of['historyCeiling,214','historyCeiling,215','historyCeiling,216','restore216.ok,true','old215AfterUpdate.ok,true'])assert.ok(backup.includes(literal),literal);
});
