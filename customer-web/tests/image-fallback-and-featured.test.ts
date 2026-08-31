import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const productImage = readFileSync(
  new URL('../src/components/ProductImage.tsx', import.meta.url),
  'utf8',
);
const merchandising = readFileSync(
  new URL('../src/components/MerchandisingSections.tsx', import.meta.url),
  'utf8',
);
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('product image failures render the shared customer-safe fallback', () => {
  assert.match(productImage, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(productImage, /role="img"/);
  assert.match(productImage, /لا توجد صورة/);
  assert.match(productImage, /ImageOff/);
});

test('featured loading failures are visible and retry without duplicate loads', () => {
  assert.match(merchandising, /تعذر تحميل الاختيارات المميزة حاليًا/);
  assert.match(merchandising, /onRetry\}/);
  assert.match(app, /featuredProductsError/);
  assert.match(app, /pendingFeaturedProductsRef/);
  assert.match(app, /onRetry=\{\(\) => void loadFeaturedProducts\(\)\}/);
});
