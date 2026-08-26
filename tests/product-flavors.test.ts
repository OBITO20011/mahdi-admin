import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/070_product_flavor_variants.sql', import.meta.url),
  'utf8'
);
const atomicFamilyMigration = readFileSync(
  new URL(
    '../supabase/migrations/071_atomic_product_family_creation.sql',
    import.meta.url
  ),
  'utf8'
);
const flavorManagementMigration = readFileSync(
  new URL(
    '../supabase/migrations/072_manage_product_flavors.sql',
    import.meta.url
  ),
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
const adminForm = readFileSync(
  new URL('../src/features/products/ProductFormModal.tsx', import.meta.url),
  'utf8'
);
const adminProducts = readFileSync(
  new URL('../src/features/products/ProductsView.tsx', import.meta.url),
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

test('add-product flow creates the complete flavor family atomically', () => {
  assert.match(
    atomicFamilyMigration,
    /CREATE OR REPLACE FUNCTION public\.create_product_family_with_flavors_v1/
  );
  assert.match(
    atomicFamilyMigration,
    /create_product_with_opening_stock_v4[\s\S]*create_product_flavor_v1/
  );
  assert.match(
    atomicFamilyMigration,
    /REVOKE ALL[\s\S]*FROM PUBLIC, anon[\s\S]*GRANT EXECUTE[\s\S]*TO authenticated/
  );
  assert.match(productService, /createProductFamilyWithFlavorsInSupabase/);
  assert.match(adminForm, /هل لهذا المنتج نكهات؟/);
  assert.match(adminForm, /رصيد البداية/);
  assert.match(adminForm, /createProductFamilyWithFlavorsInSupabase/);
  assert.doesNotMatch(adminForm, /سعر النكهة/);
});

test('flavor management preserves inventory and history while editing identity', () => {
  assert.match(
    flavorManagementMigration,
    /CREATE OR REPLACE FUNCTION public\.update_product_flavor_v1/
  );
  assert.match(flavorManagementMigration, /UPDATE_PRODUCT_FLAVOR/);
  assert.match(flavorManagementMigration, /set_product_primary_image/);
  assert.match(adminDetails, /updateProductFlavorInSupabase/);
  assert.match(adminDetails, /إيقاف النكهة يخفيها عن العملاء فقط/);
  assert.match(adminDetails, /الباركود \(اختياري\)/);
  assert.doesNotMatch(flavorManagementMigration, /DELETE FROM public\.products/);
});

test('admin groups flavor families into one expandable searchable product card', () => {
  assert.match(adminProducts, /flavorsByMaster/);
  assert.match(adminProducts, /aria-expanded=\{areFlavorsExpanded\}/);
  assert.match(adminProducts, /إدارة النكهات وترتيبها/);
  assert.match(adminProducts, /flavor\.flavorNameAr[\s\S]*includes\(query\)/);
  assert.match(
    flavorManagementMigration,
    /CREATE OR REPLACE FUNCTION public\.reorder_product_flavors_v1/
  );
  assert.match(flavorManagementMigration, /REORDER_PRODUCT_FLAVORS/);
});

test('storefront requires choosing a flavor and shows per-flavor availability', () => {
  assert.match(storefrontDetails, /اختر النكهة/);
  assert.match(storefrontDetails, /نافدة حاليًا/);
  assert.match(storefrontDetails, /onAddQuantity\(product, quantity\)/);
});
