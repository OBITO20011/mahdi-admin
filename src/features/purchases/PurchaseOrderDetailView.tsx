/**
 * Nawasrah Business Manager - Purchase Order Detail View Sheet
 */

import React, { useState, useEffect } from 'react';
import { useAppStore, storeEngine } from '../../stores/useAppStore';
import { PurchaseOrder, PurchaseOrderStatus } from '../../types/purchases';
import {
  fetchPurchaseOrderByIdFromSupabase,
  sendPurchaseOrderInSupabase,
  approvePurchaseOrderInSupabase,
  cancelPurchaseOrderInSupabase,
  deletePurchaseOrderInSupabase,
} from '../../services/supabase/purchases.service';
import { ReceiveGoodsModal } from './ReceiveGoodsModal';
import { SupplierPaymentModal } from './SupplierPaymentModal';
import { CreatePurchaseOrderModal } from './CreatePurchaseOrderModal';
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
  Edit,
  Trash2,
  User,
  Package,
} from 'lucide-react';
import { CURRENCY } from '../../constants';

export function formatHumanQuantity(qty: number, unitName?: string): string {
  const unit = (unitName || 'قطعة').trim();
  const num = Math.round(qty * 100) / 100;

  if (unit === 'كرتونة' || unit === 'كرتون' || unit === 'كراتين') {
    if (num === 1) return 'كرتونة واحدة';
    if (num === 2) return 'كرتونتان';
    if (num >= 3 && num <= 10) return `${num} كراتين`;
    return `${num} كرتونة`;
  }
  if (unit === 'علبة' || unit === 'علبه' || unit === 'علب') {
    if (num === 1) return 'علبة واحدة';
    if (num === 2) return 'علبتان';
    if (num >= 3 && num <= 10) return `${num} علب`;
    return `${num} علبة`;
  }
  if (unit === 'باكيت' || unit === 'بكيت' || unit === 'باكيتات') {
    if (num === 1) return 'باكيت واحد';
    if (num === 2) return 'باكيتان';
    if (num >= 3 && num <= 10) return `${num} باكيتات`;
    return `${num} باكيت`;
  }
  if (unit === 'ربطة' || unit === 'ربطه' || unit === 'ربطات') {
    if (num === 1) return 'ربطة واحدة';
    if (num === 2) return 'ربطتان';
    if (num >= 3 && num <= 10) return `${num} ربطات`;
    return `${num} ربطة`;
  }
  if (unit === 'قطعة' || unit === 'حبة' || unit === 'قطع') {
    if (num === 1) return 'قطعة واحدة';
    if (num === 2) return 'قطعتان';
    if (num >= 3 && num <= 10) return `${num} قطع`;
    return `${num} قطعة`;
  }
  if (unit === 'كيلو' || unit === 'كغم') {
    return `${num} كغم`;
  }
  if (unit === 'لتر') {
    return `${num} لتر`;
  }
  return `${num} ${unit}`;
}

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
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState<boolean>(false);
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

  const handleDeletePO = async () => {
    if (!po) return;
    setIsActionLoading(true);
    setActionError(null);
    const res = await deletePurchaseOrderInSupabase(po.id);
    setIsActionLoading(false);
    if (res.success) {
      storeEngine.setToast('تم حذف أمر الشراء بنجاح', 'success');
      onRefresh();
      onClose();
    } else {
      setActionError(res.error || 'فشل حذف أمر الشراء');
      setIsDeleteConfirmOpen(false);
    }
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
      storeEngine.setToast('تم إرسال أمر الشراء للمورد بنجاح', 'success');
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
      storeEngine.setToast('تم اعتماد أمر الشراء بنجاح', 'success');
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
      storeEngine.setToast('تم إلغاء أمر الشراء بنجاح', 'info');
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
              <div className="bg-slate-950 p-4 sm:p-5 rounded-2xl border border-slate-800 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {(() => {
                      const badge = getStatusBadge(po.status);
                      const Icon = badge.icon;
                      return (
                        <div
                          className={`px-3.5 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-2 ${badge.color}`}
                        >
                          <Icon className="w-4 h-4" />
                          <span>الحالة: {badge.label}</span>
                        </div>
                      );
                    })()}

                    {po.supplierInvoiceNumber && (
                      <span className="bg-slate-800 text-slate-300 px-3 py-1.5 rounded-xl border border-slate-700 font-mono text-[11px] font-bold">
                        رقم فاتورة المورد: {po.supplierInvoiceNumber}
                      </span>
                    )}
                  </div>

                  {/* Context-Aware Action Buttons */}
                  <div className="flex flex-wrap items-center gap-2">
                    {po.status === 'draft' && (
                      <>
                        <button
                          onClick={() => setIsEditModalOpen(true)}
                          className="bg-amber-600/20 text-amber-300 border border-amber-500/30 hover:bg-amber-600/30 px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition text-xs"
                        >
                          <Edit className="w-3.5 h-3.5" />
                          <span>تعديل أمر الشراء</span>
                        </button>
                        <button
                          onClick={() => setIsDeleteConfirmOpen(true)}
                          className="bg-rose-600/20 text-rose-300 border border-rose-500/30 hover:bg-rose-600/30 px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition text-xs"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>حذف</span>
                        </button>
                        <button
                          onClick={handleSendPO}
                          disabled={isActionLoading}
                          className="bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition text-xs shadow"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>إرسال للمورد</span>
                        </button>
                      </>
                    )}

                    {po.status === 'sent' && (
                      <>
                        <button
                          onClick={handleApprovePO}
                          disabled={isActionLoading}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition text-xs shadow"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>اعتماد الطلب</span>
                        </button>
                        <button
                          onClick={() => window.print()}
                          className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition text-xs"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>طباعة</span>
                        </button>
                      </>
                    )}

                    {po.status === 'approved' && (
                      <button
                        onClick={() => setIsReceiveModalOpen(true)}
                        className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition text-xs shadow-lg"
                      >
                        <Truck className="w-4 h-4" />
                        <span>استلام بضائع لمخزن</span>
                      </button>
                    )}

                    {po.status === 'partially_received' && (
                      <button
                        onClick={() => setIsReceiveModalOpen(true)}
                        className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition text-xs shadow-lg"
                      >
                        <Truck className="w-4 h-4" />
                        <span>استلام المتبقي</span>
                      </button>
                    )}

                    {po.status === 'received' && (
                      <>
                        <button
                          onClick={() => window.print()}
                          className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition text-xs"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>طباعة</span>
                        </button>
                        {po.amountDue > 0 && (
                          <button
                            onClick={() => setIsPaymentModalOpen(true)}
                            className="bg-rose-600 hover:bg-rose-500 text-white px-3.5 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition text-xs shadow"
                          >
                            <ArrowUpRight className="w-3.5 h-3.5" />
                            <span>تسديد دفعة</span>
                          </button>
                        )}
                      </>
                    )}

                    {po.status === 'cancelled' && (
                      <span className="bg-slate-800/80 text-slate-400 border border-slate-700 px-3 py-1 rounded-xl text-xs font-semibold">
                        عرض فقط (ملغى)
                      </span>
                    )}

                    {po.amountDue > 0 && !['draft', 'cancelled', 'received'].includes(po.status) && (
                      <button
                        onClick={() => setIsPaymentModalOpen(true)}
                        className="bg-rose-600 hover:bg-rose-500 text-white px-3.5 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition text-xs shadow"
                      >
                        <ArrowUpRight className="w-3.5 h-3.5" />
                        <span>تسديد دفعة</span>
                      </button>
                    )}

                    {['draft', 'sent', 'approved'].includes(po.status) && (
                      <button
                        onClick={handleCancelPO}
                        disabled={isActionLoading}
                        className="bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/80 px-3 py-1.5 rounded-xl font-bold transition text-xs"
                      >
                        إلغاء الطلب
                      </button>
                    )}
                  </div>
                </div>

                {/* Comprehensive Metadata Header Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-800/80 text-xs">
                  <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800/60">
                    <span className="text-[10px] text-slate-400 block mb-0.5">المورد الرئيسي:</span>
                    <span className="font-bold text-slate-100 flex items-center gap-1.5 truncate">
                      <Building className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                      {po.supplierName}
                    </span>
                  </div>

                  <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800/60">
                    <span className="text-[10px] text-slate-400 block mb-0.5">الفرع والفرع المالي:</span>
                    <span className="font-bold text-slate-100 flex items-center gap-1.5 truncate">
                      <Building className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                      {po.branchName || 'غير محدد'}
                    </span>
                  </div>

                  <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800/60">
                    <span className="text-[10px] text-slate-400 block mb-0.5">مخزن الاستلام:</span>
                    <span className="font-bold text-slate-100 flex items-center gap-1.5 truncate">
                      <Warehouse className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      {po.warehouseName || 'المخزن الرئيسي'}
                    </span>
                  </div>

                  <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800/60">
                    <span className="text-[10px] text-slate-400 block mb-0.5">أنشئ بواسطة:</span>
                    <span className="font-bold text-slate-100 flex items-center gap-1.5 truncate">
                      <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      {po.createdBy || 'مسؤول المشتريات'}
                    </span>
                  </div>

                  <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800/60">
                    <span className="text-[10px] text-slate-400 block mb-0.5">تاريخ إصدار الطلب:</span>
                    <span className="font-bold text-slate-200 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      {new Date(po.createdAt || po.orderDate).toLocaleDateString('ar-JO')}
                    </span>
                  </div>

                  <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800/60">
                    <span className="text-[10px] text-slate-400 block mb-0.5">تاريخ التسليم المتوقع:</span>
                    <span className="font-bold text-slate-200 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      {po.expectedDeliveryDate
                        ? new Date(po.expectedDeliveryDate).toLocaleDateString('ar-JO')
                        : 'غير محدد'}
                    </span>
                  </div>

                  <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800/60">
                    <span className="text-[10px] text-slate-400 block mb-0.5">خصم كلي على الطلب:</span>
                    <span className="font-bold text-slate-200 font-mono">
                      {(po.discount || 0).toFixed(2)} {CURRENCY}
                    </span>
                  </div>

                  <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800/60">
                    <span className="text-[10px] text-slate-400 block mb-0.5">رسوم الشحن والتوصيل:</span>
                    <span className="font-bold text-slate-200 font-mono">
                      {(po.deliveryFee || 0).toFixed(2)} {CURRENCY}
                    </span>
                  </div>
                </div>
              </div>

              {/* Enhanced Summary Cards Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
                {/* 1. Total Products */}
                <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl text-center space-y-1">
                  <span className="text-[10px] text-slate-400 block font-medium">عدد أصناف الطلب</span>
                  <span className="font-black text-sm text-slate-100 block">{po.items.length} أصناف</span>
                </div>

                {/* 2. Requested Units */}
                <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl text-center space-y-1">
                  <span className="text-[10px] text-slate-400 block font-medium">إجمالي المطلوبة</span>
                  <span className="font-black text-xs text-blue-400 block">
                    {formatHumanQuantity(po.items.reduce((sum, i) => sum + i.orderedQuantity, 0))}
                  </span>
                </div>

                {/* 3. Received Units */}
                <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl text-center space-y-1">
                  <span className="text-[10px] text-slate-400 block font-medium">إجمالي المستلمة</span>
                  <span className="font-black text-xs text-emerald-400 block">
                    {formatHumanQuantity(po.items.reduce((sum, i) => sum + i.receivedQuantity, 0))}
                  </span>
                </div>

                {/* 4. Remaining Units */}
                <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl text-center space-y-1">
                  <span className="text-[10px] text-slate-400 block font-medium">إجمالي المتبقية</span>
                  <span className="font-black text-xs text-purple-400 block">
                    {formatHumanQuantity(
                      po.items.reduce((sum, i) => sum + Math.max(0, i.orderedQuantity - i.receivedQuantity), 0)
                    )}
                  </span>
                </div>

                {/* 5. Order Total */}
                <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl text-center space-y-1">
                  <span className="text-[10px] text-slate-400 block font-medium">إجمالي أمر الشراء</span>
                  <span className="font-black text-xs text-slate-100 block font-mono">
                    {po.totalAmount.toFixed(2)} {CURRENCY}
                  </span>
                </div>

                {/* 6. Paid */}
                <div className="bg-emerald-950/30 border border-emerald-500/20 p-3 rounded-2xl text-center space-y-1">
                  <span className="text-[10px] text-emerald-400 block font-medium">المدفوع للمورد</span>
                  <span className="font-black text-xs text-emerald-300 block font-mono">
                    {po.amountPaid.toFixed(2)} {CURRENCY}
                  </span>
                </div>

                {/* 7. Outstanding */}
                <div className="bg-rose-950/30 border border-rose-500/20 p-3 rounded-2xl text-center space-y-1">
                  <span className="text-[10px] text-rose-400 block font-medium">المتبقي المستحق</span>
                  <span className="font-black text-xs text-rose-300 block font-mono">
                    {po.amountDue.toFixed(2)} {CURRENCY}
                  </span>
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
                          <th className="p-3">اسم المنتج والترميز</th>
                          <th className="p-3 text-center">الكمية المطلوبة</th>
                          <th className="p-3 text-center">الكمية المستلمة</th>
                          <th className="p-3 text-center">الكمية المتبقية</th>
                          <th className="p-3 text-center">سعر الشراء</th>
                          <th className="p-3 text-center">الخصم</th>
                          <th className="p-3 text-center">إجمالي هذا المنتج ({CURRENCY})</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {po.items.map((item) => {
                          const remainingQty = Math.max(0, item.orderedQuantity - item.receivedQuantity);
                          const formulaText =
                            item.discount > 0
                              ? `(${item.orderedQuantity} × ${item.purchasePrice.toFixed(2)}) - ${item.discount.toFixed(2)} = ${item.lineTotal.toFixed(2)} ${CURRENCY}`
                              : `${item.orderedQuantity} × ${item.purchasePrice.toFixed(2)} = ${item.lineTotal.toFixed(2)} ${CURRENCY}`;

                          return (
                            <tr key={item.id} className="hover:bg-slate-800/40 transition">
                              <td className="p-3 font-semibold text-slate-100">
                                <div className="font-bold text-slate-100">{item.productName}</div>
                                <div className="text-[10px] text-slate-400 font-mono flex flex-wrap items-center gap-2 mt-0.5">
                                  <span>SKU: {item.sku || 'غير محدد'}</span>
                                  {item.barcode && <span>• باركود: {item.barcode}</span>}
                                  {item.unit && (
                                    <span className="bg-slate-800 border border-slate-700 px-1.5 py-0.2 rounded text-[9px] text-slate-300 font-sans">
                                      الوحدة: {item.unit}
                                    </span>
                                  )}
                                </div>
                              </td>

                              <td className="p-3 text-center font-bold text-blue-300">
                                <div>{formatHumanQuantity(item.orderedQuantity, item.unit)}</div>
                                <div className="text-[10px] text-slate-500 font-mono">({item.orderedQuantity})</div>
                              </td>

                              <td className="p-3 text-center">
                                <span
                                  className={`px-2.5 py-1 rounded-lg font-bold text-[11px] inline-block ${
                                    item.receivedQuantity >= item.orderedQuantity
                                      ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30'
                                      : item.receivedQuantity > 0
                                      ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
                                      : 'bg-slate-800 text-slate-400'
                                  }`}
                                >
                                  {formatHumanQuantity(item.receivedQuantity, item.unit)}
                                </span>
                              </td>

                              <td className="p-3 text-center">
                                <span
                                  className={`px-2.5 py-1 rounded-lg font-bold text-[11px] inline-block ${
                                    remainingQty === 0
                                      ? 'bg-slate-800 text-slate-500'
                                      : 'bg-amber-600/20 text-amber-300 border border-amber-500/30'
                                  }`}
                                >
                                  {formatHumanQuantity(remainingQty, item.unit)}
                                </span>
                              </td>

                              <td className="p-3 text-center text-slate-300 font-mono">
                                {item.purchasePrice.toFixed(2)} {CURRENCY}
                              </td>

                              <td className="p-3 text-center text-slate-400 font-mono">
                                {item.discount.toFixed(2)} {CURRENCY}
                              </td>

                              <td className="p-3 text-center font-black text-slate-100">
                                <div className="text-emerald-400 font-mono">{item.lineTotal.toFixed(2)} {CURRENCY}</div>
                                <div className="text-[9px] text-slate-400 font-mono mt-0.5">{formulaText}</div>
                              </td>
                            </tr>
                          );
                        })}
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

      {/* Sub-modals for Receive, Payment, Edit, and Delete */}
      {po && (
        <>
          <ReceiveGoodsModal
            isOpen={isReceiveModalOpen}
            po={po}
            onClose={() => setIsReceiveModalOpen(false)}
            onSuccess={() => {
              storeEngine.setToast('تم استلام البضائع وتحديث المخزون بنجاح', 'success');
              loadPoDetails();
              onRefresh();
            }}
          />

          <SupplierPaymentModal
            isOpen={isPaymentModalOpen}
            po={po}
            onClose={() => setIsPaymentModalOpen(false)}
            onSuccess={() => {
              storeEngine.setToast('تم تسجيل دفعة المورد بنجاح', 'success');
              loadPoDetails();
              onRefresh();
            }}
          />

          <CreatePurchaseOrderModal
            isOpen={isEditModalOpen}
            poToEdit={po}
            onClose={() => setIsEditModalOpen(false)}
            onSuccess={() => {
              storeEngine.setToast('تم حفظ تعديلات أمر الشراء بنجاح', 'success');
              loadPoDetails();
              onRefresh();
            }}
          />

          {/* Delete Confirmation Modal */}
          {isDeleteConfirmOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
                <div className="flex items-center gap-3 text-rose-400">
                  <div className="w-10 h-10 rounded-2xl bg-rose-600/20 border border-rose-500/30 flex items-center justify-center shrink-0">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-100 text-sm">تأكيد حذف أمر الشراء</h3>
                    <p className="text-xs text-slate-400">هذا الإجراء غير قابل للتراجع عنه</p>
                  </div>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed bg-slate-950 p-3 rounded-2xl border border-slate-800">
                  هل أنت تأكد من إغلاق/حذف أمر الشراء رقم{' '}
                  <span className="font-bold text-amber-400 font-mono">{po.purchaseOrderNumber}</span>؟
                </p>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    onClick={() => setIsDeleteConfirmOpen(false)}
                    disabled={isActionLoading}
                    className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 font-bold transition text-xs"
                  >
                    إلغاء
                  </button>
                  <button
                    onClick={handleDeletePO}
                    disabled={isActionLoading}
                    className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold transition text-xs shadow flex items-center gap-1.5"
                  >
                    {isActionLoading ? (
                      <span>جاري الحذف...</span>
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4" />
                        <span>نعم، تأكيد الحذف</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
};
