import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { DashboardHome } from '../src/features/dashboard/DashboardHome.tsx';
import { KpiGrid, SegmentedControl, SalesBarChart, UserAvatar, formatUiDate } from '../src/components/ui/index.ts';
import { homeFixture, shiftFixture } from '../e2e/package-f-home.fixture.ts';

const render = (data = homeFixture, shift = shiftFixture) => renderToStaticMarkup(React.createElement(DashboardHome, {
  data, currentUserName: 'مهدي', currentShift: shift, loading: false, error: null, realtimeConnected: false,
  onRefresh() {}, onOrders() {}, onAccounts() {}, onInventory() {}, onProducts() {}, onShift() {}, onSell() {}, onReceive() {}, onExpense() {},
}));

test('Home distinguishes net from gross and preserves actual shift values', () => {
  const html = render();
  assert.ok(html.includes('31,906.250')); // not gross 34,006.250
  assert.ok(html.includes('1,162.000')); // not gross 1,284.500 for the final chart bar
  assert.ok(html.includes('810.300'));
  assert.ok(html.includes('-12.000'));
  assert.ok(html.includes('المقبوض اليوم'));
  assert.ok(html.includes('تفصيل كاش / CliQ غير متاح'));
  assert.ok(html.includes('عدد العملاء المتأخرين: غير متاح'));
});

test('unavailable facts never turn money or chart into fabricated zero', () => {
  const data = structuredClone(homeFixture);
  data.financialFactsAvailable = false;
  const html = render(data, null);
  for (const amount of ['1,284.500', '31,906.250', '8,420.750', '1,162.000']) assert.ok(!html.includes(amount), amount);
  assert.ok(html.includes('غير متاح'));
  assert.ok(html.includes('لا توجد وردية مفتوحة'));
  delete data.summary.monthNetSalesInMinorUnits;
  data.financialFactsAvailable = true;
  data.sevenDaySales.forEach((day) => { delete day.netSalesInMinorUnits; });
  const missing = render(data, null);
  assert.ok(!missing.includes('31,906.250'));
  assert.ok(!missing.includes('صافي المبيعات آخر 7 أيام؛'));
});

test('responsive shared grid and touch control preserve defaults and opt-in Home layout', () => {
  const pair = renderToStaticMarkup(React.createElement(KpiGrid, { phonePairs: true }));
  assert.match(pair, /grid-cols-2 lg:grid-cols/);
  const normal = renderToStaticMarkup(React.createElement(KpiGrid));
  assert.match(normal, /repeat\(auto-fit,minmax\(210px,1fr\)\)/);
  const control = renderToStaticMarkup(React.createElement(SegmentedControl, { label: 'فترة', touchSize: true, options: [{ value: 'day', label: 'اليوم' }], value: 'day', onChange() {} }));
  assert.match(control, /h-11/);
  assert.match(control, /aria-checked="true"/);
});

test('chart preserves negative, zero and current-day meaning without money inference', () => {
  const html = renderToStaticMarkup(React.createElement(SalesBarChart, { label: 'صافي', points: [{ id: 'a', label: 'أمس', amount: -150 }, { id: 'b', label: 'اليوم', amount: 0, current: true }] }));
  assert.match(html, /-150\.000/);
  assert.match(html, /0\.000/);
  assert.match(html, /bg-nw-bad/);
  assert.match(html, /height:0px/);
});

test('chart integers never wrap while accessible values preserve every fils', () => {
  const html = renderToStaticMarkup(React.createElement(SalesBarChart, { label: 'صافي', points: [{ id: 'a', label: 'اليوم', amount: 1162.125 }] }));
  assert.match(html, /whitespace-nowrap/);
  assert.match(html, /title="اليوم: 1,162\.125 د.أ"/);
  assert.match(html, /aria-label="اليوم: 1,162\.125 د.أ"/);
  assert.match(html, />1,162<\/bdi>/);
  assert.doesNotMatch(html, /break-all/);
});

test('Home dates and shift times use Latin digits, including the shared date helper', () => {
  assert.doesNotMatch(render(), /[٠-٩]/);
  const date = formatUiDate('2026-10-09T08:12:00+03:00', { day: 'numeric', month: 'long', year: 'numeric', numberingSystem: 'arab' });
  assert.doesNotMatch(date, /[٠-٩]/);
  assert.match(date, /9/);
  assert.match(date, /2026/);
  assert.match(formatUiDate('2026-10-09T08:12:00+03:00', { hour: '2-digit', minute: '2-digit' }), /08:12/);
});

test('shared avatar renders initials without a network default and preserves chosen photos', () => {
  const fallback = renderToStaticMarkup(React.createElement(UserAvatar, { name: ' مهدي', src: '' }));
  assert.match(fallback, /bg-nw-accent/);
  assert.match(fallback, /text-nw-on-accent/);
  assert.match(fallback, />م<\/span>/);
  assert.doesNotMatch(fallback, /<img|https?:/);
  const photo = renderToStaticMarkup(React.createElement(UserAvatar, { name: 'مهدي', src: '/my-photo.png' }));
  assert.match(photo, /<img[^>]*src="\/my-photo.png"[^>]*alt="مهدي"/);
  for (const file of readdirSync('src', { recursive: true }).filter((file) => /\.tsx?$/.test(String(file)))) {
    assert.doesNotMatch(readFileSync(`src/${file}`, 'utf8'), /images\.unsplash\.com/, String(file));
  }
});

test('live loader still uses the same RPC and maps existing canonical net facts only', () => {
  const service = readFileSync('src/services/supabase/dashboard.service.ts', 'utf8');
  assert.match(service, /monthNetSalesInMinorUnits: nullableNumberValue\(value\.monthNetSalesInMinorUnits\)/);
  assert.match(service, /netSalesInMinorUnits: nullableNumberValue\(value\.netSalesInMinorUnits\)/);
  assert.match(service, /financialFactsAvailable: payload\.financialFactsStatus !== 'unavailable'/);
  assert.equal(service.match(/supabase\.rpc\(/g)?.length, 1);
  assert.match(service, /supabase\.rpc\('get_home_dashboard'\)/);
  const home = readFileSync('src/features/dashboard/DashboardHome.tsx', 'utf8');
  const live = readFileSync('src/features/dashboard/DashboardView.tsx', 'utf8');
  assert.doesNotMatch(home + live, /(?:bg|text|border)-(?:slate|blue|gray)-\d/);
  assert.doesNotMatch(live, /homeFixture|setTimeout|\.from\(/);
});
