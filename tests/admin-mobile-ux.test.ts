import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ADMIN_NAVIGATION_GROUPS } from '../src/features/more/adminNavigation.config';
import { formatOperationalOrderContents } from '../src/utils/orderPresentation';

const productsView = readFileSync(
  'src/features/products/ProductsView.tsx',
  'utf8',
);
const inventoryView = readFileSync(
  'src/features/inventory/InventoryView.tsx',
  'utf8',
);
const ordersCenter = readFileSync(
  'src/features/orders/OrdersCenterView.tsx',
  'utf8',
);

test('catalog navigation and page use one product term without changing destination', () => {
  const catalogItem = ADMIN_NAVIGATION_GROUPS.flatMap(
    (group) => group.items,
  ).find((item) => item.id === 'catalog-products');

  assert.equal(catalogItem?.label, 'المنتجات');
  assert.deepEqual(catalogItem?.action, {
    type: 'tab',
    destination: 'products',
  });
  assert.match(productsView, /دليل المنتجات/);
  assert.doesNotMatch(productsView, /دليل الأصناف/);
  assert.match(
    productsView,
    /grid grid-cols-2 gap-2 md:grid-cols-2 xl:grid-cols-3/,
  );
  assert.match(productsView, /data-product-catalog-card/);
  assert.match(productsView, /min-h-11/);
});

test('inventory cards prioritize available stock and keep compact accessible actions', () => {
  assert.match(inventoryView, /المتاح في المخزون/);
  assert.doesNotMatch(inventoryView, /المتاح للبيع الآن/);
  assert.match(inventoryView, /invAvailable\.cartonFormatted/);
  assert.match(inventoryView, /تفاصيل المنتج والرصيد/);
  assert.match(inventoryView, /grid-cols-2 sm:grid-cols-4/);
  assert.match(inventoryView, /min-h-11/);
  assert.match(inventoryView, /openModal\('receive_goods'\)/);
  assert.match(inventoryView, /openModal\('stock_count'/);
  assert.match(inventoryView, /setHistoryProduct\(product\)/);
  assert.match(inventoryView, /setClearInventoryProduct\(product\)/);
});

test('order content label keeps one product primary and summarizes additional lines', () => {
  assert.equal(formatOperationalOrderContents('عصير فراولة', 1), 'عصير فراولة');
  assert.equal(
    formatOperationalOrderContents('عصير فراولة', 2),
    'عصير فراولة + صنف إضافي',
  );
  assert.equal(
    formatOperationalOrderContents('عصير فراولة', 3),
    'عصير فراولة + صنفان إضافيان',
  );
  assert.match(ordersCenter, /order\.firstProductName/);
  assert.match(ordersCenter, /formatOperationalOrderContents/);
  assert.match(ordersCenter, /order\.orderNumber/);
  assert.match(ordersCenter, /onClick=\{\(\) => onOpen\(order\.id\)\}/);
  assert.match(ordersCenter, /onOpen=\{openOrderDetails\}/);
});
