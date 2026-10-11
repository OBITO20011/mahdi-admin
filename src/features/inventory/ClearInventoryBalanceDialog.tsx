import React, { useMemo, useState } from 'react';
import {useDialogFocus} from '../../hooks/useDialogFocus';
import {
  AlertTriangle,
  Boxes,
  ShieldAlert,
  Trash2,
  Warehouse,
  X,
} from 'lucide-react';
import { useAppStoreActions } from '../../stores/useAppStore';
import { Product } from '../../types';
import { formatProductInventory } from '../../utils/inventoryFormatter';

interface ClearInventoryBalanceDialogProps {
  product: Product;
  warehouseName: string;
  movementCount: number;
  onClose: () => void;
}

export const ClearInventoryBalanceDialog: React.FC<
  ClearInventoryBalanceDialogProps
> = ({ product, warehouseName, movementCount, onClose }) => {
  const { executeStockCount, setToast } = useAppStoreActions();
  const [confirmation, setConfirmation] = useState('');
  const [reason, setReason] = useState('تصفير الرصيد بعد مراجعة المخزون');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const panel = useDialogFocus(true, () => { if (!isSubmitting) onClose(); });

  const inventory = useMemo(
    () => formatProductInventory(product, false),
    [product]
  );
  const hasReservedStock = product.reservedQuantity > 0;
  const hasStock = product.onHandQuantity > 0;
  const hasWarehouse = Boolean(product.warehouseId);
  const confirmationMatches =
    confirmation.trim().toLocaleUpperCase('en-US') ===
    product.sku.trim().toLocaleUpperCase('en-US');
  const canClear =
    hasStock &&
    !hasReservedStock &&
    hasWarehouse &&
    confirmationMatches &&
    reason.trim().length >= 5 &&
    !isSubmitting;

  const handleClear = async () => {
    if (!hasWarehouse) {
      setToast('تعذر تحديد المستودع المرتبط بهذا الرصيد.', 'error');
      return;
    }
    if (hasReservedStock) {
      setToast(
        'لا يمكن تصفير الرصيد قبل إلغاء أو تسليم الكمية المحجوزة للطلبات.',
        'error'
      );
      return;
    }
    if (!confirmationMatches) {
      setToast('اكتب رمز SKU كما هو لتأكيد العملية.', 'error');
      return;
    }
    if (reason.trim().length < 5) {
      setToast('اكتب سبباً واضحاً لتصفير الرصيد.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await executeStockCount({
        productId: product.id,
        warehouseId: product.warehouseId,
        actualQuantity: 0,
        reason: reason.trim(),
        adjustmentType: 'manual',
      });


      if (result?.success) onClose();

    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      dir="rtl"
      ref={panel as React.RefObject<HTMLDivElement>}
      tabIndex={-1}
      aria-busy={isSubmitting}
      role="dialog"
      aria-modal="true"
      aria-labelledby="clear-inventory-title"
      className="fixed inset-0 z-[90] flex items-end justify-center bg-nw-side/80 p-2 backdrop-blur-sm sm:items-center"
    >
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-3xl border border-nw-bad/30 bg-nw-bg shadow-2xl shadow-nw-bad/50">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-nw-border bg-nw-bg p-4 backdrop-blur">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-nw-bad/30 bg-nw-bad-bg text-nw-bad">
              <Trash2 className="h-5 w-5" />
            </div>
            <div>
              <h3
                id="clear-inventory-title"
                className="text-sm font-black text-nw-text"
              >
                حذف الرصيد الحالي؟
              </h3>
              <p className="mt-1 text-[10px] leading-5 text-nw-muted">
                سيتم تصفير الكمية في المستودع، وليس حذف المنتج أو تاريخه.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="إغلاق"
            className="rounded-xl border border-nw-border bg-nw-surface p-2 text-nw-muted transition hover:text-nw-text disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-3 p-4 text-xs">
          <section className="rounded-2xl border border-nw-border bg-nw-surface p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-black text-nw-text">{product.nameAr}</p>
                <p className="mt-1 font-mono text-[10px] text-nw-info">
                  SKU: {product.sku}
                </p>
              </div>
              <span className="rounded-full border border-nw-bad/30 bg-nw-bad-bg px-2.5 py-1 text-[9px] font-black text-nw-bad">
                {inventory.totalPiecesFormatted}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-nw-border bg-nw-bg p-2.5">
                <div className="flex items-center gap-1 text-[9px] text-nw-muted">
                  <Warehouse className="h-3 w-3 text-nw-info" />
                  المستودع
                </div>
                <strong className="mt-1 block text-[10px] text-nw-text">
                  {warehouseName}
                </strong>
              </div>
              <div className="rounded-xl border border-nw-border bg-nw-bg p-2.5">
                <div className="flex items-center gap-1 text-[9px] text-nw-muted">
                  <Boxes className="h-3 w-3 text-nw-info" />
                  الحركات المحفوظة
                </div>
                <strong className="mt-1 block text-[10px] text-nw-text">
                  {movementCount} حركة
                </strong>
              </div>
            </div>
          </section>

          {hasReservedStock ? (
            <section className="flex items-start gap-2 rounded-2xl border border-nw-warn/30 bg-nw-warn-bg p-3 text-nw-warn">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <strong className="font-black">لا يمكن التصفير الآن</strong>
                <p className="mt-1 text-[10px] leading-5 text-nw-warn">
                  يوجد {product.reservedQuantity} {product.unit} محجوزاً لطلبات
                  زبائن. أكمل الطلبات أو ألغِها أولاً حتى يتحرر الحجز.
                </p>
              </div>
            </section>
          ) : (
            <section className="flex items-start gap-2 rounded-2xl border border-nw-bad/25 bg-nw-bad-bg p-3 text-nw-bad">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-[10px] leading-5">
                سيُسجّل النظام حركة طرح بقيمة{' '}
                <strong>{product.onHandQuantity} {product.unit}</strong> وسجل
                تدقيق في Supabase. يمكن إعادة الكمية لاحقاً فقط من خلال استلام
                جديد أو جرد موثّق.
              </p>
            </section>
          )}

          <label className="block space-y-1.5">
            <span className="font-bold text-nw-text">سبب تصفير الرصيد</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={hasReservedStock || isSubmitting}
              rows={2}
              className="w-full resize-none rounded-xl border border-nw-border bg-nw-surface px-3 py-2.5 text-xs text-nw-text outline-none transition focus:border-nw-bad disabled:opacity-50"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="font-bold text-nw-text">
              للتأكيد اكتب رمز الصنف: {product.sku}
            </span>
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              disabled={hasReservedStock || !hasStock || isSubmitting}
              autoComplete="off"
              placeholder={product.sku}
              className="w-full rounded-xl border border-nw-border bg-nw-surface px-3 py-2.5 font-mono text-xs text-nw-text outline-none transition focus:border-nw-bad disabled:opacity-50"
            />
          </label>

          {!hasStock && (
            <p className="rounded-xl border border-nw-border bg-nw-surface p-3 text-center text-[10px] text-nw-muted">
              رصيد هذا المنتج صفر بالفعل ولا توجد كمية لحذفها.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={handleClear}
              disabled={!canClear}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-nw-bad-bg py-3 font-black text-nw-bad transition hover:bg-nw-bad-bg disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" />
              {isSubmitting ? 'جاري التصفير...' : 'نعم، صفّر الرصيد'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-xl border border-nw-border bg-nw-surface py-3 font-bold text-nw-text transition hover:bg-nw-surface-2 disabled:opacity-50"
            >
              إلغاء
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
