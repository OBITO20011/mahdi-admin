import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/070_product_flavor_variants.sql', import.meta.url),
  'utf8'
);
const productService = readFileSync(
  new URL('../src/services/supabase/products.service.ts', import.meta.url),
  'utf8'
);
const adminDetails = readFileSync(
  new URL('../src/features/products/ProductDetailModal.tsx', import.meta.url),
  'utf8'
);
const storefrontDetails = readFileSync(
  new URL('../customer-web/src/components/ProductDetailsModal.tsx', import.meta.url),
  'utf8'
);

test('flavors inherit the master commercial price while retaining product inventory ids', () => {
  assert.match(migration, /flavor_master_product_id UUID/);
  assert.match(migration, /NEW\.default_sale_price_in_minor_units\s*:=\s*v_master\.default_sale_price_in_minor_units/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.create_product_flavor_v1/);
  assert.match(migration, /p_opening_sale_packages[\s\S]*v_master\.units_per_sale_unit/);
  assert.match(migration, /CREATE_PRODUCT_FLAVOR/);
});

test('admin adds only flavor identity and stock, never a second price', () => {
  assert.match(productService, /createProductFlavorInSupabase/);
  assert.match(adminDetails, /المخزون مستقل لكل نكهة/);
  assert.match(adminDetails, /رصيد البداية/);
  assert.doesNotMatch(adminDetails, /سعر النكهة/);
});

test('storefront requires choosing a flavor and shows per-flavor availability', () => {
  assert.match(storefrontDetails, /اختر النكهة/);
  assert.match(storefrontDetails, /نافدة حاليًا/);
  assert.match(storefrontDetails, /onAddQuantity\(product, quantity\)/);
});
