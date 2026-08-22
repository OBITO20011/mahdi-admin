import assert from 'node:assert/strict';
import test from 'node:test';
import { CatalogProduct } from '../src/types/catalog';
import {
  buildCatalogView,
  isLowStockProduct,
  normalizeCatalogSearch,
} from '../src/utils/catalogView';

function product(
  id: string,
  nameAr: string,
  price: number,
  availablePackages: number,
  categoryId = 'drinks'
): CatalogProduct {
  return {
    id,
    sku: `NWS-${id}`,
    barcode: '',
    nameAr,
    description: '',
    categoryId,
    categoryCode: categoryId === 'drinks' ? 'CAT-BEV' : 'CAT-BISCUIT',
    categoryNameAr: categoryId === 'drinks' ? 'مشروبات' : 'بسكويت',
    brandId: '',
    brandNameAr: '',
    unitId: 'piece',
    unitNameAr: 'حبة',
    saleUnitId: 'box',
    saleUnitNameAr: 'كرتونة',
    unitsPerSalePackage: 12,
    salePackagePriceInMinorUnits: price,
    availableQuantity: availablePackages * 12,
    availableSalePackages: availablePackages,
    minimumOrderPackages: 1,
    imageUrl: '',
    isAvailable: availablePackages > 0,
    createdAt: '2026-08-01T00:00:00Z',
    soldPackagesLast90Days: 0,
  };
}

const products = [
  product('1', 'مياه آبار', 4200, 8),
  product('2', 'بيبسي', 5400, 3),
  product('3', 'بسكويت', 3000, 0, 'biscuits'),
];

test('Arabic catalog search ignores common hamza and diacritic differences', () => {
  assert.equal(normalizeCatalogSearch('مِيَاه آبَار'), 'مياه ابار');
  assert.deepEqual(
    buildCatalogView(products, {
      searchQuery: 'مياه ابار',
      categoryId: 'all',
      availability: 'all',
      sort: 'recommended',
    }).map((item) => item.id),
    ['1']
  );
});

test('availability filters distinguish available and low stock packages', () => {
  assert.equal(isLowStockProduct(products[0]), false);
  assert.equal(isLowStockProduct(products[1]), true);
  assert.deepEqual(
    buildCatalogView(products, {
      searchQuery: '',
      categoryId: 'all',
      availability: 'low_stock',
      sort: 'recommended',
    }).map((item) => item.id),
    ['2']
  );
});

test('price and stock sorting keep unavailable products after available ones', () => {
  assert.deepEqual(
    buildCatalogView(products, {
      searchQuery: '',
      categoryId: 'all',
      availability: 'all',
      sort: 'price_asc',
    }).map((item) => item.id),
    ['1', '2', '3']
  );
  assert.deepEqual(
    buildCatalogView(products, {
      searchQuery: '',
      categoryId: 'all',
      availability: 'all',
      sort: 'stock_desc',
    }).map((item) => item.id),
    ['1', '2', '3']
  );
});
