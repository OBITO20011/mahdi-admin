import assert from 'node:assert/strict';
import test from 'node:test';
import {parseOperatingMode,readOperatingModeWithRpc,type OperatingModeInfo} from '../src/services/supabase/operatingMode.service';
import {createModeReader} from '../src/features/operatingMode/modeReader';
import {decodeOperatingMode} from '../supabase/functions/submit-guest-order/operatingMode';

const info=(mode:'full'|'sales-only'):OperatingModeInfo=>({mode,installed:true});
function deferred(){let resolve!:(value:OperatingModeInfo)=>void,reject!:(error:Error)=>void;const promise=new Promise<OperatingModeInfo>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
test('admin mode contract matchesEdge;legacy219fallback onlyfor specificallyabsentRPC,neverunknownnetwork',async()=>{
 for(const fullAccounting of [true,false]){
  const data={contractVersion:'sales-only-phase2-v1',fullAccounting};
  assert.deepEqual(parseOperatingMode({data,error:null,status:200}),info(decodeOperatingMode(true,200,data)?'full':'sales-only'));
 }
 const missing={code:'PGRST202',message:'Could not find public.lite1_operating_mode in schema cache'};
 assert.equal(decodeOperatingMode(false,404,missing),true);
 assert.deepEqual(parseOperatingMode({data:null,error:missing,status:404}),{mode:'full',installed:false});
 for(const response of [
  {data:null,error:null,status:200},{data:{fullAccounting:false},error:null,status:200},
  {data:{contractVersion:'sales-only-phase2-v1',fullAccounting:'false'},error:null,status:200},
  {data:null,error:missing,status:503},{data:null,error:{...missing,message:'another_function missing'},status:404},
  {data:null,error:{message:'network timeout'},status:0},
  {data:{contractVersion:'sales-only-phase2-v1',fullAccounting:true},error:missing,status:404},
 ])assert.throws(()=>parseOperatingMode(response),/OPERATING_MODE_UNVERIFIED/);
 let calls=0;assert.deepEqual(await readOperatingModeWithRpc(async(name,args)=>{
  calls++;assert.equal(name,'lite1_operating_mode');assert.deepEqual(args,{});return {data:{contractVersion:'sales-only-phase2-v1',fullAccounting:false},error:null,status:200};
 }),info('sales-only'));assert.equal(calls,1);
});
test('mode reader shares onlyinflightsameactor;lateoldactor responsecannotauthorize the nextactor',async()=>{
 const first=deferred(),second=deferred();let calls=0;
 const reader=createModeReader(()=>++calls===1?first.promise:second.promise);
 const a=reader.load('owner-a');assert.equal(reader.load('owner-a'),a);
 await Promise.resolve();assert.equal(calls,1);
 const b=reader.load('owner-b');assert.equal(reader.getSnapshot().mode,null);assert.equal(reader.getSnapshot().status,'loading');
 await Promise.resolve();second.resolve(info('sales-only'));await b;
 first.resolve(info('full'));await a;
 assert.equal(reader.getSnapshot().actorId,'owner-b');assert.equal(reader.getSnapshot().mode,'sales-only');assert.equal(reader.getSnapshot().status,'ready');
});
test('forced post-toggle read wins overstale pendingread andfailedrefresh doesnotunmount savedcart view',async()=>{
 const queue=[deferred(),deferred(),deferred(),deferred()];let at=0;
 const reader=createModeReader(()=>queue[at++].promise);
 const initial=reader.load('owner');await Promise.resolve();queue[0].resolve(info('sales-only'));await initial;
 const stale=reader.load('owner');await Promise.resolve();
 assert.equal(reader.getSnapshot().mode,'sales-only');assert.equal(reader.getSnapshot().status,'loading');
 const forced=reader.load('owner',true);await Promise.resolve();queue[2].resolve(info('full'));await forced;
 queue[1].resolve(info('sales-only'));await stale;assert.equal(reader.getSnapshot().mode,'full');
 const failed=reader.load('owner');await Promise.resolve();queue[3].reject(Error('sensitive network detail'));await failed;
 assert.equal(reader.getSnapshot().mode,'full');assert.equal(reader.getSnapshot().status,'error');
 assert.equal(reader.getSnapshot().errorCode,'OPERATING_MODE_UNVERIFIED');assert.doesNotMatch(JSON.stringify(reader.getSnapshot()),/sensitive/);
});
test('logout invalidates pending mode anddoesnotreuse resultfor laterlogin',async()=>{
 const slow=deferred(),reader=createModeReader(()=>slow.promise);
 const pending=reader.load('owner');await Promise.resolve();reader.reset();slow.resolve(info('sales-only'));await pending;
 assert.deepEqual(reader.getSnapshot(),{actorId:null,mode:null,installed:null,status:'idle',errorCode:null});
});
