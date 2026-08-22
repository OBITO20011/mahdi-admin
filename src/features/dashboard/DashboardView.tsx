import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronLeft,
  ClipboardList,
  Landmark,
  LayoutDashboard,
  PackagePlus,
  PackageX,
  RefreshCw,
  ShoppingBag,
  TrendingUp,
  Truck,
  Users,
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

const ORDER_STATUS: Record<
  string,
  { label: string; className: string }
> = {
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

const formatMinorUnits = (value: number): string =>
  (value / 1000).toLocaleString('ar-JO', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });

const formatOrderDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'الوقت غير متاح';

  return date.toLocaleString('ar-JO', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

interface SummaryCardProps {
  label: string;
  value: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'emerald' | 'blue' | 'amber' | 'violet';
  onClick?: () => void;
}

const SummaryCard: React.FC<SummaryCardProps> = ({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  onClick,
}) => {
  const tones = {
    emerald: {
      icon: 'bg-emerald-500/12 text-emerald-300 border-emerald-500/20',
      glow: 'from-emerald-500/10',
    },
    blue: {
      icon: 'bg-blue-500/12 text-blue-300 border-blue-500/20',
      glow: 'from-blue-500/10',
    },
    amber: {
      icon: 'bg-amber-500/12 text-amber-300 border-amber-500/20',
      glow: 'from-amber-500/10',
    },
    violet: {
      icon: 'bg-violet-500/12 text-violet-300 border-violet-500/20',
      glow: 'from-violet-500/10',
    },
  } as const;

  const content = (
    <>
      <div
        className={`absolute inset-x-0 top-0 h-20 bg-gradient-to-b ${tones[tone].glow} to-transparent pointer-events-none`}
      />
      <div className="relative flex items-start justify-between gap-2">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${tones[tone].icon}`}
        >
          <Icon className="h-4 w-4" />
        </div>
        {onClick && <ChevronLeft className="mt-1 h-4 w-4 text-slate-600" />}
      </div>
      <div className="relative mt-3">
        <p className="text-[11px] font-bold text-slate-400">{label}</p>
        <p className="mt-1 text-xl font-black tracking-tight text-white">
          {value}
        </p>
        <p className="mt-1 text-[10px] leading-4 text-slate-500">{hint}</p>
      </div>
    </>
  );

  const className =
    'relative min-h-28 overflow-hidden rounded-2xl border border-slate-800/90 bg-slate-900/80 p-3 text-right shadow-sm transition';

  if (!onClick) {
    return <div className={className}>{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${className} hover:border-slate-700 active:scale-[0.98]`}
    >
      {content}
    </button>
  );
};

interface OrderRowProps {
  order: HomeDashboardOrder;
  onOpen: () => void;
}

const OrderRow: React.FC<OrderRowProps> = ({ order, onOpen }) => {
  const status = ORDER_STATUS[order.status] || ORDER_STATUS.new;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-800/80 bg-slate-950/70 p-3 text-right transition hover:border-slate-700 active:scale-[0.99]"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-black text-slate-100">
            #{order.orderNumber}
          </span>
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-extrabold ${status.className}`}
          >
            {status.label}
          </span>
        </div>
        <p className="mt-1 truncate text-[10px] text-slate-400">
          {order.customerName} · {formatOrderDate(order.createdAt)}
        </p>
      </div>
      <div className="shrink-0 text-left">
        <p className="text-xs font-black text-emerald-300">
          {formatMinorUnits(order.totalInMinorUnits)} {CURRENCY}
        </p>
        <p className="mt-1 text-[9px] text-slate-500">
          {order.source === 'website'
            ? 'طلب الموقع'
            : order.source === 'pos'
              ? 'بيع مباشر'
              : 'تطبيق الإدارة'}
        </p>
      </div>
    </button>
  );
};

const StockAlertRow: React.FC<{
  item: HomeDashboardStockAlert;
  onReceive: () => void;
  onConfigure: () => void;
}> = ({ item, onReceive, onConfigure }) => {
  const isConfiguration = item.severity === 'configuration';
  const isOut = item.severity === 'out_of_stock';

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-800/80 bg-slate-950/70 p-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
            isConfiguration
              ? 'border-violet-500/30 bg-violet-500/10 text-violet-300'
              : isOut
                ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
          }`}
        >
          {isConfiguration ? (
            <Wrench className="h-4 w-4" />
          ) : isOut ? (
            <PackageX className="h-4 w-4" />
          ) : (
            <Boxes className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-extrabold text-slate-100">
            {item.nameAr}
          </p>
          <p
            className={`mt-0.5 text-[10px] font-bold ${
              isConfiguration
                ? 'text-violet-300'
                : isOut
                  ? 'text-rose-300'
                  : 'text-amber-300'
            }`}
          >
            {isConfiguration
              ? 'أكمل طرد البيع وسعره'
              : isOut
                ? `لا يوجد ${item.saleUnitName} كامل للبيع`
                : `${item.availableSalePackages} ${item.saleUnitName} متاح`}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={isConfiguration ? onConfigure : onReceive}
        className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[10px] font-extrabold transition active:scale-95 ${
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

    const unsubscribe = subscribeToDashboardRealtime(
      () => {
        void loadDashboard(true);
      },
      setRealtimeConnected
    );

    return unsubscribe;
  }, [loadDashboard]);

  if (loading && !data) {
    return (
      <div
        dir="rtl"
        className="mx-auto max-w-5xl space-y-4 p-3 pb-24 sm:p-4"
      >
        <div className="h-36 animate-pulse rounded-3xl border border-slate-800 bg-slate-900" />
        <div className="grid grid-cols-2 gap-2.5">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-36 animate-pulse rounded-2xl border border-slate-800 bg-slate-900"
            />
          ))}
        </div>
        <div className="h-48 animate-pulse rounded-2xl border border-slate-800 bg-slate-900" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div dir="rtl" className="mx-auto max-w-md p-4 pt-10">
        <div className="rounded-3xl border border-rose-800/80 bg-rose-950/50 p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-500/30 bg-rose-500/10 text-rose-300">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-sm font-black text-white">
            تعذر تحميل الصفحة الرئيسية
          </h2>
          <p className="mt-2 text-xs leading-5 text-rose-200/80">{error}</p>
          <button
            type="button"
            onClick={() => void loadDashboard()}
            className="mx-auto mt-5 flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-extrabold text-white transition hover:bg-rose-500 active:scale-95"
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
  const stockIssues =
    summary.lowStockCount +
    summary.outOfStockCount +
    summary.configurationIssuesCount;
  const hasAnyBusinessData =
    summary.activeProductsCount > 0 ||
    summary.activeCustomersCount > 0 ||
    data.latestOrders.length > 0;

  const attentionItems = [
    summary.newOrdersCount > 0
      ? {
          id: 'new-orders',
          title: `${summary.newOrdersCount} طلب جديد بانتظار التأكيد`,
          hint: 'ابدأ بها أولاً حتى لا يتأخر الزبون',
          icon: ClipboardList,
          tone:
            'border-blue-500/25 bg-blue-500/8 text-blue-300 hover:border-blue-500/40',
          onClick: () => setActiveTab('orders'),
        }
      : summary.openOrdersCount > 0
        ? {
            id: 'open-orders',
            title: `${summary.openOrdersCount} طلب قيد التنفيذ`,
            hint: 'تابع التجهيز والتوصيل حتى الإكمال',
            icon: Truck,
            tone:
              'border-blue-500/25 bg-blue-500/8 text-blue-300 hover:border-blue-500/40',
            onClick: () => setActiveTab('orders'),
          }
        : null,
    summary.outOfStockCount + summary.lowStockCount > 0
      ? {
          id: 'stock',
          title: `${summary.outOfStockCount + summary.lowStockCount} صنف يحتاج توريد`,
          hint: 'الكميات محسوبة حسب طرد البيع بالجملة',
          icon: AlertTriangle,
          tone:
            'border-amber-500/25 bg-amber-500/8 text-amber-300 hover:border-amber-500/40',
          onClick: () => setActiveTab('inventory'),
        }
      : null,
    summary.configurationIssuesCount > 0
      ? {
          id: 'configuration',
          title: `${summary.configurationIssuesCount} صنف بحاجة ضبط`,
          hint: 'حدد طرد البيع وسعر الجملة ليظهر في الموقع',
          icon: Wrench,
          tone:
            'border-violet-500/25 bg-violet-500/8 text-violet-300 hover:border-violet-500/40',
          onClick: () => setActiveTab('products'),
        }
      : null,
    summary.customerReceivablesInMinorUnits > 0
      ? {
          id: 'receivables',
          title: `ذمم عملاء بقيمة ${formatMinorUnits(
            summary.customerReceivablesInMinorUnits
          )} ${CURRENCY}`,
          hint: 'راجع الطلبات الآجلة وسجّل الدفعات المستلمة',
          icon: WalletCards,
          tone:
            'border-rose-500/25 bg-rose-500/8 text-rose-300 hover:border-rose-500/40',
          onClick: () => setActiveTab('accounts'),
        }
      : null,
  ].filter(
    (
      item
    ): item is {
      id: string;
      title: string;
      hint: string;
      icon: React.ComponentType<{ className?: string }>;
      tone: string;
      onClick: () => void;
    } => Boolean(item)
  );

  return (
    <div dir="rtl" className="mx-auto max-w-5xl space-y-3 p-3 pb-28 sm:p-4">
      <section
        data-testid="dashboard-hero"
        className="relative overflow-hidden rounded-2xl border border-blue-500/25 bg-[linear-gradient(135deg,rgba(30,64,175,0.34),rgba(15,23,42,0.96)_55%,rgba(6,78,59,0.22))] p-3.5 shadow-xl shadow-slate-950/30 sm:p-5"
      >
        <div className="pointer-events-none absolute -left-10 -top-14 h-40 w-40 rounded-full bg-blue-500/10 blur-3xl" />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-400/25 bg-blue-500/15 text-blue-200">
                <LayoutDashboard className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[10px] font-extrabold tracking-wide text-blue-200">
                  ملخص العمل اليومي
                </p>
                <h2 className="truncate text-base font-black text-white">
                  أهلاً {currentUser?.name || 'بإدارة النواصرة'}
                </h2>
              </div>
            </div>
            <p className="mt-2 max-w-xl text-[10px] leading-5 text-slate-300">
              ابدأ بما يحتاج قرارك الآن، ثم راجع التفاصيل من التقارير عند الحاجة.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadDashboard()}
            disabled={loading}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-700/80 bg-slate-950/40 text-slate-300 transition hover:border-slate-600 hover:text-white disabled:opacity-60"
            aria-label="تحديث ملخص الصفحة الرئيسية"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="relative mt-3 flex flex-wrap items-center gap-2 border-t border-white/8 pt-2.5">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-extrabold ${
              realtimeConnected
                ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                : 'border-slate-700 bg-slate-900/60 text-slate-400'
            }`}
          >
            {realtimeConnected ? (
              <Wifi className="h-3 w-3" />
            ) : (
              <WifiOff className="h-3 w-3" />
            )}
            {realtimeConnected ? 'تحديث مباشر متصل' : 'آخر نسخة محمّلة'}
          </span>
          <span className="text-[9px] text-slate-400">
            آخر تحديث{' '}
            {new Date(data.generatedAt).toLocaleTimeString('ar-JO', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      </section>

      <section aria-labelledby="quick-actions-title">
        <div className="mb-2.5 flex items-center justify-between">
          <div>
            <h3
              id="quick-actions-title"
              className="text-xs font-black text-slate-100"
            >
              إجراءات اليوم
            </h3>
            <p className="mt-0.5 text-[10px] text-slate-500">
              أكثر العمليات استخداماً
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => openModal('receive_goods')}
            className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-right transition hover:border-emerald-500/40 active:scale-[0.98]"
          >
            <PackagePlus className="h-5 w-5 text-emerald-300" />
            <p className="mt-2 text-[11px] font-black text-white">
              استلام بضاعة
            </p>
            <p className="mt-0.5 text-[9px] text-emerald-200/60">من مورد</p>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('pos')}
            className="rounded-2xl border border-blue-500/25 bg-blue-500/10 p-3 text-right transition hover:border-blue-500/40 active:scale-[0.98]"
          >
            <ShoppingBag className="h-5 w-5 text-blue-300" />
            <p className="mt-2 text-[11px] font-black text-white">بيع مباشر</p>
            <p className="mt-0.5 text-[9px] text-blue-200/60">طلب جملة</p>
          </button>
        </div>
      </section>

      {!hasAnyBusinessData && (
        <section className="rounded-2xl border border-blue-500/25 bg-blue-500/8 p-5 text-center">
          <Boxes className="mx-auto h-7 w-7 text-blue-300" />
          <h3 className="mt-3 text-xs font-black text-white">
            ابدأ بإضافة أول صنف
          </h3>
          <p className="mt-1 text-[10px] leading-5 text-slate-400">
            بعدها استلم البضاعة، وستظهر حركة المخزون والمبيعات هنا تلقائياً.
          </p>
        </section>
      )}

      <section aria-labelledby="today-summary-title">
        <div className="mb-2.5">
          <h3
            id="today-summary-title"
            className="text-xs font-black text-slate-100"
          >
            نظرة سريعة
          </h3>
          <p className="mt-0.5 text-[10px] text-slate-500">
            المبيعات تُحسب بعد إكمال الطلب فقط
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <SummaryCard
            label="مبيعات اليوم"
            value={`${formatMinorUnits(
              summary.todaySalesInMinorUnits
            )} ${CURRENCY}`}
            hint={`${summary.todayCompletedOrders} طلب مكتمل اليوم`}
            icon={TrendingUp}
            tone="emerald"
          />
          <SummaryCard
            label="تحتاج متابعة"
            value={`${summary.openOrdersCount} طلب`}
            hint={
              summary.newOrdersCount > 0
                ? `${summary.newOrdersCount} منها جديد`
                : 'لا يوجد طلب جديد'
            }
            icon={ClipboardList}
            tone="blue"
            onClick={() => setActiveTab('orders')}
          />
          <SummaryCard
            label="ذمم العملاء"
            value={`${formatMinorUnits(
              summary.customerReceivablesInMinorUnits
            )} ${CURRENCY}`}
            hint={
              summary.customerReceivablesInMinorUnits > 0
                ? 'متبقي على طلبات مكتملة'
                : 'لا توجد مبالغ مستحقة'
            }
            icon={WalletCards}
            tone="violet"
            onClick={() => setActiveTab('accounts')}
          />
          <SummaryCard
            label="تنبيهات المخزون"
            value={`${stockIssues} صنف`}
            hint={
              stockIssues > 0
                ? `${summary.outOfStockCount} غير متاح للبيع`
                : 'المخزون وطُرُد البيع سليمة'
            }
            icon={AlertTriangle}
            tone="amber"
            onClick={() => setActiveTab('inventory')}
          />
        </div>
      </section>

      <section
        aria-labelledby="attention-title"
        className="rounded-2xl border border-slate-800/90 bg-slate-900/70 p-3.5"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 id="attention-title" className="text-xs font-black text-white">
              يحتاج إجراء الآن
            </h3>
            <p className="mt-0.5 text-[10px] text-slate-500">
              مرتبة حسب أولوية العمل
            </p>
          </div>
          <span className="rounded-full border border-slate-700 bg-slate-950 px-2.5 py-1 text-[9px] font-bold text-slate-400">
            {attentionItems.length} مهام
          </span>
        </div>

        {attentionItems.length === 0 ? (
          <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/8 p-3">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-300" />
            <div>
              <p className="text-[11px] font-black text-emerald-200">
                أمور اليوم تحت السيطرة
              </p>
              <p className="mt-0.5 text-[9px] text-emerald-200/60">
                لا توجد طلبات أو ذمم أو تنبيهات معلقة حالياً.
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {attentionItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  type="button"
                  key={item.id}
                  onClick={item.onClick}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-right transition active:scale-[0.99] ${item.tone}`}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Icon className="h-4 w-4 shrink-0" />
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-black text-slate-100">
                        {item.title}
                      </p>
                      <p className="mt-0.5 truncate text-[9px] text-slate-400">
                        {item.hint}
                      </p>
                    </div>
                  </div>
                  <ChevronLeft className="h-4 w-4 shrink-0 opacity-70" />
                </button>
              );
            })}
          </div>
        )}
      </section>

      <button
        type="button"
        onClick={() => setActiveTab('reports')}
        className="flex w-full items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/70 px-3.5 py-3 text-right transition hover:border-slate-700 active:scale-[0.99]"
      >
        <span className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-300">
            <TrendingUp className="h-4 w-4" />
          </span>
          <span>
            <span className="block text-[11px] font-black text-slate-100">التفاصيل والتقارير</span>
            <span className="mt-0.5 block text-[9px] text-slate-500">
              الربح، المبيعات، الذمم، الورديات وحركة المخزون
            </span>
          </span>
        </span>
        <ChevronLeft className="h-4 w-4 text-slate-600" />
      </button>

      <section
        aria-labelledby="latest-orders-title"
        className="rounded-2xl border border-slate-800/90 bg-slate-900/70 p-3.5"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-4 w-4 text-blue-300" />
            <div>
              <h3 id="latest-orders-title" className="text-xs font-black text-white">
                آخر الطلبات
              </h3>
              <p className="text-[9px] text-slate-500">
                أحدث ما وصل من الموقع والتطبيق
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('orders')}
            className="flex items-center gap-1 text-[10px] font-extrabold text-blue-300"
          >
            الكل
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {data.latestOrders.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 p-5 text-center text-[10px] text-slate-500">
              لا توجد طلبات مسجلة حتى الآن.
            </div>
          ) : (
            data.latestOrders.map((order) => (
              <OrderRow
                key={order.id}
                order={order}
                onOpen={() => openModal('view_order', { id: order.id })}
              />
            ))
          )}
        </div>
      </section>

      <section
        aria-labelledby="stock-alerts-title"
        className="rounded-2xl border border-slate-800/90 bg-slate-900/70 p-3.5"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Boxes className="h-4 w-4 text-amber-300" />
            <div>
              <h3 id="stock-alerts-title" className="text-xs font-black text-white">
                متابعة المخزون
              </h3>
              <p className="text-[9px] text-slate-500">
                الجاهزية محسوبة حسب طرد البيع
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('inventory')}
            className="flex items-center gap-1 text-[10px] font-extrabold text-amber-300"
          >
            المخزون
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {data.stockAlerts.length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/8 p-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-300" />
              <div>
                <p className="text-[11px] font-black text-emerald-200">
                  المخزون جاهز للبيع
                </p>
                <p className="mt-0.5 text-[9px] text-emerald-200/60">
                  لا يوجد صنف تحت حد التوريد أو بحاجة ضبط.
                </p>
              </div>
            </div>
          ) : (
            data.stockAlerts.map((item) => (
              <StockAlertRow
                key={item.id}
                item={item}
                onReceive={() => openModal('receive_goods', { productId: item.id })}
                onConfigure={() => setActiveTab('products')}
              />
            ))
          )}
        </div>
      </section>

      <footer className="flex items-center justify-center gap-2 pb-2 text-[9px] text-slate-600">
        <Landmark className="h-3 w-3" />
        <span>كل الأرقام من RPC موحد ومباشر في Supabase.</span>
      </footer>
    </div>
  );
};
