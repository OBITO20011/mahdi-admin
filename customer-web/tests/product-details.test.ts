import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProductShareUrl,
  calculateProductSelectionTotal,
  clampProductSelectionQuantity,
  getRemainingProductPackages,
} from '../src/utils/productDetails';

test('product details only allow packages that remain outside the cart', () => {
  assert.equal(getRemainingProductPackages(8, 3), 5);
  assert.equal(clampProductSelectionQuantity(9, 8, 3), 5);
  assert.equal(clampProductSelectionQuantity(0, 8, 3), 1);
  assert.equal(clampProductSelectionQuantity(2, 3, 3), 0);
});

test('product details total prices complete wholesale packages', () => {
  assert.equal(calculateProductSelectionTotal(5400, 3), 16200);
  assert.equal(calculateProductSelectionTotal(5400, 0), 0);
});

test('shared product links keep a stable encoded catalog key', () => {
  assert.equal(
    buildProductShareUrl(
      'https://store.example/catalog?source=whatsapp#catalog',
      'NWS 100/2'
    ),
    'https://store.example/catalog?source=whatsapp#product=NWS%20100%2F2'
  );
});
