import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import type {SupabaseClient} from '@supabase/supabase-js';
import {submitPosSaleV2WithRpc,type CreatePosSaleV2Input} from '../src/services/supabase/posV2.service';
import {posV2RequestValid,posV2ResultMatches} from '../src/services/supabase/posV2Validation';
import {runPosV2Attempt,readPosV2Recovery} from '../src/services/supabase/posV2Recovery';
import {initialPaymentText216} from '../src/features/pos/partialPayment216';
import {posV2Invoice} from '../src/features/pos/posV2Cart';import {invoiceReceipt} from '../src/features/receipts/saleReceipt';
import {ReceiptDocument} from '../customer-web/src/receipts/ReceiptDocument';import {receiptDocumentShareText} from '../customer-web/src/receipts/commercialReceipt';
import {publicReceiptDocument} from '../customer-web/src/receipts/publicReceipt';
const id=(n:number)=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const input=():CreatePosSaleV2Input=>({warehouseId:id(1),branchId:id(2),customerId:id(3),customerName:'عميل اختبار',paymentMethod:'debt',
 lines:[{commercial_line_kind:'base_unit',product_id:id(4),base_quantity:1}],discountInMinorUnits:0,amountReceivedInMinorUnits:0,idempotencyKey:'pos216-local-request',
 initialPayment:{amountInMinorUnits:60000,method:'cash',referenceNumber:'ORIGINAL'}});
const result=()=>({success:true,operationId:id(5),orderId:id(6),orderNumber:'POS-216-LOCAL',warehouseId:id(1),branchId:id(2),customerName:'عميل اختبار',
 idempotentReplay:false,subtotalInMinorUnits:100000,discountInMinorUnits:0,totalInMinorUnits:100000,amountPaidInMinorUnits:60000,remainingInMinorUnits:40000,
 initialPaymentMethod:'cash' as 'cash'|'cliq',initialPaymentId:id(7),changeDueInMinorUnits:0,paymentMethod:'debt' as const,paymentStatus:'partially_paid' as const,
 items:[{id:id(8),productId:id(4),productName:'صنف اختبار',sku:'LOCAL216',salePackage:'باكيت',commercialLineKind:'base_unit',quantity:1,baseQuantity:1,unitsPerSalePackage:1,
 unitPriceInMinorUnits:100000,lineTotalInMinorUnits:100000,allocatedDiscountInMinorUnits:0,netRefundableAmountInMinorUnits:100000,cogsInMinorUnits:500,profitInMinorUnits:99500,parcelInstances:[]}]});

test('216 decimal text is exact, supports Arabic/Persian digits and rejects rounding or unsafe amounts',()=>{
 for(const [text,minor] of [['60.001',60001],['٦٠٫٠٠١',60001],['۶۰.۰۰۱',60001],['0',0],['',0],['0001.2',1200]] as const)assert.equal(initialPaymentText216(text),minor);
 for(const text of ['0.0001','-1','1e3','1,000','NaN','9007199254741.992'])assert.throws(()=>initialPaymentText216(text));
});
test('216 partial sale uses one atomic RPC binding paid/method/reference; old full credit still uses the exact old nine arguments',async()=>{
 for(const method of ['cash','cliq'] as const){
  const request=input();request.initialPayment!.method=method;let calls=0;
  const outcome=await submitPosSaleV2WithRpc(request,async(name,params)=>{calls++;assert.equal(name,'create_pos_sale_with_initial_payment_v1');assert.deepEqual(params,{
   p_warehouse_id:id(1),p_branch_id:id(2),p_customer_id:id(3),p_customer_name:'عميل اختبار',p_lines:request.lines,p_discount_in_minor_units:0,
   p_initial_paid_in_minor_units:60000,p_initial_payment_method:method,p_reference_number:'ORIGINAL',p_idempotency_key:request.idempotencyKey,
  });return {data:{...result(),initialPaymentMethod:method},error:null};});
  assert.equal(calls,1);assert.equal(outcome.ok,true);
 }
 const legacy=input();delete legacy.initialPayment;
 const outcome=await submitPosSaleV2WithRpc(legacy,async(name,params)=>{assert.equal(name,'create_pos_sale_v2');assert.equal(Object.keys(params).length,9);assert.equal(params.p_amount_received_in_minor_units,0);return {data:{...result(),amountPaidInMinorUnits:0,paymentStatus:'unpaid'},error:null};});assert.equal(outcome.ok,true);
});
test('216 validation binds the exact partial amount, method, receipt identity and due, without admitting it as a legacy debt response',()=>{
 assert.equal(posV2ResultMatches(input(),result()),true);
 for(const changed of [{amountPaidInMinorUnits:59999},{remainingInMinorUnits:40001},{initialPaymentMethod:'cliq'},{initialPaymentId:null},{paymentStatus:'paid'},{totalInMinorUnits:60000}])assert.equal(posV2ResultMatches(input(),{...result(),...changed}),false);
 const old=input();delete old.initialPayment;assert.equal(posV2ResultMatches(old,result()),false);
 for(const changed of [{customerId:undefined},{paymentMethod:'cash'},{amountReceivedInMinorUnits:60000},{initialPayment:{amountInMinorUnits:0,method:'cash'}},{initialPayment:{amountInMinorUnits:1,method:'cheque'}},{initialPayment:{amountInMinorUnits:1,method:'cash',referenceNumber:42}}])assert.equal(posV2RequestValid({...input(),...changed}),false);
});
test('216 malformed partial intent never falls through to a legacy full-debt write',async()=>{
 for(const initialPayment of [null,{amountInMinorUnits:0,method:'cash'},{amountInMinorUnits:60000,method:'cheque'},{amountInMinorUnits:60000,method:'cash',referenceNumber:42}]){
  let calls=0;const outcome=await submitPosSaleV2WithRpc({...input(),initialPayment} as CreatePosSaleV2Input,async()=>{calls++;return {data:null,error:null};});
  assert.equal(calls,0);assert.equal(outcome.ok,false);if(!outcome.ok)assert.equal(outcome.errorIdentity,'POS216_INITIAL_PAYMENT_INVALID');
 }
});
test('216 lost reply and reload reuse the captured paid/method/reference and key; tampering and another START_NEW fail closed',async()=>{
 const storage=new Map<string,string>();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)}});
 let chain=Promise.resolve();Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:(_key:string,_options:unknown,work:()=>Promise<unknown>)=>{const pending=chain.then(work);chain=pending.then(()=>undefined,()=>undefined);return pending;}}}});
 let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});let auths=0;const requests:Record<string,unknown>[]=[];
 const client={auth:{getUser:async()=>{if(++auths===1)await wait;return {data:{user:{id:id(50)}},error:null};}},rpc:async(name:string,params:Record<string,unknown>)=>{
  assert.equal(name,'create_pos_sale_with_initial_payment_v1');requests.push(structuredClone(params));return requests.length===1?{data:null,error:{message:'network timeout'}}:{data:{...result(),idempotentReplay:true},error:null};
 }} as unknown as SupabaseClient;
 const request=input(),pending=runPosV2Attempt(client,id(50),'START_NEW',request);request.initialPayment!.amountInMinorUnits=1;request.initialPayment!.method='cliq';request.initialPayment!.referenceNumber='CHANGED';release();
 assert.equal((await pending).ok,false);assert.equal(readPosV2Recovery(id(50))?.status,'OUTCOME_UNKNOWN');await assert.rejects(runPosV2Attempt(client,id(50),'START_NEW',input()));
 assert.equal((await runPosV2Attempt(client,id(50),'RECOVER_EXISTING')).ok,true);assert.deepEqual(requests[0],requests[1]);assert.equal(requests[0].p_initial_paid_in_minor_units,60000);assert.equal(requests[0].p_initial_payment_method,'cash');assert.equal(requests[0].p_reference_number,'ORIGINAL');
 const key=[...storage.keys()][0],saved=JSON.parse(storage.get(key)!);saved.request.initialPayment.referenceNumber='FORGED';storage.set(key,JSON.stringify(saved));await assert.rejects(runPosV2Attempt(client,id(50),'RECOVER_EXISTING'));assert.equal(requests.length,2);
});
test('216 POS/print/PDF/shared template and public receipt explicitly display paid60/due40; exchange credit stays separate',()=>{
 const sale=result(),invoice=posV2Invoice(sale,{id:id(50),name:'اختبار'},'2026-10-29T10:00:00Z'),receipt=invoiceReceipt(invoice);
 assert.equal(invoice.paidAmount,60);assert.equal(invoice.remainingAmount,40);assert.equal(receipt.paidInMinorUnits,60000);assert.equal(receipt.remainingInMinorUnits,40000);
 const html=renderToStaticMarkup(React.createElement(ReceiptDocument,{receipt})),text=receiptDocumentShareText(receipt);
 for(const value of ['المدفوع','60.000','الباقي على الحساب','40.000','دفعة كاش']){assert.ok(html.includes(value));assert.ok(text.includes(value));}
 const publicReceipt=publicReceiptDocument({orderNumber:sale.orderNumber,createdAt:'2026-10-29T10:00:00Z',status:'completed',paymentMethod:'debt',paymentStatus:'partially_paid',subtotalInMinorUnits:100000,discountInMinorUnits:0,totalInMinorUnits:100000,amountPaidInMinorUnits:60000,remainingInMinorUnits:40000,initialPaymentMethod:'cash',branch:{name:'اختبار',address:'',phone:''},items:[]});
 assert.equal(publicReceipt.paidInMinorUnits,receipt.paidInMinorUnits);assert.equal(publicReceipt.remainingInMinorUnits,receipt.remainingInMinorUnits);
});
