import { expect, test, type Page } from '@playwright/test';

const customerBaseUrl =
  process.env.CUSTOMER_BASE_URL ?? 'http://127.0.0.1:4174';

const baseProduct = {
  sku: 'NWS-COMPACT-01',
  barcode: '',
  description: 'وصف طويل ينبغي أن يبقى داخل تفاصيل المنتج ولا يزاحم بطاقة الهاتف.',
  categoryId: '00000000-0000-4000-8000-000000000010',
  categoryCode: 'CAT-COMPACT',
  categoryNameAr: 'قسم منتجات اختبار طويلة الاسم',
  brandId: '',
  brandNameAr: '',
  unitId: '00000000-0000-4000-8000-000000000020',
  unitNameAr: 'حبة',
  saleUnitId: '00000000-0000-4000-8000-000000000021',
  saleUnitNameAr: 'كرتونة',
  unitsPerSalePackage: 1,
  salePackagePriceInMinorUnits: 1250,
  salePriceInMinorUnits: 1250,
  availableQuantity: 8,
  availableSalePackages: 8,
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

const products = [
  {
    ...baseProduct,
    id: '00000000-0000-4000-8000-000000000301',
    nameAr: 'اسم منتج طويل جدًا لاختبار سطرين فقط داخل بطاقة الهاتف المدمجة',
  },
  ...Array.from({ length: 4 }, (_, index) => ({
    ...baseProduct,
    id: `00000000-0000-4000-8000-${String(302 + index).padStart(12, '0')}`,
    sku: `NWS-COMPACT-${index + 2}`,
    nameAr: `منتج مدمج ${index + 2}`,
  })),
  {
    ...baseProduct,
    id: '00000000-0000-4000-8000-000000000306',
    sku: 'NWS-COMPACT-UNAVAILABLE',
    nameAr: 'منتج غير متوفر',
    availableQuantity: 0,
    availableSalePackages: 0,
    isAvailable: false,
  },
  {
    ...baseProduct,
    id: '00000000-0000-4000-8000-000000000307',
    sku: 'NWS-COMPACT-FLAVOR-MASTER',
    nameAr: 'شيبس النكهات',
    isFlavorMaster: true,
  },
  {
    ...baseProduct,
    id: '00000000-0000-4000-8000-000000000308',
    sku: 'NWS-COMPACT-FLAVOR-CHEESE',
    nameAr: 'شيبس النكهات - جبنة',
    flavorMasterProductId: '00000000-0000-4000-8000-000000000307',
    flavorNameAr: 'جبنة',
    flavorSortOrder: 1,
  },
];

async function mockStorefront(page: Page) {
  await page.route('**/rest/v1/rpc/get_public_storefront_settings', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        storeNameAr: 'محلات النواصرة', whatsappNumber: '962770000000', cliqAlias: '',
        ordersEnabled: true, announcementText: '', businessHoursText: '',
        deliveryAreasText: '', deliveryEtaText: '', exchangePolicyText: '',
        minimumOrderInMinorUnits: 0, deliveryFeeInMinorUnits: 0,
        insideRamthaDeliveryFeeInMinorUnits: 0, outsideRamthaDeliveryFeeInMinorUnits: 0,
        showNewestProducts: false, showBestSellers: false, showOffers: false,
        showLowStock: false, updatedAt: '2026-08-31T00:00:00Z',
      }),
    });
  });
  await page.route('**/rest/v1/rpc/get_public_storefront_catalog_page', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items: products,
        categories: [], brands: [], saleUnits: [],
        summary: { availableProducts: 7, availableSalePackages: 48, lowStockProducts: 0 },
        total: 7, limit: 24, offset: 0,
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

async function getGridColumns(page: Page) {
  return page.getByTestId('catalog-products-grid').locator('article').evaluateAll((cards) => {
    const firstTop = cards[0]?.getBoundingClientRect().top;
    return cards.filter((card) => Math.abs(card.getBoundingClientRect().top - (firstTop ?? 0)) < 2).length;
  });
}

test.describe('شبكة المنتجات المدمجة', () => {
  test('تستخدم عمودين عند 360 وثلاثة أعمدة عند 390 و430 من دون overflow', async ({ page }) => {
    await mockStorefront(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });

    for (const [viewport, expectedColumns] of [
      [{ width: 360, height: 640 }, 2],
      [{ width: 390, height: 844 }, 3],
      [{ width: 430, height: 932 }, 3],
    ] as const) {
      await page.setViewportSize(viewport);
      await page.goto(`${customerBaseUrl}/#catalog`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('catalog-products-grid')).toBeVisible();
      expect(await getGridColumns(page)).toBe(expectedColumns);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });

  test('تحافظ البطاقة المدمجة على السعر والوحدة والإضافة والمفضلة والتفاصيل', async ({ page }) => {
    await mockStorefront(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${customerBaseUrl}/#catalog`, { waitUntil: 'domcontentloaded' });

    const longName = products[0].nameAr;
    await expect(page.getByRole('heading', { name: longName })).toBeVisible();
    await expect(page.getByText('١٫٢٥٠ د.أ').first()).toBeVisible();
    await expect(
      page.getByTestId('catalog-products-grid').locator('article').first()
        .getByText('كرتونة', { exact: true }).last()
    ).toBeVisible();

    await page.getByRole('button', { name: `إضافة ${longName} إلى السلة` }).click();
    await expect(page.getByRole('button', { name: `زيادة ${longName} في السلة` })).toBeVisible();

    const favorite = page.getByRole('button', { name: `إضافة ${longName} إلى المفضلة` });
    await favorite.click();
    await expect(page.getByRole('button', { name: `إزالة ${longName} من المفضلة` })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: `عرض تفاصيل ${longName}` }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(page.getByRole('button', { name: 'إضافة منتج غير متوفر إلى السلة' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'اختيار نكهة شيبس النكهات' })).toBeVisible();
  });

  test('يبقى Tablet/Desktop مقروءًا بالاستجابة المناسبة', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile-webkit', 'Desktop and tablet widths are covered on Chromium.');
    await mockStorefront(page);

    for (const [viewport, expectedColumns] of [
      [{ width: 768, height: 1024 }, 2],
      [{ width: 1280, height: 900 }, 4],
    ] as const) {
      await page.setViewportSize(viewport);
      await page.goto(`${customerBaseUrl}/#catalog`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('catalog-products-grid')).toBeVisible();
      expect(await getGridColumns(page)).toBe(expectedColumns);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });
});
