/**
 * Nawasrah Business Manager - Orders Center View (Real Supabase Connected)
 */

import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { Order, OrderStatus } from '../../types';
import {
  ShoppingBag,
  Search,
  RotateCw,
  CheckCircle2,
  XCircle,
  Clock,
  Truck,
  MapPin,
  Phone,
  MessageSquare,
  AlertTriangle,
  PackageCheck,
  CheckCircle,
} from 'lucide-react';
import { CURRENCY } from '../../constants';
import { OrderDetailModal } from './OrderDetailModal';
import { subscribeToOrdersInSupabase } from '../../services/supabase/orders.service';

export const OrdersCenterView: React.FC = () => {
  const {
    orders,
    confirmOrder,
    cancelOrder,
    refreshOrdersFromSupabase,
    setToast,
  } = useAppStore();

  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Initial fetch and Realtime subscription
  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    refreshOrdersFromSupabase()
      .catch((err) => {
        if (isMounted) setErrorMessage(err?.message || 'فشل تحميل الطلبات');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    // Supabase Realtime listener for incoming orders & state updates
    const unsubscribe = subscribeToOrdersInSupabase((payload) => {
      if (!isMounted) return;
      if (payload.eventType === 'INSERT') {
        setToast('⚡ وصل طلب جديد للمتجر الإلكتروني!', 'success');
      } else if (payload.eventType === 'UPDATE') {
        setToast('🔄 تم تحديث حالة إحدى الطلبات في القاعدة', 'info');
      }
      refreshOrdersFromSupabase();
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    setErrorMessage(null);
    try {
      await refreshOrdersFromSupabase();
      setToast('تم تحديث قائمة الطلبات بنجاح');
    } catch (err: any) {
      setErrorMessage(err?.message || 'فشل تجديد البيانات');
    } finally {
      setIsRefreshing(false);
    }
  };

  const filteredOrders = orders.filter((ord) => {
    const matchesFilter =
      activeFilter === 'all'
        ? true
        : activeFilter === 'processing'
        ? ord.status === 'preparing' || ord.status === 'processing'
        : activeFilter === 'delivered'
        ? ord.status === 'completed' || ord.status === 'delivered'
        : ord.status === activeFilter;

    const matchesQuery =
      ord.orderNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ord.customerName.includes(searchQuery) ||
      ord.customerPhone.includes(searchQuery);

    return matchesFilter && matchesQuery;
  });

  const getStatusBadge = (status: OrderStatus | string) => {
    switch (status) {
      case 'new':
        return { label: 'جديد ⚡', color: 'bg-red-500/20 text-red-400 border-red-500/30' };
      case 'confirmed':
        return { label: 'مؤكد ومحجوز 🛒', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' };
      case 'preparing':
      case 'processing':
        return { label: 'قيد التجهيز 📦', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' };
      case 'ready':
        return { label: 'جاهز للتوصيل 🏁', color: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' };
      case 'out_for_delivery':
        return { label: 'خرج مع المندوب 🚚', color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' };
      case 'completed':
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
            <span>مركز طلبات متجر النواصرة الحقيقي</span>
          </h2>
          <p className="text-[11px] text-slate-400">مربوط بشرطية Supabase وجداول العملاء مباشرة</p>
        </div>

        <button
          onClick={handleManualRefresh}
          disabled={isRefreshing}
          className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-50"
        >
          <RotateCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-blue-400' : ''}`} />
          <span>تحديث</span>
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
          { id: 'new', label: 'جديد ⚡' },
          { id: 'confirmed', label: 'مؤكد 🛒' },
          { id: 'preparing', label: 'قيد التجهيز 📦' },
          { id: 'ready', label: 'جاهز 🏁' },
          { id: 'out_for_delivery', label: 'خرج للتوصيل 🚚' },
          { id: 'delivered', label: 'مكتمل 🟢' },
          { id: 'cancelled', label: 'ملغي 🔴' },
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

      {/* Error state */}
      {errorMessage && (
        <div className="bg-red-950/60 border border-red-800 p-3.5 rounded-2xl flex items-center justify-between text-xs text-red-300">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={handleManualRefresh}
            className="bg-red-900 hover:bg-red-800 text-white px-2.5 py-1 rounded-lg text-[11px] font-bold"
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      {/* Orders List / Loading / Empty */}
      <div className="space-y-3">
        {loading ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 space-y-3">
            <RotateCw className="w-8 h-8 mx-auto animate-spin text-blue-500" />
            <p className="text-xs font-bold">جاري جلب الطلبات من قاعدة بيانات Supabase...</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-10 text-center text-slate-400 space-y-2">
            <ShoppingBag className="w-12 h-12 mx-auto text-slate-600 mb-1" />
            <h3 className="text-sm font-bold text-slate-300">لا توجد طلبات حقيقية في القائمة حالياً</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              عند إضافة الزبون لطلبات عبر المتجر الإلكتروني أو إنشاء طلب جديد عبر Supabase API ستظهر مباشرة هنا.
            </p>
          </div>
        ) : (
          filteredOrders.map((ord) => {
            const badge = getStatusBadge(ord.status);
            return (
              <div
                key={ord.id}
                onClick={() => setSelectedOrder(ord)}
                className="bg-slate-900 border border-slate-800 hover:border-slate-700 p-4 rounded-2xl shadow-md transition cursor-pointer active:scale-98 relative overflow-hidden space-y-2.5"
              >
                {ord.isNew && (
                  <span className="absolute top-0 right-0 bg-red-500 text-white text-[9px] font-extrabold px-2 py-0.5 rounded-bl-xl shadow">
                    جديد ⚡
                  </span>
                )}

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-black text-blue-400">{ord.orderNumber}</span>
                    <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${badge.color}`}>
                      {badge.label}
                    </span>
                    {ord.locationConfirmed ? (
                      <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        <span>موقع مؤكد</span>
                      </span>
                    ) : (
                      <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                        <MapPin className="w-2.5 h-2.5" />
                        <span>عنوان يدوي</span>
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 font-medium">
                    {new Date(ord.createdAt).toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <div>
                    <h4 className="font-bold text-slate-100">{ord.customerName}</h4>
                    <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                      <Phone className="w-3 h-3 text-emerald-400" />
                      <span>{ord.customerPhone}</span>
                      <span className="mx-1">•</span>
                      <span>{ord.governorate} - {ord.region}</span>
                    </p>
                  </div>
                  <div className="text-left">
                    <span className="text-sm font-black text-emerald-400 block">
                      {ord.totalAmount.toFixed(2)} {CURRENCY}
                    </span>
                    <span className="text-[10px] text-slate-400">{(ord.items || []).length} عناصر</span>
                  </div>
                </div>

                {/* Direct quick action bar inside card for pending orders */}
                {ord.status === 'new' && (
                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-end gap-2">
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

      {/* Selected Order Modal Sheet */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-md p-0 sm:p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] overflow-y-auto p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <span className="text-xs font-black text-blue-400">{selectedOrder.orderNumber}</span>
                <h3 className="text-sm font-bold text-slate-100">{selectedOrder.customerName}</h3>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center hover:bg-slate-700 hover:text-white"
              >
                ✕
              </button>
            </div>

            <OrderDetailModal
              order={orders.find((o) => o.id === selectedOrder.id) || selectedOrder}
              onClose={() => setSelectedOrder(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
};
