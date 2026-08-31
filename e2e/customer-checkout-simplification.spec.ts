import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const customerBaseUrl =
  process.env.CUSTOMER_BASE_URL ?? 'http://127.0.0.1:4174';

const product = {
  id: '00000000-0000-4000-8000-000000000601',
  sku: 'NWS-CHECKOUT-01',
  barcode: '',
  nameAr: 'منتج اختبار إتمام الطلب',
  description: '',
  categoryId: '00000000-0000-4000-8000-000000000010',
  categoryCode: 'CHECKOUT',
  categoryNameAr: 'اختبار',
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
  createdAt: '2026-08-31T00:00:00Z',
  soldPackagesLast90Days: 0,
  flavorMasterProductId: null,
  flavorNameAr: null,
  isFlavorMaster: false,
  flavorSortOrder: 0,
};

async function mockStorefront(page: Page) {
  await page.route('**/rest/v1/rpc/get_public_storefront_settings', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        storeNameAr: 'محلات النواصرة', whatsappNumber: '962770000000', cliqAlias: 'nawasrah.cliq',
        ordersEnabled: true, announcementText: '', businessHoursText: '',
        deliveryAreasText: '', deliveryEtaText: '', exchangePolicyText: '',
        minimumOrderInMinorUnits: 0, deliveryFeeInMinorUnits: 0,
        insideRamthaDeliveryFeeInMinorUnits: 1000, outsideRamthaDeliveryFeeInMinorUnits: 2500,
        showNewestProducts: false, showBestSellers: false, showOffers: false,
        showLowStock: false, updatedAt: '2026-08-31T00:00:00Z',
      }),
    });
  });
  await page.route('**/rest/v1/rpc/get_public_storefront_catalog_page', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items: [product], categories: [], brands: [], saleUnits: [],
        summary: { availableProducts: 1, availableSalePackages: 10, lowStockProducts: 0 },
        total: 1, limit: 24, offset: 0,
      }),
    });
  });
  await page.route('**/rest/v1/rpc/get_public_storefront_merchandising', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ newest: [], bestSellers: [], offers: [], lowStock: [] }) });
  });
  await page.route('**/rest/v1/rpc/get_public_storefront_offers', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: '[]' });
  });
  await page.route('**/rest/v1/rpc/get_public_storefront_catalog_snapshot', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [product] }) });
  });
}

test('checkout keeps all required delivery data while showing one non-duplicated details field', async ({ page }) => {
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
        queueMicrotask(() => options.callback('test-security-token'));
        return 'checkout-test-widget';
      },
      reset: () => undefined,
      remove: () => undefined,
    };
  });
  await mockStorefront(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${customerBaseUrl}/#catalog`, { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: `إضافة ${product.nameAr} إلى السلة` }).click();
  await page.getByRole('button', { name: /فتح السلة/ }).click();
  await page.getByRole('button', { name: 'إتمام الطلب بدون تسجيل دخول' }).click();

  const checkout = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'إتمام طلب الجملة' }) });
  await expect(checkout).toBeVisible();
  await expect(checkout.getByText('لا تحتاج حسابًا أو كلمة مرور')).toBeVisible();
  await expect(checkout.getByLabel('الاسم الكامل*')).toBeVisible();
  await expect(checkout.getByLabel('رقم الهاتف*')).toBeVisible();
  await expect(checkout.getByLabel('المحافظة*')).toBeVisible();
  await expect(checkout.getByLabel('المدينة*')).toBeVisible();
  await expect(checkout.getByLabel('المنطقة أو الحي*')).toBeVisible();
  const deliveryDetails = checkout.getByLabel(/تفاصيل العنوان والتوصيل \(اختياري\)/);
  await expect(deliveryDetails).toBeVisible();
  await expect(checkout.getByText('منطقة التوصيل')).toBeVisible();
  await expect(checkout.getByText('موقع التوصيل على الخريطة (اختياري)')).toBeVisible();
  await expect(checkout.getByText('معك رمز خصم؟')).toBeVisible();
  await expect(checkout.getByText('طريقة الدفع')).toBeVisible();
  await expect(checkout.getByText('لا تستخدم هذا الخيار على جهاز مشترك.')).toBeVisible();
  await expect(checkout.getByText('رقم المحل أو المبنى', { exact: true })).toHaveCount(0);
  await expect(checkout.getByText('ملاحظات على العنوان', { exact: true })).toHaveCount(0);
  await expect(checkout.getByText('ملاحظات على الطلب', { exact: true })).toHaveCount(0);

  await deliveryDetails.fill(
    'محل 12، بجانب الصيدلية، اتصل قبل الوصول، التوصيل بعد الساعة 4'
  );
  await expect(checkout.getByText(/\/300/)).toBeVisible();
  await checkout.getByLabel('الاسم الكامل*').fill('محمد أحمد');
  await checkout.getByLabel('رقم الهاتف*').fill('0791234567');
  await checkout.getByLabel('المنطقة أو الحي*').fill('الحي الشرقي');
  await checkout.getByRole('button', { name: 'خارج الرمثا أجرة التوصيل ٢٫٥٠٠ د.أ' }).click();
  await checkout.getByRole('button', { name: 'CliQ' }).click();
  await checkout.getByRole('button', { name: 'مراجعة الطلب قبل الإرسال' }).click();
  const review = page.getByRole('dialog', { name: 'راجع طلبك قبل الإرسال' });
  await expect(review.getByText('تم التحقق الأمني وجاهز للإرسال.')).toBeVisible();
  await expect(review.getByRole('button', { name: 'تأكيد وحفظ الطلب في الإدارة' })).toBeEnabled();
  const editDetails = review.getByRole('button', { name: 'تعديل البيانات' });
  await expect(editDetails).toBeVisible();
  await editDetails.click();
  await expect(deliveryDetails).toHaveValue(
    'محل 12، بجانب الصيدلية، اتصل قبل الوصول، التوصيل بعد الساعة 4'
  );

  for (const viewport of [
    { width: 360, height: 640 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
  }

  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations
      .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
      .map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => node.target) }))
  ).toEqual([]);
});
