/**
 * Codex review 2026-11-23 #4 («مرتجعة» tab): presentation helpers only, no reads.
 * The tab lists the latest invoices with a settled after-sale return; the screen states
 * the limit and narrows the list with the orders search text.
 */

/** Same as the fetchRecentReturnedOrders default; the screen states this limit. */
export const RECENT_RETURNED_ORDERS_LIMIT = 30;

/** Case-insensitive match on the invoice number or customer name. */
export function matchesReturnedOrderSearch(row: { orderNumber?: string | null; customerName?: string | null }, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase('ar');
  if (!needle) return true;
  return [row.orderNumber, row.customerName].some((value) => (value ?? '').toLocaleLowerCase('ar').includes(needle));
}
