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
      <div className="bg-slate-900 border border-slate-800/80 p-4 rounded-2xl shadow-md space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-100">المبيعات اليومية (آخر 30 يوم)</h3>
              <p className="text-[10px] text-slate-400">تتبع حجم الإيراد اليومي المباشر</p>
            </div>
          </div>
          <span className="text-[10px] font-bold bg-blue-950 text-blue-400 border border-blue-800 px-2 py-0.5 rounded-full">
            30 يوماً
          </span>
        </div>

        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dailySales30d} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="formattedDate" stroke="#64748B" fontSize={9} tickLine={false} />
              <YAxis stroke="#64748B" fontSize={9} tickLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0F172A',
                  borderColor: '#334155',
                  borderRadius: '12px',
                  fontSize: '11px',
                  color: '#FFF',
                }}
                formatter={(val: any) => [`${Number(val).toFixed(2)} ${CURRENCY}`, 'المبيعات']}
              />
              <Area
                type="monotone"
                dataKey="sales"
                stroke="#3B82F6"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#salesGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Chart 2: Monthly Revenue */}
      <div className="bg-slate-900 border border-slate-800/80 p-4 rounded-2xl shadow-md space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
              <BarChart2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-100">الإيراد الشهري (Monthly Revenue)</h3>
              <p className="text-[10px] text-slate-400">مقارنة الإيرادات على مدار 12 شهراً</p>
            </div>
          </div>
          <span className="text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded-full">
            سنوي
          </span>
        </div>

        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyRevenue} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
              <XAxis dataKey="month" stroke="#64748B" fontSize={9} tickLine={false} />
              <YAxis stroke="#64748B" fontSize={9} tickLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0F172A',
                  borderColor: '#334155',
                  borderRadius: '12px',
                  fontSize: '11px',
                  color: '#FFF',
                }}
                formatter={(val: any) => [`${Number(val).toFixed(2)} ${CURRENCY}`, 'الإيراد الشهري']}
              />
              <Bar dataKey="revenue" fill="#10B981" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Chart 3: Orders by Status */}
      <div className="bg-slate-900 border border-slate-800/80 p-4 rounded-2xl shadow-md space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center">
              <PieIcon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-100">توزيع الطلبات حسب الحالة</h3>
              <p className="text-[10px] text-slate-400">الطلبات الجديدة والجاهزة والتوصيل والملغاة</p>
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
                    backgroundColor: '#0F172A',
                    borderColor: '#334155',
                    borderRadius: '12px',
                    fontSize: '11px',
                    color: '#FFF',
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
                  <span className="text-slate-300">{st.statusAr}</span>
                </div>
                <span className="font-bold text-slate-100">{st.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Chart 4: Top Selling Products */}
      <div className="bg-slate-900 border border-slate-800/80 p-4 rounded-2xl shadow-md space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
              <ShoppingBag className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-100">الأصناف الأكثر مبيعاً (Top Selling)</h3>
              <p className="text-[10px] text-slate-400">أعلى المنتجات تحقيقاً للإيراد</p>
            </div>
          </div>
        </div>

        <div className="space-y-2 text-xs">
          {topSellingProducts.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-xs">لا توجد مبيعات مسجلة حتى الآن</div>
          ) : (
            topSellingProducts.map((p, idx) => (
              <div
                key={p.id}
                className="flex items-center justify-between bg-slate-950 p-2 rounded-xl border border-slate-800/80"
              >
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center text-[10px] font-bold">
                    {idx + 1}
                  </span>
                  <div>
                    <h4 className="font-bold text-slate-200">{p.nameAr}</h4>
                    <span className="text-[9px] text-slate-400 font-mono">SKU: {p.sku}</span>
                  </div>
                </div>
                <div className="text-left">
                  <span className="font-extrabold text-amber-400 block">
                    {p.totalRevenue.toFixed(2)} {CURRENCY}
                  </span>
                  <span className="text-[9px] text-slate-400">{p.totalQuantity} قطعة مباعة</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Chart 5: Sales by Warehouse */}
      <div className="bg-slate-900 border border-slate-800/80 p-4 rounded-2xl shadow-md space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center">
              <Warehouse className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-100">المبيعات حسب المستودع (By Warehouse)</h3>
              <p className="text-[10px] text-slate-400">توزيع حركة التوريد والمبيعات للمستودعات</p>
            </div>
          </div>
        </div>

        <div className="space-y-2.5">
          {salesByWarehouse.map((wh) => (
            <div key={wh.id} className="space-y-1 text-xs">
              <div className="flex items-center justify-between font-bold">
                <span className="text-slate-300">{wh.nameAr}</span>
                <span className="text-cyan-400">
                  {wh.sales.toFixed(2)} {CURRENCY} ({wh.ordersCount} طلب)
                </span>
              </div>
              <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                <div
                  className="h-full bg-cyan-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, wh.percentage || 50)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Chart 6: Sales by Branch */}
      <div className="bg-slate-900 border border-slate-800/80 p-4 rounded-2xl shadow-md space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
              <Building className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-100">المبيعات حسب الفرع (By Branch)</h3>
              <p className="text-[10px] text-slate-400">أداء الفروع ونقاط البيع الميدانية</p>
            </div>
          </div>
        </div>

        <div className="space-y-2.5">
          {salesByBranch.map((br) => (
            <div key={br.id} className="space-y-1 text-xs">
              <div className="flex items-center justify-between font-bold">
                <span className="text-slate-300">{br.nameAr}</span>
                <span className="text-indigo-400">
                  {br.sales.toFixed(2)} {CURRENCY} ({br.ordersCount} طلب)
                </span>
              </div>
              <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-500"
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
