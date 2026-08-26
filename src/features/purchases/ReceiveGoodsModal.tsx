/**
 * Nawasrah Business Manager - Goods Receiving (GRN) Modal Component
 */

import React, { useState, useEffect } from 'react';
import { useAppStoreSelector, storeEngine } from '../../stores/useAppStore';
import { PurchaseOrder, ReceivePurchaseOrderInput } from '../../types/purchases';
import { receivePurchaseOrderInSupabase } from '../../services/supabase/purchases.service';
import {
  X,
  Truck,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { CURRENCY } from '../../constants';

interface ReceiveGoodsModalProps {
  isOpen: boolean;
  po: PurchaseOrder | null;
  onClose: () => void;
  onSuccess: () => void;
}

interface ReceiveRow {
  purchaseOrderItemId: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  orderedQuantity: number;
  previouslyReceivedQuantity: number;
  remainingQuantity: number;
  thisReceiptQuantity: number;
  unitCost: number; // JOD
}

export const ReceiveGoodsModal: React.FC<ReceiveGoodsModalProps> = ({
  isOpen,
  po,
  onClose,
  onSuccess,
}) => {
  const warehouses = useAppStoreSelector((state) => state.warehouses);

  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('');
  const [supplierDeliveryNote, setSupplierDeliveryNote] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [items, setItems] = useState<ReceiveRow[]>([]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && po) {
      setSelectedWarehouseId(po.warehouseId || (warehouses[0]?.id || ''));
      setSupplierDeliveryNote('');
      setNotes('');
      setErrorMsg(null);

      // Map items
      const mapped = po.items.map((item) => {
        const remaining = Math.max(0, item.orderedQuantity - item.receivedQuantity);
        return {
          purchaseOrderItemId: item.id,
          productId: item.productId,
          productName: item.productName,
          sku: item.sku,
          unit: item.unit,
          orderedQuantity: item.orderedQuantity,
          previouslyReceivedQuantity: item.receivedQuantity,
          remainingQuantity: remaining,
          thisReceiptQuantity: remaining, // default receive all remaining
          unitCost: item.purchasePrice,
        };
      });

      setItems(mapped);
    }
  }, [isOpen, po, warehouses]);

  if (!isOpen || !po) return null;

  const handleQuantityChange = (index: number, val: number) => {
    const updated = [...items];
    const item = updated[index];
    const clamped = Math.max(0, Math.min(item.remainingQuantity, val));
    updated[index].thisReceiptQuantity = clamped;
    setItems(updated);
  };

  const handleUnitCostChange = (index: number, val: number) => {
    const updated = [...items];
    updated[index].unitCost = Math.max(0, val);
    setItems(updated);
  };

  const totalReceivingNow = items.reduce((sum, i) => sum + i.thisReceiptQuantity, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (totalReceivingNow <= 0) {
      setErrorMsg('يرجى تحديد كمية أكبر من صفر لمنتج واحد على الأقل للاستلام.');
      return;
    }

    if (!selectedWarehouseId) {
      setErrorMsg('يرجى اختيار المستودع المستلم للبضائع.');
      return;
    }

    for (const item of items) {
      if (item.thisReceiptQuantity > item.remainingQuantity) {
        setErrorMsg(`الكمية المستلمة للمنتج (${item.productName}) تتجاوز الكمية المتبقية.`);
        return;
      }
    }

    setIsSubmitting(true);

    const input: ReceivePurchaseOrderInput = {
      purchaseOrderId: po.id,
      warehouseId: selectedWarehouseId,
      supplierDeliveryNote: supplierDeliveryNote.trim() || undefined,
      notes: notes.trim() || undefined,
      items: items
        .filter((i) => i.thisReceiptQuantity > 0)
        .map((i) => ({
          purchaseOrderItemId: i.purchaseOrderItemId,
          productId: i.productId,
          receivedQuantity: i.thisReceiptQuantity,
          unitCost: i.unitCost,
        })),
    };

    const res = await receivePurchaseOrderInSupabase(input);
    setIsSubmitting(false);

    if (res.success) {
      storeEngine.setToast('تم استلام البضائع وزيادة المخزون بنجاح', 'success');
      onSuccess();
      onClose();
    } else {
      setErrorMsg(res.error || 'حدث خطأ أثناء استلام البضائع');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-3xl shadow-2xl overflow-hidden my-auto flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-slate-800/80 px-5 py-4 border-b border-slate-700/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400 font-bold">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>استلام بضائع لمخزن (Goods Receipt Note)</span>
                <span className="text-xs bg-slate-800 px-2 py-0.5 rounded border border-slate-700 text-blue-400">
                  {po.purchaseOrderNumber}
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                تسجيل الكميات الموردة فعلياً لزيادة رصيد المستودع وتحديث متوسط التكلفة
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-700/60 text-slate-300 hover:text-white flex items-center justify-center transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
          {errorMsg && (
            <div className="bg-rose-950/50 border border-rose-500/30 p-3 rounded-2xl text-rose-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Supplier Info & Warehouse Header */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-950/50 p-3.5 rounded-2xl border border-slate-800">
            <div>
              <span className="text-slate-400 block mb-0.5">المورد:</span>
              <span className="font-bold text-slate-100 text-sm">{po.supplierName}</span>
            </div>

            <div>
              <label className="font-bold text-slate-300 block mb-1">المستودع المستلم:</label>
              <select
                value={selectedWarehouseId}
                onChange={(e) => setSelectedWarehouseId(e.target.value)}
                required
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-1.5 text-slate-100 font-semibold focus:outline-none focus:border-purple-500"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="font-bold text-slate-300 block mb-1">إشعار تسليم المورد (Delivery Note):</label>
              <input
                type="text"
                value={supplierDeliveryNote}
                onChange={(e) => setSupplierDeliveryNote(e.target.value)}
                placeholder="رقم بوليصة / وصل السائق"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-1.5 text-slate-100 focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>

          {/* Items Table */}
          <div className="space-y-2">
            <h3 className="font-bold text-slate-200 text-sm flex items-center justify-between">
              <span>جدول فحص واستلام الأصناف:</span>
              <span className="text-xs text-purple-400 font-normal">
                إجمالي قطع الاستلام الحالي: {totalReceivingNow} قطعة
              </span>
            </h3>

            <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950/40">
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-800/80 text-slate-300 font-bold border-b border-slate-700/80">
                    <tr>
                      <th className="p-3">اسم المنتج</th>
                      <th className="p-3 w-20 text-center">المطلوب</th>
                      <th className="p-3 w-20 text-center">المستلم سابقاً</th>
                      <th className="p-3 w-20 text-center text-amber-400">المتبقي</th>
                      <th className="p-3 w-28 text-center text-purple-300">الكمية المستلمة الآن</th>
                      <th className="p-3 w-32 text-center">تكلفة الوحدة ({CURRENCY})</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {items.map((item, index) => (
                      <tr key={index} className="hover:bg-slate-800/40 transition">
                        <td className="p-3 font-semibold text-slate-100">
                          <div>{item.productName}</div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            SKU: {item.sku} ({item.unit})
                          </div>
                        </td>
                        <td className="p-3 text-center font-bold text-slate-300">{item.orderedQuantity}</td>
                        <td className="p-3 text-center text-slate-400">{item.previouslyReceivedQuantity}</td>
                        <td className="p-3 text-center font-black text-amber-400">{item.remainingQuantity}</td>
                        <td className="p-3">
                          <input
                            type="number"
                            min="0"
                            max={item.remainingQuantity}
                            value={item.thisReceiptQuantity}
                            onChange={(e) => handleQuantityChange(index, parseInt(e.target.value) || 0)}
                            className="w-full bg-slate-800 border border-purple-500/50 rounded-xl px-2 py-1.5 text-center font-black text-purple-300 focus:outline-none focus:border-purple-400 text-sm"
                          />
                        </td>
                        <td className="p-3">
                          <input
                            type="number"
                            step="0.001"
                            min="0"
                            value={item.unitCost}
                            onChange={(e) => handleUnitCostChange(index, parseFloat(e.target.value) || 0)}
                            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-2 py-1.5 text-center font-bold text-slate-100 focus:outline-none focus:border-purple-500"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Receipt Notes */}
          <div>
            <label className="font-bold text-slate-300 block mb-1">ملاحظات سند الاستلام:</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="حالة الشحنة، ملاحظات الجودة والتلف إن وجد..."
              className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2.5 text-slate-100 focus:outline-none focus:border-purple-500"
            />
          </div>

          {/* Submit Action */}
          <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 font-bold transition"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSubmitting || totalReceivingNow <= 0}
              className="px-6 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold transition shadow-lg disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting ? (
                <span>جاري تحديث المخزون...</span>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>تأكيد الاستلام وزيادة المخزون</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
