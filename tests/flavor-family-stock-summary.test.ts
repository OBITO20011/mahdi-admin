import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  formatWholesaleInventory,
  summarizeFlavorFamilyInventory,
} from '../src/utils/inventoryFormatter';

const flavor = (
  onHandQuantity: number,
  reservedQuantity: number,
  availableQuantity: number,
  unitsPerPackage = 6
) => ({
  onHandQuantity,
  reservedQuantity,
  availableQuantity,
  unitsPerPackage,
  purchasePackage: 'كرتونة',
  unit: 'حبة',
});

test('two flavor children are summed from base units and formatted as one family total', () => {
  const summary = summarizeFlavorFamilyInventory([
    flavor(24, 0, 24),
    flavor(24, 0, 24),
  ]);

  assert.equal(summary.onHandQuantity, 48);
  assert.equal(summary.reservedQuantity, 0);
  assert.equal(summary.availableQuantity, 48);
  assert.equal(summary.hasCompatiblePackaging, true);
  assert.equal(
    formatWholesaleInventory(
      summary.availableQuantity,
      summary.unitsPerPackage,
      summary.purchasePackage,
      summary.unit
    ).cartons,
    8
  );
});

test('zero and non-zero flavors produce the exact available family balance', () => {
  const summary = summarizeFlavorFamilyInventory([
    flavor(0, 0, 0),
    flavor(30, 0, 30),
  ]);

  assert.equal(summary.availableQuantity, 30);
  assert.equal(
    formatWholesaleInventory(30, 6, 'كرتونة', 'حبة').cartons,
    5
  );
});

test('on-hand, reserved and available totals stay separate', () => {
  const summary = summarizeFlavorFamilyInventory([
    flavor(30, 6, 24),
    flavor(18, 6, 12),
  ]);

  assert.deepEqual(
    {
      onHand: summary.onHandQuantity,
      reserved: summary.reservedQuantity,
      available: summary.availableQuantity,
    },
    { onHand: 48, reserved: 12, available: 36 }
  );
});

test('all-zero families display a valid zero summary', () => {
  const summary = summarizeFlavorFamilyInventory([
    flavor(0, 0, 0),
    flavor(0, 0, 0),
  ]);

  assert.equal(summary.onHandQuantity, 0);
  assert.equal(summary.reservedQuantity, 0);
  assert.equal(summary.availableQuantity, 0);
});

test('mixed package definitions are detected instead of formatted as one carton total', () => {
  const summary = summarizeFlavorFamilyInventory([
    flavor(24, 0, 24, 6),
    flavor(24, 0, 24, 12),
  ]);

  assert.equal(summary.hasCompatiblePackaging, false);
});

test('family summary is read-only UI derived from the existing bounded product listing', () => {
  const productsView = readFileSync(
    new URL('../src/features/products/ProductsView.tsx', import.meta.url),
    'utf8'
  );
  const productDetails = readFileSync(
    new URL('../src/features/products/ProductDetailModal.tsx', import.meta.url),
    'utf8'
  );
  const productService = readFileSync(
    new URL('../src/services/supabase/products.service.ts', import.meta.url),
    'utf8'
  );

  assert.match(productsView, /إجمالي المتاح في النكهات/);
  assert.match(productDetails, /إجمالي مخزون النكهات/);
  assert.match(productDetails, /محسوب للعرض فقط من أرصدة النكهات المستقلة/);
  assert.match(productsView, /summarizeFlavorFamilyInventory\(flavors\)/);
  assert.match(productDetails, /summarizeFlavorFamilyInventory\(flavors\)/);
  assert.match(productService, /'get_admin_product_page'/);
  assert.match(productService, /pageSize/);
  assert.doesNotMatch(productsView, /\.from\(['"]inventory_balances['"]\)/);
  assert.doesNotMatch(productDetails, /\.from\(['"]inventory_balances['"]\)/);
});
