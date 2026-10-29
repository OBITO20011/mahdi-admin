import {exactMinorText} from './aftercare215Money';
import {replacementRecord,type SupplierReplacementPayload} from './supplierReplacement';
export type SupplierCreditAction215='credit'|'reverse_credit';
export interface SupplierCreditPreview215 {action:SupplierCreditAction215;caseId:string;supplierId:string;productId:string;quantity:number;amountDeltaInMinorUnits:string;balanceBeforeInMinorUnits:string;balanceAfterInMinorUnits:string;previewFingerprint:string}
export interface SupplierCreditRow215 {eventId:string;operationId:string;caseId:string;amountDeltaInMinorUnits:string;balanceBeforeInMinorUnits:string;balanceAfterInMinorUnits:string;reversesEventId:string|null;createdAt:string;reason:string;productName:string}
export interface SupplierCreditPage215 {page:number;pageSize:number;totalCount:number;rows:SupplierCreditRow215[]}
const invalid=()=>new Error('SUPPLIER215_RESPONSE_INVALID: دليل خصم المورد غير مكتمل؛ استعد نفس المحاولة.');
const text=(v:unknown)=>{if(typeof v!=='string'||!v.trim())throw invalid();return v;};
const uuid=(v:unknown)=>{const s=text(v);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(s))throw invalid();return s;};
const quantity=(v:unknown)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<1)throw invalid();return v;};
const seal=(v:unknown)=>{const s=text(v);if(!/^[0-9a-f]{64}$/u.test(s))throw invalid();return s;};
function amounts(delta:unknown,before:unknown,after:unknown){
  const amountDeltaInMinorUnits=exactMinorText(delta,true),balanceBeforeInMinorUnits=exactMinorText(before,true),balanceAfterInMinorUnits=exactMinorText(after,true);
  if(BigInt(amountDeltaInMinorUnits)===0n||BigInt(balanceBeforeInMinorUnits)-BigInt(amountDeltaInMinorUnits)!==BigInt(balanceAfterInMinorUnits))throw invalid();
  return{amountDeltaInMinorUnits,balanceBeforeInMinorUnits,balanceAfterInMinorUnits};
}
/** Persist only intent and its seal. No monetary preview is a request field. */
export function supplierCreditRequest215(action:SupplierCreditAction215,payload:SupplierReplacementPayload){
  const allowed=action==='credit'?['caseId','quantity','reason','previewFingerprint']:['eventId','reason','previewFingerprint'];
  if(Object.keys(payload).some(k=>!allowed.includes(k))||Object.keys(payload).length!==allowed.length)throw invalid();
  const reason=text(payload.reason).trim();if(reason.length<3||reason.length>500)throw invalid();
  const previewFingerprint=seal(payload.previewFingerprint);
  return{previewFingerprint,payload:action==='credit'?{caseId:uuid(payload.caseId),quantity:quantity(payload.quantity),reason}:{eventId:uuid(payload.eventId),reason}};
}
export function parseSupplierCreditPreview215(action:SupplierCreditAction215,payload:SupplierReplacementPayload,value:unknown):SupplierCreditPreview215{
  if(!replacementRecord(value)||value.contractVersion!==215||value.action!==action)throw invalid();
  const money=amounts(value.amountDeltaInMinorUnits,value.balanceBeforeInMinorUnits,value.balanceAfterInMinorUnits);
  if((BigInt(money.amountDeltaInMinorUnits)>0n)!==(action==='credit'))throw invalid();
  const result={action,caseId:uuid(value.caseId),supplierId:uuid(value.supplierId),productId:uuid(value.productId),quantity:quantity(value.quantity),...money,previewFingerprint:seal(value.previewFingerprint)};
  if(action==='credit'&&(result.caseId!==payload.caseId||result.quantity!==payload.quantity)||action==='reverse_credit'&&value.reversesEventId!==payload.eventId)throw invalid();
  return result;
}
export function parseSupplierCreditResult215(action:SupplierCreditAction215,payload:SupplierReplacementPayload,actorId:string,value:unknown){
  const request=supplierCreditRequest215(action,payload).payload;
  if(!replacementRecord(value)||value.success!==true||value.contractVersion!==215||typeof value.idempotentReplay!=='boolean'||!replacementRecord(value.credit))throw invalid();
  const credit=value.credit,operationId=uuid(value.operationId);if(credit.operation_id!==operationId||credit.created_by!==actorId)throw invalid();
  uuid(credit.event_id);uuid(credit.case_id);uuid(credit.supplier_id);
  const money=amounts(credit.amount_delta_in_minor_units,credit.balance_before_in_minor_units,credit.balance_after_in_minor_units);
  if((BigInt(money.amountDeltaInMinorUnits)>0n)!==(action==='credit')||action==='credit'&&(credit.case_id!==request.caseId||credit.reverses_credit_event_id!==null)
    ||action==='reverse_credit'&&credit.reverses_credit_event_id!==request.eventId)throw invalid();
  return{operationId,recovered:value.idempotentReplay,cases:[],credit:{eventId:credit.event_id as string,caseId:credit.case_id as string,...money}};
}
export function parseSupplierCreditPage215(value:unknown):SupplierCreditPage215{
  if(!replacementRecord(value)||value.contractVersion!==215||!Array.isArray(value.rows))throw invalid();
  const page=quantity(value.page),pageSize=quantity(value.pageSize),totalCount=value.totalCount;
  if(typeof totalCount!=='number'||!Number.isSafeInteger(totalCount)||totalCount<0||pageSize>100||value.rows.length!==Math.max(0,Math.min(pageSize,totalCount-(page-1)*pageSize)))throw invalid();
  const rows=value.rows.map((v):SupplierCreditRow215=>{if(!replacementRecord(v))throw invalid();const money=amounts(v.amount_delta_in_minor_units,v.balance_before_in_minor_units,v.balance_after_in_minor_units);
    const reversesEventId=v.reverses_credit_event_id===null?null:uuid(v.reverses_credit_event_id),createdAt=text(v.created_at);if(!Number.isFinite(Date.parse(createdAt))||(BigInt(money.amountDeltaInMinorUnits)<0n)!==Boolean(reversesEventId))throw invalid();
    return{eventId:uuid(v.event_id),operationId:uuid(v.operation_id),caseId:uuid(v.case_id),...money,reversesEventId,createdAt,reason:text(v.reason),productName:text(v.product_name)};});
  if(new Set(rows.map(r=>r.eventId)).size!==rows.length)throw invalid();return{page,pageSize,totalCount,rows};
}
