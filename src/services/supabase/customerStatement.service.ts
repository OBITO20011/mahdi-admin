import {isSupabaseConfigured,supabase} from '../../lib/supabase';
import {readCustomerStatement} from '../../utils/customerStatement';

interface StatementResponse {data:unknown;error:{code?:string;message?:string}|null;status?:number}
type StatementRpc=(name:'lite1_statement_dispatch2'|'get_customer_statement',args:{p_customer_id:string;p_page:number;p_page_size:number})=>PromiseLike<StatementResponse>;
export async function readCustomerStatementWithRpc(customerId:string,page:number,execute:StatementRpc){
 const args={p_customer_id:customerId,p_page:page,p_page_size:25};
 let result=await execute('lite1_statement_dispatch2',args);
 // Only the specifically absent quarantined RPC on legacy219 can use the
 // original reader. Network/permission/malformed failures never switch readers.
 if(result.status===404&&result.data==null&&result.error?.code==='PGRST202'&&result.error.message?.includes('lite1_statement_dispatch2'))result=await execute('get_customer_statement',args);
 return result.error?null:readCustomerStatement(result.data);
}
export async function fetchCustomerStatement(customerId:string,page=1) {
  const client=supabase;if(!isSupabaseConfigured||!client)return null;
  try {
    return await readCustomerStatementWithRpc(customerId,page,(name,args)=>client.rpc(name,args));
  }catch{return null;}
}
