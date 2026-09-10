import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const customerBaseUrl = process.env.CUSTOMER_BASE_URL ?? 'http://127.0.0.1:4174';

const product = {
  id: '00000000-0000-4000-8000-000000000981', sku: 'NWS-ASSIST-01', barcode: '',
  nameAr: 'صنف اختبار المساعد', description: '', categoryId: '00000000-0000-4000-8000-000000000010',
  categoryCode: 'TEST', categoryNameAr: 'اختبار', brandId: '', brandNameAr: '',
  unitId: '00000000-0000-4000-8000-000000000020', unitNameAr: 'حبة',
  saleUnitId: '00000000-0000-4000-8000-000000000021', saleUnitNameAr: 'كرتونة',
  unitsPerSalePackage: 1, salePackagePriceInMinorUnits: 1250, salePriceInMinorUnits: 1250,
  availableQuantity: 10, availableSalePackages: 10, minimumOrderPackages: 1, imageUrl: '',
  isAvailable: true, createdAt: '2026-09-10T00:00:00Z', soldPackagesLast90Days: 0,
  flavorMasterProductId: null, flavorNameAr: null, isFlavorMaster: false, flavorSortOrder: 0,
};

async function mockStorefront(page: Page) {
  await page.route('**/rest/v1/rpc/get_public_storefront_settings', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      storeNameAr: 'محلات النواصرة التجارية', whatsappNumber: '962770000000', cliqAlias: 'nawasrah.cliq',
      ordersEnabled: true, announcementText: '', businessHoursText: '', deliveryAreasText: 'الرمثا وإربد والمناطق المحيطة',
      deliveryEtaText: 'يؤكدها فريق المتجر', exchangePolicyText: '', minimumOrderInMinorUnits: 0,
      deliveryFeeInMinorUnits: 0, insideRamthaDeliveryFeeInMinorUnits: 1000, outsideRamthaDeliveryFeeInMinorUnits: 2500,
      showNewestProducts: false, showBestSellers: false, showOffers: true, showLowStock: false, updatedAt: '2026-09-10T00:00:00Z',
    }),
  }));
  await page.route('**/rest/v1/rpc/get_public_storefront_catalog_page', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({items: [product], categories: [], brands: [], saleUnits: [], summary: {availableProducts: 1, availableSalePackages: 10, lowStockProducts: 0}, total: 1, limit: 24, offset: 0}),
  }));
  await page.route('**/rest/v1/rpc/get_public_storefront_merchandising', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({newest: [], bestSellers: [], offers: [], lowStock: []}),
  }));
  await page.route('**/rest/v1/rpc/get_public_storefront_offers', (route) => route.fulfill({contentType: 'application/json', body: '[]'}));
}

test('guided store assistant is accessible, uses only public settings, and routes through existing paths', async ({page}) => {
  await mockStorefront(page);
  await page.goto(customerBaseUrl, {waitUntil: 'domcontentloaded'});

  const trigger = page.getByTestId('guided-store-assistant-trigger');
  await expect(trigger).toBeVisible();
  await trigger.click();
  const assistant = page.getByTestId('guided-store-assistant-panel');
  await expect(assistant).toBeVisible();
  await expect(assistant.getByText('كيف نقدر نساعدك؟')).toBeVisible();

  await assistant.getByTestId('guided-store-assistant-delivery').click();
  await expect(assistant.getByText('الرمثا وإربد والمناطق المحيطة')).toBeVisible();
  await expect(assistant.getByText('داخل الرمثا')).toBeVisible();
  await page.keyboard.press('Escape');
  await trigger.click();
  await assistant.getByTestId('guided-store-assistant-payment').click();
  await expect(assistant.getByText('nawasrah.cliq')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(assistant.locator('xpath=..')).toHaveAttribute('aria-hidden', 'true');

  await trigger.click();
  await assistant.getByTestId('guided-store-assistant-products').click();
  await expect(page).toHaveURL(/\/products\/$/u);

  await trigger.click();
  const whatsapp = assistant.getByTestId('guided-store-assistant-whatsapp');
  await expect(whatsapp).toHaveAttribute('href', /wa\.me\/962770000000/u);

  const accessibility = await new AxeBuilder({page}).include('[data-testid="guided-store-assistant-panel"]').analyze();
  expect(accessibility.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')).toEqual([]);
});

test('guided store assistant stays clear of the mobile navigation and cart action at supported phone widths', async ({page}) => {
  await mockStorefront(page);

  for (const width of [360, 390, 430]) {
    await page.setViewportSize({width, height: 844});
    await page.goto(`${customerBaseUrl}/products/`, {waitUntil: 'domcontentloaded'});
    await page.evaluate(() => window.localStorage.clear());
    await page.reload({waitUntil: 'domcontentloaded'});

    const trigger = page.getByTestId('guided-store-assistant-trigger');
    const navigation = page.getByRole('navigation', {name: 'تنقل المتجر'});
    const triggerBox = await trigger.boundingBox();
    const navigationBox = await navigation.boundingBox();
    expect(triggerBox, `${width}px: assistant trigger`).not.toBeNull();
    expect(navigationBox, `${width}px: mobile navigation`).not.toBeNull();
    expect(triggerBox!.y + triggerBox!.height, `${width}px: trigger must clear navigation`).toBeLessThanOrEqual(navigationBox!.y);

    const addToCart = page.getByRole('button', {name: /إضافة .* إلى السلة/u}).first();
    if (await addToCart.count()) {
      await addToCart.click();
    } else {
      await page.getByRole('button', {name: /زيادة .* في السلة/u}).first().click();
    }
    const cartAction = page.getByRole('button', {name: /طرد في السلة/u});
    await expect(cartAction).toBeVisible();
    const cartActionBox = await cartAction.boundingBox();
    const triggerWithCartBox = await trigger.boundingBox();
    expect(cartActionBox, `${width}px: cart action`).not.toBeNull();
    expect(triggerWithCartBox, `${width}px: assistant trigger with cart`).not.toBeNull();
    expect(triggerWithCartBox!.y + triggerWithCartBox!.height, `${width}px: trigger must clear cart action`).toBeLessThanOrEqual(cartActionBox!.y);
  }
});
