/**
 * Owner trial item 9 (2026-11-20): after-sale returns never change orders.status,
 * so a fully or partly returned invoice still reads «مكتمل». These helpers turn
 * settled sales_return_events amounts into a presentation badge only; no money
 * figure here feeds any total, debt, drawer or report.
 */
export interface OrderReturnState {
  orderId: string;
  /** Σ merchandise_refund_amount_in_minor_units of settled events (refund + debt reduction). */
  returnedInMinorUnits: number;
  totalInMinorUnits: number;
  goodsInMinorUnits: number;
  kind: 'full' | 'partial';
}

export interface ReturnEventAmountRow { order_id: unknown; merchandise_refund_amount_in_minor_units: unknown }
export interface ReturnOrderAmountRow { id: unknown; total_in_minor_units: unknown; delivery_fee_in_minor_units: unknown }

const minor = (value: unknown): number => {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
};

export function orderReturnState(orderId: string, returnedInMinorUnits: number, totalInMinorUnits: number, deliveryFeeInMinorUnits: number): OrderReturnState | null {
  if (returnedInMinorUnits <= 0) return null;
  const goodsInMinorUnits = Math.max(totalInMinorUnits - deliveryFeeInMinorUnits, 0);
  return { orderId, returnedInMinorUnits, totalInMinorUnits, goodsInMinorUnits, kind: returnedInMinorUnits >= goodsInMinorUnits ? 'full' : 'partial' };
}

export function summarizeOrderReturns(events: readonly ReturnEventAmountRow[], orders: readonly ReturnOrderAmountRow[]): Map<string, OrderReturnState> {
  const returned = new Map<string, number>();
  for (const event of events) {
    if (typeof event.order_id !== 'string') continue;
    returned.set(event.order_id, (returned.get(event.order_id) ?? 0) + minor(event.merchandise_refund_amount_in_minor_units));
  }
  const states = new Map<string, OrderReturnState>();
  for (const order of orders) {
    if (typeof order.id !== 'string') continue;
    const state = orderReturnState(order.id, returned.get(order.id) ?? 0, minor(order.total_in_minor_units), minor(order.delivery_fee_in_minor_units));
    if (state) states.set(order.id, state);
  }
  return states;
}

export const formatMinorJod = (value: number) => (value / 1000).toFixed(3);

export function orderReturnBadgeLabel(state: OrderReturnState): string {
  return state.kind === 'full'
    ? 'مرتجع كامل'
    : `مرتجع جزئي ${formatMinorJod(state.returnedInMinorUnits)} من ${formatMinorJod(state.totalInMinorUnits)}`;
}
