/**
 * Nawasrah Business Manager - Executive Dashboard Charts Section
 * Renders 6 real-time interactive charts with Recharts
 */

import React from 'react';
import {
  DailySalesPoint,
  MonthlyRevenuePoint,
  OrderStatusBreakdown,
  TopProductItem,
  SalesByEntityItem,
} from '../../types/dashboard';
import { CURRENCY } from '../../constants';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  TrendingUp,
  BarChart2,
  PieChart as PieIcon,
  ShoppingBag,
  Warehouse,
  Building,
} from 'lucide-react';

interface ChartsSectionProps {
  dailySales30d: DailySalesPoint[];
  monthlyRevenue: MonthlyRevenuePoint[];
  ordersByStatus: OrderStatusBreakdown[];
  topSellingProducts: TopProductItem[];
  salesByWarehouse: SalesByEntityItem[];
  salesByBranch: SalesByEntityItem[];
}

export const ChartsSection: React.FC<ChartsSectionProps> = ({
  dailySales30d,
  monthlyRevenue,
  ordersByStatus,
  topSellingProducts,
  salesByWarehouse,
  salesByBranch,
}) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {/* Chart 1: Daily Sales (Last 30 Days) */}
      <div className="bg-nw-surface border border-nw-border p-4 rounded-2xl shadow-md space-y-3">
        <div className="flex items-center justify-between border-b border-nw-border pb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-nw-info-bg text-nw-info flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-nw-text">المبيعات اليومية (آخر 30 يوم)</h3>
              <p className="text-[10px] text-nw-muted">تتبع حجم الإيراد اليومي المباشر</p>
            </div>
          </div>
          <span className="text-[10px] font-bold bg-nw-info-bg text-nw-info border border-nw-info px-2 py-0.5 rounded-full">
            30 يوماً
          </span>
        </div>

        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dailySales30d} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--nw-info)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--nw-info)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="formattedDate" stroke="var(--nw-muted)" fontSize={9} tickLine={false} />
              <YAxis stroke="var(--nw-muted)" fontSize={9} tickLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--nw-surface)',
                  borderColor: 'var(--nw-border)',
                  borderRadius: '12px',
                  fontSize: '11px',
                  color: 'var(--nw-text)',
                }}
                formatter={(val: any) => [`${Number(val).toFixed(3)} ${CURRENCY}`, 'المبيعات']}
              />
              <Area
                type="monotone"
                dataKey="sales"
                stroke="var(--nw-info)"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#salesGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Chart 2: Monthly Revenue */}
      <div className="bg-nw-surface border border-nw-border p-4 rounded-2xl shadow-md space-y-3">
        <div className="flex items-center justify-between border-b border-nw-border pb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-nw-ok-bg text-nw-ok flex items-center justify-center">
              <BarChart2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-nw-text">الإيراد الشهري (Monthly Revenue)</h3>
              <p className="text-[10px] text-nw-muted">مقارنة الإيرادات على مدار 12 شهراً</p>
            </div>
          </div>
          <span className="text-[10px] font-bold bg-nw-ok-bg text-nw-ok border border-nw-ok px-2 py-0.5 rounded-full">
            سنوي
          </span>
        </div>

        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyRevenue} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
              <XAxis dataKey="month" stroke="var(--nw-muted)" fontSize={9} tickLine={false} />
              <YAxis stroke="var(--nw-muted)" fontSize={9} tickLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--nw-surface)',
                  borderColor: 'var(--nw-border)',
                  borderRadius: '12px',
                  fontSize: '11px',
                  color: 'var(--nw-text)',
                }}
                formatter={(val: any) => [`${Number(val).toFixed(3)} ${CURRENCY}`, 'الإيراد الشهري']}
              />
              <Bar dataKey="revenue" fill="var(--nw-ok)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Chart 3: Orders by Status */}
      <div className="bg-nw-surface border border-nw-border p-4 rounded-2xl shadow-md space-y-3">
        <div className="flex items-center justify-between border-b border-nw-border pb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-nw-info-bg text-nw-info flex items-center justify-center">
              <PieIcon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-nw-text">توزيع الطلبات حسب الحالة</h3>
              <p className="text-[10px] text-nw-muted">الطلبات الجديدة والجاهزة والتوصيل والملغاة</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 items-center gap-2">
          <div className="h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={ordersByStatus}
                  dataKey="count"
                  nameKey="statusAr"
                  cx="50%"
                  cy="50%"
                  innerRadius={35}
                  outerRadius={55}
                  paddingAngle={3}
                >
                  {ordersByStatus.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--nw-surface)',
                    borderColor: 'var(--nw-border)',
                    borderRadius: '12px',
                    fontSize: '11px',
                    color: 'var(--nw-text)',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-1.5 text-[11px]">
            {ordersByStatus.map((st) => (
              <div key={st.status} className="flex items-center justify-between font-semibold">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: st.color }} />
                  <span className="text-nw-text">{st.statusAr}</span>
                </div>
                <span className="font-bold text-nw-text">{st.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Chart 4: Top Selling Products */}
      <div className="bg-nw-surface border border-nw-border p-4 rounded-2xl shadow-md space-y-3">
        <div className="flex items-center justify-between border-b border-nw-border pb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-nw-warn-bg text-nw-warn flex items-center justify-center">
              <ShoppingBag className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-nw-text">الأصناف الأكثر مبيعاً (Top Selling)</h3>
              <p className="text-[10px] text-nw-muted">أعلى المنتجات تحقيقاً للإيراد</p>
            </div>
          </div>
        </div>

        <div className="space-y-2 text-xs">
          {topSellingProducts.length === 0 ? (
            <div className="text-center py-8 text-nw-muted text-xs">لا توجد مبيعات مسجلة حتى الآن</div>
          ) : (
            topSellingProducts.map((p, idx) => (
              <div
                key={p.id}
                className="flex items-center justify-between bg-nw-bg p-2 rounded-xl border border-nw-border"
              >
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-nw-surface-2 text-nw-text flex items-center justify-center text-[10px] font-bold">
                    {idx + 1}
                  </span>
                  <div>
                    <h4 className="font-bold text-nw-text">{p.nameAr}</h4>
                    <span className="text-[9px] text-nw-muted font-mono">رمز الصنف: {p.sku}</span>
                  </div>
                </div>
                <div className="text-left">
                  <span className="font-extrabold text-nw-warn block">
                    {p.totalRevenue.toFixed(3)} {CURRENCY}
                  </span>
                  <span className="text-[9px] text-nw-muted">{p.totalQuantity} قطعة مباعة</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Chart 5: Sales by Warehouse */}
      <div className="bg-nw-surface border border-nw-border p-4 rounded-2xl shadow-md space-y-3">
        <div className="flex items-center justify-between border-b border-nw-border pb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-nw-info-bg text-nw-info flex items-center justify-center">
              <Warehouse className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-nw-text">المبيعات حسب المستودع (By Warehouse)</h3>
              <p className="text-[10px] text-nw-muted">توزيع حركة التوريد والمبيعات للمستودعات</p>
            </div>
          </div>
        </div>

        <div className="space-y-2.5">
          {salesByWarehouse.map((wh) => (
            <div key={wh.id} className="space-y-1 text-xs">
              <div className="flex items-center justify-between font-bold">
                <span className="text-nw-text">{wh.nameAr}</span>
                <span className="text-nw-info">
                  {wh.sales.toFixed(3)} {CURRENCY} ({wh.ordersCount} طلب)
                </span>
              </div>
              <div className="w-full h-2 bg-nw-bg rounded-full overflow-hidden border border-nw-border">
                <div
                  className="h-full bg-nw-primary rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, wh.percentage || 50)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Chart 6: Sales by Branch */}
      <div className="bg-nw-surface border border-nw-border p-4 rounded-2xl shadow-md space-y-3">
        <div className="flex items-center justify-between border-b border-nw-border pb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-nw-info-bg text-nw-info flex items-center justify-center">
              <Building className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-nw-text">المبيعات حسب الفرع (By Branch)</h3>
              <p className="text-[10px] text-nw-muted">أداء الفروع ونقاط البيع الميدانية</p>
            </div>
          </div>
        </div>

        <div className="space-y-2.5">
          {salesByBranch.map((br) => (
            <div key={br.id} className="space-y-1 text-xs">
              <div className="flex items-center justify-between font-bold">
                <span className="text-nw-text">{br.nameAr}</span>
                <span className="text-nw-info">
                  {br.sales.toFixed(3)} {CURRENCY} ({br.ordersCount} طلب)
                </span>
              </div>
              <div className="w-full h-2 bg-nw-bg rounded-full overflow-hidden border border-nw-border">
                <div
                  className="h-full bg-nw-primary rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, br.percentage || 50)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
