import {supabase,isSupabaseConfigured} from '../../lib/supabase';
import {readReplacementCase,type SupplierReplacementCase} from '../../utils/supplierReplacement';
export const damageHistoryReasons={shop_breakage:'انكسر بالمحل',expired:'انتهت الصلاحية',storage_damage:'تلف تخزين',other:'أخرى',customer_return_final:'مرتجع زبون',supplier_writeoff:'رفض المورد',customer_replacement:'استبدال حبة معيبة'} as const;
export type DamageHistoryPeriod='today'|'week'|'month'|'range';
export interface DamageHistoryInput {period:DamageHistoryPeriod;fromDate?:string;toDate?:string;reason:string;page:number}
export interface DamageHistoryRow {
  source:'damage'|'replacement'|'supplier_writeoff';id:string;productId:string;productName:string;unitName:string;
  quantity:number;reasonCode:string;reason:string;occurredAt:string;origin:'shop'|'customer_return'|'supplier_rejected';
  isReversed:boolean;isReclassified:boolean;lossAtRegistrationInMinorUnits?:number;
  reversal?:{item:SupplierReplacementCase;eventId:string};
  reclassification?:{kind:'replacement'|'return';sourceId:string;orderId:string;blockedReason:string|null};
}
export interface DamageHistoryPage {rows:DamageHistoryRow[];page:number;pageSize:number;totalCount:number;fromDate:string;toDate:string}
const invalid=()=>new Error('سجل التالف غير مكتمل. أعد تحميله.');
const record=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown)=>{if(typeof v!=='string'||!v.trim())throw invalid();return v;};
const integer=(v:unknown,min=0)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min)throw invalid();return v;};
export function parseDamageHistoryPage(value:unknown):DamageHistoryPage {
  if(!record(value)||value.contractVersion!==212||!Array.isArray(value.rows))throw invalid();
  const page=integer(value.page,1),pageSize=integer(value.pageSize,1),totalCount=integer(value.totalCount);
  if(pageSize>100||value.rows.length!==Math.max(0,Math.min(pageSize,totalCount-(page-1)*pageSize)))throw invalid();
  const rows=value.rows.map((v):DamageHistoryRow=>{
    if(!record(v)||!['damage','replacement','supplier_writeoff'].includes(String(v.source))||!['shop','customer_return','supplier_rejected'].includes(String(v.origin))
      ||typeof v.isReversed!=='boolean'||typeof v.isReclassified!=='boolean')throw invalid();
    const r:DamageHistoryRow={source:v.source as DamageHistoryRow['source'],id:text(v.id),productId:text(v.productId),productName:text(v.productName),unitName:text(v.unitName),quantity:integer(v.quantity,1),reasonCode:text(v.reasonCode),reason:text(v.reason),occurredAt:text(v.occurredAt),origin:v.origin as DamageHistoryRow['origin'],isReversed:v.isReversed,isReclassified:v.isReclassified};
    if(!Number.isFinite(Date.parse(r.occurredAt)))throw invalid();
    if(v.lossAtRegistrationInMinorUnits!==undefined)r.lossAtRegistrationInMinorUnits=integer(v.lossAtRegistrationInMinorUnits);
    if(v.reversal!==undefined){if(!record(v.reversal))throw invalid();r.reversal={item:readReplacementCase(v.reversal.case),eventId:text(v.reversal.eventId)};}
    if(v.reclassification!==undefined){const action=v.reclassification;if(!record(action)||!['replacement','return'].includes(String(action.kind))||(action.blockedReason!==null&&typeof action.blockedReason!=='string'))throw invalid();r.reclassification={kind:action.kind as 'replacement'|'return',sourceId:text(action.sourceId),orderId:text(action.orderId),blockedReason:action.blockedReason as string|null};}
    return r;
  });
  if(new Set(rows.map(r=>r.source+':'+r.id)).size!==rows.length)throw invalid();
  return {page,pageSize,totalCount,rows,fromDate:text(value.fromDate),toDate:text(value.toDate)};
}
export async function fetchDamageHistoryPage(input:DamageHistoryInput,signal:AbortSignal) {
  if(!supabase||!isSupabaseConfigured)throw new Error('سجل التالف غير متاح حالياً.');
  const {data,error}=await supabase.rpc('get_damage_history_page_v1',{p_period:input.period,p_from_date:input.period==='range'?input.fromDate:null,
    p_to_date:input.period==='range'?input.toDate:null,p_reason:input.reason,p_page:input.page,p_page_size:25}).abortSignal(signal);
  if(error)throw new Error(error.code==='PGRST202'?'سجل التالف يحتاج ترقية المالك إلى 212.':error.code==='42501'?'لا تملك صلاحية قراءة سجل التالف.':error.message||'تعذر تحميل سجل التالف.');
  const result=parseDamageHistoryPage(data);if(result.page!==input.page)throw invalid();return result;
}
