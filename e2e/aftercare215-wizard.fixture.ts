import type {Order} from '../src/types';
import type {AdminAftercareModernContext} from '../src/services/supabase/salesAftercare.service';
import {trialDOrder} from './trial-d-receipt.fixture';
const id=(n:number)=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const wizard215Order:Order={...structuredClone(trialDOrder),id:id(1),orderNumber:'POS-TEST-215',branchId:id(4),items:[{...trialDOrder.items[0],id:id(2),productId:id(3),productName:'عصير تجريبي',quantity:1,baseQuantity:12,unitsPerSalePackage:12,unitPrice:9,totalPrice:9}],subtotal:9,totalAmount:9,discount:0,deliveryFee:0,amountPaid:9,amountDue:0};
export const wizard215Context:AdminAftercareModernContext={contractVersion:403,supported:true,capability:'phase43_modern',serverTime:'2026-10-28T10:00:00Z',
  order:{id:id(1),orderNumber:'POS-TEST-215',status:'completed',saleContract:'phase3_pos_v2',branchId:id(4),warehouseId:id(5),completedAt:'2026-10-28T09:00:00Z',deadlineAt:'2026-10-30T09:00:00Z',withinWindow:true},
  financial:{merchandiseDebtInMinorUnits:0,refundableCollectedInMinorUnits:9000,deliveryFeeInMinorUnits:0},baseItems:[{orderItemId:id(2),productId:id(3),quantity:12,remainingQuantity:12,commercialLineKind:'legacy_single_sku_parcel',unitsPerParcel:12,commercialQuantity:1,
    physicalRepresentatives:[{sourceKind:'base_order_item',sourceId:id(2),productId:id(3),remainingQuantity:12,parentReplacementItemId:null}]}],parcelInstances:[],returns:[],replacements:[]};

/** Synthetic scenarios only; no auth session or hosted data. */
export function wizard215Scenario(name:string){
  const order=structuredClone(wizard215Order),context=structuredClone(wizard215Context);
  if(name==='cliq')order.paymentMethod='cliq';
  if(name==='debt'||name==='collected-debt'){
    order.paymentMethod='debt';order.amountPaid=name==='debt'?0:9;order.amountDue=name==='debt'?9:0;
    context.financial.merchandiseDebtInMinorUnits=name==='debt'?9000:0;context.financial.refundableCollectedInMinorUnits=name==='debt'?0:9000;
  }
  if(name==='formed'||name==='formed-prior'){
    order.items=[{...order.items[0],commercialLineKind:'configurable_parcel',baseQuantity:6,parcelInstances:[{id:id(20),sequence:1,unitName:'طرد',components:[
      {id:id(21),productId:id(31),name:'توت',sku:'TEST-BERRY',unitName:'قنينة',quantity:5},
      {id:id(22),productId:id(32),name:'برتقال',sku:'TEST-ORANGE',unitName:'قنينة',quantity:1}]}]}];
    context.baseItems=[];context.parcelInstances=[{parcelInstanceId:id(20),orderItemId:id(2),components:[
      {parcelComponentId:id(21),productId:id(31),quantity:5,physicalRepresentatives:[{sourceKind:'parcel_component',sourceId:id(21),productId:id(31),remainingQuantity:5,parentReplacementItemId:null}]},
      {parcelComponentId:id(22),productId:id(32),quantity:1,physicalRepresentatives:[{sourceKind:'parcel_component',sourceId:id(22),productId:id(32),remainingQuantity:1,parentReplacementItemId:null}]}]}];
  }
  if(name==='prior-leaf'){
    context.baseItems[0].physicalRepresentatives=[{sourceKind:'base_order_item',sourceId:id(2),productId:id(3),remainingQuantity:10,parentReplacementItemId:null},
      {sourceKind:'replacement_item',sourceId:id(23),productId:id(3),remainingQuantity:2,parentReplacementItemId:null}];
    context.replacements=[{operationalStatus:'issued',issuedAt:'2026-10-28T09:30:00Z',items:[{rootOrderItemId:id(2),rootParcelComponentId:null,replacementItemId:id(23),parentReplacementItemId:null}]}];
  }
  if(name==='formed-prior'){const component=context.parcelInstances[0].components[0];component.physicalRepresentatives[0].remainingQuantity=4;component.physicalRepresentatives.push({sourceKind:'replacement_item',sourceId:id(90),productId:component.productId,remainingQuantity:1,parentReplacementItemId:null});}
  return{order,context};
}
