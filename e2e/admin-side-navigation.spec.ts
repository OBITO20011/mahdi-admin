import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './isolated-test';

const adminBaseUrl = process.env.ADMIN_BASE_URL ?? 'http://127.0.0.1:4173';
const harnessUrl = `${adminBaseUrl}/e2e/admin-side-navigation-harness.html`;

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .include('[data-side-nav-root]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations
      .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
      .map((violation) => violation.id),
  ).toEqual([]);
}

const activeTab = (page: Page) => page.evaluate(() => window.__ADMIN_SIDE_NAV_ACTIVE_TAB__());

test.describe('القائمة الجانبية لسطح المكتب', () => {
  test('تعرض الهوية الفاتحة وتنقل إلى الوجهات والاختصارات دون تمرير أفقي', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto(`${harnessUrl}?theme=light&start=home`, { waitUntil: 'domcontentloaded' });

    const nav = page.getByRole('navigation', { name: 'القائمة الجانبية' });
    await expect(nav).toBeVisible();
    await expect(nav).toHaveCSS('background-color', 'rgb(19, 41, 75)');
    expect((await nav.boundingBox())?.width).toBe(264);
    await expect(page.locator('[data-side-nav="home"]')).toHaveAttribute('aria-current', 'page');

    await page.locator('[data-side-nav="orders"]').click();
    expect(await activeTab(page)).toBe('orders');
    await expect(page.locator('[data-side-nav="orders"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-side-nav="orders"]')).toContainText('6');

    await page.locator('[data-side-nav-action="goods-receipt"]').click();
    expect(await page.evaluate(() => window.__ADMIN_SIDE_NAV_MODAL__())).toBe('receive_goods');

    await page.locator('[data-side-nav="more"]').click();
    expect(await activeTab(page)).toBe('more');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
    await expectNoSeriousAccessibilityViolations(page);
  });

  test('تحافظ على الوضع الداكن المعتمد وأهداف لمس لا تقل عن 40px', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.goto(`${harnessUrl}?theme=dark&start=orders`, { waitUntil: 'domcontentloaded' });
    const nav = page.getByRole('navigation', { name: 'القائمة الجانبية' });
    await expect(nav).toHaveCSS('background-color', 'rgb(8, 14, 26)');
    const heights = await nav.locator('button').evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().height),
    );
    expect(heights.length).toBeGreaterThan(10);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(40);
    await expectNoSeriousAccessibilityViolations(page);
  });

  test('نقطة البيع تطوي القائمة إلى شريط أيقونات مسمّى', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto(`${harnessUrl}?theme=light&start=pos`, { waitUntil: 'domcontentloaded' });
    const nav = page.getByRole('navigation', { name: 'القائمة الجانبية' });
    expect((await nav.boundingBox())?.width).toBe(76);
    await expect(page.locator('[data-side-nav-action="pos-sale"]')).toHaveCount(0);
    const unnamed = await nav.locator('button').evaluateAll((buttons) =>
      buttons.filter((button) => !(button.getAttribute('aria-label') || '').trim()).length,
    );
    expect(unnamed).toBe(0);
    await page.locator('[data-side-nav="home"]').click();
    expect(await activeTab(page)).toBe('home');
    expect((await nav.boundingBox())?.width).toBe(264);
  });

  test('لا تظهر عناصر المالك لغيره، وتختفي القائمة على الهاتف', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto(`${harnessUrl}?theme=light&role=cashier`, { waitUntil: 'domcontentloaded' });
    for (const id of ['parcel-configuration', 'admin-users', 'admin-monitoring']) {
      await expect(page.locator(`[data-side-nav-item="${id}"]`)).toHaveCount(0);
    }
    await expect(page.locator('[data-side-nav="assistant"]')).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('navigation', { name: 'القائمة الجانبية' })).toBeHidden();
  });
});
