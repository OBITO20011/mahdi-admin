import React, { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Card, StatusBadge, UiButton, formatUiDate } from '../../components/ui';
import { fetchRecentReturnedOrders, type ReturnedOrderSummary } from '../../services/supabase/orderReturnStates.service';
import { useOrderReturnStates } from './useOrderReturnStates';
import { orderReturnBadgeLabel, type OrderReturnState } from '../../utils/orderReturnState';
import { RECENT_RETURNED_ORDERS_LIMIT, matchesReturnedOrderSearch } from '../../utils/returnedOrdersSearch';

export const OrderReturnBadge: React.FC<{ state?: OrderReturnState | null }> = ({ state }) =>
  state ? <StatusBadge tone={state.kind === 'full' ? 'bad' : 'warn'}><span data-order-return-badge={state.kind}>{orderReturnBadgeLabel(state)}</span></StatusBadge> : null;

export const OrderReturnBadgeForOrder: React.FC<{ orderId: string; refreshKey?: unknown }> = ({ orderId, refreshKey }) => {
  const states = useOrderReturnStates([orderId], refreshKey);
  return <OrderReturnBadge state={states.get(orderId)} />;
};

/**
 * «مرتجعة» tab: invoices that stay «مكتمل» but have a settled after-sale return.
 * Codex review 2026-11-23 #4: this is only the latest RECENT_RETURNED_ORDERS_LIMIT invoices.
 * The box says so, follows the search text, and points to «كل الطلبات» for older invoices.
 */
export const ReturnedAfterSaleOrders: React.FC<{ onOpen: (orderId: string) => void; refreshKey?: unknown; searchQuery?: string }> = ({ onOpen, refreshKey, searchQuery = '' }) => {
  const [rows, setRows] = useState<ReturnedOrderSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setFailed(false);
    fetchRecentReturnedOrders(RECENT_RETURNED_ORDERS_LIMIT).then((next) => { if (active) setRows(next); }).catch(() => { if (active) { setRows(null); setFailed(true); } });
    return () => { active = false; };
  }, [refreshKey]);
  if (failed) return <Card role="status" className="text-xs text-nw-muted">تعذر تحميل الفواتير التي فيها مرتجع بعد البيع؛ القائمة أدناه تعرض الطلبات المرتجعة بالكامل فقط.</Card>;
  if (!rows || rows.length === 0) return null;
  const searching = searchQuery.trim() !== '';
  const visible = rows.filter((row) => matchesReturnedOrderSearch(row, searchQuery));
  const olderHint = 'للفاتورة الأقدم ابحث برقمها في «كل الطلبات».';
  if (searching && visible.length === 0) return <Card role="status" data-testid="returned-after-sale-no-match" className="text-xs text-nw-muted">لا توجد نتيجة للبحث بين آخر {RECENT_RETURNED_ORDERS_LIMIT} فاتورة فيها مرتجع بعد البيع. {olderHint}</Card>;
  return <Card data-testid="returned-after-sale-orders" className="space-y-2">
    <h2 className="m-0 flex items-center gap-2 text-sm font-bold"><RotateCcw className="h-4 w-4 text-nw-warn" />آخر الفواتير التي فيها مرتجع بعد البيع ({visible.length})</h2>
    <p data-testid="returned-after-sale-scope" className="m-0 text-xs text-nw-muted">تعرض آخر {RECENT_RETURNED_ORDERS_LIMIT} فاتورة فقط{searching ? '، مع تطبيق البحث' : ''}. {olderHint} حالتها تبقى «مكتمل»، والشارة توضح إذا كان المرتجع كاملاً أو جزئياً.</p>
    <ul className="m-0 list-none space-y-2 p-0">
      {visible.map((row) => <li key={row.id}>
        <UiButton onClick={() => onOpen(row.id)} aria-label={`فتح الطلب ${row.orderNumber}`} className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 text-right">
          <span className="min-w-0"><bdi dir="ltr" className="font-bold">{row.orderNumber}</bdi> · <span className="break-words">{row.customerName}</span></span>
          <span className="flex flex-wrap items-center gap-2"><OrderReturnBadge state={row.state} /><bdi dir="ltr" className="text-xs text-nw-muted">{formatUiDate(row.lastReturnAt, { hour: '2-digit', minute: '2-digit', hour12: false })}</bdi></span>
        </UiButton>
      </li>)}
    </ul>
  </Card>;
};
