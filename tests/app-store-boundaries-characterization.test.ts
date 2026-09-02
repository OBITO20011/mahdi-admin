import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readPersistedAppPreferences,
  serializeAppPreferences,
} from '../src/stores/appStorePreferences';
import { StockNotificationsStoreSlice } from '../src/stores/stockNotifications.storeSlice';
import type { NotificationItem } from '../src/types';

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
  storeEngine.openModal('add_product', { source: 'characterization' });
  assert.equal(storeEngine.getState().currentModal, 'add_product');
  assert.deepEqual(storeEngine.getState().modalData, {
    source: 'characterization',
  });

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
