import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ADMIN_NAVIGATION_GROUPS,
  isNavigationItemVisible,
  getNextOpenNavigationGroup,
  canUseNavigationAction,
} from '../src/features/more/adminNavigation.config';
import { VALID_ACTIVE_TABS } from '../src/stores/appStorePreferences';

const app = readFileSync('src/App.tsx', 'utf8');
const bottomTabs = readFileSync('src/components/layout/BottomTabs.tsx', 'utf8');
const quickActions = readFileSync('src/components/layout/quickActions.ts', 'utf8');
const header = readFileSync('src/components/common/Header.tsx', 'utf8');
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
  'sales_history',
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
  'go_live',
  'cheques',
  'warehouses',
].sort();

const expectedGroupDestinations = new Map([
 ['sales',['pos','orders','sales_history','accounts','sales_history']],
 ['products-inventory',['products','purchases','inventory','parcel_configuration','damage_stock_selection']],
 ['finance-reports',['shifts','expenses','reports','cheques','shifts']],
 ['administration-store',['users','warehouses','storefront_settings','promotion_codes','go_live','monitoring_dashboard','assistant']],
]);

test('the canonical activeTab contract is unchanged and every destination remains reachable', () => {
  const activeTabs = [...VALID_ACTIVE_TABS].sort();
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

test('More exposes exactly the approved four navigation groups with no misroutes', () => {
  assert.equal(ADMIN_NAVIGATION_GROUPS.length, 4);
  assert.deepEqual(
    ADMIN_NAVIGATION_GROUPS.map((group) => group.label),
    ['البيع','المخزون والشراء','المال','الإدارة'],
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
    group.items.map((item) => `${item.action.type}:${item.action.destination}:${item.action.type==='tab'?item.action.intent??'':''}`),
  );
  assert.equal(new Set(destinations).size, destinations.length);
});

test('the mandatory parity gate preserves every functional legacy More feature', () => {
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
    'storefront_settings',
    'promotion_codes',
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
  assert.match(moreMenu,/SearchField label="ابحث عن شاشة"/);
  assert.match(moreMenu,/grid grid-cols-3/);
  assert.match(moreMenu,/dir="rtl"/);
  assert.doesNotMatch(moreMenu,/aria-expanded|useReducedMotion/);
  assert.doesNotMatch(moreMenu, /localStorage/);
});

test('role visibility and the independent assistant gate are unchanged', () => {
  const ownerOnlyItems = ADMIN_NAVIGATION_GROUPS.flatMap((group) => group.items).filter(
    (item) => item.visibility === 'owner',
  );
  assert.deepEqual(ownerOnlyItems.map((item) => item.id), ['parcel-configuration', 'finance-withdrawals', 'admin-users', 'admin-warehouses', 'admin-go-live', 'admin-monitoring']);
  const warehouses=ownerOnlyItems.find(item=>item.id==='admin-warehouses');assert.ok(warehouses);
  assert.equal(isNavigationItemVisible(warehouses,'owner'),true);
  for(const role of ['admin','manager','accountant','cashier','sales','warehouse',null])assert.equal(isNavigationItemVisible(warehouses,role),false);
  assert.match(moreMenu, /searchNavigationGroups\(search,roleName,roles\)/);
  const cheque=ADMIN_NAVIGATION_GROUPS.flatMap(g=>g.items).find(i=>i.id==='finance-cheques');
  assert.ok(cheque);
  for(const role of ['owner','manager'])assert.equal(isNavigationItemVisible(cheque,role),true);
  for(const role of ['admin','accountant','cashier','sales','warehouse',null])assert.equal(isNavigationItemVisible(cheque,role),false);
  for(const role of ['owner','admin','manager','accountant'])assert.equal(canUseNavigationAction({type:'tab',destination:'assistant'},role),true);
  for(const role of ['cashier','sales','warehouse_keeper','view_only',null])assert.equal(canUseNavigationAction({type:'tab',destination:'assistant'},role),false);
  assert.ok(ADMIN_NAVIGATION_GROUPS.some(group=>group.items.some(item=>item.id==='admin-assistant')));

});

test('modal dispatcher, quick actions and nested feature views retain their identities', () => {
  const expectedModalIds = [
    'damage_stock_selection',
    'add_customer',
    'add_expense',
    'add_product',
    'adjust_stock',
    'edit_product',
    'inventory_opening_setup',
    'manage_brands',
    'manage_categories',
    'manage_units',
    'monitoring_dashboard',
    'notifications',
    'parcel_configuration',
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
  assert.match(quickActions, /id: 'pos-sale'[\s\S]*?destination: 'pos'/);
  assert.match(quickActions, /id: 'goods-receipt'[\s\S]*?destination: 'receive_goods'/);

  assert.match(accountsView, /'directory' \| 'balances'/);
  assert.match(inventoryView, /'products' \| 'movements'/);
  assert.match(directReceivingView, /'partially_paid'/);
  assert.match(directReceivingView, /'old_history'/);
  assert.match(profileModal, /'profile' \| 'edit' \| 'security' \| 'notifications'/);
  assert.match(orderDetailModal, /<AdminAftercarePanel/u);
  assert.match(orderDetailModal, /legacy_website_return_v1[\s\S]*للقراءة فقط/u);
  assert.doesNotMatch(orderDetailModal, /returnCompletedWebsiteOrder/u);
});

test('Package F bottom tabs: Home, Orders, centre Sell, Inventory, More; Customers via More', () => {
  for (const entry of [
    "{ id: 'home', label: 'الرئيسية'",
    "{ id: 'orders', label: 'الطلبات'",
    "{ id: 'pos', label: 'بيع', icon: Plus, centre: true }",
    "{ id: 'inventory', label: 'المخزون'",
    "{ id: 'more', label: 'المزيد'",
  ]) {
    assert.ok(bottomTabs.includes(entry), entry);
  }
  assert.doesNotMatch(bottomTabs, /id: 'accounts'/);
  assert.ok(
    ADMIN_NAVIGATION_GROUPS.flatMap((group) => group.items).some(
      (item) => item.action.type === 'tab' && item.action.destination === 'accounts',
    ),
    'Customers & receivables stay reachable from More',
  );
  assert.match(bottomTabs, /data-bottom-tab=\{tab\.id\}/);
  assert.match(bottomTabs, /aria-current=\{isActive \? 'page' : undefined\}/);
  assert.match(bottomTabs, /env\(safe-area-inset-bottom\)/);
  assert.match(bottomTabs, /min-h-14/);
  // The floating quick-action button is gone; its shortcuts live in More and the SideNav.
  assert.doesNotMatch(app, /QuickActionButton|data-navigation-action-dock/);
  assert.doesNotMatch(moreMenu,/SECONDARY_QUICK_ACTIONS|quick-action-trigger/);
  const side=readFileSync('src/components/layout/SideNav.tsx','utf8');
  assert.match(side,/SECONDARY_QUICK_ACTIONS.filter/);
  assert.match(side,/onClick: \(\) => run\(action.action\)/);
  assert.match(header, /aria-label="فتح المساعد الإداري الذكي"/);
});
