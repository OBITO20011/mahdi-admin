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
const boundedMigration = readFileSync(
  new URL(
    '../supabase/migrations/109_admin_large_catalog_read_models.sql',
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

test('browser product refresh uses a bounded protected search and retains warehouse balances', () => {
  assert.ok(listStart >= 0 && listEnd > listStart);
  assert.match(listingService, /'search_admin_products'/);
  assert.match(listingService, /p_limit: 50/);
  assert.match(productService, /warehouseBalances/);
  assert.doesNotMatch(listingService, /\.from\('inventory_balances'\)/);
  assert.doesNotMatch(listingService, /\.from\('product_images'\)/);
});

test('inventory warehouse filter and metrics are calculated on the server, not the current page', () => {
  assert.match(inventoryView, /fetchInventoryProductPageFromSupabase/);
  assert.match(inventoryView, /warehouseId: selectedWarehouseId === 'all'/);
  assert.match(inventoryView, /inventoryProductPage\.metrics\.totalCostValue/);
  assert.match(boundedMigration, /CREATE OR REPLACE FUNCTION public\.get_admin_inventory_product_page/);
  assert.match(boundedMigration, /p_warehouse_id IS NULL OR ib\.warehouse_id = p_warehouse_id/);
  assert.match(boundedMigration, /FROM inventory_catalog product/);
  assert.match(boundedMigration, /FROM paged_catalog product/);
});

test('large-catalog read models enforce bounded pages, deterministic ordering, and protected execution', () => {
  assert.match(boundedMigration, /v_page_size < 1 OR v_page_size > 100/);
  assert.match(boundedMigration, /v_limit < 1 OR v_limit > 50/);
  assert.match(boundedMigration, /root\.name_ar ASC,[\s\S]*root\.id ASC/);
  assert.match(boundedMigration, /product\.name_ar, product\.id/);
  assert.match(boundedMigration, /PERFORM public\.assert_erp_role/g);
  assert.match(boundedMigration, /REVOKE ALL ON FUNCTION public\.get_admin_product_page/);
  assert.match(boundedMigration, /REVOKE ALL ON FUNCTION public\.search_admin_products/);
  assert.match(boundedMigration, /REVOKE ALL ON FUNCTION public\.get_admin_inventory_product_page/);
  assert.match(
    boundedMigration,
    /default_sale_price_in_minor_units, 0\)::NUMERIC\s*\/\s*GREATEST\(COALESCE\(root\.units_per_sale_unit, 1\), 1\)\s*- root\.cost_price_in_minor_units/,
  );
});
