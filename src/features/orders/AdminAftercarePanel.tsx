import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PackageCheck, PackageX, RefreshCw, RotateCcw } from 'lucide-react';
import { CURRENCY } from '../../constants';
import type { Order } from '../../types';
import {allocateBaseReturn} from './aftercarePresentation';
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
      representatives: AftercarePhysicalRepresentative[]; quantity: number; disposition: 'restock' | 'damaged'}
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
    <div className="rounded-2xl border border-slate-700 bg-slate-950 p-3 text-center text-slate-400">
      جاري قراءة سياق المرتجعات والاستبدال من الخادم…
    </div>
  );
  if (error) return (
    <div className="rounded-2xl border border-rose-800 bg-rose-950/30 p-3 text-rose-200">
      <p>{businessErrorMessage(error)}</p>
      <button type="button" onClick={() => void load()}
        className="mt-2 rounded-lg bg-rose-700 px-3 py-1.5 font-bold text-white">
        إعادة المحاولة
      </button>
    </div>
  );
  if (!context?.supported) return null;

  const resetForm = () => {
    setReplacementSource(null); setReturnDraft(null); setReason(''); setNotes('');
    setReference(''); setRefundMethod('cash');
  };
  const runReplacement = async () => {
    if (!replacementSource || reason.trim().length < 3) {
      notify('اكتب سبب الاستبدال وحدد الوحدة الحالية.', 'error'); return;
    }
    setBusy(true);
    try {
      const result = await settleAdminReplacement({orderId: order.id,
        items: [{sourceKind: replacementSource.sourceKind,
          sourceId: replacementSource.sourceId, quantity: 1}],
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
      const quantity = returnDraft.quantity;
      return {
        items: [{return_scope: 'base_unit', order_item_id: returnDraft.orderItemId,
          quantity, stock_disposition: returnDraft.disposition}],
        physical: allocateBaseReturn(returnDraft.orderItemId, returnDraft.representatives,
          quantity, returnDraft.disposition, context.replacements),
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
      className="space-y-3 rounded-2xl border border-indigo-700/60 bg-indigo-950/20 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 className="font-black text-indigo-200">المرتجعات والاستبدال</h4>
          <p className="mt-1 text-[10px] text-slate-400">
            الموعد النهائي: {new Date(context.order.deadlineAt).toLocaleString('ar-JO')}
          </p>
        </div>
        <span className={`rounded-full px-2 py-1 text-[9px] font-bold ${context.order.withinWindow
          ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'}`}>
          {context.order.withinWindow ? 'ضمن 48 ساعة' : 'انتهت المهلة'}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
        <div className="rounded-xl bg-slate-950 p-2">ذمة<br/><b>{(context.financial.merchandiseDebtInMinorUnits / 1000).toFixed(3)}</b></div>
        <div className="rounded-xl bg-slate-950 p-2">تحصيل قابل للرد<br/><b>{(context.financial.refundableCollectedInMinorUnits / 1000).toFixed(3)}</b></div>
        <div className="rounded-xl bg-slate-950 p-2">توصيل غير مردود<br/><b>{(context.financial.deliveryFeeInMinorUnits / 1000).toFixed(3)}</b> {CURRENCY}</div>
      </div>

      {hasPendingRecovery && <div className="space-y-2 rounded-xl border border-amber-600 bg-amber-950/30 p-3">
        <b className="text-amber-200">توجد عملية معلقة يجب استعادتها بنفس الهوية</b>
        <p className="text-[10px] text-amber-100">لا تبدأ عملية جديدة قبل معرفة نتيجة المحاولة السابقة.</p>
        <div className="flex gap-2">
          {recoveryStates.return?.recoverable && <button type="button" disabled={busy}
            onClick={() => void runRecovery('return')}
            className="rounded-lg bg-orange-700 px-3 py-2 font-bold text-white disabled:opacity-50">
            استعادة المرتجع</button>}
          {recoveryStates.replacement?.recoverable && <button type="button" disabled={busy}
            onClick={() => void runRecovery('replacement')}
            className="rounded-lg bg-indigo-700 px-3 py-2 font-bold text-white disabled:opacity-50">
            استعادة الاستبدال</button>}
        </div>
      </div>}

      {context.order.withinWindow && sources.length > 0 && !hasPendingRecovery
        && !replacementSource && !returnDraft && (
        <div className="space-y-2">
          <p className="text-sm font-bold text-slate-300">الأصناف والقطع الحالية المتاحة</p>
          {context.baseItems.map((item) => {
            const quantity = rootQuantity(item.physicalRepresentatives);
            return quantity > 0 && <div key={item.orderItemId} className="rounded-xl border border-slate-700 bg-slate-950 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2"><span>{order.items.find(line => line.id === item.orderItemId)?.productName || 'وحدة أساسية'} · المتبقي {quantity} وحدة</span>
                <div className="flex gap-1">
                  <button type="button" onClick={() => setReturnDraft({kind: 'base', orderItemId: item.orderItemId,
                    productId: item.productId, representatives: item.physicalRepresentatives, quantity: 1, disposition: 'restock'})}
                    className="min-h-11 rounded bg-orange-700 px-3 py-2 text-white">مرتجع</button>
                  <button type="button" onClick={() => setReplacementSource(item.physicalRepresentatives.find(source => source.remainingQuantity > 0) || null)}
                    className="min-h-11 rounded bg-indigo-700 px-3 py-2 text-white">استبدال وحدة</button>
                </div>
              </div>
            </div>;
          })}
          {context.parcelInstances.map((parcel) => {
            const complete = parcel.components.every((component) =>
              rootQuantity(component.physicalRepresentatives) === component.quantity);
            return complete && <div key={parcel.parcelInstanceId} className="rounded-xl border border-slate-700 bg-slate-950 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2"><span>{order.items.find(line => line.id === parcel.orderItemId)?.productName || 'طرد'} · طرد كامل · {parcel.components.length} مكونات · <bdi dir="ltr" className="select-text break-all font-mono">{parcel.parcelInstanceId}</bdi></span>
                <button type="button" onClick={() => setReturnDraft({kind: 'parcel', parcel,
                   allocations: Object.fromEntries(parcel.components.flatMap((component) =>
                     component.physicalRepresentatives.map((source) => [source.sourceId, {
                       sellableRestock: source.remainingQuantity,
                       defectNonSellable: 0,
                       customerDamage: 0,
                     }])))})}
                  className="min-h-11 rounded bg-orange-700 px-3 py-2 text-white">مرتجع الطرد</button></div>
              <div className="mt-2 flex flex-wrap gap-1">
                {parcel.components.flatMap((component) => component.physicalRepresentatives
                  .map((source) => <button key={source.sourceId} type="button"
                    onClick={() => setReplacementSource(source)}
                    className="min-h-11 rounded border border-indigo-700 px-3 py-2 text-indigo-200">استبدال وحدة · {order.items.find(line => line.id === parcel.orderItemId)?.parcelInstances?.find(instance => instance.id === parcel.parcelInstanceId)?.components.find(value => value.id === component.parcelComponentId)?.name || 'مكوّن'}{source.sourceKind === 'replacement_item' ? ' · بديل حالي' : ''}</button>))}
              </div>
            </div>;
          })}
        </div>
      )}

      {replacementSource && <div className="space-y-2 rounded-xl border border-indigo-700 bg-slate-950 p-3">
        <b className="text-indigo-200">إصدار بديل من نفس الصنف — وحدة واحدة</b>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2}
          placeholder="سبب العيب/الاستبدال" className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-white"/>
        <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="ملاحظة داخلية"
          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-white"/>
        <div className="flex gap-2"><button type="button" disabled={busy} onClick={() => void runReplacement()}
          className="flex-1 rounded-lg bg-indigo-600 py-2 font-bold text-white disabled:opacity-50">{busy ? 'جاري الإصدار…' : 'اعتماد الاستبدال'}</button>
          <button type="button" onClick={resetForm} className="rounded-lg bg-slate-800 px-3">رجوع</button></div>
      </div>}

      {returnDraft && <div className="space-y-2 rounded-xl border border-orange-700 bg-slate-950 p-3">
        <b className="text-orange-200">مرتجع من القطعة الحالية</b>
        {returnDraft.kind === 'base' && <label className="block text-sm">كمية المرتجع (المتبقي {rootQuantity(returnDraft.representatives)})
          <input aria-label="كمية المرتجع" type="number" min={1} step={1}
            max={rootQuantity(returnDraft.representatives)} value={returnDraft.quantity}
            disabled={busy} onChange={event => setReturnDraft({...returnDraft, quantity: Number(event.target.value)})}
            className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-900 p-2"/>
        </label>}
        {returnDraft.kind === 'base' && <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setReturnDraft({...returnDraft, disposition: 'restock'})}
            className={`rounded-lg border p-2 ${returnDraft.disposition === 'restock' ? 'bg-emerald-700' : 'border-slate-700'}`}><PackageCheck className="mx-auto h-4 w-4"/>سليم</button>
          <button type="button" onClick={() => setReturnDraft({...returnDraft, disposition: 'damaged'})}
            className={`rounded-lg border p-2 ${returnDraft.disposition === 'damaged' ? 'bg-rose-700' : 'border-slate-700'}`}><PackageX className="mx-auto h-4 w-4"/>غير قابل للبيع</button>
        </div>}
        {returnDraft.kind === 'parcel' && <div className="space-y-2">
          {returnDraft.parcel.components.map((component, index) => <div key={component.parcelComponentId}
            className="rounded-lg border border-slate-800 p-2">
            <p className="mb-1 text-sm text-slate-300">{order.items.flatMap(line => line.parcelInstances || []).flatMap(instance => instance.components).find(value => value.id === component.parcelComponentId)?.name || `المكوّن ${index + 1}`} · {component.quantity} وحدة</p>
            {component.physicalRepresentatives.map((source, sourceIndex) => {
              const allocation = returnDraft.allocations[source.sourceId];
              const update = (field: keyof LeafAllocation, value: number) => setReturnDraft({
                ...returnDraft,
                allocations: {...returnDraft.allocations, [source.sourceId]: {
                  ...allocation, [field]: Number.isFinite(value) ? value : 0,
                }},
              });
              return <div key={source.sourceId} className="mt-2 rounded border border-slate-700 p-2">
                <p className="mb-1 text-sm text-slate-400">القطعة الحالية {sourceIndex + 1}{source.sourceKind === 'replacement_item' ? ' · بديل صادر' : ' · الأصل'} · {source.remainingQuantity} وحدة</p>
                <p role="status" className={`mb-2 text-sm ${allocation.sellableRestock + allocation.defectNonSellable + allocation.customerDamage === source.remainingQuantity ? 'text-emerald-300' : 'text-amber-300'}`}>مجموع التصنيف: {allocation.sellableRestock + allocation.defectNonSellable + allocation.customerDamage} / {source.remainingQuantity}</p>
                <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3 text-sm">
                  <label>سليم<input type="number" min={0} max={source.remainingQuantity}
                    value={allocation.sellableRestock}
                    onChange={(event) => update('sellableRestock', Number(event.target.value))}
                    className="mt-1 min-h-11 w-full rounded bg-slate-900 p-2"/></label>
                  <label>عيب/غير قابل للبيع<input type="number" min={0} max={source.remainingQuantity}
                    value={allocation.defectNonSellable}
                    onChange={(event) => update('defectNonSellable', Number(event.target.value))}
                    className="mt-1 min-h-11 w-full rounded bg-slate-900 p-2"/></label>
                  <label>ضرر عميل<input type="number" min={0} max={source.remainingQuantity}
                    value={allocation.customerDamage}
                    onChange={(event) => update('customerDamage', Number(event.target.value))}
                    className="mt-1 min-h-11 w-full rounded bg-slate-900 p-2"/></label>
                </div>
              </div>;
            })}
          </div>)}
        </div>}
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2}
          placeholder="سبب المرتجع" className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-white"/>
        <div className="grid grid-cols-3 gap-1">
          {([null, 'cash', 'cliq'] as RefundMethod[]).map((value) => <button key={value || 'debt'} type="button"
            onClick={() => setRefundMethod(value)} className={`rounded border p-2 ${refundMethod === value ? 'bg-orange-700' : 'border-slate-700'}`}>
            {value === null ? 'خفض ذمة فقط' : value === 'cash' ? 'كاش' : 'CliQ'}</button>)}
        </div>
        {refundMethod === 'cliq' && <input value={reference} onChange={(event) => setReference(event.target.value)}
          placeholder="مرجع CliQ" className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-white"/>}
        <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="ملاحظة داخلية"
          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-white"/>
        <div className="flex gap-2"><button type="button" disabled={busy} onClick={() => void runReturn()}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-orange-600 py-2 font-bold text-white disabled:opacity-50"><RotateCcw className="h-4 w-4"/>{busy ? 'جاري التسوية…' : 'اعتماد المرتجع'}</button>
          <button type="button" onClick={resetForm} className="rounded-lg bg-slate-800 px-3">رجوع</button></div>
      </div>}

      <div className="flex items-center justify-between text-[10px] text-slate-400">
        <span>{context.returns.length} مرتجع · {context.replacements.length} استبدال</span>
        <button type="button" onClick={() => void load()} className="flex items-center gap-1"><RefreshCw className="h-3 w-3"/>تحديث</button>
      </div>
    </section>
  );
};
