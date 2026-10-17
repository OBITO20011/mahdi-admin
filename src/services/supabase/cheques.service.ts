import {supabase} from '../../lib/supabase';
import type {CollectionPreview, CollectionPart} from './goLive.service';

export type ChequeStatus='pending'|'endorsed'|'cleared'|'returned'|'cancelled';
export type ChequeDirection='incoming'|'outgoing';
export type ChequeFilter=ChequeStatus|'all'|'due7'|'overdue';
export const chequeStatusLabels:Record<ChequeStatus,string>={pending:'قيد الانتظار',endorsed:'مُجيّر لمورد',cleared:'صُرف',returned:'راجع',cancelled:'ملغى — تسجيل خاطئ'};
export interface Cheque {
  id:string;trackingNumber:string;number:string;bank:string;dueDate:string;amount:number;direction:ChequeDirection;
  status:ChequeStatus;version:number;branchId:string;customerId:string|null;supplierId:string|null;endorsedSupplierId:string|null;
  customerName:string;supplierName:string;endorsedSupplierName:string;origin:'operational'|'opening';
}
export interface ChequeClaim {id:string;partyKind:'customer'|'supplier';reference:string;amount:number;originalDebtAt:string|null;reason:string;kind:'returned'|'cancelled'}
export interface ChequeResult {cheque:Cheque;claims:ChequeClaim[];idempotentReplay:boolean;customerBalanceInMinorUnits:number|null}
export interface ChequeDetail extends ChequeResult {
  events:{id:string;kind:string;at:string;reason:string|null;actor:string}[];
  allocations:{id:string;partyKind:'customer'|'supplier';originalDebtAt:string|null;amount:number}[];
  supplierClaims:{id:string;reference:string;outstanding:number}[];
  supplierClaimPayments:{id:string;amount:number;method:string;paidAt:string;isReversed:boolean;canReverse:boolean;reason:string|null}[];
}
export interface ChequePage {
  items:Cheque[];page:number;hasMore:boolean;totalCount:number;counts:Record<ChequeFilter,number>;
  summary:{incoming:number;outgoing:number;endorsed:number};
  weeks:{weekStart:string;direction:ChequeDirection;amount:number;count:number}[];
}
const object=(value:unknown):Record<string,unknown>=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('استجابة الشيكات غير مكتملة.');
  return value as Record<string,unknown>;
};
const text=(value:unknown)=>{if(typeof value!=='string')throw Error('حقل نصي مفقود من استجابة الشيكات.');return value;};
const nullableText=(value:unknown)=>value===null||value===undefined?null:text(value);
const integer=(value:unknown)=>{const n=typeof value==='string'&&/^-?\d+$/u.test(value)?Number(value):value;
  if(typeof n!=='number'||!Number.isSafeInteger(n))throw Error('مبلغ أو عدّاد غير صالح من قارئ الشيكات.');return n;};
const list=(value:unknown)=>{if(!Array.isArray(value))throw Error('قائمة الشيكات غير مكتملة.');return value as unknown[];};
const direction=(value:unknown):ChequeDirection=>{if(value!=='incoming'&&value!=='outgoing')throw Error('اتجاه شيك غير صالح.');return value;};
const status=(value:unknown):ChequeStatus=>{if(typeof value!=='string'||!Object.hasOwn(chequeStatusLabels,value))throw Error('حالة شيك غير صالحة.');return value as ChequeStatus;};
const partyKind=(value:unknown):'customer'|'supplier'=>{if(value!=='customer'&&value!=='supplier')throw Error('طرف شيك غير صالح.');return value;};
export const readCheque=(value:unknown):Cheque=>{const c=object(value);
  if(c.origin!=='opening'&&c.origin!=='operational')throw Error('أصل شيك غير صالح.');
  return {id:text(c.id),trackingNumber:text(c.tracking_number),number:text(c.cheque_number),bank:text(c.bank_name),dueDate:text(c.due_date),
    amount:integer(c.amount_in_minor_units),direction:direction(c.direction),status:status(c.status),version:integer(c.version),
    branchId:text(c.branch_id),customerId:nullableText(c.customer_id),supplierId:nullableText(c.supplier_id),endorsedSupplierId:nullableText(c.endorsed_supplier_id),
    customerName:nullableText(c.customer_name)??'',supplierName:nullableText(c.supplier_name)??'',endorsedSupplierName:nullableText(c.endorsed_supplier_name)??'',origin:c.origin};};
const result=(value:unknown):ChequeResult=>{const r=object(value);return {cheque:readCheque(r.cheque),idempotentReplay:r.idempotentReplay===true,
  customerBalanceInMinorUnits:r.customerBalanceInMinorUnits==null?null:integer(r.customerBalanceInMinorUnits),
  claims:list(r.claims).map(value=>{const c=object(value);if(c.claim_kind!=='returned'&&c.claim_kind!=='cancelled')throw Error('نوع قيد غير صالح.');
    return {id:text(c.id),partyKind:partyKind(c.party_kind),reference:text(c.reference),amount:integer(c.amount_in_minor_units),
      originalDebtAt:nullableText(c.original_debt_at),reason:text(c.reason),kind:c.claim_kind};})};};
const client=()=>{if(!supabase)throw Error('الاتصال بقاعدة البيانات غير جاهز.');return supabase;};
const settle=async(request:PromiseLike<{data:unknown;error:{message:string}|null}>)=>{const {data,error}=await request;if(error)throw Error(error.message);return object(data);};
export const newChequeKey=()=>`cheque-${crypto.randomUUID()}`;
export interface RegisterChequeInput {partyId:string;branchId:string;bank:string;number:string;dueDate:string;amount:number;notes:string;idempotencyKey:string;claimId?:string;purchaseOrderId?:string;openingOnly?:boolean}
const registrationPayload=(input:RegisterChequeInput)=>({p_branch_id:input.branchId,p_bank_name:input.bank.trim(),p_cheque_number:input.number.trim(),
  p_due_date:input.dueDate,p_amount_in_minor_units:input.amount,p_notes:input.notes.trim()||null,p_idempotency_key:input.idempotencyKey});
export const receiveCustomerCheque=async(input:RegisterChequeInput)=>result(await settle(client().rpc('receive_customer_cheque_v1',
  {...registrationPayload(input),p_customer_id:input.partyId})));
export const issueSupplierCheque=async(input:RegisterChequeInput)=>result(await settle(client().rpc('issue_supplier_cheque_v1',
  {...registrationPayload(input),p_supplier_id:input.partyId,p_claim_id:input.claimId??null,...(input.purchaseOrderId?{p_purchase_order_id:input.purchaseOrderId}:{}),
    ...(input.openingOnly?{p_opening_only:true}:{})})));
export async function previewCustomerCheque(customerId:string,amount:number):Promise<CollectionPreview> {
  const p=await settle(client().rpc('preview_customer_cheque_v1',{p_customer_id:customerId,p_amount_in_minor_units:amount}));
  return {totalOutstandingInMinorUnits:integer(p.totalOutstandingInMinorUnits),openingOutstandingInMinorUnits:integer(p.openingOutstandingInMinorUnits),
    ordersOutstandingInMinorUnits:integer(p.ordersOutstandingInMinorUnits),compensationOutstandingInMinorUnits:integer(p.compensationOutstandingInMinorUnits),
    exceedsBalance:p.exceedsBalance===true,parts:list(p.parts).map(value=>{const a=object(value);
      if(a.kind!=='order'&&a.kind!=='opening'&&a.kind!=='compensation')throw Error('نوع تخصيص غير صالح.');
      return {kind:a.kind,id:text(a.id),reference:text(a.reference),debtAt:nullableText(a.debtAt),outstandingInMinorUnits:integer(a.outstandingInMinorUnits),
        allocateInMinorUnits:integer(a.allocateInMinorUnits),remainingAfterInMinorUnits:integer(a.remainingAfterInMinorUnits)} satisfies CollectionPart;})};
}
export async function previewSupplierCheque(supplierId:string,amount:number,claimId?:string,purchaseOrderId?:string,openingOnly?:boolean) {
  const p=await settle(client().rpc('preview_supplier_cheque_v1',{p_supplier_id:supplierId,p_amount_in_minor_units:amount,p_claim_id:claimId??null,
    ...(purchaseOrderId?{p_purchase_order_id:purchaseOrderId}:{}),...(openingOnly?{p_opening_only:true}:{})}));
  return {balance:integer(p.balanceInMinorUnits),allocated:integer(p.allocatedInMinorUnits)};
}
export async function fetchCheques(input:{page:number;status:ChequeFilter;direction:ChequeDirection|'all';branchId:string|null;search:string}):Promise<ChequePage> {
  const p=await settle(client().rpc('get_deferred_cheques_page',{p_page:input.page,p_page_size:25,p_status:input.status,p_direction:input.direction,
    p_branch_id:input.branchId,p_search:input.search.trim()||null}));
  const counts=object(p.counts),s=object(p.summary);
  return {items:list(p.items).map(readCheque),page:integer(p.page),hasMore:p.hasMore===true,totalCount:integer(p.totalCount),
    counts:{all:integer(counts.all),pending:integer(counts.pending),endorsed:integer(counts.endorsed),cleared:integer(counts.cleared),
      returned:integer(counts.returned),cancelled:integer(counts.cancelled),due7:integer(counts.due7),overdue:integer(counts.overdue)},
    summary:{incoming:integer(s.incomingInMinorUnits),outgoing:integer(s.outgoingInMinorUnits),endorsed:integer(s.endorsedInMinorUnits)},
    weeks:list(p.weeks).map(value=>{const w=object(value);return {weekStart:text(w.week_start),direction:direction(w.direction),amount:integer(w.amount),count:integer(w.count)};})};
}
export async function fetchChequeDetail(id:string):Promise<ChequeDetail> {
  const p=await settle(client().rpc('get_deferred_cheque_detail',{p_cheque_id:id}));
  return {...result(p),events:list(p.events).map(value=>{const e=object(value);return {id:text(e.id),kind:text(e.kind),at:text(e.at),reason:nullableText(e.reason),actor:nullableText(e.actor)??'موظف'};}),
    allocations:list(p.allocations).map(value=>{const a=object(value);return {id:text(a.id),partyKind:partyKind(a.party_kind),originalDebtAt:nullableText(a.original_debt_at),amount:integer(a.amount_in_minor_units)};}),
    supplierClaims:list(p.supplierClaims).map(value=>{const c=object(value);return {id:text(c.id),reference:text(c.reference),outstanding:integer(c.outstanding)};}),
    supplierClaimPayments:list(p.supplierClaimPayments).map(value=>{const c=object(value);
      if(typeof c.is_reversed!=='boolean'||typeof c.can_reverse!=='boolean')throw Error('حالة سداد القيد غير مكتملة.');
      return {id:text(c.id),amount:integer(c.amount_in_minor_units),method:text(c.payment_method),paidAt:text(c.paid_at),
        isReversed:c.is_reversed,canReverse:c.can_reverse,reason:nullableText(c.reversal_reason)};})};
}
export const clearCheque=async(id:string,version:number,key:string)=>result(await settle(client().rpc('clear_deferred_cheque_v1',
  {p_cheque_id:id,p_expected_version:version,p_idempotency_key:key})));
export const returnCheque=async(id:string,version:number,reason:string,key:string)=>result(await settle(client().rpc('return_deferred_cheque_v1',
  {p_cheque_id:id,p_expected_version:version,p_reason:reason.trim(),p_idempotency_key:key})));
export const cancelCheque=async(id:string,version:number,reason:string,key:string)=>result(await settle(client().rpc('cancel_deferred_cheque_v1',
  {p_cheque_id:id,p_expected_version:version,p_reason:reason.trim(),p_idempotency_key:key})));
export const endorseCheque=async(id:string,supplierId:string,version:number,key:string)=>result(await settle(client().rpc('endorse_customer_cheque_v1',
  {p_cheque_id:id,p_supplier_id:supplierId,p_expected_version:version,p_idempotency_key:key})));
export const paySupplierChequeClaim=async(input:{claimId:string;branchId:string|null;amount:number;method:'cash'|'cliq'|'bank_transfer';reference:string;notes:string;key:string})=>
  settle(client().rpc('pay_supplier_cheque_claim_v1',{p_claim_id:input.claimId,p_branch_id:input.branchId,p_amount_in_minor_units:input.amount,
    p_payment_method:input.method,p_reference_number:input.reference.trim()||null,p_notes:input.notes.trim()||null,p_idempotency_key:input.key}));
export const reverseSupplierChequeClaimPayment=async(id:string,reason:string,key:string)=>
  settle(client().rpc('reverse_supplier_cheque_claim_payment_v1',{p_supplier_payment_id:id,p_reason:reason.trim(),p_idempotency_key:key}));
export async function fetchChequeHomeAlerts(branchId:string|null) {
  const p=await settle(client().rpc('get_deferred_cheque_home_alerts',{p_branch_id:branchId}));
  return {due:integer(p.dueWithinTwoDays),overdue:integer(p.overdue),outgoingDue:integer(p.outgoingDueInMinorUnits)};
}
