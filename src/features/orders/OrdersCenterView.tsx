/**
 * Nawasrah Business Manager - Orders Center View
 */

import React, { useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { Order, OrderStatus } from '../../types';
import {
  ShoppingBag,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  Truck,
  MapPin,
  Phone,
  MessageSquare,
  Share2,
  FileText,
  AlertCircle,
  ExternalLink,
  ChevronLeft,
  Calendar,
  Navigation,
  AlertTriangle,
} from 'lucide-react';
import { CURRENCY } from '../../constants';
import { CustomerLocationCard } from './CustomerLocationCard';
import { EditAddressModal } from './EditAddressModal';

export const OrdersCenterView: React.FC = () => {
  const {
    orders,
    confirmOrder,
    cancelOrder,
    advanceOrderStatus,
    openModal,
    simulateNewIncomingWebsiteOrder,
  } = useAppStore();

  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showEditAddress, setShowEditAddress] = useState<boolean>(false);

  // Keep selected order synced with store
  const activeOrder = selectedOrder ? orders.find((o) => o.id === selectedOrder.id) || selectedOrder : null;

  const filteredOrders = orders.filter((ord) => {
    const matchesFilter = activeFilter === 'all' ? true : ord.status === activeFilter;
    const matchesQuery =
      ord.orderNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ord.customerName.includes(searchQuery) ||
      ord.customerPhone.includes(searchQuery);
    return matchesFilter && matchesQuery;
  });

  const getStatusBadge = (status: OrderStatus) => {
    switch (status) {
      case 'new':
        return { label: 'جديد ⚡', color: 'bg-red-500/20 text-red-400 border-red-500/30' };
      case 'confirmed':
        return { label: 'مؤكد ومحجوز', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' };
      case 'processing':
        return { label: 'قيد التجهيز', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' };
      case 'out_for_delivery':
        return { label: 'خرج مع المندوب', color: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' };
      case 'delivered':
        return { label: 'تم التسليم 🟢', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' };
      case 'cancelled':
        return { label: 'ملغي 🔴', color: 'bg-slate-700/50 text-slate-400 border-slate-600' };
      default:
        return { label: status, color: 'bg-slate-800 text-slate-300' };
    }
  };

  return (
    <div className="p-4 space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-black text-slate-100 flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-blue-400" />
            <span>مركز طلبات موقع الزبائن</span>
          </h2>
          <p className="text-[11px] text-slate-400">إدارة الطلبات القادمة من المتجر والأونلاين</p>
        </div>
        <button
          onClick={simulateNewIncomingWebsiteOrder}
          className="bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1"
        >
          <span>+ محاكاة طلب</span>
        </button>
      </div>

      {/* Search Input */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="ابحث برقم الطلب، اسم العميل، أو رقم الهاتف..."
          className="w-full bg-slate-900 border border-slate-800 rounded-2xl pr-9 pl-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
        />
      </div>

      {/* Filter Tabs Horizontal Scroll */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar text-xs font-bold">
        {[
          { id: 'all', label: 'الكل' },
          { id: 'new', label: 'جديد' },
          { id: 'confirmed', label: 'مؤكد' },
          { id: 'processing', label: 'تجهيز' },
          { id: 'delivered', label: 'مكتمل' },
          { id: 'cancelled', label: 'ملغي' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveFilter(tab.id)}
            className={`px-3.5 py-2 rounded-xl shrink-0 transition border ${
              activeFilter === tab.id
                ? 'bg-blue-600 text-white border-blue-500 shadow-md'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Orders List */}
      <div className="space-y-3">
        {filteredOrders.length === 0 ? (
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-8 text-center text-slate-400">
            <ShoppingBag className="w-10 h-10 mx-auto text-slate-600 mb-2" />
            <p className="text-xs font-bold">لا توجد طلبات في القائمة حالياً</p>
          </div>
        ) : (
          filteredOrders.map((ord) => {
            const badge = getStatusBadge(ord.status);
            return (
              <div
                key={ord.id}
                onClick={() => setSelectedOrder(ord)}
                className="bg-slate-900 border border-slate-800 hover:border-slate-700 p-4 rounded-2xl shadow-md transition cursor-pointer active:scale-98 relative overflow-hidden"
              >
                {ord.isNew && (
                  <span className="absolute top-0 right-0 bg-red-500 text-white text-[9px] font-extrabold px-2 py-0.5 rounded-bl-xl shadow">
                    جديد ⚡
                  </span>
                )}

                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-black text-blue-400">{ord.orderNumber}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badge.color}`}>
                      {badge.label}
                    </span>
                    {/* Location Status Badge */}
                    {ord.locationConfirmed && (ord.latitude || ord.locationSource === 'gps') ? (
                      <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        <span>موقع مؤكد</span>
                      </span>
                    ) : ord.locationSource === 'manual' ? (
                      <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                        <MapPin className="w-2.5 h-2.5" />
                        <span>عنوان يدوي</span>
                      </span>
                    ) : (
                      <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center gap-1">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        <span>موقع ناقص</span>
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 font-medium">
                    {new Date(ord.createdAt).toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs my-2">
                  <div>
                    <h4 className="font-bold text-slate-100">{ord.customerName}</h4>
                    <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                      <MapPin className="w-3 h-3 text-slate-500" />
                      <span>{ord.governorate} - {ord.region}</span>
                    </p>
                  </div>
                  <div className="text-left">
                    <span className="text-sm font-black text-emerald-400 block">
                      {ord.totalAmount.toFixed(2)} {CURRENCY}
                    </span>
                    <span className="text-[10px] text-slate-400">{(ord.items || []).length} منتجات</span>
                  </div>
                </div>

                {/* Quick Actions inside Card */}
                {ord.status === 'new' && (
                  <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-end gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        cancelOrder(ord.id);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-red-950 hover:text-red-300 text-[11px] font-bold transition"
                    >
                      رفض
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        confirmOrder(ord.id);
                      }}
                      className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold transition shadow"
                    >
                      قبول وحجز المخزون
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Selected Order Detailed Modal Sheet */}
      {activeOrder && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 backdrop-blur-md p-0 sm:p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[90vh] overflow-y-auto p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <span className="text-xs font-black text-blue-400">{activeOrder.orderNumber}</span>
                <h3 className="text-sm font-bold text-slate-100">{activeOrder.customerName}</h3>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center hover:bg-slate-700 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Customer Location & Address Card */}
            <CustomerLocationCard
              order={activeOrder}
              onEditAddress={() => setShowEditAddress(true)}
            />

            {/* Order Items */}
            <h4 className="text-xs font-bold text-slate-200 mb-2">عناصر الطلب:</h4>
            <div className="space-y-2 mb-4">
              {(selectedOrder.items || []).map((item) => (
                <div key={item.id} className="flex items-center justify-between bg-slate-800/40 p-2.5 rounded-xl border border-slate-700/40 text-xs">
                  <div className="flex items-center gap-2.5">
                    <img src={item.productImage} alt={item.productName} className="w-9 h-9 rounded-lg object-cover border border-slate-700" />
                    <div>
                      <h5 className="font-bold text-slate-200">{item.productName}</h5>
                      <span className="text-[10px] text-slate-400">
                        {item.quantity} × {item.unitPrice.toFixed(2)} {CURRENCY}
                      </span>
                    </div>
                  </div>
                  <span className="font-extrabold text-slate-100">
                    {item.totalPrice.toFixed(2)} {CURRENCY}
                  </span>
                </div>
              ))}
            </div>

            {/* Totals Summary */}
            <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 space-y-1.5 text-xs mb-4">
              <div className="flex justify-between text-slate-400">
                <span>المجموع الفرعي:</span>
                <span>{selectedOrder.subtotal.toFixed(2)} {CURRENCY}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>رسوم التوصيل:</span>
                <span>{selectedOrder.deliveryFee.toFixed(2)} {CURRENCY}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>الخصم:</span>
                <span className="text-emerald-400">-{selectedOrder.discount.toFixed(2)} {CURRENCY}</span>
              </div>
              <div className="flex justify-between text-sm font-extrabold text-white border-t border-slate-800 pt-2">
                <span>الإجمالي النهائي:</span>
                <span className="text-emerald-400">{selectedOrder.totalAmount.toFixed(2)} {CURRENCY}</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-2">
              {activeOrder.status === 'new' && (
                <>
                  <button
                    onClick={() => {
                      confirmOrder(activeOrder.id);
                      setSelectedOrder(null);
                    }}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-2xl shadow transition text-xs"
                  >
                    تأكيد وحجز المخزون
                  </button>
                  <button
                    onClick={() => {
                      cancelOrder(activeOrder.id);
                      setSelectedOrder(null);
                    }}
                    className="bg-slate-800 hover:bg-red-950 text-red-300 font-bold py-3 rounded-2xl transition text-xs"
                  >
                    إلغاء الطلب
                  </button>
                </>
              )}

              {activeOrder.status === 'confirmed' && (
                <button
                  onClick={() => {
                    advanceOrderStatus(activeOrder.id, 'processing');
                    setSelectedOrder(null);
                  }}
                  className="col-span-2 bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-2xl shadow transition text-xs"
                >
                  بدء تجهيز الطلب بالكامل
                </button>
              )}

              {activeOrder.status === 'processing' && (
                <button
                  onClick={() => {
                    advanceOrderStatus(activeOrder.id, 'out_for_delivery');
                    setSelectedOrder(null);
                  }}
                  className="col-span-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-2xl shadow transition text-xs"
                >
                  تجهيز وتعيين المندوب للتوصيل
                </button>
              )}

              {activeOrder.status === 'out_for_delivery' && (
                <button
                  onClick={() => {
                    advanceOrderStatus(activeOrder.id, 'delivered');
                    setSelectedOrder(null);
                  }}
                  className="col-span-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-2xl shadow transition text-xs"
                >
                  تأكيد تسليم الطلب للعميل (إنشاء فاتورة)
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Address Modal */}
      {showEditAddress && activeOrder && (
        <EditAddressModal
          order={activeOrder}
          onClose={() => setShowEditAddress(false)}
        />
      )}
    </div>
  );
};
