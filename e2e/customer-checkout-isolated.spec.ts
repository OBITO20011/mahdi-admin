import { expect, test, type Page } from '@playwright/test';

const customerBaseUrl = process.env.M10_CUSTOMER_BASE_URL;
const publicSupabaseUrl = process.env.M10_PUBLIC_SUPABASE_URL;
const isolatedApiUrl = process.env.M10_ISOLATED_API_URL;
const enabled = Boolean(customerBaseUrl && publicSupabaseUrl && isolatedApiUrl);

const productName = 'صنف اختبار M10';
const parcelSizeLabel = (5).toLocaleString('ar-JO');
const cartStorageKey = 'nawasrah-wholesale-cart-v1';
const cartRecoveryBackupStorageKey = 'nawasrah-wholesale-cart-recovery-backup-v1';
const attemptStorageKey = 'nawasrah-checkout-attempt-v1';
const successStorageKey = 'nawasrah-checkout-success-v1';
const reconciliationEvidenceStorageKey = 'nawasrah-checkout-reconciliation-v1';
let isolatedClientSequence = 0;

const turnstileShim = `
window.turnstile = {
  render: function (_container, options) {
    window.__isolatedTurnstileOptions = options;
    queueMicrotask(function () { options.callback('XXXX.DUMMY.TOKEN.XXXX'); });
    return 'isolated-customer-checkout-widget';
  },
  reset: function () {
    var options = window.__isolatedTurnstileOptions;
    if (options) queueMicrotask(function () { options.callback('XXXX.DUMMY.TOKEN.XXXX'); });
  },
  remove: function () {}
};
// External WhatsApp is outside the isolated checkout boundary. Keep the test
// page on the storefront so reload/recovery assertions observe one origin.
window.open = function () { return null; };`;

function recoveryFixtures() {
  const cartItem = {
    schemaVersion: 2,
    localLineId: 'recovery-line',
    localRevision: 2,
    commercialLineKind: 'legacy_single_sku_parcel',
    productId: '8a000000-0000-4000-8a00-000000000001',
    sku: 'M10-CHECKOUT-001',
    nameAr: productName,
    imageUrl: '',
    saleUnitNameAr: 'صندوق',
    unitsPerSalePackage: 1,
    unitPriceInMinorUnits: 1275,
    quantity: 2,
    maxAvailablePackages: 10,
  };
  const submittedItem = { ...cartItem, localRevision: 1, quantity: 2 };
  const newerCartItem = {
    ...cartItem,
    localLineId: 'recovery-line-newer',
    localRevision: 1,
    quantity: 1,
  };
  const receipt = {
    success: true,
    id: '8a000000-0000-4000-8a00-000000009001',
    orderNumber: 'M10-RECOVERY-1',
    customerId: '8a000000-0000-4000-8a00-000000009002',
    customerAddressId: '8a000000-0000-4000-8a00-000000009003',
    customerReused: false,
    idempotentReplay: true,
    subtotalInMinorUnits: 2550,
    discountInMinorUnits: 0,
    totalInMinorUnits: 2550,
    deliveryFeeInMinorUnits: 0,
    deliveryZone: 'inside_ramtha',
    promotionCode: '',
    status: 'new',
    paymentMethod: 'cash_on_delivery',
    message: 'تم استرجاع نتيجة الطلب المحفوظة.',
  };
  const attempt = {
    version: 1,
    attemptId: '8a000000-0000-4000-8a00-000000009004',
    state: 'SUCCESS_PENDING_RECONCILIATION',
    idempotencyKey: '8a000000-0000-4000-8a00-000000009005',
    clientSessionId: '8a000000-0000-4000-8a00-000000009006',
    request: {
      contractVersion: 'phase3-customer-reservation-v2',
      idempotencyKey: '8a000000-0000-4000-8a00-000000009005',
      clientSessionId: '8a000000-0000-4000-8a00-000000009006',
      customer: { fullName: 'عميل استرجاع', phone: '0797003030', governorate: 'إربد', city: 'الرمثا', area: 'حي الاختبار', street: 'شارع الاختبار', building: '', addressNotes: '', googleMapsUrl: '', latitude: null, longitude: null, customerNotes: '' },
      items: [{ commercial_line_kind: 'legacy_single_sku_parcel', product_id: cartItem.productId, parcel_quantity: 2, units_per_parcel: 1, expected_unit_price_in_minor_units: 1275 }],
      paymentMethod: 'cash_on_delivery',
      deliveryZone: 'inside_ramtha',
      expectedQuote: { subtotalInMinorUnits: 2550, discountInMinorUnits: 0, deliveryFeeInMinorUnits: 0, totalInMinorUnits: 2550 },
    },
    submittedItems: [submittedItem],
    receipt,
    createdAt: 1,
    updatedAt: 1,
  };
  return { cartItem: submittedItem, newerCartItem, attempt };
}

async function useIsolatedBackend(
  page: Page,
  afterCommittedGatewayResponse?: () => Promise<'DROP_RESPONSE' | void>
) {
  if (!publicSupabaseUrl || !isolatedApiUrl) throw new Error('M10 isolation is not configured.');
  isolatedClientSequence += 1;
  const isolatedClientIp = `198.51.100.${isolatedClientSequence}`;

  await page.route(`${publicSupabaseUrl}/**`, async (route) => {
    const browserRequest = route.request();
    const requested = new URL(browserRequest.url());
    const target = new URL(requested.pathname + requested.search, isolatedApiUrl);
    const headers = {
      ...browserRequest.headers(),
      origin: 'http://127.0.0.1:4174',
      'x-forwarded-for': isolatedClientIp,
    };
    const method = browserRequest.method();
    const response = await fetch(target, {
      method,
      headers,
      body: ['GET', 'HEAD'].includes(method) ? undefined : (browserRequest.postDataBuffer() ?? undefined),
    });
    const responseStatus = response.status;
    const responseHeaders = Object.fromEntries(response.headers.entries());
    // Node fetch decodes compressed responses before exposing the body.
    delete responseHeaders['content-encoding'];
    delete responseHeaders['content-length'];
    const responseBody = Buffer.from(await response.arrayBuffer());
    const isGatewaySubmission = requested.pathname.endsWith('/functions/v1/submit-guest-order');
    if (
      afterCommittedGatewayResponse &&
      isGatewaySubmission &&
      responseStatus === 200
    ) {
      const disposition = await afterCommittedGatewayResponse();
      if (disposition === 'DROP_RESPONSE') {
        await route.abort('failed');
        return;
      }
    }
    // The proxy response is detached from the browser context. WebKit can
    // dispose Playwright APIResponse objects while a route is still being
    // fulfilled during teardown, so the harness uses Node fetch instead.
    await route.fulfill({
      status: responseStatus,
      headers: responseHeaders,
      body: responseBody,
    });
  });
}

test.describe('M10 isolated browser checkout', () => {
  test.skip(!enabled, 'Run through scripts/testing/run-customer-checkout-browser-e2e.mjs only.');

  test.beforeEach(async ({ context }) => {
    // Keep the browser side deterministic and offline-safe while the real
    // isolated Gateway still validates Cloudflare's official dummy token.
    await context.addInitScript({ content: turnstileShim });
  });

  test('browser → cart snapshot → Turnstile → gateway → receipt → token tracking', async ({ page }) => {
    await useIsolatedBackend(page);
    await page.goto(`${customerBaseUrl}/#catalog`, { waitUntil: 'domcontentloaded' });

    await page.getByRole('button', { name: `إضافة ${productName} إلى السلة` }).click();
    await page.getByRole('button', { name: 'فتح السلة' }).click();
    await page.getByRole('button', { name: 'إتمام الطلب بدون تسجيل دخول' }).click();

    const checkout = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'إتمام طلب الجملة' }),
    });
    await checkout.getByLabel('الاسم الكامل*').fill('عميل M10');
    await checkout.getByLabel('رقم الهاتف*').fill('0797001010');
    await checkout.getByLabel('المحافظة*').selectOption({ label: 'إربد' });
    await checkout.getByLabel('المدينة*').fill('الرمثا');
    await checkout.getByLabel('المنطقة أو الحي*').fill('حي الاختبار');
    await checkout.getByLabel('تفاصيل العنوان والتوصيل*').fill('شارع الاختبار، بجانب المتجر');

    await checkout.getByRole('button', { name: 'مراجعة الطلب قبل الإرسال' }).click();
    const review = page.getByRole('dialog', { name: 'راجع طلبك قبل الإرسال' });
    await expect(review.getByText('تم التحقق الأمني وجاهز للإرسال.')).toBeVisible({ timeout: 30_000 });
    const submit = review.getByRole('button', { name: 'تأكيد وحفظ الطلب في الإدارة' });
    await expect(submit).toBeEnabled();
    await submit.click();

    const receipt = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'تم تسجيل طلبك' }),
    });
    await expect(receipt).toBeVisible({ timeout: 30_000 });
    await expect(receipt.getByText('تم ربط الطلب بملف العميل الموجود حسب رقم الهاتف.').or(
      receipt.getByText('تم إنشاء ملف عميل جديد وربطه بهذا الطلب تلقائيًا.')
    )).toBeVisible();

    const trackingResponse = page.waitForResponse((response) =>
      response.url().includes('/rest/v1/rpc/track_guest_order_by_token') &&
      response.status() === 200
    );
    await receipt.getByRole('button', { name: 'متابعة الطلب' }).click();
    await trackingResponse;
    const tracking = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'أين وصل طلبك؟' }),
    });
    await expect(tracking).toBeVisible({ timeout: 30_000 });
    await expect(tracking.locator('strong').filter({ hasText: 'وصلنا الطلب' })).toBeVisible();
  });

  test('customer builds an independent mixed parcel and submits it through V2', async ({ page }) => {
    await useIsolatedBackend(page);
    await page.goto(`${customerBaseUrl}/#catalog`, { waitUntil: 'domcontentloaded' });

    await page.getByRole('button', { name: 'اختيار نكهة مجموعة نكهات غير قابلة للبيع' }).click();
    const buildParcel = page.getByRole('button', { name: 'كوّن طردًا بالنكهات' });
    await expect(buildParcel).toBeEnabled();
    await buildParcel.click();

    const builder = page.getByRole('dialog', { name: new RegExp(`اختر ${parcelSizeLabel}`) });
    for (let index = 0; index < 3; index += 1) {
      await builder.getByRole('button', { name: 'زيادة نكهة أ' }).click();
    }
    for (let index = 0; index < 2; index += 1) {
      await builder.getByRole('button', { name: 'زيادة نكهة ب' }).click();
    }
    await expect(builder.getByText(`تم اختيار ${parcelSizeLabel} من ${parcelSizeLabel}`)).toBeVisible();
    await builder.getByRole('button', { name: 'إضافة الطرد للسلة' }).click();
    const productDetails = page.getByRole('dialog').filter({
      has: page.getByRole('button', { name: 'كوّن طردًا بالنكهات' }),
    });
    await page.keyboard.press('Escape');
    await expect(productDetails).toBeHidden();

    await page.getByRole('button', { name: 'فتح السلة' }).click();
    const cart = page.getByRole('dialog', { name: 'سلة طلب الجملة' });
    await expect(cart.getByText('نكهة أ × 3، نكهة ب × 2')).toBeVisible();
    await cart.getByRole('button', { name: 'إتمام الطلب بدون تسجيل دخول' }).click();

    const checkout = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'إتمام طلب الجملة' }),
    });
    await checkout.getByLabel('الاسم الكامل*').fill('عميل طرد M10');
    await checkout.getByLabel('رقم الهاتف*').fill('0797002020');
    await checkout.getByLabel('المحافظة*').selectOption({ label: 'إربد' });
    await checkout.getByLabel('المدينة*').fill('الرمثا');
    await checkout.getByLabel('المنطقة أو الحي*').fill('حي الاختبار');
    await checkout.getByLabel('تفاصيل العنوان والتوصيل*').fill('شارع الاختبار، بجانب المتجر');
    await checkout.getByRole('button', { name: 'مراجعة الطلب قبل الإرسال' }).click();

    const review = page.getByRole('dialog', { name: 'راجع طلبك قبل الإرسال' });
    await expect(review.getByText('تم التحقق الأمني وجاهز للإرسال.')).toBeVisible({ timeout: 30_000 });
    await review.getByRole('button', { name: 'تأكيد وحفظ الطلب في الإدارة' }).click();
    await expect(page.getByRole('heading', { name: 'تم تسجيل طلبك' })).toBeVisible({ timeout: 30_000 });
  });

  test('invalid persisted cart survives real reloads until explicit customer recovery', async ({ page }) => {
    if (!publicSupabaseUrl) throw new Error('M10 public test URL is not configured.');
    await page.route(`${publicSupabaseUrl}/**`, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'isolated cart-recovery browser test' }),
      })
    );
    const validItem = recoveryFixtures().cartItem;
    const invalidParcel = {
      ...validItem,
      schemaVersion: 2,
      localLineId: 'invalid-parcel-line',
      commercialLineKind: 'configurable_parcel',
      productId: '8a000000-0000-4000-8a00-000000000010',
      familyProductId: '8a000000-0000-4000-8a00-000000000010',
      parcelConfigurationId: '8a000000-0000-4000-8a00-000000000011',
      configurationRevision: 1,
      compositionMode: 'configurable_mix',
      capacity: 5,
      quantity: 1,
      parcelInstances: [{
        localInstanceId: 'invalid-instance',
        localRevision: 1,
        components: [{
          productId: validItem.productId,
          sku: validItem.sku,
          nameAr: validItem.nameAr,
          flavorNameAr: 'اختبار',
          unitNameAr: 'باكيت',
          imageUrl: '',
          baseQuantity: 4,
        }],
      }],
    };
    const originalRaw = JSON.stringify({
      version: 2,
      items: [validItem, invalidParcel],
      reconciledAttemptIds: [],
    });
    await page.addInitScript(({ key, raw }) => {
      if (sessionStorage.getItem('m10-cart-recovery-seeded') === '1') return;
      sessionStorage.setItem('m10-cart-recovery-seeded', '1');
      localStorage.setItem(key, raw);
    }, { key: cartStorageKey, raw: originalRaw });

    await page.goto(`${customerBaseUrl}/#catalog`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'فتح السلة' }).click();
    const cart = page.getByRole('dialog', { name: 'سلة طلب الجملة' });
    await expect(cart.getByText('السلة المحفوظة تحتاج مراجعة')).toBeVisible();
    await expect(cart.getByRole('button', { name: 'إتمام الطلب غير متاح مؤقتًا' })).toBeDisabled();
    expect(await page.evaluate((key) => localStorage.getItem(key), cartStorageKey)).toBe(originalRaw);

    for (let reload = 0; reload < 2; reload += 1) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      expect(await page.evaluate((key) => localStorage.getItem(key), cartStorageKey)).toBe(originalRaw);
    }

    await page.getByRole('button', { name: 'فتح السلة' }).click();
    await page.getByRole('button', {
      name: 'أوافق على الاحتفاظ بالعناصر السليمة',
    }).click();
    await expect(cart.getByText('السلة المحفوظة تحتاج مراجعة')).toBeHidden();
    const recovered = await page.evaluate(({ cartKey, backupKey }) => ({
      cart: JSON.parse(localStorage.getItem(cartKey) || 'null'),
      backup: localStorage.getItem(backupKey),
    }), { cartKey: cartStorageKey, backupKey: cartRecoveryBackupStorageKey });
    expect(recovered.backup).toBe(originalRaw);
    expect(recovered.cart.items).toHaveLength(1);
    expect(recovered.cart.items[0].localLineId).toBe(validItem.localLineId);

    await page.reload({ waitUntil: 'domcontentloaded' });
    const afterReload = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), cartStorageKey);
    expect(afterReload.items).toHaveLength(1);
    expect(afterReload.items[0].localLineId).toBe(validItem.localLineId);
  });

  test('two real tabs and reload reconcile one successful attempt exactly once', async ({ page, context }) => {
    await useIsolatedBackend(page);
    const fixtures = recoveryFixtures();
    let gatewaySubmissions = 0;
    page.on('request', (request) => {
      if (request.url().includes('/functions/v1/submit-guest-order')) gatewaySubmissions += 1;
    });
    await page.addInitScript(({ cartKey, attemptKey, cartItem, newerCartItem, attempt }) => {
      localStorage.setItem(cartKey, JSON.stringify({ version: 2, items: [cartItem, newerCartItem], reconciledAttemptIds: [] }));
      localStorage.setItem(attemptKey, JSON.stringify(attempt));
    }, { cartKey: cartStorageKey, attemptKey: attemptStorageKey, ...fixtures });
    await page.goto(`${customerBaseUrl}/#catalog`, { waitUntil: 'domcontentloaded' });

    const otherTab = await context.newPage();
    await useIsolatedBackend(otherTab);
    otherTab.on('request', (request) => {
      if (request.url().includes('/functions/v1/submit-guest-order')) gatewaySubmissions += 1;
    });
    await otherTab.goto(`${customerBaseUrl}/#catalog`, { waitUntil: 'domcontentloaded' });

    await Promise.all([
      page.getByRole('button', { name: 'فتح السلة' }).click(),
      otherTab.getByRole('button', { name: 'فتح السلة' }).click(),
    ]);
    await Promise.all([
      page.getByRole('button', { name: 'إتمام الطلب بدون تسجيل دخول' }).click(),
      otherTab.getByRole('button', { name: 'إتمام الطلب بدون تسجيل دخول' }).click(),
    ]);
    await Promise.all([
      expect(page.getByRole('heading', { name: 'تم تسجيل طلبك' })).toBeVisible(),
      expect(otherTab.getByRole('heading', { name: 'تم تسجيل طلبك' })).toBeVisible(),
    ]);

    await expect.poll(async () => page.evaluate((key) => {
      const state = JSON.parse(localStorage.getItem(key) || 'null');
      return {
        quantity: state?.items?.[0]?.quantity ?? null,
        reconciledAttemptIds: state?.reconciliations?.map(
          (entry: { attemptId: string }) => entry.attemptId
        ) ?? [],
      };
    }, cartStorageKey)).toEqual({
      quantity: 1,
      reconciledAttemptIds: [fixtures.attempt.attemptId],
    });
    const firstState = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), cartStorageKey);
    expect(firstState.items).toHaveLength(1);
    expect(firstState.items[0].localLineId).toBe(fixtures.newerCartItem.localLineId);
    expect(firstState.items[0].quantity).toBe(1);
    expect(firstState.reconciliations.map((entry: { attemptId: string }) => entry.attemptId)).toEqual([fixtures.attempt.attemptId]);
    expect(gatewaySubmissions).toBe(0);

    await otherTab.reload({ waitUntil: 'domcontentloaded' });
    await expect(otherTab.getByRole('button', { name: 'فتح السلة' })).toBeVisible();
    const afterReload = await otherTab.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), cartStorageKey);
    expect(afterReload.items).toHaveLength(1);
    expect(afterReload.items[0].localLineId).toBe(fixtures.newerCartItem.localLineId);
    expect(afterReload.items[0].quantity).toBe(1);
    expect(afterReload.reconciliations.map((entry: { attemptId: string }) => entry.attemptId)).toEqual([fixtures.attempt.attemptId]);
    expect(gatewaySubmissions).toBe(0);
  });

  test('real committed success preserves a corrupt cart until explicit recovery', async ({ page }) => {
    const corruptRaw = '{corrupt-after-real-commit';
    let gatewaySubmissions = 0;
    let committedResponseObserved = false;
    page.on('request', (request) => {
      if (request.url().includes('/functions/v1/submit-guest-order')) {
        gatewaySubmissions += 1;
      }
    });
    await useIsolatedBackend(page, async () => {
      if (committedResponseObserved) return;
      committedResponseObserved = true;
      await page.evaluate(({ key, raw }) => {
        localStorage.setItem(key, raw);
      }, { key: cartStorageKey, raw: corruptRaw });
    });
    await page.goto(`${customerBaseUrl}/#catalog`, { waitUntil: 'domcontentloaded' });

    await page.getByRole('button', { name: `إضافة ${productName} إلى السلة` }).click();
    await page.getByRole('button', { name: 'فتح السلة' }).click();
    await page.getByRole('button', { name: 'إتمام الطلب بدون تسجيل دخول' }).click();
    const checkout = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'إتمام طلب الجملة' }),
    });
    await checkout.getByLabel('الاسم الكامل*').fill('عميل استرداد نجاح M10');
    await checkout.getByLabel('رقم الهاتف*').fill('0797004040');
    await checkout.getByLabel('المحافظة*').selectOption({ label: 'إربد' });
    await checkout.getByLabel('المدينة*').fill('الرمثا');
    await checkout.getByLabel('المنطقة أو الحي*').fill('حي الاختبار');
    await checkout.getByLabel('تفاصيل العنوان والتوصيل*').fill('شارع الاختبار، بجانب المتجر');
    await checkout.getByRole('button', { name: 'مراجعة الطلب قبل الإرسال' }).click();
    const review = page.getByRole('dialog', { name: 'راجع طلبك قبل الإرسال' });
    await expect(review.getByText('تم التحقق الأمني وجاهز للإرسال.')).toBeVisible({ timeout: 30_000 });
    await review.getByRole('button', { name: 'تأكيد وحفظ الطلب في الإدارة' }).click();

    await expect(page.getByRole('heading', { name: 'تم تسجيل طلبك' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('alert')).toContainText('السلة المحفوظة تحتاج معالجة صريحة');
    expect(committedResponseObserved).toBe(true);
    expect(gatewaySubmissions).toBe(1);
    expect(await page.evaluate((key) => localStorage.getItem(key), cartStorageKey)).toBe(corruptRaw);
    const pendingAfterSuccess = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), attemptStorageKey);
    expect(pendingAfterSuccess.serverState).toBe('SUCCEEDED');
    expect(pendingAfterSuccess.reconciliationState).toBe('BLOCKED_CART');
    expect(pendingAfterSuccess.receipt?.id).toBeTruthy();

    await page.getByRole('button', { name: 'العودة للمتجر' }).click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'فتح السلة' })).toBeVisible();
    expect(gatewaySubmissions).toBe(1);
    expect(await page.evaluate((key) => localStorage.getItem(key), cartStorageKey)).toBe(corruptRaw);
    await page.getByRole('button', { name: 'فتح السلة' }).click();
    await expect(page.getByText('السلة المحفوظة تحتاج مراجعة')).toBeVisible();
    await page.getByRole('button', { name: 'أوافق على إعادة ضبط السلة' }).click();

    await expect(page.getByRole('heading', { name: 'تم تسجيل طلبك' })).toBeVisible();
    expect(gatewaySubmissions).toBe(1);
    const finalState = await page.evaluate(({ cartKey, attemptKey }) => ({
      cart: JSON.parse(localStorage.getItem(cartKey) || 'null'),
      attempt: JSON.parse(localStorage.getItem(attemptKey) || 'null'),
    }), { cartKey: cartStorageKey, attemptKey: attemptStorageKey });
    expect(finalState.cart.items).toEqual([]);
    expect(finalState.cart.reconciliations.map((entry: { attemptId: string }) => entry.attemptId)).toEqual([finalState.attempt.attemptId]);
    expect(finalState.attempt.serverState).toBe('SUCCEEDED');
    expect(finalState.attempt.reconciliationState).toBe('APPLIED');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'فتح السلة' })).toBeVisible();
    expect(gatewaySubmissions).toBe(1);
    const afterFinalReload = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), cartStorageKey);
    expect(afterFinalReload.items).toEqual([]);
    expect(afterFinalReload.reconciliations).toHaveLength(1);
  });

  test('a response lost after real commit recovers with the same attempt and one business effect', async ({ page }) => {
    let dropFirstCommittedResponse = true;
    const submittedKeys: string[] = [];
    page.on('request', (request) => {
      if (!request.url().includes('/functions/v1/submit-guest-order')) return;
      const body = request.postDataJSON() as { idempotencyKey?: string } | null;
      if (body?.idempotencyKey) submittedKeys.push(body.idempotencyKey);
    });
    await useIsolatedBackend(page, async () => {
      if (!dropFirstCommittedResponse) return;
      dropFirstCommittedResponse = false;
      return 'DROP_RESPONSE';
    });
    await page.goto(`${customerBaseUrl}/#catalog`, { waitUntil: 'domcontentloaded' });

    await page.getByRole('button', { name: `إضافة ${productName} إلى السلة` }).click();
    await page.getByRole('button', { name: 'فتح السلة' }).click();
    await page.getByRole('button', { name: 'إتمام الطلب بدون تسجيل دخول' }).click();
    const checkout = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'إتمام طلب الجملة' }),
    });
    await checkout.getByLabel('الاسم الكامل*').fill('عميل فقدان الرد M10');
    await checkout.getByLabel('رقم الهاتف*').fill('0797005050');
    await checkout.getByLabel('المحافظة*').selectOption({ label: 'إربد' });
    await checkout.getByLabel('المدينة*').fill('الرمثا');
    await checkout.getByLabel('المنطقة أو الحي*').fill('حي الاختبار');
    await checkout.getByLabel('تفاصيل العنوان والتوصيل*').fill('شارع الاختبار، بجانب المتجر');
    await checkout.getByRole('button', { name: 'مراجعة الطلب قبل الإرسال' }).click();

    const review = page.getByRole('dialog', { name: 'راجع طلبك قبل الإرسال' });
    await expect(review.getByText('تم التحقق الأمني وجاهز للإرسال.')).toBeVisible();
    await review.getByRole('button', { name: 'تأكيد وحفظ الطلب في الإدارة' }).click();
    await expect(review.getByText(
      'حالة محاولة سابقة غير معروفة. أعد التحقق الأمني ثم اضغط «التحقق من نفس الطلب»؛ لن ننشئ مفتاحًا جديدًا.'
    )).toBeVisible();
    const unknown = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), attemptStorageKey);
    expect(unknown.serverState).toBe('UNKNOWN');

    await expect(review.getByText('تم التحقق الأمني وجاهز للإرسال.')).toBeVisible();
    const retryResponsePromise = page.waitForResponse((response) =>
      response.url().includes('/functions/v1/submit-guest-order')
    );
    await review.getByRole('button', { name: 'التحقق من نفس الطلب' }).click();
    const retryResponse = await retryResponsePromise;
    expect(retryResponse.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'تم تسجيل طلبك' })).toBeVisible();

    expect(submittedKeys).toHaveLength(2);
    expect(new Set(submittedKeys).size).toBe(1);
    expect(submittedKeys[0]).toBe(unknown.idempotencyKey);
    const finalState = await page.evaluate(({ cartKey, attemptKey }) => ({
      cart: JSON.parse(localStorage.getItem(cartKey) || 'null'),
      attempt: JSON.parse(localStorage.getItem(attemptKey) || 'null'),
    }), { cartKey: cartStorageKey, attemptKey: attemptStorageKey });
    expect(finalState.cart.items).toEqual([]);
    expect(finalState.cart.reconciliations).toHaveLength(1);
    expect(finalState.attempt.serverState).toBe('SUCCEEDED');
    expect(finalState.attempt.reconciliationState).toBe('APPLIED');
  });

  test('a late real Gateway response reconciles once without a second submission', async ({ page }) => {
    let gatewaySubmissions = 0;
    let markCommittedResponseObserved: () => void = () => undefined;
    let releaseCommittedResponse: () => void = () => undefined;
    const committedResponseObserved = new Promise<void>((resolve) => {
      markCommittedResponseObserved = resolve;
    });
    const committedResponseGate = new Promise<void>((resolve) => {
      releaseCommittedResponse = resolve;
    });
    page.on('request', (request) => {
      if (request.url().includes('/functions/v1/submit-guest-order')) gatewaySubmissions += 1;
    });
    await useIsolatedBackend(page, async () => {
      markCommittedResponseObserved();
      await committedResponseGate;
    });
    await page.goto(`${customerBaseUrl}/#catalog`, { waitUntil: 'domcontentloaded' });

    await page.getByRole('button', { name: `إضافة ${productName} إلى السلة` }).click();
    await page.getByRole('button', { name: 'فتح السلة' }).click();
    await page.getByRole('button', { name: 'إتمام الطلب بدون تسجيل دخول' }).click();
    const checkout = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'إتمام طلب الجملة' }),
    });
    await checkout.getByLabel('الاسم الكامل*').fill('عميل الرد المتأخر M10');
    await checkout.getByLabel('رقم الهاتف*').fill('0797005051');
    await checkout.getByLabel('المحافظة*').selectOption({ label: 'إربد' });
    await checkout.getByLabel('المدينة*').fill('الرمثا');
    await checkout.getByLabel('المنطقة أو الحي*').fill('حي الاختبار');
    await checkout.getByLabel('تفاصيل العنوان والتوصيل*').fill('شارع الاختبار، بجانب المتجر');
    await checkout.getByRole('button', { name: 'مراجعة الطلب قبل الإرسال' }).click();
    const review = page.getByRole('dialog', { name: 'راجع طلبك قبل الإرسال' });
    await expect(review.getByText('تم التحقق الأمني وجاهز للإرسال.')).toBeVisible();
    await review.getByRole('button', { name: 'تأكيد وحفظ الطلب في الإدارة' }).click();
    await committedResponseObserved;
    try {
      await expect(review.getByText(
        'حالة محاولة سابقة غير معروفة. أعد التحقق الأمني ثم اضغط «التحقق من نفس الطلب»؛ لن ننشئ مفتاحًا جديدًا.'
      )).toBeVisible({ timeout: 31_000 });
    } finally {
      releaseCommittedResponse();
    }

    await expect.poll(async () => page.evaluate((attemptKey) => {
      const attempt = JSON.parse(localStorage.getItem(attemptKey) || 'null');
      return `${attempt?.serverState}:${attempt?.reconciliationState}`;
    }, attemptStorageKey), { timeout: 15_000 }).toBe('SUCCEEDED:APPLIED');
    expect(gatewaySubmissions).toBe(1);
    const beforeReload = await page.evaluate((cartKey) =>
      JSON.parse(localStorage.getItem(cartKey) || 'null'), cartStorageKey);
    expect(beforeReload.items).toEqual([]);
    expect(beforeReload.reconciliations).toHaveLength(1);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'فتح السلة' })).toBeVisible();
    await expect.poll(async () => page.evaluate((attemptKey) => {
      const attempt = JSON.parse(localStorage.getItem(attemptKey) || 'null');
      return `${attempt?.serverState}:${attempt?.reconciliationState}`;
    }, attemptStorageKey)).toBe('SUCCEEDED:APPLIED');
    expect(gatewaySubmissions).toBe(1);
    const afterReload = await page.evaluate((cartKey) =>
      JSON.parse(localStorage.getItem(cartKey) || 'null'), cartStorageKey);
    expect(afterReload.items).toEqual([]);
    expect(afterReload.reconciliations).toHaveLength(1);
  });

  test('Chromium blocks false APPLIED cleanup and accepts only protocol-produced reconciliation proof', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Required closure evidence is Chromium-specific.');
    let gatewaySubmissions = 0;
    page.on('request', (request) => {
      if (request.url().includes('/functions/v1/submit-guest-order')) gatewaySubmissions += 1;
    });
    await useIsolatedBackend(page);
    await page.goto(`${customerBaseUrl}/#catalog`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: `إضافة ${productName} إلى السلة` }).click();
    await page.getByRole('button', { name: 'فتح السلة' }).click();
    await page.getByRole('button', { name: 'إتمام الطلب بدون تسجيل دخول' }).click();
    const checkout = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'إتمام طلب الجملة' }),
    });
    await checkout.getByLabel('الاسم الكامل*').fill('عميل دليل التسوية M10');
    await checkout.getByLabel('رقم الهاتف*').fill('0797006060');
    await checkout.getByLabel('المحافظة*').selectOption({ label: 'إربد' });
    await checkout.getByLabel('المدينة*').fill('الرمثا');
    await checkout.getByLabel('المنطقة أو الحي*').fill('حي الاختبار');
    await checkout.getByLabel('تفاصيل العنوان والتوصيل*').fill('شارع الاختبار، بجانب المتجر');
    await checkout.getByRole('button', { name: 'مراجعة الطلب قبل الإرسال' }).click();
    const review = page.getByRole('dialog', { name: 'راجع طلبك قبل الإرسال' });
    await expect(review.getByText('تم التحقق الأمني وجاهز للإرسال.')).toBeVisible({ timeout: 30_000 });
    await review.getByRole('button', { name: 'تأكيد وحفظ الطلب في الإدارة' }).click();
    await expect(page.getByRole('heading', { name: 'تم تسجيل طلبك' })).toBeVisible({ timeout: 30_000 });
    expect(gatewaySubmissions).toBe(1);

    const protocolState = await page.evaluate(({ cartKey, attemptKey, successKey, proofKey }) => ({
      cart: JSON.parse(localStorage.getItem(cartKey) || 'null'),
      attempt: JSON.parse(localStorage.getItem(attemptKey) || 'null'),
      successRaw: localStorage.getItem(successKey),
      proofRaw: localStorage.getItem(proofKey),
    }), {
      cartKey: cartStorageKey,
      attemptKey: attemptStorageKey,
      successKey: successStorageKey,
      proofKey: reconciliationEvidenceStorageKey,
    });
    expect(protocolState.attempt.serverState).toBe('SUCCEEDED');
    expect(protocolState.attempt.reconciliationState).toBe('APPLIED');
    expect(protocolState.proofRaw).toBeTruthy();

    const newerItem = {
      ...recoveryFixtures().newerCartItem,
      localLineId: 'browser-newer-after-success',
      localRevision: 1,
      quantity: 1,
    };
    const negativeCartRaw = await page.evaluate(({ cartKey, proofKey, newer }) => {
      const cart = JSON.parse(localStorage.getItem(cartKey) || 'null');
      const next = {
        ...cart,
        revision: cart.revision + 1,
        lastMutationId: 'browser-negative-evidence-removal',
        items: [newer],
        reconciliations: [],
      };
      localStorage.setItem(cartKey, JSON.stringify(next));
      localStorage.removeItem(proofKey);
      return JSON.stringify(next);
    }, { cartKey: cartStorageKey, proofKey: reconciliationEvidenceStorageKey, newer: newerItem });

    await page.reload({ waitUntil: 'domcontentloaded' });
    expect(gatewaySubmissions).toBe(1);
    await page.getByRole('button', { name: 'فتح السلة' }).click();
    const cart = page.getByRole('dialog', { name: 'سلة طلب الجملة' });
    await expect(cart.getByText(/دليل تسوية السلة غير مكتمل/)).toBeVisible();
    await expect(cart.getByRole('button', { name: 'إتمام الطلب غير متاح مؤقتًا' })).toBeDisabled();
    const blocked = await page.evaluate(({ cartKey, attemptKey, successKey, proofKey }) => ({
      cartRaw: localStorage.getItem(cartKey),
      attempt: JSON.parse(localStorage.getItem(attemptKey) || 'null'),
      successRaw: localStorage.getItem(successKey),
      proofRaw: localStorage.getItem(proofKey),
    }), {
      cartKey: cartStorageKey,
      attemptKey: attemptStorageKey,
      successKey: successStorageKey,
      proofKey: reconciliationEvidenceStorageKey,
    });
    expect(blocked.cartRaw).toBe(negativeCartRaw);
    expect(blocked.attempt.serverState).toBe('SUCCEEDED');
    expect(blocked.attempt.reconciliationState).toBe('APPLIED');
    expect(blocked.successRaw).toBe(protocolState.successRaw);
    expect(blocked.proofRaw).toBeNull();

    await page.evaluate(({ proofKey, proofRaw }) => {
      localStorage.setItem(proofKey, proofRaw);
    }, { proofKey: reconciliationEvidenceStorageKey, proofRaw: protocolState.proofRaw });
    await page.reload({ waitUntil: 'domcontentloaded' });
    expect(gatewaySubmissions).toBe(1);
    await page.getByRole('button', { name: 'فتح السلة' }).click();
    await page.getByRole('button', { name: 'إتمام الطلب بدون تسجيل دخول' }).click();
    await expect(page.getByRole('heading', { name: 'تم تسجيل طلبك' })).toBeVisible();
    await page.getByRole('button', { name: 'العودة للمتجر' }).click();
    await expect.poll(async () => page.evaluate((key) => localStorage.getItem(key), attemptStorageKey)).toBeNull();
    const cleaned = await page.evaluate(({ cartKey, successKey, proofKey }) => ({
      cart: JSON.parse(localStorage.getItem(cartKey) || 'null'),
      successRaw: localStorage.getItem(successKey),
      proofRaw: localStorage.getItem(proofKey),
    }), {
      cartKey: cartStorageKey,
      successKey: successStorageKey,
      proofKey: reconciliationEvidenceStorageKey,
    });
    expect(cleaned.cart.items).toHaveLength(1);
    expect(cleaned.cart.items[0]).toMatchObject({
      localLineId: newerItem.localLineId,
      localRevision: newerItem.localRevision,
      commercialLineKind: newerItem.commercialLineKind,
      productId: newerItem.productId,
      quantity: newerItem.quantity,
      unitPriceInMinorUnits: newerItem.unitPriceInMinorUnits,
    });
    expect(cleaned.successRaw).toBeNull();
    expect(cleaned.proofRaw).toBeNull();
    expect(gatewaySubmissions).toBe(1);

    await page.reload({ waitUntil: 'domcontentloaded' });
    expect(gatewaySubmissions).toBe(1);
    const afterReload = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), cartStorageKey);
    expect(afterReload.items).toEqual(cleaned.cart.items);
  });

});
