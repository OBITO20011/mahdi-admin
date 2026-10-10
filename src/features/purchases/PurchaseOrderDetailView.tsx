import {FormFields, Card, UiButton, formatUiDate, formatJod, DataTable, Tr, Th, Td} from '../../components/ui';
/**
 * Nawasrah Business Manager - Purchase Order Detail View Sheet
 */

import React, { useCallback, useEffect, useState } from 'react';
import { storeEngine } from '../../stores/useAppStore';
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
  PackageCheck,
  Printer,
  AlertTriangle,
  ChevronRight,
  Edit,
  Trash2,
  User,
} from 'lucide-react';
import { CURRENCY } from '../../constants';

function formatHumanQuantity(qty: number, unitName?: string): string {
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

  const loadPoDetails = useCallback(async () => {
    if (!poId) return;
    setLoading(true);
    const res = await fetchPurchaseOrderByIdFromSupabase(poId);
    if (res.success && res.data) {
      setPo(res.data);
    }
    setLoading(false);
  }, [poId]);

  useEffect(() => {
    void loadPoDetails();
  }, [loadPoDetails]);

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
        return { label: 'مسودة', color: 'bg-nw-surface-2 text-nw-text border-nw-border', icon: Clock };
      case 'sent':
        return { label: 'مرسل للمورد', color: 'bg-nw-info-bg text-nw-info border-nw-border', icon: Send };
      case 'approved':
        return { label: 'معتمد بانتظار التوريد', color: 'bg-nw-warn-bg text-nw-warn border-nw-border', icon: AlertCircle };
      case 'partially_received':
        return { label: 'مستلم جزئياً', color: 'bg-nw-info-bg text-nw-info border-nw-border', icon: Truck };
      case 'received':
        return { label: 'مستلم بالكامل', color: 'bg-nw-ok-bg text-nw-ok border-nw-border', icon: CheckCircle2 };
      case 'cancelled':
        return { label: 'ملغى', color: 'bg-nw-bad-bg text-nw-bad border-nw-border', icon: XCircle };
      default:
        return { label: status, color: 'bg-nw-surface-2 text-nw-text border-nw-border', icon: FileText };
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
      <div className="fixed inset-0 z-50 flex items-center justify-end bg-nw-overlay backdrop-blur-sm p-0 sm:p-4 overflow-hidden">
        <Card padded={false} className="bg-nw-surface border-r sm:border border-nw-border w-full sm:max-w-3xl h-full sm:h-[95vh] sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col my-auto">
          {/* Top Bar */}
          <div className="bg-nw-surface-2 px-5 py-4 border-b border-nw-border flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <UiButton aria-label="رجوع لأوامر الشراء" variant="plain" type="button"
                onClick={onClose}
                className="w-11 h-11 rounded-xl bg-nw-surface-2 text-nw-text hover:text-nw-text flex items-center justify-center transition h-auto min-h-11 min-w-0 whitespace-normal"
              >
                <ChevronRight className="w-5 h-5" />
              </UiButton>
              <div className="min-w-0">
                <h2 className="text-base font-bold text-nw-text flex items-center gap-2">
                  <span>طلب شراء رقم:</span>
                  <span className="font-mono text-nw-info">{po?.purchaseOrderNumber || poId}</span>
                </h2>
                <p className="text-xs text-nw-muted">تفاصيل وسجلات الاستلام والمدفوعات الكاملة</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <UiButton variant="plain" type="button"
                onClick={() => window.print()}
                className="w-11 h-11 rounded-xl bg-nw-surface-2 border border-nw-border text-nw-text hover:text-nw-text flex items-center justify-center transition h-auto min-h-11 min-w-0 whitespace-normal"
                title="طباعة أمر الشراء"
              >
                <Printer className="w-4 h-4" />
              </UiButton>
              <UiButton variant="plain" type="button"
                onClick={onClose}
                aria-label="إغلاق تفاصيل أمر الشراء"
                className="w-11 h-11 rounded-xl bg-nw-surface-2 border border-nw-border text-nw-text hover:text-nw-text flex items-center justify-center transition h-auto min-h-11 min-w-0 whitespace-normal"
              >
                <X className="w-5 h-5" />
              </UiButton>
            </div>
          </div>

          {loading || !po ? (
            <div className="flex-1 flex items-center justify-center p-8 text-nw-muted">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-nw-border ml-3"></div>
              <span>جاري تحميل بيانات أمر الشراء...</span>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
              {actionError && (
                <div className="bg-nw-bad-bg border border-nw-border p-3 rounded-2xl text-nw-bad flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-nw-bad" />
                  <span>{actionError}</span>
                </div>
              )}

              {/* Status Header Banner & Action Toolbar */}
              <div className="bg-nw-bg p-4 sm:p-5 rounded-2xl border border-nw-border space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {(() => {
                      const badge = getStatusBadge(po.status);
                      const Icon = badge.icon;
                      return (
                        <FormFields
                          className={`px-3.5 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-2 ${badge.color}`}
                        >
                          <Icon className="w-4 h-4" />
                          <span>الحالة: {badge.label}</span>
                        </FormFields>
                      );
                    })()}

                    {po.supplierInvoiceNumber && (
                      <span className="bg-nw-surface-2 text-nw-text px-3 py-1.5 rounded-xl border border-nw-border font-mono text-[11px] font-bold">
                        رقم فاتورة المورد: {po.supplierInvoiceNumber}
                      </span>
                    )}
                  </div>

                  {/* Context-Aware Action Buttons */}
                  <div className="flex flex-wrap items-center gap-2">
                    {po.status === 'draft' && (
                      <>
                        <UiButton variant="plain" type="button"
                          onClick={() => setIsEditModalOpen(true)}
                          className="bg-nw-warn-bg text-nw-warn border border-nw-border hover:bg-nw-warn-bg px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition text-xs h-auto min-h-11 min-w-0 whitespace-normal"
                        >
                          <Edit className="w-3.5 h-3.5" />
                          <span>تعديل أمر الشراء</span>
                        </UiButton>
                        <UiButton variant="plain" type="button"
                          onClick={() => setIsDeleteConfirmOpen(true)}
                          className="bg-nw-bad-bg text-nw-bad border border-nw-border hover:bg-nw-bad-bg px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition text-xs h-auto min-h-11 min-w-0 whitespace-normal"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>حذف</span>
                        </UiButton>
                        <UiButton variant="plain" type="button"
                          onClick={handleSendPO}
                          disabled={isActionLoading}
                          className="bg-nw-info-bg hover:bg-nw-info-bg text-nw-text px-3.5 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition text-xs shadow h-auto min-h-11 min-w-0 whitespace-normal"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>إرسال للمورد</span>
                        </UiButton>
                      </>
                    )}

                    {po.status === 'sent' && (
                      <>
                        <UiButton variant="plain" type="button"
                          onClick={handleApprovePO}
                          disabled={isActionLoading}
                          className="bg-nw-ok-bg hover:bg-nw-ok-bg text-nw-text px-3.5 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition text-xs shadow h-auto min-h-11 min-w-0 whitespace-normal"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>اعتماد الطلب</span>
                        </UiButton>
                        <UiButton variant="plain" type="button"
                          onClick={() => window.print()}
                          className="bg-nw-surface-2 hover:bg-nw-surface-2 text-nw-text border border-nw-border px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition text-xs h-auto min-h-11 min-w-0 whitespace-normal"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>طباعة</span>
                        </UiButton>
                      </>
                    )}

                    {po.status === 'approved' && (
                      <UiButton variant="plain" type="button"
                        onClick={() => setIsReceiveModalOpen(true)}
                        className="bg-nw-info-bg hover:bg-nw-info-bg text-nw-text px-4 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition text-xs shadow-lg h-auto min-h-11 min-w-0 whitespace-normal"
                      >
                        <Truck className="w-4 h-4" />
                        <span>استلام بضائع لمخزن</span>
                      </UiButton>
                    )}

                    {po.status === 'partially_received' && (
                      <UiButton variant="plain" type="button"
                        onClick={() => setIsReceiveModalOpen(true)}
                        className="bg-nw-info-bg hover:bg-nw-info-bg text-nw-text px-4 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition text-xs shadow-lg h-auto min-h-11 min-w-0 whitespace-normal"
                      >
                        <Truck className="w-4 h-4" />
                        <span>استلام المتبقي</span>
                      </UiButton>
                    )}

                    {po.status === 'received' && (
                      <>
                        <UiButton variant="plain" type="button"
                          onClick={() => window.print()}
                          className="bg-nw-surface-2 hover:bg-nw-surface-2 text-nw-text border border-nw-border px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition text-xs h-auto min-h-11 min-w-0 whitespace-normal"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>طباعة</span>
                        </UiButton>
                        {po.amountDue > 0 && (
                          <UiButton variant="plain" type="button"
                            onClick={() => setIsPaymentModalOpen(true)}
                            className="bg-nw-bad-bg hover:bg-nw-bad-bg text-nw-text px-3.5 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition text-xs shadow h-auto min-h-11 min-w-0 whitespace-normal"
                          >
                            <ArrowUpRight className="w-3.5 h-3.5" />
                            <span>تسديد دفعة</span>
                          </UiButton>
                        )}
                      </>
                    )}

                    {po.status === 'cancelled' && (
                      <span className="bg-nw-surface-2 text-nw-muted border border-nw-border px-3 py-1 rounded-xl text-xs font-semibold">
                        عرض فقط (ملغى)
                      </span>
                    )}

                    {po.amountDue > 0 && !['draft', 'cancelled', 'received'].includes(po.status) && (
                      <UiButton variant="plain" type="button"
                        onClick={() => setIsPaymentModalOpen(true)}
                        className="bg-nw-bad-bg hover:bg-nw-bad-bg text-nw-text px-3.5 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition text-xs shadow h-auto min-h-11 min-w-0 whitespace-normal"
                      >
                        <ArrowUpRight className="w-3.5 h-3.5" />
                        <span>تسديد دفعة</span>
                      </UiButton>
                    )}

                    {['draft', 'sent', 'approved'].includes(po.status) && (
                      <UiButton variant="plain" type="button"
                        onClick={handleCancelPO}
                        disabled={isActionLoading}
                        className="bg-nw-bad-bg hover:bg-nw-bad-bg text-nw-bad border border-nw-border px-3 py-1.5 rounded-xl font-bold transition text-xs h-auto min-h-11 min-w-0 whitespace-normal"
                      >
                        إلغاء الطلب
                      </UiButton>
                    )}
                  </div>
                </div>

                {/* Comprehensive Metadata Header Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-nw-border text-xs">
                  <Card padded={false} className="bg-nw-surface p-2.5 rounded-xl border border-nw-border">
                    <span className="text-[10px] text-nw-muted block mb-0.5">المورد الرئيسي:</span>
                    <span className="font-bold text-nw-text flex items-center gap-1.5 truncate">
                      <Building className="w-3.5 h-3.5 text-nw-ok shrink-0" />
                      {po.supplierName}
                    </span>
                  </Card>

                  <Card padded={false} className="bg-nw-surface p-2.5 rounded-xl border border-nw-border">
                    <span className="text-[10px] text-nw-muted block mb-0.5">الفرع والفرع المالي:</span>
                    <span className="font-bold text-nw-text flex items-center gap-1.5 truncate">
                      <Building className="w-3.5 h-3.5 text-nw-info shrink-0" />
                      {po.branchName || 'غير محدد'}
                    </span>
                  </Card>

                  <Card padded={false} className="bg-nw-surface p-2.5 rounded-xl border border-nw-border">
                    <span className="text-[10px] text-nw-muted block mb-0.5">مخزن الاستلام:</span>
                    <span className="font-bold text-nw-text flex items-center gap-1.5 truncate">
                      <Warehouse className="w-3.5 h-3.5 text-nw-info shrink-0" />
                      {po.warehouseName || 'المخزن الرئيسي'}
                    </span>
                  </Card>

                  <Card padded={false} className="bg-nw-surface p-2.5 rounded-xl border border-nw-border">
                    <span className="text-[10px] text-nw-muted block mb-0.5">أنشئ بواسطة:</span>
                    <span className="font-bold text-nw-text flex items-center gap-1.5 truncate">
                      <User className="w-3.5 h-3.5 text-nw-muted shrink-0" />
                      {po.createdBy || 'مسؤول المشتريات'}
                    </span>
                  </Card>

                  <Card padded={false} className="bg-nw-surface p-2.5 rounded-xl border border-nw-border">
                    <span className="text-[10px] text-nw-muted block mb-0.5">تاريخ إصدار الطلب:</span>
                    <span className="font-bold text-nw-text flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-nw-muted shrink-0" />
                      {formatUiDate(po.createdAt || po.orderDate, {year:'numeric',month:'numeric',day:'numeric'})}
                    </span>
                  </Card>

                  <Card padded={false} className="bg-nw-surface p-2.5 rounded-xl border border-nw-border">
                    <span className="text-[10px] text-nw-muted block mb-0.5">تاريخ التسليم المتوقع:</span>
                    <span className="font-bold text-nw-text flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-nw-warn shrink-0" />
                      {po.expectedDeliveryDate
                        ? formatUiDate(po.expectedDeliveryDate, {year:'numeric',month:'numeric',day:'numeric'})
                        : 'غير محدد'}
                    </span>
                  </Card>

                  <Card padded={false} className="bg-nw-surface p-2.5 rounded-xl border border-nw-border">
                    <span className="text-[10px] text-nw-muted block mb-0.5">خصم كلي على الطلب:</span>
                    <span className="font-bold text-nw-text font-mono">
                      {formatJod((po.discount || 0))} {CURRENCY}
                    </span>
                  </Card>

                  <Card padded={false} className="bg-nw-surface p-2.5 rounded-xl border border-nw-border">
                    <span className="text-[10px] text-nw-muted block mb-0.5">رسوم الشحن والتوصيل:</span>
                    <span className="font-bold text-nw-text font-mono">
                      {formatJod((po.deliveryFee || 0))} {CURRENCY}
                    </span>
                  </Card>
                </div>
              </div>

              {/* Enhanced Summary Cards Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
                {/* 1. Total Products */}
                <Card padded={false} className="bg-nw-surface border border-nw-border p-3 rounded-2xl text-center space-y-1">
                  <span className="text-[10px] text-nw-muted block font-medium">عدد أصناف الطلب</span>
                  <span className="font-black text-sm text-nw-text block">{po.items.length} أصناف</span>
                </Card>

                {/* 2. Requested Units */}
                <Card padded={false} className="bg-nw-surface border border-nw-border p-3 rounded-2xl text-center space-y-1">
                  <span className="text-[10px] text-nw-muted block font-medium">إجمالي المطلوبة</span>
                  <span className="font-black text-xs text-nw-info block">
                    {formatHumanQuantity(po.items.reduce((sum, i) => sum + i.orderedQuantity, 0))}
                  </span>
                </Card>

                {/* 3. Received Units */}
                <Card padded={false} className="bg-nw-surface border border-nw-border p-3 rounded-2xl text-center space-y-1">
                  <span className="text-[10px] text-nw-muted block font-medium">إجمالي المستلمة</span>
                  <span className="font-black text-xs text-nw-ok block">
                    {formatHumanQuantity(po.items.reduce((sum, i) => sum + i.receivedQuantity, 0))}
                  </span>
                </Card>

                {/* 4. Remaining Units */}
                <Card padded={false} className="bg-nw-surface border border-nw-border p-3 rounded-2xl text-center space-y-1">
                  <span className="text-[10px] text-nw-muted block font-medium">إجمالي المتبقية</span>
                  <span className="font-black text-xs text-nw-info block">
                    {formatHumanQuantity(
                      po.items.reduce((sum, i) => sum + Math.max(0, i.orderedQuantity - i.receivedQuantity), 0)
                    )}
                  </span>
                </Card>

                {/* 5. Order Total */}
                <Card padded={false} className="bg-nw-surface border border-nw-border p-3 rounded-2xl text-center space-y-1">
                  <span className="text-[10px] text-nw-muted block font-medium">إجمالي أمر الشراء</span>
                  <span className="font-black text-xs text-nw-text block font-mono">
                    {formatJod(po.totalAmount)} {CURRENCY}
                  </span>
                </Card>

                {/* 6. Paid */}
                <div className="bg-nw-ok-bg border border-nw-border p-3 rounded-2xl text-center space-y-1">
                  <span className="text-[10px] text-nw-ok block font-medium">المدفوع للمورد</span>
                  <span className="font-black text-xs text-nw-ok block font-mono">
                    {formatJod(po.amountPaid)} {CURRENCY}
                  </span>
                </div>

                {/* 7. Outstanding */}
                <div className="bg-nw-bad-bg border border-nw-border p-3 rounded-2xl text-center space-y-1">
                  <span className="text-[10px] text-nw-bad block font-medium">المتبقي المستحق</span>
                  <span className="font-black text-xs text-nw-bad block font-mono">
                    {formatJod(po.amountDue)} {CURRENCY}
                  </span>
                </div>
              </div>

              {/* Navigation Tabs for View */}
              <div className="flex items-center bg-nw-bg p-1 rounded-2xl border border-nw-border text-xs font-bold">
                <UiButton variant="plain" type="button"
                  onClick={() => setActiveTab('items')}
                  className={`flex-1 py-2 rounded-xl transition flex items-center justify-center gap-1.5 ${
                    activeTab === 'items'
                      ? 'bg-nw-info-bg text-nw-text shadow'
                      : 'text-nw-muted hover:text-nw-text'
                  }`}
                >
                  <PackageCheck className="w-4 h-4" />
                  <span>أصناف الطلب ({po.items.length})</span>
                </UiButton>

                <UiButton variant="plain" type="button"
                  onClick={() => setActiveTab('receipts')}
                  className={`flex-1 py-2 rounded-xl transition flex items-center justify-center gap-1.5 ${
                    activeTab === 'receipts'
                      ? 'bg-nw-info-bg text-nw-text shadow'
                      : 'text-nw-muted hover:text-nw-text'
                  }`}
                >
                  <Truck className="w-4 h-4" />
                  <span>سندات الاستلام ({po.receipts?.length || 0})</span>
                </UiButton>

                <UiButton variant="plain" type="button"
                  onClick={() => setActiveTab('payments')}
                  className={`flex-1 py-2 rounded-xl transition flex items-center justify-center gap-1.5 ${
                    activeTab === 'payments'
                      ? 'bg-nw-bad-bg text-nw-text shadow'
                      : 'text-nw-muted hover:text-nw-text'
                  }`}
                >
                  <ArrowUpRight className="w-4 h-4" />
                  <span>سندات الصرف والمدفوعات ({po.payments?.length || 0})</span>
                </UiButton>
              </div>

              {/* TAB 1: Items Table */}
              {activeTab === 'items' && (
                <div className="border border-nw-border rounded-2xl overflow-hidden bg-nw-bg">
                  <div className="overflow-x-auto">
                    <DataTable caption="أصناف أمر الشراء" className="w-full text-right text-xs">
                      <thead className="bg-nw-surface-2 text-nw-text font-bold border-b border-nw-border">
                        <Tr>
                          <Th className="p-3">اسم المنتج والترميز</Th>
                          <Th className="p-3 text-center">الكمية المطلوبة</Th>
                          <Th className="p-3 text-center">الكمية المستلمة</Th>
                          <Th className="p-3 text-center">الكمية المتبقية</Th>
                          <Th className="p-3 text-center">سعر الشراء</Th>
                          <Th className="p-3 text-center">الخصم</Th>
                          <Th className="p-3 text-center">إجمالي هذا المنتج ({CURRENCY})</Th>
                        </Tr>
                      </thead>
                      <tbody className="divide-y divide-nw-border">
                        {po.items.map((item) => {
                          const remainingQty = Math.max(0, item.orderedQuantity - item.receivedQuantity);
                          const formulaText =
                            item.discount > 0
                              ? `(${item.orderedQuantity} × ${item.purchasePrice.toFixed(3)}) - ${item.discount.toFixed(3)} = ${item.lineTotal.toFixed(3)} ${CURRENCY}`
                              : `${item.orderedQuantity} × ${item.purchasePrice.toFixed(3)} = ${item.lineTotal.toFixed(3)} ${CURRENCY}`;

                          return (
                            <Tr key={item.id} className="hover:bg-nw-surface-2 transition">
                              <Td className="p-3 font-semibold text-nw-text">
                                <div className="font-bold text-nw-text">{item.productName}</div>
                                <div className="text-[10px] text-nw-muted font-mono flex flex-wrap items-center gap-2 mt-0.5">
                                  <span>SKU: {item.sku || 'غير محدد'}</span>
                                  {item.barcode && <span>• باركود: {item.barcode}</span>}
                                  {item.unit && (
                                    <span className="bg-nw-surface-2 border border-nw-border px-1.5 py-0.2 rounded text-[9px] text-nw-text font-sans">
                                      الوحدة: {item.unit}
                                    </span>
                                  )}
                                </div>
                              </Td>

                              <Td className="p-3 text-center font-bold text-nw-info">
                                <div>{formatHumanQuantity(item.orderedQuantity, item.unit)}</div>
                                <div className="text-[10px] text-nw-muted font-mono">({item.orderedQuantity})</div>
                              </Td>

                              <Td className="p-3 text-center">
                                <span
                                  className={`px-2.5 py-1 rounded-lg font-bold text-[11px] inline-block ${
                                    item.receivedQuantity >= item.orderedQuantity
                                      ? 'bg-nw-ok-bg text-nw-ok border border-nw-border'
                                      : item.receivedQuantity > 0
                                      ? 'bg-nw-info-bg text-nw-info border border-nw-border'
                                      : 'bg-nw-surface-2 text-nw-muted'
                                  }`}
                                >
                                  {formatHumanQuantity(item.receivedQuantity, item.unit)}
                                </span>
                              </Td>

                              <Td className="p-3 text-center">
                                <span
                                  className={`px-2.5 py-1 rounded-lg font-bold text-[11px] inline-block ${
                                    remainingQty === 0
                                      ? 'bg-nw-surface-2 text-nw-muted'
                                      : 'bg-nw-warn-bg text-nw-warn border border-nw-border'
                                  }`}
                                >
                                  {formatHumanQuantity(remainingQty, item.unit)}
                                </span>
                              </Td>

                              <Td className="p-3 text-center text-nw-text font-mono">
                                {formatJod(item.purchasePrice)} {CURRENCY}
                              </Td>

                              <Td className="p-3 text-center text-nw-muted font-mono">
                                {formatJod(item.discount)} {CURRENCY}
                              </Td>

                              <Td className="p-3 text-center font-black text-nw-text">
                                <div className="text-nw-ok font-mono">{formatJod(item.lineTotal)} {CURRENCY}</div>
                                <div className="text-[9px] text-nw-muted font-mono mt-0.5">{formulaText}</div>
                              </Td>
                            </Tr>
                          );
                        })}
                      </tbody>
                    </DataTable>
                  </div>
                </div>
              )}

              {/* TAB 2: Receipts History */}
              {activeTab === 'receipts' && (
                <div className="space-y-3">
                  {!po.receipts || po.receipts.length === 0 ? (
                    <div className="p-8 text-center bg-nw-bg rounded-2xl border border-nw-border text-nw-muted">
                      لا يوجد سندات استلام بضاعة لهذا الطلب حتى الآن.
                    </div>
                  ) : (
                    po.receipts.map((rc) => (
                      <div
                        key={rc.id}
                        className="bg-nw-bg p-4 rounded-2xl border border-nw-border space-y-2.5"
                      >
                        <div className="flex items-center justify-between border-b border-nw-border pb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-nw-info font-mono text-sm">
                              {rc.receiptNumber}
                            </span>
                            {rc.supplierDeliveryNote && (
                              <span className="text-[10px] bg-nw-surface-2 text-nw-text px-2 py-0.5 rounded">
                                إشعار المورد: {rc.supplierDeliveryNote}
                              </span>
                            )}
                          </div>
                          <span className="text-nw-muted text-[11px]">
                            تاريخ الاستلام: {formatUiDate(rc.receivedAt, {year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}
                          </span>
                        </div>

                        <div className="space-y-1">
                          <span className="text-[11px] text-nw-muted font-bold">الأصناف المستلمة بالسند:</span>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                            {rc.items.map((ri) => (
                              <Card padded={false}
                                key={ri.id}
                                className="bg-nw-surface p-2 rounded-xl border border-nw-border flex items-center justify-between"
                              >
                                <span className="font-semibold text-nw-text">{ri.productName}</span>
                                <span className="font-bold text-nw-info">
                                  {ri.receivedQuantity} قطعة @ {formatJod(ri.unitCost)} {CURRENCY}
                                </span>
                              </Card>
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
                    <div className="p-8 text-center bg-nw-bg rounded-2xl border border-nw-border text-nw-muted">
                      لا يوجد سندات صرف أو مدفوعات مسجلة لهذا الطلب بعد.
                    </div>
                  ) : (
                    po.payments.map((sp) => (
                      <div
                        key={sp.id}
                        className="bg-nw-bg p-3.5 rounded-2xl border border-nw-border flex items-center justify-between"
                      >
                        <div>
                          <div className="font-bold text-nw-text flex items-center gap-2">
                            <span>سند صرف</span>
                            <span className="text-[10px] bg-nw-bad-bg text-nw-bad border border-nw-border px-2 py-0.5 rounded font-mono">
                              {sp.paymentMethod === 'cash' ? 'نقداً' : sp.paymentMethod}
                            </span>
                            {sp.referenceNumber && (
                              <span className="text-[10px] text-nw-muted font-mono">
                                مرجع: {sp.referenceNumber}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-nw-muted mt-0.5">
                            التاريخ: {formatUiDate(sp.paymentDate, {year:'numeric',month:'numeric',day:'numeric'})}
                            {sp.notes && ` | ${sp.notes}`}
                          </div>
                        </div>

                        <div className="text-left">
                          <span className="font-black text-sm text-nw-ok">
                            {formatJod(sp.amount)} {CURRENCY}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Financial Box Summary */}
              <div className="bg-nw-bg p-4 rounded-2xl border border-nw-border grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <Card padded={false} className="p-2.5 bg-nw-surface rounded-xl border border-nw-border">
                  <span className="text-[10px] text-nw-muted block mb-0.5">إجمالي الطلب:</span>
                  <span className="font-black text-sm text-nw-text">
                    {formatJod(po.totalAmount)} {CURRENCY}
                  </span>
                </Card>

                <Card padded={false} className="p-2.5 bg-nw-surface rounded-xl border border-nw-border">
                  <span className="text-[10px] text-nw-muted block mb-0.5">إجمالي الخصم والخصومات:</span>
                  <span className="font-black text-sm text-nw-info">
                    {formatJod(po.discount)} {CURRENCY}
                  </span>
                </Card>

                <div className="p-2.5 bg-nw-ok-bg rounded-xl border border-nw-border">
                  <span className="text-[10px] text-nw-ok block mb-0.5">إجمالي المسدد حتى الآن:</span>
                  <span className="font-black text-sm text-nw-ok">
                    {formatJod(po.amountPaid)} {CURRENCY}
                  </span>
                </div>

                <div className="p-2.5 bg-nw-warn-bg rounded-xl border border-nw-border">
                  <span className="text-[10px] text-nw-warn block mb-0.5">المتبقي المستحق للمورد:</span>
                  <span className="font-black text-sm text-nw-warn">
                    {formatJod(po.amountDue)} {CURRENCY}
                  </span>
                </div>
              </div>
            </div>
          )}
        </Card>
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
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-nw-overlay backdrop-blur-sm p-4">
              <Card padded={false} className="bg-nw-surface border border-nw-border rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
                <div className="flex items-center gap-3 text-nw-bad">
                  <div className="w-10 h-10 rounded-2xl bg-nw-bad-bg border border-nw-border flex items-center justify-center shrink-0">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-nw-text text-sm">تأكيد حذف أمر الشراء</h3>
                    <p className="text-xs text-nw-muted">هذا الإجراء غير قابل للتراجع عنه</p>
                  </div>
                </div>

                <p className="text-xs text-nw-text leading-relaxed bg-nw-bg p-3 rounded-2xl border border-nw-border">
                  هل أنت تأكد من إغلاق/حذف أمر الشراء رقم{' '}
                  <span className="font-bold text-nw-warn font-mono">{po.purchaseOrderNumber}</span>؟
                </p>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <UiButton variant="plain" type="button"
                    onClick={() => setIsDeleteConfirmOpen(false)}
                    disabled={isActionLoading}
                    className="px-4 py-2 rounded-xl bg-nw-surface-2 text-nw-text hover:bg-nw-surface-2 font-bold transition text-xs h-auto min-h-11 min-w-0 whitespace-normal"
                  >
                    إلغاء
                  </UiButton>
                  <UiButton variant="plain" type="button"
                    onClick={handleDeletePO}
                    disabled={isActionLoading}
                    className="px-4 py-2 rounded-xl bg-nw-bad-bg hover:bg-nw-bad-bg text-nw-text font-bold transition text-xs shadow flex items-center gap-1.5 h-auto min-h-11 min-w-0 whitespace-normal"
                  >
                    {isActionLoading ? (
                      <span>جاري الحذف...</span>
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4" />
                        <span>نعم، تأكيد الحذف</span>
                      </>
                    )}
                  </UiButton>
                </div>
              </Card>
            </div>
          )}
        </>
      )}
    </>
  );
};
