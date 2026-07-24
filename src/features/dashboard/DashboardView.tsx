/**
 * Nawasrah Business Manager - Enterprise Executive Dashboard View
 * Complete real-time Supabase analytics, 10 KPI cards, 6 charts, 5 widgets, 6 quick actions.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import {
  fetchDashboardAnalyticsFromSupabase,
  subscribeToDashboardRealtime,
} from '../../services/supabase/dashboard.service';
import { DashboardAnalyticsData } from '../../types/dashboard';
import { KpiCards } from './KpiCards';
import { ChartsSection } from './ChartsSection';
import { WidgetsSection } from './WidgetsSection';
import { QuickActions } from './QuickActions';
import {
  RefreshCw,
  Wifi,
  WifiOff,
  AlertCircle,
  Building2,
  Plus,
  Package,
  ShoppingBag,
  Sparkles,
} from 'lucide-react';

export const DashboardView: React.FC = () => {
  const { openModal, setActiveTab, currentUser } = useAppStore();

  const [analytics, setAnalytics] = useState<DashboardAnalyticsData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [isRealtimeActive, setIsRealtimeActive] = useState<boolean>(true);

  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setError(null);

    const res = await fetchDashboardAnalyticsFromSupabase();

    if (res.success && res.data) {
      setAnalytics(res.data);
      setLastUpdated(new Date());
    } else {
      setError(res.error || 'تعذر تحميل بيانات لوحة التحكم من Supabase.');
    }

    if (!isSilent) setLoading(false);
  }, []);

  useEffect(() => {
    loadData();

    // Setup Supabase Realtime subscription
    const unsubscribe = subscribeToDashboardRealtime(() => {
      loadData(true);
    });

    return () => {
      unsubscribe();
    };
  }, [loadData]);

  // Quick Action Handlers
  const handleNewOrder = () => {
    setActiveTab('pos');
  };

  const handleAddProduct = () => {
    openModal('add_product');
  };

  const handleReceiveInventory = () => {
    openModal('receive_goods');
  };

  const handleAddCustomer = () => {
    openModal('add_customer');
  };

  const handleGoToOrders = () => {
    setActiveTab('orders');
  };

  const handleGoToProducts = () => {
    setActiveTab('products');
  };

  const handleGoToCustomers = () => {
    setActiveTab('accounts');
  };

  // 1. Loading State
  if (loading && !analytics) {
    return (
      <div dir="rtl" className="p-4 space-y-4 pb-20 max-w-7xl mx-auto">
        {/* Header Skeleton */}
        <div className="h-28 bg-slate-900 border border-slate-800 rounded-2xl animate-pulse p-4 flex flex-col justify-between">
          <div className="h-4 w-32 bg-slate-800 rounded-full" />
          <div className="h-6 w-64 bg-slate-800 rounded-lg" />
          <div className="h-3 w-48 bg-slate-800 rounded-md" />
        </div>

        {/* Quick Actions Skeleton */}
        <div className="h-24 bg-slate-900 border border-slate-800 rounded-2xl animate-pulse p-4" />

        {/* KPI Cards Skeleton Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
          {Array.from({ length: 10 }).map((_, idx) => (
            <div key={idx} className="h-24 bg-slate-900 border border-slate-800 rounded-2xl animate-pulse p-3 space-y-2">
              <div className="h-3 w-16 bg-slate-800 rounded" />
              <div className="h-6 w-24 bg-slate-800 rounded" />
              <div className="h-2 w-12 bg-slate-800 rounded" />
            </div>
          ))}
        </div>

        {/* Charts Skeleton Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="h-60 bg-slate-900 border border-slate-800 rounded-2xl animate-pulse" />
          <div className="h-60 bg-slate-900 border border-slate-800 rounded-2xl animate-pulse" />
        </div>
      </div>
    );
  }

  // 2. Error State
  if (error && !analytics) {
    return (
      <div dir="rtl" className="p-4 max-w-2xl mx-auto mt-8">
        <div className="bg-rose-950/80 border border-rose-800 p-6 rounded-2xl text-center space-y-4 shadow-2xl">
          <div className="w-12 h-12 bg-rose-500/20 text-rose-400 rounded-2xl flex items-center justify-center mx-auto border border-rose-500/30">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">خطأ في جلب بيانات لوحة التحكم</h3>
            <p className="text-xs text-rose-300 mt-1">{error}</p>
          </div>
          <button
            onClick={() => loadData()}
            className="bg-rose-600 hover:bg-rose-500 text-white font-bold px-6 py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-2 mx-auto shadow-lg"
          >
            <RefreshCw className="w-4 h-4" />
            <span>إعادة المحاولة الآن</span>
          </button>
        </div>
      </div>
    );
  }

  const kpis = analytics?.kpis || {
    todaySales: 0,
    yesterdaySales: 0,
    todaySalesChangePercent: 0,
    weekSales: 0,
    monthSales: 0,
    totalRevenue: 0,
    netProfit: 0,
    profitMarginPercent: 0,
    todayOrdersCount: 0,
    activeCustomersCount: 0,
    totalProductsCount: 0,
    lowStockCount: 0,
    outOfStockCount: 0,
  };

  // Check if there is ANY real data in products, customers, orders, KPIs or widgets
  const hasProducts = (kpis.totalProductsCount || 0) > 0;
  const hasCustomers = (kpis.activeCustomersCount || 0) > 0 || (analytics?.latestCustomers?.length || 0) > 0;
  const hasOrders =
    (kpis.todayOrdersCount || 0) > 0 ||
    (kpis.totalRevenue || 0) > 0 ||
    (kpis.monthSales || 0) > 0 ||
    (kpis.weekSales || 0) > 0 ||
    (kpis.todaySales || 0) > 0 ||
    (analytics?.latestOrders?.length || 0) > 0 ||
    (analytics?.ordersByStatus?.some((st) => st.count > 0) ?? false);

  const hasWidgetsData =
    (analytics?.topSellingProducts?.length || 0) > 0 ||
    (analytics?.recentInventoryMovements?.length || 0) > 0 ||
    (analytics?.lowStockAlerts?.length || 0) > 0 ||
    (analytics?.todayNotifications?.length || 0) > 0;

  const hasAnyData = hasProducts || hasCustomers || hasOrders || hasWidgetsData;
  const isEmptyData = !hasAnyData;

  return (
    <div dir="rtl" className="p-3 sm:p-4 space-y-4 pb-20 max-w-7xl mx-auto">
      {/* 1. Executive Banner Header */}
      <div className="bg-gradient-to-r from-blue-950 via-indigo-950 to-slate-900 p-4 sm:p-5 rounded-2xl border border-blue-800/60 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl" />
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 relative z-10">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-blue-300 uppercase tracking-widest bg-blue-900/80 px-2.5 py-0.5 rounded-full border border-blue-700">
                النواصرة إدارياً Enterprise Dashboard
              </span>
              <div className="flex items-center gap-1 bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded-full">
                <Wifi className="w-3 h-3 text-emerald-400 animate-pulse" />
                <span>Supabase Realtime مباشر</span>
              </div>
            </div>

            <h2 className="text-base sm:text-lg font-extrabold text-white mt-1.5 flex items-center gap-2">
              <span>أهلاً بك، {currentUser?.fullName || 'إدارة شركة النواصرة'}</span>
              <Sparkles className="w-4 h-4 text-amber-400" />
            </h2>
            <p className="text-[11px] text-slate-300 mt-0.5">
              متابعة الأرباح، المبيعات، المخزون، وحركات الفروع لحظة بلحظة • آخر تحديث:{' '}
              {lastUpdated.toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => loadData()}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 p-2.5 rounded-xl border border-slate-700 transition active:scale-95 flex items-center justify-center gap-1.5 text-xs font-bold"
              title="تحديث البيانات يدويًا"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-400' : ''}`} />
              <span className="hidden sm:inline">تحديث</span>
            </button>

            <button
              onClick={handleNewOrder}
              className="bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-2.5 rounded-xl shadow-lg transition active:scale-95 flex items-center justify-center gap-1.5 text-xs font-bold shrink-0 flex-1 sm:flex-initial"
            >
              <ShoppingBag className="w-4 h-4" />
              <span>نقطة البيع (POS)</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Quick Actions Bar */}
      <QuickActions
        onNewOrder={handleNewOrder}
        onAddProduct={handleAddProduct}
        onReceiveInventory={handleReceiveInventory}
        onAddCustomer={handleAddCustomer}
        onGoToOrders={handleGoToOrders}
        onGoToProducts={handleGoToProducts}
      />

      {/* 3. Empty State Banner (If no data in database yet) */}
      {isEmptyData && (
        <div className="bg-indigo-950/60 border border-indigo-800/80 p-4 rounded-2xl text-center space-y-3">
          <Building2 className="w-8 h-8 text-indigo-400 mx-auto" />
          <div>
            <h3 className="text-xs font-bold text-white">لا توجد بيانات مسجلة بعد في قاعدة بيانات Supabase</h3>
            <p className="text-[11px] text-indigo-300 mt-0.5">
              يمكنك بدء إضافة المنتجات وإنشاء أول طلب لتفعيل جميع تحليلات الرسوم البيانية المؤشرية.
            </p>
          </div>
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={handleAddProduct}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة أول منتج</span>
            </button>
            <button
              onClick={handleNewOrder}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 border border-slate-700 transition"
            >
              <ShoppingBag className="w-4 h-4" />
              <span>إنشاء أول طلب</span>
            </button>
          </div>
        </div>
      )}

      {/* 4. KPI Metrics Cards (10 Required KPI Cards) */}
      <KpiCards
        kpis={kpis}
        onFilterLowStock={handleGoToProducts}
        onFilterOutOfStock={handleGoToProducts}
      />

      {/* 5. Enterprise Analytics Charts (6 Required Charts) */}
      <ChartsSection
        dailySales30d={analytics?.dailySales30d || []}
        monthlyRevenue={analytics?.monthlyRevenue || []}
        ordersByStatus={analytics?.ordersByStatus || []}
        topSellingProducts={analytics?.topSellingProducts || []}
        salesByWarehouse={analytics?.salesByWarehouse || []}
        salesByBranch={analytics?.salesByBranch || []}
      />

      {/* 6. Live Widgets Section (5 Required Widgets) */}
      <WidgetsSection
        latestOrders={analytics?.latestOrders || []}
        latestCustomers={analytics?.latestCustomers || []}
        lowStockAlerts={analytics?.lowStockAlerts || []}
        recentInventoryMovements={analytics?.recentInventoryMovements || []}
        todayNotifications={analytics?.todayNotifications || []}
        onViewOrderDetails={(orderId) => {
          openModal('view_order', { id: orderId });
        }}
        onReceiveStock={(productId) => {
          openModal('receive_goods');
        }}
        onNavigateToOrders={handleGoToOrders}
        onNavigateToProducts={handleGoToProducts}
        onNavigateToCustomers={handleGoToCustomers}
      />
    </div>
  );
};
