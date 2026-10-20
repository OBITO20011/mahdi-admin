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

test('both themes expose the shared calm, high-contrast Package F palette', () => {
  const tokens=readFileSync('src/styles/design-tokens.css','utf8');
  assert.match(tokens,/--nw-bg:\s*#f4f6f9/i);
  assert.match(tokens,/--nw-surface:\s*#ffffff/i);
  assert.match(tokens,/--nw-text:\s*#0f1b2d/i);
  assert.match(tokens,/--nw-info-bg:\s*#e3ecfd/i);
  assert.match(tokens,/--nw-ok-bg:\s*#e3f4ea/i);
  assert.match(css,/:root\s*\{\s*color-scheme:\s*light/);
  assert.match(css,/html.theme-dark\s*\{\s*color-scheme:\s*dark/);
  assert.match(readFileSync('src/components/ui/form-fields.css','utf8'),/:focus[\s\S]*0 0 0 2px var\(--nw-primary\)/);
});

test('Package F Home uses shared token surfaces without legacy contrast overrides', () => {
  assert.match(dashboard, /data-testid="dashboard-hero"/);
  assert.match(dashboard, /<KpiGrid phonePairs/);
  assert.equal(dashboard.match(/<KpiCard /g)?.length, 4); // the same four cards at both widths
  assert.doesNotMatch(dashboard, /bg-nw-hero/);
  assert.match(dashboard, /bg-nw-bg text-nw-text/);
  assert.match(dashboard, /<Card/);
  assert.doesNotMatch(dashboard, /(?:bg|text|border)-(?:slate|blue|gray)-\d/);
  assert.doesNotMatch(css, /\[data-testid="dashboard-hero"\]|\[data-ui="dashboard-(?:status-card|quick-card|receivables)"\]/);
});

test('light theme keeps modal backdrops visually separated', () => {
  assert.match(readFileSync('src/components/common/Modal.tsx','utf8'),/bg-nw-side\/80/);
  assert.doesNotMatch(css,/\[class~=/);
});

test('light theme has dedicated low-glare navigation, FAB and toast treatments', () => {
  // Package F: no legacy dock/FAB/bottom-tab overrides; the tabs read tokens directly.
  assert.doesNotMatch(css, /\.admin-action-dock|\.admin-fab|\.admin-bottom-tabs \[aria-current/);
  const bottomTabs = readFileSync('src/components/layout/BottomTabs.tsx', 'utf8');
  assert.match(bottomTabs, /bg-nw-surface/);
  assert.match(bottomTabs, /text-nw-primary/);
  assert.match(bottomTabs, /bg-nw-accent/);
  assert.match(adminToast,/border-nw-ok bg-nw-ok-bg text-nw-ok/);
  assert.match(adminToast,/border-nw-info bg-nw-info-bg text-nw-info/);
  assert.match(adminToast,/border-nw-bad bg-nw-bad-bg text-nw-bad/);
  // Products now owns shared token surfaces; no forced light-only gradient.
  assert.doesNotMatch(css, /html.theme-light \[data-ui="products-hero"\]/);
  assert.match(products, /<Card padded=\{false\} data-ui="products-hero"/);
  assert.match(products, /bg-nw-bg/);
  assert.match(products, /<PageHeader title="دليل المنتجات"/);
  assert.doesNotMatch(css, /--admin-solid-accent:/);
  assert.match(products, /data-ui="products-hero"/);
});

test('the shell renders one accessible toast instead of duplicate banners', () => {
  assert.doesNotMatch(app, /Toast Notification Banner/);
  assert.equal(phoneContainer.match(/<AdminToast toast=\{toast\} \/>/g)?.length, 1);
  assert.match(adminToast, /role=\{toast\.type === 'error' \? 'alert' : 'status'\}/);
  assert.match(adminToast, /aria-atomic="true"/);
});
