import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  calculatePackagePrice,
  calculateProductProfit,
  calculateUnitCost,
} from '../src/utils/productCalculations';
import {
  getProductImageExtension,
  PRODUCT_IMAGE_MAX_BYTES,
  validateProductImage,
} from '../src/utils/productImage';

test('unit cost is derived from the supplier package price', () => {
  assert.equal(calculateUnitCost(7.2, 24), 0.3);
  assert.equal(calculateUnitCost(7.2, 0), 7.2);
});

test('package and unit purchase prices stay mathematically linked', () => {
  assert.equal(calculatePackagePrice(0.4, 10), 4);
  assert.equal(
    calculateUnitCost(calculatePackagePrice(0.275, 24), 24),
    0.275
  );
});

test('product profit distinguishes sales margin from cost markup', () => {
  assert.deepEqual(calculateProductProfit(0.45, 0.3), {
    profitPerUnit: 0.15,
    marginPercentage: 33.3,
    markupPercentage: 50,
    isLoss: false,
  });
});

test('product profit reports a selling loss', () => {
  assert.deepEqual(calculateProductProfit(0.25, 0.3), {
    profitPerUnit: -0.05,
    marginPercentage: -20,
    markupPercentage: -16.7,
    isLoss: true,
  });
});

test('wholesale package profit compares the full package sale and cost', () => {
  const packageCost = calculatePackagePrice(
    calculateUnitCost(5, 4),
    4
  );

  assert.equal(packageCost, 5);
  assert.deepEqual(calculateProductProfit(5, packageCost), {
    profitPerUnit: 0,
    marginPercentage: 0,
    markupPercentage: 0,
    isLoss: false,
  });
});

test('wholesale box accounting matches the product form example exactly', () => {
  const baseCost = calculateUnitCost(7.2, 12);
  const salePackageCost = calculatePackagePrice(baseCost, 12);
  const profit = calculateProductProfit(10, salePackageCost);

  assert.equal(baseCost, 0.6);
  assert.equal(salePackageCost, 7.2);
  assert.deepEqual(profit, {
    profitPerUnit: 2.8,
    marginPercentage: 28,
    markupPercentage: 38.9,
    isLoss: false,
  });
  assert.equal(calculateUnitCost(10, 12), 0.8333);
});

test('sale package cost is derived from base cost when package sizes differ', () => {
  const baseCost = calculateUnitCost(7.2, 12);
  const shrinkCost = calculatePackagePrice(baseCost, 6);

  assert.equal(shrinkCost, 3.6);
  assert.deepEqual(calculateProductProfit(4.5, shrinkCost), {
    profitPerUnit: 0.9,
    marginPercentage: 20,
    markupPercentage: 25,
    isLoss: false,
  });
});

test('wholesale package loss is reported against the full package cost', () => {
  assert.deepEqual(calculateProductProfit(7, 7.2), {
    profitPerUnit: -0.2,
    marginPercentage: -2.9,
    markupPercentage: -2.8,
    isLoss: true,
  });
});

test('product images accept catalog-safe formats within the size limit', () => {
  assert.equal(
    validateProductImage({
      type: 'image/jpeg',
      size: PRODUCT_IMAGE_MAX_BYTES,
    }),
    null
  );
  assert.equal(getProductImageExtension('image/png'), 'png');
  assert.equal(getProductImageExtension('image/webp'), 'webp');
});

test('product images reject unsupported formats and oversized files', () => {
  assert.match(
    validateProductImage({ type: 'application/pdf', size: 100 }) || '',
    /غير مدعومة/
  );
  assert.match(
    validateProductImage({
      type: 'image/png',
      size: PRODUCT_IMAGE_MAX_BYTES + 1,
    }) || '',
    /5 ميجابايت/
  );
});

test('brand and unit management persists through protected Supabase RPCs', () => {
  const migration = fs.readFileSync(
    'supabase/migrations/025_product_reference_data_management.sql',
    'utf8'
  );
  const service = fs.readFileSync(
    'src/services/supabase/reference-data.service.ts',
    'utf8'
  );
  const store = fs.readFileSync('src/stores/useAppStore.ts', 'utf8');
  const brandsModal = fs.readFileSync(
    'src/components/modals/BrandsModal.tsx',
    'utf8'
  );
  const unitsModal = fs.readFileSync(
    'src/components/modals/UnitsModal.tsx',
    'utf8'
  );
  const productsView = fs.readFileSync(
    'src/features/products/ProductsView.tsx',
    'utf8'
  );

  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.save_product_brand/
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.set_product_brand_active/
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.save_product_unit/
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.set_product_unit_active/
  );
  assert.match(
    migration,
    /REVOKE INSERT, UPDATE, DELETE ON public\.brands FROM anon, authenticated/
  );
  assert.match(
    migration,
    /REVOKE INSERT, UPDATE, DELETE ON public\.units FROM anon, authenticated/
  );
  assert.match(service, /supabase\.rpc\('save_product_brand'/);
  assert.match(service, /'set_product_brand_active'/);
  assert.match(service, /supabase\.rpc\('save_product_unit'/);
  assert.match(service, /'set_product_unit_active'/);
  assert.doesNotMatch(store, /id: `brand-\$\{Date\.now\(\)\}`/);
  assert.doesNotMatch(store, /id: `unit-\$\{Date\.now\(\)\}`/);
  assert.match(brandsModal, /window\.confirm/);
  assert.match(brandsModal, /activeNames\.has/);
  assert.match(unitsModal, /window\.confirm/);
  assert.match(productsView, /openModal\('manage_brands'\)/);
  assert.match(productsView, /openModal\('manage_units'\)/);
});

test('public catalog categories are seeded and exposed without private costs', () => {
  const migration = fs.readFileSync(
    'supabase/migrations/031_public_catalog_categories.sql',
    'utf8'
  );

  assert.match(migration, /'CAT-WATER', 'مياه'/);
  assert.match(migration, /'CAT-ENERGY', 'مشروبات طاقة'/);
  assert.match(migration, /'CAT-OFFERS', 'عروض خاصة'/);
  assert.match(migration, /'categories'/);
  assert.match(migration, /'availableProductCount'/);
  assert.match(migration, /GRANT EXECUTE[\s\S]*TO anon, authenticated/);
  assert.doesNotMatch(migration, /'costPriceInMinorUnits'/);
  assert.doesNotMatch(migration, /'supplierId'/);
});

test('category cover images use secured storage and reach the public storefront', () => {
  const migration = fs.readFileSync(
    'supabase/migrations/063_category_cover_images.sql',
    'utf8'
  );
  const imageService = fs.readFileSync(
    'src/services/supabase/product-images.service.ts',
    'utf8'
  );
  const referenceDataService = fs.readFileSync(
    'src/services/supabase/reference-data.service.ts',
    'utf8'
  );
  const categoriesModal = fs.readFileSync(
    'src/components/modals/CategoriesModal.tsx',
    'utf8'
  );
  const catalogService = fs.readFileSync(
    'customer-web/src/services/catalog.service.ts',
    'utf8'
  );
  const categoryShowcase = fs.readFileSync(
    'customer-web/src/components/CategoryShowcase.tsx',
    'utf8'
  );

  assert.match(migration, /ADD COLUMN IF NOT EXISTS image_url TEXT/);
  assert.match(migration, /FROM storage\.objects o/);
  assert.match(migration, /save_product_category\(TEXT, UUID, TEXT, TEXT\)/);
  assert.match(migration, /'imageUrl', c\.image_url/);
  assert.match(imageService, /uploadCategoryImageToSupabase/);
  assert.match(referenceDataService, /p_image_url/);
  assert.match(categoriesModal, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(categoriesModal, /تظهر تلقائيًا للعميل/);
  assert.match(catalogService, /imageUrl: textValue\(item\.imageUrl\)/);
  assert.match(categoryShowcase, /category\.imageUrl \|\|/);
});
