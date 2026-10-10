import {FormFields, Card, formatJod, UiButton} from '../../components/ui';
/**
 * Nawasrah Business Manager - Record Supplier Payment Modal
 * Allows recording payments against a specific direct receipt or supplier
 */

import React, { useRef, useState } from 'react';
import { SupplierReceipt } from '../../types/directReceiving';
import { recordSupplierReceiptPaymentInSupabase } from '../../services/supabase/directReceiving.service';
import { useAppStoreActions } from '../../stores/useAppStore';
import { CURRENCY } from '../../constants';
import { DollarSign, Loader2 } from 'lucide-react';

interface RecordSupplierPaymentModalProps {
  receipt: SupplierReceipt;
  onClose: () => void;
  onSuccess: () => void;
}

const createSupplierReceiptPaymentIdempotencyKey = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `supplier-receipt-payment-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const RecordSupplierPaymentModal: React.FC<RecordSupplierPaymentModalProps> = ({
  receipt,
  onClose,
  onSuccess,
}) => {
  const { setToast } = useAppStoreActions();
  const minorToJod = (fils: number) => fils / 1000;
  const remainingDueJod = minorToJod(receipt.amountDueInMinorUnits);

  const [paymentAmountJod, setPaymentAmountJod] = useState<number>(remainingDueJod);
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [referenceNumber, setReferenceNumber] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const paymentIdempotencyKey = useRef(createSupplierReceiptPaymentIdempotencyKey());

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
    try {
      const amountInMinor = Math.round(paymentAmountJod * 1000);

      const res = await recordSupplierReceiptPaymentInSupabase(
        receipt.id,
        amountInMinor,
        paymentMethod,
        referenceNumber.trim() || undefined,
        notes.trim() || undefined,
        paymentIdempotencyKey.current
      );

      if (res.success) {
        setToast('تم تسجيل دفعة المورد وتحديث الرصيد بنجاح.', 'success');

        onSuccess();
        onClose();
      } else {
        setToast(res.error || 'فشلت عملية تسجيل الدفعة.', 'error');

      }

    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <FormFields aria-busy={isSubmitting} dir="rtl" className="nw-purchasing-fields space-y-4 text-xs text-nw-text">
      <Card padded={false} className="bg-nw-surface border border-nw-border p-3.5 rounded-2xl space-y-2">
        <div className="flex items-center justify-between text-xs font-bold border-b border-nw-border pb-2">
          <span>سند الاستلام: <strong className="text-nw-info">{receipt.receiptNumber}</strong></span>
          <span>المورد: <strong className="text-nw-text">{receipt.supplierName}</strong></span>
        </div>

        <div className="flex items-center justify-between text-xs pt-1">
          <span className="text-nw-muted font-bold">المستحق المتبقي على السند:</span>
          <span className="font-extrabold text-nw-bad text-sm">
            {formatJod(remainingDueJod)} {CURRENCY}
          </span>
        </div>
      </Card>

      <div className="space-y-3 bg-nw-bg p-3.5 rounded-2xl border border-nw-border">
        <div>
          <label className="text-[11px] font-bold text-nw-muted block mb-1">
            مبلغ الدفعة المراد سدادها ({CURRENCY}) *
          </label>
          <input aria-label="مبلغ الدفعة المراد سدادها ( ) *"
            type="number"
            min="0.001"
            max={remainingDueJod}
            step="0.001"
            value={paymentAmountJod}
            onChange={(e) => setPaymentAmountJod(Math.max(0, Number(e.target.value) || 0))}
            className="w-full bg-nw-surface border border-nw-border rounded-xl px-3 py-2 text-sm font-extrabold text-nw-ok text-center"
          />
        </div>

        <div>
          <label className="text-[11px] font-bold text-nw-muted block mb-1">طريقة الدفع</label>
          <div className="grid grid-cols-3 gap-2 text-xs font-bold">
            <UiButton variant="plain"
              type="button"
              onClick={() => setPaymentMethod('cash')}
              className={`py-2 rounded-xl border transition ${
                paymentMethod === 'cash' ? 'bg-nw-ok-bg text-nw-text border-nw-border' : 'bg-nw-surface border-nw-border text-nw-muted'
              }`}
            >
              نقدي (Cash)
            </UiButton>
            <UiButton variant="plain"
              type="button"
              onClick={() => setPaymentMethod('cliq')}
              className={`py-2 rounded-xl border transition ${
                paymentMethod === 'cliq' ? 'bg-nw-info-bg text-nw-text border-nw-border' : 'bg-nw-surface border-nw-border text-nw-muted'
              }`}
            >
              CliQ
            </UiButton>
            <UiButton variant="plain"
              type="button"
              onClick={() => setPaymentMethod('bank_transfer')}
              className={`py-2 rounded-xl border transition ${
                paymentMethod === 'bank_transfer' ? 'bg-nw-info-bg text-nw-text border-nw-border' : 'bg-nw-surface border-nw-border text-nw-muted'
              }`}
            >
              تحويل بنكي
            </UiButton>
          </div>
        </div>

        <div>
          <label className="text-[11px] font-bold text-nw-muted block mb-1">رقم المرجع / الحوالة</label>
          <input aria-label="رقم مرجع الحوالة البنكية أو الشيك"
            type="text"
            value={referenceNumber}
            onChange={(e) => setReferenceNumber(e.target.value)}
            placeholder="رقم مرجع الحوالة البنكية أو الشيك"
            className="w-full bg-nw-surface border border-nw-border rounded-xl px-3 py-2 text-xs text-nw-text"
          />
        </div>

        <div>
          <label className="text-[11px] font-bold text-nw-muted block mb-1">ملاحظات الدفعة</label>
          <input aria-label="سداد دفعة على مستحقات سند توريد..."
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="سداد دفعة على مستحقات سند توريد..."
            className="w-full bg-nw-surface border border-nw-border rounded-xl px-3 py-2 text-xs text-nw-text"
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        <UiButton variant="plain" type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="bg-nw-surface-2 text-nw-text px-4 py-2 rounded-xl font-bold h-auto min-h-11 min-w-0 whitespace-normal"
        >
          إلغاء
        </UiButton>
        <UiButton variant="plain" type="button"
          onClick={handleSubmit}
          disabled={isSubmitting || paymentAmountJod <= 0}
          className="bg-nw-accent text-nw-on-accent px-5 py-2 rounded-xl font-extrabold transition flex items-center gap-1.5 h-auto min-h-11 min-w-0 whitespace-normal"
        >
          {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
          <span>تأكيد تسجيل الدفعة</span>
        </UiButton>
      </div>
    </FormFields>
  );
};
