import {isSupabaseConfigured,supabase} from '../../lib/supabase';

export interface ProductAvailability {
 productId:string;available:boolean;effectiveAvailable:boolean;active:boolean;
 revision:number;flavorMasterProductId:string|null;parentAvailable:boolean;
}
interface AvailabilityResult {contractVersion:'sales-only-availability2-v1';fullAccounting:boolean;products:ProductAvailability[]}
interface RpcResponse {data:unknown;error:unknown}
type AvailabilityRpc=(name:'lite1_product_availability2'|'lite1_set_available2',args:Record<string,unknown>)=>PromiseLike<RpcResponse>;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(v);
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const invalid=()=>Error('MANUAL_AVAILABILITY_UNVERIFIED: تعذر التحقق من التوفر اليدوي. أعد تحميل الحالة قبل تعديلها.');
const revision=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<=2147483647;
function requestedIds(ids:readonly string[]){
 if(!ids.length||ids.some(id=>!uuid(id)))throw invalid();
 const unique=[...new Set(ids.map(id=>id.toLowerCase()))];if(unique.length>200)throw invalid();return unique;
}
export function parseManualAvailability(value:unknown,ids:readonly string[]):AvailabilityResult{
 const requested=requestedIds(ids);
 if(!record(value)||value.contractVersion!=='sales-only-availability2-v1'||typeof value.fullAccounting!=='boolean'||!Array.isArray(value.products)||value.products.length!==requested.length)throw invalid();
 const seen=new Set<string>(),products=value.products.map((p:unknown):ProductAvailability=>{
  if(!record(p)||!uuid(p.productId)||seen.has(p.productId.toLowerCase())||!requested.includes(p.productId.toLowerCase())
   ||typeof p.available!=='boolean'||typeof p.effectiveAvailable!=='boolean'||typeof p.active!=='boolean'||typeof p.parentAvailable!=='boolean'||!revision(p.revision)
   ||(p.flavorMasterProductId!==null&&!uuid(p.flavorMasterProductId))||p.effectiveAvailable!==(p.active&&p.parentAvailable&&p.available))throw invalid();
  seen.add(p.productId.toLowerCase());
  return {productId:p.productId.toLowerCase(),available:p.available,effectiveAvailable:p.effectiveAvailable,active:p.active,parentAvailable:p.parentAvailable,
   revision:p.revision,flavorMasterProductId:p.flavorMasterProductId===null?null:p.flavorMasterProductId.toLowerCase()};
 });
 return {contractVersion:'sales-only-availability2-v1',fullAccounting:value.fullAccounting,products};
}
export async function readManualAvailabilityWithRpc(ids:readonly string[],execute:AvailabilityRpc){
 const requested=requestedIds(ids),response=await execute('lite1_product_availability2',{p_product_ids:requested});
 if(response.error)throw invalid();return parseManualAvailability(response.data,requested);
}
export async function setManualAvailabilityWithRpc(productId:string,available:boolean,expectedRevision:number,execute:AvailabilityRpc){
 if(!uuid(productId)||typeof available!=='boolean'||!revision(expectedRevision))throw invalid();
 // Exactly one compare-and-set. A lost response requires a fresh READ, never
 // a guessed revision or an automatic second toggle.
 const {data,error}=await execute('lite1_set_available2',{p_product:productId,p_available:available,p_revision:expectedRevision});
 if(error||!record(data)||data.available!==available||data.revision!==expectedRevision+1)throw invalid();
 return {available,revision:expectedRevision+1};
}
export async function fetchManualAvailability(ids:readonly string[]){
 const client=supabase;if(!isSupabaseConfigured||!client)throw invalid();
 return readManualAvailabilityWithRpc(ids,(name,args)=>client.rpc(name,args));
}
export async function setManualAvailability(productId:string,available:boolean,expectedRevision:number){
 const client=supabase;if(!isSupabaseConfigured||!client)throw invalid();
 return setManualAvailabilityWithRpc(productId,available,expectedRevision,(name,args)=>client.rpc(name,args));
}
