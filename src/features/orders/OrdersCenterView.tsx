import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  MapPin,
  PackageCheck,
  Phone,
  RefreshCw,
  Search,
  ShoppingBag,
} from 'lucide-react';
import { CURRENCY } from '../../constants';
import {
  fetchOperationalOrdersPageFromSupabase,
  OperationalOrdersSort,
  subscribeToOrdersInSupabase,
} from '../../services/supabase/orders.service';
import { useAppStoreActions } from '../../stores/useAppStore';
import { Order, OrderStatus } from '../../types';
import { OperationalOrderFilter } from '../../utils/orderCalculations';
import { OrderDetailModal } from './OrderDetailModal';

const FILTERS: Array<{ id: OperationalOrderFilter; label: string }> = [
  { id: 'all', label: 'الكل' },
  { id: 'action', label: 'بحاجة لمراجعة' },
  { id: 'active', label: 'قيد التنفيذ' },
  { id: 'completed', label: 'مكتملة' },
  { id: 'returned', label: 'مرتجعة' },
  { id: 'cancelled', label: 'ملغاة' },
];

const PAGE_SIZE = 25;

function getStatusBadge(status: OrderStatus | string) {
  const badges: Record<string, { label: string; color: string }> = {
    new: {
      label: 'جديد',
      color: 'border-blue-500/30 bg-blue-500/15 text-blue-300',
    },
    confirmed: {
      label: 'مؤكد',
      color: 'border-amber-500/30 bg-amber-500/15 text-amber-300',
    },
    preparing: {
      label: 'قيد التجهيز',
      color: 'border-violet-500/30 bg-violet-500/15 text-violet-300',
    },
    processing: {
      label: 'قيد التجهيز',
      color: 'border-violet-500/30 bg-violet-500/15 text-violet-300',
    },
    ready: {
      label: 'جاهز',
      color: 'border-indigo-500/30 bg-indigo-500/15 text-indigo-300',
    },
    out_for_delivery: {
      label: 'خرج للتوصيل',
      color: 'border-cyan-500/30 bg-cyan-500/15 text-cyan-300',
    },
    delivered: {
      label: 'مكتمل',
      color: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300',
    },
    completed: {
      label: 'مكتمل',
      color: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300',
    },
    returned: {
      label: 'مرتجع',
      color: 'border-orange-500/30 bg-orange-500/15 text-orange-300',
    },
    cancelled: {
      label: 'ملغي',
      color: 'border-slate-600 bg-slate-800 text-slate-400',
    },
  };
  return (
    badges[status] || {
      label: status,
      color: 'border-slate-700 bg-slate-800 text-slate-300',
    }
  );
}

function getPaymentLabel(order: Order) {
  if (order.paymentStatus === 'refunded') {
    return {
      label: 'تم رد المبلغ',
      color: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
    };
  }
  if (order.paymentStatus === 'paid') {
    return {
      label: 'مدفوع',
      color: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    };
  }
  if (order.paymentStatus === 'partially_paid') {
    return {
      label: `متبقي ${(order.amountDue || 0).toFixed(3)}`,
      color: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    };
  }
  return {
    label: 'غير مدفوع',
    color: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  };
}

export const OrdersCenterView: React.FC = () => {
  const { setToast } = useAppStoreActions();
  const [activeFilter, setActiveFilter] =
    useState<OperationalOrderFilter>('action');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [sort, setSort] = useState<OperationalOrdersSort>('newest');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [summary, setSummary] = useState({ review: 0, active: 0, due: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestVersionRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearchQuery(searchQuery),
      250
    );
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const loadOrders = useCallback(async (silent = false) => {
    const requestVersion = ++requestVersionRef.current;
    if (!silent) setLoading(true);
    setError(null);
    const result = await fetchOperationalOrdersPageFromSupabase({
      page,
      pageSize: PAGE_SIZE,
      filter: activeFilter,
      searchQuery: debouncedSearchQuery,
      sort,
    });

    if (requestVersion !== requestVersionRef.current) return;

    if (result.success) {
      setOrders(result.orders);
      setTotalCount(result.totalCount);
      setTotalPages(result.totalPages);
      setSummary(result.summary);
    } else {
      setError(result.error || 'تعذر تحميل الطلبات.');
    }
    if (!silent) setLoading(false);
  }, [activeFilter, debouncedSearchQuery, page, sort]);

  useEffect(() => {
    let mounted = true;
    loadOrders();
    const unsubscribe = subscribeToOrdersInSupabase((payload) => {
      if (!mounted) return;
      if (payload.eventType === 'INSERT') {
        setToast('وصل طلب جديد من المتجر الإلكتروني.', 'success');
      }
      loadOrders(true);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [loadOrders, setToast]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadOrders(true);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div dir="rtl" className="space-y-4 p-3 pb-24 text-xs">
      <div className="rounded-2xl border border-slate-800 bg-gradient-to-l from-blue-950/70 to-slate-900 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-black text-white">
              <ShoppingBag className="h-5 w-5 text-blue-400" />
              طلبات اليوم
            </h2>
            <p className="mt-1 max-w-md text-[11px] leading-5 text-slate-400">
              ابدأ بما يحتاج إجراءً الآن؛ التفاصيل والحساب تظهر عند فتح الطلب.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex shrink-0 items-center gap-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 font-bold text-slate-300"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
            />
            تحديث
          </button>
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as OperationalOrdersSort);
              setPage(1);
            }}
            className="rounded-xl border border-slate-700 bg-slate-800 px-2 py-2 text-[10px] font-bold text-slate-300 outline-none"
            aria-label="ترتيب الطلبات"
          >
            <option value="newest">الأحدث</option>
            <option value="oldest">الأقدم</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-3">
          <Clock3 className="mb-1 h-4 w-4 text-blue-400" />
          <span className="block text-[9px] text-slate-500">بحاجة لمراجعة</span>
          <strong className="text-sm text-blue-300">{summary.review}</strong>
        </div>
        <div className="rounded-2xl border border-violet-500/30 bg-violet-500/10 p-3">
          <PackageCheck className="mb-1 h-4 w-4 text-violet-400" />
          <span className="block text-[9px] text-slate-500">قيد التنفيذ</span>
          <strong className="text-sm text-violet-300">{summary.active}</strong>
        </div>
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3">
          <CircleDollarSign className="mb-1 h-4 w-4 text-rose-400" />
          <span className="block text-[9px] text-slate-500">ذمم قيد التحصيل</span>
          <strong className="text-xs text-rose-300">
            {summary.due.toFixed(3)}
          </strong>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          value={searchQuery}
          onChange={(event) => {
            setSearchQuery(event.target.value);
            setPage(1);
          }}
          placeholder="ابحث برقم الطلب أو اسم العميل أو الهاتف"
          className="w-full rounded-2xl border border-slate-800 bg-slate-900 py-2.5 pl-3 pr-9 text-slate-100 outline-none focus:border-blue-500"
        />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {FILTERS.map((filter) => (
          <button
            type="button"
            key={filter.id}
            onClick={() => {
              setActiveFilter(filter.id);
              setPage(1);
            }}
            className={`shrink-0 rounded-xl border px-3 py-2 font-bold transition ${
              activeFilter === filter.id
                ? 'border-blue-500 bg-blue-600 text-white'
                : 'border-slate-800 bg-slate-900 text-slate-400'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-rose-800 bg-rose-950/50 p-3 text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center text-slate-400">
          <RefreshCw className="mx-auto mb-2 h-7 w-7 animate-spin text-blue-400" />
          جاري تحميل طلبات المتجر...
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-9 text-center">
          <ShoppingBag className="mx-auto mb-2 h-10 w-10 text-slate-600" />
          <h3 className="font-black text-white">لا توجد طلبات في هذا القسم</h3>
          <p className="mt-1 text-[11px] text-slate-500">
            ستظهر هنا الطلبات الجديدة القادمة من موقع الزبائن.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {orders.map((order) => {
            const status = getStatusBadge(order.status);
            const payment = getPaymentLabel(order);
            return (
              <article
                key={order.id}
                className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow"
              >
                <button
                  type="button"
                  onClick={() => setSelectedOrder(order)}
                  className="w-full text-right"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[11px] font-black text-blue-400">
                          {order.orderNumber}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${status.color}`}
                        >
                          {status.label}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${payment.color}`}
                        >
                          {payment.label}
                        </span>
                      </div>
                      <h4 className="font-bold text-white">
                        {order.customerName}
                      </h4>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3 text-emerald-400" />
                          {order.customerPhone || 'بدون هاتف'}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3 text-amber-400" />
                          {order.governorate} — {order.region}
                        </span>
                      </div>
                    </div>
                    <div className="text-left">
                      <strong className="block text-sm text-emerald-400">
                        {order.totalAmount.toFixed(3)} {CURRENCY}
                      </strong>
                      <span className="text-[9px] text-slate-500">
                        {new Date(order.createdAt).toLocaleDateString('ar-JO')}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-slate-800 pt-2">
                    <span className="text-[10px] text-slate-500">
                      {(order.items || []).length} أصناف
                    </span>
                    <span className="flex items-center gap-1 font-bold text-blue-300">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      فتح ومراجعة الطلب
                    </span>
                  </div>
                </button>
              </article>
            );
          })}
        </div>
      )}

      {!loading && totalCount > 0 && (
        <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900 p-2 font-bold">
          <button
            type="button"
            onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
            disabled={page <= 1}
            className="flex items-center gap-1 rounded-xl bg-slate-800 px-3 py-2 text-slate-300 disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
            السابق
          </button>
          <span className="text-[10px] text-slate-400">
            {page} / {totalPages} · {totalCount} طلب
          </span>
          <button
            type="button"
            onClick={() =>
              setPage((currentPage) => Math.min(totalPages, currentPage + 1))
            }
            disabled={page >= totalPages}
            className="flex items-center gap-1 rounded-xl bg-slate-800 px-3 py-2 text-slate-300 disabled:opacity-40"
          >
            التالي
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>
      )}

      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="max-h-[94vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl">
            <OrderDetailModal
              order={
                orders.find((order) => order.id === selectedOrder.id) ||
                selectedOrder
              }
              onClose={() => setSelectedOrder(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
};
