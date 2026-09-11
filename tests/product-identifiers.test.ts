import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Product } from '../src/types';
import {
  generateUniqueProductSku,
  isPosSellableProduct,
  resolvePosProductCode,
  validateProductIdentifiers,
} from '../src/utils/productIdentifiers';
import { toProductMutationFailure } from '../src/services/supabase/products.service';

const integrityMigration = readFileSync(
  new URL(
    '../supabase/migrations/108_harden_product_sku_barcode_integrity.sql',
    import.meta.url
  ),
  'utf8'
);

const product = (overrides: Partial<Product> = {}): Product => ({
  id: '11111111-1111-4111-8111-111111111111',
  sku: 'NWS-ONE',
  barcode: '625100000001',
  nameAr: 'منتج اختبار',
  imageUrl: '',
  categoryId: 'category',
  costPrice: 1,
  retailPrice: 2,
  wholesalePrice: 2,
  taxRate: 0,
  unit: 'قطعة',
  unitsPerSalePackage: 12,
  salePackagePrice: 12,
  saleUnitCode: 'BOX',
  onHandQuantity: 12,
  reservedQuantity: 0,
  availableQuantity: 12,
  reorderLevel: 0,
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

test('SKU and barcode validation is trimmed, case-insensitive and cross-field safe', () => {
  const products = [product()];

  assert.deepEqual(
    validateProductIdentifiers(products, { sku: ' nws-one ' }),
    {
      valid: false,
      code: 'DUPLICATE_SKU',
      message: 'رمز الصنف SKU مستخدم بالفعل لمنتج آخر.',
    }
  );
  assert.equal(
    validateProductIdentifiers(products, {
      sku: 'NWS-TWO',
      barcode: ' 625100000001 ',
    }).valid,
    false
  );
  assert.equal(
    validateProductIdentifiers(products, {
      sku: '625100000001',
    }).valid,
    false
  );
  assert.deepEqual(
    validateProductIdentifiers(products, {
      sku: ' nws-one ',
      currentProductId: products[0].id,
    }),
    { valid: true }
  );
});

test('SKU generator avoids current SKU and barcode identifiers with bounded fallback', () => {
  const timestamp = 123456789;
  const base = `NWS-${timestamp.toString(36).toUpperCase()}`;

  assert.equal(generateUniqueProductSku([], timestamp), base);
  assert.equal(
    generateUniqueProductSku([base.toLowerCase(), `${base}-2`], timestamp),
    `${base}-3`
  );
  assert.throws(
    () => generateUniqueProductSku([base, `${base}-2`], timestamp, 2),
    /تعذر توليد SKU فريد/
  );
});

test('POS resolves a known flavor child once and does not mutate product state', () => {
  const child = product({
    id: '22222222-2222-4222-8222-222222222222',
    sku: 'NWS-FLAVOR',
    barcode: ' FLAVOR-01 ',
    flavorMasterProductId: '33333333-3333-4333-8333-333333333333',
  });
  const products = [child];
  const before = structuredClone(products);

  assert.deepEqual(resolvePosProductCode(products, ' flavor-01 '), {
    status: 'found',
    product: child,
  });
  assert.deepEqual(products, before);
});

test('POS fails closed for unknown, ambiguous, hidden and flavor-master codes', () => {
  assert.deepEqual(resolvePosProductCode([], 'missing'), {
    status: 'not_found',
  });

  const first = product({ sku: 'CROSS-CODE', barcode: '' });
  const second = product({
    id: '44444444-4444-4444-8444-444444444444',
    sku: 'OTHER',
    barcode: 'cross-code',
  });
  assert.deepEqual(resolvePosProductCode([first, second], 'cross-code'), {
    status: 'ambiguous',
  });
  assert.deepEqual(
    resolvePosProductCode([product({ status: 'hidden' })], 'NWS-ONE'),
    { status: 'not_sellable' }
  );
  assert.deepEqual(
    resolvePosProductCode([product({ isFlavorMaster: true })], 'NWS-ONE'),
    { status: 'not_sellable' }
  );
  assert.equal(isPosSellableProduct(product()), true);
});

test('database duplicate errors are converted to safe Arabic product messages', () => {
  const skuFailure = toProductMutationFailure(
    {
      code: '23505',
      message:
        'duplicate key value violates unique constraint "products_sku_normalized_key"',
      details: 'Key (upper(btrim(sku)))=(NWS-ONE) already exists.',
    },
    'تعذر حفظ المنتج.'
  );
  assert.equal(skuFailure.error, 'رمز الصنف SKU مستخدم بالفعل لمنتج آخر.');
  assert.deepEqual(skuFailure.errorDetails, {
    code: 'DUPLICATE_SKU',
    message: 'رمز الصنف SKU مستخدم بالفعل لمنتج آخر.',
    status: 409,
  });

  const barcodeFailure = toProductMutationFailure(
    {
      code: '23505',
      message: 'الباركود مستخدم بالفعل لمنتج آخر.',
      details: 'internal database detail must not reach the form',
    },
    'تعذر حفظ المنتج.'
  );
  assert.equal(barcodeFailure.error, 'الباركود مستخدم بالفعل لمنتج آخر.');
  assert.equal(barcodeFailure.errorDetails?.details, undefined);
});

test('migration enforces normalized identifiers and race-safe cross-field lookup', () => {
  assert.match(integrityMigration, /products_sku_normalized_key/);
  assert.match(integrityMigration, /products_barcode_normalized_key/);
  assert.match(integrityMigration, /pg_advisory_xact_lock/);
  assert.match(integrityMigration, /product_identifier_cross_collision/);
  assert.match(integrityMigration, /products_flavor_master_no_barcode_check/);
  assert.match(
    integrityMigration,
    /REVOKE ALL ON FUNCTION public\.enforce_product_identifier_integrity\(\)[\s\S]*FROM PUBLIC, anon, authenticated/
  );
  assert.doesNotMatch(integrityMigration, /UPDATE public\.products\s+SET\s+sku/);
});
