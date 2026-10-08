import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './isolated-test';

const adminBaseUrl = process.env.ADMIN_BASE_URL ?? 'http://127.0.0.1:4173';
const harnessUrl = `${adminBaseUrl}/e2e/admin-bottom-navigation-harness.html`;

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
      .map((violation) => violation.id),
  ).toEqual([]);
}

async function readNavigationGeometry(page: Page) {
  return page.evaluate(() => {
    const readRect = (selector: string) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect
        ? { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
        : null;
    };

    return {
      content: readRect('[data-navigation-content]'),
      bottomNavigation: readRect('.admin-bottom-tabs'),
      centreSell: readRect('[data-bottom-tab="pos"] > span'),
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      overflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    };
  });
}

const activeTab = (page: Page) => page.getByTestId('active-tab');

test.describe('شريط تنقل الإدارة السفلي (Package F)', () => {
  test('يطبق ألوان Package F الفاتحة على الشريط وزر البيع دون خفض التباين', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${harnessUrl}?start=more&theme=light&toast=success`, {
      waitUntil: 'domcontentloaded',
    });

    await expect(page.locator('html')).toHaveClass(/theme-light/);
    await expect(page.locator('[data-ui="admin-screen"]')).toHaveCSS(
      'background-color',
      'rgb(247, 248, 250)',
    );
    await expect(page.locator('[data-ui="admin-toast"]')).toHaveCSS(
      'color',
      'rgb(22, 101, 52)',
    );
    await expect(page.locator('.admin-bottom-tabs')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.locator('[data-bottom-tab="more"]')).toHaveCSS('color', 'rgb(19, 41, 75)');
    await expect(page.locator('[data-bottom-tab="pos"] > span')).toHaveCSS(
      'background-color',
      'rgb(226, 115, 31)',
    );
    await expectNoSeriousAccessibilityViolations(page);
  });

  test('يطبق ألوان الوضع الداكن المعتمدة على الشريط مستقلة عن الوضع الفاتح', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${harnessUrl}?start=more&theme=dark&toast=success`, {
      waitUntil: 'domcontentloaded',
    });

    await expect(page.locator('html')).toHaveClass(/theme-dark/);
    await expect(page.locator('[data-ui="admin-screen"]')).toHaveCSS(
      'background-color',
      'rgb(2, 6, 23)',
    );
    const darkToastColor = await page
      .locator('[data-ui="admin-toast"]')
      .evaluate((element) => getComputedStyle(element).color);
    expect(darkToastColor).not.toBe('rgb(22, 101, 52)');
    await expect(page.locator('.admin-bottom-tabs')).toHaveCSS('background-color', 'rgb(18, 27, 46)');
    await expect(page.locator('[data-bottom-tab="more"]')).toHaveCSS('color', 'rgb(240, 138, 60)');
    await expectNoSeriousAccessibilityViolations(page);
  });

  test('يعرض الترتيب المعتمد مع زر البيع في الوسط ويوجه كل تبويب إلى activeTab', async ({
    page,
  }) => {
    await page.goto(`${harnessUrl}?start=home`, {
      waitUntil: 'domcontentloaded',
    });

    const tabs = page.locator('[data-bottom-tab]');
    await expect(tabs).toHaveCount(5);
    await expect(tabs).toHaveText(['الرئيسية', 'الطلبات', 'بيع', 'المخزون', 'المزيد']);
    await expect(page.locator('[data-bottom-tab="home"]')).toHaveAttribute('aria-current', 'page');

    const initialUrl = page.url();
    for (const destination of ['orders', 'pos', 'inventory', 'more'] as const) {
      const tab = page.locator(`[data-bottom-tab="${destination}"]`);
      await tab.press('Enter');
      await expect(activeTab(page)).toHaveText(destination);
      await expect(tab).toHaveAttribute('aria-current', 'page');
      expect(page.url()).toBe(initialUrl);
    }

    await expect(page.locator('[data-navigation-group]')).toHaveCount(6);
    await page.locator('[data-navigation-id="sales-pos"]').click();
    await expect(activeTab(page)).toHaveText('pos');

    const sizes = await tabs.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }),
    );
    expect(sizes.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);
    expect(
      await page.locator('html').evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await expectNoSeriousAccessibilityViolations(page);
  });

  test('العملاء والذمم تُفتح من المزيد وتبقى بعد refresh دون تغيير URL', async ({
    page,
  }) => {
    await page.goto(`${harnessUrl}?start=home`, {
      waitUntil: 'domcontentloaded',
    });
    await page.locator('[data-bottom-tab="more"]').click();
    const customers = page.locator('[data-navigation-group="customers"]');
    await customers.locator('button').first().click();
    await page.locator('[data-navigation-id="customer-accounts"]').click();
    await expect(activeTab(page)).toHaveText('accounts');

    await page.evaluate(() => {
      window.history.replaceState({}, '', '/e2e/admin-bottom-navigation-harness.html');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(activeTab(page)).toHaveText('accounts');
    await expect(page.locator('[data-bottom-tab][aria-current="page"]')).toHaveCount(0);
  });

  test('الاختصارات السريعة السابقة متاحة في المزيد وزر البيع يفتح نقطة البيع', async ({
    page,
  }) => {
    await page.goto(`${harnessUrl}?start=more`, {
      waitUntil: 'domcontentloaded',
    });
    const shortcuts = page.getByRole('region', { name: 'إجراءات سريعة' }).or(
      page.locator('section[aria-label="إجراءات سريعة"]'),
    );
    await expect(shortcuts.locator('button')).toHaveText(['استلام بضاعة', 'مصروف', 'صنف جديد']);
    await page.locator('[data-navigation-id="goods-receipt"]').click();
    expect(await page.evaluate(() => window.__ADMIN_BOTTOM_NAV_MODAL__())).toBe('receive_goods');

    await page.goto(`${harnessUrl}?start=home`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-bottom-tab="pos"]').click();
    await expect(activeTab(page)).toHaveText('pos');
    await expect(page.locator('[data-navigation-id="quick-action-trigger"]')).toHaveCount(0);
    await expectNoSeriousAccessibilityViolations(page);
  });

  test('لا يكشف المساعد أو المستخدمين لدور view_only', async ({ page }) => {
    await page.goto(`${harnessUrl}?start=more&role=view_only`, {
      waitUntil: 'domcontentloaded',
    });

    await expect(page.locator('[data-navigation-group]')).toHaveCount(6);
    await expect(page.locator('[data-navigation-id="assistant-shortcut"]')).toHaveCount(0);
    await page.locator('[data-navigation-group="administration-store"] > button').click();
    await expect(page.locator('[data-navigation-id="admin-users"]')).toHaveCount(0);
  });

  test('لا يتداخل الشريط أو زر البيع المرفوع مع المحتوى في الأحجام الأربعة', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium');

    for (const viewport of [
      { name: 'iPhone', width: 390, height: 844 },
      { name: 'Android صغير', width: 360, height: 640 },
      { name: 'Tablet', width: 768, height: 1024 },
      { name: 'Desktop', width: 1280, height: 900 },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${harnessUrl}?start=more`, { waitUntil: 'domcontentloaded' });

      const geometry = await readNavigationGeometry(page);
      expect(geometry.content, `${viewport.name}: content`).not.toBeNull();
      expect(geometry.bottomNavigation, `${viewport.name}: bottom navigation`).not.toBeNull();
      expect(geometry.centreSell, `${viewport.name}: centre sell`).not.toBeNull();
      expect(geometry.content!.bottom).toBeLessThanOrEqual(geometry.bottomNavigation!.top + 1);
      expect(geometry.centreSell!.top, `${viewport.name}: sell visible`).toBeGreaterThanOrEqual(0);
      expect(geometry.centreSell!.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
      expect(geometry.bottomNavigation!.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
      expect(geometry.overflow, `${viewport.name}: overflow`).toBeLessThanOrEqual(0);
    }
  });
});
