const HIDDEN_ADMIN_ORDER_SOURCES = new Set(['pos']);

export function calculateOrderAmountDue(
  totalAmount: number,
  amountPaid: number
): number {
  const safeTotal = Number.isFinite(totalAmount) ? Math.max(totalAmount, 0) : 0;
  const safePaid = Number.isFinite(amountPaid) ? Math.max(amountPaid, 0) : 0;
  return Math.max(Number((safeTotal - safePaid).toFixed(3)), 0);
}

export function isOperationalOrderSource(source?: string | null): boolean {
  return !HIDDEN_ADMIN_ORDER_SOURCES.has(
    String(source || 'website').trim().toLowerCase()
  );
}

export type OperationalOrderFilter =
  | 'all'
  | 'action'
  | 'active'
  | 'completed'
  | 'returned'
  | 'cancelled';

export function matchesOperationalOrderFilter(
  status: string,
  filter: OperationalOrderFilter
): boolean {
  if (filter === 'all') return true;
  if (filter === 'action') return status === 'new';
  if (filter === 'active') {
    return ['confirmed', 'preparing', 'processing', 'ready', 'out_for_delivery'].includes(
      status
    );
  }
  if (filter === 'completed') {
    return status === 'completed' || status === 'delivered';
  }
  if (filter === 'returned') return status === 'returned';
  return status === 'cancelled';
}
