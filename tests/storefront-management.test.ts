import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/037_storefront_management.sql', import.meta.url),
  'utf8'
);
const homeSectionsMigration = readFileSync(
  new URL('../supabase/migrations/038_storefront_home_sections.sql', import.meta.url),
  'utf8'
);
const deliveryZoneMigration = readFileSync(
  new URL('../supabase/migrations/061_delivery_zone_pricing.sql', import.meta.url),
  'utf8'
);
const service = readFileSync(
  new URL('../src/services/supabase/storefront-settings.service.ts', import.meta.url),
  'utf8'
);

test('storefront settings are singleton, RPC-only and audited', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.storefront_settings/);
  assert.match(migration, /ALTER TABLE public\.storefront_settings ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.storefront_settings FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /public\.assert_erp_role/);
  assert.match(migration, /'save_storefront_settings'/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.save_storefront_settings[\s\S]*TO authenticated/);
});

test('checkout enforces operational settings inside PostgreSQL', () => {
  assert.match(deliveryZoneMigration, /IF NOT COALESCE\(v_settings\.orders_enabled, false\)/);
  assert.match(deliveryZoneMigration, /minimum_order_in_minor_units/);
  assert.match(deliveryZoneMigration, /v_settings\.inside_ramtha_delivery_fee_in_minor_units/);
  assert.match(deliveryZoneMigration, /v_settings\.outside_ramtha_delivery_fee_in_minor_units/);
  assert.match(deliveryZoneMigration, /public\.submit_guest_customer_order_core\(/);
  assert.doesNotMatch(service, /\.from\(['"]storefront_settings/);
});

test('admin reads and writes settings only through RPC functions', () => {
  assert.match(service, /\.rpc\(\s*'get_public_storefront_settings'/);
  assert.match(service, /\.rpc\(\s*'save_storefront_settings_v3'/);
  assert.match(service, /p_minimum_order_in_minor_units/);
  assert.match(service, /p_inside_ramtha_delivery_fee_in_minor_units/);
  assert.match(service, /p_outside_ramtha_delivery_fee_in_minor_units/);
});

test('delivery pricing is zone-based, audited and server-calculated', () => {
  assert.match(deliveryZoneMigration, /ADD COLUMN IF NOT EXISTS delivery_zone TEXT/);
  assert.match(deliveryZoneMigration, /p_delivery_zone TEXT DEFAULT 'inside_ramtha'/);
  assert.match(deliveryZoneMigration, /save_storefront_delivery_zone_fees/);
  assert.match(deliveryZoneMigration, /GRANT EXECUTE ON FUNCTION public\.save_storefront_settings_v3[\s\S]*TO authenticated/);
  assert.match(deliveryZoneMigration, /GRANT EXECUTE ON FUNCTION public\.submit_guest_customer_order[\s\S]*TO anon, authenticated/);
  assert.doesNotMatch(deliveryZoneMigration, /p_delivery_fee_in_minor_units TEXT/);
});

test('homepage visibility is saved by a protected audited RPC', () => {
  assert.match(homeSectionsMigration, /show_newest_products/);
  assert.match(homeSectionsMigration, /show_best_sellers/);
  assert.match(homeSectionsMigration, /show_offers/);
  assert.match(homeSectionsMigration, /show_low_stock/);
  assert.match(homeSectionsMigration, /public\.save_storefront_settings\(/);
  assert.match(homeSectionsMigration, /'save_storefront_home_sections'/);
  assert.match(homeSectionsMigration, /TO authenticated/);
});
