import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { fetchOrderByIdFromSupabase, fetchOperationalOrdersPageFromSupabase, type OperationalOrderListItem, type OperationalOrdersSort, subscribeToOrdersInSupabase } from '../../services/supabase/orders.service';
import { useAppStoreActions } from '../../stores/useAppStore';
import type { Order } from '../../types';
import { getOrderStatus, getPaymentLabel, orderSourceLabel } from './orderStatus';
import type { OperationalOrderFilter } from '../../utils/orderCalculations';
import { formatOperationalOrderContents } from '../../utils/orderPresentation';
import { Card, DetailLayout, DetailPanel, MainColumn, FilterChips, SearchField, PageHeader, TableShell, Th, Tr, Td, StatusBadge, MoneyText, UiButton, formatUiDate } from '../../components/ui';
import { OrderDetailModal } from './OrderDetailModal';

const FILTERS: Array<{ id: OperationalOrderFilter; label: string }> = [
  { id: 'all', label: 'الكل' }, { id: 'action', label: 'بحاجة لمراجعة' },
  { id: 'active', label: 'قيد التنفيذ' }, { id: 'completed', label: 'مكتملة' },
  { id: 'returned', label: 'مرتجعة' }, { id: 'cancelled', label: 'ملغاة' },
];
const PAGE_SIZE = 25;

const PAYMENT_LABELS: Record<string, string> = { cash: 'كاش', cliq: 'CliQ', cash_on_delivery: 'كاش عند الاستلام', debt: 'دين', mixed: 'مختلط', card: 'بطاقة', bank_transfer: 'تحويل بنكي' };

export const OperationalOrderCard: React.FC<{
  order: OperationalOrderListItem; onOpen: (orderId: string) => void; selected?: boolean; source?: string;
}> = ({ order, onOpen, selected = false, source }) => {
  const status = getOrderStatus(order.status);
  const payment = getPaymentLabel(order);
  const contentsLabel = formatOperationalOrderContents(order.firstProductName, order.itemCount);
  return <article data-order-card={order.id} className={`rounded-2xl border border-s-4 ${status.border} border-nw-border ${selected ? 'bg-nw-sel-row' : 'bg-nw-surface'} p-3 text-nw-text`}>
    <button type="button" onClick={() => onOpen(order.id)} aria-label={`فتح الطلب ${order.orderNumber}`} aria-pressed={selected} className="min-h-11 w-full space-y-2 text-right">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <bdi dir="ltr" title={order.orderNumber} className="min-w-0 break-all text-sm font-bold">{order.orderNumber}</bdi>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1"><h3 className="m-0 break-words text-sm font-bold">{order.customerName}</h3><p className="m-0 mt-1 break-words text-xs text-nw-muted">{contentsLabel}</p></div>
        <MoneyText amount={order.totalAmount} className="text-sm font-bold" />
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-xs text-nw-muted">
        <span>{orderSourceLabel(source)} · {PAYMENT_LABELS[order.paymentMethod] ?? order.paymentMethod}</span>
        <bdi dir="ltr">{formatUiDate(order.createdAt, { hour: '2-digit', minute: '2-digit', hour12: false })}</bdi>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2"><StatusBadge tone={payment.tone}>{payment.label}</StatusBadge><span className="flex min-h-11 items-center gap-1 text-xs text-nw-primary"><CheckCircle2 className="h-3.5 w-3.5" />فتح ومراجعة الطلب</span></div>
    </button>
  </article>;
};

interface OrdersWorkbenchProps {
  orders: OperationalOrderListItem[]; activeFilter: OperationalOrderFilter;
  counts: Partial<Record<OperationalOrderFilter, number>>; summary: { review: number; active: number; due: number };
  searchQuery: string; sort: OperationalOrdersSort; page: number; totalCount: number; totalPages: number;
  selectedOrderId: string | null; sourceFor: (id: string) => string | undefined; detail: React.ReactNode;
  loading: boolean; refreshing: boolean; error: string | null;
  listLoadVersion?: number; restoreAfterVersion?: number;
  onOpen: (id: string) => void; onFilter: (value: OperationalOrderFilter) => void;
  onSearch: (value: string) => void; onSort: (value: OperationalOrdersSort) => void;
  onPage: (value: number) => void; onRefresh: () => void;
}
export const OrdersWorkbench: React.FC<OrdersWorkbenchProps> = (props) => {
  const { orders, activeFilter, counts, summary, searchQuery, sort, page, totalCount, totalPages, selectedOrderId, sourceFor, detail, loading, refreshing, error, listLoadVersion = 0, restoreAfterVersion = 0, onOpen, onFilter, onSearch, onSort, onPage, onRefresh } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const returnPointRef = useRef<{ orderId: string; container: HTMLElement; scrollTop: number } | null>(null);
  const returnPanelRef = useRef<HTMLElement | null>(null);
  const openFromList = (orderId: string) => {
    returnPointRef.current = null;
    returnPanelRef.current = null;
    if (window.matchMedia('(max-width: 767px)').matches) {
      let container = rootRef.current?.parentElement;
      while (container && !/^(auto|scroll)$/.test(getComputedStyle(container).overflowY)) container = container.parentElement;
      if (container) returnPointRef.current = { orderId, container, scrollTop: container.scrollTop };
    }
    onOpen(orderId);
  };
  useLayoutEffect(() => {
    const point = returnPointRef.current;
    if (point && selectedOrderId) {
      returnPanelRef.current = rootRef.current?.querySelector<HTMLElement>('[data-testid="order-detail-panel"]') ?? null;
    }
    // Close starts another real list read. Its accepted render, not the old
    // DOM or the opening request, is the restoration boundary.
    if (!point || selectedOrderId || loading || listLoadVersion < restoreAfterVersion) return;
    returnPointRef.current = null;
    if (!point.container.isConnected) return;
    const card = rootRef.current?.querySelector<HTMLElement>(`[data-order-card="${CSS.escape(point.orderId)}"] button`);
    const active = document.activeElement;
    const restoreFocus = !active || active === document.body || returnPanelRef.current?.contains(active) === true;
    returnPanelRef.current = null;
    // The accepted read may arrive after the user has started searching or
    // filtering. Their new interaction wins; never move its focus or scroll.
    // If dialog cleanup already restored this same card, only restore scroll.
    if (!restoreFocus && active !== card) return;
    point.container.scrollTop = point.scrollTop;
    if (restoreFocus) card?.focus({ preventScroll: true });
    if (card) {
      const bounds = card.getBoundingClientRect();
      const viewport = point.container.getBoundingClientRect();
      if (bounds.bottom <= viewport.top || bounds.top >= viewport.bottom) card.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedOrderId, loading, listLoadVersion, restoreAfterVersion]);
  return <div ref={rootRef} dir="rtl" data-testid="orders-workbench" className="min-w-0 bg-nw-bg text-nw-text">
    <PageHeader title="الطلبات" description="راجع الطلبات وتابع التجهيز والتوصيل وخدمات ما بعد البيع." actions={<>
      <UiButton onClick={onRefresh} disabled={refreshing}><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />تحديث</UiButton>
      <label className="flex min-h-11 items-center gap-2 text-sm text-nw-muted"><span className="sr-only">ترتيب الطلبات</span><select value={sort} onChange={(event) => onSort(event.target.value as OperationalOrdersSort)} className="min-h-11 rounded-xl border border-nw-border bg-nw-surface px-3 text-nw-text"><option value="newest">الأحدث</option><option value="oldest">الأقدم</option></select></label>
    </>} />
    <div className="space-y-4 p-4 pb-8 sm:p-6">
      <DetailLayout>
        <MainColumn>
          <FilterChips touchSize label="حالات الطلبات" value={activeFilter} onChange={onFilter} options={FILTERS.map((filter) => ({ value: filter.id, label: filter.label, count: counts[filter.id] }))} />
          <SearchField label="البحث في الطلبات" placeholder="ابحث برقم الطلب أو اسم العميل أو الهاتف" value={searchQuery} onChange={(event) => onSearch(event.target.value)} className="w-full sm:max-w-md" />
          <p className="m-0 text-xs text-nw-muted">بحاجة لمراجعة: {summary.review} · قيد التنفيذ: {summary.active} · ذمم الطلبات المكتملة: <MoneyText amount={summary.due} />. تتحدث القائمة تلقائياً.</p>
          {error && <Card role="alert" className="flex items-center gap-2 text-nw-bad"><AlertCircle className="h-4 w-4 shrink-0" />{error}</Card>}
          {loading ? <Card role="status" className="text-center text-nw-muted"><RefreshCw className="mx-auto mb-2 h-6 w-6 animate-spin" />جاري تحميل الطلبات...</Card> : orders.length === 0 ? <Card className="text-center"><h2 className="text-base font-bold">لا توجد طلبات في هذا القسم</h2><p className="text-sm text-nw-muted">غيّر القسم أو البحث لعرض الطلبات.</p></Card> : <>
            <div className="space-y-3 md:hidden">{orders.map((order) => <OperationalOrderCard key={order.id} order={order} onOpen={openFromList} selected={selectedOrderId === order.id} source={sourceFor(order.id)} />)}</div>
            <div className="hidden md:block"><TableShell caption="قائمة الطلبات" minWidth={650} head={<>{['رقم الطلب', 'العميل', 'المصدر', 'الدفع', 'الحالة', 'الوقت', 'الإجمالي'].map((label) => <Th key={label}>{label}</Th>)}</>}>
              {orders.map((order) => { const status = getOrderStatus(order.status); const payment = getPaymentLabel(order); return <Tr key={order.id} selected={selectedOrderId === order.id}>
                <Td className="whitespace-nowrap"><UiButton onClick={() => onOpen(order.id)} aria-label={`فتح الطلب ${order.orderNumber}`} className="whitespace-nowrap px-1"><bdi dir="ltr" data-order-number className="whitespace-nowrap font-bold">{order.orderNumber}</bdi></UiButton></Td>
                <Td className="max-w-[180px] break-words">{order.customerName}</Td><Td className="text-xs text-nw-muted">{orderSourceLabel(sourceFor(order.id))}</Td>
                <Td><span className="text-xs">{PAYMENT_LABELS[order.paymentMethod] ?? order.paymentMethod}</span><div className="mt-1"><StatusBadge tone={payment.tone}>{payment.label}</StatusBadge></div></Td>
                <Td><StatusBadge tone={status.tone}>{status.label}</StatusBadge></Td><Td className="whitespace-nowrap"><bdi dir="ltr" data-order-time className="whitespace-nowrap text-xs text-nw-muted">{formatUiDate(order.createdAt, { hour: '2-digit', minute: '2-digit', hour12: false })}</bdi></Td>
                <Td><MoneyText amount={order.totalAmount} className="font-bold" /></Td>
              </Tr>; })}
            </TableShell></div>
          </>}
          {!loading && totalCount > 0 && <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-nw-muted"><span><bdi dir="ltr">{page} / {totalPages}</bdi> · {totalCount} طلب</span><div className="flex gap-2"><UiButton onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1}><ChevronRight className="h-4 w-4" />السابق</UiButton><UiButton onClick={() => onPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}>التالي<ChevronLeft className="h-4 w-4" /></UiButton></div></div>}
        </MainColumn>
        {selectedOrderId && <DetailPanel data-testid="order-detail-panel" className="fixed inset-0 z-40 w-full max-md:rounded-none max-md:border-0 max-md:bg-nw-bg md:static md:z-auto md:p-4">
          <div data-testid="order-detail-scroll" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:overflow-visible md:p-0">{detail}</div>
        </DetailPanel>}
      </DetailLayout>
    </div>
  </div>;
};

export const OrdersCenterView: React.FC = () => {
  const { setToast } = useAppStoreActions();
  const [activeFilter, setActiveFilter] =
    useState<OperationalOrderFilter>('action');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [sort, setSort] = useState<OperationalOrdersSort>('newest');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [selectedOrderLoading, setSelectedOrderLoading] = useState(false);
  const [selectedOrderError, setSelectedOrderError] = useState<string | null>(null);
  const [orders, setOrders] = useState<OperationalOrderListItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [counts, setCounts] = useState<Partial<Record<OperationalOrderFilter, number>>>({});
  const [summary, setSummary] = useState({ review: 0, active: 0, due: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestVersionRef = useRef(0);
  const detailRequestVersionRef = useRef(0);
  const [listLoadVersion, setListLoadVersion] = useState(0);
  const [restoreAfterVersion, setRestoreAfterVersion] = useState(0);

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
      if (page > result.totalPages) {
        setPage(result.totalPages);
        if (!silent) setLoading(false);
        return;
      }
      setOrders(result.orders);
      setTotalCount(result.totalCount);
      setTotalPages(result.totalPages);
      setSummary(result.summary);
      setCounts((previous) => ({ ...previous, [activeFilter]: result.totalCount, action: result.summary.review, active: result.summary.active }));
    } else {
      setError(result.error || 'تعذر تحميل الطلبات.');
    }
    if (!silent) setLoading(false);
    setListLoadVersion(requestVersion);
  }, [activeFilter, debouncedSearchQuery, page, sort]);

  const loadOrderDetails = useCallback(
    async (orderId: string, silent = false) => {
      const requestVersion = ++detailRequestVersionRef.current;
      if (!silent) setSelectedOrderLoading(true);
      setSelectedOrderError(null);
      const result = await fetchOrderByIdFromSupabase(orderId);
      if (requestVersion !== detailRequestVersionRef.current) return;

      if (result.success && result.order) {
        setSelectedOrder(result.order);
      } else {
        setSelectedOrderError(result.error || 'تعذر تحميل تفاصيل الطلب.');
      }
      if (!silent) setSelectedOrderLoading(false);
    },
    []
  );

  const openOrderDetails = (orderId: string) => {
    setSelectedOrderId(orderId);
    setSelectedOrder(null);
    void loadOrderDetails(orderId);
  };

  const closeOrderDetails = () => {
    detailRequestVersionRef.current += 1;
    setRestoreAfterVersion(requestVersionRef.current + 1);
    setSelectedOrderId(null);
    setSelectedOrder(null);
    setSelectedOrderError(null);
    setSelectedOrderLoading(false);
  };

  const refreshSelectedOrder = useCallback(async () => {
    if (!selectedOrderId) return;
    await Promise.all([
      loadOrders(true),
      loadOrderDetails(selectedOrderId, true),
    ]);
  }, [loadOrderDetails, loadOrders, selectedOrderId]);

  useEffect(() => {
    let mounted = true;
    loadOrders();
    const unsubscribe = subscribeToOrdersInSupabase((payload) => {
      if (!mounted) return;
      if (payload.eventType === 'INSERT') {
        setToast('وصل طلب جديد من المتجر الإلكتروني.', 'success');
      }
      if (
        payload.eventType === 'INSERT' &&
        sort === 'newest' &&
        (activeFilter === 'all' || activeFilter === 'action') &&
        page !== 1
      ) {
        setPage(1);
      } else {
        void loadOrders(true);
      }

      if (
        selectedOrderId &&
        payload.orderIds.includes(selectedOrderId)
      ) {
        void loadOrderDetails(selectedOrderId, true);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [activeFilter, loadOrderDetails, loadOrders, page, selectedOrderId, setToast, sort]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadOrders(true);
    } finally {
      setRefreshing(false);
    }
  };

  return <OrdersWorkbench orders={orders} activeFilter={activeFilter} counts={counts} summary={summary} searchQuery={searchQuery} sort={sort} page={page} totalCount={totalCount} totalPages={totalPages}
    listLoadVersion={listLoadVersion} restoreAfterVersion={restoreAfterVersion}
    selectedOrderId={selectedOrderId} sourceFor={(id) => selectedOrder?.id === id ? selectedOrder.source : undefined} loading={loading} refreshing={refreshing} error={error}
    onOpen={openOrderDetails} onFilter={(value) => { setActiveFilter(value); setPage(1); }}
    onSearch={(value) => { setSearchQuery(value); setCounts({}); setPage(1); }} onSort={(value) => { setSort(value); setPage(1); }} onPage={setPage} onRefresh={() => void handleRefresh()}
    detail={selectedOrderLoading ? <div className="space-y-3 text-center text-nw-muted"><UiButton aria-label="رجوع للطلبات" onClick={closeOrderDetails} className="md:hidden"><ChevronRight className="h-4 w-4" />رجوع للطلبات</UiButton><div role="status"><RefreshCw className="mx-auto h-6 w-6 animate-spin" />جاري تحميل تفاصيل الطلب...</div><UiButton onClick={closeOrderDetails} className="hidden md:inline-flex">إغلاق</UiButton></div>
      : selectedOrderError || !selectedOrder ? <div className="space-y-3 text-nw-bad"><UiButton aria-label="رجوع للطلبات" onClick={closeOrderDetails} className="md:hidden"><ChevronRight className="h-4 w-4" />رجوع للطلبات</UiButton><p role="alert">{selectedOrderError || 'تعذر تحميل تفاصيل الطلب.'}</p><UiButton onClick={() => selectedOrderId && void loadOrderDetails(selectedOrderId)}>إعادة المحاولة</UiButton><UiButton onClick={closeOrderDetails} className="hidden md:inline-flex">إغلاق</UiButton></div>
      : <OrderDetailModal key={selectedOrder.id} embedded order={selectedOrder} onOrderChanged={refreshSelectedOrder} onClose={closeOrderDetails} />}
  />;
};
