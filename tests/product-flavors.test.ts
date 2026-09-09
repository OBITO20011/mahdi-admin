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
const hardeningMigration = readFileSync(
  new URL(
    '../supabase/migrations/103_flavor_receiving_hardening.sql',
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
const directReceivingService = readFileSync(
  new URL(
    '../src/services/supabase/directReceiving.service.ts',
    import.meta.url
  ),
  'utf8'
);
const purchaseOrderModal = readFileSync(
  new URL(
    '../src/features/purchases/CreatePurchaseOrderModal.tsx',
    import.meta.url
  ),
  'utf8'
);
const stockCountModal = readFileSync(
  new URL('../src/features/inventory/StockCountModal.tsx', import.meta.url),
  'utf8'
);
const warehouseTransferModal = readFileSync(
  new URL(
    '../src/features/inventory/WarehouseTransferModal.tsx',
    import.meta.url
  ),
  'utf8'
);
const inventoryOpeningService = readFileSync(
  new URL(
    '../src/services/supabase/inventory-opening.service.ts',
    import.meta.url
  ),
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

test('admin adds only flavor identity, never opening stock or a second price', () => {
  assert.match(productService, /createProductFlavorInSupabase/);
  assert.match(adminDetails, /المخزون مستقل لكل نكهة/);
  assert.doesNotMatch(adminDetails, /رصيد البداية/);
  assert.match(adminDetails, /تُنشأ النكهة برصيد صفر/);
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
  assert.doesNotMatch(adminForm, /رصيد البداية/);
  assert.match(adminForm, /يُنشأ الصنف برصيد صفر/);
  assert.match(adminForm, /createProductFamilyWithFlavorsInSupabase/);
  assert.doesNotMatch(adminForm, /سعر النكهة/);
});

test('flavor master is rejected at the inventory persistence boundary', () => {
  assert.match(
    hardeningMigration,
    /CREATE OR REPLACE FUNCTION public\.reject_flavor_master_inventory_mutation/
  );
  assert.match(
    hardeningMigration,
    /trg_inventory_balances_reject_flavor_master/
  );
  assert.match(
    hardeningMigration,
    /trg_inventory_movements_reject_flavor_master/
  );
  assert.match(
    hardeningMigration,
    /COALESCE\(p_opening_quantity, 0\) <> 0/
  );
});

test('receiving and purchase-order selectors exclude flavor masters', () => {
  assert.match(
    directReceivingService,
    /\.eq\('is_flavor_master', false\)/
  );
  assert.match(purchaseOrderModal, /!p\.isFlavorMaster/);
  assert.match(stockCountModal, /!product\.isFlavorMaster/);
  assert.match(warehouseTransferModal, /!product\.isFlavorMaster/);
  assert.doesNotMatch(inventoryOpeningService, /\.from\(/);
  assert.match(
    hardeningMigration,
    /get_inventory_opening_setup[\s\S]*WHERE p\.is_flavor_master = false/
  );
});

test('child WAC is initialized once and never overwritten by master edits', () => {
  assert.match(
    hardeningMigration,
    /IF TG_OP = 'INSERT' THEN[\s\S]*NEW\.cost_price_in_minor_units := v_master\.cost_price_in_minor_units/
  );
  const syncFunction = hardeningMigration.match(
    /CREATE OR REPLACE FUNCTION public\.sync_product_flavor_commercial_settings\(\)[\s\S]*?\$\$;/
  )?.[0];
  assert.ok(syncFunction);
  assert.doesNotMatch(syncFunction, /cost_price_in_minor_units\s*=/);
});

test('editing a flavor master exposes existing children and reuses management', () => {
  assert.match(adminForm, /النكهات الحالية/);
  assert.match(adminForm, /SKU: \{flavor\.sku\}/);
  assert.match(adminForm, /إدارة النكهات/);
  assert.match(adminForm, /openModal\('view_product', initialProduct\)/);
  assert.doesNotMatch(
    adminForm,
    /onClose\(\);\s*openModal\('view_product', initialProduct\)/,
    'switching from edit to flavor management must not close the shared modal dispatcher first'
  );
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
