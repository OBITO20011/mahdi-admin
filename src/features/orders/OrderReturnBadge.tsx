import React, { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Card, StatusBadge, UiButton, formatUiDate } from '../../components/ui';
import { fetchRecentReturnedOrders, type ReturnedOrderSummary } from '../../services/supabase/orderReturnStates.service';
import { useOrderReturnStates } from './useOrderReturnStates';
import { orderReturnBadgeLabel, type OrderReturnState } from '../../utils/orderReturnState';

export const OrderReturnBadge: React.FC<{ state?: OrderReturnState | null }> = ({ state }) =>
  state ? <StatusBadge tone={state.kind === 'full' ? 'bad' : 'warn'}><span data-order-return-badge={state.kind}>{orderReturnBadgeLabel(state)}</span></StatusBadge> : null;

export const OrderReturnBadgeForOrder: React.FC<{ orderId: string; refreshKey?: unknown }> = ({ orderId, refreshKey }) => {
  const states = useOrderReturnStates([orderId], refreshKey);
  return <OrderReturnBadge state={states.get(orderId)} />;
};

/** «مرتجعة» tab: invoices that stay «مكتمل» but have a settled after-sale return. */
export const ReturnedAfterSaleOrders: React.FC<{ onOpen: (orderId: string) => void; refreshKey?: unknown }> = ({ onOpen, refreshKey }) => {
  const [rows, setRows] = useState<ReturnedOrderSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setFailed(false);
    fetchRecentReturnedOrders().then((next) => { if (active) setRows(next); }).catch(() => { if (active) { setRows(null); setFailed(true); } });
    return () => { active = false; };
  }, [refreshKey]);
  if (failed) return <Card role="status" className="text-xs text-nw-muted">تعذر تحميل الفواتير التي فيها مرتجع بعد البيع؛ القائمة أدناه تعرض الطلبات المرتجعة بالكامل فقط.</Card>;
  if (!rows || rows.length === 0) return null;
  return <Card data-testid="returned-after-sale-orders" className="space-y-2">
    <h2 className="m-0 flex items-center gap-2 text-sm font-bold"><RotateCcw className="h-4 w-4 text-nw-warn" />فواتير فيها مرتجع بعد البيع ({rows.length})</h2>
    <p className="m-0 text-xs text-nw-muted">حالتها تضل «مكتمل»؛ الشارة توضح إذا المرتجع كامل أو جزئي.</p>
    <ul className="m-0 list-none space-y-2 p-0">
      {rows.map((row) => <li key={row.id}>
        <UiButton onClick={() => onOpen(row.id)} aria-label={`فتح الطلب ${row.orderNumber}`} className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 text-right">
          <span className="min-w-0"><bdi dir="ltr" className="font-bold">{row.orderNumber}</bdi> · <span className="break-words">{row.customerName}</span></span>
          <span className="flex flex-wrap items-center gap-2"><OrderReturnBadge state={row.state} /><bdi dir="ltr" className="text-xs text-nw-muted">{formatUiDate(row.lastReturnAt, { hour: '2-digit', minute: '2-digit', hour12: false })}</bdi></span>
        </UiButton>
      </li>)}
    </ul>
  </Card>;
};
