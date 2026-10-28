import {useEffect,useRef,useState} from 'react';
import {Card,FormFields,UiButton,formatUiDate} from '../../components/ui';
import {useAuthStore} from '../../stores/useAuthStore';
import {formatExactMinorJod} from '../../utils/aftercare215Money';
import {businessErrorMessage} from '../../utils/businessError';
import type {SupplierReplacementCase,SupplierReplacementPayload} from '../../utils/supplierReplacement';
import type {SupplierCreditPage215,SupplierCreditPreview215} from '../../utils/supplierCredit215';
import type {ReplacementAttempt} from '../../services/supabase/supplierReplacementIntent';
import {supplierReplacementRecovery,submitSupplierReplacement} from '../../services/supabase/supplierReplacement.service';
import {previewSupplierCredit215,readSupplierCredits215} from '../../services/supabase/supplierCredit215.service';
const scope='supplier-replacement208:panel';
interface Props {item:SupplierReplacementCase;eventId?:string;onSaved:()=>Promise<void>;onClose:()=>void;onPendingChange?:(pending:boolean)=>void}
export function SupplierCredit215Panel({item,eventId,onSaved,onClose,onPendingChange}:Props){
  const{user,roles,roleName}=useAuthStore(),owner=roles.includes('owner')||roleName==='owner',actorScope=[user?.id,roleName,[...roles].sort().join(',')].join('|');
  const [quantity,setQuantity]=useState(String(item.pendingQuantity)),[reason,setReason]=useState(eventId?'عكس خصم المورد وإعادة الكمية للمعلّق':'وافق المورد على خصم قيمة المعيب من حسابه');
  const [attempt,setAttempt]=useState<ReplacementAttempt|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [draft,setDraft]=useState<{scope:string;payload:SupplierReplacementPayload;preview:SupplierCreditPreview215}|null>(null),version=useRef(0),working=useRef(false);
  const unresolved=attempt?.status==='prepared'||attempt?.status==='unknown';
  useEffect(()=>{const current=++version.current;let active=true;working.current=false;setBusy(false);setAttempt(null);setReady(false);setDraft(null);setError('');
    if(owner)void supplierReplacementRecovery(scope).then(value=>{if(active&&version.current===current){setAttempt(value);setReady(true);}}).catch(cause=>{if(active)setError(businessErrorMessage(cause));});
    return()=>{active=false;version.current=current+1;};
  },[actorScope,owner,item.id,eventId]);
  useEffect(()=>{onPendingChange?.(busy||unresolved||!ready);},[busy,unresolved,ready,onPendingChange]);
  if(!owner)return <p role="alert">خصم المورد وعكسه للمالك فقط.</p>;
  const currentDraft=draft?.scope===actorScope?draft:null,action=eventId?'reverse_credit':'credit';
  const inspect=async()=>{
    if(working.current||!ready||unresolved)return;
    const qty=Number(quantity);if(!eventId&&(!Number.isSafeInteger(qty)||qty<1||qty>item.pendingQuantity)){setError(`العدد: اختر من 1 إلى ${item.pendingQuantity} باكيت.`);return;}
    if(reason.trim().length<3){setError('سبب القرار: اكتب ثلاثة أحرف على الأقل.');return;}
    const payload=eventId?{eventId,reason:reason.trim()}:{caseId:item.id,quantity:qty,reason:reason.trim()};
    working.current=true;setBusy(true);setError('');const current=version.current;
    try{const preview=await previewSupplierCredit215(action,payload);if(version.current===current){if(preview.caseId!==item.id||preview.supplierId!==item.supplierId)throw Error('دليل الخصم لا يطابق المورد أو المصدر.');setDraft({scope:actorScope,payload,preview});}}
    catch(cause){if(version.current===current)setError(businessErrorMessage(cause));}
    finally{working.current=false;if(version.current===current)setBusy(false);}
  };
  const execute=async(recover=false)=>{
    if(working.current||!ready||(!recover&&!currentDraft))return;working.current=true;setBusy(true);setError('');const current=version.current;
    try{await submitSupplierReplacement(scope,recover?undefined:{action,payload:{...currentDraft!.payload,previewFingerprint:currentDraft!.preview.previewFingerprint},expectedNonce:attempt?.nonce??null});
      if(current!==version.current)return;setDraft(null);await onSaved();
    }catch(cause){if(current===version.current)setError(businessErrorMessage(cause));}
    finally{working.current=false;if(current===version.current){try{setAttempt(await supplierReplacementRecovery(scope));}catch(cause){setReady(false);setError(businessErrorMessage(cause));}setBusy(false);}}
  };
  return <FormFields className="min-w-0 space-y-3 rounded-xl border border-nw-border p-3" aria-busy={busy} data-testid="supplier-credit215">
    <h4 className="font-bold">{eventId?'عكس خصم المورد مع إعادة المعلّق':'خصم من حساب المورد'} · {item.productName}</h4><p>{item.supplierName}</p>
    <p className="text-sm text-nw-muted">{eventId?'يرجع الاستحقاق على المورد وتعود الكمية للمعلّق معاً، إن لم توجد حركة لاحقة تمنع العكس.':'قيمة تاريخية كاملة بحد المستحق المؤيّد للمورد. لا استلام مخزون ولا دفعة ولا مصروف.'}</p>
    {error&&<p role="alert" className="text-sm text-nw-bad">{error}</p>}{!ready&&<p role="status">جاري التحقق من المحاولة المحفوظة…</p>}
    {unresolved?<><p className="text-sm">توجد محاولة لم تُحسم في استبدال المورد. استعد نفس المحاولة قبل أي قرار جديد.</p><UiButton disabled={busy} onClick={()=>void execute(true)}>استعادة قرار المورد المحفوظ</UiButton></>:<>
      <fieldset disabled={busy||!ready||Boolean(currentDraft)} className="space-y-3">{!eventId&&<label>عدد الباكيتات للخصم<input aria-label="عدد الباكيتات للخصم" type="number" min={1} max={item.pendingQuantity} step={1} inputMode="numeric" enterKeyHint="next" value={quantity} onChange={e=>{setQuantity(e.target.value);setDraft(null);}}/></label>}
        <label>سبب القرار<textarea aria-label="سبب القرار" rows={3} maxLength={500} value={reason} onChange={e=>{setReason(e.target.value);setDraft(null);}}/></label></fieldset>
      {!currentDraft&&<UiButton variant="primary" disabled={busy||!ready} onClick={()=>void inspect()}>معاينة قرار المورد</UiButton>}
      {currentDraft&&<Card className="space-y-2" data-testid="supplier-credit215-preview"><p>الكمية: {currentDraft.preview.quantity} باكيت</p>
        <p>{eventId?'يعود للمستحق على المورد':'ينقص من المستحق للمورد'}: <bdi dir="ltr">{formatExactMinorJod(BigInt(currentDraft.preview.amountDeltaInMinorUnits)<0n?(-BigInt(currentDraft.preview.amountDeltaInMinorUnits)).toString():currentDraft.preview.amountDeltaInMinorUnits)}</bdi></p>
        <p>المستحق قبل القرار: <bdi dir="ltr">{formatExactMinorJod(currentDraft.preview.balanceBeforeInMinorUnits)}</bdi></p><p>المستحق بعد القرار: <bdi dir="ltr">{formatExactMinorJod(currentDraft.preview.balanceAfterInMinorUnits)}</bdi></p>
        <p className="text-sm">المخزون والدرج والربح: بلا حركة جديدة.</p><UiButton variant="primary" disabled={busy} onClick={()=>void execute()}>{eventId?'تأكيد عكس الخصم وإعادة المعلّق':'تأكيد خصم المورد'}</UiButton><UiButton disabled={busy} onClick={()=>setDraft(null)}>تعديل القرار</UiButton>
      </Card>}
    </>}
    <UiButton disabled={busy||unresolved} onClick={onClose}>إغلاق القرار</UiButton>
  </FormFields>;
}
export function SupplierCreditStatement215({supplierId}:{supplierId:string}){
  const{user,roles,roleName}=useAuthStore(),owner=roles.includes('owner')||roleName==='owner',scope=[user?.id,roleName,[...roles].sort().join(','),supplierId].join('|');
  const [open,setOpen]=useState(false),[page,setPage]=useState(1),[retry,setRetry]=useState(0),[state,setState]=useState<{scope:string;data?:SupplierCreditPage215;error?:string}>({scope:''});
  const requestScope=`${scope}|${page}|${retry}`;
  useEffect(()=>{let active=true;if(!owner||!open)return;void readSupplierCredits215(supplierId,page).then(data=>{if(active)setState({scope:requestScope,data});}).catch(cause=>{if(active)setState({scope:requestScope,error:businessErrorMessage(cause)});});return()=>{active=false;};},[owner,open,supplierId,page,requestScope]);
  if(!owner)return null;const data=state.scope===requestScope?state.data:undefined,error=state.scope===requestScope?state.error:undefined;
  return <details open={open} onToggle={e=>setOpen(e.currentTarget.open)} className="space-y-2"><summary className="min-h-11 cursor-pointer py-3">سجل خصم المعيب من حساب المورد</summary>
    {!open?null:error?<div role="alert"><p>{error}</p><UiButton onClick={()=>setRetry(n=>n+1)}>إعادة المحاولة</UiButton></div>:!data?<p role="status">جاري قراءة سجل الخصم…</p>:<>
      {!data.rows.length?<p>لا يوجد خصم مسجّل.</p>:<ul className="space-y-3 text-sm">{data.rows.map(r=><li key={r.eventId} className="rounded-lg border border-nw-border p-3"><b>{r.reversesEventId?'عكس خصم المورد':'خُصم من حساب المورد'} · {r.productName}</b><p>{r.reason}</p><p>{formatUiDate(r.createdAt,{dateStyle:'short',timeStyle:'short'})}</p>
        <p>تغيّر الاستحقاق: <bdi dir="ltr">{formatExactMinorJod((-BigInt(r.amountDeltaInMinorUnits)).toString())}</bdi></p><p>قبل: <bdi dir="ltr">{formatExactMinorJod(r.balanceBeforeInMinorUnits)}</bdi> · بعد: <bdi dir="ltr">{formatExactMinorJod(r.balanceAfterInMinorUnits)}</bdi></p></li>)}</ul>}
      <nav className="flex flex-wrap items-center gap-3" aria-label="صفحات خصم المورد"><UiButton disabled={page<=1} onClick={()=>setPage(n=>n-1)}>السابق</UiButton><span>{page}</span><UiButton disabled={page*data.pageSize>=data.totalCount} onClick={()=>setPage(n=>n+1)}>التالي</UiButton></nav>
    </>}
  </details>;
}
