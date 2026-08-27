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

test('order page service requests page metadata before page-limited details', () => {
  assert.match(orderService, /export async function fetchOperationalOrdersPageFromSupabase/);
  assert.match(orderService, /supabase\.rpc\('get_operational_orders_page'/);
  assert.match(orderService, /p_page_size: pageSize/);
  assert.match(orderService, /p_filter: input\.filter/);
  assert.match(orderService, /p_search: searchQuery/);
  assert.match(orderService, /orderIds: pagePayload\.orderIds/);
  assert.match(orderService, /query = query\.in\('id', \[\.\.\.options\.orderIds\]\)/);
});

test('orders center no longer filters a full store order list in React', () => {
  assert.match(ordersCenter, /fetchOperationalOrdersPageFromSupabase/);
  assert.match(ordersCenter, /const PAGE_SIZE = 25/);
  assert.match(ordersCenter, /setDebouncedSearchQuery/);
  assert.match(ordersCenter, /setTotalCount\(result\.totalCount\)/);
  assert.doesNotMatch(ordersCenter, /orders\.filter\(/);
  assert.doesNotMatch(ordersCenter, /refreshOrdersFromSupabase/);
});
