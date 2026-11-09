import {isSupabaseConfigured,supabase} from '../../lib/supabase';
type Response={data:unknown;error:{code?:string;message?:string}|null;status?:number};
export type ShiftReversalRpc=(name:'lite1_preview_shift_reversal2'|'preview_cash_shift_full_reversal',args:{p_shift_id:string})=>PromiseLike<Response>;
const invalid=()=>Error('SHIFT-03: تعذر التحقق من معاينة عكس الوردية؛ أعد قراءتها ولا تنفّذ العكس قبل التحقق.');
export async function readOperatingShiftReversalWithRpc(execute:ShiftReversalRpc,shiftId:string){
 const args={p_shift_id:shiftId},r=await execute('lite1_preview_shift_reversal2',args);
 return r.data==null&&r.status===404&&r.error?.code==='PGRST202'&&r.error.message?.includes('lite1_preview_shift_reversal2')?execute('preview_cash_shift_full_reversal',args):r;
}
export function readOperatingShiftReversal(shiftId:string){
 const client=supabase;if(!isSupabaseConfigured||!client)throw invalid();
 return readOperatingShiftReversalWithRpc((name,args)=>name==='lite1_preview_shift_reversal2'?client.rpc('lite1_preview_shift_reversal2',args):client.rpc('preview_cash_shift_full_reversal',args),shiftId);
}
export function assertLiteShiftReversalBlock(value:unknown,shiftId:string){
 if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();const p=value as Record<string,unknown>;
 if(p.liteMonetaryRefundBlocked===undefined)return;
 if(p.liteMonetaryRefundBlocked!==true||p.success!==true||p.shiftId!==shiftId||p.canExecute!==false||!Array.isArray(p.operations)
  ||!p.operations.some(v=>v&&typeof v==='object'&&v.operationType==='lite_monetary_refund'&&v.originalRecordId===shiftId
   &&v.status==='BLOCKED'&&typeof v.reason==='string'&&v.reason.trim().length>0))throw invalid();
}
export function shiftReversalGuardMessage(error:{code?:string;message?:string}){
 return error.code==='P0001'&&error.message==='LITE2_SHIFT_REVERSAL_HAS_LITE_REFUND'
  ?'هذه الوردية تتضمن ردّ مبلغ لفاتورة قديمة بلا مخزون. استخدم عدّ الدرج والإغلاق اليومي؛ الإلغاء والعكس محجوبان. (SHIFT-03)':null;
}
