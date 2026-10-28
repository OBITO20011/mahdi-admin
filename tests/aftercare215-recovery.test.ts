import test from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {installAftercareIndexedDbFixture} from './helpers/aftercareIndexedDb';
import {readAdminAftercareRecoveryState,runAdminAftercareMutation} from '../src/services/supabase/adminAftercareRecovery';
import {readAftercareFence} from '../src/services/supabase/adminAftercareFence';
import {invokeAftercare215} from '../src/services/supabase/aftercare215Rpc';

const id=(n:number)=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`,actor=id(1),order=id(2);
const request={payload:{orderId:order,items:[{sourceKind:'base_order_item',sourceId:id(3),quantity:12,goodQuantity:11,supplierId:null}],reason:'فحص الراجع',notes:null},previewFingerprint:'a'.repeat(64)};
const result={success:true,contractVersion:215,operationId:id(4),orderId:order,replacementId:id(5),issuedQuantity:12,restockedQuantity:11,badQuantity:1,caseIds:[],moneyDifferenceInMinorUnits:0};
async function fixture(work:(f:{storage:Map<string,string>;client:SupabaseClient})=>Promise<void>){
  const restoreDb=installAftercareIndexedDbFixture(),descriptors=['localStorage','navigator'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)] as const),storage=new Map<string,string>();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v)}});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_name:string,_options:unknown,callback:()=>Promise<unknown>)=>callback()}}});
  const client={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})}} as unknown as SupabaseClient;
  try{await work({storage,client});}finally{restoreDb();for(const[k,d]of descriptors){if(d)Object.defineProperty(globalThis,k,d);else Reflect.deleteProperty(globalThis,k);}}
}
test('215 lost response retains exact request/key/seal; all modern and legacy modes stay blocked',async()=>{
  await fixture(async({storage,client})=>{
    let sentKey='',sent:unknown;
    await assert.rejects(runAdminAftercareMutation(client,order,'inspected_replacement','START_NEW',request,async(key,body)=>{sentKey=key;sent=body;throw Error('lost reply');}),/lost reply/);
    const before=JSON.parse([...storage.values()][0]),fence=await readAftercareFence(actor,order);assert.equal(fence?.status,'pending');
    assert.deepEqual(Object.keys(fence!).sort(),['version','status','actorId','orderId','action','attemptId','idempotencyKey','requestFingerprint'].sort());
    assert.equal(JSON.stringify(fence).includes('goodQuantity'),false);
    for(const action of ['return','replacement','sealed_return','inspected_replacement','exchange'] as const){
      let calls=0;const body=action==='exchange'?{...request,payload:{returnRequest:{orderId:order}}}:request;
      await assert.rejects(runAdminAftercareMutation(client,order,action,'START_NEW',body,async()=>{calls++;return{data:result,error:null};}),/AFTERCARE_OUTCOME_UNKNOWN/);assert.equal(calls,0);
    }
    const recovery=await runAdminAftercareMutation(client,order,'inspected_replacement','RECOVER_EXISTING',null,async(key,body)=>{assert.equal(key,sentKey);assert.deepEqual(body,sent);return{data:{...result,idempotentReplay:true},error:null};});
    assert.equal(recovery.data?.success,true);const after=JSON.parse([...storage.values()][0]);
    for(const k of ['attemptId','intentId','idempotencyKey','requestFingerprint','request'])assert.deepEqual(after[k],before[k]);
    assert.equal((await readAftercareFence(actor,order))?.status,'finished');
  });
});
test('215 coherent durable fence blocks another mode even when localStorage exposes a stale empty snapshot',async()=>{
  await fixture(async({client})=>{
    await assert.rejects(runAdminAftercareMutation(client,order,'inspected_replacement','START_NEW',request,async()=>{throw Error('lost');}),/lost/);
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>null,setItem:()=>assert.fail('no write permitted')}});
    let calls=0;await assert.rejects(runAdminAftercareMutation(client,order,'return','START_NEW',{},async()=>{calls++;return{data:null,error:null};}),/OUTCOME_UNKNOWN/);assert.equal(calls,0);
    await assert.rejects(readAdminAftercareRecoveryState(client,order,'inspected_replacement'),/REVIEW_REQUIRED/);
  });
});
test('215 named bare preview change is definitive only before any uncertainty',async()=>{
  await fixture(async({storage,client})=>{
    const refused=async()=>({data:null,error:{code:'P0001',message:'AFTERCARE215_PREVIEW_CHANGED'}});
    await runAdminAftercareMutation(client,order,'inspected_replacement','START_NEW',request,refused);
    assert.equal(JSON.parse([...storage.values()][0]).status,'DEFINITIVELY_REJECTED');assert.equal((await readAftercareFence(actor,order))?.status,'finished');
    await assert.rejects(runAdminAftercareMutation(client,order,'inspected_replacement','START_NEW',request,async()=>{throw Error('lost');}),/lost/);
    await runAdminAftercareMutation(client,order,'inspected_replacement','RECOVER_EXISTING',null,refused);
    assert.equal(JSON.parse([...storage.values()][0]).status,'OUTCOME_UNKNOWN');assert.equal((await readAftercareFence(actor,order))?.status,'pending');
  });
});
test('215 cached success is replayed server-side with the same key, never a new intent',async()=>{
  await fixture(async({client,storage})=>{
    let key='';await runAdminAftercareMutation(client,order,'inspected_replacement','START_NEW',request,async(k)=>{key=k;return{data:result,error:null};});
    let calls=0;await runAdminAftercareMutation(client,order,'inspected_replacement','RECOVER_EXISTING',null,async(k,sent)=>{calls++;assert.equal(k,key);assert.deepEqual(sent,request);return{data:{...result,idempotentReplay:true},error:null};});
    assert.equal(calls,1);assert.equal(JSON.parse([...storage.values()][0]).generation,2);
  });
});
test('215 incomplete result/cost leakage keeps the operation unknown without persisting private values',async()=>{
  for(const bad of [{...result,restockedQuantity:12},{...result,unitCost:'500'},{...result,profit:0}])await fixture(async({client,storage})=>{
    const response=await runAdminAftercareMutation(client,order,'inspected_replacement','START_NEW',request,async()=>({data:bad,error:null}));
    assert.equal(response.data,null);const saved=JSON.parse([...storage.values()][0]);assert.equal(saved.status,'OUTCOME_UNKNOWN');assert.equal(saved.result,undefined);assert.equal(JSON.stringify(saved).includes('unitCost'),false);
  });
});
test('215 capture precedes authentication; no preview/cost object may be saved as a mutation payload',async()=>{
  await fixture(async({client,storage})=>{
    const mutable=structuredClone(request);const run=runAdminAftercareMutation(client,order,'inspected_replacement','START_NEW',mutable,async(_key,body)=>{assert.deepEqual(body,request);return{data:result,error:null};});
    mutable.payload.reason='changed later';mutable.payload.items[0].goodQuantity=0;await run;
    const before=[...storage.entries()];let calls=0;
    await assert.rejects(runAdminAftercareMutation(client,order,'inspected_replacement','START_NEW',{...request,payload:{...request.payload,ownerValues:{profit:'500'}}},async()=>{calls++;return{data:result,error:null};}),/REVIEW_REQUIRED/);
    assert.equal(calls,0);assert.deepEqual([...storage.entries()],before);
  });
});
test('215 replay RPC dispatch is fixed by typed mode and validates invoice scope before invoking',async()=>{
  const calls:Array<[string,unknown]>=[],client={rpc:async(name:string,args:unknown)=>{calls.push([name,args]);return{data:result,error:null};}} as unknown as SupabaseClient;
  for(const [action,name]of [['sealed_return','settle_admin_sales_return_v2'],['inspected_replacement','settle_inspected_sales_replacement_v2'],['exchange','settle_sales_exchange_v1']] as const){
    const body=action==='exchange'?{...request,payload:{returnRequest:{orderId:order}}}:request;
    await invokeAftercare215(client,action,order,'same-key',body);assert.equal(calls.at(-1)?.[0],name);assert.deepEqual(calls.at(-1)?.[1],{p_payload:body.payload,p_preview_fingerprint:body.previewFingerprint,p_idempotency_key:'same-key'});
    await assert.rejects(invokeAftercare215(client,action,id(99),'same-key',body),/REVIEW_REQUIRED/);
  }
  assert.equal(calls.length,3);
});
