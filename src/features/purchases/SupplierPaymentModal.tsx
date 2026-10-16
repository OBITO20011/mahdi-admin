import {FormFields, Card, UiButton, formatJod} from '../../components/ui';
/**
 * Nawasrah Business Manager - Supplier Payment Voucher (سند صرف) Modal
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {useDialogFocus} from '../../hooks/useDialogFocus';
import { storeEngine, useAppStoreSelector } from '../../stores/useAppStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { ChequeRegistrationForm } from '../cheques/ChequeRegistrationForm';
import { useDrawerShortfallConfirm } from '../../hooks/useDrawerShortfallConfirm';
import { PurchaseOrder } from '../../types/purchases';
import { Supplier } from '../../types';
import {
  recordSupplierPaymentInSupabase,
  fetchSuppliersFromSupabase,
  fetchPurchaseOrdersFromSupabase,
} from '../../services/supabase/purchases.service';
import {
  X,
  ArrowUpRight,
  Building,
  FileText,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { CURRENCY } from '../../constants';

interface SupplierPaymentModalProps {
  isOpen: boolean;
  supplierId?: string;
  po?: PurchaseOrder | null;
  onClose: () => void;
  onSuccess: () => void;
}

const createSupplierPaymentIdempotencyKey = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `supplier-payment-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const SupplierPaymentModal = ({
  isOpen,
  supplierId: initialSupplierId,
  po: initialPo,
  onClose,
  onSuccess,
}: SupplierPaymentModalProps) => {
  const {roles} = useAuthStore();
  const canIssueCheque = roles.some(role => role === 'owner' || role === 'manager');
  const activeBranchId = useAppStoreSelector(state => state.activeBranch?.id ?? null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [selectedPoId, setSelectedPoId] = useState<string>('');
  const [amount, setAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [referenceNumber, setReferenceNumber] = useState<string>('');
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState<string>('');

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const panel = useDialogFocus(isOpen, () => { if (!isSubmitting) onClose(); }, true);
  const paymentIdempotencyKey = useRef(createSupplierPaymentIdempotencyKey());
  const drawer = useDrawerShortfallConfirm();
  const wasOpen = useRef(false);

  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      paymentIdempotencyKey.current = createSupplierPaymentIdempotencyKey();
    }
    wasOpen.current = isOpen;
  }, [isOpen]);

  const loadSupplierOrders = useCallback(async (supId: string) => {
    const res = await fetchPurchaseOrdersFromSupabase({ supplierId: supId });
    if (res.success) {
      // Actual receipt payable may exceed the planned PO total. The server
      // determines remaining capacity; a planned balance must not hide the PO.
      const unpaid = res.data.filter((purchaseOrder) => purchaseOrder.status !== 'cancelled');
      setPos(unpaid);
    }
  }, []);

  const loadData = useCallback(async () => {
    const suppList = await fetchSuppliersFromSupabase();
    setSuppliers(suppList);

    const supId = initialPo?.supplierId || initialSupplierId || (suppList[0]?.id || '');
    setSelectedSupplierId(supId);

    if (supId) {
      await loadSupplierOrders(supId);
    }

    if (initialPo) {
      setSelectedPoId(initialPo.id);
      setAmount(initialPo.amountDue);
    }
  }, [initialPo, initialSupplierId, loadSupplierOrders]);

  useEffect(() => {
    if (isOpen) {
      void loadData();
    }
  }, [isOpen, loadData]);

  if (!isOpen) return null;

  const handleSupplierChange = (supId: string) => {
    setSelectedSupplierId(supId);
    setSelectedPoId('');
    setAmount(0);
    loadSupplierOrders(supId);
  };

  const handlePoChange = (poId: string) => {
    setSelectedPoId(poId);
    if (poId) {
      const match = pos.find((p) => p.id === poId);
      if (match) {
        setAmount(match.amountDue);
      }
    }
  };

  const selectedPo = pos.find((p) => p.id === selectedPoId) || initialPo;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    // Both legacy and canonical spellings must use the registered lifecycle.
    if (paymentMethod === 'check' || paymentMethod === 'cheque') {
      setErrorMsg('الشيك يحتاج البنك والرقم والاستحقاق عبر دورة الشيكات، للمالك والمدير فقط.');
      return;
    }

    if (!selectedSupplierId) {
      setErrorMsg('يرجى اختيار المورد.');
      return;
    }

    if (!amount || amount <= 0) {
      setErrorMsg('يرجى إدخال مبلغ الدفعة بشكل صحيح أكبر من صفر.');
      return;
    }

    if (!drawer.confirmCash(Number(amount), paymentMethod === 'cash')) return;

    setIsSubmitting(true);
    try {

      const res = await recordSupplierPaymentInSupabase({
        supplierId: selectedSupplierId,
        purchaseOrderId: selectedPoId || undefined,
        amount: Number(amount),
        paymentMethod,
        referenceNumber: referenceNumber.trim() || undefined,
        paymentDate: paymentDate ? new Date(paymentDate).toISOString() : undefined,
        notes: notes.trim() || undefined,
        idempotencyKey: paymentIdempotencyKey.current,
      });



      if (res.success) {
        storeEngine.setToast('تم تسجيل دفعة المورد بنجاح', 'success');
        onSuccess();
        onClose();
      } else {
        setErrorMsg(res.error || 'حدث خطأ أثناء تسديد الدفعة');
        if (res.maxAllowedInMinorUnits !== undefined) setAmount(res.maxAllowedInMinorUnits/1000);
      }

    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <FormFields ref={panel as React.RefObject<HTMLDivElement>} tabIndex={-1} role="dialog" aria-modal="true" aria-label="دفعة المورد" aria-busy={isSubmitting} className="nw-purchasing-fields fixed inset-0 z-50 flex items-center justify-center bg-nw-overlay backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
      <Card padded={false} className="bg-nw-surface border border-nw-border rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden my-auto flex flex-col">
        {/* Header */}
        <div className="bg-nw-surface-2 px-5 py-4 border-b border-nw-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-nw-bad-bg border border-nw-border flex items-center justify-center text-nw-bad font-bold">
              <ArrowUpRight className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-nw-text">تسجيل دفعة مورد (سند صرف)</h2>
              <p className="text-xs text-nw-muted">توثيق تسديد مستحقات مالية للموردين وإصدار سند صرف رسمي</p>
            </div>
          </div>
          <UiButton variant="plain"
            type="button"
            disabled={isSubmitting}
            aria-label="إغلاق دفعة المورد"
            onClick={onClose}
            className="w-11 h-11 rounded-xl bg-nw-surface-2 text-nw-text hover:text-nw-text flex items-center justify-center transition h-auto min-h-11 min-w-0 whitespace-normal"
          >
            <X className="w-5 h-5" />
          </UiButton>
        </div>

        {/* Body Form */}
        {(paymentMethod === 'check' || paymentMethod === 'cheque') ? <div className="p-5 space-y-4">
          <UiButton disabled={isSubmitting} onClick={() => setPaymentMethod('cash')}>العودة لطرق الدفع الأخرى</UiButton>
          {selectedPoId && <p className="text-sm">لأمر الشراء <bdi>{selectedPo?.purchaseOrderNumber}</bdi></p>}
          {canIssueCheque ? <ChequeRegistrationForm direction="outgoing"
            parties={suppliers.map(supplier => ({id:supplier.id,name:supplier.companyName}))}
            partyId={selectedSupplierId || undefined} purchaseOrderId={selectedPoId || undefined}
            branchId={selectedPo?.branchId ?? activeBranchId} initialAmount={amount > 0 ? amount.toFixed(3) : ''} initialNotes={notes} onBusyChange={setIsSubmitting}
            onClose={onClose} onSaved={() => {
              storeEngine.setToast('تم تسجيل شيك المورد بنجاح', 'success');
              onSuccess(); onClose();
            }} /> : <p role="alert" className="text-sm text-nw-bad">إصدار شيك مورد متاح للمالك والمدير فقط.</p>}
        </div> : <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {errorMsg && (
            <div className="bg-nw-bad-bg border border-nw-border p-3 rounded-2xl text-nw-bad flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-nw-bad" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Supplier Selector */}
          <div className="space-y-1">
            <label className="font-bold text-nw-text flex items-center gap-1">
              <Building className="w-3.5 h-3.5 text-nw-ok" />
              المورد المستفيد: <span className="text-nw-bad">*</span>
            </label>
            <select aria-label="المورد"
              value={selectedSupplierId}
              onChange={(e) => handleSupplierChange(e.target.value)}
              required
              className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-3 py-2 text-nw-text font-bold focus:outline-none focus:border-nw-border"
            >
              <option value="">-- اختر المورد --</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.companyName}
                </option>
              ))}
            </select>
          </div>

          {/* Purchase Order Selector */}
          <div className="space-y-1">
            <label className="font-bold text-nw-text flex items-center justify-between">
              <span className="flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-nw-info" />
                تخصيص لطلب شراء معين (اختياري):
              </span>
              {selectedPo && (
                <span className="text-nw-warn text-[11px] font-mono">
                  المتبقي المخطط: {formatJod(selectedPo.amountDue)} {CURRENCY}
                </span>
              )}
            </label>
            <select aria-label="أمر الشراء"
              value={selectedPoId}
              onChange={(e) => handlePoChange(e.target.value)}
              className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-3 py-2 text-nw-text focus:outline-none focus:border-nw-border"
            >
              <option value="">-- دفعة عامة على الحساب --</option>
              {pos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.purchaseOrderNumber} | إجمالي مخطط: {formatJod(p.totalAmount)} | متبقي مخطط: {formatJod(p.amountDue)}{' '}
                  {CURRENCY}
                </option>
              ))}
            </select>
          </div>

          {/* Amount Input */}
          <div className="space-y-1">
            <label className="font-bold text-nw-text flex items-center justify-between">
              <span>مبلغ الدفعة ({CURRENCY}): <span className="text-nw-bad">*</span></span>
              <UiButton variant="plain"
                type="button"
                onClick={() => {
                  if (selectedPo) setAmount(selectedPo.amountDue);
                }}
                className="text-[10px] text-nw-info hover:underline h-auto min-h-11 min-w-0 whitespace-normal"
              >
                اقتراح المتبقي المخطط
              </UiButton>
            </label>
            <div className="relative">
              <input aria-label="0.000"
                type="number"
                step="0.001"
                min="0.001"
                value={amount || ''}
                onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                required
                placeholder="0.000"
                className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-3 py-2.5 text-nw-text font-black text-lg focus:outline-none focus:border-nw-border text-center"
              />
              <span className="absolute left-3 top-3 font-bold text-nw-muted">{CURRENCY}</span>
            </div>
          </div>

          {/* Payment Method & Date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-bold text-nw-text">طريقة الدفع:</label>
              <select aria-label="طريقة الدفع"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-3 py-2 text-nw-text font-bold focus:outline-none focus:border-nw-border"
              >
                <option value="cash">نقداً (Cash)</option>
                <option value="bank_transfer">تحويل بنكي</option>
                <option value="check" disabled={!canIssueCheque}>شيك مؤجل (المالك والمدير)</option>
                <option value="card">بطاقة / مدى</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="font-bold text-nw-text">تاريخ الدفع:</label>
              <input aria-label="تاريخ الدفع:"
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-3 py-2 text-nw-text focus:outline-none focus:border-nw-border"
              />
            </div>
          </div>

          {/* Reference Number */}
          <div className="space-y-1">
            <label className="font-bold text-nw-text">رقم المرجع / رقم الشيك / رقم الحوالة:</label>
            <input aria-label="مثال: CHK-90214 أو TRF-88102"
              type="text"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              placeholder="مثال: CHK-90214 أو TRF-88102"
              className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-3 py-2 text-nw-text focus:outline-none focus:border-nw-border"
            />
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <label className="font-bold text-nw-text">ملاحظات وقيد سند الصرف:</label>
            <input aria-label="بيان سند الصرف..."
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="بيان سند الصرف..."
              className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-3 py-2 text-nw-text focus:outline-none focus:border-nw-border"
            />
          </div>

          {drawer.warningNode}
          {/* Footer Actions */}
          <div className="pt-3 border-t border-nw-border flex items-center justify-end gap-3 shrink-0">
            <UiButton variant="plain"
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl bg-nw-surface-2 text-nw-text hover:bg-nw-surface-2 font-bold transition h-auto min-h-11 min-w-0 whitespace-normal"
            >
              إلغاء
            </UiButton>
            <UiButton variant="plain"
              type="submit"
              disabled={isSubmitting || !amount || amount <= 0}
              className="px-6 py-2 rounded-xl bg-nw-accent text-nw-on-accent font-bold transition shadow-lg disabled:opacity-50 flex items-center gap-2 h-auto min-h-11 min-w-0 whitespace-normal"
            >
              {isSubmitting ? (
                <span>جاري حفظ السند...</span>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>تأكيد وطباعة سند الصرف</span>
                </>
              )}
            </UiButton>
          </div>
        </form>}
      </Card>
    </FormFields>
  );
};
