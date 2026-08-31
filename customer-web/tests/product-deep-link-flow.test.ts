import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const appSource = fs.readFileSync(
  path.resolve(import.meta.dirname, '../src/App.tsx'),
  'utf8'
);
const catalogServiceSource = fs.readFileSync(
  path.resolve(import.meta.dirname, '../src/services/catalog.service.ts'),
  'utf8'
);

test('direct product links resolve locally first and otherwise request one bounded server snapshot', () => {
  assert.match(appSource, /const localProductLink = findPublicProductLink\(products, productKey\)/);
  assert.match(appSource, /fetchPublicProductLink\(productKey\)/);
  assert.match(catalogServiceSource, /STOREFRONT_PRODUCT_LINK_SEARCH_LIMIT = 8/);
  assert.match(catalogServiceSource, /productIds: \[normalizedKey\]/);
  assert.match(catalogServiceSource, /searchQuery: normalizedKey/);
});

test('direct product links do not loop or repeat an in-flight request', () => {
  assert.match(appSource, /resolvedProductLinkKeyRef\.current === productKey/);
  assert.match(appSource, /pendingProductLinkRef\.current\?\.key === productKey/);
  assert.match(appSource, /pendingProductLinkRef\.current = \{ key: productKey, promise: request \}/);
});

test('direct product links give an Arabic message for missing or unavailable products', () => {
  assert.match(appSource, /هذا المنتج غير موجود أو لم يعد متاحًا للبيع/);
  assert.match(appSource, /هذا المنتج لم يعد متاحًا للبيع حاليًا/);
});
