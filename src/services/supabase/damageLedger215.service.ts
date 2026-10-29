import {supabase,isSupabaseConfigured} from '../../lib/supabase';
import {damageLedgerPeriod215,parseDamageLedger215,type Damage215State} from '../../utils/damageLedger215';
export async function fetchDamageLedger215(input:{period:'today'|'week'|'month'|'range';from?:string;to?:string;state:'all'|Damage215State;reason:string;search:string;page:number},ownerAllowed:boolean,signal:AbortSignal){
  if(!supabase||!isSupabaseConfigured)throw new Error('سجل التالف غير متاح حالياً.');
  const bounds=damageLedgerPeriod215(input.period,input.from,input.to);
  const {data,error}=await supabase.rpc('get_damage_ledger_page_v2',{p_from:bounds.from,p_to:bounds.to,p_state:input.state,p_reason:input.reason,p_search:input.search.trim(),p_branch_id:null,p_page:input.page,p_page_size:25}).abortSignal(signal);
  if(error)throw new Error(error.code==='PGRST202'?'سجل التالف المفصل يحتاج ترقية المالك إلى 215.':error.message);
  const result=parseDamageLedger215(data,ownerAllowed);
  if(result.page!==input.page||result.state!==input.state||Date.parse(result.from)!==Date.parse(bounds.from)||Date.parse(result.to)!==Date.parse(bounds.to))throw new Error('فترة سجل التالف أو صفحته لا تطابق الطلب.');
  return result;
}
