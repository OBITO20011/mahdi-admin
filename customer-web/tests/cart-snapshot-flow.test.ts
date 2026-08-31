import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const catalogService = readFileSync(
  new URL('../src/services/catalog.service.ts', import.meta.url),
  'utf8'
);

test('opening the cart and starting checkout both use the bounded server snapshot', () => {
  assert.match(app, /const openCart = useCallback/);
  assert.match(app, /void refreshCartSnapshot\(itemsToRefresh\)/);
  assert.match(app, /currentCartItems = \(await refreshCartSnapshot\(\)\)\.items/);
  assert.match(catalogService, /p_product_ids: query\.productIds/);
  assert.match(catalogService, /STOREFRONT_CART_SNAPSHOT_BATCH_SIZE = 48/);
});

test('matching cart-open and checkout snapshots coalesce instead of duplicating requests', () => {
  assert.match(app, /pendingCartSnapshotRef/);
  assert.match(app, /pendingCartSnapshotRef\.current\?\.key === snapshotKey/);
  assert.match(app, /return pendingCartSnapshotRef\.current\.promise/);
});
