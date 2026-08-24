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
