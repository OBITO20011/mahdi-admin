import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const adminBaseUrl =
  process.env.ADMIN_BASE_URL ?? 'http://127.0.0.1:4173';
const customerBaseUrl =
  process.env.CUSTOMER_BASE_URL ?? 'http://127.0.0.1:4174';

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const blockingViolations = results.violations.filter(
    (violation) =>
      violation.impact === 'critical' || violation.impact === 'serious',
  );

  const violationSummary = blockingViolations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target.join(' ')),
  }));

  expect(violationSummary).toEqual([]);
}

test.describe('متجر العملاء العام', () => {
  test('الواجهة الرئيسية تجمع أقسام المنتجات المميزة في طلب واحد محدود', async ({ page }) => {
    const merchandisingRequests: Record<string, unknown>[] = [];
    const settingsRequests: Record<string, unknown>[] = [];
    const product = {
      id: '00000000-0000-4000-8000-000000000301',
      sku: 'NWS-MERCH-01',
      barcode: '',
      nameAr: 'منتج الاختيارات المميزة',
      description: '',
      categoryId: '00000000-0000-4000-8000-000000000010',
      categoryCode: 'CAT-BEV',
      categoryNameAr: 'مشروبات',
      brandId: '', brandNameAr: '', unitId: '00000000-0000-4000-8000-000000000020',
      unitNameAr: 'حبة', saleUnitId: '00000000-0000-4000-8000-000000000021',
      saleUnitNameAr: 'كرتونة', unitsPerSalePackage: 1,
      salePackagePriceInMinorUnits: 1000, salePriceInMinorUnits: 1000,
      availableQuantity: 10, availableSalePackages: 10, minimumOrderPackages: 1,
      imageUrl: '', isAvailable: true, createdAt: '2026-01-01T00:00:00Z',
      soldPackagesLast90Days: 0, flavorMasterProductId: null, flavorNameAr: null,
      isFlavorMaster: false, flavorSortOrder: 0,
    };

    await page.route('**/rest/v1/rpc/get_public_storefront_settings', async (route) => {
      settingsRequests.push(route.request().postDataJSON() as Record<string, unknown>);
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
          showNewestProducts: true,
          showBestSellers: true,
          showOffers: true,
          showLowStock: true,
          updatedAt: '2026-09-02T00:00:00Z',
        }),
      });
    });

    await page.route('**/rest/v1/rpc/get_public_storefront_merchandising', async (route) => {
      merchandisingRequests.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          newest: [product], bestSellers: [product], offers: [product], lowStock: [product],
        }),
      });
    });

    await page.goto(customerBaseUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'وصل حديثًا' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'الأكثر طلبًا' })).toBeVisible();
    await expect.poll(() => merchandisingRequests.length).toBe(1);
    await expect.poll(() => settingsRequests.length).toBe(1);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'وصل حديثًا' })).toBeVisible();
    await expect.poll(() => merchandisingRequests.length).toBe(2);
    await expect.poll(() => settingsRequests.length).toBe(2);
  });

  test('المنتج رقم 201+ يصل إليه بحث الخادم ويُعرض في الكتالوج', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name === 'mobile-webkit',
      'Mobile search is opened through its dedicated navigation control and is covered by the mobile interaction suite.'
    );
    const catalogRequests: Record<string, unknown>[] = [];
    const regularItem = {
      id: '00000000-0000-4000-8000-000000000001',
      sku: 'NWS-0001',
      barcode: '',
      nameAr: 'منتج الصفحة الأولى',
      description: '',
      categoryId: '00000000-0000-4000-8000-000000000010',
      categoryCode: 'CAT-BEV',
      categoryNameAr: 'مشروبات',
      brandId: '', brandNameAr: '', unitId: '00000000-0000-4000-8000-000000000020',
      unitNameAr: 'حبة', saleUnitId: '00000000-0000-4000-8000-000000000021',
      saleUnitNameAr: 'كرتونة', unitsPerSalePackage: 1,
      salePackagePriceInMinorUnits: 1000, salePriceInMinorUnits: 1000,
      availableQuantity: 10, availableSalePackages: 10, minimumOrderPackages: 1,
      imageUrl: '', isAvailable: true, createdAt: '2026-01-01T00:00:00Z',
      soldPackagesLast90Days: 0, flavorMasterProductId: null, flavorNameAr: null,
      isFlavorMaster: false, flavorSortOrder: 0,
    };
    const product201 = {
      ...regularItem,
      id: '00000000-0000-4000-8000-000000000201',
      sku: 'NWS-0201',
      nameAr: 'منتج الاختبار رقم ٢٠١',
    };

    await page.route('**/rest/v1/rpc/get_public_storefront_catalog_page', async (route) => {
      const requestBody = route.request().postDataJSON() as Record<string, unknown>;
      catalogRequests.push(requestBody);
      const isProduct201Search = requestBody.p_search === 'NWS-0201';
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          items: [isProduct201Search ? product201 : regularItem],
          categories: [{
            id: regularItem.categoryId, code: 'CAT-BEV', nameAr: 'مشروبات',
            imageUrl: '', productCount: 201, availableProductCount: 201,
          }],
          brands: [], saleUnits: [],
          summary: { availableProducts: 201, availableSalePackages: 2010, lowStockProducts: 0 },
          total: isProduct201Search ? 1 : 201,
          limit: 24,
          offset: requestBody.p_offset ?? 0,
        }),
      });
    });

    await page.goto(`${customerBaseUrl}/#catalog`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('منتج الصفحة الأولى')).toBeVisible();

    await page.getByRole('button', { name: 'التالي' }).click();
    await expect.poll(() => catalogRequests.some((request) => request.p_offset === 24)).toBe(true);

    await page.getByPlaceholder(/ابحث باسم المنتج/i).fill('NWS-0201');
    await expect(
      page.getByRole('heading', { name: 'منتج الاختبار رقم ٢٠١', exact: true })
    ).toBeVisible();
    expect(catalogRequests.some((request) => request.p_search === 'NWS-0201')).toBe(true);
  });

  test('يفتح بواجهة عربية ويعرض مسارات التسوق الأساسية', async ({ page }) => {
    await page.goto(customerBaseUrl, { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveTitle(/نواصرة/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByText('نواصرة', { exact: false }).first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'فتح قائمة الأقسام' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'تصفح أصناف الجملة' }).first(),
    ).toBeVisible();
  });

  test('فيديو الواجهة صامت ويستخدم الدقة المناسبة للجهاز', async (
    { page },
    testInfo,
  ) => {
    await page.goto(customerBaseUrl, { waitUntil: 'domcontentloaded' });

    const heroVideo = page.locator(
      testInfo.project.name === 'mobile-webkit'
        ? '[data-testid="mobile-hero-video"] video'
        : '[data-testid="desktop-hero-video"]',
    );
    await expect(heroVideo).toBeAttached();
    const expectedSource =
      testInfo.project.name === 'mobile-webkit'
        ? '/nawasrah-hero-mobile.mp4'
        : '/nawasrah-hero-desktop-1080p.mp4';
    await expect(heroVideo.locator('source')).toHaveAttribute(
      'src',
      expectedSource,
    );
    await expect(heroVideo).toHaveAttribute('preload', 'metadata');
    const inactiveHeroSource =
      testInfo.project.name === 'mobile-webkit'
        ? '/nawasrah-hero-desktop-1080p.mp4'
        : '/nawasrah-hero-mobile.mp4';
    await expect(page.locator(`video source[src="${inactiveHeroSource}"]`)).toHaveCount(0);
    expect(
      await heroVideo.evaluate(
        (element) => (element as HTMLVideoElement).muted,
      ),
    ).toBe(true);

    if (testInfo.project.name !== 'mobile-webkit') {
      await expect
        .poll(
          () =>
            heroVideo.evaluate((element) => {
              const video = element as HTMLVideoElement;
              return { height: video.videoHeight, width: video.videoWidth };
            }),
          { timeout: 20_000 },
        )
        .toEqual({ height: 1080, width: 1920 });
    }
  });

  test('الواجهة الرئيسية لا تغيّر موضع الصفحة تلقائيًا بعد تحميل الـHero', async (
    { page },
    testInfo,
  ) => {
    test.skip(
      testInfo.project.name === 'mobile-chromium',
      'The customer storefront is covered on desktop Chromium and Mobile WebKit.',
    );

    const readViewportState = () =>
      page.evaluate(() => {
        const hero = document.getElementById('top');
        const video = document.querySelector<HTMLVideoElement>(
          '[data-testid="desktop-hero-video"], [data-testid="mobile-hero-video"] video',
        );
        return {
          scrollY: window.scrollY,
          heroHeight: hero?.getBoundingClientRect().height ?? 0,
          videoReadyState: video?.readyState ?? 0,
        };
      });

    await page.goto(customerBaseUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#top')).toBeVisible();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'auto' }));

    const initial = await readViewportState();
    await page.waitForTimeout(20_000);
    const afterIdle = await readViewportState();

    expect(afterIdle.scrollY).toBe(0);
    expect(afterIdle.heroHeight).toBeCloseTo(initial.heroHeight, 1);
    expect(afterIdle.videoReadyState).toBeGreaterThanOrEqual(initial.videoReadyState);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#top')).toBeVisible();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'auto' }));
    await page.waitForTimeout(6_000);

    expect((await readViewportState()).scrollY).toBe(0);
  });

  test('شعار متجر النواصرة ظاهر بدل حرف النون القديم', async ({ page }) => {
    await page.goto(customerBaseUrl);

    const headerLogo = page.locator(
      'header img[src="/nawasrah-store-logo.jpg"]',
    );
    await expect(headerLogo).toBeVisible();
    await expect(headerLogo).toHaveAttribute('alt', '');
  });

  test('واجهة الهاتف تعرض الفيديو والإحصاءات دون تكديس طويل', async ({
    page,
  }, testInfo) => {
    test.skip(!testInfo.project.name.includes('mobile'));
    await page.goto(customerBaseUrl);

    const hero = page.locator('#top');
    const stats = page.locator('[data-testid="hero-stats"] > div');
    await expect(hero).toBeVisible();
    await expect(stats).toHaveCount(3);

    const layout = await stats.evaluateAll((cards) =>
      cards.map((card) => {
        const rect = card.getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width };
      }),
    );
    expect(Math.max(...layout.map((card) => card.top)) - Math.min(...layout.map((card) => card.top))).toBeLessThan(4);
    expect(layout.every((card) => card.width > 80)).toBe(true);
    const videoStage = page.locator('[data-testid="mobile-hero-video"]');
    const stageBox = await videoStage.boundingBox();
    expect(stageBox).not.toBeNull();
    expect(stageBox!.width / stageBox!.height).toBeCloseTo(16 / 9, 1);
    await expect(videoStage.locator('video')).toHaveCSS('object-fit', 'contain');

    const heroBox = await hero.boundingBox();
    expect(heroBox).not.toBeNull();
    expect(heroBox!.height).toBeLessThan(760);
  });

  test('صفحة المنتجات قابلة للوصول وخالية من مخالفات الوصول الخطرة', async ({
    page,
  }) => {
    await page.goto(`${customerBaseUrl}/#catalog`, {
      waitUntil: 'domcontentloaded',
    });

    await expect(page.locator('#catalog')).toBeVisible();
    await expectNoSeriousAccessibilityViolations(page);
  });
});

test.describe('بوابة الإدارة العامة', () => {
  test('ترحّل الحفظ القديم إلى تفضيلات واجهة خفيفة وتثبت بعد إعادة التحميل', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const migrationSeedKey = 'nawasrah_bm_state_v1_migration_seeded';
      if (sessionStorage.getItem(migrationSeedKey)) return;

      localStorage.setItem(
        'nawasrah_bm_state_v1',
        JSON.stringify({
          activeTab: 'products',
          currentUser: { themeMode: 'light' },
          products: [{ id: 'must-not-persist' }],
          orders: [{ id: 'must-not-persist' }],
          customers: [{ id: 'must-not-persist' }],
          inventory: [{ id: 'must-not-persist' }],
        }),
      );
      sessionStorage.setItem(migrationSeedKey, 'true');
    });

    await page.goto(adminBaseUrl, { waitUntil: 'domcontentloaded' });

    const persistedAfterMigration = await page.evaluate(() => {
      const stored = localStorage.getItem('nawasrah_bm_state_v1');
      return stored ? JSON.parse(stored) : null;
    });
    expect(persistedAfterMigration).toEqual({
      version: 1,
      activeTab: 'products',
      themeMode: 'light',
    });

    await page.reload({ waitUntil: 'domcontentloaded' });

    const persistedAfterReload = await page.evaluate(() => {
      const stored = localStorage.getItem('nawasrah_bm_state_v1');
      return stored ? JSON.parse(stored) : null;
    });
    expect(persistedAfterReload).toEqual(persistedAfterMigration);
  });

  test('لا تحمل بيانات العمل قبل اكتمال تسجيل الدخول', async ({ page }) => {
    const businessRequests: string[] = [];
    const protectedBusinessRequests: string[] = [];
    const businessRpcRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/rest/v1/') || url.includes('/storage/v1/object/')) {
        businessRequests.push(url);
      }
      if (url.includes('/rest/v1/rpc/')) {
        businessRpcRequests.push(url);
      }
      if (
        /\/(?:orders|products|customers|inventory_balances|inventory_movements)(?:[/?]|$)/.test(
          url,
        )
      ) {
        protectedBusinessRequests.push(url);
      }
    });

    await page.goto(adminBaseUrl, { waitUntil: 'domcontentloaded' });
    const loginScreen = page
      .getByText(/تسجيل الدخول للنظام|جاري التحقق من جلسة الدخول/)
      .first();
    await expect(loginScreen).toBeVisible({ timeout: 15_000 });

    expect(businessRequests).toEqual([]);
    expect(protectedBusinessRequests).toEqual([]);
    expect(businessRpcRequests).toEqual([]);
  });

  test('تفتح بواجهة عربية محمية دون انهيار', async ({ page }) => {
    await page.goto(adminBaseUrl, { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveTitle(/نواصرة/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('body')).not.toContainText('حدث خطأ غير متوقع');
    await expect(
      page.getByText(/تسجيل الدخول للنظام|جاري التحقق من جلسة الدخول/).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('صفحة الدخول خالية من مخالفات الوصول الخطرة', async ({ page }) => {
    await page.goto(adminBaseUrl, { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByText(/تسجيل الدخول للنظام|جاري التحقق من جلسة الدخول/).first(),
    ).toBeVisible({ timeout: 15_000 });

    await expectNoSeriousAccessibilityViolations(page);
  });
});
