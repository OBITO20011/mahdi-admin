import {FormFields,UiButton} from '../../components/ui';
/**
 * Nawasrah Business Manager - Stock Adjustment Modal
 */

import React, { useState } from 'react';
import { useAppStoreActions } from '../../stores/useAppStore';
import { Product } from '../../types';
import { formatProductInventory, formatWholesaleInventory } from '../../utils/inventoryFormatter';
import { Plus, Minus, Check, Loader2 } from 'lucide-react';

interface StockAdjustmentModalProps {
  product: Product;
  mode?: 'add' | 'deduct';
  onClose: () => void;
}

export const StockAdjustmentModal: React.FC<StockAdjustmentModalProps> = ({
  product,
  mode = 'add',
  onClose,
}) => {
  const { executeStockCount, setToast } = useAppStoreActions();

  const [adjustType, setAdjustType] = useState<'delta' | 'exact'>('delta');
  const [quantityValue, setQuantityValue] = useState<number>(1);
  const [isDeduct, setIsDeduct] = useState<boolean>(mode === 'deduct');
  const [reason, setReason] = useState<string>(
    mode === 'deduct'
      ? 'تعديل بسبب تالف / منتهي'
      : 'تسوية زيادة ظهرت أثناء الجرد'
  );
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentOnHand = product.onHandQuantity;

  let calculatedNewOnHand = currentOnHand;
  if (adjustType === 'delta') {
    calculatedNewOnHand = isDeduct
      ? Math.max(0, currentOnHand - quantityValue)
      : currentOnHand + quantityValue;
  } else {
    calculatedNewOnHand = Math.max(0, quantityValue);
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (product.isFlavorMaster) {
      setToast(
        'المنتج الأساسي للنكهات لا يحمل مخزونًا؛ اختر نكهة محددة.',
        'error'
      );
      return;
    }
    if (!product.warehouseId) {
      setToast('لا يوجد مستودع مرتبط بهذا المنتج.', 'error');
      return;
    }

    const finalReason = notes ? `${reason} (${notes})` : reason;
    setIsSubmitting(true);
    try {
      const result = await executeStockCount({
        productId: product.id,
        actualQuantity: calculatedNewOnHand,
        warehouseId: product.warehouseId,
        reason: finalReason,
        adjustmentType: isDeduct ? 'damage' : 'manual',
      });

      if (result?.success) onClose();

    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <FormFields className="nw-products-fields min-w-0"><form onSubmit={handleSave} aria-busy={isSubmitting} className="nw-products-fields min-w-0 space-y-4 text-nw-text text-sm">
      {/* Product Card Header */}
      <div className="bg-nw-surface p-3 rounded-2xl border border-nw-border flex items-center gap-3">
        <img
          src={product.imageUrl}
          alt={product.nameAr}
          className="w-12 h-12 rounded-xl object-cover border border-nw-border"
        />
        <div className="flex-1 min-w-0">
          <h4 className="font-extrabold text-nw-text truncate text-sm">{product.nameAr}</h4>
          <p className="text-xs text-nw-muted">
            المخزون الحالي: <strong className="text-nw-ok font-bold">{formatProductInventory(product).fullFormatted}</strong>
          </p>
        </div>
      </div>

      {/* Adjust Mode Selection Toggle */}
      <div className="flex bg-nw-surface p-1 rounded-xl border border-nw-border">
        <UiButton variant="plain"
          type="button"
          onClick={() => {
            setIsDeduct(false);
            setReason('تسوية زيادة ظهرت أثناء الجرد');
          }}
          className={`flex-1 py-2 rounded-lg font-bold flex items-center justify-center gap-1.5 transition ${
            !isDeduct ? 'bg-nw-ok text-nw-on-primary shadow' : 'text-nw-muted hover:text-nw-text'
          }`}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>تسوية زيادة جرد (+)</span>
        </UiButton>

        <UiButton variant="plain"
          type="button"
          onClick={() => {
            setIsDeduct(true);
            setReason('خصم بسبب تلف / نقص جرد');
          }}
          className={`flex-1 py-2 rounded-lg font-bold flex items-center justify-center gap-1.5 transition ${
            isDeduct ? 'bg-nw-bad text-nw-on-primary shadow' : 'text-nw-muted hover:text-nw-text'
          }`}
        >
          <Minus className="w-3.5 h-3.5" />
          <span>خصم من المخزون (-)</span>
        </UiButton>
      </div>

      {/* Adjustment Method: Delta vs Exact Stock */}
      <div className="space-y-1.5">
        <label className="text-xs font-bold text-nw-text block">طريقة التعديل</label>
        <div className="grid grid-cols-2 gap-2">
          <UiButton variant="plain"
            type="button"
            onClick={() => {
              setAdjustType('delta');
              setQuantityValue(1);
            }}
            className={`p-2.5 rounded-xl border text-right transition ${
              adjustType === 'delta'
                ? 'bg-nw-info-bg border-nw-primary text-nw-info'
                : 'bg-nw-surface border-nw-border text-nw-muted'
            }`}
          >
            <strong className="block text-sm font-extrabold">كمية مضافة / مخصومة</strong>
            <span className="text-xs ">مثال: إضافة +10 قطع</span>
          </UiButton>

          <UiButton variant="plain"
            type="button"
            onClick={() => {
              setAdjustType('exact');
              setQuantityValue(currentOnHand);
            }}
            className={`p-2.5 rounded-xl border text-right transition ${
              adjustType === 'exact'
                ? 'bg-nw-info-bg border-nw-primary text-nw-info'
                : 'bg-nw-surface border-nw-border text-nw-muted'
            }`}
          >
            <strong className="block text-sm font-extrabold">تحديد الجرد الفعلي المباشر</strong>
            <span className="text-xs ">مثال: المخزون الفعلي هو 25</span>
          </UiButton>
        </div>
      </div>

      {/* Quantity Input */}
      <div className="space-y-1">
        <label className="text-xs font-bold text-nw-text block">
          {adjustType === 'delta'
            ? isDeduct
              ? 'الكمية المراد خصمها:'
              : 'الكمية المراد إضافتها:'
            : 'الكمية الفعلية الصحيحة بالرف:'}
        </label>
        <div className="flex items-center gap-2">
          <UiButton variant="plain"
            type="button"
            onClick={() => setQuantityValue((prev) => Math.max(1, prev - 1))}
            className="w-11 h-11 bg-nw-surface-2 border border-nw-border hover:bg-nw-mute-bg rounded-xl font-bold text-nw-text text-base"
          >
            -
          </UiButton>
          <input aria-label="الكمية"
            type="number"
            min="0"
            value={quantityValue}
            onChange={(e) => setQuantityValue(Math.max(0, parseInt(e.target.value) || 0))}
            className="flex-1 bg-nw-surface border border-nw-border rounded-xl px-3 py-2.5 text-center text-sm font-extrabold text-nw-text focus:outline-none focus:border-nw-border"
          />
          <UiButton variant="plain"
            type="button"
            onClick={() => setQuantityValue((prev) => prev + 1)}
            className="w-11 h-11 bg-nw-surface-2 border border-nw-border hover:bg-nw-mute-bg rounded-xl font-bold text-nw-text text-base"
          >
            +
          </UiButton>
        </div>
      </div>

      {/* Outcome Preview */}
      <div className="bg-nw-surface p-3 rounded-2xl border border-nw-border flex flex-wrap gap-2 items-center justify-between">
        <span className="text-nw-muted text-xs">النتيجة النهائية للمخزون:</span>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-nw-muted line-through text-xs">{formatProductInventory(product).fullFormatted}</span>
          <span className="text-nw-muted">←</span>
          <span className="text-sm font-extrabold text-nw-ok">
            {formatWholesaleInventory(calculatedNewOnHand, product.unitsPerPackage, product.purchasePackage, product.unit).fullFormatted}
          </span>
        </div>
      </div>

      {/* Reason Quick Chips */}
      <div className="space-y-1.5">
        <label className="text-xs font-bold text-nw-text block">سبب الحركة والتسوية:</label>
        <div className="flex flex-wrap gap-1.5">
          {[
            'تسوية زيادة ظهرت أثناء الجرد',
            'جرد مخزني دوري',
            'بضاعة تالفة / منتهية الصلاحية',
            'عينة مجانية / تسويق',
            'خطأ في التسجيل السابق',
          ].map((r) => (
            <UiButton variant="plain"
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={`px-2.5 py-1 rounded-full text-xs font-bold border transition ${
                reason === r
                  ? 'bg-nw-primary text-nw-on-primary border-nw-border'
                  : 'bg-nw-surface text-nw-muted border-nw-border hover:border-nw-border'
              }`}
            >
              {r}
            </UiButton>
          ))}
        </div>
      </div>

      {/* Additional Notes */}
      <div className="space-y-1">
        <label className="text-xs font-bold text-nw-text block">ملاحظات إضافية (اختياري):</label>
        <input aria-label="ملاحظات إضافية"
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="أدخل رقم إذن التوريد أو اسم المراقب..."
          className="w-full bg-nw-surface border border-nw-border rounded-xl px-3 py-2 text-nw-text text-sm focus:outline-none focus:border-nw-border"
        />
      </div>

      {/* Modal Actions */}
      <div className="flex gap-2 pt-2">
        <UiButton variant="plain"
          type="submit"
          disabled={isSubmitting || product.isFlavorMaster}
          className="flex-1 bg-nw-primary hover:opacity-95 disabled:opacity-50 text-nw-on-primary font-bold py-2.5 rounded-xl text-sm transition active:scale-95 flex items-center justify-center gap-1.5"
        >
          {isSubmitting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Check className="w-4 h-4" />
          )}
          <span>
            {isSubmitting ? 'جاري الحفظ...' : 'تأكيد تعديل المخزون'}
          </span>
        </UiButton>

        <UiButton variant="plain"
          type="button"
          onClick={onClose}
          className="px-4 bg-nw-mute-bg hover:bg-nw-mute-bg text-nw-text font-bold py-2.5 rounded-xl text-sm transition"
        >
          إلغاء
        </UiButton>
      </div>
    </form></FormFields>
  );
};
