import {useEffect,useState} from 'react';
import {UiButton} from '../../components/ui';
import {useAuthStore} from '../../stores/useAuthStore';
import {businessErrorMessage} from '../../utils/businessError';
import {aftercareSupplierBlockedMessage,fetchAftercareDamageCandidates,fetchAftercareSupplierPreview,fetchSupplierReplacementOptions,
  submitSupplierReplacement,supplierReplacementRecovery,type AftercareDamageCandidate,type AftercareSupplierPreview,type ReplacementOptions} from '../../services/supabase/supplierReplacement.service';
import type {ReplacementAttempt} from '../../services/supabase/supplierReplacementIntent';

interface Props {orderId:string;disabled:boolean;onPendingChange:(pending:boolean)=>void;onChanged:()=>Promise<void>;notify:(message:string,type?:'success'|'error'|'info')=>void}

/** Owner-only, infrequent safety action. Durable recovery remains visible even
 * with the disclosure closed; no business ID is rendered as a product name. */
export function AftercareSupplierSafety({orderId,disabled,onPendingChange,onChanged,notify}:Props) {
  const {user}=useAuthStore(),scope=`aftercare211:safety:${orderId}`;
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[checking,setChecking]=useState(true);
  const [attempt,setAttempt]=useState<ReplacementAttempt|null>(null),[recoveryError,setRecoveryError]=useState('');
  const [candidates,setCandidates]=useState<AftercareDamageCandidate[]|null>(null),[error,setError]=useState('');
  const [candidate,setCandidate]=useState<AftercareDamageCandidate|null>(null),[supplierId,setSupplierId]=useState('');
  const [options,setOptions]=useState<ReplacementOptions|null>(null),[search,setSearch]=useState(''),[reason,setReason]=useState('');
  const [preview,setPreview]=useState<AftercareSupplierPreview|null>(null);
  const pending=attempt?.status==='prepared'||attempt?.status==='unknown';
  useEffect(()=>{let active=true;setChecking(true);setRecoveryError('');setAttempt(null);setOpen(false);setCandidate(null);setCandidates(null);
    void supplierReplacementRecovery(scope).then(value=>{if(active)setAttempt(value);}).catch(cause=>{if(active)setRecoveryError(businessErrorMessage(cause));}).finally(()=>{if(active)setChecking(false);});
    return()=>{active=false;};
  },[scope,user?.id]);
  useEffect(()=>{onPendingChange(checking||busy||pending||!!recoveryError);},[checking,busy,pending,recoveryError,onPendingChange]);
  useEffect(()=>{let active=true;setOptions(null);if(!candidate)return;
    const timer=setTimeout(()=>{void fetchSupplierReplacementOptions('customer_return','',search,candidate.productId).then(value=>{if(active){setOptions(value);const last=value.lastSuppliers.find(s=>s.productId===candidate.productId);if(last?.supplierId&&value.suppliers.some(s=>s.id===last.supplierId)){const selected=last.supplierId;setSupplierId(current=>current||selected);}}}).catch(cause=>{if(active)setError(businessErrorMessage(cause));});},search?250:0);
    return()=>{active=false;clearTimeout(timer);};
  },[candidate,search,user?.id]);
  const load=async()=>{setBusy(true);setError('');try{setCandidates(await fetchAftercareDamageCandidates(orderId));}catch(cause){setError(businessErrorMessage(cause));}finally{setBusy(false);}};
  const recover=async()=>{setBusy(true);try{await submitSupplierReplacement(scope);notify('تم استرداد نتيجة تحويل التالف للمورد.');setAttempt(await supplierReplacementRecovery(scope));await onChanged();}catch(cause){notify(businessErrorMessage(cause),'error');}finally{setBusy(false);}};
  const inspect=async()=>{if(!candidate||!supplierId||reason.trim().length<3){setError('اختر المورد واكتب سبباً من 3 إلى 500 حرف.');return;}setBusy(true);setError('');setPreview(null);try{setPreview(await fetchAftercareSupplierPreview(candidate,supplierId));}catch(cause){setError(businessErrorMessage(cause));}finally{setBusy(false);}};
  const confirm=async()=>{if(!candidate||!preview?.eligible||disabled||pending||recoveryError)return;setBusy(true);setError('');try{
    await submitSupplierReplacement(scope,{action:candidate.kind==='replacement'?'reclassify_replacement':'reclassify_return',expectedNonce:attempt?.nonce??null,
      payload:{sourceId:candidate.id,supplierId,reason:reason.trim(),previewFingerprint:preview.previewFingerprint}});
    setAttempt(await supplierReplacementRecovery(scope));setCandidate(null);setPreview(null);setCandidates(await fetchAftercareDamageCandidates(orderId));notify('تم تحويل التالف للمورد بالقيمة التاريخية مرة واحدة، مع حفظ الحدث الأصلي.');await onChanged();
  }catch(cause){setError(businessErrorMessage(cause));try{setAttempt(await supplierReplacementRecovery(scope));}catch(readError){setRecoveryError(businessErrorMessage(readError));}}finally{setBusy(false);}};
  return <div className="space-y-2" data-testid="aftercare-supplier-safety">
    {checking&&<p role="status">جاري التحقق من محاولة تحويل التالف…</p>}
    {recoveryError&&<p role="alert">{recoveryError}</p>}
    {pending&&<UiButton disabled={busy||disabled} onClick={()=>void recover()}>استعادة تحويل التالف للمورد</UiButton>}
    <UiButton aria-expanded={open} aria-label="خيارات التالف النهائي" disabled={checking||busy||disabled||pending||!!recoveryError}
      onClick={()=>{setOpen(!open);if(!open)void load();}}>⋯ خيارات التالف النهائي</UiButton>
    {open&&<div className="space-y-3 rounded-xl border border-nw-border bg-nw-surface-2 p-3">
      <p className="text-sm text-nw-muted">حوّل تالفاً نهائياً مسجّلاً للمورد بعد الاتفاق معه. التحويل مرة واحدة بسبب ومعاينة، دون تعديل الحدث الأصلي.</p>
      {error&&<p role="alert">{error}</p>}
      {busy&&<p role="status">جاري التحقق…</p>}
      {!candidates&&!busy&&<UiButton onClick={()=>void load()}>إعادة تحميل سجل التالف</UiButton>}
      {candidates?.length===0&&<p>لا يوجد تالف نهائي من استبدال أو مرتجع في هذه الفاتورة.</p>}
      {!candidate&&candidates?.map(item=><div key={item.kind+item.id} className="space-y-1 rounded border border-nw-border p-2">
        <p>{item.productName} · {item.quantity} حبة · {item.kind==='replacement'?'من استبدال':'من مرتجع عيب'}</p>
        {item.blockedReason?<p className="text-sm text-nw-muted">{aftercareSupplierBlockedMessage(item.blockedReason)}</p>:<UiButton disabled={busy||disabled}
          onClick={()=>{setCandidate(item);setSupplierId('');setReason('');setSearch('');setError('');setPreview(null);}}>حوّله للمورد بانتظار البديل</UiButton>}
      </div>)}
      {candidate&&<div className="space-y-2">
        <b>{candidate.productName} · {candidate.quantity} حبة</b>
        <label className="block">بحث المورد<input className="min-h-11 w-full rounded bg-nw-surface p-2" disabled={busy} value={search} onChange={e=>{setSearch(e.target.value);setPreview(null);}}/></label>
        <label className="block">مورد التالف<select aria-label="مورد التالف" className="min-h-11 w-full rounded bg-nw-surface p-2" disabled={busy||!options} value={supplierId} onChange={e=>{setSupplierId(e.target.value);setPreview(null);}}><option value="">اختر المورد</option>{options?.suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        {options&&<p className="text-sm text-nw-muted">آخر مورد مستلم للصنف: {options.lastSuppliers.find(s=>s.productId===candidate.productId)?.supplierName??'لا يوجد دليل استلام'}.</p>}
        <label className="block">سبب تحويل التالف<textarea maxLength={500} className="w-full rounded bg-nw-surface p-2" value={reason} disabled={busy} onChange={e=>{setReason(e.target.value);setPreview(null);}}/></label>
        <UiButton disabled={busy||disabled||!supplierId||reason.trim().length<3} onClick={()=>void inspect()}>معاينة تحويل التالف</UiButton>
        {preview&&<div className="space-y-2 rounded border border-nw-info p-2">
          {preview.eligible?<><p>سيُعلّق {preview.quantity} حبة للمورد بقيمة تاريخية {(preview.reclassifiedInMinorUnits/1000).toFixed(3)} د.أ.</p>
            <p className="text-sm">لا يتغير الدرج أو الذمم. فرق تكلفة البديل يبقى على الربح، ورفض المورد يثبت القيمة المعلّقة مرة واحدة.</p>
            <UiButton variant="primary" disabled={busy||disabled||pending||!!recoveryError} onClick={()=>void confirm()}>اعتماد تحويل التالف</UiButton></>:<p role="alert">{aftercareSupplierBlockedMessage(preview.blockedReason||'')}</p>}
        </div>}
        <UiButton disabled={busy} onClick={()=>{setCandidate(null);setPreview(null);setError('');}}>رجوع لسجل التالف</UiButton>
      </div>}
    </div>}
  </div>;
}
