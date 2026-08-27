import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const orderService = readFileSync(
  new URL('../src/services/supabase/orders.service.ts', import.meta.url),
  'utf8',
);

const fetchOrderByIdStart = orderService.indexOf(
  'export async function fetchOrderByIdFromSupabase',
);
const fetchOrderByIdEnd = orderService.indexOf(
  'export async function confirmOrderInSupabase',
  fetchOrderByIdStart,
);
const fetchOrderById = orderService.slice(fetchOrderByIdStart, fetchOrderByIdEnd);

test('fetchOrderById loads exactly one order from Supabase instead of all orders', () => {
  assert.ok(fetchOrderByIdStart >= 0 && fetchOrderByIdEnd > fetchOrderByIdStart);
  assert.match(fetchOrderById, /\.from\('orders'\)/);
  assert.match(fetchOrderById, /\.eq\('id', orderId\)/);
  assert.match(fetchOrderById, /\.single\(\)/);
  assert.doesNotMatch(fetchOrderById, /fetchOrdersFromSupabase\(/);
  assert.doesNotMatch(fetchOrderById, /\.find\(/);
});

test('single-order detail projection keeps every relationship the detail screen needs', () => {
  assert.match(orderService, /const ORDER_DETAIL_SELECT =/);
  assert.match(orderService, /customers \(/);
  assert.match(orderService, /customer_addresses \(/);
  assert.match(orderService, /order_items \(/);
  assert.match(orderService, /order_status_history \(/);
  assert.match(orderService, /sales_returns \(/);
});

test('missing orders have a stable user-facing response and direct rows use the shared mapper', () => {
  assert.match(fetchOrderById, /error\.code === 'PGRST116'/);
  assert.match(fetchOrderById, /الطلب غير موجود في قاعدة البيانات/);
  assert.match(fetchOrderById, /mapOrderRows\(\[data\]\)/);
  assert.match(orderService, /function mapOrderRows\(data: unknown\[\]\): Order\[\]/);
});
