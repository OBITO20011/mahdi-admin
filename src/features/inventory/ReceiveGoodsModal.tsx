/**
 * Nawasrah Business Manager - Standalone "Receive Goods" (استلام بضاعة) Modal
 */

import React, { useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { Truck, Check, Package, Warehouse as WarehouseIcon, Building2, Calendar, FileText, Barcode } from 'lucide-react';

interface ReceiveGoodsModalProps {
  onClose: () => void;
}

export const ReceiveGoodsModal: React.FC<ReceiveGoodsModalProps> = ({ onClose }) => {
  const { products, branches, warehouses, receiveGoods, setToast } = useAppStore();

  const [selectedProductId, setSelectedProductId] = useState<string>(
    products[0]?.id || ''
  );
  const [receivedQty, setReceivedQty] = useState<number>(10);
  const [branchId, setBranchId] = useState<string>(branches[0]?.id || 'b-amman-main');
  const [warehouseId, setWarehouseId] = useState<string>(warehouses[0]?.id || 'w-main');
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState<string>('');
  const [expiryDate, setExpiryDate] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  const selectedProduct = products.find((p) => p.id === selectedProductId);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedProduct) {
      setToast('يرجى اختيار المنتج المراد استلام بضاعته', 'error');
      return;
    }

    if (receivedQty <= 0) {
      setToast('يرجى إدخال كمية استلام أكبر من صفر', 'error');
      return;
    }

    setIsSubmitting(true);

    try {
      // Receive goods via store engine with 'Purchase Receipt' movement type
      await receiveGoods({
        productId: selectedProduct.id,
        quantity: receivedQty,
        branchId,
        warehouseId,
        supplierInvoiceNo,
        notes,
      });

      onClose();
    } catch (err: any) {
      console.error('Error receiving goods:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-xs">
      {/* Header Banner */}
      <div className="bg-indigo-950/60 border border-indigo-800 p-3 rounded-2xl flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center shrink-0">
          <Truck className="w-5 h-5" />
        </div>
        <div>
          <h4 className="font-extrabold text-indigo-200 text-xs">شاشة استلام بضاعة وشحنات جديدة</h4>
          <p className="text-[10px] text-indigo-300 opacity-80">
            زيادة الكمية المتاحة في المستودع فور وصول البضاعة من المورد
          </p>
        </div>
      </div>

      {/* 1. Select Product */}
      <div className="space-y-1">
        <label className="text-[11px] font-bold text-slate-200 block flex items-center gap-1">
          <Package className="w-3.5 h-3.5 text-blue-400" />
          <span>اختر المنتج *</span>
        </label>
        <select
          value={selectedProductId}
          onChange={(e) => setSelectedProductId(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-100 text-xs font-semibold focus:outline-none focus:border-indigo-500"
        >
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nameAr} - (الباركود: {p.barcode}) - المخزون الحالي: {p.onHandQuantity} {p.unit}
            </option>
          ))}
        </select>
      </div>

      {/* Product Summary Preview */}
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
                الرمز: <span className="font-mono">{selectedProduct.sku}</span> | سعر التكلفة: {selectedProduct.costPrice} د.أ
              </p>
            </div>
          </div>
          <div className="text-left">
            <span className="text-[10px] text-slate-400 block">المخزون الحالي</span>
            <strong className="text-emerald-400 text-xs font-extrabold">
              {selectedProduct.onHandQuantity} {selectedProduct.unit}
            </strong>
          </div>
        </div>
      )}

      {/* 2. Received Quantity */}
      <div className="space-y-1">
        <label className="text-[11px] font-bold text-slate-200 block">
          الكمية المستلمة * ({selectedProduct?.unit || 'قطعة'})
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setReceivedQty((prev) => Math.max(1, prev - 1))}
            className="w-10 h-10 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-xl font-bold text-slate-200 text-base"
          >
            -
          </button>
          <input
            type="number"
            min="1"
            required
            value={receivedQty}
            onChange={(e) => setReceivedQty(Math.max(1, parseInt(e.target.value) || 1))}
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-center text-sm font-extrabold text-indigo-400 focus:outline-none focus:border-indigo-500"
          />
          <button
            type="button"
            onClick={() => setReceivedQty((prev) => prev + 1)}
            className="w-10 h-10 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-xl font-bold text-slate-200 text-base"
          >
            +
          </button>
        </div>
      </div>

      {/* Outcome Preview */}
      {selectedProduct && (
        <div className="bg-indigo-950/30 p-2.5 rounded-xl border border-indigo-900/50 flex items-center justify-between text-xs">
          <span className="text-slate-400">المخزون الجديد بعد الاستلام:</span>
          <div className="flex items-center gap-1.5 font-bold">
            <span className="text-slate-400 line-through">{selectedProduct.onHandQuantity}</span>
            <span className="text-indigo-400">←</span>
            <span className="text-emerald-400 font-black text-sm">
              {selectedProduct.onHandQuantity + receivedQty} {selectedProduct.unit}
            </span>
          </div>
        </div>
      )}

      {/* 3. Branch & Warehouse Selection */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-200 block flex items-center gap-1">
            <Building2 className="w-3.5 h-3.5 text-blue-400" />
            <span>مكان الاستلام (الفرع)</span>
          </label>
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-100 text-xs focus:outline-none"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-200 block flex items-center gap-1">
            <WarehouseIcon className="w-3.5 h-3.5 text-indigo-400" />
            <span>المستودع المستلم</span>
          </label>
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-100 text-xs focus:outline-none"
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 4. Invoice Reference & Expiry Date */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-200 block flex items-center gap-1">
            <FileText className="w-3.5 h-3.5 text-slate-400" />
            <span>رقم فاتورة المورد <span className="text-slate-500 font-normal">(اختياري)</span></span>
          </label>
          <input
            type="text"
            value={supplierInvoiceNo}
            onChange={(e) => setSupplierInvoiceNo(e.target.value)}
            placeholder="مثال: INV-99021"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 text-xs font-mono focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-200 block flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 text-amber-400" />
            <span>تاريخ انتهاء الشحنة <span className="text-slate-500 font-normal">(اختياري)</span></span>
          </label>
          <input
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 text-xs focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-1">
        <label className="text-[11px] font-bold text-slate-200 block">ملاحظات الاستلام:</label>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="أدخل ملاحظات الشحنة أو رقم إذن التسليم..."
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 text-xs focus:outline-none focus:border-indigo-500"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-3 border-t border-slate-800">
        <button
          type="submit"
          className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl text-xs transition active:scale-95 flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-600/20"
        >
          <Check className="w-4 h-4" />
          <span>تأكيد استلام البضاعة</span>
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
