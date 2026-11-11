import test from 'node:test';
import assert from 'node:assert/strict';
import {readOperatingOrdersPageWithRpc,parseLiteOrderAmounts} from '../src/services/supabase/operatingOrdersPage';
import {readLiteDeliveryAttempt,runLiteDeliveryWithClient,liteDeliveryKey,type DeliveryClient} from '../src/services/supabase/salesOnlyDelivery';
const id=(n:number)=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`,actor=id(1),order=id(2),input={etaMinutes:20,driverPhone:'0791234567',notes:'توصيل محلي'},result={success:true,accountingTracked:false,order_id:order,status:'out_for_delivery',estimated_arrival_at:'2026-11-09T22:20:00Z',tracking_token:id(3),driver_phone:input.driverPhone};
function disk(){const rows=new Map<string,string>();return {rows,getItem:(k:string)=>rows.get(k)??null,setItem:(k:string,v:string)=>{rows.set(k,v);}};}
function api(rpc:DeliveryClient['rpc']):DeliveryClient{return {auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},rpc};}
function webLocks(){let tail=Promise.resolve();Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_name:string,_options:unknown,work:()=>Promise<unknown>)=>{const previous=tail;let done!:()=>void;tail=new Promise(resolve=>{done=resolve;});await previous;try{return await work();}finally{done();}}}}});}
test('operational page falls back only exact absent RPC;canonical liteamounts reject forged/null/duplicate entries',async()=>{
 const calls:unknown[]=[],args={p_page:2,p_filter:'all'};await readOperatingOrdersPageWithRpc(async(name,body)=>{calls.push([name,body]);return name==='lite1_operational_orders_page2'?{data:null,status:404,error:{code:'PGRST202',message:'public.lite1_operational_orders_page2'}}:{data:{order_ids:[]},error:null};},args);assert.deepEqual(calls,[['lite1_operational_orders_page2',args],['get_operational_orders_page',args]]);
 for(const r of [{data:null,status:503,error:{code:'PGRST202',message:'lite1_operational_orders_page2'}},{data:null,status:404,error:{code:'42501',message:'denied'}},{data:{broken:true},error:null}]){let count=0;await readOperatingOrdersPageWithRpc(async()=>{count++;return r;},args);assert.equal(count,1);}
 const row={orderId:order,customerName:'اسم مستلم الطلب',amountPaidInMinorUnits:500,amountDueInMinorUnits:2500},value={contractVersion:'lite2-orders-page-v1',liteAmounts:[row],summary:{review_count:1,active_count:0,due_in_minor_units:2500}};
 assert.equal(parseLiteOrderAmounts(value,[order]).get(order)?.amountDueInMinorUnits,2500);assert.equal(parseLiteOrderAmounts({order_ids:[]},[]).size,0);
 for(const broken of [{...value,liteAmounts:[row,row]},{...value,liteAmounts:[{...row,orderId:id(9)}]},{...value,liteAmounts:[{...row,amountDueInMinorUnits:null}]},{...value,summary:{...value.summary,due_in_minor_units:-1}},{...value,contractVersion:'unknown'}])assert.throws(()=>parseLiteOrderAmounts(broken,[order]));
});
test('delivery persists before send;lostreply samebody/key recovery;explicitnew edit only after success;oneconcurrentintent',async()=>{
 webLocks();const store=disk(),sent:Record<string,unknown>[]=[],commits=new Set<string>();let lose=true;
 const client=api(async(name,args)=>{assert.equal(name,'lite1_delivery2');assert.equal(readLiteDeliveryAttempt(actor,order,store)?.status,'IN_FLIGHT');sent.push(structuredClone(args));commits.add(args.p_key as string);if(lose){lose=false;throw Error('lostreply');}return {data:result,error:null};});
 await assert.rejects(runLiteDeliveryWithClient(client,actor,order,input,store));const pending=readLiteDeliveryAttempt(actor,order,store);assert.equal(pending?.status,'OUTCOME_UNKNOWN');await assert.rejects(runLiteDeliveryWithClient(client,actor,order,{...input,etaMinutes:45},store));
 await runLiteDeliveryWithClient(client,actor,order,null,store,true);assert.deepEqual(sent[0],sent[1]);assert.equal(commits.size,1);await runLiteDeliveryWithClient(client,actor,order,null,store,true);assert.equal(sent.length,2);
 await Promise.all([runLiteDeliveryWithClient(client,actor,order,{...input,etaMinutes:45},store),runLiteDeliveryWithClient(client,actor,order,{...input,etaMinutes:45},store)]);assert.equal(sent.length,3);assert.equal(commits.size,2);assert.notEqual(sent[2].p_key,pending?.key);
});
test('delivery corruptjournal/unverifiedactor/malformedresponse/localstoragefailure fail closed without erasing evidence',async()=>{
 webLocks();const store=disk(),key=liteDeliveryKey(actor,order);store.setItem(key,'broken');assert.throws(()=>readLiteDeliveryAttempt(actor,order,store));assert.equal(store.getItem(key),'broken');let calls=0;const client=api(async()=>{calls++;return {data:result,error:null};});await assert.rejects(runLiteDeliveryWithClient(client,actor,order,input,store));assert.equal(calls,0);
 const fresh=disk();client.auth.getUser=async()=>({data:{user:{id:id(90)}},error:null});await assert.rejects(runLiteDeliveryWithClient(client,actor,order,input,fresh));assert.equal(calls,0);
 const bad=api(async()=>({data:{...result,tracking_token:'raw-token'},error:null}));await assert.rejects(runLiteDeliveryWithClient(bad,actor,order,input,fresh));assert.equal(readLiteDeliveryAttempt(actor,order,fresh)?.status,'OUTCOME_UNKNOWN');const bytes=fresh.getItem(key);await assert.rejects(runLiteDeliveryWithClient(bad,actor,order,input,fresh));assert.equal(fresh.getItem(key),bytes);
});
