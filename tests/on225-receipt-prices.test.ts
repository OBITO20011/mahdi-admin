import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {build} from 'esbuild';
import type {ReceiptPriceWarning225} from '../src/services/supabase/onPrices225.service';

type Result={data:unknown;error:{code:string;message:string}|null;status:number};
type Call={name:string;args:{p_product_ids:string[]}};
const bundle=build({
 entryPoints:['src/services/supabase/onPrices225.service.ts'],bundle:true,write:false,platform:'node',format:'cjs',
 plugins:[{name:'isolated-receipt-client',setup(builder){
  builder.onResolve({filter:/lib\/supabase$/},()=>({path:'client',namespace:'receipt-test'}));
  builder.onLoad({filter:/.*/,namespace:'receipt-test'},()=>({loader:'js',
   contents:'export const isSupabaseConfigured=true,supabase=globalThis.__DB;'}));
 }}],
});
async function reader(reply:(call:Call,index:number)=>Result){
 const calls:Call[]=[];
 const context=vm.createContext({module:{exports:{}},__DB:{rpc:async(name:string,args:Call['args'])=>{
  const call={name,args:JSON.parse(JSON.stringify(args)) as Call['args']};
  calls.push(call);
  return reply(call,calls.length-1);
 }}});
 vm.runInContext((await bundle).outputFiles[0].text,context);
 const service=context.module.exports as {readReceiptPriceWarnings225:(ids:string[])=>Promise<ReceiptPriceWarning225[]>};
 return {read:service.readReceiptPriceWarnings225,calls};
}
const warning=(productId:string):ReceiptPriceWarning225=>({
 productId,priceProductId:productId,name:'صنف الاختبار',unit:'باكيت',parcelUnit:'صندوق',
 unitPrice:500,parcelPrice:11000,originalUnitPrice:1000,originalParcelPrice:12000,
 parcelEnabled:false,wacInMinorUnitsExact:'839.772728',unitBelowCost:true,parcelBelowCost:false,
});
const missing=(name='get_receipt_pricing_warnings225'):Result=>({data:null,error:{code:'PGRST202',message:name},status:404});

test('receipt warning reader preserves exact saved originals, paused state and fractional WAC without a write',async()=>{
 const service=await reader(call=>({data:call.args.p_product_ids.map(warning),error:null,status:200}));
 const rows=await service.read(['product-a','product-a']);
 assert.deepEqual(JSON.parse(JSON.stringify(rows)),[warning('product-a')]);
 assert.deepEqual(service.calls,[{name:'get_receipt_pricing_warnings225',args:{p_product_ids:['product-a']}}]);
});

test('receipt warning reader rejects duplicate and unrelated products',async()=>{
 for(const rows of [[warning('product-a'),warning('product-a')],[warning('unrequested')]]){
  const service=await reader(()=>({data:rows,error:null,status:200}));
  await assert.rejects(service.read(['product-a','product-b']),/PRICES225_RECEIPT_UNVERIFIED/u);
 }
});

test('only the named missing reader on the first page keeps pre225 receiving unchanged',async()=>{
 const legacy=await reader(()=>missing());
 assert.equal((await legacy.read(['product-a'])).length,0);
 for(const result of [missing('another_rpc'),{...missing(),status:503}]){
  const service=await reader(()=>result);
  await assert.rejects(service.read(['product-a']),/PRICES225_RECEIPT_UNVERIFIED/u);
 }
});

test('bounded warning batches reject a disappearing reader instead of discarding previous results',async()=>{
 const ids=Array.from({length:101},(_,i)=>`product-${i}`);
 const service=await reader((call,index)=>index===0
  ?{data:[warning(call.args.p_product_ids[0])],error:null,status:200}:missing());
 await assert.rejects(service.read(ids),/PRICES225_RECEIPT_UNVERIFIED/u);
 assert.deepEqual(service.calls.map(call=>call.args.p_product_ids.length),[100,1]);
 assert.ok(service.calls.every(call=>call.name==='get_receipt_pricing_warnings225'));
});
