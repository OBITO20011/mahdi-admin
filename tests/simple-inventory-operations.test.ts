import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  calculateAvailableSalePackages,
  calculateSaleBaseQuantity,
  calculatePosSummary,
  canSetPosQuantity,
} from '../src/utils/posCalculations';

test('POS totals use integer minor units and calculate customer change', () => {
  const summary = calculatePosSummary(
    [
      { unitPrice: 0.4, quantity: 3 },
      { unitPrice: 1.125, quantity: 2 },
    ],
    0.35,
    5
  );

  assert.deepEqual(summary, {
    subtotal: 3.45,
    discount: 0.35,
    total: 3.1,
    amountReceived: 5,
    changeDue: 1.9,
  });
});

test('POS discounts cannot produce a negative payable total', () => {
  const summary = calculatePosSummary(
    [{ unitPrice: 2, quantity: 1 }],
    5,
    2
  );

  assert.equal(summary.total, 0);
  assert.equal(summary.changeDue, 2);
});

test('cart quantities must be positive integers within available sale packages', () => {
  assert.equal(canSetPosQuantity(4, 4), true);
  assert.equal(canSetPosQuantity(5, 4), false);
  assert.equal(canSetPosQuantity(0, 4), false);
  assert.equal(canSetPosQuantity(1.5, 4), false);
});

test('POS converts base stock to full wholesale packages only', () => {
  assert.equal(calculateAvailableSalePackages(47, 12), 3);
  assert.equal(calculateAvailableSalePackages(11, 12), 0);
  assert.equal(calculateSaleBaseQuantity(2, 12), 24);
});

test('POS totals price sale packages rather than hidden base pieces', () => {
  const summary = calculatePosSummary(
    [{ unitPrice: 10, quantity: 2 }],
    0,
    20
  );

  assert.equal(summary.subtotal, 20);
  assert.equal(summary.total, 20);
});

test('wholesale accounting migration preserves package and base quantities', () => {
  const migration = fs.readFileSync(
    'supabase/migrations/023_wholesale_order_accounting.sql',
    'utf8'
  );

  assert.match(migration, /sale_package_quantity INTEGER/);
  assert.match(
    migration,
    /v_base_quantity := v_package_quantity \* v_units_per_package/
  );
  assert.match(
    migration,
    /v_line_total := v_package_quantity \* v_package_price/
  );
  assert.match(
    migration,
    /profit_in_minor_units[\s\S]*line_total[\s\S]*quantity \* unit_cost_in_minor_units/
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.create_pos_sale/
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.create_customer_order/
  );
});

test('product and POS screens expose wholesale package values only', () => {
  const productForm = fs.readFileSync(
    'src/features/products/ProductFormModal.tsx',
    'utf8'
  );
  const posView = fs.readFileSync(
    'src/features/pos/PosView.tsx',
    'utf8'
  );

  assert.doesNotMatch(productForm, /سعر الحبة المحاسبي/);
  assert.match(posView, /prod\.salePackagePrice/);
  assert.match(posView, /calculateAvailableSalePackages/);
  assert.match(posView, /isWholesaleReady/);
  assert.match(posView, /p\.saleUnitCode !== 'PCS'/);
  assert.doesNotMatch(posView, /prod\.retailPrice\.toFixed/);
  assert.doesNotMatch(posView, /totalPrice: prod\.retailPrice/);
});

test('inventory clear action reuses the audited stock adjustment RPC', () => {
  const inventoryView = fs.readFileSync(
    'src/features/inventory/InventoryView.tsx',
    'utf8'
  );
  const clearDialog = fs.readFileSync(
    'src/features/inventory/ClearInventoryBalanceDialog.tsx',
    'utf8'
  );
  const inventoryMigration = fs.readFileSync(
    'supabase/migrations/014_simple_inventory_operations.sql',
    'utf8'
  );

  assert.match(inventoryView, /حذف الرصيد/);
  assert.match(inventoryView, /ClearInventoryBalanceDialog/);
  assert.match(clearDialog, /executeStockCount/);
  assert.match(clearDialog, /actualQuantity:\s*0/);
  assert.match(clearDialog, /adjustmentType:\s*'manual'/);
  assert.match(clearDialog, /product\.reservedQuantity > 0/);
  assert.match(clearDialog, /confirmationMatches/);
  assert.match(
    inventoryMigration,
    /IF p_actual_quantity < v_reserved_quantity THEN/
  );
  assert.match(
    inventoryMigration,
    /INSERT INTO public\.inventory_movements/
  );
  assert.match(inventoryMigration, /'ADJUST_INVENTORY_STOCK'/);
});
