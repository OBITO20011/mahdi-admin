import {supabase,isSupabaseConfigured} from '../../lib/supabase';
import type {CashFlowKind} from '../../features/shifts/cashFlowModel';

export interface CashShiftMovement {
  source:string;id:string;reference:string;at:string;method:string;amountInMinorUnits:number;note:string|null;
}
export interface CashShiftMovementPage {
  shiftId:string;kind:CashFlowKind;method:'cash'|'cliq'|'card';generatedAt:string;shiftStatus:string;
  canonicalAmountInMinorUnits:number|null;totalAmountInMinorUnits:number;totalCount:number;
  page:number;pageSize:number;totalPages:number;evidenceStatus:'matched'|'mismatch'|'unavailable';rows:CashShiftMovement[];
}
const integer=(value:unknown):number=>{if(typeof value!=='number'||!Number.isSafeInteger(value))throw new Error('تفاصيل الوردية تحتوي مبلغاً أو عدداً غير صالح.');return value;};
const text=(value:unknown):string=>{if(typeof value!=='string'||!value)throw new Error('تفاصيل الوردية غير مكتملة.');return value;};
export function parseCashShiftMovementPage(value:unknown):CashShiftMovementPage {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('تعذر قراءة تفاصيل الوردية.');
  const row=value as Record<string,unknown>;
  if(!Array.isArray(row.rows)||!['matched','mismatch','unavailable'].includes(String(row.evidenceStatus))
    ||!['sales','receipts','supplier_payments','expenses','refunds','withdrawals','withdrawal_returns'].includes(String(row.kind))
    ||!['cash','cliq','card'].includes(String(row.method))||!['open','closed','cancelled','reversed'].includes(String(row.shiftStatus)))throw new Error('دليل تفاصيل الوردية غير صالح.');
  const result={...row,shiftId:text(row.shiftId),generatedAt:text(row.generatedAt),
    canonicalAmountInMinorUnits:row.canonicalAmountInMinorUnits===null?null:integer(row.canonicalAmountInMinorUnits),
    totalAmountInMinorUnits:integer(row.totalAmountInMinorUnits),totalCount:integer(row.totalCount),page:integer(row.page),pageSize:integer(row.pageSize),totalPages:integer(row.totalPages),
    rows:row.rows.map(item=>{if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('سطر حركة غير صالح.');const r=item as Record<string,unknown>;
      return {source:text(r.source),id:text(r.id),reference:text(r.reference),at:text(r.at),method:text(r.method),amountInMinorUnits:integer(r.amountInMinorUnits),note:r.note===null?null:text(r.note)};})} as CashShiftMovementPage;
  if(result.page<1||result.pageSize<1||result.pageSize>100||result.totalCount<0||result.totalPages!==Math.max(1,Math.ceil(result.totalCount/result.pageSize))
    ||result.rows.length!==Math.max(0,Math.min(result.pageSize,result.totalCount-(result.page-1)*result.pageSize))
    ||!Number.isFinite(Date.parse(result.generatedAt))||result.rows.some(item=>item.method!==result.method||!Number.isFinite(Date.parse(item.at)))
    ||new Set(result.rows.map(item=>`${item.source}:${item.id}`)).size!==result.rows.length
    ||(result.evidenceStatus==='matched'&&result.canonicalAmountInMinorUnits!==result.totalAmountInMinorUnits))throw new Error('تفاصيل الوردية لا تتطابق مع دليل القراءة.');
  return result;
}
export async function fetchCashShiftMovementPage(shiftId:string,kind:CashFlowKind,method:'cash'|'cliq'|'card',page:number,signal?:AbortSignal):Promise<CashShiftMovementPage> {
  if(!supabase||!isSupabaseConfigured)throw new Error('تفاصيل الوردية غير متاحة حالياً.');
  const request=supabase.rpc('get_cash_shift_movement_page',{p_shift_id:shiftId,p_kind:kind,p_method:method,p_page:page,p_page_size:25});
  const {data,error}=await (signal?request.abortSignal(signal):request);
  if(error)throw new Error(error.code==='PGRST202'?'تفاصيل العمليات تحتاج ترقية قاعدة البيانات إلى 206.':error.message||'تعذر تحميل تفاصيل الوردية.');
  const result=parseCashShiftMovementPage(data);
  if(result.shiftId!==shiftId||result.kind!==kind||result.method!==method||result.page!==page)throw new Error('تفاصيل الوردية لا تطابق الطلب.');
  return result;
}
