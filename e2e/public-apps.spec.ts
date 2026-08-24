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
  test('يفتح بواجهة عربية ويعرض مسارات التسوق الأساسية', async ({ page }) => {
    await page.goto(customerBaseUrl, { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveTitle(/نواصرة/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByText('نواصرة', { exact: false }).first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'فتح قائمة الأقسام' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'عرض جميع المنتجات' }).first(),
    ).toBeVisible();
  });

  test('فيديو الواجهة صامت ويستخدم الدقة المناسبة للجهاز', async (
    { page },
    testInfo,
  ) => {
    await page.goto(customerBaseUrl, { waitUntil: 'domcontentloaded' });

    const heroVideo = page.locator('#top video');
    await expect(heroVideo).toBeAttached();
    await expect
      .poll(() =>
        heroVideo.evaluate((element) => {
          const video = element as HTMLVideoElement;
          return {
            currentSrc: video.currentSrc,
            muted: video.muted,
            videoHeight: video.videoHeight,
            videoWidth: video.videoWidth,
          };
        }),
      )
      .toEqual(
        testInfo.project.name === 'mobile-webkit'
          ? {
              currentSrc: `${customerBaseUrl}/nawasrah-hero-mobile.mp4`,
              muted: true,
              videoHeight: 1080,
              videoWidth: 1920,
            }
          : {
              currentSrc: `${customerBaseUrl}/nawasrah-hero-4k.mp4`,
              muted: true,
              videoHeight: 2160,
              videoWidth: 3840,
            },
      );
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
    await expect(hero.locator('video')).toHaveCSS('object-fit', 'cover');
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
