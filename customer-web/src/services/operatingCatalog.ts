import {supabase} from '../lib/supabase';
import type {CatalogRpc} from '../utils/operatingRead';
export {readOperatingCatalog,readCatalog225,quantityFreePayload,validateOperatingCatalog} from '../utils/operatingRead';
export type {CatalogRpc} from '../utils/operatingRead';

/** Literal RPC sites preserve the current role/source audit,including legacy fallback. */
export const operatingCatalogRpc:CatalogRpc=(name,args)=>{
 if(!supabase)throw Error('تعذر الاتصال بكتالوج المتجر.');
 switch(name){
  case 'lite1_preview_guest2':return supabase.rpc('lite1_preview_guest2',args);
  case 'preview_guest_promotion_v2':return supabase.rpc('preview_guest_promotion_v2',args);
  case 'public_storefront_catalog_page225':return supabase.rpc('public_storefront_catalog_page225',args);
  case 'lite1_catalog_page2':return supabase.rpc('lite1_catalog_page2',args);
  case 'get_public_storefront_catalog_page':return supabase.rpc('get_public_storefront_catalog_page',args);
  case 'get_public_parcel_options225':return supabase.rpc('get_public_parcel_options225',args);
  case 'lite1_parcel_options2':return supabase.rpc('lite1_parcel_options2',args);
  case 'get_public_configurable_parcel_options':return supabase.rpc('get_public_configurable_parcel_options',args);
 case 'public_storefront_merchandising225':return supabase.rpc('public_storefront_merchandising225');
  case 'lite1_merchandising2':return supabase.rpc('lite1_merchandising2',args);
  case 'get_public_storefront_merchandising':return supabase.rpc('get_public_storefront_merchandising');
  default:throw Error('UNAPPROVED_CATALOG_RPC');
 }
};
