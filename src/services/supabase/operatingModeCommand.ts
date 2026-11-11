import {isSupabaseConfigured,supabase} from '../../lib/supabase';

interface IdentityResponse {data:{user:{id:string}|null};error:unknown}
interface CommandClient {
 auth:{getUser:()=>PromiseLike<IdentityResponse>;mfa:{getAuthenticatorAssuranceLevel:()=>PromiseLike<{data:{currentLevel:string|null}|null;error:unknown}>}};
 rpc:(name:'lite1_set_mode2',args:{p_full:false})=>PromiseLike<{data:unknown;error:unknown}>;
}
const invalid=()=>Error('MODE-01');
/** One mutation only. A failed/lost reply must be followed by a fresh read,
 * not by toggling again. ON is deliberately the separate opening-epoch tool. */
export async function disableFullAccountingWithClient(client:CommandClient,actorId:string){
 if(!actorId)throw invalid();
 const before=await client.auth.getUser();if(before.error||before.data.user?.id!==actorId)throw invalid();
 const aal=await client.auth.mfa.getAuthenticatorAssuranceLevel();if(aal.error||aal.data?.currentLevel!=='aal2')throw invalid();
 const after=await client.auth.getUser();if(after.error||after.data.user?.id!==actorId)throw invalid();
 const result=await client.rpc('lite1_set_mode2',{p_full:false});
 const v=result.data;
 if(result.error||!v||typeof v!=='object'||Array.isArray(v)||(v as Record<string,unknown>).fullAccounting!==false)throw invalid();
}
export async function disableFullAccounting(actorId:string){
 if(!isSupabaseConfigured||!supabase)throw invalid();
 return disableFullAccountingWithClient(supabase,actorId);
}
