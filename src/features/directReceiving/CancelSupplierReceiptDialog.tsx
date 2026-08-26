import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { SupplierReceipt } from '../../types/directReceiving';
import { CURRENCY } from '../../constants';
import { Modal } from '../../components/common/Modal';
import { cancelSupplierReceiptInSupabase } from '../../services/supabase/directReceiving.service';
import { useAppStoreActions } from '../../stores/useAppStore';

interface CancelSupplierReceiptDialogProps {
  receipt: SupplierReceipt | null;
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
}

export const CancelSupplierReceiptDialog: React.FC<
  CancelSupplierReceiptDialogProps
> = ({ receipt, onClose, onSuccess }) => {
  const { setToast, refreshProductsFromSupabase } = useAppStoreActions();
  const [reason, setReason] = useState('تم إدخال سند الاستلام بالخطأ');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (receipt) {
      setReason('تم إدخال سند الاستلام بالخطأ');
      setIsSubmitting(false);
    }
  }, [receipt]);

  if (!receipt) return null;

  const handleConfirm = async () => {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setToast('اكتب سبب إلغاء سند الاستلام.', 'error');
      return;
    }

    setIsSubmitting(true);
    const result = await cancelSupplierReceiptInSupabase(
      receipt.id,
      trimmedReason
    );

    if (!result.success) {
      setToast(
        result.error ||
          'تعذر إلغاء السند. قد تكون البضاعة بيعت أو حُجزت لطلب زبون.',
        'error'
      );
      setIsSubmitting(false);
      return;
    }

    await refreshProductsFromSupabase();
    await onSuccess();
    setToast(
      `تم إلغاء السند ${result.data?.receiptNumber || receipt.receiptNumber} وعكس ${
        result.data?.inventoryUnitsReversed || 0
      } وحدة من المخزون بنجاح.`,
      'success'
    );
    setIsSubmitting(false);
    onClose();
  };

  return (
    <Modal
      isOpen={Boolean(receipt)}
      onClose={isSubmitting ? () => undefined : onClose}
      title="تأكيد إلغاء سند الاستلام"
      subtitle="عملية عكس محاسبية ومخزنية موثقة، وليست حذفاً نهائياً للسجل"
    >
      <div dir="rtl" className="space-y-4 text-xs">
        <div className="flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-950/40 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
          <div className="space-y-1">
            <strong className="block text-sm text-rose-200">
              هل أنت متأكد من إلغاء {receipt.receiptNumber}؟
            </strong>
            <p className="leading-5 text-rose-200/80">
              سيُعكس كامل مخزون الأصناف المستلمة، وتُلغى ذمة المورد، وتُعلّم
              الدفعات المسجلة كدفعات معكوسة مع الاحتفاظ بسجل التدقيق.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <div>
            <span className="block text-[10px] text-slate-500">المورد</span>
            <strong className="text-slate-200">{receipt.supplierName}</strong>
          </div>
          <div>
            <span className="block text-[10px] text-slate-500">قيمة السند</span>
            <strong className="text-emerald-300">
              {(receipt.totalInMinorUnits / 1000).toFixed(3)} {CURRENCY}
            </strong>
          </div>
          <div>
            <span className="block text-[10px] text-slate-500">
              الكمية التي ستُعكس
            </span>
            <strong className="text-amber-300">
              {receipt.items?.reduce(
                (total, item) => total + item.totalBaseUnits,
                0
              ) || 0}{' '}
              وحدة
            </strong>
          </div>
          <div>
            <span className="block text-[10px] text-slate-500">
              الدفعة التي ستُعكس
            </span>
            <strong className="text-rose-300">
              {(receipt.amountPaidInMinorUnits / 1000).toFixed(3)} {CURRENCY}
            </strong>
          </div>
        </div>

        <div>
          <label className="mb-1 block font-bold text-slate-300">
            سبب الإلغاء <span className="text-rose-400">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={isSubmitting}
            rows={3}
            className="w-full resize-none rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-rose-500"
            placeholder="مثال: تم إدخال سند الاستلام بالخطأ"
          />
        </div>

        <p className="rounded-xl border border-amber-500/20 bg-amber-950/20 p-2.5 text-[10px] leading-5 text-amber-200">
          للحماية: إذا تم بيع الكمية أو حجزها لطلب زبون فلن يسمح Supabase
          بإلغاء السند.
        </p>

        <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 font-bold text-slate-300 disabled:opacity-50"
          >
            لا، رجوع
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting || !reason.trim()}
            className="flex items-center gap-1.5 rounded-xl border border-rose-500 bg-rose-600 px-4 py-2 font-extrabold text-white transition hover:bg-rose-500 disabled:opacity-50"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            <span>{isSubmitting ? 'جارٍ عكس السند...' : 'نعم، إلغاء السند'}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
