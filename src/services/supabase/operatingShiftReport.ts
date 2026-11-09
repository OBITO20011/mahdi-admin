import {isSupabaseConfigured,supabase} from '../../lib/supabase';
type Response={data:unknown;error:{code?:string;message?:string}|null;status?:number};
export type ShiftReportRpc=(name:'lite1_shift_closing2'|'get_cash_shift_closing_report',args:{p_shift_id:string})=>PromiseLike<Response>;
export async function readOperatingShiftReportWithRpc(execute:ShiftReportRpc,shiftId:string){
 const args={p_shift_id:shiftId},r=await execute('lite1_shift_closing2',args);
 return r.data==null&&r.status===404&&r.error?.code==='PGRST202'&&r.error.message?.includes('lite1_shift_closing2')?execute('get_cash_shift_closing_report',args):r;
}
export function readOperatingShiftReport(shiftId:string){
 const client=supabase;if(!isSupabaseConfigured||!client)throw Error('SHIFT-01');
 return readOperatingShiftReportWithRpc((name,args)=>name==='lite1_shift_closing2'?client.rpc('lite1_shift_closing2',args):client.rpc('get_cash_shift_closing_report',args),shiftId);
}
