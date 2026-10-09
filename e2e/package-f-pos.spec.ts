import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './isolated-test';
import { posFixtureIds, posFixtureProducts, posFixtureParcel } from './package-f-pos.fixture';

const url = (query = '') => `/e2e/package-f-pos-harness.html?${query}`;
const submit = (page: Page) => page.locator('[data-testid="pos-complete-sale"]:visible');
const product = (page: Page, index: number) => page.locator(`[data-pos-product-card="${posFixtureProducts[index].id}"]`);
async function layout(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByTestId('pos-workbench')).not.toContainText(/[٠-٩]/);
  const overflow = await page.getByTestId('pos-workbench').evaluate(root => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const escaped: string[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode; const parent = node.parentElement;
      if (!parent || !node.textContent?.trim() || parent.closest('.sr-only,style') || !parent.getClientRects().length) continue;
      const box = parent.closest('p,h1,h2,h3,h4,h5,button,summary,div,span') ?? parent;
      const bounds = box.getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(node);
      for (const rect of range.getClientRects()) if (rect.width && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)) escaped.push(node.textContent.trim());
    }
    return escaped;
  });
  expect(overflow).toEqual([]);
}
async function axe(page: Page) {
  const result = await new AxeBuilder({ page }).include('[data-testid="pos-workbench"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => ({ id: v.id, nodes: v.nodes.map(node => node.target) }))).toEqual([]);
}
for (const theme of ['light', 'dark']) for (const width of [390, 820, 1440]) {
  test(`POS ${theme} ${width}: real controller fixture,token layout,Latin digits,axe and checkout visibility`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width < 1024 ? 844 : 1125 });
    await page.goto(url(`theme=${theme}`));
    await expect(product(page, 0)).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await product(page, 0).click();
    await expect(submit(page)).toHaveCount(1);
    await expect(submit(page)).toBeEnabled();
    await expect(submit(page)).toContainText('21.600');
    await layout(page); await axe(page);
    if (width < 1024) {
      await expect(submit(page)).toBeInViewport();
      await page.getByTestId('pos-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expect(submit(page)).toBeInViewport();
      const bounds = (await submit(page).boundingBox())!;
      expect(bounds.y).toBeGreaterThan(0); expect(bounds.y + bounds.height).toBeLessThan(844 - 78);
      await page.getByRole('button', { name: 'مراجعة السلة والعميل', exact: true }).click();
      const panel = page.getByRole('dialog', { name: 'سلة المبيعات الحالية (1)' });
      await expect(panel).toBeInViewport(); await expect(submit(page)).toBeInViewport();
      await expect(panel.getByRole('combobox', { name: 'اختيار العميل' })).toBeVisible();
      await expect(panel).not.toContainText('الدين الحالي');
      await layout(page); await axe(page);
      await panel.getByRole('button', { name: 'رجوع للبيع' }).click();
      await expect(page.getByRole('button', { name: 'مراجعة السلة والعميل' })).toBeFocused();
      await expect(submit(page)).toBeInViewport();
    } else {
      await expect(page.getByTestId('pos-cart-panel')).toBeVisible();
      await expect(page.getByTestId('pos-sticky-checkout')).not.toBeVisible();
      await expect(page.locator('[data-side-nav-action="pos-sale"]')).not.toBeVisible();
    }
    await page.screenshot({ path: info.outputPath(`pos-${theme}-${width}.png`), fullPage: true });
  });
}
test('POS existing three line modes send the exact typed request;no Card tender or added financial reads', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests: Record<string, unknown>[] = [];
  await page.route('**/rest/v1/rpc/create_pos_sale_v2', async route => { requests.push(route.request().postDataJSON()); await route.abort('failed'); });
  await page.goto(url('theme=dark'));
  await product(page, 0).click();
  await page.getByRole('radio', { name: 'باكيت', exact: true }).click();
  await product(page, 1).click();
  await page.getByRole('radio', { name: 'طرد مشكّل', exact: true }).click();
  await page.getByRole('button', { name: 'تركيب طرد: طرد شيبس مشكّل', exact: true }).click();
  const builder = page.getByRole('dialog', { name: 'تركيب طرد: طرد شيبس مشكّل' });
  await builder.getByLabel('كمية عينة').fill('10'); await builder.getByLabel('كمية شطة').fill('20');
  await builder.getByRole('button', { name: 'إضافة الطرد المكتمل' }).click();
  await expect(submit(page)).toContainText('30.850');
  await expect(page.getByRole('radio', { name: /فيزا|بطاقة/ })).toHaveCount(0);
  await submit(page).click(); await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toEqual({ p_warehouse_id: posFixtureIds.warehouse, p_branch_id: posFixtureIds.branch,
    p_customer_id: null, p_customer_name: 'زبون نقدي', p_payment_method: 'cash',
    p_lines: [{ commercial_line_kind: 'legacy_single_sku_parcel', product_id: posFixtureProducts[0].id, parcel_quantity: 1, units_per_parcel: 24 },
      { commercial_line_kind: 'base_unit', product_id: posFixtureProducts[1].id, base_quantity: 1 },
      { commercial_line_kind: 'configurable_parcel', family_product_id: posFixtureParcel.familyProductId,
        parcel_configuration_id: posFixtureIds.configuration, configuration_revision: 3,
        parcel_instances: [{ components: [{ product_id: posFixtureProducts[2].id, base_quantity: 10 }, { product_id: posFixtureProducts[3].id, base_quantity: 20 }] }] }],
    p_discount_in_minor_units: 0, p_amount_received_in_minor_units: 30850, p_idempotency_key: expect.stringMatching(/^pos-v2:[a-f0-9]{64}$/) });
  const pending = await page.evaluate(() => JSON.parse(localStorage.getItem('nawasrah:pos-v2:attempt:v1:11111111-1111-4111-8111-111111111111')!));
  expect(requests[0].p_idempotency_key).toBe(pending.request.idempotencyKey);
});
test('POS sticky checkout still gates missing shift and keeps the existing shift destination', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 844 });
  let writes = 0;
  await page.route('**/rest/v1/rpc/create_pos_sale_v2', async route => { writes += 1; await route.abort('failed'); });
  await page.goto(url('closed'));
  await product(page, 0).click();
  await expect(submit(page)).toHaveText('فتح وردية للمتابعة');
  await submit(page).click(); expect(writes).toBe(0);
  const active = await page.evaluate(async () => {
    const path = '/src/stores/useAppStore.ts';
    return (await import(/* @vite-ignore */ path)).storeEngine.getState().activeTab;
  });
  expect(active).toBe('shifts');
});
test('POS unknown result reload uses only RECOVER_EXISTING with the original request/key', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests: Record<string, unknown>[] = [];
  await page.route('**/rest/v1/rpc/create_pos_sale_v2', async route => { requests.push(route.request().postDataJSON()); await route.abort('failed'); });
  await page.goto(url()); await product(page, 0).click(); await submit(page).click();
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('nawasrah:pos-v2:attempt:v1:11111111-1111-4111-8111-111111111111') ?? 'null'));
  await expect.poll(async () => (await state())?.status).toBe('OUTCOME_UNKNOWN');
  const before = await state(); await page.reload();
  await expect(product(page, 0)).toBeDisabled();
  await page.getByRole('button', { name: 'استرجاع محاولة البيع', exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  await expect.poll(async () => (await state())?.status).toBe('OUTCOME_UNKNOWN');
  expect((await state()).request).toEqual(before.request); expect(requests[1]).toEqual(requests[0]);
});
