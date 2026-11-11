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


/** Shared by the browser and build-time SEO. An OFF document cannot silently
 * fall back to stock fields or a partially migrated row. */
export function validateOperatingCatalog(value:unknown):boolean {
 const untracked=quantityFreePayload(value,'lite2-catalog-v1');if(!untracked)return false;
 const p=value as Record<string,unknown>,summary=p.summary as Record<string,unknown>|null;
 if(!Array.isArray(p.items)||!summary||summary.quantityTracked!==false||summary.availableSalePackages!==null||p.items.some(item=>!item||typeof item!=='object'||item.quantityTracked!==false||typeof item.manualAvailable!=='boolean'||item.availableQuantity!==null||item.availableSalePackages!==null))throw Error('تعذر التحقق من توفر المنتجات.');
 return true;
}
