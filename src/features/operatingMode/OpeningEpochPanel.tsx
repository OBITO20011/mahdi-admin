import {useEffect,useRef,useState} from 'react';
import {Modal} from '../../components/common/Modal';
import {UiButton} from '../../components/ui';
import {readXlsxFirstSheet,writeXlsx,XLSX_MAX_ROWS,XLSX_MIME} from '../../lib/xlsx';
import {activateOpeningEpoch,previewOpeningEpoch,readEpochCatalog,readOpeningEpochAttempt,recoverOpeningEpoch,type EpochAttempt} from '../../services/supabase/openingEpoch.service';
import {epochTemplate,parseEpochSheet,type EpochCatalogRow,type EpochPreview,type EpochRow} from './openingEpoch';
import {useOperatingMode} from './operatingModeContext';
const unresolved=(attempt:EpochAttempt|null)=>!!attempt&&['PREPARED','IN_FLIGHT','OUTCOME_UNKNOWN'].includes(attempt.status);
export function OpeningEpochPanel({actorId}:{actorId:string}){
 const mode=useOperatingMode(),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[catalog,setCatalog]=useState<EpochCatalogRow[]>([]),[rows,setRows]=useState<EpochRow[]>([]),[notes,setNotes]=useState(''),[preview,setPreview]=useState<EpochPreview|null>(null),[attempt,setAttempt]=useState<EpochAttempt|null>(null),[error,setError]=useState(''),[issues,setIssues]=useState<string[]>([]),[confirmed,setConfirmed]=useState(false);
 const lock=useRef(false),alive=useRef(true),state=useRef({mode:mode.mode,verified:mode.verified});state.current={mode:mode.mode,verified:mode.verified};
 useEffect(()=>{alive.current=true;try{setAttempt(readOpeningEpochAttempt(actorId,localStorage));}catch{setError('تعذر قراءة سجل التفعيل المحفوظ؛ لا تمسحه ولا تبدأ محاولة جديدة. (EPOCH-02)');}return()=>{alive.current=false;};},[actorId]);
 const readJournal=()=>{const saved=readOpeningEpochAttempt(actorId,localStorage);if(alive.current)setAttempt(saved);return saved;};
 const work=async(run:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await run();}catch{if(alive.current){try{readJournal();}catch{setError('سجل التفعيل غير قابل للتحقق؛ احتفظ به وراجع المطوّر. (EPOCH-02)');return;}setError('تعذّر إتمام الخطوة. راجع المصادقة الثنائية وإغلاق الورديات والطلبات وصحة الجرد. إن كانت النتيجة مجهولة استخدم استرجاع المحاولة فقط. (EPOCH-01)');}}finally{lock.current=false;if(alive.current)setBusy(false);}};
 const launch=()=>void work(async()=>{setOpen(true);const saved=readJournal();if(unresolved(saved)||state.current.mode!=='sales-only'||!state.current.verified)return;const data=await readEpochCatalog(actorId);if(!alive.current||state.current.mode!=='sales-only'||!state.current.verified)return;if(data.length>XLSX_MAX_ROWS)throw Error('EPOCH_WORKSHEET_TOO_LARGE');setCatalog(data);setRows([]);setPreview(null);setConfirmed(false);setIssues([]);});
 const download=()=>{const bytes=writeXlsx([{name:'جرد التفعيل',rows:epochTemplate(catalog),widths:[24,36,26,26,26,40,40]},{name:'تعليمات',rows:[['جرد فعلي بتاريخ تفعيل المحاسبة؛ لا تستعمل كميات مخزّنة قديمة.'],['املأ كل الأسطر؛ صفر صريح للصنف المعدوم. التكلفة الواحدة للصنف في كل المستودعات، وبثلاث خانات كحد أقصى.'],['النكهات تُجرد منفردة؛ المنتج الأساسي للعائلة ليس له مخزون.'],['لا تحذف أو تغيّر المعرفات. أغلق الورديات والطلبات المعلقة وأوقف الكتابة خلال التفعيل.'],['تبقى الديون والفواتير القديمة؛ لا تُستعاد أرباح المبيعات السابقة.']],widths:[110]}]);const url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:XLSX_MIME})),a=document.createElement('a');a.href=url;a.download='جرد-تفعيل-المحاسبة.xlsx';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);};
 const upload=(file:File)=>void work(async()=>{if(unresolved(readJournal())||state.current.mode!=='sales-only'||!state.current.verified)return;const data=await readXlsxFirstSheet(await file.arrayBuffer());if(!alive.current||state.current.mode!=='sales-only'||!state.current.verified)return;const parsed=parseEpochSheet(data,catalog);setRows(parsed.rows);setIssues(parsed.errors);setPreview(null);setConfirmed(false);});
 const inspect=()=>void work(async()=>{if(unresolved(readJournal())||state.current.mode!=='sales-only'||!state.current.verified)return;const result=await previewOpeningEpoch(actorId,rows,notes);if(!alive.current||state.current.mode!=='sales-only'||!state.current.verified)return;setPreview(result);setConfirmed(false);});
 const apply=()=>void work(async()=>{if(!preview||!confirmed||unresolved(readJournal())||state.current.mode!=='sales-only'||!state.current.verified)return;await activateOpeningEpoch(actorId,preview,notes,localStorage,attempt!==null);if(!alive.current)return;readJournal();setConfirmed(false);await mode.refresh();});
 const recover=()=>void work(async()=>{await recoverOpeningEpoch(actorId,localStorage);if(!alive.current)return;readJournal();setConfirmed(false);await mode.refresh();});
 return <div className="space-y-2">
  {(mode.mode==='sales-only'||unresolved(attempt))&&<UiButton disabled={busy||!mode.verified} onClick={launch}>جرد تفعيل المحاسبة</UiButton>}
  {error&&!open&&<p role="alert">{error}</p>}
  <Modal isOpen={open} onClose={()=>setOpen(false)} title="جرد تفعيل المحاسبة" maxWidth="max-w-3xl" confirmUnsavedClose closeDisabled={busy}>
   <div className="space-y-4" dir="rtl">
    <p>للمالك مع المصادقة الثنائية. أغلق كل الورديات وأنهِ الطلبات المعلقة وأوقف البيع أثناء الجرد والتفعيل. يُنفّذ الجرد والكميات والتكاليف وقلب الوضع في معاملة واحدة.</p>
    <p className="text-sm text-nw-muted">لا يُعاد فتح بداية التشغيل. تبقى الفواتير والديون بمعرّفاتها؛ مرتجع فاتورة مبسّطة يبقى بلا مخزون، وربح المبيعات السابقة غير قابل للاسترجاع.</p>
    {error&&<p role="alert" className="text-nw-bad">{error}</p>}
    {attempt?.status==='SUCCEEDED'&&<p role="status">اكتملت المحاولة المحفوظة. مرجع التفعيل: <span dir="ltr">{attempt.result?.epochId}</span>. وضع التشغيل المعروض أعلى الصفحة مصدره قراءة الخادم.</p>}
    {unresolved(attempt)?<section aria-label="محاولة تفعيل محفوظة" className="space-y-3 border border-nw-warn p-3"><p>لم تُحسم هذه المحاولة محلياً. لا تبدأ جرداً أو مفتاحاً جديداً؛ استرجع نفس الطلب والبصمة. السطور: {attempt?.rows.length}.</p><UiButton disabled={busy} onClick={recover}>استرجاع محاولة التفعيل</UiButton></section>:mode.mode==='sales-only'&&<>
     <p>القالب يشمل {catalog.length} سطراً: كل صنف فعّال (بما فيه النكهات) في كل مستودع فعّال. الكميات الفعلية والتكاليف فارغة عمداً. الحد المحلي للملف {XLSX_MAX_ROWS} سطر.</p>
     <UiButton disabled={busy||!catalog.length||!mode.verified} onClick={download}>تنزيل قالب جرد التفعيل</UiButton>
     <label className="block">ملف جرد التفعيل<input aria-label="ملف جرد التفعيل" type="file" accept=".xlsx" disabled={busy||!catalog.length||!mode.verified} onChange={e=>{const f=e.currentTarget.files?.[0];e.currentTarget.value='';if(f)upload(f);}} className="block min-h-11 w-full text-base"/></label>
     {issues.length>0&&<div role="alert"><p>الملف مرفوض: {issues.length} ملاحظة.</p><ul>{issues.map((issue,i)=><li key={i}>{issue}</li>)}</ul></div>}
     {rows.length>0&&<p role="status">جرد صالح للمعاينة: {rows.length} سطراً.</p>}
     <label className="block">ملاحظة وتاريخ الجرد الفعلي<textarea aria-label="ملاحظة وتاريخ الجرد الفعلي" minLength={5} maxLength={500} rows={3} value={notes} disabled={busy||!mode.verified} onChange={e=>{setNotes(e.target.value);setPreview(null);setConfirmed(false);}} className="block w-full rounded-xl border border-nw-border bg-nw-surface p-3 text-base"/></label>
     <UiButton disabled={busy||!rows.length||notes.trim().length<5||!mode.verified} onClick={inspect}>معاينة جرد التفعيل — بلا كتابة</UiButton>
     {preview&&<section aria-label="معاينة جرد التفعيل" className="space-y-3 rounded-xl border border-nw-border p-3"><p>السطور: {preview.rows.length}؛ مجموع الباكيتات: {preview.totalQuantity}؛ قيمة الجرد: {preview.totalValueExact} فلس.</p><p className="text-xs break-all" dir="ltr">{preview.fingerprint}</p><label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={busy||!mode.verified} onChange={e=>setConfirmed(e.target.checked)}/>أعتمد الجرد والتكاليف وأؤكد تفعيل المحاسبة والمخزون الآن</label><UiButton disabled={busy||!confirmed||!mode.verified} onClick={apply}>تفعيل المحاسبة بالجرد المعتمد</UiButton></section>}
    </>}
   </div>
  </Modal>
 </div>;
}
