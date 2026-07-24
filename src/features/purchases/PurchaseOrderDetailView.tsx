/**
 * Nawasrah Business Manager - Purchase Order Detail View Sheet
 */

import React, { useState, useEffect } from 'react';
import { PurchaseOrder, PurchaseOrderStatus } from '../../types/purchases';
import {
  fetchPurchaseOrderByIdFromSupabase,
  sendPurchaseOrderInSupabase,
  approvePurchaseOrderInSupabase,
  cancelPurchaseOrderInSupabase,
} from '../../services/supabase/purchases.service';
import { ReceiveGoodsModal } from './ReceiveGoodsModal';
import { SupplierPaymentModal } from './SupplierPaymentModal';
import {
  X,
  FileText,
  Building,
  Warehouse,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  Truck,
  ArrowUpRight,
  XCircle,
  Send,
  DollarSign,
  PackageCheck,
  Receipt,
  Printer,
  History,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react';
import { CURRENCY } from '../../constants';

interface PurchaseOrderDetailViewProps {
  poId: string | null;
  onClose: () => void;
  onRefresh: () => void;
}

export const PurchaseOrderDetailView: React.FC<PurchaseOrderDetailViewProps> = ({
  poId,
  onClose,
  onRefresh,
}) => {
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'items' | 'receipts' | 'payments'>('items');

  // Modals
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState<boolean>(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState<boolean>(false);
  const [isActionLoading, setIsActionLoading] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (poId) {
      loadPoDetails();
    }
  }, [poId]);

  const loadPoDetails = async () => {
    if (!poId) return;
    setLoading(true);
    const res = await fetchPurchaseOrderByIdFromSupabase(poId);
    if (res.success && res.data) {
      setPo(res.data);
    }
    setLoading(false);
  };

  if (!poId) return null;

  // Status badge logic
  const getStatusBadge = (status: PurchaseOrderStatus) => {
    switch (status) {
      case 'draft':
        return { label: 'مسودة', color: 'bg-slate-700 text-slate-200 border-slate-600', icon: Clock };
      case 'sent':
        return { label: 'مرسل للمورد', color: 'bg-blue-600/20 text-blue-300 border-blue-500/30', icon: Send };
      case 'approved':
        return { label: 'معتمد بانتظار التوريد', color: 'bg-amber-600/20 text-amber-300 border-amber-500/30', icon: AlertCircle };
      case 'partially_received':
        return { label: 'مستلم جزئياً', color: 'bg-indigo-600/20 text-indigo-300 border-indigo-500/30', icon: Truck };
      case 'received':
        return { label: 'مستلم بالكامل', color: 'bg-emerald-600/20 text-emerald-300 border-emerald-500/30', icon: CheckCircle2 };
      case 'cancelled':
        return { label: 'ملغى', color: 'bg-rose-600/20 text-rose-300 border-rose-500/30', icon: XCircle };
      default:
        return { label: status, color: 'bg-slate-800 text-slate-300 border-slate-700', icon: FileText };
    }
  };

  // Status transitions handlers
  const handleSendPO = async () => {
    if (!po) return;
    setIsActionLoading(true);
    setActionError(null);
    const res = await sendPurchaseOrderInSupabase(po.id);
    setIsActionLoading(false);
    if (res.success) {
      loadPoDetails();
      onRefresh();
    } else {
      setActionError(res.error || 'فشل تغيير الحالة إلى مرسل');
    }
  };

  const handleApprovePO = async () => {
    if (!po) return;
    setIsActionLoading(true);
    setActionError(null);
    const res = await approvePurchaseOrderInSupabase(po.id);
    setIsActionLoading(false);
    if (res.success) {
      loadPoDetails();
      onRefresh();
    } else {
      setActionError(res.error || 'فشل اعتماد أمر الشراء');
    }
  };

  const handleCancelPO = async () => {
    if (!po) return;
    if (!window.confirm('هل أنت تأكد من رغبتك في إلغاء طلب الشراء هذا؟')) return;
    setIsActionLoading(true);
    setActionError(null);
    const res = await cancelPurchaseOrderInSupabase(po.id);
    setIsActionLoading(false);
    if (res.success) {
      loadPoDetails();
      onRefresh();
    } else {
      setActionError(res.error || 'فشل إلغاء طلب الشراء');
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-end bg-slate-950/80 backdrop-blur-sm p-0 sm:p-4 overflow-hidden">
        <div className="bg-slate-900 border-r sm:border border-slate-800 w-full sm:max-w-3xl h-full sm:h-[95vh] sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col my-auto">
          {/* Top Bar */}
          <div className="bg-slate-800/90 px-5 py-4 border-b border-slate-700/80 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-xl bg-slate-700/60 text-slate-300 hover:text-white flex items-center justify-center transition"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
              <div className="min-w-0">
                <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <span>طلب شراء رقم:</span>
                  <span className="font-mono text-blue-400">{po?.purchaseOrderNumber || poId}</span>
                </h2>
                <p className="text-xs text-slate-400">تفاصيل وسجلات الاستلام والمدفوعات الكاملة</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => window.print()}
                className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition"
                title="طباعة أمر الشراء"
              >
                <Printer className="w-4 h-4" />
              </button>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {loading || !po ? (
            <div className="flex-1 flex items-center justify-center p-8 text-slate-400">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 ml-3"></div>
              <span>جاري تحميل بيانات أمر الشراء...</span>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
              {actionError && (
                <div className="bg-rose-950/50 border border-rose-500/30 p-3 rounded-2xl text-rose-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{actionError}</span>
                </div>
              )}

              {/* Status Header Banner & Action Toolbar */}
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {(() => {
                      const badge = getStatusBadge(po.status);
                      const Icon = badge.icon;
                      return (
                        <div
                          className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-2 ${badge.color}`}
                        >
                          <Icon className="w-4 h-4" />
                          <span>الحالة: {badge.label}</span>
                        </div>
                      );
                    })()}

                    {po.supplierInvoiceNumber && (
                      <span className="bg-slate-800 text-slate-300 px-2.5 py-1 rounded-xl border border-slate-700 font-mono text-[11px]">
                        فاتورة المورد: {po.supplierInvoiceNumber}
                      </span>
                    )}
                  </div>

                  {/* Dynamic Workflow Actions */}
                  <div className="flex items-center gap-2">
                    {po.status === 'draft' && (
                      <button
                        onClick={handleSendPO}
                        disabled={isActionLoading}
                        className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>إرسال للمورد</span>
                      </button>
                    )}

                    {['draft', 'sent'].includes(po.status) && (
                      <button
                        onClick={handleApprovePO}
                        disabled={isActionLoading}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>اعتماد الطلب</span>
                      </button>
                    )}

                    {['approved', 'partially_received'].includes(po.status) && (
                      <button
                        onClick={() => setIsReceiveModalOpen(true)}
                        className="bg-purple-600 hover:bg-purple-500 text-white px-3.5 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition shadow"
                      >
                        <Truck className="w-4 h-4" />
                        <span>استلام بضائع لمخزن</span>
                      </button>
                    )}

                    {po.amountDue > 0 && po.status !== 'cancelled' && (
                      <button
                        onClick={() => setIsPaymentModalOpen(true)}
                        className="bg-rose-600 hover:bg-rose-500 text-white px-3.5 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition shadow"
                      >
                        <ArrowUpRight className="w-4 h-4" />
                        <span>تسديد دفعة (سند صرف)</span>
                      </button>
                    )}

                    {po.status !== 'cancelled' && po.status !== 'received' && (
                      <button
                        onClick={handleCancelPO}
                        disabled={isActionLoading}
                        className="bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800 px-3 py-1.5 rounded-xl font-bold transition"
                      >
                        إلغاء الطلب
                      </button>
                    )}
                  </div>
                </div>

                {/* Metadata Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-800/80 text-[11px]">
                  <div>
                    <span className="text-slate-400 block mb-0.5">المورد:</span>
                    <span className="font-bold text-slate-100 flex items-center gap-1">
                      <Building className="w-3 h-3 text-teal-400" />
                      {po.supplierName}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block mb-0.5">المستودع:</span>
                    <span className="font-bold text-slate-100 flex items-center gap-1">
                      <Warehouse className="w-3 h-3 text-blue-400" />
                      {po.warehouseName || 'الرئيسي'}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block mb-0.5">تاريخ الطلب:</span>
                    <span className="font-bold text-slate-200">
                      {new Date(po.orderDate).toLocaleDateString('ar-JO')}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block mb-0.5">تاريخ التسليم المتوقع:</span>
                    <span className="font-bold text-slate-200">
                      {po.expectedDeliveryDate
                        ? new Date(po.expectedDeliveryDate).toLocaleDateString('ar-JO')
                        : 'غير محدد'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Navigation Tabs for View */}
              <div className="flex items-center bg-slate-950 p-1 rounded-2xl border border-slate-800 text-xs font-bold">
                <button
                  onClick={() => setActiveTab('items')}
                  className={`flex-1 py-2 rounded-xl transition flex items-center justify-center gap-1.5 ${
                    activeTab === 'items'
                      ? 'bg-blue-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <PackageCheck className="w-4 h-4" />
                  <span>أصناف الطلب ({po.items.length})</span>
                </button>

                <button
                  onClick={() => setActiveTab('receipts')}
                  className={`flex-1 py-2 rounded-xl transition flex items-center justify-center gap-1.5 ${
                    activeTab === 'receipts'
                      ? 'bg-purple-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Truck className="w-4 h-4" />
                  <span>سندات الاستلام ({po.receipts?.length || 0})</span>
                </button>

                <button
                  onClick={() => setActiveTab('payments')}
                  className={`flex-1 py-2 rounded-xl transition flex items-center justify-center gap-1.5 ${
                    activeTab === 'payments'
                      ? 'bg-rose-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <ArrowUpRight className="w-4 h-4" />
                  <span>سندات الصرف والمدفوعات ({po.payments?.length || 0})</span>
                </button>
              </div>

              {/* TAB 1: Items Table */}
              {activeTab === 'items' && (
                <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950/40">
                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-xs">
                      <thead className="bg-slate-800/80 text-slate-300 font-bold border-b border-slate-700/80">
                        <tr>
                          <th className="p-3">اسم المنتج / SKU</th>
                          <th className="p-3 text-center">المطلوب</th>
                          <th className="p-3 text-center">المستلم</th>
                          <th className="p-3 text-center">سعر الشراء</th>
                          <th className="p-3 text-center">الخصم</th>
                          <th className="p-3 text-center">الإجمالي ({CURRENCY})</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {po.items.map((item) => (
                          <tr key={item.id} className="hover:bg-slate-800/40 transition">
                            <td className="p-3 font-semibold text-slate-100">
                              <div>{item.productName}</div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                SKU: {item.sku} ({item.unit})
                              </div>
                            </td>
                            <td className="p-3 text-center font-bold text-slate-200">
                              {item.orderedQuantity}
                            </td>
                            <td className="p-3 text-center">
                              <span
                                className={`px-2 py-0.5 rounded font-bold ${
                                  item.receivedQuantity >= item.orderedQuantity
                                    ? 'bg-emerald-600/20 text-emerald-300'
                                    : item.receivedQuantity > 0
                                    ? 'bg-purple-600/20 text-purple-300'
                                    : 'bg-slate-800 text-slate-400'
                                }`}
                              >
                                {item.receivedQuantity}
                              </span>
                            </td>
                            <td className="p-3 text-center text-slate-300">
                              {item.purchasePrice.toFixed(2)}
                            </td>
                            <td className="p-3 text-center text-slate-400">
                              {item.discount.toFixed(2)}
                            </td>
                            <td className="p-3 text-center font-black text-slate-100">
                              {item.lineTotal.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 2: Receipts History */}
              {activeTab === 'receipts' && (
                <div className="space-y-3">
                  {!po.receipts || po.receipts.length === 0 ? (
                    <div className="p-8 text-center bg-slate-950 rounded-2xl border border-slate-800 text-slate-500">
                      لا يوجد سندات استلام بضاعة لهذا الطلب حتى الآن.
                    </div>
                  ) : (
                    po.receipts.map((rc) => (
                      <div
                        key={rc.id}
                        className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2.5"
                      >
                        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-purple-400 font-mono text-sm">
                              {rc.receiptNumber}
                            </span>
                            {rc.supplierDeliveryNote && (
                              <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
                                إشعار المورد: {rc.supplierDeliveryNote}
                              </span>
                            )}
                          </div>
                          <span className="text-slate-400 text-[11px]">
                            تاريخ الاستلام: {new Date(rc.receivedAt).toLocaleString('ar-JO')}
                          </span>
                        </div>

                        <div className="space-y-1">
                          <span className="text-[11px] text-slate-400 font-bold">الأصناف المستلمة بالسند:</span>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                            {rc.items.map((ri) => (
                              <div
                                key={ri.id}
                                className="bg-slate-900 p-2 rounded-xl border border-slate-800/80 flex items-center justify-between"
                              >
                                <span className="font-semibold text-slate-200">{ri.productName}</span>
                                <span className="font-bold text-purple-300">
                                  {ri.receivedQuantity} قطعة @ {ri.unitCost.toFixed(2)} {CURRENCY}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB 3: Payments History */}
              {activeTab === 'payments' && (
                <div className="space-y-3">
                  {!po.payments || po.payments.length === 0 ? (
                    <div className="p-8 text-center bg-slate-950 rounded-2xl border border-slate-800 text-slate-500">
                      لا يوجد سندات صرف أو مدفوعات مسجلة لهذا الطلب بعد.
                    </div>
                  ) : (
                    po.payments.map((sp) => (
                      <div
                        key={sp.id}
                        className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 flex items-center justify-between"
                      >
                        <div>
                          <div className="font-bold text-slate-100 flex items-center gap-2">
                            <span>سند صرف</span>
                            <span className="text-[10px] bg-rose-950/60 text-rose-300 border border-rose-500/30 px-2 py-0.5 rounded font-mono">
                              {sp.paymentMethod === 'cash' ? 'نقداً' : sp.paymentMethod}
                            </span>
                            {sp.referenceNumber && (
                              <span className="text-[10px] text-slate-400 font-mono">
                                مرجع: {sp.referenceNumber}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            التاريخ: {new Date(sp.paymentDate).toLocaleDateString('ar-JO')}
                            {sp.notes && ` | ${sp.notes}`}
                          </div>
                        </div>

                        <div className="text-left">
                          <span className="font-black text-sm text-emerald-400">
                            {sp.amount.toFixed(2)} {CURRENCY}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Financial Box Summary */}
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-400 block mb-0.5">إجمالي الطلب:</span>
                  <span className="font-black text-sm text-slate-100">
                    {po.totalAmount.toFixed(2)} {CURRENCY}
                  </span>
                </div>

                <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-400 block mb-0.5">إجمالي الخصم والخصومات:</span>
                  <span className="font-black text-sm text-blue-400">
                    {po.discount.toFixed(2)} {CURRENCY}
                  </span>
                </div>

                <div className="p-2.5 bg-emerald-950/30 rounded-xl border border-emerald-500/20">
                  <span className="text-[10px] text-emerald-400 block mb-0.5">إجمالي المسدد حتى الآن:</span>
                  <span className="font-black text-sm text-emerald-300">
                    {po.amountPaid.toFixed(2)} {CURRENCY}
                  </span>
                </div>

                <div className="p-2.5 bg-amber-950/30 rounded-xl border border-amber-500/20">
                  <span className="text-[10px] text-amber-400 block mb-0.5">المتبقي المستحق للمورد:</span>
                  <span className="font-black text-sm text-amber-300">
                    {po.amountDue.toFixed(2)} {CURRENCY}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sub-modals for Receive & Payment */}
      {po && (
        <>
          <ReceiveGoodsModal
            isOpen={isReceiveModalOpen}
            po={po}
            onClose={() => setIsReceiveModalOpen(false)}
            onSuccess={() => {
              loadPoDetails();
              onRefresh();
            }}
          />

          <SupplierPaymentModal
            isOpen={isPaymentModalOpen}
            po={po}
            onClose={() => setIsPaymentModalOpen(false)}
            onSuccess={() => {
              loadPoDetails();
              onRefresh();
            }}
          />
        </>
      )}
    </>
  );
};
