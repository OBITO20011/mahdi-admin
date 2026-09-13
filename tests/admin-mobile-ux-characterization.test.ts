import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const navigation = readFileSync(
  'src/features/more/adminNavigation.config.ts',
  'utf8',
);
const productsView = readFileSync(
  'src/features/products/ProductsView.tsx',
  'utf8',
);
const productForm = readFileSync(
  'src/features/products/ProductFormModal.tsx',
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
const ordersService = readFileSync(
  'src/services/supabase/orders.service.ts',
  'utf8',
);
const operationalOrderListSelect =
  ordersService.match(
    /const OPERATIONAL_ORDER_LIST_SELECT = `([\s\S]*?)`;/,
  )?.[1] ?? '';

test('product terminology remains tied to the products destination and SKU identity', () => {
  assert.match(navigation, /id: 'catalog-products'[\s\S]*destination: 'products'/);
  assert.match(productsView, /product\.sku/);
  assert.match(productsView, /product\.barcode/);
  assert.match(productForm, /اسم المنتج/);
  assert.match(productForm, /رمز الصنف SKU/);
  assert.match(productsView, /openModal\('view_product', product\)/);
  assert.match(productsView, /openModal\('edit_product', product\)/);
  assert.match(productsView, /openModal\('receive_goods', \{ productId: flavorId \}\)/);
  assert.match(productsView, /flavors\.map/);
});

test('product catalog cards retain details, edit, flavor, and receiving entry points', () => {
  assert.match(productsView, /onView=\{\(\) => openModal\('view_product', product\)\}/);
  assert.match(productsView, /onEdit=\{\(\) => openModal\('edit_product', product\)\}/);
  assert.match(productsView, /openModal\('receive_goods', \{ productId: flavorId \}\)/);
  assert.match(productsView, /setAreFlavorsExpanded/);
  assert.match(productsView, /formatProductInventory\(product, true\)/);
  assert.match(productsView, /calculateProductProfit/);
});

test('inventory card keeps every existing capability and canonical formatter', () => {
  assert.match(inventoryView, /formatProductInventory\(product, true\)/);
  assert.match(inventoryView, /openModal\('receive_goods'\)/);
  assert.match(
    inventoryView,
    /openModal\('stock_count', \{ productId: product\.id \}\)/,
  );
  assert.match(inventoryView, /setHistoryProduct\(product\)/);
  assert.match(inventoryView, /setClearInventoryProduct\(product\)/);
  assert.match(inventoryView, /product\.reservedQuantity/);
  assert.match(inventoryView, /fetchInventoryProductPageFromSupabase/);
  assert.match(inventoryView, /product\.movementCount/);
});

test('order list preserves page navigation, statuses, payment state, and detail loading', () => {
  assert.match(ordersCenter, /const PAGE_SIZE = 25/);
  assert.match(ordersCenter, /getStatusBadge\(order\.status\)/);
  assert.match(ordersCenter, /getPaymentLabel\(order\)/);
  assert.match(ordersCenter, /order\.orderNumber/);
  assert.match(ordersCenter, /order\.itemCount/);
  assert.match(ordersCenter, /order\.totalAmount/);
  assert.match(ordersCenter, /onClick=\{\(\) => onOpen\(order\.id\)\}/);
  assert.match(ordersCenter, /onOpen=\{openOrderDetails\}/);
  assert.match(ordersCenter, /setPage\(\(currentPage\)/);
});

test('historical product names are available from snapshots without live product lookup', () => {
  assert.match(ordersService, /product_name_snapshot/);
  assert.match(operationalOrderListSelect, /order_items \(count\)/);
  assert.doesNotMatch(operationalOrderListSelect, /products \(/);
});
