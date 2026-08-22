/**
 * Nawasrah Business Manager - Stock Adjustment Modal
 */

import React, { useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { Product } from '../../types';
import { formatProductInventory, formatWholesaleInventory } from '../../utils/inventoryFormatter';
import { Plus, Minus, Check, Loader2 } from 'lucide-react';
import { CURRENCY } from '../../constants';

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
  const { executeStockCount, setToast } = useAppStore();

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
    if (!product.warehouseId) {
      setToast('لا يوجد مستودع مرتبط بهذا المنتج.', 'error');
      return;
    }

    const finalReason = notes ? `${reason} (${notes})` : reason;
    setIsSubmitting(true);
    const result = await executeStockCount({
      productId: product.id,
      actualQuantity: calculatedNewOnHand,
      warehouseId: product.warehouseId,
      reason: finalReason,
      adjustmentType: isDeduct ? 'damage' : 'manual',
    });
    setIsSubmitting(false);
    if (result?.success) onClose();
  };

  return (
    <form onSubmit={handleSave} className="space-y-4 text-xs">
      {/* Product Card Header */}
      <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 flex items-center gap-3">
        <img
          src={product.imageUrl}
          alt={product.nameAr}
          className="w-12 h-12 rounded-xl object-cover border border-slate-800"
        />
        <div className="flex-1 min-w-0">
          <h4 className="font-extrabold text-slate-100 truncate text-xs">{product.nameAr}</h4>
          <p className="text-[10px] text-slate-400">
            المخزون الحالي: <strong className="text-emerald-400 font-bold">{formatProductInventory(product).fullFormatted}</strong>
          </p>
        </div>
      </div>

      {/* Adjust Mode Selection Toggle */}
      <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
        <button
          type="button"
          onClick={() => {
            setIsDeduct(false);
            setReason('تسوية زيادة ظهرت أثناء الجرد');
          }}
          className={`flex-1 py-2 rounded-lg font-bold flex items-center justify-center gap-1.5 transition ${
            !isDeduct ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>تسوية زيادة جرد (+)</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setIsDeduct(true);
            setReason('خصم بسبب تلف / نقص جرد');
          }}
          className={`flex-1 py-2 rounded-lg font-bold flex items-center justify-center gap-1.5 transition ${
            isDeduct ? 'bg-red-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Minus className="w-3.5 h-3.5" />
          <span>خصم من المخزون (-)</span>
        </button>
      </div>

      {/* Adjustment Method: Delta vs Exact Stock */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-bold text-slate-300 block">طريقة التعديل</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setAdjustType('delta');
              setQuantityValue(1);
            }}
            className={`p-2.5 rounded-xl border text-right transition ${
              adjustType === 'delta'
                ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                : 'bg-slate-950 border-slate-800 text-slate-400'
            }`}
          >
            <strong className="block text-xs font-extrabold">كمية مضافة / مخصومة</strong>
            <span className="text-[9px] opacity-75">مثال: إضافة +10 قطع</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setAdjustType('exact');
              setQuantityValue(currentOnHand);
            }}
            className={`p-2.5 rounded-xl border text-right transition ${
              adjustType === 'exact'
                ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                : 'bg-slate-950 border-slate-800 text-slate-400'
            }`}
          >
            <strong className="block text-xs font-extrabold">تحديد الجرد الفعلي المباشر</strong>
            <span className="text-[9px] opacity-75">مثال: المخزون الفعلي هو 25</span>
          </button>
        </div>
      </div>

      {/* Quantity Input */}
      <div className="space-y-1">
        <label className="text-[11px] font-bold text-slate-300 block">
          {adjustType === 'delta'
            ? isDeduct
              ? 'الكمية المراد خصمها:'
              : 'الكمية المراد إضافتها:'
            : 'الكمية الفعلية الصحيحة بالرف:'}
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setQuantityValue((prev) => Math.max(1, prev - 1))}
            className="w-10 h-10 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-xl font-bold text-slate-200 text-base"
          >
            -
          </button>
          <input
            type="number"
            min="0"
            value={quantityValue}
            onChange={(e) => setQuantityValue(Math.max(0, parseInt(e.target.value) || 0))}
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-center text-sm font-extrabold text-slate-100 focus:outline-none focus:border-blue-500"
          />
          <button
            type="button"
            onClick={() => setQuantityValue((prev) => prev + 1)}
            className="w-10 h-10 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-xl font-bold text-slate-200 text-base"
          >
            +
          </button>
        </div>
      </div>

      {/* Outcome Preview */}
      <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 flex items-center justify-between">
        <span className="text-slate-400 text-[11px]">النتيجة النهائية للمخزون:</span>
        <div className="flex items-center gap-2">
          <span className="text-slate-400 line-through text-[11px]">{formatProductInventory(product).fullFormatted}</span>
          <span className="text-slate-500">←</span>
          <span className="text-xs font-extrabold text-emerald-400">
            {formatWholesaleInventory(calculatedNewOnHand, product.unitsPerPackage, product.purchasePackage, product.unit).fullFormatted}
          </span>
        </div>
      </div>

      {/* Reason Quick Chips */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-bold text-slate-300 block">سبب الحركة والتسوية:</label>
        <div className="flex flex-wrap gap-1.5">
          {[
            'تسوية زيادة ظهرت أثناء الجرد',
            'جرد مخزني دوري',
            'بضاعة تالفة / منتهية الصلاحية',
            'عينة مجانية / تسويق',
            'خطأ في التسجيل السابق',
          ].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={`px-2.5 py-1 rounded-full text-[10px] font-bold border transition ${
                reason === r
                  ? 'bg-blue-600 text-white border-blue-500'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Additional Notes */}
      <div className="space-y-1">
        <label className="text-[11px] font-bold text-slate-300 block">ملاحظات إضافية (اختياري):</label>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="أدخل رقم إذن التوريد أو اسم المراقب..."
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 text-xs focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Modal Actions */}
      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-xs transition active:scale-95 flex items-center justify-center gap-1.5"
        >
          {isSubmitting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Check className="w-4 h-4" />
          )}
          <span>
            {isSubmitting ? 'جاري الحفظ...' : 'تأكيد تعديل المخزون'}
          </span>
        </button>

        <button
          type="button"
          onClick={onClose}
          className="px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 rounded-xl text-xs transition"
        >
          إلغاء
        </button>
      </div>
    </form>
  );
};
