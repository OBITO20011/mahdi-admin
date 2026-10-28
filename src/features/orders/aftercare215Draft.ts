import type {Order} from '../../types';
import type {AdminAftercareModernContext,ReturnPhysicalSource,ReturnRequestItem} from '../../services/supabase/salesAftercare.service';
import type {Aftercare215Payloads} from '../../utils/aftercare215Contracts';
import {allocateBaseReturn,singleSkuPhysicalQuantity} from './aftercarePresentation';

export type WizardSelection215={kind:'base';orderItemId:string;quantity:number;unit:'parcels'|'packets'}
  |{kind:'formed';parcelInstanceId:string;componentId?:string;quantity:number};
export interface WizardPhysical215 {name:string;source:ReturnPhysicalSource;original:boolean}
export type WizardInspection215=Record<string,{bad:number;customerDamage:number}>;
export const physicalKey215=(source:ReturnPhysicalSource)=>`${source.source_kind}:${source.source_id}`;
const positive=(q:number,name:string)=>{if(!Number.isSafeInteger(q)||q<1)throw new Error(`${name}: اختر عدداً صحيحاً أكبر من صفر.`);return q;};
const baseName=(order:Order,id:string)=>order.items.find(i=>i.id===id)?.productName||'الصنف';
const componentName=(order:Order,id:string)=>order.items.flatMap(i=>i.parcelInstances??[]).flatMap(p=>p.components).find(c=>c.id===id)?.name||'نكهة الطرد';

/** Quantities and source identities only. Price/cost/refund are never inferred. */
export function selectWizardPhysical215(order:Order,context:AdminAftercareModernContext,selection:WizardSelection215):WizardPhysical215[]{
  if(selection.kind==='base'){
    const item=context.baseItems.find(i=>i.orderItemId===selection.orderItemId);if(!item)throw new Error('تغيّر سطر الفاتورة؛ أعد فتحها.');
    const quantity=selection.unit==='parcels'?singleSkuPhysicalQuantity(selection.quantity,item.unitsPerParcel??0):positive(selection.quantity,'عدد الباكيتات');
    if(selection.unit==='parcels'&&item.commercialLineKind!=='legacy_single_sku_parcel')throw new Error('هذا السطر باكيتات مستقلة في الفاتورة.');
    return allocateBaseReturn(item.orderItemId,item.physicalRepresentatives,quantity,'restock',context.replacements,context.order.completedAt)
      .map(source=>({name:baseName(order,item.orderItemId),source,original:source.source_kind==='base_order_item'}));
  }
  const parcel=context.parcelInstances.find(p=>p.parcelInstanceId===selection.parcelInstanceId);if(!parcel)throw new Error('تغيّر الطرد المشكّل؛ أعد فتح الفاتورة.');
  const components=selection.componentId?parcel.components.filter(c=>c.parcelComponentId===selection.componentId):parcel.components;
  if(!components.length||!selection.componentId&&selection.quantity!==1)throw new Error('اختر طرداً مشكّلاً محفوظاً واحداً.');
  return components.flatMap(component=>{
    const available=component.physicalRepresentatives.reduce((sum,s)=>sum+s.remainingQuantity,0),name=componentName(order,component.parcelComponentId);
    let remaining=selection.componentId?positive(selection.quantity,name):component.quantity;
    if(remaining>available||!selection.componentId&&available!==component.quantity)throw new Error(`${name}: لم يعد الطرد كاملاً؛ بدّل المعيب المتبقي فقط.`);
    // A partial flavor replacement is defective-only. Show each physical leaf
    // separately so the inspection cannot assign a cost by guessing a SKU.
    return [...component.physicalRepresentatives].sort((a,b)=>(a.sourceKind==='parcel_component'?0:1)-(b.sourceKind==='parcel_component'?0:1)||a.sourceId.localeCompare(b.sourceId))
      .flatMap(leaf=>{const quantity=Math.min(remaining,leaf.remainingQuantity);remaining-=quantity;if(!quantity)return[];
        const source:ReturnPhysicalSource={root_source_kind:'parcel_component',root_source_id:component.parcelComponentId,source_kind:leaf.sourceKind,source_id:leaf.sourceId,product_id:leaf.productId,
          quantity,sellable_restock_quantity:quantity,defect_non_sellable_quantity:0,customer_damage_quantity:0};
        return[{name,source,original:leaf.sourceKind==='parcel_component'}];});
  });
}
export function inspectWizardPhysical215(physical:readonly WizardPhysical215[],inspection:WizardInspection215):WizardPhysical215[]{
  if(!physical.length)throw new Error('اختر ما رجع من الزبون.');
  return physical.map(leaf=>{
    const value=inspection[physicalKey215(leaf.source)]??{bad:0,customerDamage:0};
    if(!Number.isSafeInteger(value.bad)||!Number.isSafeInteger(value.customerDamage)||value.bad<0||value.customerDamage<0||value.bad+value.customerDamage>leaf.source.quantity)
      throw new Error(`${leaf.name}: الخربان وضرر الزبون معاً يجب أن يكونا بين 0 و${leaf.source.quantity} باكيت.`);
    return{...leaf,source:{...leaf.source,sellable_restock_quantity:leaf.source.quantity-value.bad-value.customerDamage,
      defect_non_sellable_quantity:value.bad,customer_damage_quantity:value.customerDamage}};
  });
}
export interface WizardRequest215 {
  selection:WizardSelection215;inspection:WizardInspection215;intent:'refund'|'replace';replacement:'same'|'other';
  supplierByProduct:Record<string,string>;destination:'final'|'supplier';ownerAllowed:boolean;reason:string;notes:string;
  refundMethod:'auto'|'cash'|'cliq'|'debt';referenceNumber:string;productId:string;replacementKind:'base_unit'|'legacy_single_sku_parcel';replacementQuantity:number;
  differenceMethod:'cash'|'cliq'|null;
}
export type BuiltWizard215={action:'sealed_return';payload:Aftercare215Payloads['sealed_return']}
  |{action:'inspected_replacement';payload:Aftercare215Payloads['inspected_replacement']}
  |{action:'exchange';payload:Aftercare215Payloads['exchange']};
export function buildWizard215(order:Order,context:AdminAftercareModernContext,input:WizardRequest215):BuiltWizard215{
  const selection=input.selection;
  const physical=inspectWizardPhysical215(selectWizardPhysical215(order,context,selection),input.inspection),sources=physical.map(v=>v.source);
  const bad=sources.reduce((s,x)=>s+x.defect_non_sellable_quantity,0),damage=sources.reduce((s,x)=>s+x.customer_damage_quantity,0);
  const reason=input.reason.trim(),notes=input.notes.trim()||null;if(reason.length<3)throw new Error('سبب العملية: اكتب ثلاثة أحرف على الأقل.');
  const assignments:Aftercare215Payloads['sealed_return']['supplierAssignments']=[];
  if(bad&&input.destination==='supplier'){
    if(!input.ownerAllowed)throw new Error('إرسال المعيب للمورد متاح للمالك فقط.');
    for(const leaf of physical.filter(x=>x.source.defect_non_sellable_quantity>0)){
      const supplierId=input.supplierByProduct[leaf.source.product_id];if(!supplierId)throw new Error(`${leaf.name}: اختر المورد للباكيتات المعيبة.`);
      assignments.push({sourceKind:leaf.source.source_kind,sourceId:leaf.source.source_id,supplierId});
    }
  }
  const base=selection.kind==='base'?context.baseItems.find(i=>i.orderItemId===selection.orderItemId):undefined;
  const partial= selection.kind==='formed'?Boolean(selection.componentId):base?.commercialLineKind==='legacy_single_sku_parcel'&&selection.unit==='packets';
  if(partial&&(input.intent!=='replace'||input.replacement!=='same'||sources.some(s=>s.defect_non_sellable_quantity!==s.quantity)))
    throw new Error('الباكيت من الطرد تبديل معيب فقط بنفس الصنف؛ لاسترداد المال اختر الطرد كاملاً.');
  if(input.intent==='replace'&&input.replacement==='same'){
    if(damage)throw new Error('ضرر الزبون له مسار مرتجع مفحوص في الخيارات المتقدمة؛ لا يُعامل كعيب ضمان.');
    return{action:'inspected_replacement',payload:{orderId:order.id,reason,notes,items:sources.map(source=>({sourceKind:source.source_kind,sourceId:source.source_id,
      quantity:source.quantity,goodQuantity:source.sellable_restock_quantity,supplierId:source.defect_non_sellable_quantity&&input.destination==='supplier'?input.supplierByProduct[source.product_id]:null}))}};
  }
  let items:ReturnRequestItem[];
  if(selection.kind==='base'){
    if(!base)throw new Error('سطر الفاتورة غير متاح.');
    items=[{return_scope:'base_unit',order_item_id:base.orderItemId,quantity:sources.reduce((s,x)=>s+x.quantity,0),
      stock_disposition:sources.some(s=>s.sellable_restock_quantity>0)?'restock':'damaged',...(damage?{customer_damage_quantity:damage}:{})}];
  }else{
    const parcel=context.parcelInstances.find(p=>p.parcelInstanceId===selection.parcelInstanceId)!;
    items=[{return_scope:'parcel_instance',order_item_id:parcel.orderItemId,parcel_instance_id:parcel.parcelInstanceId,
      components:parcel.components.map(c=>{
        const rows=sources.filter(s=>s.root_source_id===c.parcelComponentId),good=rows.reduce((s,x)=>s+x.sellable_restock_quantity,0),bad=rows.reduce((s,x)=>s+x.defect_non_sellable_quantity,0),damage=rows.reduce((s,x)=>s+x.customer_damage_quantity,0);
        return{parcel_component_id:c.parcelComponentId,accepted_quantity:good+bad,rejected_quantity:damage,
          accepted_condition:good?'sellable':bad?'supplier_defect':null,accepted_stock_disposition:good?'restock':bad?'non_sellable':null,
          rejection_reason:damage?'customer_damage':null,rejected_stock_disposition:damage?'returned_to_customer':null};
      })}];
  }
  const payload:Aftercare215Payloads['sealed_return']={orderId:order.id,items,physicalSources:sources,reason,notes,refundMethod:input.refundMethod,
    referenceNumber:input.refundMethod==='cliq'?input.referenceNumber.trim()||null:null,supplierAssignments:assignments};
  if(input.intent==='refund')return{action:'sealed_return',payload};
  if(!input.productId)throw new Error('اختر الصنف الذي أخذه الزبون بدلاً من الراجع.');
  return{action:'exchange',payload:{returnRequest:{...payload,refundMethod:'auto',referenceNumber:null},replacement:{productId:input.productId,kind:input.replacementKind,quantity:positive(input.replacementQuantity,'كمية البديل')},
    differenceMethod:input.differenceMethod,referenceNumber:input.differenceMethod==='cliq'?input.referenceNumber.trim()||null:null}};
}
