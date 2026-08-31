import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const customerBaseUrl =
  process.env.CUSTOMER_BASE_URL ?? 'http://127.0.0.1:4174';
const favoritesStorageKey = 'nawasrah-store-favorites-v1';

const availableProduct = {
  id: '00000000-0000-4000-8000-000000000201',
  sku: 'NWS-FAV-AVAILABLE',
  barcode: '',
  nameAr: 'منتج مفضل متوفر',
  description: '',
  categoryId: '00000000-0000-4000-8000-000000000010',
  categoryCode: 'CAT-FAV',
  categoryNameAr: 'مفضلات الاختبار',
  brandId: '',
  brandNameAr: '',
  unitId: '00000000-0000-4000-8000-000000000020',
  unitNameAr: 'حبة',
  saleUnitId: '00000000-0000-4000-8000-000000000021',
  saleUnitNameAr: 'كرتونة',
  unitsPerSalePackage: 1,
  salePackagePriceInMinorUnits: 1250,
  salePriceInMinorUnits: 1250,
  availableQuantity: 5,
  availableSalePackages: 5,
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

const unavailableProduct = {
  ...availableProduct,
  id: '00000000-0000-4000-8000-000000000202',
  sku: 'NWS-FAV-UNAVAILABLE',
  nameAr: 'منتج مفضل غير متوفر',
  availableQuantity: 0,
  availableSalePackages: 0,
  isAvailable: false,
};

const missingProductId = '00000000-0000-4000-8000-000000000203';
const products = [availableProduct, unavailableProduct];

async function mockStorefront(page: Page) {
  await page.route('https://test.invalid/**', (route) => route.abort());
  await page.route('**/rest/v1/rpc/get_public_storefront_settings', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        storeNameAr: 'محلات النواصرة',
        whatsappNumber: '962770000000',
        cliqAlias: '',
        ordersEnabled: true,
        announcementText: '',
        businessHoursText: '',
        deliveryAreasText: '',
        deliveryEtaText: '',
        exchangePolicyText: '',
        minimumOrderInMinorUnits: 0,
        deliveryFeeInMinorUnits: 0,
        insideRamthaDeliveryFeeInMinorUnits: 0,
        outsideRamthaDeliveryFeeInMinorUnits: 0,
        showNewestProducts: false,
        showBestSellers: false,
        showOffers: false,
        showLowStock: false,
        updatedAt: '2026-08-31T00:00:00Z',
      }),
    });
  });
  await page.route('**/rest/v1/rpc/get_public_storefront_catalog_page', async (route) => {
    const request = route.request().postDataJSON() as { p_product_ids?: string[] | null };
    const requestedIds = request.p_product_ids;
    const items = requestedIds === null || requestedIds === undefined
      ? products
      : products.filter((product) => requestedIds.includes(product.id));
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items,
        categories: [],
        brands: [],
        saleUnits: [],
        summary: {
          availableProducts: 1,
          availableSalePackages: 5,
          lowStockProducts: 0,
        },
        total: items.length,
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
}

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations
      .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
      .map((violation) => violation.id)
  ).toEqual([]);
}

test.describe('مفضلات متجر العملاء', () => {
  test('تظل المفضلة الفارغة صفحة مستقلة وتعيد إلى الكتالوج باختيار المستخدم', async ({ page }) => {
    await mockStorefront(page);
    await page.goto(`${customerBaseUrl}/#favorites`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('favorites-page')).toBeVisible();
    await expect(page.getByTestId('favorites-empty-state')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'مفضلتك فارغة حاليًا' })).toBeVisible();
    await expect(page).toHaveURL(/#favorites$/);
    await expect(page.locator('#catalog')).toHaveCount(0);
    await expectNoSeriousAccessibilityViolations(page);

    await page.getByRole('button', { name: 'تصفح المنتجات' }).click();
    await expect(page.locator('#catalog')).toBeVisible();
    await expect(page).toHaveURL(/#catalog$/);
  });

  test('تعرض المفضلات المحفوظة، تبقي غير المتاح ظاهرًا، ولا تحذف العنصر المفقود بصمت', async ({ page }) => {
    await mockStorefront(page);
    await page.addInitScript(
      ({ key, values }) => localStorage.setItem(key, JSON.stringify(values)),
      { key: favoritesStorageKey, values: [availableProduct.id, unavailableProduct.id, missingProductId] }
    );
    await page.goto(`${customerBaseUrl}/#favorites`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('favorites-products-grid')).toBeVisible();
    await expect(page.getByRole('heading', { name: availableProduct.nameAr })).toBeVisible();
    await expect(page.getByRole('heading', { name: unavailableProduct.nameAr })).toBeVisible();
    await expect(page.getByText('غير متوفر حاليًا').first()).toBeVisible();
    await expect(page.getByRole('button', { name: `إضافة ${unavailableProduct.nameAr} إلى السلة` })).toBeDisabled();
    await expect(page.getByText('بعض العناصر المحفوظة لم تعد متاحة للعرض حاليًا.')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('00000000-0000-4000-8000-000000000203');
    await expect(page.evaluate((key) => localStorage.getItem(key), favoritesStorageKey)).resolves.toContain(missingProductId);
  });

  test('إضافة أول مفضل وإزالة آخره تحدثان الصفحة فورًا وتحفظان القائمة بعد التحديث', async ({ page }) => {
    await mockStorefront(page);
    await page.goto(`${customerBaseUrl}/#catalog`, { waitUntil: 'domcontentloaded' });

    await page.getByRole('button', { name: `إضافة ${availableProduct.nameAr} إلى المفضلة` }).click();
    await page.getByRole('button', { name: 'عرض المنتجات المفضلة' }).click();
    await expect(page.getByTestId('favorites-products-grid')).toBeVisible();
    await expect(page.getByRole('heading', { name: availableProduct.nameAr })).toBeVisible();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: availableProduct.nameAr })).toBeVisible();

    await page.getByRole('button', { name: `إزالة ${availableProduct.nameAr} من المفضلة` }).click();
    await expect(page.getByTestId('favorites-empty-state')).toBeVisible();
  });

  test('لا يحدث overflow في صفحة المفضلة على المقاسات المدعومة', async ({ page }, testInfo) => {
    await mockStorefront(page);
    await page.addInitScript(
      ({ key, value }) => localStorage.setItem(key, JSON.stringify([value])),
      { key: favoritesStorageKey, value: availableProduct.id }
    );

    const viewports = testInfo.project.name === 'desktop-chromium'
      ? [{ width: 1280, height: 900 }]
      : [
          { width: 360, height: 640 },
          { width: 390, height: 844 },
          { width: 430, height: 932 },
        ];

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto(`${customerBaseUrl}/#favorites`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('favorites-products-grid')).toBeVisible();
      await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
    }
  });
});
