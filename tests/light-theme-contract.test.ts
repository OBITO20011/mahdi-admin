import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const dashboard = readFileSync(
  new URL('../src/features/dashboard/DashboardView.tsx', import.meta.url),
  'utf8'
);

test('light theme exposes a calm, high-contrast surface palette', () => {
  assert.match(css, /--admin-canvas:\s*#dfe7f1/);
  assert.match(css, /--admin-surface:\s*#ffffff/);
  assert.match(css, /--admin-text:\s*#172033/);
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
