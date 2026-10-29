import {FormFields,UiButton} from '../../components/ui';
import {useAuthStore} from '../../stores/useAuthStore';
import {submitSupplierReplacement,supplierReplacementRecovery} from '../../services/supabase/supplierReplacement.service';
import type {ReplacementAttempt} from '../../services/supabase/supplierReplacementIntent';
import React,{lazy,Suspense,useCallback,useEffect,useMemo,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {CURRENCY} from '../../constants';
import type {Order} from '../../types';
import {businessErrorMessage} from '../../utils/businessError';
import {AftercareSupplierSafety} from './AftercareSupplierSafety';
import {AftercareWizard215} from './AftercareWizard215';
import type {AdminAftercareAction} from '../../services/supabase/adminAftercareRecovery';
import {fetchAdminAftercareContext,fetchAdminAftercareRecoveryStates,recoverAdminAftercare,
  type AdminAftercareCapability,type AdminAftercareContext,type AftercarePhysicalRepresentative} from '../../services/supabase/salesAftercare.service';
const DamageHistoryPanel=lazy(()=>import('../more/DamageHistoryPanel').then(m=>({default:m.DamageHistoryPanel})));
interface Props {order:Order;onChanged?:()=>Promise<void>;onContractResolved:(capability:AdminAftercareCapability|null)=>void;
  notify:(message:string,type?:'success'|'error'|'info')=>void}
const rootQuantity=(representatives:AftercarePhysicalRepresentative[])=>representatives.reduce((sum,source)=>sum+source.remainingQuantity,0);
export const AdminAftercarePanel:React.FC<Props>=({order,onChanged,onContractResolved,notify})=>{
  const {roles,roleName,user}=useAuthStore(),isOwner=roles.includes('owner')||roleName==='owner';
  const supplierScope=`supplier-replacement208:return:${order.id}`;
  const [supplierAttempt,setSupplierAttempt]=useState<ReplacementAttempt|null>(null),[supplierRecoveryError,setSupplierRecoveryError]=useState('');
  const [context,setContext]=useState<AdminAftercareContext|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [safetyBlocked,setSafetyBlocked]=useState(true),[error,setError]=useState<string|null>(null),[damageOpen,setDamageOpen]=useState(false);
  const [recoveryStates,setRecoveryStates]=useState<Awaited<ReturnType<typeof fetchAdminAftercareRecoveryStates>>>({});
  const refreshRecoveryStates=useCallback(async()=>{
    setRecoveryStates(await fetchAdminAftercareRecoveryStates(order.id));
    if(isOwner)try{setSupplierAttempt(await supplierReplacementRecovery(supplierScope));setSupplierRecoveryError('');}
    catch(cause){setSupplierRecoveryError(cause instanceof Error?cause.message:'تعذر قراءة محاولة إرسال المرتجع للمورد.');}
  },[order.id,isOwner,supplierScope]);
  useEffect(()=>{setSupplierAttempt(null);setSupplierRecoveryError('');setDamageOpen(false);},[user?.id,isOwner,order.id]);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchAdminAftercareContext(order.id);
    if (!result.success || !result.data) {
      setError(result.error || 'تعذر تحميل سياق خدمات ما بعد البيع.');
      onContractResolved(null);
    } else {
      if (result.data.baseItems.some(item => item.commercialLineKind === 'legacy_single_sku_parcel'
        && (!Number.isSafeInteger(item.unitsPerParcel) || (item.unitsPerParcel || 0) < 1
          || item.quantity % item.unitsPerParcel! !== 0
          || rootQuantity(item.physicalRepresentatives) % item.unitsPerParcel! !== 0))) {
        setError('لقطات حجم الطرد أو كميتها غير متطابقة؛ لا يمكن إجراء مرتجع أو استبدال.');
        onContractResolved(null); setLoading(false); return;
      }
      setContext(result.data);
      onContractResolved(result.data.capability);
      try {
        await refreshRecoveryStates();
      } catch (recoveryError) {
        setError(recoveryError instanceof Error ? recoveryError.message
          : 'تعذر التحقق من محاولة ما بعد البيع المعلقة.');
      }
    }
    setLoading(false);
  }, [onContractResolved, order.id, refreshRecoveryStates]);

  useEffect(() => { void load(); }, [load]);

  const sources = useMemo(() => {
    if (!context) return [];
    return [
      ...context.baseItems.flatMap((item) => item.physicalRepresentatives),
      ...context.parcelInstances.flatMap((parcel) =>
        parcel.components.flatMap((component) => component.physicalRepresentatives)),
    ];
  }, [context]);
  const hasPendingRecovery = Object.values(recoveryStates).some(state=>state?.recoverable===true)
    ||supplierAttempt?.status==='unknown'||supplierAttempt?.status==='prepared'
    ||(isOwner&&safetyBlocked);

  if (loading) return (
    <div className="rounded-2xl border border-nw-border bg-nw-surface-2 p-3 text-center text-nw-muted">
      جاري قراءة سياق المرتجعات والاستبدال من الخادم…
    </div>
  );
  if (error) return (
    <div className="rounded-2xl border border-nw-bad bg-nw-bad-bg p-3 text-nw-text">
      <p>{businessErrorMessage(error)}</p>
      <UiButton variant="primary" type="button" onClick={() => void load()}
        className="mt-2 rounded-lg bg-nw-primary px-3 py-1.5 font-bold text-nw-on-primary">
        إعادة المحاولة
      </UiButton>
    </div>
  );
  if (!context?.supported) return null;

  const runRecovery = async (action: AdminAftercareAction) => {
    setBusy(true);
    try {
      const result = await recoverAdminAftercare(order.id, action);
      if (!result.success) {
        notify(businessErrorMessage(result.error || 'تعذر استعادة العملية المعلقة.'), 'error'); return;
      }
      notify(action === 'return' ? 'تم استرداد نتيجة المرتجع المعلقة.'
        : 'تم استرداد نتيجة الاستبدال المعلقة.');
      await load(); await onChanged?.();
    } catch (recoveryError) {
      notify(businessErrorMessage(recoveryError), 'error');
    } finally {
      try { await refreshRecoveryStates(); } catch { /* load exposes recovery read errors */ }
      setBusy(false);
    }
  };
  return (
    <FormFields><section data-testid="phase43-admin-aftercare" aria-busy={busy}
      className="space-y-3 rounded-2xl border border-nw-info bg-nw-info-bg p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 className="font-black text-nw-text">المرتجعات والاستبدال</h4>
          <p className="mt-1 text-[10px] text-nw-muted">
            الموعد النهائي: {new Date(context.order.deadlineAt).toLocaleString('ar-JO-u-nu-latn')}
          </p>
        </div>
        <span className={`rounded-full px-2 py-1 text-[9px] font-bold ${context.order.withinWindow
          ? 'bg-nw-ok-bg text-nw-text' : 'bg-nw-bad-bg text-nw-text'}`}>
          {context.order.withinWindow ? 'ضمن 48 ساعة' : 'انتهت المهلة'}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
        <div className="rounded-xl bg-nw-surface-2 p-2">ذمة<br/><b>{(context.financial.merchandiseDebtInMinorUnits / 1000).toFixed(3)}</b></div>
        <div className="rounded-xl bg-nw-surface-2 p-2">تحصيل قابل للرد<br/><b>{(context.financial.refundableCollectedInMinorUnits / 1000).toFixed(3)}</b></div>
        <div className="rounded-xl bg-nw-surface-2 p-2">توصيل غير مردود<br/><b>{(context.financial.deliveryFeeInMinorUnits / 1000).toFixed(3)}</b> {CURRENCY}</div>
      </div>

      {hasPendingRecovery && <div className="space-y-2 rounded-xl border border-nw-warn bg-nw-warn-bg p-3">
        {isOwner&&(supplierAttempt?.status==='unknown'||supplierAttempt?.status==='prepared')&&<UiButton disabled={busy} onClick={()=>void(async()=>{setBusy(true);try{await submitSupplierReplacement(supplierScope);notify(supplierAttempt.action==='replacement_supplier'?'تم استرداد نتيجة الاستبدال المرتبط بالمورد.':'تم استرداد نتيجة المرتجع المرتبط بالمورد.');await load();await onChanged?.();}catch(cause){notify(businessErrorMessage(cause),'error');}finally{await refreshRecoveryStates();setBusy(false);}})()}>{supplierAttempt.action==='replacement_supplier'?'استعادة الاستبدال المرسل للمورد':'استعادة المرتجع المرسل للمورد'}</UiButton>}
        <b className="text-nw-text">توجد عملية معلقة يجب استعادتها بنفس الهوية</b>
        <p className="text-[10px] text-nw-text">لا تبدأ عملية جديدة قبل معرفة نتيجة المحاولة السابقة.</p>
        <div className="flex gap-2">
          {recoveryStates.return?.recoverable && <UiButton variant="primary" type="button" disabled={busy}
            onClick={() => void runRecovery('return')}
            className="rounded-lg bg-nw-primary px-3 py-2 font-bold text-nw-on-primary disabled:opacity-50">
            استعادة المرتجع</UiButton>}
          {recoveryStates.replacement?.recoverable && <UiButton variant="primary" type="button" disabled={busy}
            onClick={() => void runRecovery('replacement')}
            className="rounded-lg bg-nw-primary px-3 py-2 font-bold text-nw-on-primary disabled:opacity-50">
            استعادة الاستبدال</UiButton>}
          {(['sealed_return','inspected_replacement','exchange'] as const).map(action=>recoveryStates[action]?.recoverable&&<UiButton key={action} variant="primary" disabled={busy}
            onClick={()=>void runRecovery(action)}>استعادة {action==='sealed_return'?'الإرجاع':action==='exchange'?'التبديل بصنف آخر':'الاستبدال المفحوص'}</UiButton>)}
        </div>
      </div>}

      {context.order.withinWindow&&sources.length>0&&<AftercareWizard215 key={`${user?.id}:${[...roles].sort().join(',')}:${roleName}:${order.id}`} order={order} context={context}
        ownerAllowed={isOwner} disabled={busy||hasPendingRecovery||Boolean(supplierRecoveryError)||damageOpen} onBusyChange={setBusy} onRecoveryChange={refreshRecoveryStates}
        onChanged={async()=>{await load();await onChanged?.();}} notify={notify}/>}
      {isOwner&&<>
        <AftercareSupplierSafety recoveryOnly orderId={order.id}
          disabled={busy||Object.values(recoveryStates).some(state=>state?.recoverable===true)||supplierAttempt?.status==='unknown'||supplierAttempt?.status==='prepared'}
          onPendingChange={setSafetyBlocked} onChanged={async()=>{await load();await onChanged?.();}} notify={notify}/>
        <details open={damageOpen} onToggle={event=>setDamageOpen(event.currentTarget.open)} className="space-y-3">
          <summary aria-disabled={busy||hasPendingRecovery} onClick={event=>{if(busy||hasPendingRecovery)event.preventDefault();}} className="min-h-11 cursor-pointer py-3 text-sm font-semibold">التالف</summary>
          <p className="text-sm text-nw-muted">أغلق قائمة التالف قبل بدء إرجاع أو استبدال. سجل المحل كله: بانتظار المورد · انتهى مع المورد · خسارة نهائية عليّ. رقم المستند يوضح الفاتورة المرتبطة؛ تحويل التالف المسجّل متاح من قائمة سطره.</p>
          {damageOpen&&<fieldset disabled={busy||hasPendingRecovery||Boolean(supplierRecoveryError)}>
            <Suspense fallback={<p role="status">جاري فتح سجل التالف…</p>}><DamageHistoryPanel/></Suspense>
          </fieldset>}
        </details>
      </>}
      <div className="flex items-center justify-between text-[10px] text-nw-muted">
        <span>{context.returns.length} مرتجع · {context.replacements.length} استبدال</span>
        <UiButton type="button" onClick={() => void load()} className="flex items-center gap-1"><RefreshCw className="h-3 w-3"/>تحديث</UiButton>
      </div>
    </section></FormFields>
  );
};
