import { expect, test, type Page } from '@playwright/test';

const customerBaseUrl =
  process.env.CUSTOMER_BASE_URL ?? 'http://127.0.0.1:4174';

const product = {
  id: '00000000-0000-4000-8000-000000000731',
  sku: 'NWS-L3-RECEIPT',
  barcode: '',
  nameAr: 'منتج اختبار إيصال L3',
  description: '',
  categoryId: '00000000-0000-4000-8000-000000000010',
  categoryCode: 'L3',
  categoryNameAr: 'اختبار الصيانة',
  brandId: '',
  brandNameAr: '',
  unitId: '00000000-0000-4000-8000-000000000020',
  unitNameAr: 'حبة',
  saleUnitId: '00000000-0000-4000-8000-000000000021',
  saleUnitNameAr: 'كرتونة',
  unitsPerSalePackage: 1,
  salePackagePriceInMinorUnits: 1250,
  salePriceInMinorUnits: 1250,
  availableQuantity: 10,
  availableSalePackages: 10,
  minimumOrderPackages: 1,
  imageUrl: '',
  isAvailable: true,
  createdAt: '2026-09-01T00:00:00Z',
  soldPackagesLast90Days: 0,
  flavorMasterProductId: null,
  flavorNameAr: null,
  isFlavorMaster: false,
  flavorSortOrder: 0,
};

const trackingToken = '73100000-0000-4731-8731-000000000731';

async function mockStorefront(page: Page) {
  await page.route('**/rest/v1/rpc/get_public_storefront_settings', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        storeNameAr: 'محلات النواصرة',
        whatsappNumber: '962770000000',
        cliqAlias: 'nawasrah.cliq',
        ordersEnabled: true,
        announcementText: '',
        businessHoursText: '',
        deliveryAreasText: '',
        deliveryEtaText: '',
        exchangePolicyText: '',
        minimumOrderInMinorUnits: 0,
        deliveryFeeInMinorUnits: 0,
        insideRamthaDeliveryFeeInMinorUnits: 1000,
        outsideRamthaDeliveryFeeInMinorUnits: 2500,
        showNewestProducts: false,
        showBestSellers: false,
        showOffers: false,
        showLowStock: false,
        updatedAt: '2026-09-01T00:00:00Z',
      }),
    });
  });
  await page.route('**/rest/v1/rpc/get_public_storefront_catalog_page', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items: [product],
        categories: [],
        brands: [],
        saleUnits: [],
        summary: {
          availableProducts: 1,
          availableSalePackages: 10,
          lowStockProducts: 0,
        },
        total: 1,
        limit: 24,
        offset: 0,
      }),
    });
  });
  await page.route('**/rest/v1/rpc/get_public_storefront_merchandising', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ newest: [], bestSellers: [], offers: [], lowStock: [] }),
    });
  });
  await page.route('**/rest/v1/rpc/get_public_storefront_offers', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: '[]' });
  });
  await page.route('**/rest/v1/rpc/get_public_storefront_catalog_snapshot', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ items: [product] }),
    });
  });
}

test('successful checkout preserves the complete receipt presentation and direct tracking action', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      turnstile?: {
        render: (
          container: HTMLElement,
          options: { callback: (token: string) => void },
        ) => string;
        reset: () => void;
        remove: () => void;
      };
    };
    testWindow.turnstile = {
      render: (_container, options) => {
        queueMicrotask(() => options.callback('l3-characterization-token'));
        return 'l3-characterization-widget';
      },
      reset: () => undefined,
      remove: () => undefined,
    };
  });
  await mockStorefront(page);

  let submittedBody: Record<string, unknown> | null = null;
  await page.route('**/functions/v1/submit-guest-order', async (route) => {
    submittedBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        order_id: '00000000-0000-4000-8000-000000000732',
        order_number: 'WEB-L3-0001',
        customer_id: '00000000-0000-4000-8000-000000000733',
        customer_address_id: '00000000-0000-4000-8000-000000000734',
        customer_reused: false,
        idempotent_replay: false,
        subtotal: 1250,
        discount: 0,
        delivery_fee: 1000,
        total: 2250,
        delivery_zone: 'inside_ramtha',
        status: 'new',
        payment_method: 'cash_on_delivery',
        tracking_token: trackingToken,
        tracking_path: `/#track=${trackingToken}`,
      }),
    });
  });

  await page.goto(`${customerBaseUrl}/#catalog`, {
    waitUntil: 'domcontentloaded',
  });
  await page
    .getByRole('button', { name: `إضافة ${product.nameAr} إلى السلة` })
    .click();
  await page.getByRole('button', { name: /فتح السلة/ }).click();
  await page
    .getByRole('button', { name: 'إتمام الطلب بدون تسجيل دخول' })
    .click();

  const checkout = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'إتمام طلب الجملة' }),
  });
  await checkout.getByLabel('الاسم الكامل*').fill('عميل اختبار L3');
  await checkout.getByLabel('رقم الهاتف*').fill('0791234567');
  await checkout.getByLabel('المنطقة أو الحي*').fill('الحي الشرقي');
  await checkout
    .getByRole('button', { name: 'مراجعة الطلب قبل الإرسال' })
    .click();

  const review = page.getByRole('dialog', {
    name: 'راجع طلبك قبل الإرسال',
  });
  await expect(review.getByText('تم التحقق الأمني وجاهز للإرسال.')).toBeVisible();
  await review
    .getByRole('button', { name: 'تأكيد وحفظ الطلب في الإدارة' })
    .click();

  const receipt = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'تم تسجيل طلبك' }),
  });
  await expect(receipt.getByText('وصل طلبك إلى تطبيق الإدارة')).toBeVisible();
  await expect(receipt.getByText('WEB-L3-0001')).toBeVisible();
  await expect(receipt.getByText('٢٫٢٥٠ د.أ', { exact: true })).toBeVisible();
  await expect(
    receipt.getByText('تم إنشاء ملف عميل جديد وربطه بهذا الطلب تلقائيًا.'),
  ).toBeVisible();
  await expect(
    receipt.getByRole('link', { name: /إرسال الملخص لمتجرنا/ }),
  ).toBeVisible();
  await expect(receipt.getByRole('button', { name: 'متابعة الطلب' })).toBeVisible();
  expect(submittedBody).not.toBeNull();
  expect(submittedBody?.turnstileToken).toBe('l3-characterization-token');
});

test('secure tracking preserves the summary, actual status history and manual refresh', async ({
  page,
}) => {
  let trackingRequests = 0;
  await page.route('**/rest/v1/rpc/track_guest_order_by_token', async (route) => {
    trackingRequests += 1;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        order_number: 'WEB-L3-0001',
        status: 'out_for_delivery',
        payment_method: 'cash_on_delivery',
        payment_status: 'unpaid',
        total: 2250,
        item_count: 1,
        created_at: '2026-09-01T08:00:00.000Z',
        updated_at: '2026-09-01T08:30:00.000Z',
        tracking_token: trackingToken,
        tracking_path: `/#track=${trackingToken}`,
        delivery_started_at: '2026-09-01T08:30:00.000Z',
        estimated_arrival_at: '2026-09-01T09:00:00.000Z',
        driver_phone: '0790000000',
        timeline: [
          { status: 'new', created_at: '2026-09-01T08:00:00.000Z' },
          { status: 'confirmed', created_at: '2026-09-01T08:10:00.000Z' },
          { status: 'preparing', created_at: '2026-09-01T08:20:00.000Z' },
          {
            status: 'out_for_delivery',
            created_at: '2026-09-01T08:30:00.000Z',
          },
        ],
      }),
    });
  });

  await page.goto(`${customerBaseUrl}/#track=${trackingToken}`, {
    waitUntil: 'domcontentloaded',
  });

  const tracking = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'أين وصل طلبك؟' }),
  });
  await expect(tracking.getByText('WEB-L3-0001')).toBeVisible();
  await expect(
    tracking.getByRole('strong').filter({ hasText: 'الطلب في الطريق إليك' }),
  ).toBeVisible();
  await expect(tracking.getByText('وصلنا الطلب')).toBeVisible();
  await expect(tracking.getByText('تمت مراجعة الطلب')).toBeVisible();
  await expect(tracking.getByText('جاري تجهيز الطلب')).toBeVisible();
  await expect(tracking.getByText('٢٫٢٥٠ د.أ')).toBeVisible();
  await expect(tracking.getByText('إلى العنوان المسجل')).toBeVisible();
  await expect(tracking.getByText('0790000000')).toBeVisible();
  expect(trackingRequests).toBe(1);

  await tracking.getByRole('button', { name: 'تحديث الحالة' }).click();
  await expect.poll(() => trackingRequests).toBe(2);
});
