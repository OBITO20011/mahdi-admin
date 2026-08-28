import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(
  new URL('../src/App.tsx', import.meta.url),
  'utf8'
);
const posView = readFileSync(
  new URL('../src/features/pos/PosView.tsx', import.meta.url),
  'utf8'
);

test('admin feature screens and modal dispatcher load on demand', () => {
  assert.match(app, /import React, \{ lazy, Suspense/);
  assert.match(app, /lazy\(\(\) =>/);
  assert.match(app, /import\('\.\/features\/dashboard\/DashboardView'\)/);
  assert.match(app, /import\('\.\/features\/orders\/OrdersCenterView'\)/);
  assert.match(app, /import\('\.\/features\/products\/ProductsView'\)/);
  assert.match(app, /import\('\.\/components\/modals\/AllModals'\)/);
  assert.match(app, /<Suspense fallback=\{<ViewLoadingFallback \/>\}>/);
  assert.match(app, /\{currentModal && \(\s*<Suspense fallback=\{null\}>/);
});

test('barcode scanner code loads only after the cashier opens the camera', () => {
  assert.match(posView, /lazy\(\(\) =>\s*import\('\.\/BarcodeScannerModal'\)/);
  assert.match(posView, /\{isBarcodeScannerOpen && \(/);
  assert.match(posView, /<Suspense/);
  assert.doesNotMatch(posView, /import \{ BarcodeScannerModal \} from '\.\/BarcodeScannerModal'/);
});
