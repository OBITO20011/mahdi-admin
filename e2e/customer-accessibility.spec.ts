import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const customerBaseUrl = process.env.CUSTOMER_BASE_URL ?? 'http://127.0.0.1:4174';

async function mockStorefront(page: Page) {
  await page.route('**/rest/v1/rpc/get_public_storefront_settings', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      storeNameAr: 'محلات النواصرة التجارية', whatsappNumber: '962770000000', cliqAlias: '',
      ordersEnabled: true, announcementText: '', businessHoursText: 'يوميًا', deliveryAreasText: 'الرمثا',
      deliveryEtaText: 'حسب المنطقة', exchangePolicyText: 'وفق حالة الطلب', minimumOrderInMinorUnits: 0,
      deliveryFeeInMinorUnits: 0, insideRamthaDeliveryFeeInMinorUnits: 2000, outsideRamthaDeliveryFeeInMinorUnits: 4000,
      showNewestProducts: false, showBestSellers: false, showOffers: false, showLowStock: false,
      updatedAt: '2026-09-12T00:00:00Z',
    }),
  }));
  await page.route('**/rest/v1/rpc/get_public_storefront_catalog_page', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({items: [], categories: [], brands: [], saleUnits: [], summary: {availableProducts: 0, availableSalePackages: 0, lowStockProducts: 0}, total: 0, limit: 24, offset: 0}),
  }));
  await page.route('**/rest/v1/rpc/get_public_storefront_merchandising', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({newest: [], bestSellers: [], offers: [], lowStock: []}),
  }));
  await page.route('**/rest/v1/rpc/get_public_storefront_offers', (route) => route.fulfill({contentType: 'application/json', body: '[]'}));
}

test('about page has accessible landmarks, contrast, RTL, and mobile layout', async ({page}) => {
  await mockStorefront(page);

  for (const width of [360, 390, 430]) {
    await page.setViewportSize({width, height: 844});
    await page.goto(`${customerBaseUrl}/about/`, {waitUntil: 'domcontentloaded'});
    await expect(page.getByRole('heading', {name: 'محلات النواصرة التجارية', level: 1})).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.getByRole('navigation', {name: 'التنقل السريع'})).toBeVisible();
    await expect(page.getByRole('navigation', {name: 'تنقل المتجر'})).toBeVisible();
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
  }

  const results = await new AxeBuilder({page}).analyze();
  expect(results.violations.map((violation) => ({id: violation.id, impact: violation.impact}))).toEqual([]);
});

test('desktop exposes unique navigation names and keeps floating controls in a landmark', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 1000});
  await mockStorefront(page);
  await page.goto(`${customerBaseUrl}/about/`, {waitUntil: 'domcontentloaded'});

  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.getByRole('navigation', {name: 'التنقل الرئيسي'})).toBeVisible();
  await expect(page.getByRole('navigation', {name: 'روابط سريعة'})).toBeVisible();
  await expect(page.getByRole('complementary', {name: 'روابط التواصل السريع'})).toBeVisible();

  const navigationNames = await page.getByRole('navigation').evaluateAll((elements) => elements
    .filter((element) => getComputedStyle(element).display !== 'none')
    .map((element) => element.getAttribute('aria-label')
      ?? document.getElementById(element.getAttribute('aria-labelledby') ?? '')?.textContent?.trim()
      ?? ''));
  expect(new Set(navigationNames).size).toBe(navigationNames.length);

  const results = await new AxeBuilder({page}).analyze();
  expect(results.violations.map((violation) => ({id: violation.id, impact: violation.impact}))).toEqual([]);
});
