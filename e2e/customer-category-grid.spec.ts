import { expect, test, type Page } from '@playwright/test';

const customerBaseUrl =
  process.env.CUSTOMER_BASE_URL ?? 'http://127.0.0.1:4174';

const categories = [
  {
    id: '00000000-0000-4000-8000-000000000010',
    code: 'CAT-BEV',
    nameAr: 'مشروبات وعصائر طازجة',
    imageUrl: 'https://test.invalid/broken-category-cover.jpg',
    productCount: 12,
    availableProductCount: 12,
  },
  {
    id: '00000000-0000-4000-8000-000000000011',
    code: 'CAT-WATER',
    nameAr: 'مياه',
    imageUrl: '',
    productCount: 4,
    availableProductCount: 4,
  },
  {
    id: '00000000-0000-4000-8000-000000000012',
    code: 'CAT-BISCUIT',
    nameAr: 'بسكويت وويفر',
    imageUrl: '',
    productCount: 8,
    availableProductCount: 8,
  },
  {
    id: '00000000-0000-4000-8000-000000000013',
    code: 'CAT-CHOCO',
    nameAr: 'شوكولاتة',
    imageUrl: '',
    productCount: 3,
    availableProductCount: 3,
  },
  {
    id: '00000000-0000-4000-8000-000000000014',
    code: 'CAT-FOOD',
    nameAr: 'مواد غذائية متنوعة',
    imageUrl: '',
    productCount: 6,
    availableProductCount: 6,
  },
];

const products = categories.map((category, index) => ({
  id: `00000000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`,
  sku: `NWS-CAT-${index + 1}`,
  barcode: '',
  nameAr: `منتج ${category.nameAr}`,
  description: '',
  categoryId: category.id,
  categoryCode: category.code,
  categoryNameAr: category.nameAr,
  brandId: '',
  brandNameAr: '',
  unitId: '00000000-0000-4000-8000-000000000020',
  unitNameAr: 'حبة',
  saleUnitId: '00000000-0000-4000-8000-000000000021',
  saleUnitNameAr: 'كرتونة',
  unitsPerSalePackage: 1,
  salePackagePriceInMinorUnits: 1000,
  salePriceInMinorUnits: 1000,
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
}));

async function mockCategoryResponses(page: Page) {
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
    const request = route.request().postDataJSON() as Record<string, unknown>;
    const requestedCategory = request.p_category_id;
    const items = requestedCategory
      ? products.filter((product) => product.categoryId === requestedCategory)
      : products;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items,
        categories,
        brands: [],
        saleUnits: [],
        summary: {
          availableProducts: products.length,
          availableSalePackages: products.length * 10,
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
}

async function waitForStableCategoryGrid(page: Page) {
  await page.getByTestId('category-grid').getByRole('button').first().waitFor();
  await page.evaluate(async () => {
    const animations = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="category-grid"] button'),
    ).flatMap((element) => element.getAnimations());
    await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
  });
}

async function waitForStableHomeCategoryGrid(page: Page) {
  await page.getByTestId('home-category-grid').getByRole('button').first().waitFor();
  await page.evaluate(async () => {
    const animations = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="home-category-grid"] button'),
    ).flatMap((element) => element.getAnimations());
    await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
  });
}

test.describe('شبكة تصنيفات متجر العملاء', () => {
  test('تعرض كل الأقسام كبطاقات مربعة بثلاثة أعمدة على الهاتف وتحافظ على الفلترة', async ({ page }) => {
    await mockCategoryResponses(page);

    for (const viewport of [
      { width: 360, height: 640 },
      { width: 390, height: 844 },
      { width: 430, height: 932 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`${customerBaseUrl}/#categories`, {
        waitUntil: 'domcontentloaded',
      });
      await expect(page.getByRole('heading', { name: 'أقسام متجر نواصرة' })).toBeVisible();
      await waitForStableCategoryGrid(page);

      const grid = page.getByTestId('category-grid');
      const cards = grid.getByRole('button');
      await expect(cards).toHaveCount(categories.length + 1);
      const firstRow = await cards.evaluateAll((elements) =>
        elements.slice(0, 3).map((element) => {
          const box = element.getBoundingClientRect();
          return {
            top: box.top,
            width: box.width,
            height: box.height,
            right: box.right,
          };
        }),
      );
      expect(Math.max(...firstRow.map((card) => card.top)) - Math.min(...firstRow.map((card) => card.top))).toBeLessThan(2);
      expect(firstRow.every((card) => Math.abs(card.width - card.height) < 2)).toBe(true);
      expect(firstRow.every((card) => card.width >= 44 && card.height >= 44)).toBe(true);
      expect(firstRow[0].right).toBeGreaterThan(firstRow[1].right);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }

    const brokenImage = page.locator('img[src="https://test.invalid/broken-category-cover.jpg"]');
    await expect(brokenImage).toHaveCSS('display', 'none');

    await page.getByRole('button', { name: 'فتح قسم مياه' }).click();
    await expect(page.locator('#catalog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'منتج مياه' })).toBeVisible();

    await page.goto(`${customerBaseUrl}/#home`, { waitUntil: 'domcontentloaded' });
    const homeGrid = page.getByTestId('home-category-grid');
    await expect(homeGrid.getByRole('button')).toHaveCount(4);
    await waitForStableHomeCategoryGrid(page);
    const homeCards = await homeGrid.getByRole('button').evaluateAll((elements) =>
      elements.slice(0, 3).map((element) => {
        const box = element.getBoundingClientRect();
        return { top: box.top, width: box.width, height: box.height };
      }),
    );
    expect(Math.max(...homeCards.map((card) => card.top)) - Math.min(...homeCards.map((card) => card.top))).toBeLessThan(2);
    expect(homeCards.every((card) => Math.abs(card.width - card.height) < 2)).toBe(true);
  });

  test('لا تتحول البطاقات إلى عناصر ضخمة على Tablet وDesktop', async ({ page }) => {
    await mockCategoryResponses(page);

    for (const viewport of [
      { width: 768, height: 1024 },
      { width: 1280, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`${customerBaseUrl}/#categories`, {
        waitUntil: 'domcontentloaded',
      });
      const grid = page.getByTestId('category-grid');
      await waitForStableCategoryGrid(page);
      const firstCard = await grid.getByRole('button').first().boundingBox();
      expect(firstCard).not.toBeNull();
      expect(firstCard!.width).toBeLessThan(260);
      expect(Math.abs(firstCard!.width - firstCard!.height)).toBeLessThan(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });
});
