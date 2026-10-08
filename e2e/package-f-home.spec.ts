import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './isolated-test';
import { homeFixture } from './package-f-home.fixture';

const base = process.env.ADMIN_BASE_URL ?? 'http://127.0.0.1:4173';
const url = (query = '') => `${base}/e2e/package-f-home-harness.html?${query}`;

async function assertLayout(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const escaped = await page.getByTestId('dashboard-home').evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const failures: string[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (!node.textContent?.trim() || !parent || parent.closest('.sr-only') || !parent.getClientRects().length) continue;
      const box = parent.closest('p,h1,h2,h3,button,dt,dd,td,th,summary,figcaption,div') ?? parent;
      const bounds = box.getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)) failures.push(node.textContent.trim());
      }
    }
    return failures;
  });
  expect(escaped).toEqual([]);
}

for (const theme of ['light', 'dark']) {
  for (const width of [360, 390, 820, 1440]) {
    test(`Home ${theme} ${width}: accessibility, text containment, layout and touch targets`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1125 });
      await page.goto(url(`theme=${theme}&long`));
      await expect(page.getByRole('heading', { name: 'أهلاً مهدي النواصرة' })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await assertLayout(page);
      await expect(page.getByTestId('dashboard-home')).not.toContainText(/[٠-٩]/);
      const labels = page.locator('[data-chart-amount]');
      await expect(labels).toHaveCount(7);
      for (const label of await labels.all()) {
        expect(await label.innerText()).toMatch(/^-?[\d,]+$/);
        await expect(label).toHaveAttribute('title', /\d\.\d{3} د.أ$/);
        expect(await label.getAttribute('aria-label')).toBe(await label.getAttribute('title'));
        expect(await label.evaluate((element) => {
          const range = document.createRange(); range.selectNodeContents(element);
          return { lines: range.getClientRects().length, whitespace: getComputedStyle(element).whiteSpace };
        })).toEqual({ lines: 1, whitespace: 'nowrap' });
      }
      const accessibility = await new AxeBuilder({ page }).include('[data-testid="dashboard-home"], .admin-app-header').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(accessibility.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }))).toEqual([]);
      const shortButtons = await page.getByTestId('dashboard-home').getByRole('button').evaluateAll((buttons) => buttons.filter((button) => button.getClientRects().length && button.getBoundingClientRect().height < 44).map((button) => button.textContent));
      expect(shortButtons).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`home-${theme}-${width}.png`), fullPage: true });
      await page.getByTestId('home-scroll').evaluate((node) => { node.scrollTop = node.scrollHeight; });
      await assertLayout(page);
    });
  }
}

test('Home actions and period selector preserve existing intent; net is never gross', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url('theme=light'));
  const kpis = page.getByTestId('home-kpis');
  await expect(kpis).toContainText('31,906.250');
  await expect(kpis).not.toContainText('34,006.250');
  await page.getByRole('radio', { name: 'الشهر' }).click();
  await expect(kpis).toContainText('34,006.250');
  await page.getByRole('radio', { name: 'الأسبوع' }).click();
  await expect(kpis).toContainText('7,384.500');
  await page.getByRole('button', { name: 'كل الطلبات' }).click();
  await expect(page.getByTestId('home-action')).toHaveText('orders');
  await page.getByRole('button', { name: 'مراجعة العملاء والذمم' }).click();
  await expect(page.getByTestId('home-action')).toHaveText('accounts');
  await page.getByRole('button', { name: 'إغلاق الوردية', exact: true }).click();
  await expect(page.getByTestId('home-action')).toHaveText('shifts');
  await page.getByRole('button', { name: 'استلام', exact: true }).first().click();
  await expect(page.getByTestId('home-action')).toHaveText('receive_goods:p1');
  await page.getByRole('button', { name: 'ضبط', exact: true }).click();
  await expect(page.getByTestId('home-action')).toHaveText('products');
  await page.getByRole('button', { name: 'تسجيل مصروف' }).click();
  await expect(page.getByTestId('home-action')).toHaveText('add_expense');
});

test('token Header keeps branch, notifications, profile and assistant actions and role gate', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url('theme=light'));
  const header = page.locator('.admin-app-header');
  await expect(header.getByRole('heading', { name: 'النواصرة', exact: true })).toBeVisible();
  const avatar = header.getByRole('img', { name: 'مهدي النواصرة' });
  await expect(avatar).toHaveText('م');
  expect(await avatar.evaluate((element) => element.tagName)).toBe('SPAN');
  const bell = header.getByRole('button', { name: 'الإشعارات', exact: true });
  await expect(bell).toContainText('1');
  await expect(bell.locator('span')).toHaveClass(/bg-nw-accent text-nw-on-accent/);
  await bell.click();
  await expect(page.getByTestId('header-action')).toHaveText('notifications:home:branch-home');
  await header.getByRole('button', { name: 'الملف الشخصي: مهدي النواصرة' }).click();
  await expect(page.getByTestId('header-action')).toHaveText('profile:home:branch-home');
  await header.getByRole('button', { name: 'اختيار الفرع' }).click();
  await header.getByRole('button', { name: 'الفرع الثاني' }).click();
  await expect(header.getByRole('button', { name: 'اختيار الفرع' })).toContainText('الفرع الثاني');
  await expect(page.getByTestId('header-action')).toHaveText('profile:home:branch-second');
  await header.getByRole('button', { name: 'فتح المساعد الإداري الذكي' }).click();
  await expect(page.getByTestId('header-action')).toHaveText('profile:assistant:branch-second');
  await expect(header.getByRole('button', { name: 'فتح المساعد الإداري الذكي' })).toHaveCount(0);
  await page.goto(url('theme=dark&role=cashier'));
  await expect(header.getByRole('button', { name: 'فتح المساعد الإداري الذكي' })).toHaveCount(0);
  await page.goto(url('theme=dark'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(header.getByRole('heading', { name: 'النواصرة', exact: true })).toBeHidden();
  await expect(header.getByRole('button', { name: 'الملف الشخصي: مهدي النواصرة' })).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'القائمة الجانبية' }).getByRole('button', { name: 'الملف الشخصي: مهدي النواصرة' })).toBeVisible();
  await expect(header.getByRole('button', { name: 'فتح المساعد الإداري الذكي' })).toBeHidden();
  await expect(header.getByRole('button', { name: 'الإشعارات', exact: true })).toBeVisible();
});

test('unavailable financial facts and absent shift are explicit, not zeros', async ({ page }) => {
  await page.goto(url('theme=dark&unavailable&noShift'));
  await expect(page.getByTestId('dashboard-home').getByRole('status')).toContainText('الأرقام المالية غير متاحة');
  await expect(page.getByTestId('home-kpis')).not.toContainText('1,284.500');
  await expect(page.getByTestId('home-kpis')).not.toContainText('31,906.250');
  await expect(page.getByTestId('home-kpis')).not.toContainText('8,420.750');
  await expect(page.locator('[aria-labelledby="home-sales-title"]')).toContainText('غير متاح');
  await expect(page.getByRole('button', { name: 'فتح الصندوق والورديات' })).toBeVisible();
});

test('live DashboardView still loads and refreshes the real adapter RPC contract', async ({ page }) => {
  let calls = 0;
  const payload = { ...homeFixture, financialFactsStatus: 'available' };
  await page.route('**/rest/v1/rpc/get_home_dashboard', (route) => { calls++; return route.fulfill({ json: payload }); });
  await page.goto(url('theme=light&live'));
  await expect(page.getByTestId('home-kpis')).toContainText('31,906.250');
  await expect(page.getByTestId('home-kpis')).toContainText('8,420.750');
  expect(calls).toBe(1);
  payload.financialFactsStatus = 'unavailable';
  await page.getByRole('button', { name: 'تحديث مركز اليوم' }).click();
  await expect(page.getByTestId('dashboard-home').getByRole('status')).toContainText('الأرقام المالية غير متاحة');
  await expect(page.getByTestId('home-kpis')).not.toContainText('31,906.250');
  expect(calls).toBe(2);
});
