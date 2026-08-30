import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ADMIN_NAVIGATION_GROUPS,
  getNextOpenNavigationGroup,
} from '../src/features/more/adminNavigation.config';

const app = readFileSync('src/App.tsx', 'utf8');
const appStore = readFileSync('src/stores/useAppStore.ts', 'utf8');
const bottomTabs = readFileSync('src/components/layout/BottomTabs.tsx', 'utf8');
const quickActions = readFileSync('src/components/layout/QuickActionButton.tsx', 'utf8');
const moreMenu = readFileSync('src/features/more/MoreMenuView.tsx', 'utf8');
const allModals = readFileSync('src/components/modals/AllModals.tsx', 'utf8');
const accountsView = readFileSync('src/features/accounts/AccountsView.tsx', 'utf8');
const inventoryView = readFileSync('src/features/inventory/InventoryView.tsx', 'utf8');
const directReceivingView = readFileSync(
  'src/features/directReceiving/DirectReceivingView.tsx',
  'utf8',
);
const profileModal = readFileSync('src/features/more/ProfileModal.tsx', 'utf8');
const orderDetailModal = readFileSync('src/features/orders/OrderDetailModal.tsx', 'utf8');

const expectedActiveTabs = [
  'home',
  'orders',
  'products',
  'accounts',
  'more',
  'dashboard',
  'pos',
  'inventory',
  'expenses',
  'shifts',
  'reports',
  'users',
  'purchases',
  'assistant',
].sort();

const expectedGroupDestinations = new Map([
  ['sales', ['pos', 'orders']],
  ['products-inventory', ['products', 'inventory']],
  ['customers', ['accounts']],
  ['suppliers-purchases', ['purchases']],
  ['finance-reports', ['shifts', 'expenses', 'reports']],
  [
    'administration-store',
    ['users', 'storefront_settings', 'promotion_codes', 'profile', 'branches_list'],
  ],
]);

const extractSingleQuotedValues = (source: string) =>
  Array.from(source.matchAll(/'([^']+)'/g), (match) => match[1]);

test('the canonical activeTab contract is unchanged and every destination remains reachable', () => {
  const activeTabBlock = appStore.match(
    /const VALID_ACTIVE_TABS = \[([\s\S]*?)\] as const/,
  );
  assert.ok(activeTabBlock);
  const activeTabs = extractSingleQuotedValues(activeTabBlock[1]).sort();
  assert.deepEqual(activeTabs, expectedActiveTabs);

  const groupedTabs = ADMIN_NAVIGATION_GROUPS.flatMap((group) =>
    group.items
      .filter((item) => item.action.type === 'tab')
      .map((item) => item.action.destination),
  );
  const shellAndIntentionalEntries = [
    'home',
    'orders',
    'inventory',
    'more',
    'assistant',
    'pos',
  ];
  const reachableTabs = new Set([...groupedTabs, ...shellAndIntentionalEntries]);

  assert.deepEqual(
    [...reachableTabs].sort(),
    expectedActiveTabs.filter((tab) => tab !== 'dashboard'),
  );
  assert.match(app, /case 'home':\s*case 'dashboard':/);
});

test('More exposes exactly the approved six navigation groups with no misroutes', () => {
  assert.equal(ADMIN_NAVIGATION_GROUPS.length, 6);
  assert.deepEqual(
    ADMIN_NAVIGATION_GROUPS.map((group) => group.label),
    [
      'المبيعات',
      'المنتجات والمخزون',
      'العملاء والذمم',
      'الموردون والمشتريات',
      'المالية والتقارير',
      'الإدارة والمتجر',
    ],
  );

  for (const group of ADMIN_NAVIGATION_GROUPS) {
    assert.deepEqual(
      group.items.map((item) => item.action.destination),
      expectedGroupDestinations.get(group.id),
      `${group.id} must keep the approved destination mapping`,
    );
  }

  const ids = ADMIN_NAVIGATION_GROUPS.flatMap((group) =>
    group.items.map((item) => item.id),
  );
  assert.equal(new Set(ids).size, ids.length);

  const destinations = ADMIN_NAVIGATION_GROUPS.flatMap((group) =>
    group.items.map((item) => `${item.action.type}:${item.action.destination}`),
  );
  assert.equal(new Set(destinations).size, destinations.length);
});

test('the mandatory parity gate preserves every legacy More feature', () => {
  const legacyTabDestinations = [
    'products',
    'accounts',
    'purchases',
    'shifts',
    'expenses',
    'reports',
    'users',
    'inventory',
  ];
  const legacyModalDestinations = [
    'profile',
    'storefront_settings',
    'promotion_codes',
    'branches_list',
  ];
  const groupedActions = ADMIN_NAVIGATION_GROUPS.flatMap((group) =>
    group.items.map((item) => item.action),
  );

  for (const destination of legacyTabDestinations) {
    assert.ok(
      groupedActions.some(
        (action) => action.type === 'tab' && action.destination === destination,
      ),
      `legacy tab ${destination} must remain reachable`,
    );
  }
  for (const destination of legacyModalDestinations) {
    assert.ok(
      groupedActions.some(
        (action) => action.type === 'modal' && action.destination === destination,
      ),
      `legacy modal ${destination} must remain reachable`,
    );
  }

  for (const featureId of [
    'profile-summary',
    'assistant-shortcut',
    'install-app',
    'theme-toggle',
    'biometric-toggle',
    'sign-out',
  ]) {
    assert.match(moreMenu, new RegExp(`data-navigation-id="${featureId}"`));
  }
});

test('only one accordion group can open and a second press closes it', () => {
  assert.equal(getNextOpenNavigationGroup(null, 'sales'), 'sales');
  assert.equal(getNextOpenNavigationGroup('sales', 'products-inventory'), 'products-inventory');
  assert.equal(getNextOpenNavigationGroup('products-inventory', 'products-inventory'), null);
  assert.match(moreMenu, /aria-expanded=\{isOpen\}/);
  assert.match(moreMenu, /aria-controls=\{panelId\}/);
  assert.match(moreMenu, /role="region"/);
  assert.match(moreMenu, /dir="rtl"/);
  assert.match(moreMenu, /useReducedMotion\(\)/);
  assert.doesNotMatch(moreMenu, /localStorage/);
});

test('role visibility and the independent assistant gate are unchanged', () => {
  const ownerOnlyItems = ADMIN_NAVIGATION_GROUPS.flatMap((group) => group.items).filter(
    (item) => item.visibility === 'owner',
  );
  assert.deepEqual(ownerOnlyItems.map((item) => item.id), ['admin-users']);
  assert.match(moreMenu, /item\.visibility !== 'owner' \|\| roleName === 'owner'/);
  assert.match(
    moreMenu,
    /\['owner', 'admin', 'manager', 'accountant'\]\.includes\(\s*roleName \|\| '',\s*\)/,
  );
  assert.match(moreMenu, /data-navigation-id="assistant-shortcut"/);
  assert.ok(
    ADMIN_NAVIGATION_GROUPS.every((group) =>
      group.items.every((item) => item.action.destination !== 'assistant'),
    ),
  );
});

test('modal dispatcher, quick actions and nested feature views retain their identities', () => {
  const expectedModalIds = [
    'add_customer',
    'add_expense',
    'add_product',
    'adjust_stock',
    'edit_product',
    'inventory_opening_setup',
    'manage_brands',
    'manage_categories',
    'manage_units',
    'notifications',
    'profile',
    'profile_settings',
    'promotion_codes',
    'receive_goods',
    'record_customer_payment',
    'stock_count',
    'storefront_settings',
    'view_order',
    'view_product',
    'warehouse_transfer',
  ];
  const dispatchedModals = Array.from(
    allModals.matchAll(/currentModal\s*===\s*'([^']+)'/g),
    (match) => match[1],
  );
  assert.deepEqual([...new Set(dispatchedModals)].sort(), expectedModalIds.sort());

  for (const quickActionId of [
    'pos-sale',
    'goods-receipt',
    'add-expense',
    'add-product',
  ]) {
    assert.match(quickActions, new RegExp(`id: '${quickActionId}'`));
  }
  assert.match(quickActions, /id: 'pos-sale'[\s\S]*setActiveTab\('pos'\)/);
  assert.match(quickActions, /id: 'goods-receipt'[\s\S]*openModal\('receive_goods'\)/);

  assert.match(accountsView, /'directory' \| 'balances'/);
  assert.match(inventoryView, /'products' \| 'movements'/);
  assert.match(directReceivingView, /'partially_paid'/);
  assert.match(directReceivingView, /'old_history'/);
  assert.match(profileModal, /'profile' \| 'edit' \| 'security' \| 'notifications'/);
  assert.match(orderDetailModal, /returnCompletedWebsiteOrder/);
});

test('Phase 2 BottomTabs use the approved five destinations without changing identities', () => {
  for (const entry of [
    "{ id: 'home', label: 'الرئيسية'",
    "{ id: 'orders', label: 'الطلبات'",
    "{ id: 'inventory', label: 'المخزون'",
    "{ id: 'accounts', label: 'العملاء'",
    "{ id: 'more', label: 'المزيد'",
  ]) {
    assert.ok(bottomTabs.includes(entry));
  }
  assert.doesNotMatch(bottomTabs, /id: 'quick-action'/);
  assert.match(bottomTabs, /data-bottom-tab=\{tab\.id\}/);
  assert.match(bottomTabs, /aria-current=\{isActive \? 'page' : undefined\}/);
  assert.match(bottomTabs, /env\(safe-area-inset-bottom\)/);
  assert.match(bottomTabs, /min-h-14/);
  assert.match(quickActions, /data-navigation-id="quick-action-trigger"/);
  assert.match(quickActions, /aria-expanded=\{isQuickActionOpen\}/);
  assert.match(quickActions, /setActiveTab\('more'\)/);
});

test('the pre-existing unresolved branches_list action is preserved without inventing behavior', () => {
  const branchItem = ADMIN_NAVIGATION_GROUPS.flatMap((group) => group.items).find(
    (item) => item.id === 'unclassified-branches',
  );
  assert.deepEqual(branchItem?.action, {
    type: 'modal',
    destination: 'branches_list',
  });
  assert.equal(branchItem?.classification, 'unclassified');
  assert.doesNotMatch(allModals, /currentModal\s*===\s*'branches_list'/);
});
