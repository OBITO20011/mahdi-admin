import test from 'node:test';
import assert from 'node:assert/strict';
import {supplierCreditRequest215,parseSupplierCreditPreview215,parseSupplierCreditResult215,parseSupplierCreditPage215} from '../src/utils/supplierCredit215';
import {prepareReplacementAttempt,markReplacementAttempt,readReplacementAttempt} from '../src/services/supabase/supplierReplacementIntent';
import {installAftercareIndexedDbFixture} from './helpers/aftercareIndexedDb';
const id=(n:number)=>`92800000-0000-4000-8000-${String(n).padStart(12,'0')}`,seal='b'.repeat(64),payload={caseId:id(1),quantity:2,reason:'وافق المورد على الخصم'};
const preview={contractVersion:215,action:'credit',caseId:id(1),supplierId:id(2),productId:id(3),quantity:2,amountDeltaInMinorUnits:'1000',balanceBeforeInMinorUnits:'50000',balanceAfterInMinorUnits:'49000',previewFingerprint:seal,reversesEventId:null};
const result={success:true,contractVersion:215,operationId:id(4),idempotentReplay:false,credit:{event_id:id(5),operation_id:id(4),case_id:id(1),supplier_id:id(2),amount_delta_in_minor_units:'1000',balance_before_in_minor_units:'50000',balance_after_in_minor_units:'49000',reverses_credit_event_id:null,created_at:'2026-10-28T09:00:00Z',created_by:id(9)}};
test('215 supplier credit persists only request and seal, excluding preview amounts or hidden owner values',()=>{
  const request={...payload,previewFingerprint:seal};assert.deepEqual(supplierCreditRequest215('credit',request),{payload,previewFingerprint:seal});
  for(const key of ['amountDeltaInMinorUnits','ownerValues','balanceAfterInMinorUnits','unitCost'])assert.throws(()=>supplierCreditRequest215('credit',{...request,[key]:'500'}));
  for(const bad of [{...request,quantity:0},{...request,caseId:'x'},{...request,previewFingerprint:'x'},{...request,reason:' '}])assert.throws(()=>supplierCreditRequest215('credit',bad));
});
test('215 preview binds action/case/quantity and exact historical credit to both payable snapshots',()=>{
  assert.equal(parseSupplierCreditPreview215('credit',payload,preview).balanceAfterInMinorUnits,'49000');
  for(const patch of [{caseId:id(99)},{quantity:3},{balanceAfterInMinorUnits:'49001'},{amountDeltaInMinorUnits:1000},{amountDeltaInMinorUnits:'-1000',balanceAfterInMinorUnits:'51000'}])assert.throws(()=>parseSupplierCreditPreview215('credit',payload,{...preview,...patch}));
  const big={...preview,amountDeltaInMinorUnits:'9007199254740993',balanceBeforeInMinorUnits:'9007199254741000',balanceAfterInMinorUnits:'7'};assert.equal(parseSupplierCreditPreview215('credit',payload,big).amountDeltaInMinorUnits,'9007199254740993');
  const inverse={...preview,action:'reverse_credit',amountDeltaInMinorUnits:'-1000',balanceBeforeInMinorUnits:'49000',balanceAfterInMinorUnits:'50000',reversesEventId:id(5)};
  assert.equal(parseSupplierCreditPreview215('reverse_credit',{eventId:id(5),reason:'عكس القرار'},inverse).balanceAfterInMinorUnits,'50000');assert.throws(()=>parseSupplierCreditPreview215('reverse_credit',{eventId:id(99)},inverse));
});
test('215 settled credit result validates actor/operation/request and paired inverse without exposing private manifest',()=>{
  const request={...payload,previewFingerprint:seal};const parsed=parseSupplierCreditResult215('credit',request,id(9),result);assert.equal(parsed.recovered,false);assert.equal(parsed.credit.amountDeltaInMinorUnits,'1000');
  assert.equal(JSON.stringify(parsed).includes('created_by'),false);assert.equal(JSON.stringify(parsed).includes('financial_membership'),false);
  for(const patch of [{created_by:id(8)},{case_id:id(99)},{operation_id:id(99)},{balance_after_in_minor_units:'49001'},{amount_delta_in_minor_units:1000}])assert.throws(()=>parseSupplierCreditResult215('credit',request,id(9),{...result,credit:{...result.credit,...patch}}));
  const reversed={...result,idempotentReplay:true,credit:{...result.credit,amount_delta_in_minor_units:'-1000',balance_before_in_minor_units:'49000',balance_after_in_minor_units:'50000',reverses_credit_event_id:id(70)}};
  assert.equal(parseSupplierCreditResult215('reverse_credit',{eventId:id(70),reason:'عكس القرار',previewFingerprint:seal},id(9),reversed).recovered,true);
});
test('215 supplier statement preserves signed exact before/after entries and rejects contradictory rows',()=>{
  const row={...result.credit,reason:payload.reason,product_name:'صنف تجريبي'},page={contractVersion:215,page:1,pageSize:25,totalCount:1,rows:[row]};assert.equal(parseSupplierCreditPage215(page).rows[0].amountDeltaInMinorUnits,'1000');
  assert.throws(()=>parseSupplierCreditPage215({...page,totalCount:2}));assert.throws(()=>parseSupplierCreditPage215({...page,rows:[{...row,balance_after_in_minor_units:'49001'}]}));
  const inverse={...row,amount_delta_in_minor_units:'-1000',balance_before_in_minor_units:'49000',balance_after_in_minor_units:'50000',reverses_credit_event_id:id(70)};assert.equal(parseSupplierCreditPage215({...page,rows:[inverse]}).rows[0].reversesEventId,id(70));
});
test('215 credit and old supplier receipt share one durable pending intent; retries keep the same key',async()=>{
  const restore=installAftercareIndexedDbFixture();try{
    const scope='supplier-replacement208:panel',request={...payload,previewFingerprint:seal},mutable=structuredClone(request);
    const prepared=prepareReplacementAttempt(id(9),scope,'credit',mutable,null);mutable.quantity=99;const attempt=await prepared;assert.equal(attempt.payload.quantity,2);
    await markReplacementAttempt(attempt,'unknown');await assert.rejects(prepareReplacementAttempt(id(9),scope,'receive',{caseId:id(1),quantity:2,reason:'وصل البديل'},attempt.nonce),/غير محسومة/);
    const recovered=await prepareReplacementAttempt(id(9),scope,'credit',request,attempt.nonce);assert.equal(recovered.key,attempt.key);assert.deepEqual(recovered.payload,request);
    await markReplacementAttempt(recovered,'succeeded');const next=await prepareReplacementAttempt(id(9),scope,'receive',{caseId:id(1),quantity:1,reason:'وصل البديل'},attempt.nonce);assert.notEqual(next.key,attempt.key);
    assert.equal((await readReplacementAttempt(id(9),scope))?.action,'receive');
  }finally{restore();}
});
