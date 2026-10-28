import {fetchAdminProductById,fetchAdminProductPage} from '../../../services/supabase/products.service';
import {uploadProductImageToSupabase,saveProductPrimaryImage,isUploadedImageReferenced,removeBulkUploadedProductImage} from '../../../services/supabase/product-images.service';
import type {Product} from '../../../types';
import type {ImageJournal} from './journal';
import type {BulkImageDependencies} from './upload';
import {normalizeImageSku} from './model';

export async function loadBulkImageProducts(canEdit:()=>boolean,onPage:(loaded:number,total:number)=>void):Promise<Product[]>{
 if(!canEdit())throw new Error('ليس لديك صلاحية تعديل المنتجات.');
 const first=await fetchAdminProductPage({page:1,pageSize:100,status:'all',sort:'name'}),rows=[...first.products];
 onPage(rows.length,first.totalCount);
 for(let page=2;page<=first.totalPages;page++){
  if(!canEdit())throw new Error('تغيّرت الجلسة أو الصلاحية؛ توقف تحميل المنتجات.');
  const next=await fetchAdminProductPage({page,pageSize:100,status:'all',sort:'name'});
  if(next.totalCount!==first.totalCount)throw new Error('تغيّرت قائمة المنتجات أثناء تحميلها؛ أعد تحديث القائمة.');
  rows.push(...next.products);onPage(rows.length,first.totalCount);
 }
 const byId=new Map(rows.map(product=>[product.id,product]));
 if(byId.size!==rows.length||rows.filter(product=>!product.flavorMasterProductId).length!==first.totalCount)throw new Error('لم تكتمل قائمة المنتجات. حدّث القائمة قبل اختيار الصور.');
 return rows;
}

export function bulkImageDependencies(journal:ImageJournal,canEdit:()=>boolean,onFresh:(product:Product)=>void):BulkImageDependencies{
 const read=async(id:string)=>{if(!canEdit())throw new Error('ليس لديك صلاحية تعديل المنتجات.');const product=await fetchAdminProductById(id,'any');if(product)onFresh(product);return product;};
 return {journal,canEdit,readProduct:read,upload:uploadProductImageToSupabase,remove:removeBulkUploadedProductImage,
  hasReference:entry=>isUploadedImageReferenced(entry.publicUrl),
  save:async(product,url)=>{
   if(!canEdit())return {success:false,error:'ليس لديك صلاحية تعديل المنتجات.'};
   const latest=await read(product.id);
   if(latest?.imageUrl===url)return {success:true};
   if(!latest||normalizeImageSku(latest.sku)!==normalizeImageSku(product.sku)||(latest.imageUrl??'')!==(product.imageUrl??''))return {success:false,error:'تغيّر رمز الصنف أو صورته؛ حدّث المعاينة قبل الاستبدال.'};
   const result=await saveProductPrimaryImage(product.id,url);
   if(result.success){try{await read(product.id);}catch{/* The committed image remains successful;the page can refresh later. */}}
   return result;
  }};
}
