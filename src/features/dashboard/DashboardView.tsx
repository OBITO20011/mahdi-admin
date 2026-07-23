/**
 * Nawasrah Business Manager - Executive Dashboard View
 */

import React from 'react';
import { useAppStore } from '../../stores/useAppStore';
import {
  TrendingUp,
  DollarSign,
  ShoppingBag,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownLeft,
  CreditCard,
  Building,
  PackageCheck,
  PackageX,
  Clock,
  ChevronLeft,
  Plus,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts';
import { CURRENCY } from '../../constants';

const SALES_CHART_DATA = [
  { day: 'السبت', sales: 2400, profit: 850, expenses: 300 },
  { day: 'الأحد', sales: 3100, profit: 1100, expenses: 450 },
  { day: 'الإثنين', sales: 2800, profit: 980, expenses: 200 },
  { day: 'الثلاثاء', sales: 3900, profit: 1400, expenses: 600 },
  { day: 'الأربعاء', sales: 4200, profit: 1550, expenses: 320 },
  { day: 'الخميس', sales: 5100, profit: 1900, expenses: 800 },
  { day: 'الجمعة', sales: 3820, profit: 1240, expenses: 400 },
];

export const DashboardView: React.FC = () => {
  const {
    orders,
    products,
    customers,
    suppliers,
    currentShift,
    openModal,
    setActiveTab,
  } = useAppStore();

  const newOrdersCount = (orders || []).filter((o) => o?.status === 'new').length;
  const processingOrdersCount = (orders || []).filter((o) => o?.status === 'processing').length;
  const completedOrdersCount = (orders || []).filter((o) => o?.status === 'delivered').length;

  const totalCustomerDebts = (customers || []).reduce((acc, c) => acc + (c?.currentBalance || 0), 0);
  const totalSupplierDebts = (suppliers || []).reduce((acc, s) => acc + (s?.currentBalance || 0), 0);
  const lowStockProducts = (products || []).filter(
    (p) => (p?.availableQuantity ?? 0) <= (p?.reorderLevel ?? 0)
  );

  return (
    <div className="p-4 space-y-4 pb-20">
      {/* Executive Welcome Card */}
      <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 p-4 rounded-2xl border border-blue-800/50 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl" />
        <div className="flex items-center justify-between relative z-10">
          <div>
            <span className="text-[10px] font-bold text-blue-300 uppercase tracking-widest bg-blue-950/80 px-2 py-0.5 rounded-full border border-blue-800">
              لوحة التحكم الرئيسية
            </span>
            <h2 className="text-base font-extrabold text-white mt-1">أهلاً بك، أحمد النواصرة</h2>
            <p className="text-[11px] text-slate-300">إليك ملخص أداء الأرباح والمبيعات ليوم الثلاثاء</p>
          </div>
          <button
            onClick={() => openModal('pos_sale')}
            className="bg-blue-600 hover:bg-blue-500 text-white p-2.5 rounded-xl shadow-lg transition active:scale-95 flex items-center gap-1 text-xs font-bold shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">نقطة البيع</span>
          </button>
        </div>
      </div>

      {/* KPI Metrics Grid (2x2) */}
      <div className="grid grid-cols-2 gap-2.5">
        {/* Metric 1: Today Sales */}
        <div className="bg-slate-900/90 border border-slate-800 p-3.5 rounded-2xl shadow-md">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-bold">مبيعات اليوم</span>
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
              <TrendingUp className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-base font-extrabold text-white">
            3,820.00 <span className="text-[10px] font-normal text-slate-400">{CURRENCY}</span>
          </div>
          <div className="text-[10px] text-emerald-400 font-semibold mt-1 flex items-center gap-1">
            <ArrowUpRight className="w-3 h-3" />
            <span>+12.4% عن الأمس</span>
          </div>
        </div>

        {/* Metric 2: Net Profit */}
        <div className="bg-slate-900/90 border border-slate-800 p-3.5 rounded-2xl shadow-md">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-bold">صافي الربح التقريبي</span>
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
              <DollarSign className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-base font-extrabold text-blue-400">
            1,240.50 <span className="text-[10px] font-normal text-slate-400">{CURRENCY}</span>
          </div>
          <div className="text-[10px] text-blue-300 font-semibold mt-1">هامش ربح ~%32.4</div>
        </div>

        {/* Metric 3: Orders Breakdown */}
        <div className="bg-slate-900/90 border border-slate-800 p-3.5 rounded-2xl shadow-md">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-bold">طلبات الزبائن</span>
            <div className="w-7 h-7 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center">
              <ShoppingBag className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-base font-extrabold text-white">
            48 <span className="text-[10px] font-normal text-slate-400">طلب</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] mt-1 font-medium">
            <span className="text-red-400 font-bold">{newOrdersCount} جديد</span>
            <span className="text-slate-500">•</span>
            <span className="text-amber-400 font-bold">{processingOrdersCount} بالتجهيز</span>
          </div>
        </div>

        {/* Metric 4: CliQ & Cash Box */}
        <div className="bg-slate-900/90 border border-slate-800 p-3.5 rounded-2xl shadow-md">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-bold">رصيد CliQ + الصندوق</span>
            <div className="w-7 h-7 rounded-lg bg-teal-500/10 text-teal-400 flex items-center justify-center">
              <Wallet className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-base font-extrabold text-teal-300">
            {currentShift ? currentShift.expectedCash.toFixed(2) : '3,820.00'}{' '}
            <span className="text-[10px] font-normal text-slate-400">{CURRENCY}</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-1">CliQ: 2,890.45 د.أ</div>
        </div>
      </div>

      {/* Sales & Profit Chart */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-lg">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-xs font-bold text-slate-200">تحليل المبيعات والأرباح الأسبوعية</h3>
            <p className="text-[10px] text-slate-400">توزيع حركة البيع والمصروفات حسب اليوم</p>
          </div>
          <span className="text-[10px] font-bold bg-slate-800 px-2 py-1 rounded-lg text-slate-300">
            هذا الأسبوع
          </span>
        </div>
        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={SALES_CHART_DATA} margin={{ top: 10, right: 0, left: -25, bottom: 0 }}>
              <XAxis dataKey="day" stroke="#64748B" fontSize={10} tickLine={false} />
              <YAxis stroke="#64748B" fontSize={10} tickLine={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0F172A', borderColor: '#334155', borderRadius: '12px', fontSize: '11px', color: '#FFF' }}
              />
              <Bar dataKey="sales" fill="#1055C9" radius={[4, 4, 0, 0]} name="المبيعات" />
              <Bar dataKey="profit" fill="#10B981" radius={[4, 4, 0, 0]} name="الأرباح" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Debts Summary Banner */}
      <div className="grid grid-cols-2 gap-2.5">
        <div
          onClick={() => {
            setActiveTab('accounts');
            openModal('customers');
          }}
          className="bg-red-950/40 border border-red-800/40 p-3 rounded-2xl flex items-center justify-between cursor-pointer hover:bg-red-950/60 transition"
        >
          <div>
            <span className="text-[10px] text-red-300 font-bold block">ديون العملاء المطلوبة</span>
            <span className="text-sm font-extrabold text-red-400">
              {totalCustomerDebts.toFixed(2)} {CURRENCY}
            </span>
          </div>
          <ArrowDownLeft className="w-5 h-5 text-red-400" />
        </div>

        <div
          onClick={() => {
            setActiveTab('accounts');
            openModal('suppliers');
          }}
          className="bg-amber-950/40 border border-amber-800/40 p-3 rounded-2xl flex items-center justify-between cursor-pointer hover:bg-amber-950/60 transition"
        >
          <div>
            <span className="text-[10px] text-amber-300 font-bold block">مستحقات الموردين علينا</span>
            <span className="text-sm font-extrabold text-amber-400">
              {totalSupplierDebts.toFixed(2)} {CURRENCY}
            </span>
          </div>
          <ArrowUpRight className="w-5 h-5 text-amber-400" />
        </div>
      </div>

      {/* Inventory & Stock Alerts Section */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-md">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-bold text-slate-200">تنبيهات مهمة تحتاج انتباهك</h3>
          </div>
          <button
            onClick={() => setActiveTab('products')}
            className="text-[11px] text-blue-400 hover:underline font-semibold flex items-center gap-0.5"
          >
            <span>إدارة المخزون</span>
            <ChevronLeft className="w-3 h-3" />
          </button>
        </div>

        <div className="space-y-2">
          {lowStockProducts.map((prod) => (
            <div
              key={prod.id}
              className="flex items-center justify-between bg-slate-800/60 p-2.5 rounded-xl border border-slate-700/60 text-xs"
            >
              <div className="flex items-center gap-2.5">
                <img
                  src={prod.imageUrl}
                  alt={prod.nameAr}
                  className="w-9 h-9 rounded-lg object-cover border border-slate-700"
                />
                <div>
                  <h4 className="font-bold text-slate-200">{prod.nameAr}</h4>
                  <span className="text-[10px] text-amber-400">
                    متبقي: {prod.availableQuantity} {prod.unit} (حد إعادة الطلب: {prod.reorderLevel})
                  </span>
                </div>
              </div>
              <button
                onClick={() => openModal('stock_receive_single', prod)}
                className="bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 px-2.5 py-1 rounded-lg text-[10px] font-bold border border-amber-500/30"
              >
                طلب كمية
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
