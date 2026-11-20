import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import { summarizeOrderReturns, type OrderReturnState } from '../../utils/orderReturnState';

/**
 * Read-only presentation reads for owner trial item 9. Both tables are readable by
 * active ERP staff under the existing 225 RLS policies; nothing here writes.
 */
const RETURN_STATE_ERROR = 'ORDER-RETURNS-01: تعذر قراءة حالة المرتجعات.';

// Query arguments use the access diagnostic's fixture names (orderIds) so every site is replayed for real roles.
export async function fetchOrderReturnStates(visibleOrderIds: readonly string[]): Promise<Map<string, OrderReturnState>> {
  const orderIds = [...new Set(visibleOrderIds.filter(Boolean))];
  const client = supabase;
  if (!orderIds.length || !isSupabaseConfigured || !client) return new Map();
  const events = await client.from('sales_return_events')
    .select('order_id,merchandise_refund_amount_in_minor_units')
    .eq('settlement_status', 'settled')
    .in('order_id', orderIds);
  if (events.error) throw Error(RETURN_STATE_ERROR);
  if (!(events.data ?? []).length) return new Map();
  const orders = await client.from('orders')
    .select('id,total_in_minor_units,delivery_fee_in_minor_units')
    .in('id', orderIds);
  if (orders.error) throw Error(RETURN_STATE_ERROR);
  return summarizeOrderReturns(events.data ?? [], orders.data ?? []);
}

export interface ReturnedOrderSummary {
  id: string;
  orderNumber: string;
  customerName: string;
  lastReturnAt: string;
  state: OrderReturnState;
}

/** Latest invoices that have at least one settled after-sale return (newest first). */
export async function fetchRecentReturnedOrders(limit = 30): Promise<ReturnedOrderSummary[]> {
  const client = supabase;
  if (!isSupabaseConfigured || !client) return [];
  const events = await client.from('sales_return_events')
    .select('order_id,created_at')
    .eq('settlement_status', 'settled')
    .order('created_at', { ascending: false })
    .limit(200);
  if (events.error) throw Error(RETURN_STATE_ERROR);
  const latest = new Map<string, string>();
  for (const row of events.data ?? []) {
    if (typeof row.order_id === 'string' && typeof row.created_at === 'string' && !latest.has(row.order_id)) latest.set(row.order_id, row.created_at);
  }
  const orderIds = [...latest.keys()].slice(0, limit);
  if (!orderIds.length) return [];
  const [states, orders] = await Promise.all([
    fetchOrderReturnStates(orderIds),
    client.from('orders').select('id,order_number,customer_name_snapshot').in('id', orderIds),
  ]);
  if (orders.error) throw Error(RETURN_STATE_ERROR);
  const byId = new Map((orders.data ?? []).map((row) => [row.id as string, row]));
  return orderIds.flatMap((id) => {
    const order = byId.get(id), state = states.get(id), at = latest.get(id);
    if (!order || !state || !at) return [];
    return [{ id, orderNumber: String(order.order_number ?? ''), customerName: String(order.customer_name_snapshot ?? ''), lastReturnAt: at, state }];
  });
}
