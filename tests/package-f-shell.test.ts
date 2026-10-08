import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ADMIN_NAVIGATION_GROUPS } from '../src/features/more/adminNavigation.config.ts';
import {
  SIDE_NAV_MORE,
  buildSideNavigation,
  isSideItemActive,
} from '../src/components/layout/sideNavigationModel.ts';

const read = (path: string) => readFileSync(path, 'utf8');
const app = read('src/App.tsx');
const sideNav = read('src/components/layout/SideNav.tsx');
const quickActions = read('src/components/layout/QuickActionButton.tsx');

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

test('desktop shows the SideNav (POS collapses it) while phone chrome is unchanged below lg', () => {
  assert.match(app, /<SideNav collapsed=\{activeTab === 'pos'\} \/>/);
  const phoneChrome = app.slice(app.indexOf('className="contents lg:hidden"'));
  assert.ok(phoneChrome.indexOf('data-navigation-action-dock') > 0, 'dock stays in phone chrome');
  assert.ok(phoneChrome.indexOf('<BottomTabs />') > 0, 'bottom tabs stay in phone chrome');
  assert.match(sideNav, /hidden shrink-0 flex-col[^"]*lg:flex/);
  assert.match(sideNav, /aria-label="القائمة الجانبية"/);
});

test('SideNav keeps the phone quick actions and assistant gate on desktop', () => {
  for (const destination of ['receive_goods', 'add_expense', 'add_product']) {
    assert.match(quickActions, new RegExp(`openModal\\('${destination}'\\)`));
    assert.match(sideNav, new RegExp(`openModal\\('${destination}'\\)`));
  }
  assert.match(sideNav, /setActiveTab\('pos'\)/);
  assert.match(sideNav, /\['owner', 'admin', 'manager', 'accountant'\]\.includes\(roleName \|\| ''\)/);
  assert.match(sideNav, /setActiveTab\('assistant'\)/);
  assert.match(sideNav, /openModal\('profile'\)/);
  assert.doesNotMatch(sideNav, /\b(?:bg|text|border)-(?:slate|blue|gray|indigo)-\d/);
});
