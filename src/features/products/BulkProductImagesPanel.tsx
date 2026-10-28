import React,{useEffect,useRef,useState} from 'react';
import {ImagePlus,ChevronDown,Download,RefreshCw} from 'lucide-react';
import {Card,FormFields,UiButton} from '../../components/ui';
import {useAuthStore} from '../../stores/useAuthStore';
import {useAppStoreActions} from '../../stores/useAppStore';
import {SUPABASE_PUBLIC_CONFIG} from '../../config/supabase-public-config';
import type {Product} from '../../types';
import {activeProductsMissingImages,canUploadProductImages,matchProductImages,type BulkImageRow} from './bulkImages/model';
import {compressProductImage} from './bulkImages/compress';
import {createImageJournal,type ImageJournal} from './bulkImages/journal';
import {bulkImageDependencies,loadBulkImageProducts} from './bulkImages/api';
import {reconcileImage,runBulkImageUpload,withBulkImageLock} from './bulkImages/upload';

const errorText=(error:unknown)=>error instanceof Error?error.message:'تعذر إتمام العملية. أعد المحاولة.';
const statusLabels={matched:'مطابق',no_product:'ملف بلا منتج',duplicate:'رمز مكرر',ambiguous:'رمز ملتبس',invalid:'ملف غير صالح'};
const outcomeLabels={pending:'لم يُرفع',working:'جارٍ الرفع',success:'نجح',failed:'فشل',skipped:'متخطّى'};

/** Collapsed by default;available after go-live too,using the existing edit roles. */
export function BulkProductImagesPanel({onSaved}:{onSaved?:()=>void}){
 const auth=useAuthStore(),authRef=useRef(auth);authRef.current=auth;
 const {cacheProductPage}=useAppStoreActions();
 const [open,setOpen]=useState(false),[products,setProducts]=useState<Product[]>([]),[rows,setRows]=useState<BulkImageRow[]>([]);
 const [busy,setBusy]=useState<'catalog'|'prepare'|'upload'|'cleanup'|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [progress,setProgress]=useState({done:0,total:0}),[ready,setReady]=useState(false),[pendingCount,setPendingCount]=useState(0);
 const mounted=useRef(true),abort=useRef<AbortController|null>(null),urls=useRef(new Set<string>()),journal=useRef<ImageJournal|null>(null);
 const filesInput=useRef<HTMLInputElement>(null),folderInput=useRef<HTMLInputElement>(null);
 const scope=SUPABASE_PUBLIC_CONFIG.SUPABASE_URL+'|'+(auth.user?.id??'');
 const allowed=canUploadProductImages(auth),canEdit=()=>canUploadProductImages(authRef.current)&&SUPABASE_PUBLIC_CONFIG.SUPABASE_URL+'|'+(authRef.current.user?.id??'')===scope;
 const scopeRef=useRef(scope);
 useEffect(()=>{mounted.current=true;const ownedUrls=urls.current;return()=>{mounted.current=false;abort.current?.abort();for(const url of ownedUrls)URL.revokeObjectURL(url);ownedUrls.clear();};},[]);
 useEffect(()=>{if(busy==='upload'){const prevent=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',prevent);return()=>window.removeEventListener('beforeunload',prevent);}},[busy]);
 useEffect(()=>{if(scopeRef.current!==scope){scopeRef.current=scope;abort.current?.abort();journal.current=null;setOpen(false);setReady(false);setRows([]);setProducts([]);for(const url of urls.current)URL.revokeObjectURL(url);urls.current.clear();}},[scope]);

 const initJournal=()=>{
  if(!canEdit()||!authRef.current.user?.id)throw new Error('ليس لديك صلاحية تعديل المنتجات.');
  if(!journal.current)journal.current=createImageJournal(localStorage,SUPABASE_PUBLIC_CONFIG.SUPABASE_URL,authRef.current.user.id);
  return journal.current;
 };
 const updatePending=()=>{if(mounted.current)setPendingCount(journal.current?.all().filter(entry=>entry.stage!=='confirmed').length??0);};
 const refresh=async()=>{
  setBusy('catalog');setError('');setReady(false);
  try{
   initJournal();const all=await loadBulkImageProducts(canEdit,(loaded,total)=>{if(mounted.current)setNotice(`جارٍ تحميل المنتجات والنكهات: ${loaded} (عدد المنتجات الأساسية ${total})…`);});
   if(!mounted.current||scopeRef.current!==scope)return;
   setProducts(all);setRows(previous=>{const matches=matchProductImages(previous.map(row=>row.match.file),all);return previous.map((row,i)=>({...row,match:matches[i],replace:false,outcome:'pending',message:undefined}));});
   setReady(true);setNotice('اسم الملف = رمز الصنف فقط. لا تجري أي مطابقة بأسماء المنتجات.');updatePending();
  }catch(e){if(mounted.current)setError(errorText(e));}finally{if(mounted.current)setBusy(null);}
 };
 const toggle=()=>{if(busy)return;if(!open){setOpen(true);void refresh();}else setOpen(false);};
 const select=async(files:FileList|null)=>{
  if(!files?.length||!canEdit()||busy)return;
  const selected=Array.from(files);if(selected.length>500){setError('اختر حتى 500 صورة في الدفعة الواحدة.');return;}
  setBusy('prepare');setError('');setNotice('جارٍ تجهيز المعاينة محلياً؛ لم يبدأ أي رفع.');setProgress({done:0,total:selected.length});
  for(const url of urls.current)URL.revokeObjectURL(url);urls.current.clear();setRows([]);
  const matches=matchProductImages(selected,products),preparedRows:BulkImageRow[]=new Array(selected.length);let next=0,done=0;
  const worker=async()=>{while(next<selected.length&&mounted.current&&scopeRef.current===scope){const i=next++,match=matches[i];let row:BulkImageRow={key:crypto.randomUUID(),match,replace:false,outcome:'pending'};
   try{if(match.kind==='invalid')throw new Error(match.error);const prepared=await compressProductImage(selected[i]);if(!mounted.current||scopeRef.current!==scope)return;const previewUrl=URL.createObjectURL(prepared.thumbnail);urls.current.add(previewUrl);row={...row,prepared,previewUrl};}
   catch(e){row={...row,preparationError:errorText(e)};}
   preparedRows[i]=row;done++;if(mounted.current)setProgress({done,total:selected.length});
  }};
  try{await Promise.all([worker(),worker()]);if(mounted.current&&scopeRef.current===scope){setRows(preparedRows);setNotice('راجع الجدول واختر «استبدال» فقط للصور التي تريد تغييرها. لم يُرفع أي ملف بعد.');}}
  finally{if(mounted.current)setBusy(null);if(filesInput.current)filesInput.current.value='';if(folderInput.current)folderInput.current.value='';}
 };
 const removeRow=(key:string)=>{
  if(busy)return;const row=rows.find(r=>r.key===key);if(row?.previewUrl){URL.revokeObjectURL(row.previewUrl);urls.current.delete(row.previewUrl);}
  const next=rows.filter(r=>r.key!==key),matches=matchProductImages(next.map(r=>r.match.file),products);setRows(next.map((r,i)=>({...r,match:matches[i]})));
 };
 const run=async(failedOnly=false)=>{
  if(busy||!canEdit())return;
  const selected=failedOnly?rows.filter(row=>row.outcome==='failed'):rows;
  setError('');setBusy('upload');setProgress({done:0,total:selected.length});abort.current=new AbortController();
  setRows(previous=>previous.map(row=>selected.some(r=>r.key===row.key)?{...row,outcome:'working',message:undefined}:row));
  try{
   const deps=bulkImageDependencies(initJournal(),canEdit,product=>cacheProductPage([product]));
   let done=0;
   await withBulkImageLock(scope,()=>runBulkImageUpload(selected,deps,result=>{if(mounted.current){setRows(previous=>previous.map(row=>row.key===result.key?{...row,outcome:result.outcome,message:result.message}:row));setProgress({done:++done,total:selected.length});}},abort.current?.signal));
   if(mounted.current){setNotice('انتهت الدفعة. راجع الناجح والفاشل والمتخطّى أدناه. إعادة المحاولة تتجاوز الصورة المحفوظة سابقاً.');onSaved?.();}
  }catch(e){if(mounted.current){setError(errorText(e));setRows(previous=>previous.map(row=>row.outcome==='working'?{...row,outcome:'pending'}:row));}}
  finally{if(mounted.current){setBusy(null);updatePending();}}
 };
 const cleanup=async()=>{
  if(busy||!canEdit())return;setBusy('cleanup');setError('');
  try{await withBulkImageLock(scope,async()=>{const store=initJournal(),deps=bulkImageDependencies(store,canEdit,product=>cacheProductPage([product]));for(const entry of store.all().filter(e=>e.stage!=='confirmed'))await reconcileImage(entry,deps);});setNotice('تم فحص الرفع السابق. الحالات غير المحسومة تبقى محفوظة؛ أعد اختيار الملفات نفسها للاستئناف.');}
  catch(e){setError(errorText(e));}finally{if(mounted.current){setBusy(null);updatePending();}}
 };
 const download=()=>{
  const report={createdAt:new Date().toISOString(),rows:rows.map(row=>({file:row.match.file.name,sku:row.match.sku,product:row.match.product?.nameAr,status:outcomeLabels[row.outcome],message:row.message??row.preparationError??row.match.error??''})),pendingCleanup:journal.current?.all().filter(entry=>entry.stage!=='confirmed').map(entry=>({sku:entry.sku,file:entry.fileName,storagePath:entry.storagePath,stage:entry.stage}))??[]};
  const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='تقرير-رفع-صور-المنتجات.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 if(!allowed)return null;
 const missing=activeProductsMissingImages(products),duplicates=rows.some(row=>row.match.kind==='duplicate'||row.match.kind==='ambiguous');
 const eligible=rows.filter(row=>row.match.kind==='matched'&&row.prepared),counts={success:rows.filter(row=>row.outcome==='success').length,failed:rows.filter(row=>row.outcome==='failed').length,skipped:rows.filter(row=>row.outcome==='skipped').length};
 return <Card data-testid="bulk-product-images" className="min-w-0">
  <button type="button" onClick={toggle} aria-expanded={open} disabled={Boolean(busy)} className="flex min-h-11 w-full items-center gap-2 text-right font-bold text-nw-text"><ImagePlus className="h-5 w-5 shrink-0 text-nw-info" aria-hidden="true"/>رفع صور المنتجات حسب الرمز<ChevronDown className="ms-auto h-4 w-4" aria-hidden="true"/></button>
  {open&&<section aria-label="رفع صور المنتجات حسب الرمز" className="mt-3 min-w-0 space-y-3">
   <p className="text-sm text-nw-muted">بعد إدخال المنتجات: اختر صوراً مثل SUG-10.jpg وPRG-BBQ.jpg للنكهة. JPG / PNG / WebP حتى 5MB للصورة، وحتى 500 ملف للدفعة. تُجهَّز الصور إلى أقل من 300KB وبضلع لا يتجاوز 1200px قبل الرفع.</p>
   <FormFields className="flex flex-wrap gap-2">
    <input ref={filesInput} aria-label="اختيار ملفات صور متعددة" type="file" multiple accept="image/jpeg,image/png,image/webp" hidden onChange={e=>void select(e.target.files)} />
    <input ref={folderInput} aria-label="اختيار مجلد الصور" type="file" multiple accept="image/jpeg,image/png,image/webp" {...{webkitdirectory:'',directory:''}} hidden onChange={e=>void select(e.target.files)} />
    <UiButton disabled={!ready||Boolean(busy)} onClick={()=>filesInput.current?.click()}>اختيار صور متعددة</UiButton>
    <UiButton disabled={!ready||Boolean(busy)} onClick={()=>folderInput.current?.click()}>اختيار مجلد الصور</UiButton>
    <UiButton disabled={Boolean(busy)} onClick={()=>void refresh()}><RefreshCw className="h-4 w-4" aria-hidden="true"/>تحديث قائمة المنتجات</UiButton>
   </FormFields>
   {notice&&<p role="status" className="text-sm text-nw-muted">{notice}</p>}
   {error&&<p role="alert" className="rounded-xl bg-nw-bad-bg p-3 text-sm text-nw-bad">{error}</p>}
   {busy&&<div className="space-y-1" role="status"><p className="text-sm">{busy==='catalog'?'جارٍ تحميل المنتجات…':busy==='prepare'?'جارٍ تجهيز المعاينة…':busy==='cleanup'?'جارٍ التحقق من الرفع السابق…':`جارٍ الرفع: ${progress.done} / ${progress.total}`}</p>{busy!=='catalog'&&busy!=='cleanup'&&<progress aria-label="تقدم رفع الصور" max={Math.max(1,progress.total)} value={progress.done} className="h-3 w-full"/>}</div>}
   {pendingCount>0&&<div className="space-y-2 rounded-xl bg-nw-warn-bg p-3 text-sm text-nw-warn"><p>هناك {pendingCount} صورة من رفع سابق تحتاج التحقق أو الاستكمال. أعد اختيار الملفات نفسها للاستئناف. لا تحذف سجل المتصفح.</p><UiButton disabled={Boolean(busy)} onClick={()=>void cleanup()}>تحقق من الرفع السابق ونظّف غير المحفوظ</UiButton></div>}
   {ready&&<details><summary className="min-h-11 cursor-pointer py-2 font-semibold">أصناف نشطة بلا صورة: {missing.length}</summary><ul className="max-h-60 space-y-1 overflow-y-auto text-sm">{missing.map(product=><li key={product.id}>{product.nameAr} — <bdi>{product.sku}</bdi>{product.flavorMasterProductId?' · نكهة':''}</li>)}</ul></details>}
   {rows.length>0&&<>
    {duplicates&&<p role="alert" className="text-sm font-semibold text-nw-bad">احذف الملفات ذات الرموز المكررة أو صحح الرموز الملتبسة قبل بدء أي رفع.</p>}
    <div className="max-h-[32rem] overflow-auto rounded-xl border border-nw-border" tabIndex={0} aria-label="معاينة مطابقة الصور">
     <table className="w-full min-w-[640px] text-right text-sm"><thead className="sticky top-0 bg-nw-surface-2"><tr><th className="p-2">الصورة والملف</th><th className="p-2">الصنف</th><th className="p-2">المطابقة</th><th className="p-2">الصورة الحالية</th><th className="p-2">النتيجة</th><th className="p-2">إزالة</th></tr></thead><tbody>{rows.map(row=><tr key={row.key} data-testid="bulk-image-row" className="border-t border-nw-border align-top">
      <td className="p-2"><div className="flex items-center gap-2">{row.previewUrl&&<img src={row.previewUrl} alt={`معاينة ${row.match.file.name}`} width={48} height={48} loading="lazy" className="h-12 w-12 rounded-lg object-contain"/>}<span className="break-all"><bdi>{row.match.file.name}</bdi>{row.prepared&&<small className="block text-nw-muted">{Math.ceil(row.prepared.file.size/1000)}KB · {row.prepared.width}×{row.prepared.height}</small>}</span></div></td>
      <td className="p-2">{row.match.product?.nameAr??'—'}{row.match.product?.flavorMasterProductId&&<span className="block text-xs text-nw-muted">نكهة</span>}<bdi className="block text-xs text-nw-muted">{row.match.sku}</bdi></td>
      <td className="p-2">{row.preparationError?'ملف غير صالح':statusLabels[row.match.kind]}{(row.preparationError??row.match.error)&&<p className="mt-1 max-w-52 text-xs text-nw-bad">{row.preparationError??row.match.error}</p>}</td>
      <td className="p-2">{row.match.product?.imageUrl?<label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={row.replace} disabled={Boolean(busy)} onChange={e=>{const replace=e.target.checked;setRows(previous=>previous.map(r=>r.key===row.key?{...r,replace}:r));}}/>استبدال (الافتراضي: تخطَّ)</label>:'بلا صورة'}</td>
      <td className="p-2"><span className={row.outcome==='failed'?'text-nw-bad':row.outcome==='success'?'text-nw-ok':''}>{outcomeLabels[row.outcome]}</span>{row.message&&<p className="mt-1 max-w-56 text-xs">{row.message}</p>}</td>
      <td className="p-2"><UiButton disabled={Boolean(busy)} onClick={()=>removeRow(row.key)} aria-label={`إزالة ${row.match.file.name}`}>إزالة</UiButton></td>
     </tr>)}</tbody></table>
    </div>
    <p role="status" className="text-sm">نجح: {counts.success} · فشل: {counts.failed} · متخطّى: {counts.skipped}</p>
    <div className="flex flex-wrap gap-2"><UiButton variant="primary" disabled={Boolean(busy)||duplicates||!eligible.length} onClick={()=>void run()}>تأكيد رفع الصور المطابقة</UiButton><UiButton disabled={Boolean(busy)||duplicates||!counts.failed} onClick={()=>void run(true)}>أعد المحاولة للفاشل</UiButton><UiButton disabled={Boolean(busy)} onClick={download}><Download className="h-4 w-4" aria-hidden="true"/>تنزيل تقرير الرفع والتنظيف</UiButton></div>
   </>}
  </section>}
 </Card>;
}
