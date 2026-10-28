import assert from 'node:assert/strict';
import test from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import {runAdminAftercareMutation} from '../src/services/supabase/adminAftercareRecovery';
import {runPosV2Attempt,readPosV2Recovery} from '../src/services/supabase/posV2Recovery';
import type {CreatePosSaleV2Input} from '../src/services/supabase/posV2.service';
import {installAftercareIndexedDbFixture} from './helpers/aftercareIndexedDb';
const actor='43210000-0000-4000-8000-000000000001',order='43210000-0000-4000-8000-000000000002';
async function fixture(work:(storage:Map<string,string>,client:SupabaseClient)=>Promise<void>){
 const restoreIndexedDb=installAftercareIndexedDbFixture();
 const oldStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator'),storage=new Map<string,string>();
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v)}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_name:string,_options:unknown,fn:()=>Promise<unknown>)=>fn()}}});
 const client={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})}} as unknown as SupabaseClient;
 try{await work(storage,client);}finally{restoreIndexedDb();if(oldStorage)Object.defineProperty(globalThis,'localStorage',oldStorage);else Reflect.deleteProperty(globalThis,'localStorage');if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else Reflect.deleteProperty(globalThis,'navigator');}
}
const posInput:CreatePosSaleV2Input={warehouseId:'43210000-0000-4000-8000-000000000003',branchId:'43210000-0000-4000-8000-000000000004',paymentMethod:'cash',lines:[{commercial_line_kind:'base_unit',product_id:order,base_quantity:10}],discountInMinorUnits:0,amountReceivedInMinorUnits:1000,idempotencyKey:'captured-by-client'};
for(const [code,identity]of [['23514','PARCEL209_UNIT_SALE_FORBIDDEN'],['40001','PARCEL209_FAMILY_CHANGED_RETRY']]){
 test('209 POS known refusal '+identity+' is definitive only without previous uncertainty',async()=>{
  await fixture(async(storage,client)=>{
   (client as unknown as {rpc:()=>Promise<unknown>}).rpc=async()=>({data:null,error:{code,message:identity+': refused'}}) as Awaited<ReturnType<SupabaseClient['rpc']>>;
   await runPosV2Attempt(client,actor,'START_NEW',posInput);assert.equal(readPosV2Recovery(actor)?.status,'DEFINITIVELY_REJECTED');storage.clear();
   (client as unknown as {rpc:()=>Promise<unknown>}).rpc=async()=>({data:null,error:{message:'network timeout'}}) as Awaited<ReturnType<SupabaseClient['rpc']>>;
   await runPosV2Attempt(client,actor,'START_NEW',posInput);const original=readPosV2Recovery(actor)!.request;
   (client as unknown as {rpc:()=>Promise<unknown>}).rpc=async()=>({data:null,error:{code,message:identity+': refused'}}) as Awaited<ReturnType<SupabaseClient['rpc']>>;
   await runPosV2Attempt(client,actor,'RECOVER_EXISTING');assert.equal(readPosV2Recovery(actor)?.status,'OUTCOME_UNKNOWN');assert.deepEqual(readPosV2Recovery(actor)?.request,original);await assert.rejects(runPosV2Attempt(client,actor,'START_NEW',posInput));
  });
 });
}
for(const [code,identity]of [['23514','PARCEL209_REPLACEMENT_WHOLE_PARCEL_REQUIRED'],['40001','PARCEL209_FAMILY_CHANGED_RETRY']]){
 test('209 replacement known refusal '+identity+' preserves immutable unknown attempt',async()=>{
  await fixture(async(storage,client)=>{
   const request={items:[{sourceKind:'base_order_item',sourceId:order,quantity:1}],reason:'طلب بديل',notes:null};
   const refused=async()=>({data:null,error:{code,message:identity+': refused'}});
   await runAdminAftercareMutation(client,order,'replacement','START_NEW',request,refused);assert.equal(JSON.parse([...storage.values()][0]).status,'DEFINITIVELY_REJECTED');storage.clear();
   await assert.rejects(runAdminAftercareMutation(client,order,'replacement','START_NEW',request,async()=>{throw new Error('lost reply');}),/lost reply/);
   const before=JSON.parse([...storage.values()][0]);await runAdminAftercareMutation(client,order,'replacement','RECOVER_EXISTING',null,refused);const after=JSON.parse([...storage.values()][0]);assert.equal(after.status,'OUTCOME_UNKNOWN');assert.equal(after.hadUnknownOutcome,true);for(const field of ['request','idempotencyKey','requestFingerprint','attemptId'])assert.deepEqual(after[field],before[field]);
   await assert.rejects(runAdminAftercareMutation(client,order,'replacement','START_NEW',request,refused),/AFTERCARE_OUTCOME_UNKNOWN/);
  });
 });
}
test('unrecognized23514/40001 never qualifies as a new POS definite refusal',async()=>{
 for(const code of ['23514','40001'])await fixture(async(_storage,client)=>{(client as unknown as {rpc:()=>Promise<unknown>}).rpc=async()=>({data:null,error:{code,message:'UNRECOGNIZED_GUARD: refused'}}) as Awaited<ReturnType<SupabaseClient['rpc']>>;await runPosV2Attempt(client,actor,'START_NEW',posInput);assert.equal(readPosV2Recovery(actor)?.status,'OUTCOME_UNKNOWN');});
});
