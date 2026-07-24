/**
 * Nawasrah Business Manager - Supplier Payment Voucher (سند صرف) Modal
 */

import React, { useState, useEffect } from 'react';
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
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  CreditCard,
} from 'lucide-react';
import { CURRENCY } from '../../constants';

interface SupplierPaymentModalProps {
  isOpen: boolean;
  supplierId?: string;
  po?: PurchaseOrder | null;
  onClose: () => void;
  onSuccess: () => void;
}

export const SupplierPaymentModal: React.FC<SupplierPaymentModalProps> = ({
  isOpen,
  supplierId: initialSupplierId,
  po: initialPo,
  onClose,
  onSuccess,
}) => {
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

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  const loadData = async () => {
    const suppList = await fetchSuppliersFromSupabase();
    setSuppliers(suppList);

    const supId = initialPo?.supplierId || initialSupplierId || (suppList[0]?.id || '');
    setSelectedSupplierId(supId);

    if (supId) {
      loadSupplierOrders(supId);
    }

    if (initialPo) {
      setSelectedPoId(initialPo.id);
      setAmount(initialPo.amountDue);
    }
  };

  const loadSupplierOrders = async (supId: string) => {
    const res = await fetchPurchaseOrdersFromSupabase({ supplierId: supId });
    if (res.success) {
      // Filter orders that have amountDue > 0
      const unpaid = res.data.filter((p) => p.amountDue > 0 && p.status !== 'cancelled');
      setPos(unpaid);
    }
  };

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

    if (!selectedSupplierId) {
      setErrorMsg('يرجى اختيار المورد.');
      return;
    }

    if (!amount || amount <= 0) {
      setErrorMsg('يرجى إدخال مبلغ الدفعة بشكل صحيح أكبر من صفر.');
      return;
    }

    if (selectedPo && amount > selectedPo.amountDue) {
      setErrorMsg(`المبلغ المدخل (${amount} ${CURRENCY}) يتجاوز المبلغ المتبقي المستحق على طلب الشراء (${selectedPo.amountDue} ${CURRENCY}).`);
      return;
    }

    setIsSubmitting(true);

    const res = await recordSupplierPaymentInSupabase({
      supplierId: selectedSupplierId,
      purchaseOrderId: selectedPoId || undefined,
      amount: Number(amount),
      paymentMethod,
      referenceNumber: referenceNumber.trim() || undefined,
      paymentDate: paymentDate ? new Date(paymentDate).toISOString() : undefined,
      notes: notes.trim() || undefined,
    });

    setIsSubmitting(false);

    if (res.success) {
      onSuccess();
      onClose();
    } else {
      setErrorMsg(res.error || 'حدث خطأ أثناء تسديد الدفعة');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden my-auto flex flex-col">
        {/* Header */}
        <div className="bg-slate-800/80 px-5 py-4 border-b border-slate-700/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-rose-600/20 border border-rose-500/30 flex items-center justify-center text-rose-400 font-bold">
              <ArrowUpRight className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">تسجيل دفعة مورد (سند صرف)</h2>
              <p className="text-xs text-slate-400">توثيق تسديد مستحقات مالية للموردين وإصدار سند صرف رسمي</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-700/60 text-slate-300 hover:text-white flex items-center justify-center transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {errorMsg && (
            <div className="bg-rose-950/50 border border-rose-500/30 p-3 rounded-2xl text-rose-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Supplier Selector */}
          <div className="space-y-1">
            <label className="font-bold text-slate-300 flex items-center gap-1">
              <Building className="w-3.5 h-3.5 text-teal-400" />
              المورد المستفيد: <span className="text-rose-400">*</span>
            </label>
            <select
              value={selectedSupplierId}
              onChange={(e) => handleSupplierChange(e.target.value)}
              required
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-bold focus:outline-none focus:border-rose-500"
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
            <label className="font-bold text-slate-300 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-blue-400" />
                تخصيص لطلب شراء معين (اختياري):
              </span>
              {selectedPo && (
                <span className="text-amber-400 text-[11px] font-mono">
                  المتبقي: {selectedPo.amountDue.toFixed(2)} {CURRENCY}
                </span>
              )}
            </label>
            <select
              value={selectedPoId}
              onChange={(e) => handlePoChange(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-rose-500"
            >
              <option value="">-- دفعة عامة على الحساب --</option>
              {pos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.purchaseOrderNumber} | إجمالي: {p.totalAmount.toFixed(2)} | متبقي: {p.amountDue.toFixed(2)}{' '}
                  {CURRENCY}
                </option>
              ))}
            </select>
          </div>

          {/* Amount Input */}
          <div className="space-y-1">
            <label className="font-bold text-slate-300 flex items-center justify-between">
              <span>مبلغ الدفعة ({CURRENCY}): <span className="text-rose-400">*</span></span>
              <button
                type="button"
                onClick={() => {
                  if (selectedPo) setAmount(selectedPo.amountDue);
                }}
                className="text-[10px] text-blue-400 hover:underline"
              >
                دفع المتبقي بالكامل
              </button>
            </label>
            <div className="relative">
              <input
                type="number"
                step="0.001"
                min="0.001"
                value={amount || ''}
                onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                required
                placeholder="0.000"
                className="w-full bg-slate-800 border border-rose-500/50 rounded-xl px-3 py-2.5 text-slate-100 font-black text-lg focus:outline-none focus:border-rose-400 text-center"
              />
              <span className="absolute left-3 top-3 font-bold text-slate-400">{CURRENCY}</span>
            </div>
          </div>

          {/* Payment Method & Date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-bold text-slate-300">طريقة الدفع:</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-bold focus:outline-none focus:border-rose-500"
              >
                <option value="cash">نقداً (Cash)</option>
                <option value="bank_transfer">تحويل بنكي</option>
                <option value="check">شيك</option>
                <option value="card">بطاقة / مدى</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="font-bold text-slate-300">تاريخ الدفع:</label>
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-rose-500"
              />
            </div>
          </div>

          {/* Reference Number */}
          <div className="space-y-1">
            <label className="font-bold text-slate-300">رقم المرجع / رقم الشيك / رقم الحوالة:</label>
            <input
              type="text"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              placeholder="مثال: CHK-90214 أو TRF-88102"
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-rose-500"
            />
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <label className="font-bold text-slate-300">ملاحظات وقيد سند الصرف:</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="بيان سند الصرف..."
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-rose-500"
            />
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 font-bold transition"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !amount || amount <= 0}
              className="px-6 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold transition shadow-lg disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting ? (
                <span>جاري حفظ السند...</span>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>تأكيد وطباعة سند الصرف</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
