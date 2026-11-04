import{useEffect,useState}from'react';
import{useAuthStore}from'../../stores/useAuthStore';
import{UiButton}from'../../components/ui';
import{writeXlsx,XLSX_MIME}from'../../lib/xlsx';
import{GO_LIVE_COLUMNS}from'./goLiveImport';
import{prepareProductWorkbook,readProductWorkbook,productWorkbookStockRows,type ProductWorkbookPlan}from'./productWorkbook';
import{inspectProductWorkbook,saveProductWorkbook,productImportErrorText,productImportContext,productImportStorageKey,loadProductImportAttempt}from'../../services/supabase/productWorkbook.service';
export function ProductWorkbookImportPanel({file,disabled,onSaved}:{file:File;disabled:boolean;onSaved:()=>void}){
 const{user}=useAuthStore();const[plan,setPlan]=useState<ProductWorkbookPlan|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[done,setDone]=useState(false),[progress,setProgress]=useState(0),[pending,setPending]=useState(false);
 useEffect(()=>{let cancelled=false;setPlan(null);setDone(false);setPending(false);setProgress(0);setMessage('');setBusy(true);
  void(async()=>{try{const sheets=await readProductWorkbook(new Uint8Array(await file.arrayBuffer())),value=prepareProductWorkbook(sheets.products,sheets.flavors);value.warnings.push(...sheets.identifierWarnings);if(!value.errors.length){if(!user?.id)throw Error('PRODUCT_IMPORT_ACTOR_CHANGED');const checked=await inspectProductWorkbook(value,user.id,localStorage);value.errors.push(...checked.errors);if(!cancelled)setPending(checked.pending);}if(!cancelled)setPlan(value);}catch(error){if(!cancelled)setMessage(productImportErrorText(error));}finally{if(!cancelled)setBusy(false);}})();return()=>{cancelled=true;};
 },[file,user?.id]);
 const save=async()=>{if(!plan||plan.errors.length||!user?.id||busy)return;setBusy(true);setMessage('');try{await saveProductWorkbook(plan,user.id,localStorage,n=>setProgress(n));setDone(true);setPending(false);setMessage('اكتمل تعريف المنتجات والنكهات وقراءة بياناتها ومطابقتها. لم يُدخل أي مخزون.');onSaved();}catch(error){setPending(true);setMessage(productImportErrorText(error));}finally{setBusy(false);}};
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
   <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[36rem] text-right text-sm"><thead><tr>{['الصنف / النكهة','الرمز النهائي','الباركود','المخزون (باكيت)'].map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>
    {plan.products.flatMap(p=>[{name:p.data.name_ar,sku:p.data.sku,barcode:p.data.barcode,stock:p.flavors.length?null:p.openingStock,group:Boolean(p.flavors.length)},...p.flavors.map(f=>({name:f.name+(f.generatedSku?' (رمز تلقائي)':''),sku:f.sku,barcode:f.barcode,stock:f.openingStock,group:false}))]).map((r,i)=><tr key={i} className="border-t border-nw-border"><td className="p-2">{r.name}</td><td className="p-2"><bdi>{r.sku}</bdi></td><td className="p-2"><bdi>{r.barcode||'—'}</bdi></td><td className="p-2">{r.group?'أساسي للتجميع':r.stock??'يُعبأ بعد الجرد'}</td></tr>)}
   </tbody></table></div>
   <UiButton variant="primary" disabled={disabled||busy||!!plan.errors.length||done} onClick={()=>void save()}>{pending?'استئناف المحاولة ومطابقة بياناتها':'حفظ المنتجات والنكهات ومطابقتها'}</UiButton>
   {done&&<div className="flex flex-wrap gap-2">{stockWarehouses.map(warehouse=><UiButton key={warehouse} onClick={()=>stock(warehouse)}>تنزيل ملف البضاعة الموجودة {warehouse||'(اختر المستودع عند الاستيراد)'}</UiButton>)}<UiButton onClick={()=>void another()}>السماح بملف آخر بعد الاكتمال</UiButton></div>}
   {done&&<p className="m-0 text-sm text-nw-muted">استورد ملف البضاعة من بطاقة «البضاعة الموجودة» واختر المستودع الصحيح؛ الكمية = طرود الشراء وباكيتاتها. إن لم تعبئ المخزون، أكمل الجرد أولاً.</p>}
  </>}
 </section>;
}
