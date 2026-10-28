// Replays original builder methods/arguments against a REAL isolated PostgREST.
// No mock network responses, managed URL, project key or password is used.
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {createHmac} from 'node:crypto';
export const fixtureId=n=>'92600000-0000-4000-8000-'+String(n).padStart(12,'0');
export function verifyProbeCoverage(source,results){
 assert.ok(source.entries.length>0,'EMPTY_QUERY_INVENTORY');
 const expected=source.entries.flatMap(e=>(e.role==='service_role'?['service_role']:['owner','admin','cashier'])
  .flatMap(appRole=>(e.extensions.length?['original-chain','with-query-extensions']:['original-chain'])
   .map(variant=>JSON.stringify([e.id,appRole,variant])))).sort();
 const actual=results.map(r=>JSON.stringify([r.id,r.appRole,r.variant])).sort();
 assert.equal(new Set(actual).size,actual.length,'DUPLICATE_QUERY_PROBE');
 assert.deepEqual(actual,expected,'INCOMPLETE_QUERY_PROBE_COVERAGE');
 return {complete:true,sourceSites:source.entries.length,expected:expected.length,actual:actual.length};
}
export function evaluateArgument(expression,scope){return vm.runInNewContext('('+expression+')',scope,{timeout:1000});}
export function testJwt(role,actor,secret){const b=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const unsigned=b({alg:'HS256',typ:'JWT'})+'.'+b({role,sub:actor,aal:'aal2',exp:Math.floor(Date.now()/1000)+3600});
 return unsigned+'.'+createHmac('sha256',secret).update(unsigned).digest('base64url');}
export function scopes(ids,actor){return {orderId:ids.orderId,orderIds:[ids.orderId],operationId:ids.operationId,
 userId:actor,receiptId:ids.receiptId,supplierId:fixtureId(301),poId:ids.poId,createdProdId:fixtureId(101),
 result:{data:{orderId:ids.orderId}},instances:ids.instances.map(id=>({id})),previewLimit:50,from:0,pageSize:25,
 input:{purchasePackage:'باكيت',salePackage:'باكيت',unitName:'باكيت'},body:{eventKey:'audit-local-dispatch',type:'new_order',orderId:ids.orderId},
 orderError:{message:'isolated diagnostic'},targetsError:{message:'isolated diagnostic'},target:{subscription_id:ids.subscriptionId},
 statusCode:410,failureMessage:'isolated diagnostic',status:'sent',deliveredCount:1,failedCount:0,
 params:{page:1,pageSize:25,supplierId:fixtureId(301),warehouseId:fixtureId(201),paymentStatus:'unpaid',isArchived:false},
 publicUrl:'http://127.0.0.1:25421/storage/v1/object/public/product-images/local-fixture.jpg',pattern:'%',literal:'"%"'};}
export async function replay(entry,{url,role,actor,secret,scope,extra=false}){
 assert.match(url,/^http:\/\/127\.0\.0\.1:\d+$/u,'LOCAL_ONLY');
 const token=testJwt(role,actor,secret),client=createClient(url,'local-audit-not-a-project-key',{
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:'Bearer '+token},
   // Local Supabase gateway mount only:forward the original query to PostgREST.
   // No response is synthesized and query/body/headers are left unchanged.
   fetch:(input,init)=>{const target=new URL(String(input));assert.equal(target.origin,url,'LOCAL_ONLY');
    assert.ok(target.pathname.startsWith('/rest/v1/'),'REST_ONLY');target.pathname=target.pathname.slice('/rest/v1'.length);return fetch(target,init);}}});
 let builder=client.from(entry.table);const calls=[...entry.calls,...(extra?entry.extensions:[])];
 const evaluated=[];
 for(const call of calls){const args=call.args.map(a=>evaluateArgument(a,{...entry.constants,...scope}));evaluated.push({method:call.method,args});builder=builder[call.method](...args);}
 const result=await builder.retry(false);
 assert.notEqual(result.error?.code,'PGRST125','AUDIT_GATEWAY_MOUNT_INVALID');
 const rows=Array.isArray(result.data)?result.data.length:result.data===null?0:1;
 return {id:entry.id,table:entry.table,operation:entry.operation,role,actor,variant:extra?'with-query-extensions':'original-chain',
  status:result.status,sqlstate:result.error?.code??null,message:result.error?.message??null,details:result.error?.details??null,hint:result.error?.hint??null,rows,
  outcome:result.error?.code==='42501'?'permission_denied':result.error?'other_error':rows===0&&entry.operation==='select'?'zero_rows':'success',evaluated};
}
