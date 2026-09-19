import {expect, test, type Page, type Route} from '@playwright/test';

const harnessUrl =
  'http://127.0.0.1:4173/e2e/admin-direct-receiving-recovery-harness.html';
const resolverTimeoutMs = 4_000;

type ResolverAction = 'pending' | 'failure';

interface IsolatedBackend {
  createBodies: Array<Record<string, unknown>>;
  createCallCount: number;
  resolverCallCount: number;
  unexpectedRequests: string[];
  resolvePending: (payload: Record<string, unknown>) => Promise<void>;
  rejectPending: () => Promise<void>;
}

const supplier = {
  id: '92300000-0000-0000-0000-000000009101',
  company_name: 'مورد اختبار الاستعادة',
  contact_person: 'مسؤول تجريبي',
  phone: '',
  whatsapp: '',
  email: '',
  address: '',
  current_balance_in_minor_units: 0,
  tax_number: '',
  notes: '',
  is_active: true,
};
const branch = {
  id: '92300000-0000-0000-0000-000000009102',
  name_ar: 'فرع الاختبار',
  address: '',
  city: '',
  phone: '',
  is_main: true,
  is_active: true,
};
const warehouse = {
  id: '92300000-0000-0000-0000-000000009103',
  code: 'TEST-WH',
  name_ar: 'مستودع الاختبار',
  branch_id: branch.id,
  location: 'بيئة معزولة',
  is_active: true,
};
const baseUnit = {
  id: '92300000-0000-0000-0000-000000009104',
  code: 'PACKET',
  name_ar: 'باكيت',
};
const parcelUnit = {
  id: '92300000-0000-0000-0000-000000009105',
  code: 'PARCEL',
  name_ar: 'طرد',
};
const product = {
  id: '92300000-0000-0000-0000-000000009001',
  sku: 'RECOVERY-TEST-SKU',
  barcode: '',
  name_ar: 'منتج اختبار الاستعادة',
  category_id: '92300000-0000-0000-0000-000000009106',
  unit_id: baseUnit.id,
  purchase_unit_id: parcelUnit.id,
  sale_unit_id: baseUnit.id,
  base_unit: baseUnit,
  purchase_unit: parcelUnit,
  sale_unit: baseUnit,
  units_per_purchase_unit: 5,
  units_per_sale_unit: 1,
  default_purchase_price_in_minor_units: 1_000,
  cost_price_in_minor_units: 200,
  sale_price_in_minor_units: 300,
  wholesale_price_in_minor_units: 300,
  min_stock_level: 0,
  is_active: true,
  is_flavor_master: false,
  on_hand_quantity: 0,
  reserved_quantity: 0,
  available_quantity: 0,
  warehouse_balances: [],
};

const fulfillJson = (route: Route, body: unknown, status = 200) =>
  route.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});

const installIsolatedBackend = async (
  page: Page,
  resolverAction: ResolverAction = 'pending',
): Promise<IsolatedBackend> => {
  const createBodies: Array<Record<string, unknown>> = [];
  const unexpectedRequests: string[] = [];
  let createCallCount = 0;
  let resolverCallCount = 0;
  let pendingResolverRoute: Route | null = null;

  await page.route('https://**.supabase.co/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === '/rest/v1/suppliers') return fulfillJson(route, [supplier]);
    if (path === '/rest/v1/units') return fulfillJson(route, [baseUnit, parcelUnit]);
    if (path === '/rest/v1/warehouses') return fulfillJson(route, [warehouse]);
    if (path === '/rest/v1/branches') return fulfillJson(route, [branch]);
    if (path === '/rest/v1/rpc/search_admin_products') return fulfillJson(route, [product]);

    if (path === '/rest/v1/rpc/create_direct_supplier_receipt') {
      createCallCount += 1;
      createBodies.push((request.postDataJSON() || {}) as Record<string, unknown>);
      return fulfillJson(route, {
        code: 'P0001',
        message: 'LEGACY_IDEMPOTENCY_IDENTITY_UNPROVEN: historical review required',
        details: null,
        hint: null,
      }, 400);
    }

    if (path === '/rest/v1/rpc/resolve_legacy_supplier_receipt_replay_v1') {
      resolverCallCount += 1;
      if (resolverAction === 'failure') {
        return fulfillJson(route, {
          code: 'NETWORK_TEST',
          message: 'RAW-SENSITIVE-RESOLVER-ERROR',
          details: null,
          hint: null,
        }, 503);
      }
      pendingResolverRoute = route;
      return;
    }

    unexpectedRequests.push(`${request.method()} ${request.url()}`);
    await route.abort('blockedbyclient');
  });

  return {
    createBodies,
    unexpectedRequests,
    get createCallCount() { return createCallCount; },
    get resolverCallCount() { return resolverCallCount; },
    resolvePending: async (payload) => {
      if (!pendingResolverRoute) throw new Error('No pending resolver request is available.');
      const route = pendingResolverRoute;
      pendingResolverRoute = null;
      await fulfillJson(route, payload);
    },
    rejectPending: async () => {
      if (!pendingResolverRoute) throw new Error('No pending resolver request is available.');
      const route = pendingResolverRoute;
      pendingResolverRoute = null;
      await route.abort('failed');
    },
  };
};

const openReadyModal = async (page: Page) => {
  await page.goto(harnessUrl);
  await expect(page.getByText('جاري تحميل بيانات الموردين والمستودعات...')).toHaveCount(0);
  await expect(page.getByText('منتج اختبار الاستعادة', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'حفظ واستلام البضاعة'})).toBeEnabled();
};

const submitAndWaitForResolver = async (page: Page, backend: IsolatedBackend) => {
  await page.getByRole('button', {name: 'حفظ واستلام البضاعة'}).click();
  await expect(page.getByText('جاري حفظ سند الاستلام وتحديث المخزون...')).toBeVisible();
  await expect.poll(() => backend.resolverCallCount).toBe(1);
  expect(backend.createCallCount).toBe(1);
  expect(String(backend.createBodies[0]?.p_idempotency_key)).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
  );
};

const expectBlockedReviewState = async (page: Page) => {
  await expect(page.getByText('جاري حفظ سند الاستلام وتحديث المخزون...')).toHaveCount(0);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', {name: 'راجع السند الموجود أولًا'})).toBeDisabled();
};

test.beforeEach(async ({page, browserName}) => {
  test.skip(browserName !== 'chromium', 'This internal lifecycle harness runs once in Chromium.');
  await page.clock.install({time: new Date('2026-09-19T08:00:00+03:00')});
});

test('resolver success renders minimal historical details and keeps Submit blocked', async ({page}) => {
  const backend = await installIsolatedBackend(page);
  await openReadyModal(page);
  await submitAndWaitForResolver(page, backend);

  await backend.resolvePending({
    found: true,
    receipt_id: '92300000-0000-0000-0000-000000009201',
    receipt_number: 'REC-HIST-001',
    received_at: '2026-09-18T10:00:00Z',
    total_in_minor_units: 1_000,
    status: 'completed',
  });

  await expectBlockedReviewState(page);
  await expect(page.getByRole('alert')).toContainText('REC-HIST-001');
  await expect(page.getByRole('alert')).toContainText('1.000');
  expect(backend.createCallCount).toBe(1);
  expect(backend.resolverCallCount).toBe(1);
  expect(backend.createBodies).toHaveLength(1);
  expect(backend.unexpectedRequests).toEqual([]);
});

test('resolver transport failure shows a sanitized fallback and terminates loading', async ({page}) => {
  const backend = await installIsolatedBackend(page, 'failure');
  await openReadyModal(page);
  await page.getByRole('button', {name: 'حفظ واستلام البضاعة'}).click();

  await expectBlockedReviewState(page);
  await expect(page.getByRole('alert')).toContainText('راجع سندات الاستلام');
  await expect(page.getByText('RAW-SENSITIVE-RESOLVER-ERROR')).toHaveCount(0);
  expect(backend.createCallCount).toBe(1);
  expect(backend.resolverCallCount).toBe(1);
  expect(backend.createBodies).toHaveLength(1);
  expect(backend.unexpectedRequests).toEqual([]);
});

test('timeout remains authoritative after a late resolver success', async ({page}) => {
  const backend = await installIsolatedBackend(page);
  await openReadyModal(page);
  await submitAndWaitForResolver(page, backend);

  await page.clock.runFor(resolverTimeoutMs);
  await expectBlockedReviewState(page);
  await expect(page.getByRole('alert')).toContainText('راجع سندات الاستلام');

  await backend.resolvePending({
    found: true,
    receipt_id: '92300000-0000-0000-0000-000000009202',
    receipt_number: 'REC-LATE-RESULT',
    received_at: '2026-09-18T10:00:00Z',
    total_in_minor_units: 1_000,
    status: 'completed',
  });
  await page.clock.runFor(0);

  await expect(page.getByText('REC-LATE-RESULT')).toHaveCount(0);
  await expectBlockedReviewState(page);
  expect(backend.createCallCount).toBe(1);
  expect(backend.resolverCallCount).toBe(1);
  expect(backend.createBodies).toHaveLength(1);
  expect(backend.unexpectedRequests).toEqual([]);
});

test('unmount ignores the pending resolver completion without background writes', async ({page}) => {
  const backend = await installIsolatedBackend(page);
  const pageErrors: string[] = [];
  const lifecycleConsoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /unmount|state update|unhandled/iu.test(message.text())) {
      lifecycleConsoleErrors.push(message.text());
    }
  });
  await openReadyModal(page);
  await submitAndWaitForResolver(page, backend);

  await page.evaluate(() => window.__DIRECT_RECEIVING_RECOVERY_UNMOUNT__());
  await expect(page.locator('#root')).toBeEmpty();
  await backend.resolvePending({
    found: true,
    receipt_id: '92300000-0000-0000-0000-000000009203',
    receipt_number: 'REC-AFTER-UNMOUNT',
    received_at: '2026-09-18T10:00:00Z',
    total_in_minor_units: 1_000,
    status: 'completed',
  });
  await page.clock.runFor(0);

  expect(pageErrors).toEqual([]);
  expect(lifecycleConsoleErrors).toEqual([]);
  expect(backend.createCallCount).toBe(1);
  expect(backend.resolverCallCount).toBe(1);
  expect(backend.createBodies).toHaveLength(1);
  expect(backend.unexpectedRequests).toEqual([]);
});
