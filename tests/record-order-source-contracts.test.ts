import{historical220Text}from'../scripts/testing/lite220-historical-test-view.mjs';
import {sourceBeforePgNetSequenceState} from '../scripts/audit/source-before-pg-net-sequence-state.mjs';
import{pathsBeforeStorefrontImages}from'../scripts/audit/source-before-storefront-images.mjs';
import{sourceBeforeProductScale}from'../scripts/audit/source-before-product-scale.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {sourceBeforeRecordOrder,recordOrderPins,baseline} from '../scripts/audit/source-before-record-order.mjs';
import {parseSource} from '../scripts/audit/table-access-inventory.mjs';
import {parseServices} from '../scripts/audit/service-access-inventory.mjs';
const read=(file:string)=>historical220Text(file,readFileSync(file,'utf8'));
const hash=(s:string)=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
test('record presentation inverse binds full delivered bytes, exposes any unknown change and preserves all RPC/table content',()=>{
 for(const [file,pin] of Object.entries(recordOrderPins) as [string,{before:string|null;after:string}][]){
  const raw=read(file),current=sourceBeforeProductScale(file,raw)!;assert.equal(sourceBeforeProductScale(file,raw+'\nunknown-scale'),raw+'\nunknown-scale');assert.equal(hash(current),pin.after,file);
  const before=pin.before===null?null:execFileSync('git',['show',baseline+':'+file],{encoding:'utf8',windowsHide:true,maxBuffer:64*1024**2});
  assert.equal(sourceBeforeRecordOrder(file,current),before,file);
  assert.equal(sourceBeforeRecordOrder(file,current+'\n// unknown mutation\n'),current+'\n// unknown mutation\n',file);
  if(/\.[jt]sx?$/u.test(file))for(const parse of [parseSource,parseServices]){
   const a=parse(file,current),b=parse(file,before??'');
   const strip=(x:unknown):unknown=>Array.isArray(x)?x.map(strip):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).filter(([k])=>!['id','line'].includes(k)).map(([k,v])=>[k,strip(v)])):x;
   const calls=(value:ReturnType<typeof parseSource>|ReturnType<typeof parseServices>)=>{
    if('entries' in value)return {entries:value.entries,subscriptions:value.subscriptions};
    return {rpc:value.rpc,storage:value.storage,channels:value.channels,env:value.env,wrapperCalls:value.wrapperCalls};
   };
   assert.deepEqual(strip(calls(a)),strip(calls(b)),'UI must not introduce/change RPC or table access: '+file);
  }
 }
 assert.equal(sourceBeforeRecordOrder('unknown.sql','unknown'),'unknown');
 const changes=execFileSync('git',['diff','--name-only',baseline,'--','supabase','src/services','scripts/operations','scripts/backup','scripts/monitoring'],{encoding:'utf8',windowsHide:true}).trim().split('\n').filter(Boolean);
 const historicalChanges=pathsBeforeStorefrontImages(changes,'d102074583c7369502954eaf8ea70d2595f6a19c');
 for(const file of historicalChanges){assert.ok(['src/services/supabase/productWorkbook.service.ts','scripts/operations/go-live-files/check.ts'].includes(file),file);assert.equal(sourceBeforeProductScale(file,read(file)),execFileSync('git',['show',baseline+':'+file],{encoding:'utf8',windowsHide:true}),file);}
});


test('historical readiness and RESET helpers remain exact;only approved pinned pg_net diagnostics differ',()=>{
 const old=read('scripts/audit/source-before-trial-owner-r.mjs').split('export async function verifiedInventoryBeforeTrialR(){')[1];
 const assertions=old.slice(old.indexOf(' assert.match('),old.indexOf('return inventoryBeforeTrialR();')).trim();
 assert.ok(read('scripts/testing/record-order-historical-views.mjs').includes(assertions));
 const pins=JSON.parse(read('scripts/testing/rehearsal219-owner-source-pins.json'));
 for(const [file] of pins.files)assert.equal((file==='scripts/backup/postgres-diagnostic.mjs'?sourceBeforePgNetSequenceState(file,read(file))!:read(file)).replaceAll('\r\n','\n'),execFileSync('git',['show',baseline+':'+file],{encoding:'utf8',windowsHide:true,maxBuffer:64*1024**2}).replaceAll('\r\n','\n'),file);
});
