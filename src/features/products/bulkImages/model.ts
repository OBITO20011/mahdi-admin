import type {Product} from '../../../types';
import type {AuthState} from '../../../stores/useAuthStore';
import {canUseNavigationAction} from '../../more/adminNavigation.config';

export type BulkImageAuth=Pick<AuthState,'isAuthenticated'|'isSessionLocked'|'mfaRequired'|'roleName'|'roles'|'profile'|'user'>;
export function canUploadProductImages(auth:BulkImageAuth):boolean{
 return Boolean(auth.isAuthenticated&&auth.user?.id&&!auth.isSessionLocked&&!auth.mfaRequired&&auth.profile?.is_active!==false
  &&canUseNavigationAction({type:'modal',destination:'add_product'},auth.roleName,auth.roles));
}
export function normalizeImageSku(value:string):string{
 return value.trim().replace(/[\u0660-\u0669\u06f0-\u06f9]/gu,c=>String(c.charCodeAt(0)-(c.charCodeAt(0)<=0x669?0x660:0x6f0))).toUpperCase();
}
export function imageFileSku(name:string):string{return normalizeImageSku(name.replace(/\.[^.]+$/u,''));}
export type MatchKind='matched'|'no_product'|'duplicate'|'ambiguous'|'invalid';
export interface ImageMatch{index:number;file:File;sku:string;kind:MatchKind;product?:Product;error?:string}
export function matchProductImages(files:readonly File[],products:readonly Product[]):ImageMatch[]{
 const catalog=new Map<string,Product[]>(),counts=new Map<string,number>();
 for(const product of products){const key=normalizeImageSku(product.sku);catalog.set(key,[...(catalog.get(key)??[]),product]);}
 for(const file of files){const key=imageFileSku(file.name);counts.set(key,(counts.get(key)??0)+1);}
 return files.map((file,index)=>{
  const sku=imageFileSku(file.name),candidates=catalog.get(sku)??[],base={index,file,sku};
  if(!/\.(jpe?g|png|webp)$/iu.test(file.name)||!sku)return {...base,kind:'invalid',error:'اختر ملف JPG أو PNG أو WebP باسم رمز الصنف.'};
  if((counts.get(sku)??0)>1)return {...base,kind:'duplicate',error:'ملفان أو أكثر لنفس رمز الصنف؛ احذف المكرر قبل الرفع.'};
  if(candidates.length>1)return {...base,kind:'ambiguous',error:'أكثر من منتج له هذا الرمز بعد التطبيع؛ صحح الرموز أولاً.'};
  if(!candidates.length)return {...base,kind:'no_product',error:'لا يوجد منتج أو نكهة بهذا الرمز.'};
  return {...base,kind:'matched',product:candidates[0]};
 });
}
export function activeProductsMissingImages(products:readonly Product[]):Product[]{return products.filter(p=>p.status!=='hidden'&&!p.imageUrl?.trim());}

export interface PreparedImage{file:File;fingerprint:string;thumbnail:Blob;width:number;height:number}
export type RowOutcome='pending'|'working'|'success'|'failed'|'skipped';
export interface BulkImageRow{key:string;match:ImageMatch;prepared?:PreparedImage;previewUrl?:string;preparationError?:string;replace:boolean;outcome:RowOutcome;message?:string}

