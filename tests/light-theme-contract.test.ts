import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const dashboard = readFileSync(
  new URL('../src/features/dashboard/DashboardHome.tsx', import.meta.url),
  'utf8'
);
const products = readFileSync(
  new URL('../src/features/products/ProductsView.tsx', import.meta.url),
  'utf8'
);
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const phoneContainer = readFileSync(
  new URL('../src/components/layout/IPhoneContainer.tsx', import.meta.url),
  'utf8'
);
const adminToast = readFileSync(
  new URL('../src/components/layout/AdminToast.tsx', import.meta.url),
  'utf8'
);

test('light theme exposes a calm, high-contrast surface palette', () => {
  assert.match(css, /--admin-canvas:\s*#e9eef4/);
  assert.match(css, /--admin-screen:\s*#f7f8fa/);
  assert.match(css, /--admin-surface:\s*#fdfdfc/);
  assert.match(css, /--admin-text:\s*#182235/);
  assert.match(css, /--admin-primary-soft:\s*#eaf2ff/);
  assert.match(css, /--admin-success-soft:\s*#ecfdf3/);
  assert.match(css, /--admin-shadow-md:/);
  assert.match(css, /input:focus[\s\S]*0 0 0 3px/);
});

test('Package F Home uses shared token surfaces without legacy contrast overrides', () => {
  assert.match(dashboard, /data-testid="dashboard-hero"/);
  assert.match(dashboard, /<KpiGrid phonePairs/);
  assert.equal(dashboard.match(/<KpiCard /g)?.length, 8); // four desktop and four phone cards
  assert.match(dashboard, /bg-nw-hero/);
  assert.match(dashboard, /text-nw-side-text/);
  assert.match(dashboard, /<Card/);
  assert.doesNotMatch(dashboard, /(?:bg|text|border)-(?:slate|blue|gray)-\d/);
  assert.doesNotMatch(css, /\[data-testid="dashboard-hero"\]|\[data-ui="dashboard-(?:status-card|quick-card|receivables)"\]/);
});

test('light theme keeps modal backdrops visually separated', () => {
  assert.match(css, /bg-slate-950\/80/);
  assert.match(css, /rgb\(15 23 42 \/ 0\.52\)/);
});

test('light theme has dedicated low-glare navigation, FAB and toast treatments', () => {
  // Package F: no legacy dock/FAB/bottom-tab overrides; the tabs read tokens directly.
  assert.doesNotMatch(css, /\.admin-action-dock|\.admin-fab|\.admin-bottom-tabs \[aria-current/);
  const bottomTabs = readFileSync('src/components/layout/BottomTabs.tsx', 'utf8');
  assert.match(bottomTabs, /bg-nw-surface/);
  assert.match(bottomTabs, /text-nw-primary/);
  assert.match(bottomTabs, /bg-nw-accent/);
  assert.match(css, /\[data-ui="admin-toast"\]\[data-tone="success"\]/);
  // Products now owns shared token surfaces; no forced light-only gradient.
  assert.doesNotMatch(css, /html.theme-light \[data-ui="products-hero"\]/);
  assert.match(products, /<Card padded=\{false\} data-ui="products-hero"/);
  assert.match(products, /bg-nw-bg/);
  assert.match(products, /<PageHeader title="دليل المنتجات"/);
  assert.match(css, /--admin-solid-accent:/);
  assert.match(products, /data-ui="products-hero"/);
});

test('the shell renders one accessible toast instead of duplicate banners', () => {
  assert.doesNotMatch(app, /Toast Notification Banner/);
  assert.equal(phoneContainer.match(/<AdminToast toast=\{toast\} \/>/g)?.length, 1);
  assert.match(adminToast, /role=\{toast\.type === 'error' \? 'alert' : 'status'\}/);
  assert.match(adminToast, /aria-atomic="true"/);
});
