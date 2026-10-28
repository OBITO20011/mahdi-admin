import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAftercare215Preview,aftercare215SuccessMatches} from '../src/utils/aftercare215Contracts';
const id=(n:number)=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const seal='a'.repeat(64),base={contractVersion:215,orderId:id(1),previewFingerprint:seal};
test('215 return preview keeps server debt-first amounts exact and requires complete issue state',()=>{
 const row={...base,canConfirm:true,issues:[],goodQuantity:1,badQuantity:0,customerDamageQuantity:0,
  entitlementInMinorUnits:'750',debtReductionInMinorUnits:'250',moneyRefundInMinorUnits:'500',refundMethod:'cash'};
 const p=parseAftercare215Preview('sealed_return',id(1),row,false);assert.equal(p.kind,'sealed_return');assert.equal(p.ownerValues,undefined);
 const missing=parseAftercare215Preview('sealed_return',id(1),{...row,refundMethod:null,canConfirm:false,issues:[{field:'refundMethod',code:'AFTERCARE215_REFUND_METHOD_REQUIRED'}]},false);
 assert.equal(missing.canConfirm,false);
 for(const bad of [{...row,moneyRefundInMinorUnits:500},{...row,moneyRefundInMinorUnits:'501'},{...row,orderId:id(2)},{...row,previewFingerprint:'bad'},{...row,refundMethod:null},{...row,canConfirm:false}])assert.throws(()=>parseAftercare215Preview('sealed_return',id(1),bad,false));
});
test('215 owner preview values require explicit owner scope and preserve fractional/large text',()=>{
 const row={...base,issuedQuantity:12,restockedQuantity:11,badQuantity:1,moneyDifferenceInMinorUnits:0,customerDebtDeltaInMinorUnits:0,
  issuedCostInMinorUnits:'9007199254740993',goodRecoveryInMinorUnits:'5500',supplierHeldInMinorUnits:'500',profitDeltaInMinorUnits:'-9007199254734993'};
 const p=parseAftercare215Preview('inspected_replacement',id(1),row,true);assert.equal(p.ownerValues?.issuedCostInMinorUnits,'9007199254740993');
 assert.throws(()=>parseAftercare215Preview('inspected_replacement',id(1),row,false));
 assert.throws(()=>parseAftercare215Preview('inspected_replacement',id(1),{...row,issuedCostInMinorUnits:6000},true));
 assert.throws(()=>parseAftercare215Preview('inspected_replacement',id(1),{...row,restockedQuantity:12},true));
});
test('215 exchange preview accepts unresolved method only with explicit issue and exact coverage',()=>{
 const row={...base,canConfirm:true,issues:[],goodQuantity:11,badQuantity:1,productId:id(7),productName:'بديل',baseQuantity:12,
  newTotalInMinorUnits:'12000',internalCreditInMinorUnits:'9000',differenceInMinorUnits:'3000',moneyReceivedInMinorUnits:'3000',moneyRefundInMinorUnits:'0',differenceMethod:'cash'};
 assert.equal(parseAftercare215Preview('exchange',id(1),row,false).kind,'exchange');
 const unresolved={...row,canConfirm:false,issues:[{field:'differenceMethod',code:'AFTERCARE215_DIFFERENCE_METHOD_REQUIRED'}],differenceMethod:null};
 assert.equal(parseAftercare215Preview('exchange',id(1),unresolved,false).canConfirm,false);
 for(const bad of [{...row,internalCreditInMinorUnits:'8000'},{...row,moneyRefundInMinorUnits:'100'},{...row,differenceInMinorUnits:'-3000'},{...row,differenceMethod:null}])assert.throws(()=>parseAftercare215Preview('exchange',id(1),bad,false));
});
test('215 durable success binds quantities and explicit refund method; cost fields never enter the saved result',()=>{
 const request={previewFingerprint:seal,payload:{orderId:id(1),refundMethod:'cash',physicalSources:[{quantity:12,sellable_restock_quantity:11,defect_non_sellable_quantity:1,customer_damage_quantity:0}]}};
 const result={success:true,contractVersion:215,operationId:id(2),returnOperationId:id(3),returnId:id(4),returnNumber:'SRT-LOCAL',orderId:id(1),
  entitlementInMinorUnits:'9000',debtReductionInMinorUnits:'0',moneyRefundInMinorUnits:'9000',refundMethod:'cash',goodQuantity:11,badQuantity:1,customerDamageQuantity:0};
 assert.equal(aftercare215SuccessMatches('sealed_return',id(1),request,result),true);
 for(const bad of [{...result,refundMethod:'cliq'},{...result,goodQuantity:12},{...result,moneyRefundInMinorUnits:9000},{...result,unitCost:'500'},{...result,profit:1}])assert.equal(aftercare215SuccessMatches('sealed_return',id(1),request,bad),false);
 assert.equal(aftercare215SuccessMatches('sealed_return',id(2),request,result),false);
 const replacement={success:true,contractVersion:215,operationId:id(2),orderId:id(1),replacementId:id(4),issuedQuantity:12,restockedQuantity:11,badQuantity:1,caseIds:[],moneyDifferenceInMinorUnits:0};
 const rr={previewFingerprint:seal,payload:{orderId:id(1),items:[{quantity:12,goodQuantity:11}]}};
 assert.equal(aftercare215SuccessMatches('inspected_replacement',id(1),rr,replacement),true);
 assert.equal(aftercare215SuccessMatches('inspected_replacement',id(1),rr,{...replacement,replacementCogsInMinorUnits:6000}),false);
});
