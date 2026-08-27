import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/076_admin_product_listing_read_model.sql',
    import.meta.url,
  ),
  'utf8',
);
const productService = readFileSync(
  new URL('../src/services/supabase/products.service.ts', import.meta.url),
  'utf8',
);
const inventoryView = readFileSync(
  new URL('../src/features/inventory/InventoryView.tsx', import.meta.url),
  'utf8',
);

const listStart = productService.indexOf(
  'export async function fetchProductsFromSupabase',
);
const listEnd = productService.indexOf(
  'export async function createProductWithOpeningStockInSupabase',
  listStart,
);
const listingService = productService.slice(listStart, listEnd);

test('admin product listing is a protected one-read model with primary images only', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_admin_product_listing\(\)/);
  assert.match(migration, /STABLE\s+SECURITY DEFINER/);
  assert.match(migration, /PERFORM public\.assert_erp_role/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_admin_product_listing\(\) FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_admin_product_listing\(\) TO authenticated/);
  assert.match(migration, /AND pi\.is_primary = true/);
  assert.match(migration, /LIMIT 1/);
});

test('listing aggregates inventory in PostgreSQL and has lookup indexes', () => {
  assert.match(migration, /SUM\(ib\.on_hand_quantity\)/);
  assert.match(migration, /SUM\(ib\.reserved_quantity\)/);
  assert.match(migration, /SUM\(ib\.available_quantity\)/);
  assert.match(migration, /warehouse_balances/);
  assert.match(migration, /idx_inventory_balances_product_warehouse_lookup/);
  assert.match(migration, /idx_product_images_primary_listing/);
});

test('browser product refresh makes one protected listing call and retains warehouse balances', () => {
  assert.ok(listStart >= 0 && listEnd > listStart);
  assert.match(listingService, /rpc\(\s*'get_admin_product_listing'/);
  assert.match(listingService, /warehouseBalances/);
  assert.doesNotMatch(listingService, /\.from\('inventory_balances'\)/);
  assert.doesNotMatch(listingService, /\.from\('product_images'\)/);
});

test('inventory warehouse filter uses the exact selected warehouse balance', () => {
  assert.match(inventoryView, /product\.warehouseBalances\?\.find/);
  assert.match(inventoryView, /item\.warehouseId === selectedWarehouseId/);
  assert.match(inventoryView, /onHandQuantity: balance\?\.onHandQuantity \?\? 0/);
  assert.match(inventoryView, /availableQuantity: balance\?\.availableQuantity \?\? 0/);
});
