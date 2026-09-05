import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  readPersistedAppPreferences,
  serializeAppPreferences,
} from '../src/stores/appStorePreferences';
import { StockNotificationsStoreSlice } from '../src/stores/stockNotifications.storeSlice';
import type { NotificationItem, Order, Product } from '../src/types';
import type { ModalNameCallableWithoutPayload } from '../src/stores/modalTypes';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const storage = new MemoryStorage();
storage.setItem(
  'nawasrah_bm_state_v1',
  JSON.stringify({
    activeTab: 'products',
    currentUser: { themeMode: 'light' },
    products: [{ id: 'legacy-product-that-must-not-be-restored' }],
  }),
);
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: storage,
});

const { storeEngine } = await import('../src/stores/useAppStore');

const allModalsSource = readFileSync(
  'src/components/modals/AllModals.tsx',
  'utf8',
);
const quickActionsSource = readFileSync(
  'src/components/layout/QuickActionButton.tsx',
  'utf8',
);
const dashboardSource = readFileSync(
  'src/features/dashboard/DashboardView.tsx',
  'utf8',
);
const inventorySource = readFileSync(
  'src/features/inventory/InventoryView.tsx',
  'utf8',
);
const productDetailSource = readFileSync(
  'src/features/products/ProductDetailModal.tsx',
  'utf8',
);
const productsSource = readFileSync(
  'src/features/products/ProductsView.tsx',
  'utf8',
);

test('preference parsing keeps legacy compatibility and rejects unknown fields', () => {
  assert.deepEqual(
    readPersistedAppPreferences(
      JSON.stringify({
        activeTab: 'orders',
        currentUser: { themeMode: 'dark' },
        products: [{ id: 'must-not-be-restored' }],
      }),
    ),
    { activeTab: 'orders', themeMode: 'dark' },
  );
  assert.deepEqual(
    readPersistedAppPreferences(
      JSON.stringify({ activeTab: 'unknown', themeMode: 'system' }),
    ),
    {},
  );
  assert.equal(
    serializeAppPreferences('accounts', 'light'),
    JSON.stringify({ version: 1, activeTab: 'accounts', themeMode: 'light' }),
  );
});

test('notification refresh remains coalesced and clears safely when Supabase is unavailable', async () => {
  let notifications: NotificationItem[] = [
    {
      id: 'stock-characterization',
      title: 'مخزون منخفض',
      message: 'تنبيه اختباري',
      type: 'stock',
      read: false,
      createdAt: '2026-09-02T00:00:00.000Z',
    },
  ];
  let notifyCount = 0;
  const slice = new StockNotificationsStoreSlice({
    isConfigured: () => false,
    getNotifications: () => notifications,
    replaceNotifications: (nextNotifications) => {
      notifications = nextNotifications;
    },
    notify: () => {
      notifyCount += 1;
    },
    setToast: () => undefined,
  });

  const firstRefresh = slice.refresh();
  const secondRefresh = slice.refresh();
  assert.equal(firstRefresh, secondRefresh);
  assert.deepEqual(await firstRefresh, []);
  assert.deepEqual(notifications, []);
  assert.equal(notifyCount, 1);
});

test('legacy persisted state restores only compact UI preferences', () => {
  const state = storeEngine.getState();
  assert.equal(state.activeTab, 'products');
  assert.equal(state.currentUser.themeMode, 'light');
  assert.deepEqual(state.products, []);
  assert.deepEqual(
    JSON.parse(storage.getItem('nawasrah_bm_state_v1') || '{}'),
    { version: 1, activeTab: 'products', themeMode: 'light' },
  );
});

test('navigation, modal and quick-action behavior remains stable', () => {
  storeEngine.openModal('add_product');
  assert.equal(storeEngine.getState().currentModal, 'add_product');
  assert.equal(storeEngine.getState().modalData, null);

  storeEngine.toggleQuickAction(true);
  assert.equal(storeEngine.getState().isQuickActionOpen, true);

  storeEngine.openCustomerProfile('customer-characterization');
  assert.equal(storeEngine.getState().activeTab, 'accounts');
  assert.equal(
    storeEngine.getState().customerNavigationTarget,
    'customer-characterization',
  );
  assert.equal(storeEngine.getState().currentModal, null);
});

test('payload-bearing modal identities preserve the exact payload object', () => {
  const product: Product = {
    id: 'product-characterization',
    sku: 'SKU-CHAR',
    barcode: 'BAR-CHAR',
    nameAr: 'منتج اختباري',
    imageUrl: '',
    categoryId: 'category-characterization',
    costPrice: 1,
    retailPrice: 1,
    wholesalePrice: 1,
    taxRate: 0,
    unit: 'قطعة',
    onHandQuantity: 10,
    reservedQuantity: 0,
    availableQuantity: 10,
    reorderLevel: 1,
    status: 'active',
    createdAt: '2026-09-05T00:00:00.000Z',
    updatedAt: '2026-09-05T00:00:00.000Z',
  };
  const order: Order = {
    id: 'order-characterization',
    orderNumber: 'ORD-CHAR',
    customerName: 'عميل اختباري',
    customerPhone: '0790000000',
    governorate: 'إربد',
    region: 'الرمثا',
    address: 'عنوان اختباري',
    items: [],
    subtotal: 1,
    discount: 0,
    deliveryFee: 0,
    totalAmount: 1,
    paymentMethod: 'cash',
    paymentStatus: 'unpaid',
    status: 'new',
    branchId: 'branch-characterization',
    isNew: true,
    createdAt: '2026-09-05T00:00:00.000Z',
    updatedAt: '2026-09-05T00:00:00.000Z',
    statusHistory: [],
  };
  const assertPayloadPreserved = (
    modalName: string,
    payload: object,
    open: () => void,
  ) => {
    open();
    assert.equal(storeEngine.getState().currentModal, modalName);
    assert.strictEqual(
      storeEngine.getState().modalData,
      payload,
      `${modalName} must retain the caller's payload without cloning or reshaping`,
    );

    storeEngine.closeModal();
    assert.equal(storeEngine.getState().currentModal, null);
    assert.equal(storeEngine.getState().modalData, null);
  };

  assertPayloadPreserved('edit_product', product, () =>
    storeEngine.openModal('edit_product', product),
  );
  assertPayloadPreserved('view_product', product, () =>
    storeEngine.openModal('view_product', product),
  );
  assertPayloadPreserved('view_order', order, () =>
    storeEngine.openModal('view_order', order),
  );
  const stockCountPayload = { productId: product.id };
  assertPayloadPreserved('stock_count', stockCountPayload, () =>
    storeEngine.openModal('stock_count', stockCountPayload),
  );
  const warehouseTransferPayload = { productId: product.id };
  assertPayloadPreserved(
    'warehouse_transfer',
    warehouseTransferPayload,
    () => storeEngine.openModal('warehouse_transfer', warehouseTransferPayload),
  );
  const adjustmentPayload = { product, mode: 'deduct' } as const;
  assertPayloadPreserved('adjust_stock', adjustmentPayload, () =>
    storeEngine.openModal('adjust_stock', adjustmentPayload),
  );
  const receiveGoodsPayload = { productId: product.id };
  assertPayloadPreserved('receive_goods', receiveGoodsPayload, () =>
    storeEngine.openModal('receive_goods', receiveGoodsPayload),
  );
});

test('no-payload modals continue to store null modalData', () => {
  const noPayloadModals = [
    'add_product',
    'manage_categories',
    'manage_brands',
    'manage_units',
    'profile',
    'profile_settings',
    'storefront_settings',
    'inventory_opening_setup',
    'promotion_codes',
    'add_expense',
    'record_customer_payment',
    'notifications',
    'add_customer',
  ] as const satisfies readonly ModalNameCallableWithoutPayload[];

  for (const modalName of noPayloadModals) {
    storeEngine.openModal(modalName);
    assert.equal(storeEngine.getState().currentModal, modalName);
    assert.equal(
      storeEngine.getState().modalData,
      null,
      `${modalName} must preserve the existing no-payload contract`,
    );
  }

  storeEngine.closeModal();
});

test('the modal dispatcher preserves each current payload-to-prop mapping', () => {
  assert.match(
    allModalsSource,
    /<ProductFormModal initialProduct=\{productFormInitialProduct\} onClose=\{closeModal\} \/>/,
  );
  assert.match(
    allModalsSource,
    /<ProductDetailModal product=\{modalData\} onClose=\{closeModal\} \/>/,
  );
  assert.match(allModalsSource, /product=\{modalData\.product\}/);
  assert.match(allModalsSource, /mode=\{modalData\.mode \|\| 'add'\}/);
  assert.match(
    allModalsSource,
    /<WarehouseTransferModal productId=\{warehouseTransferProductId\} onClose=\{closeModal\} \/>/,
  );
  assert.match(
    allModalsSource,
    /<StockCountModal productId=\{stockCountProductId\} onClose=\{closeModal\} \/>/,
  );
  assert.match(
    allModalsSource,
    /<OrderDetailModal order=\{modalData\} onClose=\{closeModal\} \/>/,
  );
  assert.match(
    allModalsSource,
    /currentModal === 'receive_goods'[\s\S]*?<CreateDirectReceiptModal onClose=\{closeModal\} \/>/,
  );
});

function characterizeCompileTimeModalFailures() {
  // @ts-expect-error edit_product requires a Product payload.
  storeEngine.openModal('edit_product');
  // @ts-expect-error add_product does not accept a payload.
  storeEngine.openModal('add_product', { productId: 'unexpected' });
  // @ts-expect-error view_product cannot receive a product-id wrapper.
  storeEngine.openModal('view_product', { productId: 'wrong-shape' });
  // @ts-expect-error view_order cannot receive a Product-like payload.
  storeEngine.openModal('view_order', { sku: 'wrong-shape' });
  // @ts-expect-error stock adjustment supports only add or deduct.
  storeEngine.openModal('adjust_stock', { product: {}, mode: 'replace' });
}

void characterizeCompileTimeModalFailures;

test('current UI entry points keep their modal names and payload shapes', () => {
  assert.match(productsSource, /openModal\('view_product', product\)/);
  assert.match(productsSource, /openModal\('edit_product', product\)/);
  assert.match(
    productsSource,
    /openModal\('receive_goods', \{ productId: flavorId \}\)/,
  );
  assert.match(
    productDetailSource,
    /openModal\('receive_goods', \{ productId: flavor\.id \}\)/,
  );
  assert.match(productDetailSource, /openModal\('edit_product', product\)/);
  assert.match(
    inventorySource,
    /openModal\('stock_count', \{ productId: product\.id \}\)/,
  );
  assert.match(
    dashboardSource,
    /openModal\('receive_goods', \{ productId: item\.id \}\)/,
  );
});

test('Quick Actions retain their existing tab and no-payload modal behavior', () => {
  assert.match(
    quickActionsSource,
    /id: 'pos-sale'[\s\S]*?setActiveTab\('pos'\)/,
  );
  assert.match(
    quickActionsSource,
    /id: 'goods-receipt'[\s\S]*?openModal\('receive_goods'\)/,
  );
  assert.match(
    quickActionsSource,
    /id: 'add-expense'[\s\S]*?openModal\('add_expense'\)/,
  );
  assert.match(
    quickActionsSource,
    /id: 'add-product'[\s\S]*?openModal\('add_product'\)/,
  );
});

test('reference-data validation and missing-record responses are preserved', async () => {
  assert.deepEqual(await storeEngine.addCategory({ nameAr: '  ' }), {
    success: false,
    error: 'اسم القسم مطلوب.',
  });
  assert.deepEqual(await storeEngine.addBrand({ nameAr: '' }), {
    success: false,
    error: 'اسم العلامة التجارية مطلوب.',
  });
  assert.deepEqual(await storeEngine.addUnit({ nameAr: 'صندوق', code: '' }), {
    success: false,
    error: 'اسم الوحدة وكودها مطلوبان.',
  });
  assert.deepEqual(await storeEngine.updateCategory('missing', {}), {
    success: false,
    error: 'القسم غير موجود.',
  });
  assert.deepEqual(await storeEngine.updateBrand('missing', {}), {
    success: false,
    error: 'العلامة التجارية غير موجودة.',
  });
  assert.deepEqual(await storeEngine.updateUnit('missing', {}), {
    success: false,
    error: 'وحدة القياس غير موجودة.',
  });
});
