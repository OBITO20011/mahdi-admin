import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

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
        ? {
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }
        : null;
    };

    return {
      content: readRect('[data-navigation-content]'),
      dock: readRect('[data-navigation-action-dock]'),
      quickAction: readRect('[data-navigation-id="quick-action-trigger"]'),
      bottomNavigation: readRect('.admin-bottom-tabs'),
      overflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    };
  });
}

test.describe('شريط تنقل الإدارة السفلي', () => {
  test('يعرض الترتيب النهائي ويوجه كل تبويب إلى activeTab الحالي', async ({
    page,
  }) => {
    await page.goto(`${harnessUrl}?start=home`, {
      waitUntil: 'domcontentloaded',
    });

    const tabs = page.locator('[data-bottom-tab]');
    await expect(tabs).toHaveCount(5);
    await expect(tabs).toHaveText([
      'الرئيسية',
      'الطلبات',
      'المخزون',
      'العملاء',
      'المزيد',
    ]);
    await expect(page.locator('[data-bottom-tab="home"]')).toHaveAttribute(
      'aria-current',
      'page',
    );

    const initialUrl = page.url();
    for (const [destination, testId] of [
      ['orders', 'orders'],
      ['inventory', 'inventory'],
      ['accounts', 'accounts'],
      ['more', 'more'],
    ] as const) {
      const tab = page.locator(`[data-bottom-tab="${testId}"]`);
      await tab.press('Enter');
      await expect(page.getByTestId('active-tab')).toHaveText(destination);
      await expect(tab).toHaveAttribute('aria-current', 'page');
      expect(page.url()).toBe(initialUrl);
    }

    await expect(page.locator('[data-navigation-group]')).toHaveCount(6);
    await page.locator('[data-navigation-id="sales-pos"]').click();
    await expect(page.getByTestId('active-tab')).toHaveText('pos');

    const sizes = await tabs.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }),
    );
    expect(sizes.every(({ width, height }) => width >= 44 && height >= 44)).toBe(
      true,
    );
    expect(
      await page.locator('html').evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await expectNoSeriousAccessibilityViolations(page);
  });

  test('يحفظ تبويب العملاء بعد refresh دون تغيير URL أو history', async ({
    page,
  }) => {
    await page.goto(`${harnessUrl}?start=home`, {
      waitUntil: 'domcontentloaded',
    });
    await page.locator('[data-bottom-tab="accounts"]').click();
    await expect(page.getByTestId('active-tab')).toHaveText('accounts');

    await page.evaluate(() => {
      window.history.replaceState({}, '', '/e2e/admin-bottom-navigation-harness.html');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('active-tab')).toHaveText('accounts');
    await expect(page.locator('[data-bottom-tab="accounts"]')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('يبقي Quick Action وPOS قابلين للوصول خارج الشريط السفلي', async ({
    page,
  }) => {
    await page.goto(`${harnessUrl}?start=home`, {
      waitUntil: 'domcontentloaded',
    });

    const trigger = page.locator('[data-navigation-id="quick-action-trigger"]');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('عملية جديدة')).toBeVisible();
    await expectNoSeriousAccessibilityViolations(page);
    await page.getByRole('button', { name: 'إغلاق العمليات السريعة' }).click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await trigger.click();
    await page.getByText('إنشاء فاتورة بيع (POS)').click();
    await expect(page.getByTestId('active-tab')).toHaveText('pos');
  });

  test('لا يكشف المساعد أو المستخدمين لدور view_only', async ({ page }) => {
    await page.goto(`${harnessUrl}?start=more&role=view_only`, {
      waitUntil: 'domcontentloaded',
    });

    await expect(page.locator('[data-navigation-group]')).toHaveCount(6);
    await expect(
      page.locator('[data-navigation-id="assistant-shortcut"]'),
    ).toHaveCount(0);
    await page
      .locator('[data-navigation-group="administration-store"] > button')
      .click();
    await expect(page.locator('[data-navigation-id="admin-users"]')).toHaveCount(
      0,
    );
  });

  test('لا يتداخل Action Dock مع المحتوى أو الشريط في الأحجام الأربعة', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium');

    for (const viewport of [
      { name: 'iPhone', width: 390, height: 844 },
      { name: 'Android صغير', width: 360, height: 640 },
      { name: 'Tablet', width: 768, height: 1024 },
      { name: 'Desktop', width: 1280, height: 900 },
    ]) {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await page.goto(`${harnessUrl}?start=more`, {
        waitUntil: 'domcontentloaded',
      });

      const geometry = await readNavigationGeometry(page);
      expect(geometry.content, `${viewport.name}: content`).not.toBeNull();
      expect(geometry.dock, `${viewport.name}: dock`).not.toBeNull();
      expect(geometry.quickAction, `${viewport.name}: quick action`).not.toBeNull();
      expect(
        geometry.bottomNavigation,
        `${viewport.name}: bottom navigation`,
      ).not.toBeNull();
      expect(geometry.content!.bottom).toBeLessThanOrEqual(
        geometry.dock!.top + 1,
      );
      expect(geometry.quickAction!.top).toBeGreaterThanOrEqual(
        geometry.dock!.top,
      );
      expect(geometry.quickAction!.bottom).toBeLessThanOrEqual(
        geometry.dock!.bottom,
      );
      expect(geometry.dock!.bottom).toBeLessThanOrEqual(
        geometry.bottomNavigation!.top + 1,
      );
      expect(geometry.overflow, `${viewport.name}: overflow`).toBeLessThanOrEqual(
        0,
      );
    }
  });
});
