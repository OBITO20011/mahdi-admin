import type {Product} from '../../../types';
import type {ImageJournal,ImageJournalEntry} from './journal';
import {normalizeImageSku,type BulkImageRow} from './model';

export interface BulkImageDependencies{
 canEdit:()=>boolean;
 journal:ImageJournal;
 readProduct:(id:string)=>Promise<Product|null>;
 upload:(file:File,before:(intent:{storagePath:string;publicUrl:string})=>void,resumePath?:string)=>Promise<{success:boolean;publicUrl?:string;storagePath?:string;error?:string;uncertain?:boolean}>;
 save:(product:Product,url:string)=>Promise<{success:boolean;error?:string;uncertain?:boolean}>;
 remove:(path:string)=>Promise<boolean>;
 hasReference:(entry:ImageJournalEntry)=>Promise<boolean>;
}
export interface ImageRowResult{key:string;outcome:'success'|'skipped'|'failed';message:string}
const message=(error:unknown)=>error instanceof Error?error.message:'تعذر إتمام رفع الصورة. أعد المحاولة.';
const assertPermission=(deps:BulkImageDependencies)=>{if(!deps.canEdit())throw new Error('ليس لديك صلاحية تعديل المنتجات. سجّل الدخول بالحساب المخوّل.');};

/** A fresh server read always precedes deletion:never delete a possibly committed image. */
export async function reconcileImage(entry:ImageJournalEntry,deps:BulkImageDependencies):Promise<'confirmed'|'retained'|'removed'|'pending'>{
 assertPermission(deps);
 try{
  const current=await deps.readProduct(entry.productId);
  if(current?.imageUrl===entry.publicUrl){deps.journal.put({...entry,stage:'confirmed',at:Date.now()});return 'confirmed';}
  if(await deps.hasReference(entry)){deps.journal.put({...entry,stage:'confirmed',at:Date.now()});return 'retained';}
  // A transport failure is not a rollback proof. Replaying the same path/RPC
  // resolves it;never delete while an earlier server write may still commit.
  if(entry.stage==='prepared'||entry.stage==='uncertain')return 'pending';
  // Persist the deletion phase before deleting bytes. If the final journal
  // removal fails, a retry must not reuse a now-deleted Storage object.
  deps.journal.put({...entry,stage:'cleanup_pending',at:Date.now()});
  if(!await deps.remove(entry.storagePath)){deps.journal.put({...entry,stage:'cleanup_pending',at:Date.now()});return 'pending';}
  deps.journal.remove(entry.productId,entry.fingerprint);return 'removed';
 }catch{
  // The durable prepared entry survives a quota/read/network failure too.
  try{deps.journal.put({...entry,stage:entry.stage==='prepared'||entry.stage==='uncertain'?entry.stage:'cleanup_pending',at:Date.now()});}catch{/* Preserve the existing durable intent. */}
  return 'pending';
 }
}

async function uploadRow(row:BulkImageRow,deps:BulkImageDependencies):Promise<ImageRowResult>{
 const result=(outcome:ImageRowResult['outcome'],text:string):ImageRowResult=>({key:row.key,outcome,message:text});
 if(row.match.kind!=='matched'||!row.match.product)return result('skipped',row.match.error??'هذا الملف غير مطابق.');
 if(!row.prepared)return result('failed',row.preparationError??'لم تُجهّز الصورة.');
 const original=row.match.product,prepared=row.prepared;
 let entry=deps.journal.get(original.id,prepared.fingerprint);
 const wasUncertainSave=entry?.stage==='uncertain';
 try{
  assertPermission(deps);
  const current=await deps.readProduct(original.id);
  if(!current||normalizeImageSku(current.sku)!==row.match.sku)throw new Error('تغيّر رمز الصنف أو حُذف المنتج. حدّث المعاينة أولاً.');
  if(entry&&current.imageUrl===entry.publicUrl){deps.journal.put({...entry,stage:'confirmed',at:Date.now()});return result('skipped','رُفعت وحُفظت هذه الصورة سابقاً.');}
  if(entry&&entry.stage==='cleanup_pending'){
   const recovery=await reconcileImage(entry,deps);
   if(recovery==='confirmed')return result('skipped','رُفعت وحُفظت هذه الصورة سابقاً.');
   if(recovery==='retained')return result('skipped','الصورة محفوظة ضمن صور الأصناف؛ تغيّرت الصورة الرئيسية. حدّث المعاينة قبل الاستبدال.');
   if(recovery==='pending')return result('failed','تعذّر التحقق أو تنظيف رفع سابق. أعد المحاولة قبل رفع ملف جديد.');
   entry=undefined;
  }
  if((current.imageUrl??'')!==(original.imageUrl??''))throw new Error('تغيّرت صورة المنتج بعد المعاينة. حدّث المعاينة وراجع خيار الاستبدال.');
  if(current.imageUrl&&!row.replace){
   if(entry&&(entry.stage==='prepared'||entry.stage==='uncertain'))return result('failed','رفع سابق لم يُحسم بعد. راجع الصورة واختر الاستبدال صراحة للاستئناف، أو تواصل مع المطوّر للتنظيف.');
   if(entry&&entry.stage==='uploaded'&&await reconcileImage(entry,deps)==='pending')return result('failed','تنظيف الصورة غير المحفوظة معلّق؛ أعد المحاولة.');
   return result('skipped','لديه صورة حالياً؛ لم تختر استبدالها.');
  }
  if(!current.updatedAt)throw new Error('تعذر تثبيت نسخة المنتج. حدّث المعاينة أولاً.');
  if(entry?.stage==='confirmed'){
   if(await deps.hasReference(entry))entry={...entry,stage:'uploaded',previousImageUrl:current.imageUrl??''};
   else{const clean=await reconcileImage(entry,deps);if(clean==='pending')return result('failed','تنظيف رفع سابق معلّق؛ أعد المحاولة قبل رفع ملف جديد.');if(clean!=='removed')return result('skipped','تم التحقق من وجود الصورة؛ حدّث المعاينة.');entry=undefined;}
  }
  if(!entry||entry.stage==='prepared'){
   const resumePath=entry?.storagePath;
   const intentHolder:{entry?:ImageJournalEntry}={};
   const uploaded=await deps.upload(prepared.file,intent=>{
    assertPermission(deps);
    const intentEntry:ImageJournalEntry={...intent,productId:current.id,fingerprint:prepared.fingerprint,sku:current.sku,fileName:row.match.file.name,previousImageUrl:current.imageUrl??'',stage:'prepared',at:Date.now()};
    deps.journal.put(intentEntry);intentHolder.entry=intentEntry;entry=intentEntry;
   },resumePath);
   if(!uploaded.success||!uploaded.publicUrl||!uploaded.storagePath){
    throw new Error(uploaded.error??'تعذر رفع الصورة.');
   }
   const intent=intentHolder.entry;
   if(!intent||intent.publicUrl!==uploaded.publicUrl||intent.storagePath!==uploaded.storagePath)throw new Error('تعذر ربط نتيجة الرفع بسجل الاستئناف.');
   entry={...intent,stage:'uploaded',at:Date.now()};deps.journal.put(entry);
  }
  assertPermission(deps);
  entry={...entry,stage:'uncertain',at:Date.now()};deps.journal.put(entry);
  const saved=await deps.save(current,entry.publicUrl);
  if(!saved.success){
   if(!saved.uncertain&&!wasUncertainSave){entry={...entry,stage:'uploaded'};deps.journal.put(entry);}
   throw new Error(saved.error??'تعذر حفظ صورة المنتج.');
  }
  deps.journal.put({...entry,stage:'confirmed',at:Date.now()});
  return result('success','تم رفع الصورة وحفظها.');
 }catch(error){
  const reason=message(error);
  if(entry&&entry.stage!=='confirmed'){
   const reconciled=await reconcileImage(entry,deps).catch(()=>'pending' as const);
   if(reconciled==='confirmed')return result('success','تم التحقق من حفظ الصورة بعد انقطاع الرد.');
   if(reconciled==='retained')return result('skipped','الصورة محفوظة ضمن صور الأصناف؛ لم تُحذف. راجع الصورة الرئيسية قبل الاستبدال.');
   if(reconciled==='pending')return result('failed',reason+' التحقق والتنظيف معلّقان في سجل الاستئناف؛ أعد المحاولة.');
  }
  return result('failed',reason);
 }
}

/** Exactly two workers; a route change stops new work after in-flight cleanup. */
export async function runBulkImageUpload(rows:readonly BulkImageRow[],deps:BulkImageDependencies,onRow:(result:ImageRowResult)=>void,signal?:AbortSignal):Promise<ImageRowResult[]>{
 assertPermission(deps);
 if(rows.some(row=>row.match.kind==='duplicate'||row.match.kind==='ambiguous'))throw new Error('صحح الرموز المكررة أو الملتبسة في المعاينة قبل أي رفع.');
 let next=0;const results:ImageRowResult[]=[];
 const worker=async()=>{while(next<rows.length&&!signal?.aborted){const row=rows[next++];const result=await uploadRow(row,deps);results.push(result);onRow(result);}};
 await Promise.all([worker(),worker()]);return results;
}

export async function withBulkImageLock<T>(scope:string,work:()=>Promise<T>):Promise<T>{
 if(!navigator.locks)throw new Error('المتصفح لا يدعم الاستئناف الآمن هنا. افتح آخر إصدار من Chrome أو Safari.');
 return navigator.locks.request('nawasrah-bulk-images:'+scope,{ifAvailable:true},async lock=>{
  if(!lock)throw new Error('هناك رفع صور جارٍ في نافذة أخرى. انتظر اكتماله ثم أعد المحاولة.');return work();
 });
}
