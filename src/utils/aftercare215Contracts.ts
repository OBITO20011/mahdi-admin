import {exactMinorText,exactUnitCostText} from './aftercare215Money';
import {parseExchangeFunding} from '../../customer-web/src/receipts/exchangeFunding';
import type {ReturnPhysicalSource,ReturnRequestItem,AftercarePhysicalRepresentative} from '../services/supabase/salesAftercare.service';

export const aftercare215Actions=['sealed_return','inspected_replacement','exchange'] as const;
export type Aftercare215Action=typeof aftercare215Actions[number];
export interface InspectedReplacementPayload {
 orderId:string;items:Array<{sourceKind:AftercarePhysicalRepresentative['sourceKind'];sourceId:string;quantity:number;goodQuantity:number;supplierId:string|null}>;
 reason:string;notes:string|null;
}
export interface SealedReturnPayload {
 orderId:string;items:ReturnRequestItem[];physicalSources:ReturnPhysicalSource[];reason:string;notes:string|null;
 refundMethod:'auto'|'cash'|'cliq'|'debt';referenceNumber:string|null;
 supplierAssignments:Array<{sourceKind:AftercarePhysicalRepresentative['sourceKind'];sourceId:string;supplierId:string}>;
}
export interface ExchangePayload {
 returnRequest:SealedReturnPayload;replacement:{productId:string;kind:'base_unit'|'legacy_single_sku_parcel';quantity:number};
 differenceMethod:'cash'|'cliq'|null;referenceNumber?:string|null;
}
export interface Aftercare215Payloads {sealed_return:SealedReturnPayload;inspected_replacement:InspectedReplacementPayload;exchange:ExchangePayload}
export interface PreviewIssue {field:string;code:string}
interface PreviewBase {previewFingerprint:string;orderId:string;canConfirm:boolean;issues:PreviewIssue[];goodQuantity:number;badQuantity:number;customerDamageQuantity:number;ownerValues?:Record<string,string>}
export interface ReturnPreview215 extends PreviewBase {
 kind:'sealed_return';entitlementInMinorUnits:string;debtReductionInMinorUnits:string;moneyRefundInMinorUnits:string;refundMethod:'cash'|'cliq'|null;
}
export interface ReplacementPreview215 extends PreviewBase {kind:'inspected_replacement';issuedQuantity:number}
export interface ExchangePreview215 extends PreviewBase {
 kind:'exchange';productId:string;productName:string;baseQuantity:number;newTotalInMinorUnits:string;internalCreditInMinorUnits:string;
 differenceInMinorUnits:string;moneyReceivedInMinorUnits:string;moneyRefundInMinorUnits:string;differenceMethod:'cash'|'cliq'|null;
}
export type Preview215=ReturnPreview215|ReplacementPreview215|ExchangePreview215;
export const aftercare215Record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const invalid=()=>new Error('AFTERCARE215_RESPONSE_INVALID: دليل العملية غير مكتمل. حدّث الفاتورة واستعد نفس المحاولة.');
const text=(v:unknown)=>{if(typeof v!=='string'||!v)throw invalid();return v;};
const quantity=(v:unknown)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw invalid();return v;};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(v);
const method=(v:unknown):'cash'|'cliq'|null=>{if(v===null||v==='cash'||v==='cliq')return v;throw invalid();};
const signedDecimal=(v:unknown)=>{const raw=text(v);exactUnitCostText(raw.startsWith('-')?raw.slice(1):raw);return raw;};
function ownerFields(row:Record<string,unknown>,keys:readonly string[],allowed:boolean):Record<string,string>|undefined {
 if(!keys.some(k=>row[k]!==undefined))return undefined;
 if(!allowed||keys.some(k=>row[k]===undefined))throw invalid();
 return Object.fromEntries(keys.map(k=>[k,signedDecimal(row[k])]));
}
export function parseAftercare215Preview(action:Aftercare215Action,orderId:string,value:unknown,ownerAllowed:boolean):Preview215 {
 if(!aftercare215Record(value)||value.contractVersion!==215||value.orderId!==orderId||!uuid(orderId)
  ||typeof value.previewFingerprint!=='string'||!/^[0-9a-f]{64}$/u.test(value.previewFingerprint))throw invalid();
 const row=value,issues:PreviewIssue[]=action==='inspected_replacement'?[]:Array.isArray(row.issues)?row.issues.map(v=>{
  if(!aftercare215Record(v))throw invalid();return{field:text(v.field),code:text(v.code)};
 }):(()=>{throw invalid();})();
 const canConfirm=action==='inspected_replacement'?true:row.canConfirm;
 if(typeof canConfirm!=='boolean'||canConfirm!==(issues.length===0))throw invalid();
 const base:PreviewBase={orderId,previewFingerprint:row.previewFingerprint as string,issues,canConfirm,
  goodQuantity:quantity(action==='inspected_replacement'?row.restockedQuantity:row.goodQuantity),badQuantity:quantity(row.badQuantity),
  customerDamageQuantity:action==='sealed_return'?quantity(row.customerDamageQuantity):0};
 if(action==='inspected_replacement') {
  const issued=quantity(row.issuedQuantity);if(issued!==base.goodQuantity+base.badQuantity||row.moneyDifferenceInMinorUnits!==0||row.customerDebtDeltaInMinorUnits!==0)throw invalid();
  const values=ownerFields(row,['issuedCostInMinorUnits','goodRecoveryInMinorUnits','supplierHeldInMinorUnits','profitDeltaInMinorUnits'],ownerAllowed);
  return{...base,kind:action,issuedQuantity:issued,...(values?{ownerValues:values}:{})};
 }
 if(action==='sealed_return') {
  const entitlement=exactMinorText(row.entitlementInMinorUnits),debt=exactMinorText(row.debtReductionInMinorUnits),money=exactMinorText(row.moneyRefundInMinorUnits),refundMethod=method(row.refundMethod);
  if(BigInt(entitlement)!==BigInt(debt)+BigInt(money)||BigInt(money)===0n&&refundMethod!==null||canConfirm&&BigInt(money)>0n&&refundMethod===null)throw invalid();
  const values=ownerFields(row,['goodRestockValueExact','badLossInMinorUnits','supplierHeldInMinorUnits','profitDeltaExactInMinorUnits'],ownerAllowed);
  return{...base,kind:action,entitlementInMinorUnits:entitlement,debtReductionInMinorUnits:debt,moneyRefundInMinorUnits:money,refundMethod,...(values?{ownerValues:values}:{})};
 }
 const credit=exactMinorText(row.internalCreditInMinorUnits),total=exactMinorText(row.newTotalInMinorUnits),paid=exactMinorText(row.moneyReceivedInMinorUnits),refund=exactMinorText(row.moneyRefundInMinorUnits),difference=exactMinorText(row.differenceInMinorUnits,true);
 const paymentMethod=method(row.differenceMethod);
 if(BigInt(credit)<=0n||BigInt(total)<=0n||BigInt(credit)+BigInt(paid)!==BigInt(total)||BigInt(paid)>0n&&BigInt(refund)>0n||BigInt(difference)!==BigInt(paid)-BigInt(refund)
  ||BigInt(paid)===0n&&BigInt(refund)===0n&&paymentMethod!==null
  ||canConfirm&&(BigInt(paid)>0n||BigInt(refund)>0n)&&paymentMethod===null)throw invalid();
 const values=ownerFields(row,['newCogsExact','goodRestockValueExact','supplierHeldInMinorUnits','profitDeltaExactInMinorUnits'],ownerAllowed);
 if(!uuid(row.productId))throw invalid();
 return{...base,kind:action,productId:row.productId,productName:text(row.productName),baseQuantity:quantity(row.baseQuantity),newTotalInMinorUnits:total,
  internalCreditInMinorUnits:credit,differenceInMinorUnits:difference,moneyReceivedInMinorUnits:paid,moneyRefundInMinorUnits:refund,differenceMethod:paymentMethod,...(values?{ownerValues:values}:{})};
}

/** Used by durable recovery. No cost/preview values are persisted in requests. */
export function aftercare215SuccessMatches(action:Aftercare215Action,orderId:string,request:Record<string,unknown>,value:unknown):value is Record<string,unknown> {
 try {
  if(!aftercare215Record(value)||value.success!==true||!uuid(value.operationId)||!aftercare215Record(request.payload)
   ||typeof request.previewFingerprint!=='string'||!/^[0-9a-f]{64}$/u.test(request.previewFingerprint)
   ||Object.keys(value).some(k=>/cost|cogs|wac|profit|recovery|loss|ownerValues/iu.test(k)))return false;
  const payload=request.payload;
  if(action==='exchange') {
   if(!aftercare215Record(payload.returnRequest)||payload.returnRequest.orderId!==orderId||value.originalOrderId!==orderId||!uuid(value.newOrderId)||value.newOrderId===orderId||!uuid(value.returnId))return false;
   text(value.returnNumber);text(value.newOrderNumber);const funding=parseExchangeFunding(value);
   if((BigInt(funding.moneyReceivedInMinorUnits)>0n||BigInt(funding.moneyRefundInMinorUnits)>0n)&&payload.differenceMethod!==funding.differenceMethod
     &&!(payload.differenceMethod===null&&BigInt(funding.moneyRefundInMinorUnits)>0n))return false;
   if(funding.differenceMethod==='cliq'&&(typeof payload.referenceNumber!=='string'||value.referenceNumber!==payload.referenceNumber.trim()))return false;
   if(funding.differenceMethod!=='cliq'&&value.referenceNumber!==null)return false;
   return true;
  }
  if(payload.orderId!==orderId||value.orderId!==orderId||value.contractVersion!==215)return false;
  if(action==='inspected_replacement') {
   if(!uuid(value.replacementId)||!Array.isArray(payload.items)||!Array.isArray(value.caseIds)||!value.caseIds.every(uuid))return false;
   let issued=0,good=0;
   for(const item of payload.items){if(!aftercare215Record(item)||quantity(item.quantity)===0||quantity(item.goodQuantity)>quantity(item.quantity))return false;issued+=quantity(item.quantity);good+=quantity(item.goodQuantity);}
   return issued>0&&issued===value.issuedQuantity&&good===value.restockedQuantity&&issued-good===value.badQuantity&&value.moneyDifferenceInMinorUnits===0;
  }
  if(!uuid(value.returnId)||!uuid(value.returnOperationId)||!Array.isArray(payload.physicalSources)||payload.physicalSources.length===0)return false;
  text(value.returnNumber);const entitlement=exactMinorText(value.entitlementInMinorUnits),debt=exactMinorText(value.debtReductionInMinorUnits),money=exactMinorText(value.moneyRefundInMinorUnits);
  if(BigInt(entitlement)!==BigInt(debt)+BigInt(money))return false;
  const refundMethod=method(value.refundMethod);
  if(BigInt(money)===0n&&refundMethod!==null||BigInt(money)>0n&&refundMethod===null)return false;
  if(BigInt(money)>0n&&payload.refundMethod!=='auto'&&payload.refundMethod!==refundMethod)return false;
  let good=0,bad=0,damage=0;
  for(const source of payload.physicalSources){if(!aftercare215Record(source)||quantity(source.quantity)!==quantity(source.sellable_restock_quantity)+quantity(source.defect_non_sellable_quantity)+quantity(source.customer_damage_quantity))return false;good+=quantity(source.sellable_restock_quantity);bad+=quantity(source.defect_non_sellable_quantity);damage+=quantity(source.customer_damage_quantity);}
  return good===value.goodQuantity&&bad===value.badQuantity&&damage===value.customerDamageQuantity;
 }catch{return false;}
}
