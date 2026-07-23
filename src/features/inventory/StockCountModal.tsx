/**
 * Nawasrah Business Manager - Stock Count / Audit Modal
 */

import React, { useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { ClipboardCheck, Check, Package, AlertTriangle } from 'lucide-react';

interface StockCountModalProps {
  productId?: string;
  onClose: () => void;
}

export const StockCountModal: React.FC<StockCountModalProps> = ({
  productId: initialProductId,
  onClose,
}) => {
  const { products, warehouses, executeStockCount, setToast } = useAppStore();

  const [selectedProductId, setSelectedProductId] = useState<string>(
    initialProductId || products[0]?.id || ''
  );

  const selectedProduct = products.find((p) => p.id === selectedProductId);

  const [actualQty, setActualQty] = useState<number>(selectedProduct?.onHandQuantity || 0);
  const [warehouseId, setWarehouseId] = useState<string>(selectedProduct?.warehouseId || warehouses[0]?.id || 'w-main');
  const [reason, setReason] = useState<string>('جرد مخزني دوري وتسوية الفروقات');

  // Handle product change
  const handleProductChange = (id: string) => {
    setSelectedProductId(id);
    const prod = products.find((p) => p.id === id);
    if (prod) {
      setActualQty(prod.onHandQuantity);
      if (prod.warehouseId) setWarehouseId(prod.warehouseId);
    }
  };

  const systemQty = selectedProduct?.onHandQuantity || 0;
  const difference = actualQty - systemQty;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedProduct) {
      setToast('يرجى اختيار المنتج', 'error');
      return;
    }

    if (actualQty < 0) {
      setToast('يرجى إدخال كمية فعلية لا تقل عن صفر', 'error');
      return;
    }

    executeStockCount({
      productId: selectedProduct.id,
      actualQuantity: actualQty,
      warehouseId,
      reason,
    });

    onClose();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-xs">
      {/* Header Banner */}
      <div className="bg-purple-950/60 border border-purple-800 p-3 rounded-2xl flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-purple-600/20 text-purple-400 flex items-center justify-center shrink-0">
          <ClipboardCheck className="w-5 h-5" />
        </div>
        <div>
          <h4 className="font-extrabold text-purple-200 text-xs">جرد الصنف والتدقيق المخزني</h4>
          <p className="text-[10px] text-purple-300 opacity-80">
            إدخال الجرد الفعلي الموجود على الرف وتحديث النظام وحساب الزيادة أو العجز أوتوماتيكياً
          </p>
        </div>
      </div>

      {/* Product Selection */}
      <div className="space-y-1">
        <label className="text-[11px] font-bold text-slate-200 block flex items-center gap-1">
          <Package className="w-3.5 h-3.5 text-purple-400" />
          <span>اختر المنتج المراد جرده *</span>
        </label>
        <select
          value={selectedProductId}
          onChange={(e) => handleProductChange(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-100 text-xs font-semibold focus:outline-none focus:border-purple-500"
        >
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nameAr} - (الرمز: {p.sku}) - بالنظام: {p.onHandQuantity} {p.unit}
            </option>
          ))}
        </select>
      </div>

      {/* Selected Product Card */}
      {selectedProduct && (
        <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img
              src={selectedProduct.imageUrl}
              alt=""
              className="w-10 h-10 rounded-lg object-cover border border-slate-800"
            />
            <div>
              <h5 className="font-bold text-slate-200 text-xs">{selectedProduct.nameAr}</h5>
              <p className="text-[10px] text-slate-400">
                الرمز: <span className="font-mono">{selectedProduct.sku}</span> | الباركود: {selectedProduct.barcode}
              </p>
            </div>
          </div>
          <div className="text-left">
            <span className="text-[10px] text-slate-400 block">الكمية بالنظام</span>
            <strong className="text-purple-300 text-xs font-extrabold">
              {systemQty} {selectedProduct.unit}
            </strong>
          </div>
        </div>
      )}

      {/* Actual Count Input */}
      <div className="space-y-1">
        <label className="text-[11px] font-bold text-slate-200 block">
          الجرد الفعلي الحالي على الرف ({selectedProduct?.unit || 'قطعة'}) *
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActualQty((prev) => Math.max(0, prev - 1))}
            className="w-10 h-10 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-xl font-bold text-slate-200 text-base"
          >
            -
          </button>
          <input
            type="number"
            min="0"
            required
            value={actualQty}
            onChange={(e) => setActualQty(Math.max(0, parseInt(e.target.value) || 0))}
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-center text-sm font-extrabold text-purple-300 focus:outline-none focus:border-purple-500"
          />
          <button
            type="button"
            onClick={() => setActualQty((prev) => prev + 1)}
            className="w-10 h-10 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-xl font-bold text-slate-200 text-base"
          >
            +
          </button>
        </div>
      </div>

      {/* Stock Variance Summary Box */}
      <div className={`p-3 rounded-2xl border flex items-center justify-between text-xs ${
        difference === 0
          ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
          : difference > 0
          ? 'bg-blue-950/40 border-blue-800/80 text-blue-300'
          : 'bg-rose-950/40 border-rose-800/80 text-rose-300'
      }`}>
        <div className="flex items-center gap-2">
          {difference !== 0 && <AlertTriangle className="w-4 h-4 shrink-0" />}
          <div>
            <span className="font-bold block">
              {difference === 0
                ? 'المخزون الفعلي مطابق للمخزون بالنظام تماماً'
                : difference > 0
                ? `فائض في الجرد المخزني (+${difference} ${selectedProduct?.unit})`
                : `عجز / نقص في الجرد المخزني (${difference} ${selectedProduct?.unit})`}
            </span>
            <span className="text-[10px] opacity-80">
              سيتم إنشاء حركة Stock Count لتسوية الفروقات وتسجيلها باسم المستخدم الحالي
            </span>
          </div>
        </div>
        <strong className="text-sm font-black dir-ltr">
          {difference > 0 ? `+${difference}` : difference}
        </strong>
      </div>

      {/* Warehouse Selector */}
      <div className="space-y-1">
        <label className="text-[11px] font-bold text-slate-200 block">المستودع الذي تم فيه الجرد:</label>
        <select
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 text-xs focus:outline-none"
        >
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>

      {/* Reason / Notes */}
      <div className="space-y-1">
        <label className="text-[11px] font-bold text-slate-200 block">سبب التعديل والتسوية:</label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="مثال: جرد نهاية الشهر، تسوية عجز رفي..."
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 text-xs focus:outline-none focus:border-purple-500"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-3 border-t border-slate-800">
        <button
          type="submit"
          className="flex-1 bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 rounded-xl text-xs transition active:scale-95 flex items-center justify-center gap-1.5 shadow-lg shadow-purple-600/20"
        >
          <Check className="w-4 h-4" />
          <span>اعتماد وتسوية الجرد</span>
        </button>

        <button
          type="button"
          onClick={onClose}
          className="px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-3 rounded-xl text-xs transition"
        >
          إلغاء
        </button>
      </div>
    </form>
  );
};
