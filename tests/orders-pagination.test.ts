import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const orderService = readFileSync(
  'src/services/supabase/orders.service.ts',
  'utf8'
);
const ordersCenter = readFileSync(
  'src/features/orders/OrdersCenterView.tsx',
  'utf8'
);
const orderDetail = readFileSync(
  'src/features/orders/OrderDetailModal.tsx',
  'utf8'
);
const appStore = readFileSync('src/stores/useAppStore.ts', 'utf8');
const bottomTabs = readFileSync(
  'src/components/layout/BottomTabs.tsx',
  'utf8'
);
const migration = readFileSync(
  'supabase/migrations/075_operational_orders_pagination.sql',
  'utf8'
);

test('operational order paging is server-side, guarded, and excludes POS', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_operational_orders_page/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /PERFORM public\.assert_erp_role/);
  assert.match(migration, /COALESCE\(o\.source, 'website'\) <> 'pos'/);
  assert.match(migration, /COALESCE\(c\.phone, ''\) ILIKE/);
  assert.match(migration, /OFFSET v_offset/);
  assert.match(migration, /LIMIT v_page_size/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_operational_orders_page/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_operational_orders_page/);
});

test('order page service requests server page metadata then only bounded lightweight rows', () => {
  assert.match(orderService, /export async function fetchOperationalOrdersPageFromSupabase/);
  assert.match(orderService, /supabase\.rpc\('get_operational_orders_page'/);
  assert.match(orderService, /p_page_size: pageSize/);
  assert.match(orderService, /p_filter: input\.filter/);
  assert.match(orderService, /p_search: searchQuery/);
  assert.match(orderService, /fetchOperationalOrderListRows\(\s*pagePayload\.orderIds/);
  assert.match(orderService, /\.select\(OPERATIONAL_ORDER_LIST_SELECT\)/);
  assert.match(orderService, /\.in\('id', \[\.\.\.orderIds\]\)/);
  assert.match(orderService, /order_items \(count\)/);
  assert.doesNotMatch(orderService, /export async function fetchOrdersFromSupabase/);
});

test('orders center pages summaries and loads heavy details only for the opened order', () => {
  assert.match(ordersCenter, /fetchOperationalOrdersPageFromSupabase/);
  assert.match(ordersCenter, /fetchOrderByIdFromSupabase\(orderId\)/);
  assert.match(ordersCenter, /const PAGE_SIZE = 25/);
  assert.match(ordersCenter, /setDebouncedSearchQuery/);
  assert.match(ordersCenter, /setTotalCount\(result\.totalCount\)/);
  assert.doesNotMatch(ordersCenter, /orders\.filter\(/);
  assert.doesNotMatch(ordersCenter, /refreshOrdersFromSupabase/);
  assert.match(orderDetail, /onOrderChanged\?: \(\) => Promise<void>/);
  assert.doesNotMatch(orderDetail, /orders\.find\(/);
});

test('global store refreshes only the bounded summary used by the navigation badge', () => {
  assert.match(appStore, /fetchOperationalOrdersSummaryFromSupabase/);
  assert.match(appStore, /this\.state\.newOrdersCount = res\.summary\.review/);
  assert.doesNotMatch(appStore, /this\.state\.orders = res\.orders/);
  assert.match(bottomTabs, /newOrdersCount: state\.newOrdersCount/);
  assert.match(bottomTabs, /subscribeToOrdersInSupabase/);
});

test('realtime invalidates the visible page and refreshes only an opened matching detail', () => {
  assert.match(orderService, /orderIds: \[\.\.\.pendingOrderIds\]/);
  assert.match(ordersCenter, /payload\.orderIds\.includes\(selectedOrderId\)/);
  assert.match(ordersCenter, /loadOrderDetails\(selectedOrderId, true\)/);
});
