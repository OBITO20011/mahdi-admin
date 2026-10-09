import { UiButton } from '../../components/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PackageCheck, PackageX, RefreshCw, RotateCcw } from 'lucide-react';
import { CURRENCY } from '../../constants';
import type { Order } from '../../types';
import {allocateBaseReturn, assertReturnCapacityUnchanged, singleSkuPhysicalQuantity} from './aftercarePresentation';
import {businessErrorMessage} from '../../utils/businessError';
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
  const [context, setContext] = useState<AdminAftercareContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replacementSource, setReplacementSource] =
    useState<AftercarePhysicalRepresentative | null>(null);
  const [replacementQuantity, setReplacementQuantity] = useState(1);
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
  }, [order.id]);

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
          || item.physicalRepresentatives.some(source => source.remainingQuantity % item.unitsPerParcel! !== 0)))) {
        setError('لقطات حجم الكرتونة أو كميتها غير متطابقة؛ لا يمكن إجراء مرتجع أو استبدال.');
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
  const hasPendingRecovery = recoveryStates.return?.recoverable === true
    || recoveryStates.replacement?.recoverable === true;

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

  const resetForm = () => {
    setReplacementSource(null); setReplacementQuantity(1); setReturnDraft(null); setReason(''); setNotes('');
    setReference(''); setRefundMethod('cash');
  };
  const runReplacement = async () => {
    if (!replacementSource || reason.trim().length < 3) {
      notify('اكتب سبب الاستبدال وحدد الوحدة الحالية.', 'error'); return;
    }
    const factor = replacementSource.unitsPerParcel || 1;
    if (!Number.isSafeInteger(replacementQuantity) || replacementQuantity < 1
      || replacementQuantity * factor > replacementSource.remainingQuantity) {
      notify('اختر عدداً صحيحاً من الكراتين المتاحة.', 'error'); return;
    }
    setBusy(true);
    try {
      const result = await settleAdminReplacement({orderId: order.id,
        items: [{sourceKind: replacementSource.sourceKind,
          sourceId: replacementSource.sourceId, quantity: replacementQuantity * factor}],
        reason, notes});
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
          if (!allocation || ![allocation.sellableRestock,allocation.defectNonSellable,allocation.customerDamage]
            .every(value => Number.isSafeInteger(value) && value >= 0)
            || allocation.sellableRestock + allocation.defectNonSellable + allocation.customerDamage !== source.quantity) {
            throw new Error('PHASE43_RETURN_ALLOCATION_INVALID: صنّف كامل كمية الكرتونة.');
          }
          source.sellable_restock_quantity = allocation.sellableRestock;
          source.defect_non_sellable_quantity = allocation.defectNonSellable;
          source.customer_damage_quantity = allocation.customerDamage;
          sellable += allocation.sellableRestock; damage += allocation.customerDamage;
        }
        if (damage > 0 && returnDraft.standalonePrice == null) throw new Error('PACKAGE_D_CARTON_DAMAGE_PRICE_MISSING');
        if (damage > 0 && returnDraft.quantity !== 1) throw new Error(
          'افحص ضرر العميل بمرتجع مستقل لكل كرتونة حتى لا يتجاوز الخصم استحقاقها الأصلي.');
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
           const allocations = component.physicalRepresentatives.map((source) =>
             returnDraft.allocations[source.sourceId]);
           if (allocations.some((allocation) => !allocation)) throw new Error(
             'PHASE43_RETURN_ALLOCATION_MISSING: تصنيف الممثل الفيزيائي غير مكتمل.',
           );
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
           if (!allocation || ![allocation.sellableRestock, allocation.defectNonSellable,
             allocation.customerDamage].every((quantity) => Number.isSafeInteger(quantity)
               && quantity >= 0)
             || allocation.sellableRestock + allocation.defectNonSellable
               + allocation.customerDamage !== source.remainingQuantity) {
             throw new Error(
               'PHASE43_RETURN_ALLOCATION_INVALID: يجب تصنيف كامل كمية كل ممثل فيزيائي.',
             );
           }
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
  const runRecovery = async (action: 'return' | 'replacement') => {
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
    <section data-testid="phase43-admin-aftercare" aria-busy={busy}
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
        </div>
      </div>}

      {context.order.withinWindow && sources.length > 0 && !hasPendingRecovery
        && !replacementSource && !returnDraft && (
        <div className="space-y-2">
          <p className="text-sm font-bold text-nw-text">الأصناف والقطع الحالية المتاحة</p>
          {context.baseItems.map((item) => {
            const factor = item.commercialLineKind === 'legacy_single_sku_parcel' ? item.unitsPerParcel! : 1;
            const quantity = rootQuantity(item.physicalRepresentatives) / factor;
            return quantity > 0 && <div key={item.orderItemId} className="rounded-xl border border-nw-border bg-nw-surface-2 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2"><span>{order.items.find(line => line.id === item.orderItemId)?.productName || 'وحدة أساسية'} · المتبقي {quantity} {item.commercialLineKind === 'legacy_single_sku_parcel' ? 'كرتونة كاملة' : 'وحدة'}</span>
                <div className="flex gap-1">
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
                    const source = item.physicalRepresentatives.find(value => value.remainingQuantity >= factor);
                    setReplacementSource(source ? {...source, unitsPerParcel: factor,
                      isSingleSkuParcel: item.commercialLineKind === 'legacy_single_sku_parcel'} : null); setReplacementQuantity(1);
                  }} className="min-h-11 rounded bg-nw-primary px-3 py-2 text-nw-on-primary">{item.commercialLineKind === 'legacy_single_sku_parcel' ? 'استبدال كرتونة' : 'استبدال وحدة'}</UiButton>
                </div>
              </div>
            </div>;
          })}
          {context.parcelInstances.map((parcel) => {
            const complete = parcel.components.every((component) =>
              rootQuantity(component.physicalRepresentatives) === component.quantity);
            return complete && <div key={parcel.parcelInstanceId} className="rounded-xl border border-nw-border bg-nw-surface-2 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2"><span>{order.items.find(line => line.id === parcel.orderItemId)?.productName || 'طرد'} · طرد كامل · {parcel.components.length} مكونات · <bdi dir="ltr" className="select-text break-all font-mono">{parcel.parcelInstanceId}</bdi></span>
                <UiButton variant="primary" type="button" onClick={() => setReturnDraft({kind: 'parcel', parcel,
                   allocations: Object.fromEntries(parcel.components.flatMap((component) =>
                     component.physicalRepresentatives.map((source) => [source.sourceId, {
                       sellableRestock: source.remainingQuantity,
                       defectNonSellable: 0,
                       customerDamage: 0,
                     }])))})}
                  className="min-h-11 rounded bg-nw-primary px-3 py-2 text-nw-on-primary">مرتجع الطرد</UiButton></div>
              <div className="mt-2 flex flex-wrap gap-1">
                {parcel.components.flatMap((component) => component.physicalRepresentatives
                  .map((source) => <UiButton key={source.sourceId} type="button"
                    onClick={() => setReplacementSource(source)}
                    className="min-h-11 rounded border border-nw-info px-3 py-2 text-nw-text">استبدال وحدة · {order.items.find(line => line.id === parcel.orderItemId)?.parcelInstances?.find(instance => instance.id === parcel.parcelInstanceId)?.components.find(value => value.id === component.parcelComponentId)?.name || 'مكوّن'}{source.sourceKind === 'replacement_item' ? ' · بديل حالي' : ''}</UiButton>))}
              </div>
            </div>;
          })}
        </div>
      )}

      {replacementSource && <div className="space-y-2 rounded-xl border border-nw-info bg-nw-surface-2 p-3">
        <b className="text-nw-text">إصدار بديل من نفس الصنف — {replacementSource.isSingleSkuParcel ? 'كراتين كاملة' : 'وحدة واحدة'}</b>
        {replacementSource.isSingleSkuParcel && <label className="block">عدد كراتين الاستبدال
          <input aria-label="عدد كراتين الاستبدال" type="number" min={1} step={1}
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
        <b className="text-nw-text">{returnDraft.kind === 'base' && returnDraft.isSingleSkuParcel ? 'مرتجع كراتين كاملة من الصنف الحالي' : 'مرتجع من القطعة الحالية'}</b>
        {returnDraft.kind === 'base' && <label className="block text-sm">{returnDraft.isSingleSkuParcel ? 'عدد كراتين المرتجع' : 'كمية المرتجع'} (المتبقي {rootQuantity(returnDraft.representatives) / returnDraft.unitsPerParcel})
          <input aria-label={returnDraft.isSingleSkuParcel ? 'عدد كراتين المرتجع' : 'كمية المرتجع'} type="number" min={1} step={1}
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
                <input type="number" min={0} value={allocation[field]} disabled={busy || (field==='customerDamage' && returnDraft.standalonePrice == null)}
                  onChange={event => setReturnDraft({...returnDraft,allocations:{...returnDraft.allocations,
                    [sourceId]:{...allocation,[field]:Number(event.target.value)}}})}
                  className="mt-1 min-h-11 w-full rounded bg-nw-surface p-2"/></label>)}
              <p className="col-span-3 text-sm text-nw-muted">مجموع التصنيف: {selected} قطعة؛ يجب أن يطابق كمية الممثل المختار.</p>
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
                <p className="mb-1 text-sm text-nw-muted">القطعة الحالية {sourceIndex + 1}{source.sourceKind === 'replacement_item' ? ' · بديل صادر' : ' · الأصل'} · {source.remainingQuantity} وحدة</p>
                <p role="status" className={`mb-2 text-sm ${allocation.sellableRestock + allocation.defectNonSellable + allocation.customerDamage === source.remainingQuantity ? 'text-nw-text' : 'text-nw-text'}`}>مجموع التصنيف: {allocation.sellableRestock + allocation.defectNonSellable + allocation.customerDamage} / {source.remainingQuantity}</p>
                <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3 text-sm">
                  <label>سليم<input type="number" min={0} max={source.remainingQuantity}
                    value={allocation.sellableRestock}
                    onChange={(event) => update('sellableRestock', Number(event.target.value))}
                    className="mt-1 min-h-11 w-full rounded bg-nw-surface p-2"/></label>
                  <label>عيب/غير قابل للبيع<input type="number" min={0} max={source.remainingQuantity}
                    value={allocation.defectNonSellable}
                    onChange={(event) => update('defectNonSellable', Number(event.target.value))}
                    className="mt-1 min-h-11 w-full rounded bg-nw-surface p-2"/></label>
                  <label>ضرر عميل<input type="number" min={0} max={source.remainingQuantity}
                    value={allocation.customerDamage}
                    onChange={(event) => update('customerDamage', Number(event.target.value))}
                    className="mt-1 min-h-11 w-full rounded bg-nw-surface p-2"/></label>
                </div>
              </div>;
            })}
          </div>)}
        </div>}
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

      <div className="flex items-center justify-between text-[10px] text-nw-muted">
        <span>{context.returns.length} مرتجع · {context.replacements.length} استبدال</span>
        <UiButton type="button" onClick={() => void load()} className="flex items-center gap-1"><RefreshCw className="h-3 w-3"/>تحديث</UiButton>
      </div>
    </section>
  );
};
