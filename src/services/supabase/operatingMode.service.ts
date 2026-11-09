import {isSupabaseConfigured,supabase} from '../../lib/supabase';

export type OperatingMode = 'full' | 'sales-only';
export interface OperatingModeInfo {mode:OperatingMode;installed:boolean}
interface ModeResponse {data:unknown;error:{code?:string;message?:string}|null;status?:number}
export type ModeRpc = (name:'lite1_operating_mode',args:Record<string,never>)=>PromiseLike<ModeResponse>;

/** Same bounded contract as the guest Edge adapter, independently parity-tested.
 * Only a specifically absent RPC on legacy219 means full. Never a network or
 * malformed-response fallback. The server still validates every write mode. */
export function parseOperatingMode(response:ModeResponse):OperatingModeInfo {
 const {data,error,status}=response;
 if(!error&&data&&typeof data==='object'&&!Array.isArray(data)){
  const value=data as Record<string,unknown>;
  if(value.contractVersion==='sales-only-phase2-v1'&&typeof value.fullAccounting==='boolean')return {mode:value.fullAccounting?'full':'sales-only',installed:true};
 }
 if(data==null&&error&&status===404&&error.code==='PGRST202'&&error.message?.includes('lite1_operating_mode'))return {mode:'full',installed:false};
 throw Error('OPERATING_MODE_UNVERIFIED: تعذر التحقق من وضع التشغيل. حدّث الحالة قبل بدء عملية جديدة.');
}
export async function readOperatingModeWithRpc(execute:ModeRpc):Promise<OperatingModeInfo>{
 return parseOperatingMode(await execute('lite1_operating_mode',{}));
}
export async function fetchOperatingMode():Promise<OperatingModeInfo>{
 const client=supabase;
 if(!isSupabaseConfigured||!client)throw Error('OPERATING_MODE_UNVERIFIED');
 return readOperatingModeWithRpc((name,args)=>client.rpc(name,args));
}
