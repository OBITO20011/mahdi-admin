import test from 'node:test';
import assert from 'node:assert/strict';
import type {AdminAftercareModernContext} from '../src/services/supabase/salesAftercare.service';
import type {Order} from '../src/types';
import {trialDOrder} from '../e2e/trial-d-receipt.fixture';
import {buildWizard215,selectWizardPhysical215,physicalKey215,type WizardRequest215} from '../src/features/orders/aftercare215Draft';
const id=(n:number)=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const order:Order={...structuredClone(trialDOrder),id:id(1),items:[{...trialDOrder.items[0],id:id(2),productId:id(3),productName:'عصير تجريبي'}]};
const context:AdminAftercareModernContext={contractVersion:403,supported:true,capability:'phase43_modern',serverTime:'2026-10-28T10:00:00Z',
  order:{id:order.id,orderNumber:'POS-TEST',status:'completed',saleContract:'phase3_pos_v2',branchId:id(4),warehouseId:id(5),completedAt:'2026-10-28T09:00:00Z',deadlineAt:'2026-10-30T09:00:00Z',withinWindow:true},
  financial:{merchandiseDebtInMinorUnits:0,refundableCollectedInMinorUnits:9000,deliveryFeeInMinorUnits:0},baseItems:[{orderItemId:id(2),productId:id(3),quantity:12,remainingQuantity:12,commercialLineKind:'legacy_single_sku_parcel',unitsPerParcel:12,commercialQuantity:1,
    physicalRepresentatives:[{sourceKind:'base_order_item',sourceId:id(2),productId:id(3),remainingQuantity:12,parentReplacementItemId:null}]}],parcelInstances:[],returns:[],replacements:[]};
const input=():WizardRequest215=>({selection:{kind:'base',orderItemId:id(2),quantity:1,unit:'parcels'},inspection:{},intent:'replace',replacement:'same',destination:'final',supplierByProduct:{},ownerAllowed:true,
  reason:'فحص الراجع',notes:'',refundMethod:'cash',referenceNumber:'',productId:id(99),replacementKind:'legacy_single_sku_parcel',replacementQuantity:1,differenceMethod:'cash'});
test('215 parcel defaults all-good; 11 good/1 bad reaches inspected warranty without being changed to full damage',()=>{
  const before=structuredClone(context),draft=input(),physical=selectWizardPhysical215(order,context,draft.selection);
  const good=buildWizard215(order,context,draft);assert.equal(good.action,'inspected_replacement');if(good.action!=='inspected_replacement')throw Error('kind');
  assert.equal(good.payload.items[0].quantity,12);assert.equal(good.payload.items[0].goodQuantity,12);
  draft.inspection[physicalKey215(physical[0].source)]={bad:1,customerDamage:0};
  const result=buildWizard215(order,context,draft);if(result.action!=='inspected_replacement')throw Error('kind');assert.equal(result.payload.items[0].goodQuantity,11);
  assert.equal(JSON.stringify(result).includes('price'),false);assert.equal(JSON.stringify(result).includes('cost'),false);assert.deepEqual(context,before);
});
test('215 return keeps mixed physical buckets and server refund method without a manual monetary amount',()=>{
  const draft=input();draft.intent='refund';draft.refundMethod='cliq';draft.referenceNumber=' CL-TEST ';draft.inspection[`base_order_item:${id(2)}`]={bad:1,customerDamage:0};
  const result=buildWizard215(order,context,draft);if(result.action!=='sealed_return')throw Error('kind');
  assert.equal(result.payload.items[0].stock_disposition,'restock');assert.equal(result.payload.physicalSources[0].sellable_restock_quantity,11);assert.equal(result.payload.physicalSources[0].defect_non_sellable_quantity,1);
  assert.equal(result.payload.referenceNumber,'CL-TEST');assert.equal(result.payload.refundMethod,'cliq');assert.doesNotMatch(JSON.stringify(result.payload),/entitlement|moneyRefund|amountInMinor|unitPrice/);
});
test('215 supplier assignment applies only to bad selected physical leaves and is owner-only',()=>{
  const draft=input();draft.destination='supplier';draft.supplierByProduct[id(3)]=id(40);draft.inspection[`base_order_item:${id(2)}`]={bad:1,customerDamage:0};
  const result=buildWizard215(order,context,draft);if(result.action!=='inspected_replacement')throw Error('kind');assert.equal(result.payload.items[0].supplierId,id(40));
  draft.ownerAllowed=false;assert.throws(()=>buildWizard215(order,context,draft),/للمالك/);draft.ownerAllowed=true;draft.supplierByProduct={};assert.throws(()=>buildWizard215(order,context,draft),/عصير تجريبي.*المورد/);
  draft.destination='final';draft.intent='refund';const returned=buildWizard215(order,context,draft);if(returned.action!=='sealed_return')throw Error('kind');assert.deepEqual(returned.payload.supplierAssignments,[]);
});
test('215 packet out of a parcel remains defective-only same-SKU; no refund or cross-SKU admission',()=>{
  const draft=input();draft.selection={...draft.selection,kind:'base',orderItemId:id(2),unit:'packets',quantity:1};
  assert.throws(()=>buildWizard215(order,context,draft),/معيب فقط/);draft.inspection[`base_order_item:${id(2)}`]={bad:1,customerDamage:0};
  assert.equal(buildWizard215(order,context,draft).action,'inspected_replacement');draft.intent='refund';assert.throws(()=>buildWizard215(order,context,draft),/معيب فقط/);
  draft.intent='replace';draft.replacement='other';assert.throws(()=>buildWizard215(order,context,draft),/معيب فقط/);
});
test('215 formed parcel classifies every flavor independently and rejects an incomplete whole parcel',()=>{
  const ctx=structuredClone(context);ctx.baseItems=[];ctx.parcelInstances=[{parcelInstanceId:id(20),orderItemId:id(2),components:[
    {parcelComponentId:id(21),productId:id(31),quantity:5,physicalRepresentatives:[{sourceKind:'parcel_component',sourceId:id(21),productId:id(31),remainingQuantity:5,parentReplacementItemId:null}]},
    {parcelComponentId:id(22),productId:id(32),quantity:1,physicalRepresentatives:[{sourceKind:'parcel_component',sourceId:id(22),productId:id(32),remainingQuantity:1,parentReplacementItemId:null}]}]}];
  const draft=input();draft.selection={kind:'formed',parcelInstanceId:id(20),quantity:1};draft.inspection[`parcel_component:${id(21)}`]={bad:1,customerDamage:0};
  const result=buildWizard215(order,ctx,draft);if(result.action!=='inspected_replacement')throw Error('kind');assert.deepEqual(result.payload.items.map(i=>[i.quantity,i.goodQuantity]),[[5,4],[1,1]]);
  draft.intent='refund';const returned=buildWizard215(order,ctx,draft);if(returned.action!=='sealed_return')throw Error('kind');assert.equal(returned.payload.items[0].components?.[0].accepted_quantity,5);
  assert.equal(returned.payload.physicalSources[0].sellable_restock_quantity,4);ctx.parcelInstances[0].components[0].physicalRepresentatives[0].remainingQuantity=4;assert.throws(()=>buildWizard215(order,ctx,draft),/لم يعد الطرد كاملاً/);
});
test('215 cross-SKU request is one sealed exchange, never a fabricated cash return plus cash sale',()=>{
  const draft=input();draft.replacement='other';draft.differenceMethod='cliq';draft.referenceNumber='DX';
  const result=buildWizard215(order,context,draft);if(result.action!=='exchange')throw Error('kind');assert.equal(result.payload.returnRequest.refundMethod,'auto');assert.equal(result.payload.returnRequest.referenceNumber,null);
  assert.deepEqual(result.payload.replacement,{productId:id(99),kind:'legacy_single_sku_parcel',quantity:1});assert.equal(result.payload.referenceNumber,'DX');assert.doesNotMatch(JSON.stringify(result.payload),/cashAmount|newTotal|internalCredit|cogs/);
  draft.replacementQuantity=0;assert.throws(()=>buildWizard215(order,context,draft),/كمية البديل/);
});
test('215 named piece validation rejects missing totals and never mutates a historical source',()=>{
  const draft=input();draft.inspection[`base_order_item:${id(2)}`]={bad:13,customerDamage:0};assert.throws(()=>buildWizard215(order,context,draft),/عصير تجريبي.*12/);
  draft.inspection[`base_order_item:${id(2)}`]={bad:1,customerDamage:1};assert.throws(()=>buildWizard215(order,context,draft),/ضرر الزبون/);draft.reason=' ';assert.throws(()=>buildWizard215(order,context,draft),/سبب العملية/);
});
