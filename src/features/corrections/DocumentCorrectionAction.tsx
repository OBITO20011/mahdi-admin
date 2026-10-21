import {useEffect,useState} from 'react';
import {Modal} from '../../components/common/Modal';
import {MoneyText,UiButton} from '../../components/ui';
import {useAuthStore} from '../../stores/useAuthStore';
import {hasNavigationRole} from '../more/adminNavigation.config';
import {PAYMENT_METHOD_LABELS} from '../orders/orderStatus';
import {correctionRecord,correctionRoles,correctionTitles,type CorrectionAction,type CorrectionPreview} from '../../utils/documentCorrection';
import {correctionRecovery,fetchCorrectionPreview,submitDocumentCorrection} from '../../services/supabase/documentCorrections.service';

function CorrectionDialog({action,recordId,onClose,onChanged}:{action:CorrectionAction;recordId:string;onClose:()=>void;onChanged:()=>void|Promise<void>}) {
  const [preview,setPreview]=useState<CorrectionPreview|null>(null),[reason,setReason]=useState('');
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[recover,setRecover]=useState(false),[done,setDone]=useState(false);
  const load=async()=>{
    setLoading(true);setError('');setPreview(null);
    try{const saved=await correctionRecovery(action,recordId);if(saved){setPreview(saved.preview);setReason(saved.reason);setRecover(true);}else{setRecover(false);setPreview(await fetchCorrectionPreview(action,recordId));}}
    catch(e){setError(e instanceof Error?e.message:'تعذر تحميل المعاينة.');}
    finally{setLoading(false);}
  };
  useEffect(()=>{let active=true;void (async()=>{
    try{const saved=await correctionRecovery(action,recordId);if(!active)return;if(saved){setPreview(saved.preview);setReason(saved.reason);setRecover(true);}else{const p=await fetchCorrectionPreview(action,recordId);if(active)setPreview(p);}}
    catch(e){if(active)setError(e instanceof Error?e.message:'تعذر تحميل المعاينة.');}
    finally{if(active)setLoading(false);}
  })();return()=>{active=false;};},[action,recordId]);
  const submit=async()=>{
    if(busy||!preview)return;setBusy(true);setError('');
    try{await submitDocumentCorrection(action,recordId,recover?undefined:{preview,reason});setDone(true);setRecover(false);
      try{await onChanged();}catch{setError('نجح التصحيح؛ تعذر تحديث الشاشة. أعد تحميل المستند.');}}
    catch(e){setError(e instanceof Error?e.message:'تعذر التصحيح.');try{const saved=await correctionRecovery(action,recordId);setRecover(!!saved);}catch{setRecover(true);}}
    finally{setBusy(false);}
  };
  return <Modal isOpen title={correctionTitles[action]} onClose={onClose} closeDisabled={busy} trackChanges={false}>
    <div className="space-y-4" dir="rtl" aria-busy={busy} data-testid="document-correction-dialog">
      {loading&&<p role="status">جارٍ تحميل معاينة التصحيح…</p>}
      {error&&<p role="alert" className="text-sm text-nw-warn">{error}</p>}
      {done?<><p role="status">تم التصحيح وحُفظ أثره التدقيقي.</p><UiButton onClick={onClose}>إغلاق</UiButton></>:<>
        {preview&&<>
          <p className="font-bold">المستند: <bdi>{preview.reference}</bdi></p>
          {action!=='purchase_receipt'&&<p className="text-sm">القيمة الأصلية: <MoneyText amount={preview.effect.paymentInMinorUnits/1000} currency/> — {PAYMENT_METHOD_LABELS[preview.effect.paymentMethod??'']??'طريقة الدفع غير متاحة'}</p>}
          {recover?<p className="rounded-xl bg-nw-warn-bg p-3 text-sm">توجد محاولة محفوظة. استعد نتيجتها بنفس المفتاح والمدخلات؛ لا تبدأ محاولة جديدة.</p>
            :!preview.eligible?<p role="status" className="rounded-xl bg-nw-warn-bg p-3 text-sm">{preview.blockedReason}</p>:<p className="text-sm text-nw-muted">معاينة من قاعدة البيانات؛ يعاد فحصها عند التأكيد.</p>}
          <dl className="space-y-2 rounded-xl border border-nw-border p-3 text-sm" aria-label="أثر التصحيح">
            {([['الكاش في الدرج','cashInMinorUnits'],['CliQ خارج الدرج','cliqInMinorUnits'],['دين العميل','customerDebtInMinorUnits'],['رصيد المورد','supplierBalanceInMinorUnits']] as const).map(([label,key])=><div className="flex justify-between gap-3" key={key}><dt>{label}</dt><dd><MoneyText amount={preview.effect[key]/1000} currency/></dd></div>)}
            <div className="flex justify-between gap-3"><dt>تغيّر المخزون بالوحدة الأساسية</dt><dd><bdi>{preview.effect.inventoryBaseUnits.toLocaleString('ar-JO')}</bdi></dd></div>
          </dl>
          {action==='purchase_receipt'&&<div className="text-xs text-nw-muted">{preview.effect.stock.filter(correctionRecord).map((row,i)=><p key={i}>{String(row.productName)} — متوسط التكلفة بعد الإلغاء: <bdi>{row.wacAfter===null?'غير محدد قبل الاستلام':String(row.wacAfter)}</bdi> فلس للوحدة.</p>)}<p>دفعات أمر الشراء العامة تبقى مقدّمة؛ تُعكس دفعات السند نفسه فقط.</p></div>}
          {(preview.eligible||recover)&&<label className="block space-y-2 text-sm font-semibold">سبب التصحيح<textarea aria-label="سبب التصحيح" value={reason} onChange={e=>setReason(e.target.value)} disabled={busy||recover} minLength={3} maxLength={500} rows={3} className="w-full rounded-xl border border-nw-border bg-nw-surface p-3 text-nw-text"/></label>}
        </>}
        <div className="flex flex-wrap gap-2">
          {(recover||preview?.eligible)&&<UiButton disabled={busy||loading||(!recover&&reason.trim().length<3)} onClick={()=>void submit()}>{busy?'جارٍ التصحيح…':recover?'استعادة نفس المحاولة':'تأكيد التصحيح'}</UiButton>}
          {!recover&&error&&<UiButton disabled={busy||loading} onClick={()=>void load()}>تحديث المعاينة</UiButton>}
          <UiButton disabled={busy} onClick={onClose}>إغلاق</UiButton>
        </div>
      </>}
    </div>
  </Modal>;
}
export function DocumentCorrectionAction({action,recordId,onChanged,insideMenu=false}:{action:CorrectionAction;recordId:string;onChanged:()=>void|Promise<void>;insideMenu?:boolean}) {
  const {roleName,roles}=useAuthStore(),[open,setOpen]=useState(false);
  if(!hasNavigationRole(correctionRoles[action],roleName,roles))return null;
  const trigger=<UiButton variant="plain" onClick={()=>setOpen(true)}>{correctionTitles[action]}</UiButton>;
  return <>
    {insideMenu?trigger:<details className="rounded-xl border border-nw-border px-3 text-sm"><summary className="min-h-11 cursor-pointer py-3" aria-label={`إجراءات ${correctionTitles[action]}`}>⋯</summary>{trigger}</details>}
    {open&&<CorrectionDialog action={action} recordId={recordId} onClose={()=>setOpen(false)} onChanged={onChanged}/>}
  </>;
}
