import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveCatalogCategories,
  mapCatalogCategory,
  mapCatalogProduct,
} from '../src/services/catalog.service';
import {
  calculateCartPackages,
  calculateCartSubtotal,
  createCartItem,
  reconcileCart,
} from '../src/utils/cart';
import { formatJod } from '../src/utils/money';

const wholesaleProduct = mapCatalogProduct({
  id: 'product-water',
  sku: 'NWS-7221',
  nameAr: 'water',
  categoryId: 'category-drinks',
  categoryCode: 'CAT-BEV',
  categoryNameAr: 'مشروبات وعصائر',
  unitId: 'unit-piece',
  unitNameAr: 'حبة',
  saleUnitId: 'unit-box',
  saleUnitNameAr: 'صندوق',
  unitsPerSalePackage: 6,
  salePackagePriceInMinorUnits: 4000,
  availableQuantity: 50,
  availableSalePackages: 8,
  minimumOrderPackages: 1,
  isAvailable: true,
});

test('catalog maps public category metadata without inventory cost fields', () => {
  assert.deepEqual(
    mapCatalogCategory({
      id: 'category-drinks',
      code: 'CAT-BEV',
      nameAr: 'مشروبات وعصائر',
      productCount: 2,
      availableProductCount: 1,
    }),
    {
      id: 'category-drinks',
      code: 'CAT-BEV',
      nameAr: 'مشروبات وعصائر',
      imageUrl: '',
      productCount: 2,
      availableProductCount: 1,
    }
  );
});

test('older catalog responses still derive honest category counters', () => {
  const categories = deriveCatalogCategories([
    wholesaleProduct,
    {
      ...wholesaleProduct,
      id: 'product-cola',
      isAvailable: false,
      availableSalePackages: 0,
    },
  ]);

  assert.equal(categories.length, 1);
  assert.equal(categories[0].productCount, 2);
  assert.equal(categories[0].availableProductCount, 1);
});

test('catalog maps the canonical wholesale package fields', () => {
  assert.equal(wholesaleProduct.saleUnitNameAr, 'صندوق');
  assert.equal(wholesaleProduct.unitsPerSalePackage, 6);
  assert.equal(wholesaleProduct.salePackagePriceInMinorUnits, 4000);
  assert.equal(wholesaleProduct.availableSalePackages, 8);
  assert.equal(wholesaleProduct.isAvailable, true);
});

test('cart prices complete wholesale packages in integer minor units', () => {
  const item = { ...createCartItem(wholesaleProduct), quantity: 3 };
  assert.equal(calculateCartPackages([item]), 3);
  assert.equal(calculateCartSubtotal([item]), 12000);
  assert.equal(formatJod(12000), '١٢٫٠٠٠ د.أ');
});

test('cart is reconciled with live price and available package changes', () => {
  const staleItem = {
    ...createCartItem(wholesaleProduct),
    unitPriceInMinorUnits: 3500,
    maxAvailablePackages: 12,
    quantity: 10,
  };
  const refreshedProduct = {
    ...wholesaleProduct,
    salePackagePriceInMinorUnits: 4200,
    availableSalePackages: 4,
  };

  const [reconciledItem] = reconcileCart([staleItem], [refreshedProduct]);
  assert.equal(reconciledItem.unitPriceInMinorUnits, 4200);
  assert.equal(reconciledItem.maxAvailablePackages, 4);
  assert.equal(reconciledItem.quantity, 4);
});

test('unavailable or removed products cannot remain in the cart', () => {
  const item = createCartItem(wholesaleProduct);
  assert.deepEqual(reconcileCart([item], []), []);
  assert.deepEqual(
    reconcileCart([item], [
      { ...wholesaleProduct, isAvailable: false, availableSalePackages: 0 },
    ]),
    []
  );
});
