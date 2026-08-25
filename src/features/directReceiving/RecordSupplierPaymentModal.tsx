/**
 * Nawasrah Business Manager - Record Supplier Payment Modal
 * Allows recording payments against a specific direct receipt or supplier
 */

import React, { useState } from 'react';
import { SupplierReceipt } from '../../types/directReceiving';
import { recordSupplierReceiptPaymentInSupabase } from '../../services/supabase/directReceiving.service';
import { useAppStore } from '../../stores/useAppStore';
import { CURRENCY } from '../../constants';
import { DollarSign, Loader2 } from 'lucide-react';

interface RecordSupplierPaymentModalProps {
  receipt: SupplierReceipt;
  onClose: () => void;
  onSuccess: () => void;
}

export const RecordSupplierPaymentModal: React.FC<RecordSupplierPaymentModalProps> = ({
  receipt,
  onClose,
  onSuccess,
}) => {
  const { setToast } = useAppStore();
  const minorToJod = (fils: number) => fils / 1000;
  const remainingDueJod = minorToJod(receipt.amountDueInMinorUnits);

  const [paymentAmountJod, setPaymentAmountJod] = useState<number>(remainingDueJod);
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [referenceNumber, setReferenceNumber] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const handleSubmit = async () => {
    if (paymentAmountJod <= 0) {
      setToast('مبلغ الدفعة يجب أن يكون أكبر من صفر.', 'error');
      return;
    }

    if (paymentAmountJod > remainingDueJod) {
      setToast('مبلغ الدفعة أكبر من المبلغ المستحق المتبقي.', 'error');
      return;
    }

    setIsSubmitting(true);
    const amountInMinor = Math.round(paymentAmountJod * 1000);

    const res = await recordSupplierReceiptPaymentInSupabase(
      receipt.id,
      amountInMinor,
      paymentMethod,
      referenceNumber.trim() || undefined,
      notes.trim() || undefined
    );

    if (res.success) {
      setToast('تم تسجيل دفعة المورد وتحديث الرصيد بنجاح.', 'success');
      setIsSubmitting(false);
      onSuccess();
      onClose();
    } else {
      setToast(res.error || 'فشلت عملية تسجيل الدفعة.', 'error');
      setIsSubmitting(false);
    }
  };

  return (
    <div dir="rtl" className="space-y-4 text-xs text-slate-200">
      <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl space-y-2">
        <div className="flex items-center justify-between text-xs font-bold border-b border-slate-800 pb-2">
          <span>سند الاستلام: <strong className="text-blue-400">{receipt.receiptNumber}</strong></span>
          <span>المورد: <strong className="text-slate-100">{receipt.supplierName}</strong></span>
        </div>

        <div className="flex items-center justify-between text-xs pt-1">
          <span className="text-slate-400 font-bold">المستحق المتبقي على السند:</span>
          <span className="font-extrabold text-rose-400 text-sm">
            {remainingDueJod.toFixed(3)} {CURRENCY}
          </span>
        </div>
      </div>

      <div className="space-y-3 bg-slate-950 p-3.5 rounded-2xl border border-slate-800">
        <div>
          <label className="text-[11px] font-bold text-slate-400 block mb-1">
            مبلغ الدفعة المراد سدادها ({CURRENCY}) *
          </label>
          <input
            type="number"
            min="0.001"
            max={remainingDueJod}
            step="0.001"
            value={paymentAmountJod}
            onChange={(e) => setPaymentAmountJod(Math.max(0, Number(e.target.value) || 0))}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm font-extrabold text-emerald-400 text-center"
          />
        </div>

        <div>
          <label className="text-[11px] font-bold text-slate-400 block mb-1">طريقة الدفع</label>
          <div className="grid grid-cols-3 gap-2 text-xs font-bold">
            <button
              type="button"
              onClick={() => setPaymentMethod('cash')}
              className={`py-2 rounded-xl border transition ${
                paymentMethod === 'cash' ? 'bg-emerald-600 text-white border-emerald-500' : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              نقدي (Cash)
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethod('cliq')}
              className={`py-2 rounded-xl border transition ${
                paymentMethod === 'cliq' ? 'bg-purple-600 text-white border-purple-500' : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              CliQ
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethod('bank_transfer')}
              className={`py-2 rounded-xl border transition ${
                paymentMethod === 'bank_transfer' ? 'bg-blue-600 text-white border-blue-500' : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              تحويل بنكي
            </button>
          </div>
        </div>

        <div>
          <label className="text-[11px] font-bold text-slate-400 block mb-1">رقم المرجع / الحوالة</label>
          <input
            type="text"
            value={referenceNumber}
            onChange={(e) => setReferenceNumber(e.target.value)}
            placeholder="رقم مرجع الحوالة البنكية أو الشيك"
            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100"
          />
        </div>

        <div>
          <label className="text-[11px] font-bold text-slate-400 block mb-1">ملاحظات الدفعة</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="سداد دفعة على مستحقات سند توريد..."
            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100"
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          onClick={onClose}
          disabled={isSubmitting}
          className="bg-slate-800 text-slate-300 px-4 py-2 rounded-xl font-bold"
        >
          إلغاء
        </button>
        <button
          onClick={handleSubmit}
          disabled={isSubmitting || paymentAmountJod <= 0}
          className="bg-emerald-600 text-white px-5 py-2 rounded-xl font-extrabold hover:bg-emerald-500 transition flex items-center gap-1.5"
        >
          {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
          <span>تأكيد تسجيل الدفعة</span>
        </button>
      </div>
    </div>
  );
};
