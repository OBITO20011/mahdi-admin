/**
 * Nawasrah Business Manager - Executive Dashboard KPI Cards
 * Displays 10 real-time enterprise metrics
 */

import React from 'react';
import { DashboardKpis } from '../../types/dashboard';
import { CURRENCY } from '../../constants';
import {
  TrendingUp,
  Calendar,
  DollarSign,
  PieChart,
  ShoppingBag,
  Users,
  Package,
  AlertTriangle,
  XCircle,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';

interface KpiCardsProps {
  kpis: DashboardKpis;
  onFilterLowStock?: () => void;
  onFilterOutOfStock?: () => void;
}

export const KpiCards: React.FC<KpiCardsProps> = ({
  kpis,
  onFilterLowStock,
  onFilterOutOfStock,
}) => {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
      {/* 1. Today's Sales */}
      <div className="bg-slate-900 border border-slate-800/80 p-3.5 rounded-2xl shadow-sm hover:border-slate-700 transition">
        <div className="flex items-center justify-between text-slate-400 mb-2">
          <span className="text-[11px] font-bold">مبيعات اليوم</span>
          <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
            <TrendingUp className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="text-base font-extrabold text-white">
          {kpis.todaySales.toLocaleString('ar-JO', { minimumFractionDigits: 2 })}
          <span className="text-[10px] font-normal text-slate-400 mr-1">{CURRENCY}</span>
        </div>
        <div
          className={`text-[10px] font-semibold mt-1 flex items-center gap-0.5 ${
            kpis.todaySalesChangePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'
          }`}
        >
          {kpis.todaySalesChangePercent >= 0 ? (
            <ArrowUpRight className="w-3 h-3" />
          ) : (
            <ArrowDownRight className="w-3 h-3" />
          )}
          <span>
            {kpis.todaySalesChangePercent >= 0 ? '+' : ''}
            {kpis.todaySalesChangePercent}% عن الأمس
          </span>
        </div>
      </div>

      {/* 2. This Week Sales */}
      <div className="bg-slate-900 border border-slate-800/80 p-3.5 rounded-2xl shadow-sm hover:border-slate-700 transition">
        <div className="flex items-center justify-between text-slate-400 mb-2">
          <span className="text-[11px] font-bold">مبيعات هذا الأسبوع</span>
          <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
            <Calendar className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="text-base font-extrabold text-white">
          {kpis.weekSales.toLocaleString('ar-JO', { minimumFractionDigits: 2 })}
          <span className="text-[10px] font-normal text-slate-400 mr-1">{CURRENCY}</span>
        </div>
        <div className="text-[10px] text-blue-400 font-semibold mt-1">حركة تراكمية أسبوعية</div>
      </div>

      {/* 3. This Month Sales */}
      <div className="bg-slate-900 border border-slate-800/80 p-3.5 rounded-2xl shadow-sm hover:border-slate-700 transition">
        <div className="flex items-center justify-between text-slate-400 mb-2">
          <span className="text-[11px] font-bold">مبيعات هذا الشهر</span>
          <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
            <DollarSign className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="text-base font-extrabold text-indigo-300">
          {kpis.monthSales.toLocaleString('ar-JO', { minimumFractionDigits: 2 })}
          <span className="text-[10px] font-normal text-slate-400 mr-1">{CURRENCY}</span>
        </div>
        <div className="text-[10px] text-indigo-400 font-semibold mt-1">إجمالي الشهر الحالي</div>
      </div>

      {/* 4. Total Revenue */}
      <div className="bg-slate-900 border border-slate-800/80 p-3.5 rounded-2xl shadow-sm hover:border-slate-700 transition">
        <div className="flex items-center justify-between text-slate-400 mb-2">
          <span className="text-[11px] font-bold">إجمالي الإيرادات</span>
          <div className="w-7 h-7 rounded-lg bg-teal-500/10 text-teal-400 flex items-center justify-center">
            <PieChart className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="text-base font-extrabold text-teal-300">
          {kpis.totalRevenue.toLocaleString('ar-JO', { minimumFractionDigits: 2 })}
          <span className="text-[10px] font-normal text-slate-400 mr-1">{CURRENCY}</span>
        </div>
        <div className="text-[10px] text-teal-400 font-semibold mt-1">كافة المبيعات الصافية</div>
      </div>

      {/* 5. Net Profit */}
      <div className="bg-slate-900 border border-slate-800/80 p-3.5 rounded-2xl shadow-sm hover:border-slate-700 transition">
        <div className="flex items-center justify-between text-slate-400 mb-2">
          <span className="text-[11px] font-bold">صافي الأرباح</span>
          <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
            <TrendingUp className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="text-base font-extrabold text-emerald-400">
          {kpis.netProfit.toLocaleString('ar-JO', { minimumFractionDigits: 2 })}
          <span className="text-[10px] font-normal text-slate-400 mr-1">{CURRENCY}</span>
        </div>
        <div className="text-[10px] text-emerald-300 font-semibold mt-1">
          هامش ~%{kpis.profitMarginPercent}
        </div>
      </div>

      {/* 6. Number of Orders Today */}
      <div className="bg-slate-900 border border-slate-800/80 p-3.5 rounded-2xl shadow-sm hover:border-slate-700 transition">
        <div className="flex items-center justify-between text-slate-400 mb-2">
          <span className="text-[11px] font-bold">عدد طلبات اليوم</span>
          <div className="w-7 h-7 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center">
            <ShoppingBag className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="text-base font-extrabold text-purple-300">
          {kpis.todayOrdersCount} <span className="text-[10px] font-normal text-slate-400">طلب</span>
        </div>
        <div className="text-[10px] text-purple-400 font-semibold mt-1">حركة البيع اليومية</div>
      </div>

      {/* 7. Active Customers */}
      <div className="bg-slate-900 border border-slate-800/80 p-3.5 rounded-2xl shadow-sm hover:border-slate-700 transition">
        <div className="flex items-center justify-between text-slate-400 mb-2">
          <span className="text-[11px] font-bold">العملاء النشطون</span>
          <div className="w-7 h-7 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center">
            <Users className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="text-base font-extrabold text-cyan-300">
          {kpis.activeCustomersCount} <span className="text-[10px] font-normal text-slate-400">عميل</span>
        </div>
        <div className="text-[10px] text-cyan-400 font-semibold mt-1">قاعدة زبائن فعالة</div>
      </div>

      {/* 8. Total Products */}
      <div className="bg-slate-900 border border-slate-800/80 p-3.5 rounded-2xl shadow-sm hover:border-slate-700 transition">
        <div className="flex items-center justify-between text-slate-400 mb-2">
          <span className="text-[11px] font-bold">إجمالي المنتجات</span>
          <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
            <Package className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="text-base font-extrabold text-blue-300">
          {kpis.totalProductsCount} <span className="text-[10px] font-normal text-slate-400">صنف</span>
        </div>
        <div className="text-[10px] text-blue-400 font-semibold mt-1">كتالوج المبيعات</div>
      </div>

      {/* 9. Low Stock Products */}
      <div
        onClick={onFilterLowStock}
        className="bg-slate-900 border border-amber-800/50 p-3.5 rounded-2xl shadow-sm hover:bg-amber-950/20 transition cursor-pointer"
      >
        <div className="flex items-center justify-between text-amber-400 mb-2">
          <span className="text-[11px] font-bold">منخفض المخزون</span>
          <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
            <AlertTriangle className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="text-base font-extrabold text-amber-300">
          {kpis.lowStockCount} <span className="text-[10px] font-normal text-slate-400">صنف</span>
        </div>
        <div className="text-[10px] text-amber-400 font-semibold mt-1">تحت حد إعادة الطلب</div>
      </div>

      {/* 10. Out of Stock Products */}
      <div
        onClick={onFilterOutOfStock}
        className="bg-slate-900 border border-rose-800/50 p-3.5 rounded-2xl shadow-sm hover:bg-rose-950/20 transition cursor-pointer"
      >
        <div className="flex items-center justify-between text-rose-400 mb-2">
          <span className="text-[11px] font-bold">نفذت من المخزن</span>
          <div className="w-7 h-7 rounded-lg bg-rose-500/10 text-rose-400 flex items-center justify-center">
            <XCircle className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="text-base font-extrabold text-rose-300">
          {kpis.outOfStockCount} <span className="text-[10px] font-normal text-slate-400">صنف</span>
        </div>
        <div className="text-[10px] text-rose-400 font-semibold mt-1">يحتاج توريد عاجل</div>
      </div>
    </div>
  );
};
