import {formatJod, formatUiDate, UiButton} from '../../components/ui';
import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { SupplierReceipt } from '../../types/directReceiving';
import { CURRENCY } from '../../constants';
import { Modal } from '../../components/common/Modal';
import { cancelSupplierReceiptInSupabase, previewSupplierReceiptCancellation } from '../../services/supabase/directReceiving.service';
import type {SupplierCancellationPreview} from '../../utils/supplierCancellationPreview';
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
  const [preview, setPreview] = useState<SupplierCancellationPreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setPreview(null);
    setPreviewError('');
    if (receipt) {
      setReason('تم إدخال سند الاستلام بالخطأ');
      setIsSubmitting(false);
      setIsLoading(true);
      void previewSupplierReceiptCancellation(receipt.id).then(data => {
        if (active) setPreview(data);
      }).catch((error: unknown) => {
        if (active) setPreviewError(error instanceof Error ? error.message : 'تعذر تحميل معاينة الإلغاء.');
      }).finally(() => { if (active) setIsLoading(false); });
    }
    return () => { active = false; };
  }, [receipt]);

  if (!receipt) return null;

  const handleConfirm = async () => {
    if (isSubmitting || !preview) return;
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setToast('اكتب سبب إلغاء سند الاستلام.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const fresh = await previewSupplierReceiptCancellation(receipt.id);
      if (JSON.stringify(fresh) !== JSON.stringify(preview)) {
        setPreview(fresh);
        setPreviewError('تغيّرت الدفعات أو رصيد المورد. راجع الأرقام الجديدة ثم أكّد الإلغاء مجدداً.');
        return;
      }
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

      onClose();
    } catch (error: unknown) {
      setPreview(null);
      setPreviewError(error instanceof Error ? error.message : 'تعذر التحقق من الإلغاء. أعد فتح السند.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={Boolean(receipt)}
      onClose={isSubmitting ? () => undefined : onClose}
      title="تأكيد إلغاء سند الاستلام"
      subtitle="عملية عكس محاسبية ومخزنية موثقة، وليست حذفاً نهائياً للسجل"
      closeDisabled={isSubmitting}
    >
      <div dir="rtl" aria-busy={isSubmitting} className="space-y-4 text-xs">
        {isLoading && <p role="status">جارٍ تحميل الدفعات ورصيد المورد...</p>}
        {previewError && <p role="alert" className="text-nw-warn">{previewError}</p>}
        <div className="flex items-start gap-3 rounded-2xl border border-nw-border bg-nw-bad-bg p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-nw-bad" />
          <div className="space-y-1">
            <strong className="block text-sm text-nw-bad">
              هل أنت متأكد من إلغاء {receipt.receiptNumber}؟
            </strong>
            <p className="leading-5 text-nw-bad">
              سيُعكس كامل مخزون الأصناف المستلمة، وتُلغى ذمة المورد، وتُعلّم
              الدفعات المسجلة كدفعات معكوسة مع الاحتفاظ بسجل التدقيق.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-2xl border border-nw-border bg-nw-bg p-3">
          <div>
            <span className="block text-[10px] text-nw-muted">المورد</span>
            <strong className="text-nw-text">{receipt.supplierName}</strong>
          </div>
          <div>
            <span className="block text-[10px] text-nw-muted">قيمة السند</span>
            <strong className="text-nw-ok">
              {preview ? formatJod((preview.total / 1000)) : '—'} {CURRENCY}
            </strong>
          </div>
          <div>
            <span className="block text-[10px] text-nw-muted">
              الكمية التي ستُعكس
            </span>
            <strong className="text-nw-warn">
              {receipt.items?.reduce(
                (total, item) => total + item.totalBaseUnits,
                0
              ) || 0}{' '}
              وحدة
            </strong>
          </div>
          <div>
            <span className="block text-[10px] text-nw-muted">
              الدفعة التي ستُعكس
            </span>
            <strong className="text-nw-bad">
              {preview ? formatJod((preview.paymentsTotal / 1000)) : '—'} {CURRENCY}
            </strong>
          </div>
        </div>

        {preview && <section aria-label="الدفعات التي ستُعكس" className="space-y-2 rounded-xl border border-nw-border p-3">
          <h4 className="font-bold">الدفعات التي ستُعكس</h4>
          {preview.payments.length === 0 && <p>لا توجد دفعات فعالة لهذا السند.</p>}
          {preview.payments.map(payment => <div key={payment.id} className="border-b border-nw-border pb-2">
            <p>{formatJod((payment.amount / 1000))} {CURRENCY} — {({cash: 'نقداً', cliq: 'CliQ', bank_transfer: 'تحويل بنكي', check: 'شيك', card: 'بطاقة'} as Record<string, string>)[payment.method] || payment.method} — {formatUiDate(payment.date, {year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</p>
            {payment.method === 'cash' && payment.cashShiftStatus === 'closed' && <p className="text-nw-warn">هذه دفعة نقدية من وردية مغلقة؛ سيُسجّل عكسها، وليس دفع مبلغ جديد من تلك الوردية.</p>}
          </div>)}
          <p>رصيد المورد قبل: {formatJod((preview.supplierBalanceBefore / 1000))} {CURRENCY}</p>
          <p>رصيد المورد بعد: {formatJod((preview.supplierBalanceAfter / 1000))} {CURRENCY}</p>
        </section>}

        <div>
          <label className="mb-1 block font-bold text-nw-text">
            سبب الإلغاء <span className="text-nw-bad">*</span>
          </label>
          <textarea aria-label="مثال: تم إدخال سند الاستلام بالخطأ"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={isSubmitting}
            rows={3}
            className="w-full resize-none rounded-xl border border-nw-border bg-nw-bg px-3 py-2 text-nw-text outline-none focus:border-nw-border"
            placeholder="مثال: تم إدخال سند الاستلام بالخطأ"
          />
        </div>

        <p className="rounded-xl border border-nw-border bg-nw-warn-bg p-2.5 text-[10px] leading-5 text-nw-warn">
          للحماية: إذا تم بيع الكمية أو حجزها لطلب زبون فلن يسمح Supabase
          بإلغاء السند.
        </p>

        <div className="flex items-center justify-end gap-2 border-t border-nw-border pt-3">
          <UiButton variant="plain"
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-xl border border-nw-border bg-nw-surface-2 px-4 py-2 font-bold text-nw-text disabled:opacity-50 h-auto min-h-11 min-w-0 whitespace-normal"
          >
            لا، رجوع
          </UiButton>
          <UiButton variant="plain"
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting || isLoading || !preview || !reason.trim()}
            className="flex items-center gap-1.5 rounded-xl border border-nw-border bg-nw-bad-bg px-4 py-2 font-extrabold text-nw-text transition hover:bg-nw-bad-bg disabled:opacity-50 h-auto min-h-11 min-w-0 whitespace-normal"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            <span>{isSubmitting ? 'جارٍ عكس السند...' : preview?.paymentsTotal
              ? `إلغاء السند وعكس ${preview.payments.length === 1 ? 'دفعة' : 'دفعات'} ${formatJod((preview.paymentsTotal / 1000))}`
              : 'نعم، إلغاء السند'}</span>
          </UiButton>
        </div>
      </div>
    </Modal>
  );
};
