import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronLeft,
  CircleDollarSign,
  ClipboardList,
  LayoutDashboard,
  PackagePlus,
  PackageX,
  ReceiptText,
  RefreshCw,
  ShoppingBag,
  Truck,
  WalletCards,
  Wifi,
  WifiOff,
  Wrench,
} from 'lucide-react';
import { CURRENCY } from '../../constants';
import {
  fetchHomeDashboardFromSupabase,
  subscribeToDashboardRealtime,
} from '../../services/supabase/dashboard.service';
import { useAppStore } from '../../stores/useAppStore';
import {
  HomeDashboardData,
  HomeDashboardOrder,
  HomeDashboardStockAlert,
} from '../../types/dashboard';

const ORDER_STATUS: Record<string, { label: string; className: string }> = {
  new: {
    label: 'جديد',
    className: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  },
  confirmed: {
    label: 'مؤكد',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  },
  preparing: {
    label: 'قيد التجهيز',
    className: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  },
  ready: {
    label: 'جاهز',
    className: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  },
  out_for_delivery: {
    label: 'بالتوصيل',
    className: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  },
  completed: {
    label: 'مكتمل',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  },
  cancelled: {
    label: 'ملغي',
    className: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  },
};

const ACTIVE_ORDER_STATUSES = new Set([
  'new',
  'confirmed',
  'preparing',
  'ready',
  'out_for_delivery',
]);

const formatMinorUnits = (value: number): string =>
  (value / 1000).toLocaleString('ar-JO', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });

const formatOrderDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'الوقت غير متاح';

  return date.toLocaleString('ar-JO', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getNextOrderAction = (order: HomeDashboardOrder) => {
  if (order.status === 'new') {
    return { label: 'تأكيد الطلب', hint: 'راجع الكمية والعنوان' };
  }

  if (order.status === 'confirmed') {
    return { label: 'بدء التجهيز', hint: 'جهّز الطرود المطلوبة' };
  }

  if (order.status === 'preparing') {
    return { label: 'إكمال التجهيز', hint: 'تأكد من الطرود' };
  }

  if (order.status === 'ready') {
    return { label: 'بدء التوصيل', hint: 'عيّن السائق والوقت' };
  }

  if (order.status === 'out_for_delivery') {
    return { label: 'متابعة التوصيل', hint: 'سجّل التسليم عند الوصول' };
  }

  return { label: 'فتح التفاصيل', hint: 'راجع حالة الطلب' };
};

interface FocusOrderRowProps {
  order: HomeDashboardOrder;
  onOpen: () => void;
}

const FocusOrderRow: React.FC<FocusOrderRowProps> = ({ order, onOpen }) => {
  const status = ORDER_STATUS[order.status] || ORDER_STATUS.new;
  const nextAction = getNextOrderAction(order);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-800/90 bg-slate-950/55 p-3 text-right transition hover:border-blue-500/35 active:scale-[0.99]"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] font-black text-slate-100">
            #{order.orderNumber}
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[9px] font-extrabold ${status.className}`}
          >
            {status.label}
          </span>
        </div>
        <p className="mt-1 truncate text-[10px] font-bold text-slate-300">
          {order.customerName}
          <span className="mx-1.5 text-slate-600">•</span>
          {formatOrderDate(order.createdAt)}
        </p>
        <p className="mt-1 text-[9px] text-slate-500">{nextAction.hint}</p>
      </div>
      <div className="shrink-0 text-left">
        <p className="text-[11px] font-black text-emerald-300">
          {formatMinorUnits(order.totalInMinorUnits)} {CURRENCY}
        </p>
        <span className="mt-1 inline-flex items-center gap-0.5 text-[10px] font-black text-blue-300">
          {nextAction.label}
          <ChevronLeft className="h-3.5 w-3.5" />
        </span>
      </div>
    </button>
  );
};

const StockActionRow: React.FC<{
  item: HomeDashboardStockAlert;
  onReceive: () => void;
  onConfigure: () => void;
}> = ({ item, onReceive, onConfigure }) => {
  const isConfiguration = item.severity === 'configuration';
  const isOut = item.severity === 'out_of_stock';
  const Icon = isConfiguration ? Wrench : isOut ? PackageX : AlertTriangle;

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-800/80 bg-slate-950/60 p-2.5">
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${
            isConfiguration
              ? 'border-violet-500/30 bg-violet-500/10 text-violet-300'
              : isOut
                ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
          }`}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[11px] font-black text-slate-100">
            {item.nameAr}
          </span>
          <span className="mt-0.5 block truncate text-[9px] text-slate-500">
            {isConfiguration
              ? 'أكمل بيانات طرد البيع والسعر'
              : isOut
                ? `لا يوجد ${item.saleUnitName} كامل للبيع`
                : `${item.availableSalePackages} ${item.saleUnitName} متاح`}
          </span>
        </span>
      </span>
      <button
        type="button"
        onClick={isConfiguration ? onConfigure : onReceive}
        className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[9px] font-black transition active:scale-95 ${
          isConfiguration
            ? 'border-violet-500/30 bg-violet-500/10 text-violet-300'
            : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
        }`}
      >
        {isConfiguration ? 'ضبط' : 'استلام'}
      </button>
    </div>
  );
};

export const DashboardView: React.FC = () => {
  const { currentUser, openModal, setActiveTab } = useAppStore();
  const [data, setData] = useState<HomeDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  const loadDashboard = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);

    const result = await fetchHomeDashboardFromSupabase();
    if (result.success) {
      setData(result.data);
    } else if ('error' in result) {
      setError(result.error);
    }

    if (!silent) setLoading(false);
  }, []);

  useEffect(() => {
    void loadDashboard();
    return subscribeToDashboardRealtime(
      () => void loadDashboard(true),
      setRealtimeConnected
    );
  }, [loadDashboard]);

  if (loading && !data) {
    return (
      <div dir="rtl" className="mx-auto max-w-5xl space-y-3 p-3 pb-28 sm:p-4">
        <div className="h-32 animate-pulse rounded-3xl border border-slate-800 bg-slate-900" />
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="h-24 animate-pulse rounded-2xl border border-slate-800 bg-slate-900"
            />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-2xl border border-slate-800 bg-slate-900" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div dir="rtl" className="mx-auto max-w-md p-4 pt-10">
        <div className="rounded-3xl border border-rose-800/80 bg-rose-950/50 p-6 text-center">
          <AlertCircle className="mx-auto h-7 w-7 text-rose-300" />
          <h2 className="mt-3 text-sm font-black text-white">
            تعذر تحميل مركز اليوم
          </h2>
          <p className="mt-2 text-xs leading-5 text-rose-200/80">{error}</p>
          <button
            type="button"
            onClick={() => void loadDashboard()}
            className="mx-auto mt-5 inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-black text-white transition hover:bg-rose-500 active:scale-95"
          >
            <RefreshCw className="h-4 w-4" />
            إعادة المحاولة
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const summary = data.summary;
  const statusCount = (statuses: string[]) =>
    data.orderStatuses
      .filter((item) => statuses.includes(item.status))
      .reduce((total, item) => total + item.count, 0);
  const preparingCount = statusCount(['confirmed', 'preparing', 'ready']);
  const deliveryCount = statusCount(['out_for_delivery']);
  const stockIssues =
    summary.lowStockCount +
    summary.outOfStockCount +
    summary.configurationIssuesCount;
  const activeOrders = [...data.latestOrders]
    .filter((order) => ACTIVE_ORDER_STATUSES.has(order.status))
    .sort((a, b) => {
      const priority = (status: string) =>
        ['new', 'confirmed', 'preparing', 'ready', 'out_for_delivery'].indexOf(
          status
        );
      return priority(a.status) - priority(b.status);
    })
    .slice(0, 4);
  const focusCount =
    summary.newOrdersCount +
    preparingCount +
    deliveryCount +
    (summary.customerReceivablesInMinorUnits > 0 ? 1 : 0);
  const hasBusinessData =
    summary.activeProductsCount > 0 ||
    summary.activeCustomersCount > 0 ||
    data.latestOrders.length > 0;

  const lanes = [
    {
      id: 'new',
      label: 'طلبات جديدة',
      value: summary.newOrdersCount,
      hint: 'تأكيد ومراجعة',
      icon: ClipboardList,
      tone: 'border-blue-500/25 bg-blue-500/10 text-blue-300',
    },
    {
      id: 'preparing',
      label: 'قيد التجهيز',
      value: preparingCount,
      hint: 'تحضير الطرود',
      icon: Boxes,
      tone: 'border-violet-500/25 bg-violet-500/10 text-violet-300',
    },
    {
      id: 'delivery',
      label: 'بالتوصيل',
      value: deliveryCount,
      hint: 'متابعة السائق',
      icon: Truck,
      tone: 'border-cyan-500/25 bg-cyan-500/10 text-cyan-300',
    },
  ];

  return (
    <div dir="rtl" className="mx-auto max-w-5xl space-y-3 p-3 pb-28 sm:p-4">
      <section
        data-testid="dashboard-hero"
        className="relative overflow-hidden rounded-3xl border border-blue-500/25 bg-[linear-gradient(135deg,rgba(30,64,175,0.34),rgba(15,23,42,0.96)_55%,rgba(6,78,59,0.22))] p-4 shadow-xl shadow-slate-950/30 sm:p-5"
      >
        <div className="pointer-events-none absolute -left-12 -top-12 h-40 w-40 rounded-full bg-blue-500/12 blur-3xl" />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-blue-400/25 bg-blue-500/15 text-blue-200">
                <LayoutDashboard className="h-5 w-5" />
              </span>
              <span>
                <p className="text-[10px] font-extrabold tracking-wide text-blue-200">
                  مركز اليوم
                </p>
                <h2 className="truncate text-base font-black text-white">
                  أهلاً {currentUser?.name || 'بإدارة النواصرة'}
                </h2>
              </span>
            </div>
            <p className="mt-3 text-[10px] leading-5 text-slate-300">
              ركّز على الطلب التالي والتحصيل، وكل التقارير والإعدادات موجودة في «المزيد».
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadDashboard()}
            disabled={loading}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-700/80 bg-slate-950/40 text-slate-300 transition hover:border-slate-600 hover:text-white disabled:opacity-60"
            aria-label="تحديث مركز اليوم"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="relative mt-3 flex items-center justify-between gap-2 border-t border-white/8 pt-2.5">
          <span className="inline-flex items-center gap-1.5 text-[9px] font-extrabold text-slate-300">
            {realtimeConnected ? (
              <Wifi className="h-3.5 w-3.5 text-emerald-300" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-slate-500" />
            )}
            {realtimeConnected ? 'تحديث مباشر' : 'آخر نسخة محمّلة'}
          </span>
          <span className="rounded-full border border-white/10 bg-slate-950/25 px-2.5 py-1 text-[9px] font-black text-blue-100">
            {focusCount > 0 ? `${focusCount} يحتاج متابعة` : 'لا توجد مهام معلّقة'}
          </span>
        </div>
      </section>

      <section aria-labelledby="order-lanes-title">
        <div className="mb-2 flex items-end justify-between gap-3 px-1">
          <div>
            <h3 id="order-lanes-title" className="text-xs font-black text-slate-100">
              سير الطلبات
            </h3>
            <p className="mt-0.5 text-[9px] text-slate-500">اضغط على أي حالة لإدارة الطلبات</p>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('orders')}
            className="inline-flex items-center gap-1 text-[10px] font-black text-blue-300"
          >
            كل الطلبات <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {lanes.map((lane) => {
            const Icon = lane.icon;
            return (
              <button
                key={lane.id}
                type="button"
                onClick={() => setActiveTab('orders')}
                className={`rounded-2xl border p-2.5 text-right transition active:scale-[0.98] ${lane.tone}`}
              >
                <Icon className="h-4 w-4" />
                <p className="mt-2 text-lg font-black text-white">{lane.value}</p>
                <p className="mt-0.5 text-[9px] font-black text-slate-200">{lane.label}</p>
                <p className="mt-1 text-[8px] text-slate-400">{lane.hint}</p>
              </button>
            );
          })}
        </div>
      </section>

      <section
        aria-labelledby="receivables-title"
        className="overflow-hidden rounded-2xl border border-rose-500/20 bg-[linear-gradient(135deg,rgba(159,18,57,0.15),rgba(15,23,42,0.8))]"
      >
        <button
          type="button"
          onClick={() => setActiveTab('accounts')}
          className="flex w-full items-center justify-between gap-3 p-3.5 text-right transition hover:bg-white/[0.02] active:scale-[0.99]"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-rose-500/25 bg-rose-500/10 text-rose-300">
              <CircleDollarSign className="h-4 w-4" />
            </span>
            <span>
              <span id="receivables-title" className="block text-[11px] font-black text-white">
                ذمم العملاء
              </span>
              <span className="mt-0.5 block text-[9px] text-slate-400">
                {summary.customerReceivablesInMinorUnits > 0
                  ? 'اضغط لتسجيل سند قبض أو مراجعة العميل'
                  : 'لا توجد مبالغ مستحقة حالياً'}
              </span>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[12px] font-black text-rose-200">
            {formatMinorUnits(summary.customerReceivablesInMinorUnits)} {CURRENCY}
            <ChevronLeft className="h-4 w-4" />
          </span>
        </button>
      </section>

      <section aria-labelledby="next-actions-title" className="rounded-2xl border border-slate-800/90 bg-slate-900/70 p-3.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 id="next-actions-title" className="text-xs font-black text-white">الإجراء التالي</h3>
            <p className="mt-0.5 text-[9px] text-slate-500">أحدث الطلبات النشطة، مرتبة من الأهم</p>
          </div>
          <span className="rounded-full border border-slate-700 bg-slate-950 px-2 py-1 text-[9px] font-black text-slate-400">
            {summary.openOrdersCount} طلب مفتوح
          </span>
        </div>
        <div className="mt-3 space-y-2">
          {activeOrders.length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/8 p-3">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-300" />
              <span>
                <span className="block text-[11px] font-black text-emerald-200">لا يوجد طلب يحتاج تدخلاً الآن</span>
                <span className="mt-0.5 block text-[9px] text-emerald-200/60">ستظهر هنا الطلبات الجديدة والتجهيز والتوصيل.</span>
              </span>
            </div>
          ) : (
            activeOrders.map((order) => (
              <FocusOrderRow
                key={order.id}
                order={order}
                onOpen={() => setActiveTab('orders')}
              />
            ))
          )}
        </div>
      </section>

      <section aria-labelledby="quick-actions-title">
        <div className="mb-2 px-1">
          <h3 id="quick-actions-title" className="text-xs font-black text-slate-100">عملية سريعة</h3>
          <p className="mt-0.5 text-[9px] text-slate-500">العمليات التي تحتاجها أثناء الدوام</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('pos')}
            className="rounded-2xl border border-blue-500/25 bg-blue-500/10 p-2.5 text-right transition hover:border-blue-500/40 active:scale-[0.98]"
          >
            <ShoppingBag className="h-4 w-4 text-blue-300" />
            <p className="mt-2 text-[10px] font-black text-white">بيع مباشر</p>
            <p className="mt-0.5 text-[8px] text-blue-200/60">فاتورة جملة</p>
          </button>
          <button
            type="button"
            onClick={() => openModal('receive_goods')}
            className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-2.5 text-right transition hover:border-emerald-500/40 active:scale-[0.98]"
          >
            <PackagePlus className="h-4 w-4 text-emerald-300" />
            <p className="mt-2 text-[10px] font-black text-white">استلام</p>
            <p className="mt-0.5 text-[8px] text-emerald-200/60">بضاعة مورد</p>
          </button>
          <button
            type="button"
            onClick={() => openModal('add_expense')}
            className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-2.5 text-right transition hover:border-amber-500/40 active:scale-[0.98]"
          >
            <ReceiptText className="h-4 w-4 text-amber-300" />
            <p className="mt-2 text-[10px] font-black text-white">مصروف</p>
            <p className="mt-0.5 text-[8px] text-amber-200/60">كاش أو CliQ</p>
          </button>
        </div>
      </section>

      {!hasBusinessData && (
        <section className="rounded-2xl border border-blue-500/25 bg-blue-500/8 p-4 text-center">
          <Boxes className="mx-auto h-6 w-6 text-blue-300" />
          <h3 className="mt-2 text-xs font-black text-white">ابدأ بإضافة أول صنف</h3>
          <p className="mt-1 text-[10px] leading-5 text-slate-400">
            بعدها استلم الكميات، وستظهر المتابعة اليومية هنا تلقائياً.
          </p>
        </section>
      )}

      {stockIssues > 0 && (
        <section aria-labelledby="stock-alerts-title" className="rounded-2xl border border-slate-800/90 bg-slate-900/70 p-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-300" />
              <span>
                <h3 id="stock-alerts-title" className="text-xs font-black text-white">تنبيهات المخزون</h3>
                <p className="text-[9px] text-slate-500">الجاهزية محسوبة حسب طرد البيع</p>
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('inventory')}
              className="inline-flex items-center gap-1 text-[10px] font-black text-amber-300"
            >
              المخزون <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {data.stockAlerts.slice(0, 3).map((item) => (
              <StockActionRow
                key={item.id}
                item={item}
                onReceive={() => openModal('receive_goods', { productId: item.id })}
                onConfigure={() => setActiveTab('products')}
              />
            ))}
          </div>
        </section>
      )}

      <footer className="flex items-center justify-center gap-2 pb-2 text-[9px] text-slate-600">
        <WalletCards className="h-3 w-3" />
        <span>التفاصيل والتقارير والإعدادات من تبويب المزيد.</span>
      </footer>
    </div>
  );
};
