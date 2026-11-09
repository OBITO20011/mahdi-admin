import {supabase} from '../lib/supabase';
// Server chooses the mode per read. A missing phase2 RPC on legacy219 alone
// falls back;network/permission/malformed responses never masquerade as full.
type Response={data:unknown;error:{code?:string;message?:string}|null;status?:number};
export type CatalogRpc=(name:string,args?:Record<string,unknown>)=>PromiseLike<Response>;
const originals={lite1_preview_guest2:'preview_guest_promotion_v2',lite1_catalog_page2:'get_public_storefront_catalog_page',lite1_parcel_options2:'get_public_configurable_parcel_options',lite1_merchandising2:'get_public_storefront_merchandising'} as const;
export async function readOperatingCatalog(rpc:CatalogRpc,name:keyof typeof originals,args?:Record<string,unknown>):Promise<Response>{
 const result=await rpc(name,args);
 if(result.data==null&&result.status===404&&result.error?.code==='PGRST202'&&result.error.message?.includes(name))return rpc(originals[name],args);
 return result;
}
export function quantityFreePayload(value:unknown,contract:string):boolean{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('تعذر التحقق من توفر المنتجات. أعد القراءة.');
 const row=value as Record<string,unknown>;
 if(row.quantityTracked===undefined)return false;
 if(row.quantityTracked!==false||row.contractVersion!==contract)throw Error('تعذر التحقق من وضع كتالوج المنتجات. أعد القراءة.');
 return true;
}

/** Literal RPC sites preserve the current role/source audit,including legacy fallback. */
export const operatingCatalogRpc:CatalogRpc=(name,args)=>{
 if(!supabase)throw Error('تعذر الاتصال بكتالوج المتجر.');
 switch(name){
  case 'lite1_preview_guest2':return supabase.rpc('lite1_preview_guest2',args);
  case 'preview_guest_promotion_v2':return supabase.rpc('preview_guest_promotion_v2',args);
  case 'lite1_catalog_page2':return supabase.rpc('lite1_catalog_page2',args);
  case 'get_public_storefront_catalog_page':return supabase.rpc('get_public_storefront_catalog_page',args);
  case 'lite1_parcel_options2':return supabase.rpc('lite1_parcel_options2',args);
  case 'get_public_configurable_parcel_options':return supabase.rpc('get_public_configurable_parcel_options',args);
  case 'lite1_merchandising2':return supabase.rpc('lite1_merchandising2',args);
  case 'get_public_storefront_merchandising':return supabase.rpc('get_public_storefront_merchandising');
  default:throw Error('UNAPPROVED_CATALOG_RPC');
 }
};
