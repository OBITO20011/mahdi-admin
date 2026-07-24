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
  TrendingUp,
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
          color: 'bg-slate-700/60 text-slate-300 border-slate-600/60',
          icon: Clock,
        };
      case 'sent':
        return {
          label: 'مرسل للمورد',
          color: 'bg-blue-600/20 text-blue-300 border-blue-500/30',
          icon: Truck,
        };
      case 'approved':
        return {
          label: 'معتمد بانتظار التوريد',
          color: 'bg-amber-600/20 text-amber-300 border-amber-500/30',
          icon: AlertCircle,
        };
      case 'partially_received':
        return {
          label: 'مستلم جزئياً',
          color: 'bg-indigo-600/20 text-indigo-300 border-indigo-500/30',
          icon: Truck,
        };
      case 'received':
        return {
          label: 'مستلم بالكامل',
          color: 'bg-emerald-600/20 text-emerald-300 border-emerald-500/30',
          icon: CheckCircle2,
        };
      case 'cancelled':
        return {
          label: 'ملغى',
          color: 'bg-rose-600/20 text-rose-300 border-rose-500/30',
          icon: XCircle,
        };
      default:
        return {
          label: status,
          color: 'bg-slate-800 text-slate-300 border-slate-700',
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
    <div
      onClick={() => onViewDetails(po)}
      className="bg-slate-900 border border-slate-800 hover:border-slate-700/80 rounded-2xl p-4 shadow-md transition-all cursor-pointer group space-y-3.5 relative overflow-hidden"
    >
      {/* Top Header Row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center shrink-0 text-blue-400 group-hover:scale-105 transition">
            <FileText className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-slate-100 text-sm truncate flex items-center gap-2">
              <span>{po.purchaseOrderNumber}</span>
              {po.supplierInvoiceNumber && (
                <span className="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700/60 font-mono">
                  فاتورة: {po.supplierInvoiceNumber}
                </span>
              )}
            </h3>
            <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
              <span className="flex items-center gap-1 font-semibold text-slate-300">
                <Building className="w-3 h-3 text-teal-400" />
                {po.supplierName}
              </span>
              {po.warehouseName && (
                <>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Warehouse className="w-3 h-3 text-slate-500" />
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
        <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 space-y-1.5 text-xs">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-400 font-medium">نسبة توريد البضاعة للمخزن:</span>
            <span className="font-bold text-slate-200">
              {totalReceivedQty} من {totalOrderedQty} قطعة ({receivePercentage}%)
            </span>
          </div>
          <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                receivePercentage === 100
                  ? 'bg-emerald-500'
                  : receivePercentage > 0
                  ? 'bg-indigo-500'
                  : 'bg-slate-700'
              }`}
              style={{ width: `${receivePercentage}%` }}
            />
          </div>
        </div>
      )}

      {/* Amounts & Financial Summary */}
      <div className="pt-2 border-t border-slate-800/80 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="bg-slate-800/40 p-2 rounded-xl">
          <span className="text-[10px] text-slate-400 block mb-0.5">الإجمالي الصافي:</span>
          <span className="font-black text-slate-100">
            {po.totalAmount.toFixed(2)} {CURRENCY}
          </span>
        </div>

        <div className="bg-emerald-950/30 border border-emerald-500/20 p-2 rounded-xl">
          <span className="text-[10px] text-emerald-400 block mb-0.5">المدفوع:</span>
          <span className="font-black text-emerald-300">
            {po.amountPaid.toFixed(2)} {CURRENCY}
          </span>
        </div>

        <div className="bg-amber-950/30 border border-amber-500/20 p-2 rounded-xl">
          <span className="text-[10px] text-amber-400 block mb-0.5">المتبقي للمورد:</span>
          <span className="font-black text-amber-300">
            {po.amountDue.toFixed(2)} {CURRENCY}
          </span>
        </div>
      </div>

      {/* Footer Meta & Quick Action Buttons */}
      <div className="pt-2 flex items-center justify-between text-[11px] text-slate-400">
        <div className="flex items-center gap-1.5">
          <Calendar className="w-3 h-3 text-slate-500" />
          <span>تاريخ الطلب: {new Date(po.orderDate).toLocaleDateString('ar-JO')}</span>
        </div>

        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {/* Quick Receive Goods Button */}
          {['approved', 'partially_received'].includes(po.status) && onReceiveGoods && (
            <button
              onClick={() => onReceiveGoods(po)}
              className="bg-purple-600/20 text-purple-300 border border-purple-500/30 hover:bg-purple-600/30 px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition text-[11px]"
            >
              <Truck className="w-3 h-3" />
              <span>استلام</span>
            </button>
          )}

          {/* Quick Record Payment Button */}
          {po.amountDue > 0 && po.status !== 'cancelled' && onRecordPayment && (
            <button
              onClick={() => onRecordPayment(po)}
              className="bg-rose-600/20 text-rose-300 border border-rose-500/30 hover:bg-rose-600/30 px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition text-[11px]"
            >
              <ArrowUpRight className="w-3 h-3" />
              <span>دفع</span>
            </button>
          )}

          <ChevronLeft className="w-4 h-4 text-slate-500 group-hover:text-blue-400 group-hover:-translate-x-1 transition" />
        </div>
      </div>
    </div>
  );
};
