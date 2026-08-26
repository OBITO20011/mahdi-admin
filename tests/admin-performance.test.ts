import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync('src/App.tsx', 'utf8');
const main = readFileSync('src/main.tsx', 'utf8');
const appStore = readFileSync('src/stores/useAppStore.ts', 'utf8');
const authStore = readFileSync('src/stores/useAuthStore.ts', 'utf8');
const dashboardService = readFileSync(
  'src/services/supabase/dashboard.service.ts',
  'utf8',
);
const dashboardView = readFileSync(
  'src/features/dashboard/DashboardView.tsx',
  'utf8',
);
const migration = readFileSync(
  'supabase/migrations/073_admin_dashboard_performance_indexes.sql',
  'utf8',
);

test('admin startup does not query business data before authentication', () => {
  const constructorStart = appStore.indexOf('constructor()');
  const firstRefreshMethod = appStore.indexOf(
    'public refreshOrdersFromSupabase',
    constructorStart,
  );
  const constructorBody = appStore.slice(constructorStart, firstRefreshMethod);

  assert.ok(constructorStart >= 0);
  assert.doesNotMatch(constructorBody, /refreshProductsFromSupabase/);
  assert.doesNotMatch(constructorBody, /refreshOrdersFromSupabase/);
  assert.doesNotMatch(constructorBody, /refreshInventoryMovementsFromSupabase/);
  assert.match(authStore, /requestIdleCallback\(warmProductData/);
});

test('duplicate product refreshes share one request and reference reads run together', () => {
  assert.match(appStore, /productsRefreshPromise/);
  assert.match(
    appStore,
    /Promise\.all\(\[\s*fetchCategoriesFromSupabase\(\),\s*fetchBrandsFromSupabase\(\),\s*fetchUnitsFromSupabase\(\),\s*fetchBranchesFromSupabase\(\),\s*fetchWarehousesFromSupabase\(\)/,
  );
});

test('admin defers non-critical bundles until idle or direct use', () => {
  assert.match(main, /requestIdleCallback\(startErrorMonitoring/);
  assert.match(app, /\{currentModal && \(\s*<Suspense fallback=\{null\}>/);
});

test('home dashboard times out and coalesces realtime refresh bursts', () => {
  assert.match(dashboardService, /runWithTimeout/);
  assert.match(dashboardService, /12_000/);
  assert.match(dashboardService, /abortSignal\(signal\)/);
  assert.match(dashboardView, /refreshPromiseRef/);
  assert.match(dashboardView, /queuedRefreshRef/);
});

test('database has the indexes used by the operational home', () => {
  assert.match(
    migration,
    /order_status_history \(order_id, new_status, created_at\)/,
  );
  assert.match(migration, /inventory_balances \(product_id\)/);
  assert.match(migration, /orders \(status, created_at DESC\)/);
});

