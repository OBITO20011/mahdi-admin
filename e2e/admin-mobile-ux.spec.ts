import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const adminBaseUrl =
  process.env.ADMIN_BASE_URL ?? 'http://127.0.0.1:4173';

async function expectNoOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    )
    .toBe(true);
}

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  expect(
    results.violations
      .filter(
        (violation) =>
          violation.impact === 'critical' || violation.impact === 'serious'
      )
      .map((violation) => ({
        id: violation.id,
        targets: violation.nodes.map((node) => node.target.join(' ')),
      }))
  ).toEqual([]);
}

for (const viewport of [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1280, height: 900 },
]) {
  test(`inventory remains compact without overflow at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(`${adminBaseUrl}/e2e/admin-mobile-ux-harness.html`, {
      waitUntil: 'domcontentloaded',
    });

    const cards = page.locator('[data-inventory-product-card]');
    await expect(cards).toHaveCount(4);
    const card = cards.first();
    await expect(card.getByText('المتاح في المخزون')).toBeVisible();
    await expectNoOverflow(page);

    if (viewport.width <= 430) {
      const firstBox = await cards.nth(0).boundingBox();
      const secondBox = await cards.nth(1).boundingBox();
      expect(firstBox).not.toBeNull();
      expect(secondBox).not.toBeNull();
      expect(Math.abs((firstBox?.y ?? 0) - (secondBox?.y ?? 0))).toBeLessThan(2);
      expect(firstBox?.width ?? viewport.width).toBeLessThan(viewport.width / 2);
    }

    for (const label of ['استلام', 'جرد']) {
      const box = await card.getByRole('button', { name: label }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
}

for (const viewport of [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  test(`product catalog uses two compact columns at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(
      `${adminBaseUrl}/e2e/admin-mobile-ux-harness.html?view=products`,
      { waitUntil: 'domcontentloaded' }
    );

    const cards = page.locator('[data-product-catalog-card]');
    await expect(cards).toHaveCount(4);
    const firstBox = await cards.nth(0).boundingBox();
    const secondBox = await cards.nth(1).boundingBox();
    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();
    expect(Math.abs((firstBox?.y ?? 0) - (secondBox?.y ?? 0))).toBeLessThan(2);
    expect(firstBox?.width ?? viewport.width).toBeLessThan(viewport.width / 2);
    await expectNoOverflow(page);

    for (const label of ['التفاصيل', 'تعديل']) {
      const box = await cards.nth(0).getByRole('button', { name: label }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
}

test('compact product cards preserve actions and accessibility', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    `${adminBaseUrl}/e2e/admin-mobile-ux-harness.html?view=products`,
    { waitUntil: 'domcontentloaded' }
  );

  const firstCard = page.locator('[data-product-catalog-card]').first();
  await firstCard.getByRole('button', { name: 'تعديل' }).click();
  await expect.poll(() => page.evaluate(() => window.__ADMIN_MOBILE_UX_MODAL__())).toBe('edit_product');
  await expectNoSeriousAccessibilityViolations(page);
});

test('flavor master shows a compact read-only family stock summary', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    `${adminBaseUrl}/e2e/admin-mobile-ux-harness.html?view=products`,
    { waitUntil: 'domcontentloaded' }
  );

  const familyCard = page.locator(
    '[data-product-catalog-card="product-flavor-master-mobile-ux"]'
  );
  await expect(familyCard.getByText('إجمالي المتاح في النكهات')).toBeVisible();
  await expect(familyCard.getByText(/8 كراتين/)).toBeVisible();
  await familyCard.getByRole('button', { name: /٢ نكهات/ }).click();
  await expect(familyCard.getByText(/تفاح/)).toBeVisible();
  await expect(familyCard.getByText(/فراولة/)).toBeVisible();
  await expectNoOverflow(page);
  await expectNoSeriousAccessibilityViolations(page);
});

test('flavor details separate on-hand, reserved and available family totals', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    `${adminBaseUrl}/e2e/admin-mobile-ux-harness.html?view=flavor-detail`,
    { waitUntil: 'domcontentloaded' }
  );

  await expect(page.getByText('إجمالي مخزون النكهات')).toBeVisible();
  await expect(page.getByText('محسوب للعرض فقط من أرصدة النكهات المستقلة')).toBeVisible();
  const stockSummary = page.locator('[data-flavor-family-stock-summary="true"]');
  await expect(stockSummary.getByText(/10 كراتين/)).toBeVisible();
  await expect(stockSummary.getByText(/2 كرتونة/)).toBeVisible();
  await expect(stockSummary.getByText(/8 كراتين/)).toBeVisible();
  await expectNoOverflow(page);
  await expectNoSeriousAccessibilityViolations(page);
});

test('inventory secondary data and actions stay reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${adminBaseUrl}/e2e/admin-mobile-ux-harness.html`, {
    waitUntil: 'domcontentloaded',
  });

  const card = page.locator('[data-inventory-product-card]').first();
  const compactBox = await card.boundingBox();
  await card.getByText('تفاصيل المنتج والرصيد').click();
  const expandedBox = await card.boundingBox();
  expect(expandedBox?.width ?? 0).toBeGreaterThan((compactBox?.width ?? 0) * 1.8);
  await expect(card.getByText(/6251234567890/)).toBeVisible();
  await expect(card.getByText(/طرد الشراء: كرتونة × 30/)).toBeVisible();
  await expect(card.getByText(/طرد البيع: شرنك × 6/)).toBeVisible();

  await card.getByText('سجل الحركات وإدارة الرصيد').click();
  await expect(card.getByRole('button', { name: /سجل الحركات/ })).toBeVisible();
  await expect(card.getByRole('button', { name: /حذف الرصيد/ })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});

test('orders lead with historical product contents and keep the reference secondary', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    `${adminBaseUrl}/e2e/admin-mobile-ux-harness.html?view=orders`,
    { waitUntil: 'domcontentloaded' }
  );

  await expect(page.locator('[data-order-card]')).toHaveCount(2);
  await expect(page.getByText('عصير فراولة طبيعي + صنفان إضافيان')).toBeVisible();
  await expect(page.getByText('بيبسي 1 لتر')).toBeVisible();
  await expect(page.getByText('ORD-20260909-80582')).toBeVisible();
  await expectNoOverflow(page);
  await expectNoSeriousAccessibilityViolations(page);
});
