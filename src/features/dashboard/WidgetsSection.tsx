/**
 * Nawasrah Business Manager - Executive Dashboard Widgets Section
 * Renders 5 live data widgets with direct quick triggers
 */

import React from 'react';
import {
  DashboardLatestOrder,
  DashboardLatestCustomer,
  DashboardLowStockAlert,
  DashboardInventoryMovement,
  DashboardNotificationItem,
} from '../../types/dashboard';
import { CURRENCY } from '../../constants';
import {
  ShoppingBag,
  Users,
  AlertTriangle,
  ArrowRightLeft,
  Bell,
  ChevronLeft,
  Plus,
  CheckCircle2,
  Clock,
} from 'lucide-react';

interface WidgetsSectionProps {
  latestOrders: DashboardLatestOrder[];
  latestCustomers: DashboardLatestCustomer[];
  lowStockAlerts: DashboardLowStockAlert[];
  recentInventoryMovements: DashboardInventoryMovement[];
  todayNotifications: DashboardNotificationItem[];
  onViewOrderDetails?: (orderId: string) => void;
  onReceiveStock?: (productId: string) => void;
  onNavigateToOrders?: () => void;
  onNavigateToProducts?: () => void;
  onNavigateToCustomers?: () => void;
}

const STATUS_BADGE_MAP: Record<string, { label: string; bg: string; text: string }> = {
  new: { label: 'جديد', bg: 'bg-blue-500/20', text: 'text-blue-300 border-blue-500/30' },
  confirmed: { label: 'مؤكد', bg: 'bg-amber-500/20', text: 'text-amber-300 border-amber-500/30' },
  processing: { label: 'تجهيز', bg: 'bg-purple-500/20', text: 'text-purple-300 border-purple-500/30' },
  out_for_delivery: { label: 'توصيل', bg: 'bg-cyan-500/20', text: 'text-cyan-300 border-cyan-500/30' },
  completed: { label: 'مكتمل', bg: 'bg-emerald-500/20', text: 'text-emerald-300 border-emerald-500/30' },
  delivered: { label: 'مكتمل', bg: 'bg-emerald-500/20', text: 'text-emerald-300 border-emerald-500/30' },
  cancelled: { label: 'ملغي', bg: 'bg-rose-500/20', text: 'text-rose-300 border-rose-500/30' },
};

export const WidgetsSection: React.FC<WidgetsSectionProps> = ({
  latestOrders,
  latestCustomers,
  lowStockAlerts,
  recentInventoryMovements,
  todayNotifications,
  onViewOrderDetails,
  onReceiveStock,
  onNavigateToOrders,
  onNavigateToProducts,
  onNavigateToCustomers,
}) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {/* Widget 1: Latest Orders */}
      <div className="bg-slate-900 border border-slate-800/80 p-4 rounded-2xl shadow-md space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-blue-400" />
            <h3 className="text-xs font-bold text-slate-100">أحدث الطلبات (Latest Orders)</h3>
          </div>
          <button
            onClick={onNavigateToOrders}
            className="text-[10px] font-semibold text-blue-400 hover:underline flex items-center gap-0.5"
          >
            <span>جميع الطلبات</span>
            <ChevronLeft className="w-3 h-3" />
          </button>
        </div>

        <div className="space-y-2">
          {latestOrders.length === 0 ? (
            <div className="text-center py-6 text-slate-500 text-xs">لا توجد طلبات حديثة</div>
          ) : (
            latestOrders.slice(0, 5).map((o) => {
              const badge = STATUS_BADGE_MAP[o.status] || STATUS_BADGE_MAP.new;
              return (
                <div
                  key={o.id}
                  onClick={() => onViewOrderDetails?.(o.id)}
                  className="flex items-center justify-between bg-slate-950 p-2.5 rounded-xl border border-slate-800/80 hover:border-slate-700 transition cursor-pointer"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-white text-xs">#{o.orderNumber}</span>
                      <span
                        className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${badge.bg} ${badge.text}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 block mt-0.5">{o.customerName}</span>
                  </div>
                  <div className="text-left">
                    <span className="font-extrabold text-emerald-400 text-xs block">
                      {o.totalAmount.toFixed(2)} {CURRENCY}
                    </span>
                    <span className="text-[9px] text-slate-500 flex items-center gap-0.5">
                      <Clock className="w-2.5 h-2.5" />
                      {new Date(o.createdAt).toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Widget 2: Latest Customers */}
      <div className="bg-slate-900 border border-slate-800/80 p-4 rounded-2xl shadow-md space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-bold text-slate-100">أحدث العملاء (Latest Customers)</h3>
          </div>
          <button
            onClick={onNavigateToCustomers}
            className="text-[10px] font-semibold text-cyan-400 hover:underline flex items-center gap-0.5"
          >
            <span>دليل العملاء</span>
            <ChevronLeft className="w-3 h-3" />
          </button>
        </div>

        <div className="space-y-2">
          {latestCustomers.length === 0 ? (
            <div className="text-center py-6 text-slate-500 text-xs">لا يوجد عملاء مضافون حديثاً</div>
          ) : (
            latestCustomers.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between bg-slate-950 p-2.5 rounded-xl border border-slate-800/80"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-cyan-500/20 text-cyan-300 font-bold flex items-center justify-center text-xs">
                    {c.fullName.charAt(0)}
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-200 text-xs">{c.fullName}</h4>
                    <span className="text-[10px] text-slate-400">{c.phone || 'بدون هاتف'}</span>
                  </div>
                </div>
                <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-md font-semibold">
                  {c.governorate}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Widget 3: Low Stock Alerts */}
      <div className="bg-slate-900 border border-slate-800/80 p-4 rounded-2xl shadow-md space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-bold text-slate-100">تنبيهات نواقص المخزون</h3>
          </div>
          <button
            onClick={onNavigateToProducts}
            className="text-[10px] font-semibold text-amber-400 hover:underline flex items-center gap-0.5"
          >
            <span>المخزون</span>
            <ChevronLeft className="w-3 h-3" />
          </button>
        </div>

        <div className="space-y-2 max-h-64 overflow-y-auto pr-0.5">
          {lowStockAlerts.length === 0 ? (
            <div className="text-center py-6 text-emerald-400 text-xs font-semibold flex items-center justify-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              <span>المخزون بوضع ممتاز ولا توجد نواقص</span>
            </div>
          ) : (
            lowStockAlerts.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between bg-slate-950 p-2.5 rounded-xl border border-amber-900/40 text-xs"
              >
                <div>
                  <h4 className="font-bold text-slate-200">{p.nameAr}</h4>
                  <div className="flex items-center gap-2 text-[10px] mt-0.5">
                    <span className={p.isOutOfStock ? 'text-rose-400 font-extrabold' : 'text-amber-400 font-bold'}>
                      {p.isOutOfStock ? 'منتهي بالمخزن (0)' : `متبقي: ${p.availableQuantity} ${p.unit}`}
                    </span>
                    <span className="text-slate-500">•</span>
                    <span className="text-slate-400">حد الطلب: {p.reorderLevel}</span>
                  </div>
                </div>
                <button
                  onClick={() => onReceiveStock?.(p.id)}
                  className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-[10px] font-bold px-2.5 py-1.5 rounded-lg border border-amber-500/30 flex items-center gap-1 transition"
                >
                  <Plus className="w-3 h-3" />
                  <span>تزويد</span>
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Widget 4: Recent Inventory Movements */}
      <div className="bg-slate-900 border border-slate-800/80 p-4 rounded-2xl shadow-md space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-purple-400" />
            <h3 className="text-xs font-bold text-slate-100">حركات المخزون الأخيرة</h3>
          </div>
        </div>

        <div className="space-y-2">
          {recentInventoryMovements.length === 0 ? (
            <div className="text-center py-6 text-slate-500 text-xs">لا توجد حركات مخزنية مسجلة</div>
          ) : (
            recentInventoryMovements.slice(0, 5).map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between bg-slate-950 p-2.5 rounded-xl border border-slate-800/80 text-xs"
              >
                <div>
                  <h4 className="font-bold text-slate-200">{m.productName}</h4>
                  <span className="text-[10px] text-slate-400 block">{m.transactionType}</span>
                </div>
                <div className="text-left">
                  <span
                    className={`font-extrabold text-xs block ${
                      m.quantity > 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                  </span>
                  <span className="text-[9px] text-slate-500">
                    {new Date(m.createdAt).toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Widget 5: Today's Notifications & Audit Trail */}
      <div className="bg-slate-900 border border-slate-800/80 p-4 rounded-2xl shadow-md space-y-3 lg:col-span-2">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-teal-400" />
            <h3 className="text-xs font-bold text-slate-100">إشعارات وسجلات عمليات اليوم</h3>
          </div>
        </div>

        <div className="space-y-2 max-h-60 overflow-y-auto pr-0.5">
          {todayNotifications.length === 0 ? (
            <div className="text-center py-6 text-slate-500 text-xs">لا توجد إشعارات مسجلة اليوم</div>
          ) : (
            todayNotifications.map((n) => (
              <div
                key={n.id}
                className="flex items-start justify-between bg-slate-950 p-2.5 rounded-xl border border-slate-800/80 text-xs gap-2"
              >
                <div>
                  <h4 className="font-bold text-teal-300">{n.action}</h4>
                  <p className="text-[11px] text-slate-300 mt-0.5">{n.details}</p>
                </div>
                <span className="text-[9px] text-slate-500 whitespace-nowrap shrink-0">
                  {new Date(n.createdAt).toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
