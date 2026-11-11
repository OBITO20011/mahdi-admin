import assert from 'node:assert/strict';
import test from 'node:test';
import {readCustomerStatementWithRpc} from '../src/services/supabase/customerStatement.service';
import {readReceiptWithRpc} from '../customer-web/src/services/receipts.service';

test('readers use immutable server dispatch;only specifically absent219 RPC permits exact old call',async()=>{
 const calls:unknown[]=[];
 const statement={customer_id:'customer',page:1,page_size:25,total_count:0,has_more:false,closing_balance_in_minor_units:0,page_opening_balance_in_minor_units:0,page_closing_balance_in_minor_units:0,movements:[]};
 const actual=await readCustomerStatementWithRpc('customer',1,async(name,args)=>{calls.push([name,args]);return {data:statement,error:null,status:200};});
 assert.deepEqual(actual,statement);assert.deepEqual(calls,[['lite1_statement_dispatch2',{p_customer_id:'customer',p_page:1,p_page_size:25}]]);
 const oldCalls:unknown[]=[];
 assert.deepEqual(await readCustomerStatementWithRpc('customer',1,async(name,args)=>{oldCalls.push([name,args]);return name==='lite1_statement_dispatch2'?{data:null,error:{code:'PGRST202',message:'public.lite1_statement_dispatch2 missing'},status:404}:{data:statement,error:null,status:200};}),statement);
 assert.deepEqual(oldCalls,[['lite1_statement_dispatch2',{p_customer_id:'customer',p_page:1,p_page_size:25}],['get_customer_statement',{p_customer_id:'customer',p_page:1,p_page_size:25}]]);
 const receiptCalls:unknown[]=[];
 const response=await readReceiptWithRpc('token',async(name,args)=>{receiptCalls.push([name,args]);return name==='lite1_public_pos_receipt2'?{data:null,error:{code:'PGRST202',message:'public.lite1_public_pos_receipt2 missing'},status:404}:{data:{success:true},error:null,status:200};});
 assert.deepEqual(response.data,{success:true});assert.deepEqual(receiptCalls,[['lite1_public_pos_receipt2',{p_receipt_token:'token'}],['get_public_pos_receipt',{p_receipt_token:'token'}]]);
});
test('permissions,network,wrongmissingname or malformed success never fallback to another financial reader',async()=>{
 for(const response of [{data:null,error:{code:'42501',message:'denied'},status:403},{data:null,error:{code:'PGRST202',message:'another function missing'},status:404},
  {data:null,error:{message:'network'},status:503},{data:[],error:null,status:200}]){
  let calls=0;assert.equal(await readCustomerStatementWithRpc('customer',1,async()=>{calls++;return response;}),null);assert.equal(calls,1);
  calls=0;assert.equal(await readReceiptWithRpc('token',async()=>{calls++;return response;}),response);assert.equal(calls,1);
 }
 await assert.rejects(readCustomerStatementWithRpc('customer',1,async()=>{throw Error('NETWORK');}),/NETWORK/);
 await assert.rejects(readReceiptWithRpc('token',async()=>{throw Error('NETWORK');}),/NETWORK/);
});
