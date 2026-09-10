import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const dashboard = readFileSync(
  new URL('../src/features/dashboard/DashboardView.tsx', import.meta.url),
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

test('daily dashboard cards have semantic light-mode contrast hooks', () => {
  assert.match(dashboard, /data-testid="dashboard-hero"/);
  assert.match(dashboard, /data-ui="dashboard-status-card"/);
  assert.match(dashboard, /data-ui="dashboard-receivables"/);
  assert.equal(dashboard.match(/data-ui="dashboard-quick-card"/g)?.length, 3);
  assert.match(css, /\[data-testid="dashboard-hero"\]/);
  assert.match(css, /\[data-ui="dashboard-status-card"\]/);
});

test('light theme keeps modal backdrops visually separated', () => {
  assert.match(css, /bg-slate-950\/80/);
  assert.match(css, /rgb\(15 23 42 \/ 0\.52\)/);
});

test('light theme has dedicated low-glare navigation, FAB and toast treatments', () => {
  assert.match(css, /\.admin-action-dock/);
  assert.match(css, /\.admin-fab-primary/);
  assert.match(css, /\.admin-fab-assistant/);
  assert.match(css, /\.admin-bottom-tabs \[aria-current="page"\]/);
  assert.match(css, /\[data-ui="admin-toast"\]\[data-tone="success"\]/);
  assert.match(css, /\[data-ui="products-hero"\]/);
  assert.match(css, /--admin-solid-accent:/);
  assert.match(products, /data-ui="products-hero"/);
});

test('the shell renders one accessible toast instead of duplicate banners', () => {
  assert.doesNotMatch(app, /Toast Notification Banner/);
  assert.equal(phoneContainer.match(/<AdminToast toast=\{toast\} \/>/g)?.length, 1);
  assert.match(adminToast, /role=\{toast\.type === 'error' \? 'alert' : 'status'\}/);
  assert.match(adminToast, /aria-atomic="true"/);
});
