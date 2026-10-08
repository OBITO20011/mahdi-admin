import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ADMIN_NAVIGATION_GROUPS } from '../src/features/more/adminNavigation.config.ts';
import {
  SIDE_NAV_MORE,
  buildSideNavigation,
  isSideItemActive,
} from '../src/components/layout/sideNavigationModel.ts';
import { QUICK_ACTIONS, SECONDARY_QUICK_ACTIONS } from '../src/components/layout/quickActions.ts';

const read = (path: string) => readFileSync(path, 'utf8');
const app = read('src/App.tsx');
const sideNav = read('src/components/layout/SideNav.tsx');
const bottomTabs = read('src/components/layout/BottomTabs.tsx');
const header = read('src/components/common/Header.tsx');

const ownerOnly = ['parcel-configuration', 'admin-users', 'admin-monitoring'];

test('the owner sees Home first, then every canonical navigation group and item', () => {
  const groups = buildSideNavigation('owner');
  assert.equal(groups[0].id, 'today');
  assert.deepEqual(groups[0].items.map((item) => item.id), ['home']);
  assert.deepEqual(groups.slice(1).map((group) => group.id), ADMIN_NAVIGATION_GROUPS.map((group) => group.id));
  const sideIds = groups.slice(1).flatMap((group) => group.items.map((item) => item.id));
  const canonicalIds = ADMIN_NAVIGATION_GROUPS.flatMap((group) => group.items.map((item) => item.id));
  assert.deepEqual(sideIds, canonicalIds);
});

test('owner-only destinations stay hidden from every other role, exactly like More', () => {
  for (const role of ['admin', 'manager', 'accountant', 'cashier', 'view_only', null]) {
    const ids = buildSideNavigation(role).flatMap((group) => group.items.map((item) => item.id));
    for (const id of ownerOnly) assert.ok(!ids.includes(id), `${id} leaked to ${role}`);
  }
  const ownerIds = buildSideNavigation('owner').flatMap((group) => group.items.map((item) => item.id));
  for (const id of ownerOnly) assert.ok(ownerIds.includes(id));
});

test('active state follows activeTab, with dashboard treated as Home', () => {
  const [today] = buildSideNavigation('owner');
  const home = today.items[0];
  assert.equal(isSideItemActive(home, 'home'), true);
  assert.equal(isSideItemActive(home, 'dashboard'), true);
  assert.equal(isSideItemActive(home, 'orders'), false);
  assert.equal(isSideItemActive(SIDE_NAV_MORE, 'more'), true);
  const modalItem = buildSideNavigation('owner').flatMap((group) => group.items).find((item) => item.action.type === 'modal');
  assert.ok(modalItem);
  assert.equal(isSideItemActive(modalItem, 'home'), false);
});

test('desktop shows the SideNav (POS collapses it); phones get the bottom tabs only', () => {
  assert.match(app, /<SideNav collapsed=\{activeTab === 'pos'\} \/>/);
  const phoneChrome = app.slice(app.indexOf('className="contents lg:hidden"'));
  assert.ok(phoneChrome.indexOf('<BottomTabs />') > 0, 'bottom tabs are phone chrome');
  assert.doesNotMatch(app, /QuickActionButton|data-navigation-action-dock|admin-fab/);
  assert.match(sideNav, /hidden shrink-0 flex-col[^"]*lg:flex/);
  assert.match(sideNav, /aria-label="القائمة الجانبية"/);
});

test('one shared shortcut list feeds the SideNav and More; the centre tab is the sale', () => {
  assert.deepEqual(QUICK_ACTIONS.map((action) => action.id), ['pos-sale', 'goods-receipt', 'add-expense', 'add-product']);
  assert.deepEqual(SECONDARY_QUICK_ACTIONS.map((action) => action.id), ['goods-receipt', 'add-expense', 'add-product']);
  assert.match(sideNav, /SECONDARY_QUICK_ACTIONS\.map/);
  assert.match(sideNav, /setActiveTab\('pos'\)/);
  assert.match(bottomTabs, /\{ id: 'pos', label: 'بيع', icon: Plus, centre: true \}/);
  assert.match(bottomTabs, /-mt-\[22px\]/);
  assert.doesNotMatch(bottomTabs, /\b(?:bg|text|border)-(?:slate|blue|gray|indigo)-\d/);
});

test('the assistant keeps its role gate on both shells', () => {
  for (const source of [sideNav, header]) {
    assert.match(source, /\['owner', 'admin', 'manager', 'accountant'\]\.includes\(\s*roleName \|\| ''/);
  }
  assert.match(sideNav, /setActiveTab\('assistant'\)/);
  assert.match(header, /setActiveTab\('assistant'\)/);
  assert.match(sideNav, /openModal\('profile'\)/);
  assert.doesNotMatch(sideNav, /\b(?:bg|text|border)-(?:slate|blue|gray|indigo)-\d/);
});

test('Header uses Package F tokens without overriding them, retaining existing destinations', () => {
  assert.match(header, /border-nw-border bg-nw-surface/);
  assert.match(header, /text-nw-text/);
  assert.doesNotMatch(header, /(?:bg|text|border)-(?:slate|blue|gray|violet|red|white)-/);
  assert.match(header, /bg-nw-accent text-nw-on-accent/);
  assert.match(header, /className="min-w-0 flex-1 px-2 text-center lg:hidden"/);
  assert.match(header, />النواصرة<\/span>/);
  assert.match(header, /aria-label=\{`الملف الشخصي: \$\{currentUserName\}`\}[\s\S]*?lg:hidden/);
  assert.match(header, /openModal\('notifications'\)/);
  assert.match(header, /openModal\('profile'\)/);
  assert.match(header, /aria-label="اختيار الفرع"/);
  assert.match(header, /setActiveBranch\(b.id\)/);
  assert.doesNotMatch(read('src/index.css'), /html\.theme-light \.admin-app-header/);
});
