import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync('src/App.tsx', 'utf8');
const main = readFileSync('src/main.tsx', 'utf8');
const errorMonitoring = readFileSync('src/lib/errorMonitoring.ts', 'utf8');
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
const ordersService = readFileSync(
  'src/services/supabase/orders.service.ts',
  'utf8',
);
const migration = readFileSync(
  'supabase/migrations/073_admin_dashboard_performance_indexes.sql',
  'utf8',
);
const selectorConsumers = [
  'src/App.tsx',
  'src/components/common/Header.tsx',
  'src/components/layout/IPhoneContainer.tsx',
  'src/components/layout/BottomTabs.tsx',
  'src/components/layout/QuickActionButton.tsx',
  'src/components/modals/AllModals.tsx',
  'src/features/dashboard/DashboardView.tsx',
  'src/features/orders/OrdersCenterView.tsx',
  'src/features/products/ProductsView.tsx',
  'src/features/inventory/InventoryView.tsx',
  'src/features/pos/PosView.tsx',
  'src/features/accounts/AccountsView.tsx',
  'src/features/crm/CrmView.tsx',
  'src/features/expenses/ExpensesView.tsx',
  'src/features/shifts/ShiftsView.tsx',
  'src/features/reports/ReportsCenterView.tsx',
  'src/features/users/UsersView.tsx',
  'src/features/more/MoreMenuView.tsx',
].map((path) => ({ path, source: readFileSync(path, 'utf8') }));

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

test('app store persists only compact UI preferences', () => {
  assert.doesNotMatch(appStore, /JSON\.stringify\(this\.state\)/);
  assert.match(appStore, /interface PersistedAppPreferences/);
  assert.match(appStore, /version: 1/);
  assert.match(appStore, /activeTab: this\.state\.activeTab/);
  assert.match(
    appStore,
    /themeMode: this\.state\.currentUser\.themeMode === 'light'/,
  );

  const persistenceStart = appStore.indexOf('private persistUiPreferences()');
  const actionsStart = appStore.indexOf('// --- Actions ---', persistenceStart);
  const persistenceBody = appStore.slice(persistenceStart, actionsStart);

  assert.ok(persistenceStart >= 0);
  assert.ok(actionsStart > persistenceStart);
  for (const domainField of [
    'products',
    'orders',
    'customers',
    'suppliers',
    'movements',
    'accounts',
    'journalEntries',
    'customerPayments',
    'supplierPayments',
    'expenses',
    'invoices',
  ]) {
    assert.doesNotMatch(persistenceBody, new RegExp(`\\b${domainField}\\b`));
  }
});

test('app store reload remains compatible with legacy UI preferences', () => {
  assert.match(appStore, /parsed\.themeMode \?\? legacyCurrentUser\?\.themeMode/);
  assert.match(appStore, /isActiveTab\(parsed\.activeTab\)/);
  assert.match(appStore, /activeTab: preferences\.activeTab \?\? initial\.activeTab/);
  assert.match(appStore, /themeMode: preferences\.themeMode \?\?/);
  assert.match(appStore, /this\.persistUiPreferences\(\);/);
});

test('persistent shell and heavy operational views use selected store slices', () => {
  assert.match(appStore, /useSyncExternalStore\(subscribe, getSnapshot, getSnapshot\)/);
  assert.match(appStore, /updateSelectorCache/);
  assert.match(appStore, /const coreAppStoreActions = \{/);

  for (const consumer of selectorConsumers) {
    assert.doesNotMatch(
      consumer.source,
      /\buseAppStore\(\)/,
      `${consumer.path} must not subscribe to the full app state`,
    );
    assert.match(
      consumer.source,
      /useAppStoreSelector\(|useAppStoreActions\(/,
      `${consumer.path} must use a selected slice or stable actions`,
    );
  }
});

test('product and inventory views do not subscribe to toast updates', () => {
  for (const path of [
    'src/features/products/ProductsView.tsx',
    'src/features/inventory/InventoryView.tsx',
  ]) {
    const source = readFileSync(path, 'utf8');
    const selectorStart = source.indexOf('useAppStoreSelector(');
    const actionsStart = source.indexOf('useAppStoreActions()', selectorStart);
    const selectedSlice = source.slice(selectorStart, actionsStart);

    assert.ok(selectorStart >= 0);
    assert.ok(actionsStart > selectorStart);
    assert.doesNotMatch(selectedSlice, /\btoast\b/);
  }
});

test('duplicate product refreshes share one request and reference reads run together', () => {
  assert.match(appStore, /productsRefreshPromise/);
  assert.match(
    appStore,
    /Promise\.all\(\[\s*fetchCategoriesFromSupabase\(\),\s*fetchBrandsFromSupabase\(\),\s*fetchUnitsFromSupabase\(\),\s*fetchBranchesFromSupabase\(\),\s*fetchWarehousesFromSupabase\(\)/,
  );
});

test('admin loads non-critical bundles only when they are needed', () => {
  assert.match(main, /initErrorMonitoring\(\);/);
  assert.doesNotMatch(main, /requestIdleCallback\(startErrorMonitoring/);
  assert.match(errorMonitoring, /function loadMonitoringSdk/);
  assert.match(errorMonitoring, /void loadMonitoringSdk\(\)\?\.catch/);
  assert.match(errorMonitoring, /window\.addEventListener\('error'/);
  assert.match(app, /\{currentModal && \(\s*<Suspense fallback=\{null\}>/);
});

test('home dashboard times out and coalesces realtime refresh bursts', () => {
  assert.match(dashboardService, /runWithTimeout/);
  assert.match(dashboardService, /12_000/);
  assert.match(dashboardService, /abortSignal\(signal\)/);
  assert.match(dashboardView, /refreshPromiseRef/);
  assert.match(dashboardView, /queuedRefreshRef/);
});

test('operational orders coalesce realtime bursts before reloading their page', () => {
  assert.match(ordersService, /let refreshTimer: ReturnType<typeof setTimeout>/);
  assert.match(ordersService, /let pendingEventType: OrderRealtimeEventType/);
  assert.match(ordersService, /setTimeout\(\(\) => \{[\s\S]*?\}, 350\)/);
  assert.doesNotMatch(ordersService, /onNewOrUpdatedOrder: \(payload: any\)/);
});

test('database has the indexes used by the operational home', () => {
  assert.match(
    migration,
    /order_status_history \(order_id, new_status, created_at\)/,
  );
  assert.match(migration, /inventory_balances \(product_id\)/);
  assert.match(migration, /orders \(status, created_at DESC\)/);
});
