import type {ImportOperatingMode} from './goLiveImport';
import{useEffect,useMemo,useState,useRef}from'react';
import{useAuthStore}from'../../stores/useAuthStore';
import{UiButton,formatJod}from'../../components/ui';
import{writeXlsx,XLSX_MIME}from'../../lib/xlsx';
import{GO_LIVE_COLUMNS}from'./goLiveImport';
import{prepareProductWorkbook,readProductWorkbook,productWorkbookStockRows,type ProductWorkbookPlan}from'./productWorkbook';
import{inspectProductWorkbook,saveProductWorkbook,productImportErrorText,productImportContext,productImportStorageKey,loadProductImportAttempt}from'../../services/supabase/productWorkbook.service';
const previewPageSize=100;
type PreviewRow={singlePrice?:string;parcelPrice:string;name:string;sku:string;barcode:string;stock:number|null;group:boolean};
function previewPages(plan:ProductWorkbookPlan|null){
 const pages:PreviewRow[][]=[[]];
 for(const p of plan?.products??[]){
  const prices={singlePrice:p.singlePriceInMinorUnits,parcelPrice:p.data.sale_package_price_in_minor_units};
  const family=[{...prices,name:p.data.name_ar,sku:p.data.sku,barcode:p.data.barcode,stock:p.flavors.length?null:p.openingStock,group:Boolean(p.flavors.length)},...p.flavors.map(f=>({...prices,name:f.name+(f.generatedSku?' (رمز تلقائي)':''),sku:f.sku,barcode:f.barcode,stock:f.openingStock,group:false}))];
  if(pages.at(-1)!.length&&pages.at(-1)!.length+family.length>previewPageSize)pages.push([]);
  for(const row of family){if(pages.at(-1)!.length===previewPageSize)pages.push([]);pages.at(-1)!.push(row);}
 }
 return pages;
}
export function ProductWorkbookImportPanel({file,disabled,onSaved,onBusyChange,operatingMode='full'}:{file:File;disabled:boolean;onSaved:()=>void;onBusyChange?:(busy:boolean)=>void;operatingMode?:ImportOperatingMode}){
 const requestVersion=useRef(0);
 const{user}=useAuthStore();const[plan,setPlan]=useState<ProductWorkbookPlan|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[done,setDone]=useState(false),[progress,setProgress]=useState(0),[pending,setPending]=useState(false);
 const[page,setPage]=useState(0),pages=useMemo(()=>previewPages(plan),[plan]);
 useEffect(()=>{onBusyChange?.(busy);},[busy,onBusyChange]);
 useEffect(()=>()=>onBusyChange?.(false),[onBusyChange]);
 useEffect(()=>{const version=++requestVersion.current;let cancelled=false;setPlan(null);setPage(0);setDone(false);setPending(false);setProgress(0);setMessage('');setBusy(true);
  void(async()=>{try{const sheets=await readProductWorkbook(new Uint8Array(await file.arrayBuffer())),value=prepareProductWorkbook(sheets.products,sheets.flavors,operatingMode);value.warnings.push(...sheets.identifierWarnings);if(!value.errors.length){if(!user?.id)throw Error('PRODUCT_IMPORT_ACTOR_CHANGED');const checked=await inspectProductWorkbook(value,user.id,localStorage);value.errors.push(...checked.errors);if(!cancelled)setPending(checked.pending);}if(!cancelled)setPlan(value);}catch(error){if(!cancelled)setMessage(productImportErrorText(error));}finally{if(!cancelled)setBusy(false);}})();return()=>{cancelled=true;requestVersion.current=version+1;};
 },[file,user?.id,operatingMode]);
 const save=async()=>{if(!plan||plan.errors.length||!user?.id||busy)return;const version=requestVersion.current;setBusy(true);setMessage('');try{await saveProductWorkbook(plan,user.id,localStorage,n=>{if(version===requestVersion.current)setProgress(n);});if(version===requestVersion.current){setDone(true);setPending(false);setMessage('اكتمل تعريف المنتجات والنكهات وقراءة بياناتها ومطابقتها. لم يُدخل أي مخزون.');}onSaved();}catch(error){if(version===requestVersion.current){setPending(true);setMessage(productImportErrorText(error));}}finally{if(version===requestVersion.current)setBusy(false);}};
 const stock=(warehouse:string)=>{if(!plan||!done)return;const items=productWorkbookStockRows(plan).filter(r=>(r.warehouse??'')===warehouse);const rows=[GO_LIVE_COLUMNS.stock.map(c=>c.header),...items.map(r=>GO_LIVE_COLUMNS.stock.map(c=>({code:r.sku,product_name:'',package_count:String(r.packageCount),loose_units:String(r.looseUnits)}[c.key]??'')))];const bytes=writeXlsx([{name:'البيانات',rows}]);const url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:XLSX_MIME}));const a=document.createElement('a');a.href=url;a.download=stockWarehouses.length>1?'البضاعة-الموجودة-'+(warehouse||'اختر-المستودع').replace(/[^\p{L}\p{N}_-]/gu,'_')+'.xlsx':'البضاعة-الموجودة.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 const stockWarehouses=plan?[...new Set(productWorkbookStockRows(plan).map(r=>r.warehouse??''))]:[];
 const another=async()=>{if(!done||!user?.id)return;try{const c=await productImportContext(user.id),key=productImportStorageKey(user.id,c.project),attempt=loadProductImportAttempt(localStorage,key);if(!attempt?.entries.every(e=>e.complete))throw Error('PRODUCT_IMPORT_ATTEMPT_MISMATCH');localStorage.removeItem(key);setMessage('يمكنك الآن اختيار ملف آخر. المنتجات المحفوظة لا تُستورد من جديد.');}catch(e){setMessage(productImportErrorText(e));}};
 return <section className="space-y-3" data-testid="product-workbook-preview" aria-label="معاينة المنتجات والنكهات">
  <p className="m-0 font-bold">معاينة الملف: {file.name}</p>
  <p className="m-0 text-sm text-nw-muted">التعريف أولاً، ثم تثبيت بيانات النكهات ومطابقتها. عند الانقطاع اختر الملف نفسه واستأنف؛ لا تبدأ محاولة جديدة.</p>
  {busy&&<p role="status">{plan?`جارٍ حفظ ومطابقة ${progress} من ${plan.products.length}`:'جارٍ فحص الملف والمرجع…'}</p>}
  {message&&<p role={done?'status':'alert'} className="m-0 rounded-xl border border-nw-border p-3">{message}</p>}
  {plan&&<>
   <p className="m-0">منتجات أساسية: {plan.products.length} · نكهات: {plan.products.reduce((n,p)=>n+p.flavors.length,0)}</p>
   {plan.warnings.map((w,i)=><p key={i} className="m-0 text-sm text-nw-warn">{w.message}</p>)}
   {!!plan.errors.length&&<ul className="m-0 space-y-1 ps-5 text-sm text-nw-bad" role="alert">{plan.errors.slice(0,200).map((e,i)=><li key={i}>{e.sheet??'المنتجات'}، السطر {e.row}: {e.message}</li>)}</ul>}
   {pages.length>1&&<nav aria-label="صفحات معاينة الملف" className="flex flex-wrap items-center gap-2"><UiButton disabled={page===0} onClick={()=>setPage(p=>p-1)}>السابق</UiButton><span aria-live="polite">صفحة {page+1} من {pages.length}</span><UiButton disabled={page>=pages.length-1} onClick={()=>setPage(p=>p+1)}>التالي</UiButton></nav>}
   <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[36rem] text-right text-sm"><thead><tr>{['الصنف / النكهة','الرمز النهائي','الباركود',...(operatingMode==='sales-only'?['سعر الوحدة المفردة','سعر طرد البيع']:[]),operatingMode==='sales-only'?'التوفر':'المخزون (باكيت)'].map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>
    {(pages[page]??[]).map((r,i)=><tr key={i} className="border-t border-nw-border"><td className="p-2">{r.name}</td><td className="p-2"><bdi>{r.sku}</bdi></td><td className="p-2"><bdi>{r.barcode||'—'}</bdi></td>{operatingMode==='sales-only'&&<><td className="p-2">{formatJod(Number(r.singlePrice)/1000)}</td><td className="p-2">{formatJod(Number(r.parcelPrice)/1000)}</td></>}<td className="p-2">{r.group?'أساسي للتجميع':operatingMode==='sales-only'?'يدوي من بطاقة المنتج':r.stock??'يُعبأ بعد الجرد'}</td></tr>)}
   </tbody></table></div>
   <UiButton variant="primary" disabled={disabled||busy||!!plan.errors.length||done} onClick={()=>void save()}>{pending?'استئناف المحاولة ومطابقة بياناتها':'حفظ المنتجات والنكهات ومطابقتها'}</UiButton>
   {done&&<div className="flex flex-wrap gap-2">{stockWarehouses.map(warehouse=><UiButton key={warehouse} onClick={()=>stock(warehouse)}>تنزيل ملف البضاعة الموجودة {warehouse||'(اختر المستودع عند الاستيراد)'}</UiButton>)}<UiButton onClick={()=>void another()}>السماح بملف آخر بعد الاكتمال</UiButton></div>}
   {done&&operatingMode==='full'&&<p className="m-0 text-sm text-nw-muted">استورد ملف البضاعة من بطاقة «البضاعة الموجودة» واختر المستودع الصحيح؛ الكمية = طرود الشراء وباكيتاتها. إن لم تعبئ المخزون، أكمل الجرد أولاً.</p>}
  </>}
 </section>;
}
