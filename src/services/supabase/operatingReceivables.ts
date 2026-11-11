/** Parallel220 readers retain full-mode semantics and also see historical lite
 * returns after opening epoch. Only an explicitly absent219 RPC may fall back. */
type Reply={data:unknown;error:{code?:string;message?:string}|null;status?:number};
type Params=Record<string,string|number|null>;
export async function readOperatingReceivablesWithRpc(
 execute:(name:string,args:Params)=>PromiseLike<Reply>,kind:'aging'|'crm',args:Params
){const name=kind==='aging'?'lite1_debt_aging2':'lite1_crm_page2',legacy=kind==='aging'?'get_customer_debt_aging':'get_crm_customer_page';const reply=await execute(name,args);
 if(reply.status===404&&reply.data==null&&reply.error?.code==='PGRST202'&&reply.error.message?.includes(name))return execute(legacy,args);
 return reply;
}
