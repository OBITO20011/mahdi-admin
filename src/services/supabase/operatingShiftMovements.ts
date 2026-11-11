import {supabase,isSupabaseConfigured} from '../../lib/supabase';
type Response={data:unknown;error:{code?:string;message?:string}|null;status?:number};
export type ShiftMovementsRpc=(name:'lite1_shift_movements2'|'get_cash_shift_movement_page',args:Record<string,unknown>,signal?:AbortSignal)=>PromiseLike<Response>;
export async function readOperatingShiftMovementsWithRpc(execute:ShiftMovementsRpc,args:Record<string,unknown>,signal?:AbortSignal){
 const r=await execute('lite1_shift_movements2',args,signal);
 if(signal?.aborted)throw Error('SHIFT_DETAILS_ABORTED');
 return r.data==null&&r.status===404&&r.error?.code==='PGRST202'&&r.error.message?.includes('lite1_shift_movements2')?execute('get_cash_shift_movement_page',args,signal):r;
}
export function readOperatingShiftMovements(args:Record<string,unknown>,signal?:AbortSignal){
 const client=supabase;if(!isSupabaseConfigured||!client)throw Error('SHIFT_DETAILS_UNAVAILABLE');
 return readOperatingShiftMovementsWithRpc((name,input,abort)=>{
  const query=name==='lite1_shift_movements2'?client.rpc('lite1_shift_movements2',input):client.rpc('get_cash_shift_movement_page',input);
  return abort?query.abortSignal(abort):query;
 },args,signal);
}
