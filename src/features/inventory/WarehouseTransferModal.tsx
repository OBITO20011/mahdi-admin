/**
 * Nawasrah Business Manager - Warehouse Transfer Modal
 */

import React, { useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { formatProductInventory } from '../../utils/inventoryFormatter';
import { ArrowLeftRight, Check, Package, Warehouse as WarehouseIcon } from 'lucide-react';

interface WarehouseTransferModalProps {
  productId?: string;
  onClose: () => void;
}

export const WarehouseTransferModal: React.FC<WarehouseTransferModalProps> = ({
  productId: initialProductId,
  onClose,
}) => {
  const { products, warehouses, transferWarehouse, setToast } = useAppStore();

  const [selectedProductId, setSelectedProductId] = useState<string>(
    initialProductId || products[0]?.id || ''
  );
  const [transferQty, setTransferQty] = useState<number>(5);
  const [fromWarehouseId, setFromWarehouseId] = useState<string>(warehouses[0]?.id || 'w-main');
  const [toWarehouseId, setToWarehouseId] = useState<string>(
    warehouses[1]?.id || warehouses[0]?.id || 'w-main'
  );
  const [reason, setReason] = useState<string>('نقل مخزون لتلبية احتياج الفرع');

  const selectedProduct = products.find((p) => p.id === selectedProductId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedProduct) {
      setToast('يرجى اختيار المنتج', 'error');
      return;
    }

    if (fromWarehouseId === toWarehouseId) {
      setToast('يرجى اختيار مستودعين مختلفين للنقل بينهما', 'error');
      return;
    }

    if (transferQty <= 0) {
      setToast('يرجى إدخال كمية أكبر من صفر', 'error');
      return;
    }

    if (transferQty > selectedProduct.onHandQuantity) {
      setToast(`الكمية المراد نقلها (${transferQty}) أكبر من المتوفر في المستودع الحالي (${selectedProduct.onHandQuantity})`, 'error');
      return;
    }

    transferWarehouse({
      productId: selectedProduct.id,
      quantity: transferQty,
      fromWarehouseId,
      toWarehouseId,
      reason,
    });

    onClose();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-xs">
      {/* Header Banner */}
      <div className="bg-blue-950/60 border border-blue-800 p-3 rounded-2xl flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center shrink-0">
          <ArrowLeftRight className="w-5 h-5" />
        </div>
        <div>
          <h4 className="font-extrabold text-blue-200 text-xs">نقل كميات بين المستودعات والفروع</h4>
          <p className="text-[10px] text-blue-300 opacity-80">
            تأكيد حركة تحويل خروج من المستودع المصدر ودخول للمستودع المستهدف مع توثيق الحركة
          </p>
        </div>
      </div>

      {/* Select Product */}
      <div className="space-y-1">
        <label className="text-[11px] font-bold text-slate-200 block flex items-center gap-1">
          <Package className="w-3.5 h-3.5 text-blue-400" />
          <span>اختر المنتج المراد تحويله *</span>
        </label>
        <select
          value={selectedProductId}
          onChange={(e) => setSelectedProductId(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-100 text-xs font-semibold focus:outline-none focus:border-blue-500"
        >
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nameAr} - (الباركود: {p.barcode}) - المخزون المتوفر: {formatProductInventory(p).fullFormatted}
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
              <p className="text-[10px] text-slate-400 font-mono">SKU: {selectedProduct.sku}</p>
            </div>
          </div>
          <div className="text-left">
            <span className="text-[10px] text-slate-400 block">المخزون المتوفر</span>
            <strong className="text-emerald-400 text-xs font-extrabold block">
              {formatProductInventory(selectedProduct).fullFormatted}
            </strong>
          </div>
        </div>
      )}

      {/* From & To Warehouse Selectors */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-200 block flex items-center gap-1">
            <WarehouseIcon className="w-3.5 h-3.5 text-rose-400" />
            <span>من مستودع (المصدر) *</span>
          </label>
          <select
            value={fromWarehouseId}
            onChange={(e) => setFromWarehouseId(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-100 text-xs focus:outline-none focus:border-rose-500"
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-200 block flex items-center gap-1">
            <WarehouseIcon className="w-3.5 h-3.5 text-emerald-400" />
            <span>إلى مستودع (الوجهة) *</span>
          </label>
          <select
            value={toWarehouseId}
            onChange={(e) => setToWarehouseId(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-100 text-xs focus:outline-none focus:border-emerald-500"
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Transfer Quantity */}
      <div className="space-y-1">
        <label className="text-[11px] font-bold text-slate-200 block">
          الكمية المراد نقلها ({selectedProduct?.unit || 'قطعة'}) *
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTransferQty((prev) => Math.max(1, prev - 1))}
            className="w-10 h-10 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-xl font-bold text-slate-200 text-base"
          >
            -
          </button>
          <input
            type="number"
            min="1"
            required
            value={transferQty}
            onChange={(e) => setTransferQty(Math.max(1, parseInt(e.target.value) || 1))}
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-center text-sm font-extrabold text-blue-400 focus:outline-none focus:border-blue-500"
          />
          <button
            type="button"
            onClick={() => setTransferQty((prev) => prev + 1)}
            className="w-10 h-10 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-xl font-bold text-slate-200 text-base"
          >
            +
          </button>
        </div>
      </div>

      {/* Reason */}
      <div className="space-y-1">
        <label className="text-[11px] font-bold text-slate-200 block">سبب النقل والتوزيع:</label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="مثال: تغطية نقص مخزون الفرع الثاني..."
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 text-xs focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-3 border-t border-slate-800">
        <button
          type="submit"
          className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl text-xs transition active:scale-95 flex items-center justify-center gap-1.5 shadow-lg shadow-blue-600/20"
        >
          <Check className="w-4 h-4" />
          <span>تأكيد نقل المخزون</span>
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
