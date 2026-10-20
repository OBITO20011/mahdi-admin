import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './isolated-test';

const adminBaseUrl =
  process.env.ADMIN_BASE_URL ?? 'http://127.0.0.1:4173';

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  expect(
    results.violations
      .filter(
        (violation) =>
          violation.impact === 'critical' || violation.impact === 'serious',
      )
      .map((violation) => ({
        id: violation.id,
        targets: violation.nodes.map((node) => node.target.join(' ')),
      })),
  ).toEqual([]);
}

test.describe('تنظيم تنقل الإدارة', () => {
  test('يعرض أربع مجموعات وبحثاً ويوجه POS إلى هويته الأصلية', async ({
    page,
  }) => {
    await page.setViewportSize({width:390,height:844});
    await page.setViewportSize({width:390,height:844});
    await page.goto(`${adminBaseUrl}/e2e/admin-navigation-harness.html`, {
      waitUntil: 'domcontentloaded',
    });

    const groups = page.locator('[data-navigation-group]');
    await expect(groups).toHaveCount(4);

    await page.getByRole('searchbox',{name:'ابحث عن شاشة'}).fill('نقطة البيع');
    await page.locator('[data-navigation-id="sales-pos"]').click();
    await expect
      .poll(() =>
        page.evaluate(() => window.__ADMIN_NAVIGATION_TEST_ACTIVE_TAB__()),
      )
      .toBe('pos');

    await expectNoSeriousAccessibilityViolations(page);
  });

  test('يحافظ على بوابة المالك والمساعد للأدوار المقيدة', async ({ page }) => {
    await page.setViewportSize({width:390,height:844});
    await page.goto(
      `${adminBaseUrl}/e2e/admin-navigation-harness.html?role=view_only`,
      { waitUntil: 'domcontentloaded' },
    );

    await expect(
      page.locator('[data-navigation-id="assistant-shortcut"]'),
    ).toHaveCount(0);

    await expect(page.locator('[data-navigation-id="admin-users"]')).toHaveCount(0);
    await expect(page.locator('[data-navigation-id="admin-monitoring"]')).toHaveCount(0);
    await expect(page.locator('[data-navigation-id="admin-go-live"]')).toHaveCount(0);
    await expect(page.locator('[data-navigation-id="profile-summary"]')).toBeVisible();
    await page.locator('[data-navigation-id="profile-summary"]').click();
    await expect
      .poll(() =>
        page.evaluate(() => window.__ADMIN_NAVIGATION_TEST_CURRENT_MODAL__()),
      )
      .toBe('profile');
  });

  test('يعرض لوحة المراقبة للمالك فقط ويربطها بالمودال الصحيح', async ({page}) => {
    await page.setViewportSize({width:390,height:844});
    await page.setViewportSize({width:390,height:844});
    await page.goto(`${adminBaseUrl}/e2e/admin-navigation-harness.html?role=owner`, {
      waitUntil: 'domcontentloaded',
    });
    const monitoring = page.locator('[data-navigation-id="admin-monitoring"]');
    await expect(monitoring).toBeVisible();
    await monitoring.press('Enter');
    await expect.poll(() => page.evaluate(() =>
      window.__ADMIN_NAVIGATION_TEST_CURRENT_MODAL__())).toBe('monitoring_dashboard');
  });

  test('يبقي الأقسام مكشوفة والبحث متاحاً مع تقليل الحركة', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({width:390,height:844});
    await page.setViewportSize({width:390,height:844});
    await page.goto(`${adminBaseUrl}/e2e/admin-navigation-harness.html`, {
      waitUntil: 'domcontentloaded',
    });

    const groups=page.locator('[data-navigation-group]');await expect(groups).toHaveCount(4);
    for(const id of ['sales','products-inventory','finance-reports','administration-store'])await expect(page.locator(`[data-navigation-group="${id}"]`)).toBeVisible();
    await page.getByRole('searchbox',{name:'ابحث عن شاشة'}).fill('التقارير');await expect(page.locator('[data-navigation-id="finance-reports"]')).toBeVisible();
    await expectNoSeriousAccessibilityViolations(page);
  });
});
