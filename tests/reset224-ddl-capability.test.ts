import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertReset224DdlCapability,verifyReset224DdlCapability,reset224DdlCapabilitySql,reset224DdlArabicReason} from '../scripts/operations/reset224-ddl-capability.mjs';
import {sourceBeforeReset224Ddl,reset224DdlPins} from '../scripts/audit/source-before-reset224-ddl.mjs';
const valid=()=>({actor:'postgres',sessionActor:'postgres',storageOwner:'supabase_storage_admin',checks:{actor:true,storage_policy:true,database_create:true,public_create:true,rebuild_ownership:true,publication:true,platform_extensions:true},deniedObjects:new Array<string>()});
test('RESET224 requires every DDL capability explicitly; rejects missing, unknown, false and indeterminate checks',()=>{
 assert.deepEqual(assertReset224DdlCapability(valid()),valid());
 for(const name of Object.keys(valid().checks))for(const value of [false,null]){
  const bad=valid();Object.assign(bad.checks,{[name]:value});assert.throws(()=>assertReset224DdlCapability(bad),/RESET224_DDL_CAPABILITY_REQUIRED/);
 }
 const missing=valid();Reflect.deleteProperty(missing.checks,'storage_policy');assert.throws(()=>assertReset224DdlCapability(missing),/UNVERIFIED/);
 const extra=valid();Object.assign(extra.checks,{unknown:true});assert.throws(()=>assertReset224DdlCapability(extra),/UNVERIFIED/);
 const denied=valid();denied.deniedObjects.push('public.products');assert.throws(()=>assertReset224DdlCapability(denied),/REQUIRED/);
});
test('capability transport only issues one read-only query and never leaks SQL failure text',async()=>{
 let calls=0;const executor={localOnly:true,localExecute:async(input:string)=>{calls++;assert.equal(input,reset224DdlCapabilitySql);return {code:0,stdout:JSON.stringify(valid()),stderr:''};}};
 assert.deepEqual(await verifyReset224DdlCapability(executor),valid());assert.equal(calls,1);
 await assert.rejects(()=>verifyReset224DdlCapability({...executor,localExecute:async()=>({code:1,stdout:'',stderr:'private value must never escape'})}),/RESET224_DDL_CAPABILITY_UNVERIFIED/);
 assert.match(reset224DdlCapabilitySql,/^BEGIN READ ONLY;/u);assert.match(reset224DdlCapabilitySql,/ROLLBACK;$/u);
 assert.doesNotMatch(reset224DdlCapabilitySql,/\b(?:CREATE|DROP|ALTER|GRANT|REVOKE|INSERT|UPDATE|DELETE)\b\s+(?:POLICY|TABLE|ROLE|SCHEMA|ON|INTO|FROM)/iu);
 assert.match(reset224DdlArabicReason,/لم تبدأ أي كتابة/u);
});
test('owner, session guard and rebuild all check capability before their first database mutation',()=>{
 const read=(p:string)=>readFileSync('scripts/operations/'+p,'utf8');
 const owner=read('frankfurt-owner-reset224.mjs');
 assert.ok(owner.indexOf('report.ddlCapability=await verifyReset224DdlCapability(readOnly)')<owner.indexOf('guard=await holdUpgradeGuard(executor)'));
 const session=read('reset224-session.mjs').split('export async function startResetAttempt')[1];
 assert.ok(session.indexOf('await verifyReset224DdlCapability(executor)')<session.indexOf('await persistResetSession'));
 const core=read('trial-reset224-core.mjs').split('async function runRetainedReset')[1];
 assert.ok(core.indexOf('await verifyReset224DdlCapability(executor)')<core.indexOf("report.stage='empty-storage-api'"));
 assert.ok(core.includes('await sql(unit.input)'),'historical SQL stays literal');
});
test('new source inverse is literal, preserves historical beforeText and rejects an unknown byte',()=>{
 for(const [file,pin] of Object.entries(reset224DdlPins)){
  const raw=readFileSync(file,'utf8').replace(/\r\n?/gu,'\n');
  assert.equal(sourceBeforeReset224Ddl(file,raw),pin.beforeText,file);
  assert.equal(sourceBeforeReset224Ddl(file,raw+'\nUNKNOWN_BYTE'),raw+'\nUNKNOWN_BYTE',file);
 }
});
