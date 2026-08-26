import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import { RequestTimeoutError, runWithTimeout } from '../../lib/async';
import {
  HomeDashboardData,
  HomeDashboardOrder,
  HomeDashboardOrderStatus,
  HomeDashboardSalesDay,
  HomeDashboardStockAlert,
  HomeDashboardSummary,
} from '../../types/dashboard';

type DashboardResult =
  | {
      success: true;
      data: HomeDashboardData;
      source: 'rpc';
    }
  | {
      success: false;
      error: string;
      source: 'unavailable' | 'rpc';
    };

const numberValue = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const nullableNumberValue = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  return numberValue(value);
};

const mapSummary = (value: Record<string, unknown>): HomeDashboardSummary => ({
  todaySalesInMinorUnits: numberValue(value.todaySalesInMinorUnits),
  todayCompletedOrders: numberValue(value.todayCompletedOrders),
  monthSalesInMinorUnits: numberValue(value.monthSalesInMinorUnits),
  monthProfitInMinorUnits: nullableNumberValue(value.monthProfitInMinorUnits),
  openOrdersCount: numberValue(value.openOrdersCount),
  newOrdersCount: numberValue(value.newOrdersCount),
  customerReceivablesInMinorUnits: numberValue(
    value.customerReceivablesInMinorUnits
  ),
  supplierPayablesInMinorUnits: numberValue(
    value.supplierPayablesInMinorUnits
  ),
  inventoryValueInMinorUnits: numberValue(value.inventoryValueInMinorUnits),
  activeProductsCount: numberValue(value.activeProductsCount),
  activeCustomersCount: numberValue(value.activeCustomersCount),
  lowStockCount: numberValue(value.lowStockCount),
  outOfStockCount: numberValue(value.outOfStockCount),
  configurationIssuesCount: numberValue(value.configurationIssuesCount),
});

const mapOrder = (value: Record<string, unknown>): HomeDashboardOrder => ({
  id: String(value.id || ''),
  orderNumber: String(value.orderNumber || ''),
  customerName: String(value.customerName || 'زبون مباشر'),
  status: String(value.status || 'new'),
  paymentStatus: String(value.paymentStatus || 'unpaid'),
  totalInMinorUnits: numberValue(value.totalInMinorUnits),
  source: String(value.source || 'admin'),
  createdAt: String(value.createdAt || ''),
});

const mapStockAlert = (
  value: Record<string, unknown>
): HomeDashboardStockAlert => {
  const severity = String(value.severity || 'low_stock');

  return {
    id: String(value.id || ''),
    nameAr: String(value.nameAr || 'منتج'),
    sku: String(value.sku || ''),
    availableBaseUnits: numberValue(value.availableBaseUnits),
    unitsPerSaleUnit: Math.max(1, numberValue(value.unitsPerSaleUnit)),
    saleUnitName: String(value.saleUnitName || 'طرد'),
    availableSalePackages: numberValue(value.availableSalePackages),
    severity:
      severity === 'configuration' || severity === 'out_of_stock'
        ? severity
        : 'low_stock',
  };
};

const mapOrderStatus = (
  value: Record<string, unknown>
): HomeDashboardOrderStatus => ({
  status: String(value.status || 'new'),
  count: numberValue(value.count),
});

const mapSalesDay = (
  value: Record<string, unknown>
): HomeDashboardSalesDay => ({
  date: String(value.date || ''),
  dayLabel: String(value.dayLabel || ''),
  salesInMinorUnits: numberValue(value.salesInMinorUnits),
});

export async function fetchHomeDashboardFromSupabase(): Promise<DashboardResult> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      success: false,
      error: 'اتصال Supabase غير مضبوط لهذا التطبيق.',
      source: 'unavailable',
    };
  }

  try {
    const { data, error } = await runWithTimeout(
      (signal) => supabase.rpc('get_home_dashboard').abortSignal(signal),
      12_000,
      'استغرق تحميل مركز اليوم وقتًا أطول من المتوقع.',
    );

    if (error) {
      return {
        success: false,
        error: error.message || 'تعذر تحميل الصفحة الرئيسية.',
        source: 'rpc',
      };
    }

    if (!data || typeof data !== 'object') {
      return {
        success: false,
        error: 'أعاد Supabase استجابة غير صالحة للصفحة الرئيسية.',
        source: 'rpc',
      };
    }

    const payload = data as Record<string, unknown>;
    const summary =
      payload.summary && typeof payload.summary === 'object'
        ? (payload.summary as Record<string, unknown>)
        : {};
    const access =
      payload.access && typeof payload.access === 'object'
        ? (payload.access as Record<string, unknown>)
        : {};

    return {
      success: true,
      source: 'rpc',
      data: {
        generatedAt: String(payload.generatedAt || new Date().toISOString()),
        access: {
          canViewProfit: Boolean(access.canViewProfit),
        },
        summary: mapSummary(summary),
        latestOrders: Array.isArray(payload.latestOrders)
          ? payload.latestOrders.map((item) =>
              mapOrder(item as Record<string, unknown>)
            )
          : [],
        stockAlerts: Array.isArray(payload.stockAlerts)
          ? payload.stockAlerts.map((item) =>
              mapStockAlert(item as Record<string, unknown>)
            )
          : [],
        orderStatuses: Array.isArray(payload.orderStatuses)
          ? payload.orderStatuses.map((item) =>
              mapOrderStatus(item as Record<string, unknown>)
            )
          : [],
        sevenDaySales: Array.isArray(payload.sevenDaySales)
          ? payload.sevenDaySales.map((item) =>
              mapSalesDay(item as Record<string, unknown>)
            )
          : [],
      },
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof RequestTimeoutError
          ? `${error.message} تحقق من الاتصال ثم أعد المحاولة.`
          : error instanceof Error
          ? error.message
          : 'حدث خطأ غير متوقع أثناء تحميل الصفحة الرئيسية.',
      source: 'rpc',
    };
  }
}

export function subscribeToDashboardRealtime(
  onRealtimeUpdate: () => void,
  onConnectionChange?: (connected: boolean) => void
): () => void {
  if (!isSupabaseConfigured || !supabase) {
    onConnectionChange?.(false);
    return () => {};
  }

  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleRefresh = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(onRealtimeUpdate, 250);
  };

  const channel = supabase
    .channel('operational_home_dashboard')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders' },
      scheduleRefresh
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'inventory_balances' },
      scheduleRefresh
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'products' },
      scheduleRefresh
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'customers' },
      scheduleRefresh
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'suppliers' },
      scheduleRefresh
    )
    .subscribe((status) => {
      onConnectionChange?.(status === 'SUBSCRIBED');
    });

  return () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    onConnectionChange?.(false);
    void supabase.removeChannel(channel);
  };
}
