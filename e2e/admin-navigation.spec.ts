import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

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
  test('يعرض ست مجموعات ويفتح Accordion واحدًا ويوجه POS إلى هويته الأصلية', async ({
    page,
  }) => {
    await page.goto(`${adminBaseUrl}/e2e/admin-navigation-harness.html`, {
      waitUntil: 'domcontentloaded',
    });

    const groups = page.locator('[data-navigation-group]');
    await expect(groups).toHaveCount(6);

    const sales = page.locator('[data-navigation-group="sales"] > button');
    const inventory = page.locator(
      '[data-navigation-group="products-inventory"] > button',
    );
    await expect(sales).toHaveAttribute('aria-expanded', 'true');
    await expect(inventory).toHaveAttribute('aria-expanded', 'false');

    await inventory.press('Enter');
    await expect(sales).toHaveAttribute('aria-expanded', 'false');
    await expect(inventory).toHaveAttribute('aria-expanded', 'true');

    await inventory.click();
    await expect(inventory).toHaveAttribute('aria-expanded', 'false');

    await sales.click();
    await page.locator('[data-navigation-id="sales-pos"]').click();
    await expect
      .poll(() =>
        page.evaluate(() => window.__ADMIN_NAVIGATION_TEST_ACTIVE_TAB__()),
      )
      .toBe('pos');

    await expectNoSeriousAccessibilityViolations(page);
  });

  test('يحافظ على بوابة المالك والمساعد للأدوار المقيدة', async ({ page }) => {
    await page.goto(
      `${adminBaseUrl}/e2e/admin-navigation-harness.html?role=view_only`,
      { waitUntil: 'domcontentloaded' },
    );

    await expect(
      page.locator('[data-navigation-id="assistant-shortcut"]'),
    ).toHaveCount(0);

    const administration = page.locator(
      '[data-navigation-group="administration-store"] > button',
    );
    await administration.click();
    await expect(page.locator('[data-navigation-id="admin-users"]')).toHaveCount(0);
    await expect(page.locator('[data-navigation-id="admin-profile"]')).toBeVisible();
    await page.locator('[data-navigation-id="admin-profile"]').click();
    await expect
      .poll(() =>
        page.evaluate(() => window.__ADMIN_NAVIGATION_TEST_CURRENT_MODAL__()),
      )
      .toBe('profile');
  });

  test('يفتح كل مجموعة وحدها ويحترم reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${adminBaseUrl}/e2e/admin-navigation-harness.html`, {
      waitUntil: 'domcontentloaded',
    });

    const groupIds = [
      'sales',
      'products-inventory',
      'customers',
      'suppliers-purchases',
      'finance-reports',
      'administration-store',
    ];

    for (const groupId of groupIds) {
      const trigger = page.locator(`[data-navigation-group="${groupId}"] > button`);
      if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
        await trigger.press('Enter');
      }
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await expect(
        page.locator('[data-navigation-group] > button[aria-expanded="true"]'),
      ).toHaveCount(1);
    }

    await expectNoSeriousAccessibilityViolations(page);
  });
});
