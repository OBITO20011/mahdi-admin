import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCartSnapshotBatches,
  deriveCatalogCategories,
  groupCatalogFlavorFamilies,
  mapCatalogCategory,
  mapCatalogProduct,
  resolveCatalogTotal,
  STOREFRONT_CATALOG_PAGE_SIZE,
} from '../src/services/catalog.service';
import {
  calculateCartPackages,
  calculateCartSubtotal,
  createCartItem,
  reconcileCart,
  reconcileCartPage,
  reconcileCartSnapshot,
  restoreLastOrderFromSnapshot,
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

test('catalog uses a bounded server-side page rather than a client-side 200 item cap', () => {
  assert.equal(STOREFRONT_CATALOG_PAGE_SIZE, 24);
  assert.equal(resolveCatalogTotal(6, 6), 6);
  assert.equal(resolveCatalogTotal(200, 201), 201);
  assert.equal(resolveCatalogTotal(200, undefined), 200);
});

test('flavor families keep one card, one price, and independent availability', () => {
  const master = {
    ...wholesaleProduct,
    id: 'lays-master',
    nameAr: 'ليز',
    isFlavorMaster: true,
    availableQuantity: 0,
    availableSalePackages: 0,
    isAvailable: false,
  };
  const cheese = {
    ...wholesaleProduct,
    id: 'lays-cheese',
    nameAr: 'ليز - جبنة',
    flavorMasterProductId: master.id,
    flavorNameAr: 'جبنة',
    flavorSortOrder: 10,
    availableQuantity: 0,
    availableSalePackages: 0,
    isAvailable: false,
  };
  const hot = {
    ...wholesaleProduct,
    id: 'lays-hot',
    nameAr: 'ليز - حار',
    flavorMasterProductId: master.id,
    flavorNameAr: 'حار',
    flavorSortOrder: 20,
    availableQuantity: 24,
    availableSalePackages: 4,
    isAvailable: true,
  };

  const [family] = groupCatalogFlavorFamilies([master, cheese, hot]);
  assert.equal(family.id, master.id);
  assert.equal(family.variants.length, 2);
  assert.equal(family.salePackagePriceInMinorUnits, 4000);
  assert.equal(family.availableSalePackages, 4);
  assert.equal(family.isAvailable, true);
  assert.equal(family.variants[0].flavorNameAr, 'جبنة');
  assert.equal(family.variants[0].isAvailable, false);
  assert.equal(family.variants[1].flavorNameAr, 'حار');
  assert.equal(family.variants[1].isAvailable, true);
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

test('a page refresh preserves cart items that are outside the current catalog page', () => {
  const visibleItem = createCartItem(wholesaleProduct);
  const offPageItem = {
    ...visibleItem,
    productId: 'product-201',
    sku: 'NWS-0201',
    nameAr: 'الصنف رقم ٢٠١',
  };

  const reconciled = reconcileCartPage([visibleItem, offPageItem], [
    { ...wholesaleProduct, availableSalePackages: 2 },
  ]);

  assert.equal(reconciled.length, 2);
  assert.equal(reconciled[0].maxAvailablePackages, 2);
  assert.equal(reconciled[1].productId, 'product-201');
});

test('cart snapshots stay bounded to cart product IDs and deduplicate requests', () => {
  const batches = buildCartSnapshotBatches([
    'product-201',
    'product-201',
    ...Array.from({ length: 48 }, (_, index) => `product-${index}`),
  ]);

  assert.equal(batches.length, 2);
  assert.equal(batches[0].length, 48);
  assert.equal(batches[1].length, 1);
  assert.equal(new Set(batches.flat()).size, 49);
});

test('an off-page cart item receives its current server price and stock', () => {
  const staleOffPageItem = {
    ...createCartItem(wholesaleProduct),
    productId: 'product-201',
    unitPriceInMinorUnits: 3000,
    maxAvailablePackages: 8,
    quantity: 6,
  };
  const refreshedOffPageProduct = {
    ...wholesaleProduct,
    id: 'product-201',
    salePackagePriceInMinorUnits: 4250,
    availableSalePackages: 2,
  };

  const result = reconcileCartSnapshot(
    [staleOffPageItem],
    [refreshedOffPageProduct],
    ['product-201']
  );

  assert.equal(result.items[0].unitPriceInMinorUnits, 4250);
  assert.equal(result.items[0].maxAvailablePackages, 2);
  assert.equal(result.items[0].quantity, 2);
  assert.equal(result.priceChanges, 1);
  assert.equal(result.quantityAdjustments, 1);
});

test('a cart snapshot removes an item no longer sellable and preserves unrelated in-flight additions', () => {
  const unavailable = {
    ...wholesaleProduct,
    id: 'product-unavailable',
    isAvailable: false,
    availableSalePackages: 0,
  };
  const laterAddition = {
    ...createCartItem(wholesaleProduct),
    productId: 'added-while-refreshing',
  };

  const result = reconcileCartSnapshot(
    [{ ...createCartItem(unavailable) }, laterAddition],
    [unavailable],
    ['product-unavailable']
  );

  assert.deepEqual(result.items, [laterAddition]);
  assert.equal(result.removedUnavailableItems, 1);
});

test('cart snapshots reconcile flavor variants by their exact sellable IDs', () => {
  const cheese = {
    ...wholesaleProduct,
    id: 'lays-cheese',
    nameAr: 'ليز - جبنة',
    flavorMasterProductId: 'lays-master',
    flavorNameAr: 'جبنة',
    availableSalePackages: 1,
  };
  const hot = {
    ...wholesaleProduct,
    id: 'lays-hot',
    nameAr: 'ليز - حار',
    flavorMasterProductId: 'lays-master',
    flavorNameAr: 'حار',
    salePackagePriceInMinorUnits: 5000,
    availableSalePackages: 5,
  };

  const result = reconcileCartSnapshot(
    [{ ...createCartItem(hot), quantity: 2 }],
    [cheese, hot],
    ['lays-hot']
  );

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].productId, 'lays-hot');
  assert.equal(result.items[0].nameAr, 'ليز - حار');
  assert.equal(result.items[0].unitPriceInMinorUnits, 5000);
});

test('last-order restoration uses the bounded server snapshot for off-page items and current prices', () => {
  const offPageProduct = {
    ...wholesaleProduct,
    id: 'product-201',
    sku: 'NWS-0201',
    salePackagePriceInMinorUnits: 4750,
    availableSalePackages: 7,
  };

  const result = restoreLastOrderFromSnapshot(
    [
      { productId: wholesaleProduct.id, quantity: 2 },
      { productId: offPageProduct.id, quantity: 3 },
    ],
    [wholesaleProduct, offPageProduct]
  );

  assert.equal(result.items.length, 2);
  assert.equal(result.items[1].productId, 'product-201');
  assert.equal(result.items[1].unitPriceInMinorUnits, 4750);
  assert.equal(result.items[1].quantity, 3);
});

test('last-order restoration clamps stock and explicitly reports unavailable products', () => {
  const lowStock = {
    ...wholesaleProduct,
    id: 'product-low-stock',
    availableSalePackages: 2,
  };
  const unavailable = {
    ...wholesaleProduct,
    id: 'product-unavailable',
    isAvailable: false,
    availableSalePackages: 0,
  };

  const result = restoreLastOrderFromSnapshot(
    [
      { productId: lowStock.id, quantity: 6 },
      { productId: unavailable.id, quantity: 1 },
    ],
    [lowStock, unavailable]
  );

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].quantity, 2);
  assert.equal(result.quantityAdjustments, 1);
  assert.equal(result.unavailableItems, 1);
});

test('last-order restoration preserves exact flavor variant identities', () => {
  const cheese = {
    ...wholesaleProduct,
    id: 'lays-cheese',
    nameAr: 'ليز - جبنة',
    flavorMasterProductId: 'lays-master',
    flavorNameAr: 'جبنة',
  };
  const hot = {
    ...wholesaleProduct,
    id: 'lays-hot',
    nameAr: 'ليز - حار',
    flavorMasterProductId: 'lays-master',
    flavorNameAr: 'حار',
    salePackagePriceInMinorUnits: 5000,
  };

  const result = restoreLastOrderFromSnapshot(
    [{ productId: hot.id, quantity: 2 }],
    [cheese, hot]
  );

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].productId, hot.id);
  assert.equal(result.items[0].nameAr, 'ليز - حار');
  assert.equal(result.items[0].unitPriceInMinorUnits, 5000);
});
