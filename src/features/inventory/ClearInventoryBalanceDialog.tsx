import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  ShieldAlert,
  Trash2,
  Warehouse,
  X,
} from 'lucide-react';
import { useAppStore } from '../../stores/useAppStore';
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
  const { executeStockCount, setToast } = useAppStore();
  const [confirmation, setConfirmation] = useState('');
  const [reason, setReason] = useState('تصفير الرصيد بعد مراجعة المخزون');
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    const result = await executeStockCount({
      productId: product.id,
      warehouseId: product.warehouseId,
      actualQuantity: 0,
      reason: reason.trim(),
      adjustmentType: 'manual',
    });
    setIsSubmitting(false);

    if (result?.success) onClose();
  };

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clear-inventory-title"
      className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/85 p-2 backdrop-blur-sm sm:items-center"
    >
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-3xl border border-rose-500/30 bg-slate-950 shadow-2xl shadow-rose-950/50">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-800 bg-slate-950/95 p-4 backdrop-blur">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-rose-500/30 bg-rose-500/10 text-rose-400">
              <Trash2 className="h-5 w-5" />
            </div>
            <div>
              <h3
                id="clear-inventory-title"
                className="text-sm font-black text-slate-100"
              >
                حذف الرصيد الحالي؟
              </h3>
              <p className="mt-1 text-[10px] leading-5 text-slate-400">
                سيتم تصفير الكمية في المستودع، وليس حذف المنتج أو تاريخه.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="إغلاق"
            className="rounded-xl border border-slate-800 bg-slate-900 p-2 text-slate-400 transition hover:text-slate-100 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-3 p-4 text-xs">
          <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-black text-slate-100">{product.nameAr}</p>
                <p className="mt-1 font-mono text-[10px] text-blue-300">
                  SKU: {product.sku}
                </p>
              </div>
              <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[9px] font-black text-rose-300">
                {inventory.totalPiecesFormatted}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-2.5">
                <div className="flex items-center gap-1 text-[9px] text-slate-500">
                  <Warehouse className="h-3 w-3 text-indigo-400" />
                  المستودع
                </div>
                <strong className="mt-1 block text-[10px] text-slate-200">
                  {warehouseName}
                </strong>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-2.5">
                <div className="flex items-center gap-1 text-[9px] text-slate-500">
                  <Boxes className="h-3 w-3 text-violet-400" />
                  الحركات المحفوظة
                </div>
                <strong className="mt-1 block text-[10px] text-slate-200">
                  {movementCount} حركة
                </strong>
              </div>
            </div>
          </section>

          {hasReservedStock ? (
            <section className="flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <strong className="font-black">لا يمكن التصفير الآن</strong>
                <p className="mt-1 text-[10px] leading-5 text-amber-100/75">
                  يوجد {product.reservedQuantity} {product.unit} محجوزاً لطلبات
                  زبائن. أكمل الطلبات أو ألغِها أولاً حتى يتحرر الحجز.
                </p>
              </div>
            </section>
          ) : (
            <section className="flex items-start gap-2 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-3 text-rose-200">
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
            <span className="font-bold text-slate-300">سبب تصفير الرصيد</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={hasReservedStock || isSubmitting}
              rows={2}
              className="w-full resize-none rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-xs text-slate-100 outline-none transition focus:border-rose-500 disabled:opacity-50"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="font-bold text-slate-300">
              للتأكيد اكتب رمز الصنف: {product.sku}
            </span>
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              disabled={hasReservedStock || !hasStock || isSubmitting}
              autoComplete="off"
              placeholder={product.sku}
              className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 font-mono text-xs text-slate-100 outline-none transition focus:border-rose-500 disabled:opacity-50"
            />
          </label>

          {!hasStock && (
            <p className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-center text-[10px] text-slate-400">
              رصيد هذا المنتج صفر بالفعل ولا توجد كمية لحذفها.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={handleClear}
              disabled={!canClear}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 py-3 font-black text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" />
              {isSubmitting ? 'جاري التصفير...' : 'نعم، صفّر الرصيد'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-xl border border-slate-800 bg-slate-900 py-3 font-bold text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
            >
              إلغاء
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
