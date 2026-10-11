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
  new: { label: 'جديد', bg: 'bg-nw-info-bg', text: 'text-nw-info border-nw-info/30' },
  confirmed: { label: 'مؤكد', bg: 'bg-nw-warn-bg', text: 'text-nw-warn border-nw-warn/30' },
  processing: { label: 'تجهيز', bg: 'bg-nw-info-bg', text: 'text-nw-info border-nw-info/30' },
  out_for_delivery: { label: 'توصيل', bg: 'bg-nw-info-bg', text: 'text-nw-info border-nw-info/30' },
  completed: { label: 'مكتمل', bg: 'bg-nw-ok-bg', text: 'text-nw-ok border-nw-ok/30' },
  delivered: { label: 'مكتمل', bg: 'bg-nw-ok-bg', text: 'text-nw-ok border-nw-ok/30' },
  cancelled: { label: 'ملغي', bg: 'bg-nw-bad-bg', text: 'text-nw-bad border-nw-bad/30' },
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
      <div className="bg-nw-surface border border-nw-border p-4 rounded-2xl shadow-md space-y-3">
        <div className="flex items-center justify-between border-b border-nw-border pb-2">
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-nw-info" />
            <h3 className="text-xs font-bold text-nw-text">أحدث الطلبات (Latest Orders)</h3>
          </div>
          <button
            onClick={onNavigateToOrders}
            className="text-[10px] font-semibold text-nw-info hover:underline flex items-center gap-0.5"
          >
            <span>جميع الطلبات</span>
            <ChevronLeft className="w-3 h-3" />
          </button>
        </div>

        <div className="space-y-2">
          {latestOrders.length === 0 ? (
            <div className="text-center py-6 text-nw-muted text-xs">لا توجد طلبات حديثة</div>
          ) : (
            latestOrders.slice(0, 5).map((o) => {
              const badge = STATUS_BADGE_MAP[o.status] || STATUS_BADGE_MAP.new;
              return (
                <div
                  key={o.id}
                  onClick={() => onViewOrderDetails?.(o.id)}
                  className="flex items-center justify-between bg-nw-bg p-2.5 rounded-xl border border-nw-border hover:border-nw-border transition cursor-pointer"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-nw-text text-xs">#{o.orderNumber}</span>
                      <span
                        className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${badge.bg} ${badge.text}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <span className="text-[10px] text-nw-muted block mt-0.5">{o.customerName}</span>
                  </div>
                  <div className="text-left">
                    <span className="font-extrabold text-nw-ok text-xs block">
                      {o.totalAmount.toFixed(3)} {CURRENCY}
                    </span>
                    <span className="text-[9px] text-nw-muted flex items-center gap-0.5">
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
      <div className="bg-nw-surface border border-nw-border p-4 rounded-2xl shadow-md space-y-3">
        <div className="flex items-center justify-between border-b border-nw-border pb-2">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-nw-info" />
            <h3 className="text-xs font-bold text-nw-text">أحدث العملاء (Latest Customers)</h3>
          </div>
          <button
            onClick={onNavigateToCustomers}
            className="text-[10px] font-semibold text-nw-info hover:underline flex items-center gap-0.5"
          >
            <span>دليل العملاء</span>
            <ChevronLeft className="w-3 h-3" />
          </button>
        </div>

        <div className="space-y-2">
          {latestCustomers.length === 0 ? (
            <div className="text-center py-6 text-nw-muted text-xs">لا يوجد عملاء مضافون حديثاً</div>
          ) : (
            latestCustomers.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between bg-nw-bg p-2.5 rounded-xl border border-nw-border"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-nw-info-bg text-nw-info font-bold flex items-center justify-center text-xs">
                    {c.fullName.charAt(0)}
                  </div>
                  <div>
                    <h4 className="font-bold text-nw-text text-xs">{c.fullName}</h4>
                    <span className="text-[10px] text-nw-muted">{c.phone || 'بدون هاتف'}</span>
                  </div>
                </div>
                <span className="text-[10px] bg-nw-surface-2 text-nw-text px-2 py-0.5 rounded-md font-semibold">
                  {c.governorate}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Widget 3: Low Stock Alerts */}
      <div className="bg-nw-surface border border-nw-border p-4 rounded-2xl shadow-md space-y-3">
        <div className="flex items-center justify-between border-b border-nw-border pb-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-nw-warn" />
            <h3 className="text-xs font-bold text-nw-text">تنبيهات نواقص المخزون</h3>
          </div>
          <button
            onClick={onNavigateToProducts}
            className="text-[10px] font-semibold text-nw-warn hover:underline flex items-center gap-0.5"
          >
            <span>المخزون</span>
            <ChevronLeft className="w-3 h-3" />
          </button>
        </div>

        <div className="space-y-2 max-h-64 overflow-y-auto pr-0.5">
          {lowStockAlerts.length === 0 ? (
            <div className="text-center py-6 text-nw-ok text-xs font-semibold flex items-center justify-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              <span>المخزون بوضع ممتاز ولا توجد نواقص</span>
            </div>
          ) : (
            lowStockAlerts.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between bg-nw-bg p-2.5 rounded-xl border border-nw-warn/40 text-xs"
              >
                <div>
                  <h4 className="font-bold text-nw-text">{p.nameAr}</h4>
                  <div className="flex items-center gap-2 text-[10px] mt-0.5">
                    <span className={p.isOutOfStock ? 'text-nw-bad font-extrabold' : 'text-nw-warn font-bold'}>
                      {p.isOutOfStock ? 'منتهي بالمخزن (0)' : `متبقي: ${p.availableQuantity} ${p.unit}`}
                    </span>
                    <span className="text-nw-muted">•</span>
                    <span className="text-nw-muted">حد الطلب: {p.reorderLevel}</span>
                  </div>
                </div>
                <button
                  onClick={() => onReceiveStock?.(p.id)}
                  className="bg-nw-warn-bg hover:bg-nw-warn-bg text-nw-warn text-[10px] font-bold px-2.5 py-1.5 rounded-lg border border-nw-warn/30 flex items-center gap-1 transition"
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
      <div className="bg-nw-surface border border-nw-border p-4 rounded-2xl shadow-md space-y-3">
        <div className="flex items-center justify-between border-b border-nw-border pb-2">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-nw-info" />
            <h3 className="text-xs font-bold text-nw-text">حركات المخزون الأخيرة</h3>
          </div>
        </div>

        <div className="space-y-2">
          {recentInventoryMovements.length === 0 ? (
            <div className="text-center py-6 text-nw-muted text-xs">لا توجد حركات مخزنية مسجلة</div>
          ) : (
            recentInventoryMovements.slice(0, 5).map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between bg-nw-bg p-2.5 rounded-xl border border-nw-border text-xs"
              >
                <div>
                  <h4 className="font-bold text-nw-text">{m.productName}</h4>
                  <span className="text-[10px] text-nw-muted block">{m.transactionType}</span>
                </div>
                <div className="text-left">
                  <span
                    className={`font-extrabold text-xs block ${
                      m.quantity > 0 ? 'text-nw-ok' : 'text-nw-bad'
                    }`}
                  >
                    {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                  </span>
                  <span className="text-[9px] text-nw-muted">
                    {new Date(m.createdAt).toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Widget 5: Today's Notifications & Audit Trail */}
      <div className="bg-nw-surface border border-nw-border p-4 rounded-2xl shadow-md space-y-3 lg:col-span-2">
        <div className="flex items-center justify-between border-b border-nw-border pb-2">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-nw-ok" />
            <h3 className="text-xs font-bold text-nw-text">إشعارات وسجلات عمليات اليوم</h3>
          </div>
        </div>

        <div className="space-y-2 max-h-60 overflow-y-auto pr-0.5">
          {todayNotifications.length === 0 ? (
            <div className="text-center py-6 text-nw-muted text-xs">لا توجد إشعارات مسجلة اليوم</div>
          ) : (
            todayNotifications.map((n) => (
              <div
                key={n.id}
                className="flex items-start justify-between bg-nw-bg p-2.5 rounded-xl border border-nw-border text-xs gap-2"
              >
                <div>
                  <h4 className="font-bold text-nw-ok">{n.action}</h4>
                  <p className="text-[11px] text-nw-text mt-0.5">{n.details}</p>
                </div>
                <span className="text-[9px] text-nw-muted whitespace-nowrap shrink-0">
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
