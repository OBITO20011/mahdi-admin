import {FormFields, UiButton } from '../../components/ui';
import {useAuthStore} from '../../stores/useAuthStore';
import {fetchSupplierReplacementOptions,submitSupplierReplacement,supplierReplacementRecovery,type ReplacementOptions} from '../../services/supabase/supplierReplacement.service';
import type {ReplacementAttempt} from '../../services/supabase/supplierReplacementIntent';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PackageCheck, PackageX, RefreshCw, RotateCcw } from 'lucide-react';
import { CURRENCY } from '../../constants';
import type { Order } from '../../types';
import {allocateBaseReturn, assertCompleteReturnAllocation, assertReturnCapacityUnchanged, singleSkuPhysicalQuantity,wholeParcelReplacementItems} from './aftercarePresentation';
import {businessErrorMessage} from '../../utils/businessError';
import {AftercareSupplierSafety} from './AftercareSupplierSafety';
import {AftercareWizard215} from './AftercareWizard215';
import type {AdminAftercareAction} from '../../services/supabase/adminAftercareRecovery';
import {
  fetchAdminAftercareContext,
  fetchAdminAftercareRecoveryStates,
  recoverAdminAftercare,
  settleAdminReplacement,
  settleAdminReturn,
  type AdminAftercareCapability,
  type AdminAftercareContext,
  type AftercarePhysicalRepresentative,
  type ReturnPhysicalSource,
  type ReturnRequestItem,
} from '../../services/supabase/salesAftercare.service';

interface Props {
  order: Order;
  onChanged?: () => Promise<void>;
  onContractResolved: (capability: AdminAftercareCapability | null) => void;
  notify: (message: string, type?: 'success' | 'error' | 'info') => void;
}
type RefundMethod = 'cash' | 'cliq' | null;
interface LeafAllocation {
  sellableRestock: number;
  defectNonSellable: number;
  customerDamage: number;
}
type ReturnDraft =
  | {kind: 'base'; orderItemId: string; productId: string;
      representatives: AftercarePhysicalRepresentative[]; quantity: number; unitsPerParcel: number; isSingleSkuParcel: boolean; disposition: 'restock' | 'damaged';
      allocations?: Record<string, LeafAllocation>; standalonePrice?: number | null}
  | {kind: 'parcel'; parcel: AdminAftercareContext['parcelInstances'][number];
      allocations: Record<string, LeafAllocation>};

const rootQuantity = (representatives: AftercarePhysicalRepresentative[]) =>
  representatives.reduce((sum, source) => sum + source.remainingQuantity, 0);

export const AdminAftercarePanel: React.FC<Props> = ({
  order, onChanged, onContractResolved, notify,
}) => {
  const {roles,roleName,user}=useAuthStore(),isOwner=roles.includes('owner')||roleName==='owner';
  const supplierScope=`supplier-replacement208:return:${order.id}`;
  const [supplierAttempt,setSupplierAttempt]=useState<ReplacementAttempt|null>(null);
  const [supplierRecoveryError,setSupplierRecoveryError]=useState('');
  const [destination,setDestination]=useState<'final'|'supplier'>('final');
  const [returnSupplier,setReturnSupplier]=useState(''),[supplierSearch,setSupplierSearch]=useState('');
  const [supplierOptions,setSupplierOptions]=useState<ReplacementOptions|null>(null),[supplierOptionsError,setSupplierOptionsError]=useState('');
  const [context, setContext] = useState<AdminAftercareContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [safetyBlocked, setSafetyBlocked] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replacementSource, setReplacementSource] =
    useState<(AftercarePhysicalRepresentative & {representatives?: AftercarePhysicalRepresentative[]; orderItemId?: string}) | null>(null);
  const [replacementQuantity, setReplacementQuantity] = useState(1);
  const [replacementParcel,setReplacementParcel]=useState<AdminAftercareContext['parcelInstances'][number]|null>(null);
  const [returnDraft, setReturnDraft] = useState<ReturnDraft | null>(null);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [refundMethod, setRefundMethod] = useState<RefundMethod>('cash');
  const [reference, setReference] = useState('');
  const [recoveryStates, setRecoveryStates] = useState<Awaited<ReturnType<
    typeof fetchAdminAftercareRecoveryStates
  >>>({});

  const refreshRecoveryStates = useCallback(async () => {
    setRecoveryStates(await fetchAdminAftercareRecoveryStates(order.id));
    if(isOwner)try{setSupplierAttempt(await supplierReplacementRecovery(supplierScope));setSupplierRecoveryError('');}
    catch(cause){setSupplierRecoveryError(cause instanceof Error?cause.message:'تعذر قراءة محاولة إرسال المرتجع للمورد.');}
  }, [order.id,isOwner,supplierScope]);

  useEffect(()=>{setSupplierAttempt(null);setDestination('final');setReturnSupplier('');setSupplierRecoveryError('');},[user?.id,isOwner,order.id]);
  const suggestedProduct=returnDraft?.kind==='base'?returnDraft.productId:returnDraft?.parcel.components[0]?.productId
    ??replacementSource?.productId??replacementParcel?.components[0]?.productId;
  useEffect(()=>{let active=true;setSupplierOptions(null);setSupplierOptionsError('');if(!isOwner||destination!=='supplier')return;
    const timer=setTimeout(()=>{void fetchSupplierReplacementOptions('customer_return','',supplierSearch,suggestedProduct).then(value=>{if(active){setSupplierOptions(value);const last=value.lastSuppliers.find(s=>s.productId===suggestedProduct);if(last?.supplierId&&value.suppliers.some(s=>s.id===last.supplierId)){const lastId=last.supplierId;setReturnSupplier(current=>current||lastId);}}}).catch(cause=>{if(active)setSupplierOptionsError(cause instanceof Error?cause.message:'تعذر تحميل الموردين.');});},supplierSearch?250:0);
    return()=>{active=false;clearTimeout(timer);};
  },[isOwner,destination,supplierSearch,suggestedProduct,user?.id]);

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

  const componentName = (componentId: string) => order.items.flatMap(line => line.parcelInstances || [])
    .flatMap(parcel => parcel.components).find(component => component.id === componentId)?.name || 'حبة من الطرد';
  const baseItemName = (orderItemId: string) => order.items.find(line => line.id === orderItemId)?.productName || 'الصنف';

  const resetForm = () => {
    setReplacementParcel(null);
    setReplacementSource(null); setReplacementQuantity(1); setReturnDraft(null); setReason(''); setNotes('');
    setReference(''); setRefundMethod('cash');
    setDestination('final');setReturnSupplier('');
  };
  const runReplacement = async () => {
    if(hasPendingRecovery||supplierRecoveryError){notify(supplierRecoveryError||'استعد المحاولة المعلقة قبل بدء عملية جديدة.','error');return;}
    if ((!replacementSource&&!replacementParcel) || reason.trim().length < 3) {
      notify('اكتب سبب الاستبدال وحدد الوحدة الحالية.', 'error'); return;
    }
    const factor = replacementSource?.unitsPerParcel || 1;
    if (!replacementParcel&&replacementSource&&(!Number.isSafeInteger(replacementQuantity) || replacementQuantity < 1
      || replacementQuantity * factor > replacementSource.remainingQuantity)) {
      notify('اختر عدداً صحيحاً من الطرود المتاحة.', 'error'); return;
    }
    setBusy(true);
    try {
      const items = replacementParcel?wholeParcelReplacementItems(replacementParcel):replacementSource?.representatives&&replacementSource.orderItemId
        ? allocateBaseReturn(replacementSource.orderItemId,replacementSource.representatives,replacementQuantity*factor,
          'damaged',context.replacements,context.order.completedAt).map(source=>({sourceKind:source.source_kind,sourceId:source.source_id,quantity:source.quantity}))
        :replacementSource?[{sourceKind: replacementSource.sourceKind,
        sourceId: replacementSource.sourceId, quantity: replacementQuantity * factor}]:[];
      if(destination==='supplier') {
        if(!isOwner||!returnSupplier)throw new Error('اختر المورد قبل اعتماد الاستبدال.');
        await submitSupplierReplacement(supplierScope,{expectedNonce:supplierAttempt?.nonce??null,action:'replacement_supplier',
          payload:{orderId:order.id,items,reason:reason.trim(),notes:notes.trim()||null,supplierId:returnSupplier}});
        notify('تم إعطاء البديل وتعليق الحبة المعيبة للمورد بقيمتها التاريخية. فرق تكلفة البديل يبقى على الربح.');
        resetForm();await load();await onChanged?.();return;
      }
      const result = await settleAdminReplacement({orderId: order.id, items, reason, notes});
      if (!result.success) { notify(businessErrorMessage(result.error || 'تعذر إصدار البديل.'), 'error'); return; }
      notify('تم إصدار بديل من نفس الصنف والكمية مع حفظ سلسلة الأصل والتكلفة.');
      resetForm(); await load(); await onChanged?.();
    } catch (mutationError) {
      notify(businessErrorMessage(mutationError), 'error');
    } finally {
      try { await refreshRecoveryStates(); } catch { /* load exposes recovery read errors */ }
      setBusy(false);
    }
  };
  const buildReturn = (): {items: ReturnRequestItem[]; physical: ReturnPhysicalSource[]} | null => {
    if (!returnDraft) return null;
    if (returnDraft.kind === 'base') {
      const quantity = singleSkuPhysicalQuantity(returnDraft.quantity, returnDraft.unitsPerParcel);
      const physical = allocateBaseReturn(returnDraft.orderItemId, returnDraft.representatives,
        quantity, returnDraft.disposition, context.replacements, context.order.completedAt || undefined);
      if (returnDraft.isSingleSkuParcel && returnDraft.allocations) {
        let sellable = 0; let damage = 0;
        for (const source of physical) {
          const allocation = returnDraft.allocations[source.source_id];
          assertCompleteReturnAllocation(baseItemName(returnDraft.orderItemId), allocation, source.quantity);
          source.sellable_restock_quantity = allocation.sellableRestock;
          source.defect_non_sellable_quantity = allocation.defectNonSellable;
          source.customer_damage_quantity = allocation.customerDamage;
          sellable += allocation.sellableRestock; damage += allocation.customerDamage;
        }
        if (damage > 0 && returnDraft.standalonePrice == null) throw new Error('PACKAGE_D_CARTON_DAMAGE_PRICE_MISSING');
        if (damage > 0 && returnDraft.quantity !== 1) throw new Error(
          'افحص ضرر العميل بمرتجع مستقل لكل طرد حتى لا يتجاوز الخصم استحقاقها الأصلي.');
        return {items: [{return_scope: 'base_unit', order_item_id: returnDraft.orderItemId,
          quantity, stock_disposition: sellable > 0 ? 'restock' : 'damaged',
          ...(damage > 0 ? {customer_damage_quantity: damage} : {})}], physical};
      }
      return {
        items: [{return_scope: 'base_unit', order_item_id: returnDraft.orderItemId,
          quantity, stock_disposition: returnDraft.disposition}],
        physical,
      };
    }
    return {
      items: [{return_scope: 'parcel_instance', order_item_id: returnDraft.parcel.orderItemId,
        parcel_instance_id: returnDraft.parcel.parcelInstanceId,
        components: returnDraft.parcel.components.map((component) => {
           const allocations = component.physicalRepresentatives.map((source) => {
             const allocation = returnDraft.allocations[source.sourceId];
             assertCompleteReturnAllocation(componentName(component.parcelComponentId), allocation, source.remainingQuantity);
             return allocation;
           });
           const sellable = allocations.reduce((sum, value) => sum + value.sellableRestock, 0);
           const defect = allocations.reduce((sum, value) => sum + value.defectNonSellable, 0);
           const damage = allocations.reduce((sum, value) => sum + value.customerDamage, 0);
          return {
            parcel_component_id: component.parcelComponentId,
             accepted_quantity: sellable + defect,
             rejected_quantity: damage,
             accepted_condition: sellable > 0 ? 'sellable'
               : defect > 0 ? 'supplier_defect' : null,
             accepted_stock_disposition: sellable > 0 ? 'restock'
               : defect > 0 ? 'non_sellable' : null,
             rejection_reason: damage > 0 ? 'customer_damage' : null,
             rejected_stock_disposition: damage > 0 ? 'returned_to_customer' : null,
          };
        })}],
      physical: returnDraft.parcel.components.flatMap((component) =>
        component.physicalRepresentatives.map((source) => {
           const allocation = returnDraft.allocations[source.sourceId];
           assertCompleteReturnAllocation(componentName(component.parcelComponentId), allocation, source.remainingQuantity);
          return {
            root_source_kind: 'parcel_component' as const,
            root_source_id: component.parcelComponentId,
            source_kind: source.sourceKind, source_id: source.sourceId,
            product_id: source.productId, quantity: source.remainingQuantity,
             sellable_restock_quantity: allocation.sellableRestock,
             defect_non_sellable_quantity: allocation.defectNonSellable,
             customer_damage_quantity: allocation.customerDamage,
          };
        })),
    };
  };
  const runReturn = async () => {
    if(hasPendingRecovery||supplierRecoveryError){notify(supplierRecoveryError||'استعد المحاولة المعلقة قبل بدء مرتجع جديد.','error');return;}
    let request: ReturnType<typeof buildReturn>;
    try { request = buildReturn(); } catch (buildError) {
      notify(businessErrorMessage(buildError), 'error');
      return;
    }
    if (!request || reason.trim().length < 3 || (refundMethod === 'cliq' && !reference.trim())) {
      notify('أكمل سبب المرتجع ومرجع CliQ عند اختياره.', 'error'); return;
    }
    setBusy(true);
    try {
      // Re-read before a new submission, never silently reallocate an existing draft.
      const fresh = await fetchAdminAftercareContext(order.id);
      if (!fresh.success || !fresh.data?.supported) throw new Error(fresh.error || 'تعذر تحديث بيانات الطلب قبل الإرسال.');
      const selected = returnDraft?.kind === 'base' ? returnDraft.representatives
        : returnDraft?.parcel.components.flatMap(component => component.physicalRepresentatives) || [];
      const current = fresh.data.baseItems.flatMap(item => item.physicalRepresentatives)
        .concat(fresh.data.parcelInstances.flatMap(parcel => parcel.components.flatMap(component => component.physicalRepresentatives)));
      assertReturnCapacityUnchanged(selected, current);
      if(destination==='supplier'){
        if(!isOwner||!returnSupplier)throw new Error('اختر المورد من حساب المالك.');
        const damaged=request.physical.filter(source=>source.defect_non_sellable_quantity>0);
        if(!damaged.length)throw new Error('لا توجد كمية بعيب مورد غير قابلة للبيع لإرسالها.');
        await submitSupplierReplacement(supplierScope,{action:'customer_return',expectedNonce:supplierAttempt?.nonce??null,
          payload:{orderId:order.id,items:request.items,physicalSources:request.physical,reason:reason.trim(),refundMethod,referenceNumber:reference.trim()||null,notes:notes.trim()||null,
            supplierAssignments:damaged.map(source=>({sourceKind:source.source_kind,sourceId:source.source_id,supplierId:returnSupplier}))}});
        notify('تمت تسوية المرتجع وربط التالف بالمعلّق لدى المورد في معاملة واحدة.');
        resetForm();await load();await onChanged?.();return;
      }
      const result = await settleAdminReturn({orderId: order.id, items: request.items,
        physicalSources: request.physical, reason, refundMethod,
        referenceNumber: reference, notes});
      if (!result.success) { notify(businessErrorMessage(result.error || 'تعذر تسوية المرتجع.'), 'error'); return; }
      notify('تمت تسوية المرتجع ذريًا وفق الدين والتحصيل والمخزون الفعلي.');
      resetForm(); await load(); await onChanged?.();
    } catch (mutationError) {
      notify(businessErrorMessage(mutationError), 'error');
    } finally {
      try { await refreshRecoveryStates(); } catch { /* load exposes recovery read errors */ }
      setBusy(false);
    }
  };
  const runRecovery = async (action: AdminAftercareAction) => {
    setBusy(true);
    try {
      const result = await recoverAdminAftercare(order.id, action);
      if (!result.success) {
        notify(businessErrorMessage(result.error || 'تعذر استعادة العملية المعلقة.'), 'error'); return;
      }
      notify(action === 'return' ? 'تم استرداد نتيجة المرتجع المعلقة.'
        : 'تم استرداد نتيجة الاستبدال المعلقة.');
      resetForm(); await load(); await onChanged?.();
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
        {isOwner&&(supplierAttempt?.status==='unknown'||supplierAttempt?.status==='prepared')&&<UiButton disabled={busy} onClick={()=>void(async()=>{setBusy(true);try{await submitSupplierReplacement(supplierScope);notify(supplierAttempt.action==='replacement_supplier'?'تم استرداد نتيجة الاستبدال المرتبط بالمورد.':'تم استرداد نتيجة المرتجع المرتبط بالمورد.');resetForm();await load();await onChanged?.();}catch(cause){notify(businessErrorMessage(cause),'error');}finally{await refreshRecoveryStates();setBusy(false);}})()}>{supplierAttempt.action==='replacement_supplier'?'استعادة الاستبدال المرسل للمورد':'استعادة المرتجع المرسل للمورد'}</UiButton>}
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
        ownerAllowed={isOwner} disabled={busy||hasPendingRecovery||Boolean(supplierRecoveryError)} onBusyChange={setBusy} onRecoveryChange={refreshRecoveryStates}
        onChanged={async()=>{await load();await onChanged?.();}} notify={notify}/>}
      <details className="space-y-3"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">خيارات متقدمة · القدرات السابقة وتحويل التالف</summary>
      {context.order.withinWindow && sources.length > 0 && !hasPendingRecovery
        && !replacementSource && !replacementParcel && !returnDraft && (
        <div className="space-y-2">
          <p className="text-sm font-bold text-nw-text">الأصناف والقطع الحالية المتاحة</p>
          {context.baseItems.map((item) => {
            const factor = item.commercialLineKind === 'legacy_single_sku_parcel' ? item.unitsPerParcel! : 1;
            const quantity = rootQuantity(item.physicalRepresentatives) / factor;
            return quantity > 0 && <div key={item.orderItemId} className="rounded-xl border border-nw-border bg-nw-surface-2 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2"><span>{baseItemName(item.orderItemId)} · المتبقي {quantity} {item.commercialLineKind === 'legacy_single_sku_parcel' ? 'طرد' : 'وحدة'}</span>
                <div className="flex flex-wrap gap-1">
                  <UiButton variant="primary" type="button" onClick={() => setReturnDraft({kind: 'base', orderItemId: item.orderItemId,
                    productId: item.productId, representatives: item.physicalRepresentatives, quantity: 1, unitsPerParcel: factor,
                    isSingleSkuParcel: item.commercialLineKind === 'legacy_single_sku_parcel', disposition: 'restock',
                    standalonePrice: item.standalonePriceInMinorUnits,
                    allocations: item.commercialLineKind === 'legacy_single_sku_parcel'
                      ? Object.fromEntries(allocateBaseReturn(item.orderItemId,item.physicalRepresentatives,factor,
                        'restock',context.replacements,context.order.completedAt).map(source => [source.source_id,
                          {sellableRestock:source.quantity,defectNonSellable:0,customerDamage:0}])) : undefined})}
                    className="min-h-11 rounded bg-nw-primary px-3 py-2 text-nw-on-primary">مرتجع</UiButton>
                  <UiButton variant="primary" type="button" onClick={() => {
                    const source = item.physicalRepresentatives.find(value => value.remainingQuantity > 0);
                    setReplacementSource(source ? {...source, remainingQuantity:rootQuantity(item.physicalRepresentatives),
                      representatives:item.physicalRepresentatives,orderItemId:item.orderItemId,unitsPerParcel: factor,
                      isSingleSkuParcel: item.commercialLineKind === 'legacy_single_sku_parcel'} : null); setReplacementQuantity(1);
                  }} className="min-h-11 rounded bg-nw-primary px-3 py-2 text-nw-on-primary">{item.commercialLineKind === 'legacy_single_sku_parcel' ? 'استبدال طرد' : 'استبدال وحدة'}</UiButton>
                </div>
              </div>
              {item.commercialLineKind==='legacy_single_sku_parcel'&&<div className="mt-2 flex flex-wrap gap-1">
                {item.physicalRepresentatives.filter(source=>source.remainingQuantity>0).map(source=><UiButton key={source.sourceId} type="button"
                  onClick={()=>{setReplacementSource({...source,unitsPerParcel:1,isSingleSkuParcel:false});setReplacementQuantity(1);}}
                  className="min-h-11 rounded border border-nw-info px-3 py-2 text-nw-text">تبديل حبة معيبة{source.sourceKind==='replacement_item'?' · البديل الذي أعطيته':''}</UiButton>)}
              </div>}
            </div>;
          })}
          {context.parcelInstances.map((parcel) => {
            const complete = parcel.components.every((component) =>
              rootQuantity(component.physicalRepresentatives) === component.quantity);
            return complete && <div key={parcel.parcelInstanceId} className="rounded-xl border border-nw-border bg-nw-surface-2 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2"><span>طرد مشكّل: {parcel.components.map(component => componentName(component.parcelComponentId)).join(' + ')}</span>
                <UiButton variant="primary" type="button" onClick={() => setReturnDraft({kind: 'parcel', parcel,
                   allocations: Object.fromEntries(parcel.components.flatMap((component) =>
                     component.physicalRepresentatives.map((source) => [source.sourceId, {
                       sellableRestock: source.remainingQuantity,
                       defectNonSellable: 0,
                       customerDamage: 0,
                     }])))})}
                  className="min-h-11 rounded bg-nw-primary px-3 py-2 text-nw-on-primary">إرجاع الطرد كاملاً</UiButton>
                <UiButton variant="primary" type="button" onClick={()=>{setReplacementSource(null);setReplacementParcel(parcel);}}
                  className="min-h-11 rounded bg-nw-primary px-3 py-2 text-nw-on-primary">استبدال الطرد كاملاً</UiButton></div>
              <div className="mt-2 flex flex-wrap gap-1">
                {parcel.components.flatMap((component) => component.physicalRepresentatives.filter(source=>source.remainingQuantity>0)
                  .map((source) => <UiButton key={source.sourceId} type="button"
                    onClick={() => {setReplacementSource({...source,unitsPerParcel:1,isSingleSkuParcel:false});setReplacementQuantity(1);}}
                    className="min-h-11 rounded border border-nw-info px-3 py-2 text-nw-text">استبدال وحدة · {componentName(component.parcelComponentId)}{source.sourceKind === 'replacement_item' ? ' · البديل الذي أعطيته' : ''}</UiButton>))}
              </div>
            </div>;
          })}
        </div>
      )}

      {(replacementSource||replacementParcel) && <div className="space-y-2 rounded-xl border border-nw-info bg-nw-surface-2 p-3">
        <b className="text-nw-text">إصدار بديل من نفس الصنف — {replacementParcel?'طرد مشكّل كامل':replacementSource?.isSingleSkuParcel ? 'طرود كاملة' : 'وحدة واحدة'}</b>
        <p className="text-sm text-nw-muted">التبديل من نفس الصنف والكمية فقط. لا يُرد مال عن حبة من طرد.</p>
        {isOwner&&<div className="space-y-2 rounded-xl border border-nw-border p-3">
          <label className="block text-sm">مصير الحبة المعيبة<select aria-label="مصير الحبة المعيبة" disabled={busy} value={destination} onChange={event=>setDestination(event.target.value as 'final'|'supplier')} className="min-h-11 w-full rounded bg-nw-surface p-2">
            <option value="final">عيب من عندي ← تالف نهائي</option><option value="supplier">عيب من المورد ← للمورد بانتظار البديل</option>
          </select></label>
          {destination==='supplier'&&<>{supplierOptionsError?<p role="alert">{supplierOptionsError}</p>:!supplierOptions?<p role="status">جاري قراءة الموردين…</p>:<>
            <label className="block text-sm">بحث المورد<input value={supplierSearch} onChange={event=>setSupplierSearch(event.target.value)} className="min-h-11 w-full rounded bg-nw-surface p-2"/></label>
            <label className="block text-sm">المورد<select aria-label="المورد" value={returnSupplier} onChange={event=>setReturnSupplier(event.target.value)} className="min-h-11 w-full rounded bg-nw-surface p-2"><option value="">اختر المورد</option>{supplierOptions.suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <p className="text-sm text-nw-muted">آخر مورد مستلم للصنف: {supplierOptions.lastSuppliers.find(s=>s.productId===suggestedProduct)?.supplierName??'لا يوجد دليل استلام'}. قيمة الحبة المعيبة تبقى معلّقة؛ فرق تكلفة البديل يبقى على الربح.</p>
          </>}</>}
        </div>}
        {replacementSource?.isSingleSkuParcel && <label className="block">عدد طرود الاستبدال
          <input inputMode="numeric" enterKeyHint="next" aria-label="عدد طرود الاستبدال" type="number" min={1} step={1}
            max={replacementSource.remainingQuantity / replacementSource.unitsPerParcel!}
            value={replacementQuantity} disabled={busy} onChange={e => setReplacementQuantity(Number(e.target.value))}
            className="mt-1 w-full rounded bg-nw-surface p-2"/></label>}
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2}
          placeholder="سبب العيب/الاستبدال" className="w-full rounded-lg border border-nw-border bg-nw-surface p-2 text-nw-text"/>
        <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="ملاحظة داخلية"
          className="w-full rounded-lg border border-nw-border bg-nw-surface p-2 text-nw-text"/>
        <div className="flex gap-2"><UiButton variant="primary" type="button" disabled={busy} onClick={() => void runReplacement()}
          className="flex-1 rounded-lg bg-nw-primary py-2 font-bold text-nw-on-primary disabled:opacity-50">{busy ? 'جاري الإصدار…' : 'اعتماد الاستبدال'}</UiButton>
          <UiButton type="button" onClick={resetForm} className="rounded-lg bg-nw-surface-2 px-3">رجوع</UiButton></div>
      </div>}

      {returnDraft && <div className="space-y-2 rounded-xl border border-nw-warn bg-nw-surface-2 p-3">
        <b className="text-nw-text">{returnDraft.kind === 'parcel' || returnDraft.isSingleSkuParcel ? 'إرجاع الطرد كاملاً (كل حباته)' : 'مرتجع من القطعة الحالية'}</b>
        {(returnDraft.kind === 'parcel' || returnDraft.isSingleSkuParcel) && <p className="text-sm text-nw-muted">
          صنّف كل حبات الطرد: السليم يعود للمخزون، والعيب للمورد أو تالف، وضرر العميل يُخصم من المبلغ المرجع.
        </p>}
        {returnDraft.kind === 'base' && <label className="block text-sm">{returnDraft.isSingleSkuParcel ? 'عدد طرود المرتجع' : 'كمية المرتجع'} (المتبقي {rootQuantity(returnDraft.representatives) / returnDraft.unitsPerParcel})
          <input inputMode="numeric" enterKeyHint="next" aria-label={returnDraft.isSingleSkuParcel ? 'عدد طرود المرتجع' : 'كمية المرتجع'} type="number" min={1} step={1}
            max={rootQuantity(returnDraft.representatives) / returnDraft.unitsPerParcel} value={returnDraft.quantity}
            disabled={busy} onChange={event => {
              const quantity = Number(event.target.value);
              if (returnDraft.isSingleSkuParcel) {
                try {
                  const physical = allocateBaseReturn(returnDraft.orderItemId,returnDraft.representatives,
                    singleSkuPhysicalQuantity(quantity,returnDraft.unitsPerParcel),'restock',
                    context.replacements,context.order.completedAt);
                  setReturnDraft({...returnDraft,quantity,allocations:Object.fromEntries(physical.map(source =>
                    [source.source_id,{sellableRestock:source.quantity,defectNonSellable:0,customerDamage:0}]))});
                } catch (quantityError) { notify(businessErrorMessage(quantityError),'error'); }
              } else setReturnDraft({...returnDraft,quantity});
            }}
            className="mt-1 min-h-11 w-full rounded-lg border border-nw-border bg-nw-surface p-2"/>
        </label>}
        {returnDraft.kind === 'base' && !returnDraft.isSingleSkuParcel && <div className="grid grid-cols-2 gap-2">
          <UiButton variant={returnDraft.disposition === 'restock' ? 'primary' : 'secondary'} type="button" onClick={() => setReturnDraft({...returnDraft, disposition: 'restock'})}
            className={`rounded-lg border p-2 ${returnDraft.disposition === 'restock' ? 'bg-nw-primary' : 'border-nw-border'}`}><PackageCheck className="mx-auto h-4 w-4"/>سليم</UiButton>
          <UiButton variant={returnDraft.disposition === 'damaged' ? 'primary' : 'secondary'} type="button" onClick={() => setReturnDraft({...returnDraft, disposition: 'damaged'})}
            className={`rounded-lg border p-2 ${returnDraft.disposition === 'damaged' ? 'bg-nw-primary' : 'border-nw-border'}`}><PackageX className="mx-auto h-4 w-4"/>غير قابل للبيع</UiButton>
        </div>}
        {returnDraft.kind === 'base' && returnDraft.isSingleSkuParcel && <div className="space-y-2">
          {returnDraft.standalonePrice == null && <p className="text-sm text-nw-text">
            هذا البيع القديم بلا لقطة سعر القطعة؛ السليم وعيب المورد متاحان، وضرر العميل غير متاح.</p>}
          {(Object.entries(returnDraft.allocations || {}) as Array<[string,LeafAllocation]>).map(([sourceId,allocation]) => {
            const selected = allocation.sellableRestock + allocation.defectNonSellable + allocation.customerDamage;
            return <div key={sourceId} className="grid grid-cols-3 gap-2 rounded-lg border border-nw-border p-2">
              {([['sellableRestock','سليم'],['defectNonSellable','عيب/غير قابل للبيع'],
                ['customerDamage','ضرر عميل']] as const).map(([field,label]) => <label key={field}>{label}
                <input inputMode="numeric" enterKeyHint="next" type="number" min={0} value={allocation[field]} disabled={busy || (field==='customerDamage' && returnDraft.standalonePrice == null)}
                  onChange={event => setReturnDraft({...returnDraft,allocations:{...returnDraft.allocations,
                    [sourceId]:{...allocation,[field]:Number(event.target.value)}}})}
                  className="mt-1 min-h-11 w-full rounded bg-nw-surface p-2"/></label>)}
              <p className="col-span-3 text-sm text-nw-muted">مجموع التصنيف: {selected} حبة؛ صنّف كل الحبات التي تعيدها.</p>
            </div>;
          })}
        </div>}
        {returnDraft.kind === 'parcel' && <div className="space-y-2">
          {returnDraft.parcel.components.map((component, index) => <div key={component.parcelComponentId}
            className="rounded-lg border border-nw-border p-2">
            <p className="mb-1 text-sm text-nw-text">{order.items.flatMap(line => line.parcelInstances || []).flatMap(instance => instance.components).find(value => value.id === component.parcelComponentId)?.name || `المكوّن ${index + 1}`} · {component.quantity} وحدة</p>
            {component.physicalRepresentatives.map((source, sourceIndex) => {
              const allocation = returnDraft.allocations[source.sourceId];
              const update = (field: keyof LeafAllocation, value: number) => setReturnDraft({
                ...returnDraft,
                allocations: {...returnDraft.allocations, [source.sourceId]: {
                  ...allocation, [field]: Number.isFinite(value) ? value : 0,
                }},
              });
              return <div key={source.sourceId} className="mt-2 rounded border border-nw-border p-2">
                <p className="mb-1 text-sm text-nw-muted">القطعة الحالية {sourceIndex + 1}{source.sourceKind === 'replacement_item' ? ' · البديل الذي أعطيته' : ' · الأصل'} · {source.remainingQuantity} وحدة</p>
                <p role="status" className={`mb-2 text-sm ${allocation.sellableRestock + allocation.defectNonSellable + allocation.customerDamage === source.remainingQuantity ? 'text-nw-text' : 'text-nw-text'}`}>مجموع التصنيف: {allocation.sellableRestock + allocation.defectNonSellable + allocation.customerDamage} / {source.remainingQuantity}</p>
                <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3 text-sm">
                  <label>سليم<input inputMode="numeric" enterKeyHint="next" type="number" min={0} max={source.remainingQuantity}
                    value={allocation.sellableRestock}
                    onChange={(event) => update('sellableRestock', Number(event.target.value))}
                    className="mt-1 min-h-11 w-full rounded bg-nw-surface p-2"/></label>
                  <label>عيب/غير قابل للبيع<input inputMode="numeric" enterKeyHint="next" type="number" min={0} max={source.remainingQuantity}
                    value={allocation.defectNonSellable}
                    onChange={(event) => update('defectNonSellable', Number(event.target.value))}
                    className="mt-1 min-h-11 w-full rounded bg-nw-surface p-2"/></label>
                  <label>ضرر عميل<input inputMode="numeric" enterKeyHint="next" type="number" min={0} max={source.remainingQuantity}
                    value={allocation.customerDamage}
                    onChange={(event) => update('customerDamage', Number(event.target.value))}
                    className="mt-1 min-h-11 w-full rounded bg-nw-surface p-2"/></label>
                </div>
              </div>;
            })}
          </div>)}
        </div>}
        {isOwner&&<div className="space-y-2 rounded-xl border border-nw-border p-3">
          <label className="block text-sm">مصير عيب المورد غير القابل للبيع<select disabled={busy} value={destination} onChange={event=>setDestination(event.target.value as 'final'|'supplier')} className="min-h-11 w-full rounded bg-nw-surface p-2"><option value="final">تالف نهائي</option><option value="supplier">للمورد بانتظار الاستبدال</option></select></label>
          {destination==='supplier'&&<>{supplierOptionsError?<p role="alert">{supplierOptionsError}</p>:!supplierOptions?<p role="status">جاري قراءة الموردين…</p>:<>
            <label className="block text-sm">بحث المورد<input value={supplierSearch} onChange={event=>setSupplierSearch(event.target.value)} className="min-h-11 w-full rounded bg-nw-surface p-2"/></label>
            <label className="block text-sm">المورد<select value={returnSupplier} onChange={event=>setReturnSupplier(event.target.value)} className="min-h-11 w-full rounded bg-nw-surface p-2"><option value="">اختر المورد</option>{supplierOptions.suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <p className="text-xs text-nw-muted">آخر مورد مستلم للصنف: {supplierOptions.lastSuppliers.find(s=>s.productId===suggestedProduct)?.supplierName??'لا يوجد دليل استلام'}. يُرسل عيب المورد فقط؛ تبقى التسوية المالية الحالية كما هي.</p>
          </>}</>}
        </div>}
        {supplierRecoveryError&&<p role="alert">{supplierRecoveryError}</p>}
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2}
          placeholder="سبب المرتجع" className="w-full rounded-lg border border-nw-border bg-nw-surface p-2 text-nw-text"/>
        <div className="grid grid-cols-3 gap-1">
          {([null, 'cash', 'cliq'] as RefundMethod[]).map((value) => <UiButton variant={refundMethod === value ? 'primary' : 'secondary'} key={value || 'debt'} type="button"
            onClick={() => setRefundMethod(value)} className={`rounded border p-2 ${refundMethod === value ? 'bg-nw-primary' : 'border-nw-border'}`}>
            {value === null ? 'خفض ذمة فقط' : value === 'cash' ? 'كاش' : 'CliQ'}</UiButton>)}
        </div>
        {refundMethod === 'cliq' && <input value={reference} onChange={(event) => setReference(event.target.value)}
          placeholder="مرجع CliQ" className="w-full rounded-lg border border-nw-border bg-nw-surface p-2 text-nw-text"/>}
        <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="ملاحظة داخلية"
          className="w-full rounded-lg border border-nw-border bg-nw-surface p-2 text-nw-text"/>
        <div className="flex gap-2"><UiButton variant="primary" type="button" disabled={busy} onClick={() => void runReturn()}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-nw-primary py-2 font-bold text-nw-on-primary disabled:opacity-50"><RotateCcw className="h-4 w-4"/>{busy ? 'جاري التسوية…' : 'اعتماد المرتجع'}</UiButton>
          <UiButton type="button" onClick={resetForm} className="rounded-lg bg-nw-surface-2 px-3">رجوع</UiButton></div>
      </div>}

      {isOwner&&<AftercareSupplierSafety orderId={order.id} disabled={busy||Object.values(recoveryStates).some(state=>state?.recoverable===true)||supplierAttempt?.status==='unknown'||supplierAttempt?.status==='prepared'}
        onPendingChange={setSafetyBlocked} onChanged={async()=>{await load();await onChanged?.();}} notify={notify}/>}
      </details>
      <div className="flex items-center justify-between text-[10px] text-nw-muted">
        <span>{context.returns.length} مرتجع · {context.replacements.length} استبدال</span>
        <UiButton type="button" onClick={() => void load()} className="flex items-center gap-1"><RefreshCw className="h-3 w-3"/>تحديث</UiButton>
      </div>
    </section></FormFields>
  );
};
