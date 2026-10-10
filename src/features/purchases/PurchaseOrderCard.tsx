import {FormFields, formatJod, formatUiDate, UiButton} from '../../components/ui';
/**
 * Nawasrah Business Manager - Purchase Order Summary Card Component
 */

import React from 'react';
import { PurchaseOrder, PurchaseOrderStatus } from '../../types/purchases';
import {
  FileText,
  Building,
  Warehouse,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  Truck,
  ArrowUpRight,
  ChevronLeft,
  XCircle,
} from 'lucide-react';
import { CURRENCY } from '../../constants';

interface PurchaseOrderCardProps {
  po: PurchaseOrder;
  onViewDetails: (po: PurchaseOrder) => void;
  onReceiveGoods?: (po: PurchaseOrder) => void;
  onRecordPayment?: (po: PurchaseOrder) => void;
}

export const PurchaseOrderCard: React.FC<PurchaseOrderCardProps> = ({
  po,
  onViewDetails,
  onReceiveGoods,
  onRecordPayment,
}) => {
  // Status styling map
  const getStatusBadge = (status: PurchaseOrderStatus) => {
    switch (status) {
      case 'draft':
        return {
          label: 'مسودة',
          color: 'bg-nw-surface-2 text-nw-text border-nw-border',
          icon: Clock,
        };
      case 'sent':
        return {
          label: 'مرسل للمورد',
          color: 'bg-nw-info-bg text-nw-info border-nw-border',
          icon: Truck,
        };
      case 'approved':
        return {
          label: 'معتمد بانتظار التوريد',
          color: 'bg-nw-warn-bg text-nw-warn border-nw-border',
          icon: AlertCircle,
        };
      case 'partially_received':
        return {
          label: 'مستلم جزئياً',
          color: 'bg-nw-info-bg text-nw-info border-nw-border',
          icon: Truck,
        };
      case 'received':
        return {
          label: 'مستلم بالكامل',
          color: 'bg-nw-ok-bg text-nw-ok border-nw-border',
          icon: CheckCircle2,
        };
      case 'cancelled':
        return {
          label: 'ملغى',
          color: 'bg-nw-bad-bg text-nw-bad border-nw-border',
          icon: XCircle,
        };
      default:
        return {
          label: status,
          color: 'bg-nw-surface-2 text-nw-text border-nw-border',
          icon: FileText,
        };
    }
  };

  const badge = getStatusBadge(po.status);
  const StatusIcon = badge.icon;

  // Calculate overall receiving progress
  const totalOrderedQty = po.items.reduce((sum, i) => sum + i.orderedQuantity, 0);
  const totalReceivedQty = po.items.reduce((sum, i) => sum + i.receivedQuantity, 0);
  const receivePercentage =
    totalOrderedQty > 0 ? Math.min(100, Math.round((totalReceivedQty / totalOrderedQty) * 100)) : 0;

  return (
    <FormFields
      data-purchase-order-card={po.id}
      onClick={() => onViewDetails(po)}
      className="nw-purchasing-fields bg-nw-surface border border-nw-border hover:border-nw-border rounded-2xl p-4 shadow-md transition-all cursor-pointer group space-y-3.5 relative overflow-hidden"
    >
      {/* Top Header Row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-nw-info-bg border border-nw-border flex items-center justify-center shrink-0 text-nw-info group-hover:scale-105 transition">
            <FileText className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-nw-text text-sm truncate flex items-center gap-2">
              <span>{po.purchaseOrderNumber}</span>
              {po.supplierInvoiceNumber && (
                <span className="text-[10px] text-nw-muted bg-nw-surface-2 px-1.5 py-0.5 rounded border border-nw-border font-mono">
                  فاتورة: {po.supplierInvoiceNumber}
                </span>
              )}
            </h3>
            <div className="flex items-center gap-2 text-[11px] text-nw-muted mt-0.5">
              <span className="flex items-center gap-1 font-semibold text-nw-text">
                <Building className="w-3 h-3 text-nw-ok" />
                {po.supplierName}
              </span>
              {po.warehouseName && (
                <>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Warehouse className="w-3 h-3 text-nw-muted" />
                    {po.warehouseName}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Status Badge */}
        <div
          className={`px-2.5 py-1 rounded-xl border text-[11px] font-bold flex items-center gap-1.5 shrink-0 ${badge.color}`}
        >
          <StatusIcon className="w-3.5 h-3.5" />
          <span>{badge.label}</span>
        </div>
      </div>

      {/* Progress Bar for Goods Receiving */}
      {po.status !== 'cancelled' && (
        <div className="bg-nw-bg p-2.5 rounded-xl border border-nw-border space-y-1.5 text-xs">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-nw-muted font-medium">نسبة توريد البضاعة للمخزن:</span>
            <span className="font-bold text-nw-text">
              {totalReceivedQty} من {totalOrderedQty} قطعة ({receivePercentage}%)
            </span>
          </div>
          <div className="w-full bg-nw-surface-2 h-2 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                receivePercentage === 100
                  ? 'bg-nw-ok-bg'
                  : receivePercentage > 0
                  ? 'bg-nw-info-bg'
                  : 'bg-nw-surface-2'
              }`}
              style={{ width: `${receivePercentage}%` }}
            />
          </div>
        </div>
      )}

      {/* Amounts & Financial Summary */}
      <div className="pt-2 border-t border-nw-border grid grid-cols-3 gap-2 text-center text-xs">
        <div className="bg-nw-surface-2 p-2 rounded-xl">
          <span className="text-[10px] text-nw-muted block mb-0.5">الإجمالي الصافي:</span>
          <span className="font-black text-nw-text">
            {formatJod(po.totalAmount)} {CURRENCY}
          </span>
        </div>

        <div className="bg-nw-ok-bg border border-nw-border p-2 rounded-xl">
          <span className="text-[10px] text-nw-ok block mb-0.5">المدفوع:</span>
          <span className="font-black text-nw-ok">
            {formatJod(po.amountPaid)} {CURRENCY}
          </span>
        </div>

        <div className="bg-nw-warn-bg border border-nw-border p-2 rounded-xl">
          <span className="text-[10px] text-nw-warn block mb-0.5">المتبقي للمورد:</span>
          <span className="font-black text-nw-warn">
            {formatJod(po.amountDue)} {CURRENCY}
          </span>
        </div>
      </div>

      {/* Footer Meta & Quick Action Buttons */}
      <div className="pt-2 flex items-center justify-between text-[11px] text-nw-muted">
        <div className="flex items-center gap-1.5">
          <Calendar className="w-3 h-3 text-nw-muted" />
          <span>تاريخ الطلب: {formatUiDate(po.orderDate, {year:'numeric',month:'numeric',day:'numeric'})}</span>
        </div>

        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {/* Quick Receive Goods Button */}
          {['approved', 'partially_received'].includes(po.status) && onReceiveGoods && (
            <UiButton variant="plain" type="button"
              onClick={() => onReceiveGoods(po)}
              className="bg-nw-info-bg text-nw-info border border-nw-border hover:bg-nw-info-bg px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition text-[11px] h-auto min-h-11 min-w-0 whitespace-normal"
            >
              <Truck className="w-3 h-3" />
              <span>استلام</span>
            </UiButton>
          )}

          {/* Quick Record Payment Button */}
          {po.amountDue > 0 && po.status !== 'cancelled' && onRecordPayment && (
            <UiButton variant="plain" type="button"
              onClick={() => onRecordPayment(po)}
              className="bg-nw-bad-bg text-nw-bad border border-nw-border hover:bg-nw-bad-bg px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition text-[11px] h-auto min-h-11 min-w-0 whitespace-normal"
            >
              <ArrowUpRight className="w-3 h-3" />
              <span>دفع</span>
            </UiButton>
          )}

          <ChevronLeft className="w-4 h-4 text-nw-muted group-hover:text-nw-info group-hover:-translate-x-1 transition" />
        </div>
      </div>
    </FormFields>
  );
};
