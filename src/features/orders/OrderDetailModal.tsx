/**
 * Nawasrah Business Manager - Order Detail Modal & Operational Handlers
 */

import React, { useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { Order, OrderStatus } from '../../types';
import {
  Phone,
  MessageCircle,
  MapPin,
  CheckCircle,
  XCircle,
  Clock,
  Truck,
  Printer,
  DollarSign,
  UserCheck,
  PackageCheck,
  AlertTriangle,
  User,
} from 'lucide-react';
import { CURRENCY } from '../../constants';
import { CustomerLocationCard } from './CustomerLocationCard';
import { EditAddressModal } from './EditAddressModal';

interface OrderDetailModalProps {
  order: Order;
  onClose: () => void;
}

export const OrderDetailModal: React.FC<OrderDetailModalProps> = ({ order: initialOrder, onClose }) => {
  const {
    orders,
    confirmOrder,
    cancelOrder,
    advanceOrderStatus,
    users,
    updateOrder,
    setToast,
  } = useAppStore();

  // Retrieve fresh order from store if available
  const order = orders.find((o) => o.id === initialOrder.id) || initialOrder;

  const [rejectReason, setRejectReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [showEditAddress, setShowEditAddress] = useState(false);
  const [assignedDriverId, setAssignedDriverId] = useState(order.deliveryDriverId || '');

  const deliveryDrivers = users.filter((u) => u.role === 'Delivery Driver' || u.role === 'Orders Employee');

  const handleConfirm = () => {
    confirmOrder(order.id);
  };

  const handleReject = () => {
    if (!rejectReason.trim()) {
      setToast('يرجى ذكر سبب الرفض أو الإلغاء', 'error');
      return;
    }
    cancelOrder(order.id, rejectReason);
    setShowRejectForm(false);
  };

  const handleDriverAssignment = (driverId: string) => {
    setAssignedDriverId(driverId);
    const driver = users.find((u) => u.id === driverId);
    updateOrder(order.id, {
      deliveryDriverId: driverId,
      deliveryDriverName: driver?.name,
    });
    setToast(`تم تعيين السائق ${driver?.name} للطلب ${order.orderNumber}`);
  };

  const statusBadgeColor = (status: OrderStatus) => {
    switch (status) {
      case 'new':
        return 'bg-blue-600/20 text-blue-400 border-blue-500/30';
      case 'confirmed':
        return 'bg-amber-600/20 text-amber-400 border-amber-500/30';
      case 'processing':
        return 'bg-purple-600/20 text-purple-400 border-purple-500/30';
      case 'out_for_delivery':
        return 'bg-cyan-600/20 text-cyan-400 border-cyan-500/30';
      case 'delivered':
        return 'bg-emerald-600/20 text-emerald-400 border-emerald-500/30';
      case 'cancelled':
        return 'bg-red-600/20 text-red-400 border-red-500/30';
      default:
        return 'bg-slate-800 text-slate-300';
    }
  };

  const statusLabel = (status: OrderStatus) => {
    switch (status) {
      case 'new':
        return 'طلب جديد ⚡';
      case 'confirmed':
        return 'مؤكد ومحجوز 🛒';
      case 'processing':
        return 'قيد التجهيز 📦';
      case 'out_for_delivery':
        return 'خرج للتوصيل 🚚';
      case 'delivered':
        return 'تم التسليم 🏁';
      case 'cancelled':
        return 'ملغى ❌';
      default:
        return status;
    }
  };

  return (
    <div className="space-y-4 text-xs">
      {/* Top Header Card */}
      <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black text-slate-100">{order.orderNumber}</h3>
            <span className="text-[10px] text-slate-400">
              تاريخ الطلب: {new Date(order.createdAt).toLocaleString('ar-JO')}
            </span>
          </div>
          <span className={`px-2.5 py-1 rounded-full font-bold text-[10px] border ${statusBadgeColor(order.status)}`}>
            {statusLabel(order.status)}
          </span>
        </div>

        {/* Customer Header Info */}
        <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800 flex items-center justify-between">
          <div>
            <strong className="text-slate-200 font-bold text-xs">{order.customerName}</strong>
            <span className="text-emerald-400 font-bold text-[10px] font-mono block">{order.customerPhone}</span>
          </div>
          <div className="flex gap-1.5">
            <a
              href={`tel:${order.customerPhone}`}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1.5 rounded-lg font-bold flex items-center justify-center gap-1 transition"
            >
              <Phone className="w-3.5 h-3.5" />
              <span>اتصال</span>
            </a>
            <a
              href={`https://wa.me/962${order.customerPhone.replace(/^0/, '')}`}
              target="_blank"
              rel="noreferrer"
              className="bg-green-700 hover:bg-green-600 text-white px-2.5 py-1.5 rounded-lg font-bold flex items-center justify-center gap-1 transition"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>واتساب</span>
            </a>
          </div>
        </div>
      </div>

      {/* Customer Location & Address Card */}
      <CustomerLocationCard
        order={order}
        onEditAddress={() => setShowEditAddress(true)}
      />

      {/* Items Breakdown Table */}
      <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 space-y-2">
        <h4 className="font-bold text-slate-300 text-xs">تفاصيل العناصر والمنتجات المطلوبة</h4>
        <div className="space-y-1.5">
          {(order.items || []).map((item) => (
            <div key={item.id} className="bg-slate-900 p-2 rounded-xl border border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <img src={item.productImage} alt="" className="w-8 h-8 rounded-lg object-cover border border-slate-800" />
                <div>
                  <h5 className="font-bold text-slate-200 text-xs">{item.productName}</h5>
                  <span className="text-[10px] text-slate-400">
                    الكمية: {item.quantity} {item.unit} × {item.unitPrice.toFixed(2)} {CURRENCY}
                  </span>
                </div>
              </div>
              <strong className="text-slate-100 font-extrabold text-xs">
                {item.totalPrice.toFixed(2)} {CURRENCY}
              </strong>
            </div>
          ))}
        </div>

        {/* Pricing Summary Footer */}
        <div className="pt-2 border-t border-slate-800 space-y-1 text-[11px]">
          <div className="flex justify-between text-slate-400">
            <span>المجموع الفرعي:</span>
            <span>{order.subtotal.toFixed(2)} {CURRENCY}</span>
          </div>
          {order.discount > 0 && (
            <div className="flex justify-between text-emerald-400">
              <span>الخصم الممنوح:</span>
              <span>-{order.discount.toFixed(2)} {CURRENCY}</span>
            </div>
          )}
          <div className="flex justify-between text-slate-400">
            <span>أجرة التوصيل:</span>
            <span>{order.deliveryFee.toFixed(2)} {CURRENCY}</span>
          </div>
          <div className="flex justify-between text-slate-100 font-extrabold text-xs pt-1 border-t border-slate-800">
            <span>إجمالي الطلب المستحق:</span>
            <span className="text-blue-400">{order.totalAmount.toFixed(2)} {CURRENCY}</span>
          </div>
        </div>
      </div>

      {/* Driver Assignment */}
      <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 space-y-1.5">
        <label className="text-[11px] font-bold text-slate-300 block flex items-center gap-1">
          <Truck className="w-3.5 h-3.5 text-cyan-400" />
          <span>تعيين سائق التوصيل:</span>
        </label>
        <select
          value={assignedDriverId}
          onChange={(e) => handleDriverAssignment(e.target.value)}
          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-200 focus:outline-none"
        >
          <option value="">اختر سائق توصيل...</option>
          {deliveryDrivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.phone})
            </option>
          ))}
        </select>
      </div>

      {/* Primary Action Workflow Controls */}
      <div className="space-y-2 pt-1">
        {order.status === 'new' && (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleConfirm}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-600/20 active:scale-95"
            >
              <CheckCircle className="w-4 h-4" />
              <span>قبول الطلب وحجز المخزون</span>
            </button>

            <button
              onClick={() => setShowRejectForm(true)}
              className="bg-red-950/60 border border-red-800 hover:bg-red-900 text-red-400 font-bold py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-1.5 active:scale-95"
            >
              <XCircle className="w-4 h-4" />
              <span>رفض الطلب</span>
            </button>
          </div>
        )}

        {/* State Advancement */}
        {order.status === 'confirmed' && (
          <button
            onClick={() => advanceOrderStatus(order.id, 'processing')}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-1.5"
          >
            <PackageCheck className="w-4 h-4" />
            <span>بدء التجهيز والمستودع ← (قيد التجهيز)</span>
          </button>
        )}

        {order.status === 'processing' && (
          <button
            onClick={() => advanceOrderStatus(order.id, 'out_for_delivery')}
            className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-1.5"
          >
            <Truck className="w-4 h-4" />
            <span>تسليم الطلب للسائق ← (خرج للتوصيل)</span>
          </button>
        )}

        {order.status === 'out_for_delivery' && (
          <button
            onClick={() => advanceOrderStatus(order.id, 'delivered')}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-1.5"
          >
            <CheckCircle className="w-4 h-4" />
            <span>تأكيد الاستلام والتحصيل ← (تم التسليم)</span>
          </button>
        )}

        {/* Reject Form popup inside modal */}
        {showRejectForm && (
          <div className="bg-red-950/90 border border-red-800 p-3 rounded-2xl space-y-2 animate-fadeIn">
            <label className="text-red-200 font-bold block text-[11px]">سبب رفض/إلغاء الطلب:</label>
            <input
              type="text"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="مثال: عدم توفر كمية بالرف، الزبون ألغى الطلب..."
              className="w-full bg-slate-900 border border-red-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                onClick={handleReject}
                className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2 rounded-xl text-xs transition"
              >
                تأكيد الرفض والإلغاء
              </button>
              <button
                onClick={() => setShowRejectForm(false)}
                className="px-4 bg-slate-800 text-slate-300 font-bold py-2 rounded-xl text-xs transition"
              >
                إلغاء
              </button>
            </div>
          </div>
        )}
        {/* Edit Address Modal */}
        {showEditAddress && (
          <EditAddressModal order={order} onClose={() => setShowEditAddress(false)} />
        )}
      </div>
    </div>
  );
};
