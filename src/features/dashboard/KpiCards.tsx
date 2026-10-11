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
      <div className="bg-nw-surface border border-nw-border p-3.5 rounded-2xl shadow-sm hover:border-nw-border transition">
        <div className="flex items-center justify-between text-nw-muted mb-2">
          <span className="text-[11px] font-bold">مبيعات اليوم</span>
          <div className="w-7 h-7 rounded-lg bg-nw-ok-bg text-nw-ok flex items-center justify-center">
            <TrendingUp className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="text-base font-extrabold text-nw-text">
          {kpis.todaySales.toLocaleString('ar-JO', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
          <span className="text-[10px] font-normal text-nw-muted mr-1">{CURRENCY}</span>
        </div>
        <div
          className={`text-[10px] font-semibold mt-1 flex items-center gap-0.5 ${
            kpis.todaySalesChangePercent >= 0 ? 'text-nw-ok' : 'text-nw-bad'
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
      <div className="bg-nw-surface border border-nw-border p-3.5 rounded-2xl shadow-sm hover:border-nw-border transition">
        <div className="flex items-center justify-between text-nw-muted mb-2">
          <span className="text-[11px] font-bold">مبيعات هذا الأسبوع</span>
          <div className="w-7 h-7 rounded-lg bg-nw-info-bg text-nw-info flex items-center justify-center">
            <Calendar className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="text-base font-extrabold text-nw-text">
          {kpis.weekSales.toLocaleString('ar-JO', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
          <span className="text-[10px] font-normal text-nw-muted mr-1">{CURRENCY}</span>
        </div>
        <div className="text-[10px] text-nw-info font-semibold mt-1">حركة تراكمية أسبوعية</div>
      </div>

      {/* 3. This Month Sales */}
      <div className="bg-nw-surface border border-nw-border p-3.5 rounded-2xl shadow-sm hover:border-nw-border transition">
        <div className="flex items-center justify-between text-nw-muted mb-2">
          <span className="text-[11px] font-bold">مبيعات هذا الشهر</span>
          <div className="w-7 h-7 rounded-lg bg-nw-info-bg text-nw-info flex items-center justify-center">
            <DollarSign className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="text-base font-extrabold text-nw-info">
          {kpis.monthSales.toLocaleString('ar-JO', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
          <span className="text-[10px] font-normal text-nw-muted mr-1">{CURRENCY}</span>
        </div>
        <div className="text-[10px] text-nw-info font-semibold mt-1">إجمالي الشهر الحالي</div>
      </div>

      {/* 4. Total Revenue */}
      <div className="bg-nw-surface border border-nw-border p-3.5 rounded-2xl shadow-sm hover:border-nw-border transition">
        <div className="flex items-center justify-between text-nw-muted mb-2">
          <span className="text-[11px] font-bold">إجمالي الإيرادات</span>
          <div className="w-7 h-7 rounded-lg bg-nw-ok-bg text-nw-ok flex items-center justify-center">
            <PieChart className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="text-base font-extrabold text-nw-ok">
          {kpis.totalRevenue.toLocaleString('ar-JO', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
          <span className="text-[10px] font-normal text-nw-muted mr-1">{CURRENCY}</span>
        </div>
        <div className="text-[10px] text-nw-ok font-semibold mt-1">كافة المبيعات الصافية</div>
      </div>

      {/* 5. Net Profit */}
      <div className="bg-nw-surface border border-nw-border p-3.5 rounded-2xl shadow-sm hover:border-nw-border transition">
        <div className="flex items-center justify-between text-nw-muted mb-2">
          <span className="text-[11px] font-bold">صافي الأرباح</span>
          <div className="w-7 h-7 rounded-lg bg-nw-ok-bg text-nw-ok flex items-center justify-center">
            <TrendingUp className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="text-base font-extrabold text-nw-ok">
          {kpis.netProfit.toLocaleString('ar-JO', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
          <span className="text-[10px] font-normal text-nw-muted mr-1">{CURRENCY}</span>
        </div>
        <div className="text-[10px] text-nw-ok font-semibold mt-1">
          هامش ~%{kpis.profitMarginPercent}
        </div>
      </div>

      {/* 6. Number of Orders Today */}
      <div className="bg-nw-surface border border-nw-border p-3.5 rounded-2xl shadow-sm hover:border-nw-border transition">
        <div className="flex items-center justify-between text-nw-muted mb-2">
          <span className="text-[11px] font-bold">عدد طلبات اليوم</span>
          <div className="w-7 h-7 rounded-lg bg-nw-info-bg text-nw-info flex items-center justify-center">
            <ShoppingBag className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="text-base font-extrabold text-nw-info">
          {kpis.todayOrdersCount} <span className="text-[10px] font-normal text-nw-muted">طلب</span>
        </div>
        <div className="text-[10px] text-nw-info font-semibold mt-1">حركة البيع اليومية</div>
      </div>

      {/* 7. Active Customers */}
      <div className="bg-nw-surface border border-nw-border p-3.5 rounded-2xl shadow-sm hover:border-nw-border transition">
        <div className="flex items-center justify-between text-nw-muted mb-2">
          <span className="text-[11px] font-bold">العملاء النشطون</span>
          <div className="w-7 h-7 rounded-lg bg-nw-info-bg text-nw-info flex items-center justify-center">
            <Users className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="text-base font-extrabold text-nw-info">
          {kpis.activeCustomersCount} <span className="text-[10px] font-normal text-nw-muted">عميل</span>
        </div>
        <div className="text-[10px] text-nw-info font-semibold mt-1">قاعدة زبائن فعالة</div>
      </div>

      {/* 8. Total Products */}
      <div className="bg-nw-surface border border-nw-border p-3.5 rounded-2xl shadow-sm hover:border-nw-border transition">
        <div className="flex items-center justify-between text-nw-muted mb-2">
          <span className="text-[11px] font-bold">إجمالي المنتجات</span>
          <div className="w-7 h-7 rounded-lg bg-nw-info-bg text-nw-info flex items-center justify-center">
            <Package className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="text-base font-extrabold text-nw-info">
          {kpis.totalProductsCount} <span className="text-[10px] font-normal text-nw-muted">صنف</span>
        </div>
        <div className="text-[10px] text-nw-info font-semibold mt-1">كتالوج المبيعات</div>
      </div>

      {/* 9. Low Stock Products */}
      <button
        type="button"
        onClick={onFilterLowStock}
        className="text-right bg-nw-surface border border-nw-warn/50 p-3.5 rounded-2xl shadow-sm hover:bg-nw-warn-bg transition cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-nw-warn"
      >
        <div className="flex items-center justify-between text-nw-warn mb-2">
          <span className="text-[11px] font-bold">منخفض المخزون</span>
          <div className="w-7 h-7 rounded-lg bg-nw-warn-bg text-nw-warn flex items-center justify-center">
            <AlertTriangle className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="text-base font-extrabold text-nw-warn">
          {kpis.lowStockCount} <span className="text-[10px] font-normal text-nw-muted">صنف</span>
        </div>
        <div className="text-[10px] text-nw-warn font-semibold mt-1">تحت حد إعادة الطلب</div>
      </button>

      {/* 10. Out of Stock Products */}
      <button
        type="button"
        onClick={onFilterOutOfStock}
        className="text-right bg-nw-surface border border-nw-bad/50 p-3.5 rounded-2xl shadow-sm hover:bg-nw-bad-bg transition cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-nw-bad"
      >
        <div className="flex items-center justify-between text-nw-bad mb-2">
          <span className="text-[11px] font-bold">نفذت من المخزن</span>
          <div className="w-7 h-7 rounded-lg bg-nw-bad-bg text-nw-bad flex items-center justify-center">
            <XCircle className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="text-base font-extrabold text-nw-bad">
          {kpis.outOfStockCount} <span className="text-[10px] font-normal text-nw-muted">صنف</span>
        </div>
        <div className="text-[10px] text-nw-bad font-semibold mt-1">يحتاج توريد عاجل</div>
      </button>
    </div>
  );
};
