import assert from 'node:assert/strict';
import test from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import {assertAftercare215Request,invokeAftercare215} from '../src/services/supabase/aftercare215Rpc';
import {aftercare215SuccessMatches} from '../src/utils/aftercare215Contracts';
import {orderTracksAccounting,parseSalesOnlyOrderDetails} from '../src/services/supabase/salesOnlyOrderContext';
const id=(n:number)=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('order tracking requires matching FK evidence;unknown joined identity cannot impersonate full',()=>{
 assert.equal(orderTracksAccounting({operation_id:null}),true);
 for(const type of ['lite1_guest','lite1_pos'])assert.equal(orderTracksAccounting({operation_id:id(1),creation_operation:{id:id(1),operation_type:type}}),false);
 assert.equal(orderTracksAccounting({operation_id:id(1),creation_operation:{id:id(1),operation_type:'phase3_pos_sale_v1'}}),true);
 for(const creation_operation of [null,{},[],{id:id(2),operation_type:'phase3_pos_sale_v1'},{id:id(1),operation_type:null}])assert.throws(()=>orderTracksAccounting({operation_id:id(1),creation_operation}),/UNVERIFIED/);
});
test('order details use canonical due and explicit safe proposal projection;no unknown payload fields propagate',()=>{
 const value={contractVersion:'lite2-order-details-v1',orderId:id(1),accountingTracked:false,amountPaidInMinorUnits:500,amountDueInMinorUnits:1000,
  recipientProposal:{proposed:true,recipient:{fullName:'مستلم',governorate:'إربد',city:'الرمثا',area:'حي',street:'شارع',building:null,addressNotes:null,token:'excluded'},customerCard:{fullName:'اسم البطاقة',governorate:'إربد',defaultAddress:null,phone:'excluded'}}};
 const actual=parseSalesOnlyOrderDetails(value,id(1));assert.equal(actual.amountPaid,0.5);assert.equal(actual.amountDue,1);assert.equal(actual.recipientProposal?.recipient.fullName,'مستلم');assert.doesNotMatch(JSON.stringify(actual),/token|phone|excluded/);
 assert.deepEqual(parseSalesOnlyOrderDetails({...value,recipientProposal:{...value.recipientProposal,recipient:{...value.recipientProposal.recipient,building:'',addressNotes:''}}},id(1)),actual);
 assert.equal(parseSalesOnlyOrderDetails({...value,recipientProposal:{...value.recipientProposal,customerCard:{...value.recipientProposal.customerCard,governorate:null}}},id(1)).recipientProposal?.customerCard.governorate,null);
 assert.throws(()=>parseSalesOnlyOrderDetails({...value,recipientProposal:{...value.recipientProposal,customerCard:{...value.recipientProposal.customerCard,governorate:42}}},id(1)),/UNVERIFIED/);
 for(const patch of [{accountingTracked:true},{orderId:id(2)},{amountDueInMinorUnits:-1},{amountPaidInMinorUnits:'500'}])assert.throws(()=>parseSalesOnlyOrderDetails({...value,...patch},id(1)),/UNVERIFIED/);
});
test('existing aftercare adapter captures lite route/seal/key;full names remain exact;lite exchange/supplier route is not inferred',async()=>{
 const payload={orderId:id(1),physicalSources:[{quantity:1,sellable_restock_quantity:1,defect_non_sellable_quantity:0,customer_damage_quantity:0}],refundMethod:'cash'};
 const request={payload,previewFingerprint:'a'.repeat(64),accountingMode:'sales-only'};
 const result={success:true,accountingTracked:false,contractVersion:215,orderId:id(1),operationId:id(2),returnOperationId:id(2),returnId:id(3),returnNumber:'L2R-LOCAL',entitlementInMinorUnits:'1000',debtReductionInMinorUnits:'0',moneyRefundInMinorUnits:'1000',goodQuantity:1,badQuantity:0,customerDamageQuantity:0,refundMethod:'cash'};
 const calls:unknown[]=[],client={rpc:async(name:string,args:Record<string,unknown>)=>{calls.push([name,args]);return {data:result,error:null};}} as unknown as SupabaseClient;
 await invokeAftercare215(client,'sealed_return',id(1),'same-key',request);
 assert.deepEqual(calls,[['lite1_settle_return2',{p_payload:payload,p_key:'same-key',p_preview:'a'.repeat(64)}]]);
 assert.equal(aftercare215SuccessMatches('sealed_return',id(1),request,result),true);
 assert.equal(aftercare215SuccessMatches('sealed_return',id(1),{payload,previewFingerprint:request.previewFingerprint},result),false);
 assert.equal(aftercare215SuccessMatches('sealed_return',id(1),request,{...result,accountingTracked:true}),false);
 assert.throws(()=>assertAftercare215Request('exchange',id(1),request),/REVIEW_REQUIRED/);
 assert.throws(()=>assertAftercare215Request('sealed_return',id(1),{...request,accountingMode:'other'}),/REVIEW_REQUIRED/);
 assert.throws(()=>assertAftercare215Request('sealed_return',id(1),{...request,payload:{...payload,orderId:id(2)}}),/REVIEW_REQUIRED/);
 calls.length=0;await invokeAftercare215(client,'sealed_return',id(1),'same-key',{payload,previewFingerprint:request.previewFingerprint});
 assert.deepEqual(calls,[['settle_admin_sales_return_v2',{p_payload:payload,p_idempotency_key:'same-key',p_preview_fingerprint:request.previewFingerprint}]]);
});
