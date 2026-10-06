import {test, expect} from './isolated-test';

const url = '/e2e/phase6-package-b-harness.html';
const context = {
  contractVersion: 403, supported: true, capability: 'phase43_modern',
  order: {id: '66660000-0000-4000-8000-000000000002', orderNumber: 'P6-B', withinWindow: true, deadlineAt: '2026-10-08T08:00:00Z'},
  financial: {merchandiseDebtInMinorUnits: 0, refundableCollectedInMinorUnits: 5000, deliveryFeeInMinorUnits: 0},
  baseItems: [{orderItemId: 'base-root', productId: 'juice', quantity: 5, remainingQuantity: 5,
    physicalRepresentatives: [
      {sourceKind: 'base_order_item', sourceId: 'a', productId: 'juice', remainingQuantity: 2, parentReplacementItemId: null},
      {sourceKind: 'replacement_item', sourceId: 'b', productId: 'juice', remainingQuantity: 3, parentReplacementItemId: 'prior'},
    ]}],
  parcelInstances: [{orderItemId: 'parcel-root', parcelInstanceId: 'parcel', components: [
    {parcelComponentId: 'component', productId: 'juice', quantity: 3, physicalRepresentatives: [
      {sourceKind: 'replacement_item', sourceId: 'leaf', productId: 'juice', remainingQuantity: 3, parentReplacementItemId: 'old-leaf'},
    ]},
  ]}], returns: [], replacements: [
    {operationalStatus: 'issued', issuedAt: '2026-10-01T10:00:00Z', items: [
      {replacementItemId: 'prior', parentReplacementItemId: null, rootOrderItemId: 'base-root'},
    ]},
    {operationalStatus: 'issued', issuedAt: '2026-10-02T10:00:00Z', items: [
      {replacementItemId: 'b', parentReplacementItemId: 'prior', rootOrderItemId: 'base-root'},
    ]},
  ],
};
test.beforeEach(async ({page}) => {
  await page.route('**/rest/v1/rpc/get_admin_sales_aftercare_context_v1', route => route.fulfill({json: context}));
});
test('partial return sends selected quantity and exact current source allocation; invalid quantities send nothing', async ({page}) => {
  let calls = 0;
  let payload: Record<string, unknown> | null = null;
  await page.route('**/rest/v1/rpc/settle_admin_sales_return_v1', route => {
    calls++; payload = route.request().postDataJSON();
    return route.fulfill({status: 400, json: {code: 'P0001', message: 'PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED'}});
  });
  await page.goto(url);
  await expect(page.getByText('عصير فراولة · المتبقي 5 وحدة')).toBeVisible();
  await page.getByRole('button', {name: 'مرتجع', exact: true}).click();
  await page.getByPlaceholder('سبب المرتجع', {exact: true}).fill('مرتجع اختبار');
  await page.getByLabel('كمية المرتجع', {exact: true}).fill('6');
  await page.getByRole('button', {name: 'اعتماد المرتجع'}).click();
  await expect(page.getByTestId('notice')).toContainText('اختر كمية صحيحة');
  expect(calls).toBe(0);
  await page.getByLabel('كمية المرتجع', {exact: true}).fill('3');
  await page.getByRole('button', {name: 'اعتماد المرتجع'}).click();
  await expect.poll(() => calls).toBe(1);
  expect((payload!.p_items as Array<{quantity: number}>)[0].quantity).toBe(3);
  expect((payload!.p_physical_sources as Array<{source_id: string; quantity: number}>).map(row => [row.source_id, row.quantity])).toEqual([['a', 2], ['b', 1]]);
  await expect(page.getByTestId('notice')).toContainText('الكمية المتبقية');
  await expect(page.getByTestId('notice')).not.toContainText('PHASE4_');
});
test('parcel names, three-bucket totals and whole-parcel boundary remain explicit', async ({page}) => {
  await page.goto(url);
  await page.getByRole('button', {name: 'مرتجع الطرد', exact: true}).click();
  await expect(page.getByText('عصير برتقال · 3 وحدة')).toBeVisible();
  await expect(page.getByLabel('كمية المرتجع', {exact: true})).toHaveCount(0);
  const leaf = page.locator('div').filter({has: page.getByText('القطعة الحالية 1 · بديل صادر · 3 وحدة', {exact: true})}).filter({has: page.getByText('مجموع التصنيف: 3 / 3', {exact: true})}).last();
  await expect(leaf.getByRole('spinbutton')).toHaveCount(3);
  await leaf.getByRole('spinbutton').first().fill('1');
  await expect(page.getByText('مجموع التصنيف: 1 / 3', {exact: true})).toBeVisible();
  for (const input of await leaf.getByRole('spinbutton').all()) {
    expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});
test('desktop/tablet expand; mobile shell dimensions and selectable operational identity remain', async ({page}, testInfo) => {
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({width, height: 900});
    await page.goto(url);
    const screen = page.locator('[data-ui="admin-screen"]');
    await expect(screen).toBeVisible();
    const box = (await screen.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(width < 768 ? width - 1 : width - 40);
    expect(box.height).toBeGreaterThanOrEqual(width < 768 ? 899 : 865);
    await expect(page.getByText('9:41', {exact: true})).toHaveCount(0);
    expect(await page.getByTestId('selectable-identity').evaluate(node => getComputedStyle(node).userSelect)).not.toBe('none');
    if (width >= 768) await expect(page.getByText('المالك', {exact: true}).last()).toBeVisible();
    else await expect(page.getByText('المالك', {exact: true}).last()).toBeHidden();
    await page.screenshot({path: testInfo.outputPath(`shell-${width}.png`)});
  }
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto(`${url}?preview=phone`);
  await expect(page.getByText('9:41', {exact: true})).toBeVisible();
  expect((await page.locator('[data-ui="admin-screen"]').boundingBox())!.width).toBeLessThanOrEqual(420);
});

test('mixed cart shows parcels and base units separately without changing the lines', async ({page}) => {
  await page.goto(`${url}?kind=cart`);
  const summary = `${(2).toLocaleString('ar-JO')} طرد • ${(3).toLocaleString('ar-JO')} وحدة أساسية`;
  await expect(page.getByText(summary, {exact: true}).first()).toBeVisible();
  await expect(page.getByText('وحدة العصير', {exact: true})).toBeVisible();
  await expect(page.getByText('طرد العصير', {exact: true})).toBeVisible();
  await expect(page.getByText(`${(5).toLocaleString('ar-JO')} طرد`, {exact: true})).toHaveCount(0);
});

test('translated connection failure still exposes same-attempt recovery immediately', async ({page}) => {
  await page.route('**/rest/v1/rpc/settle_sales_replacement_v1', route => route.abort('failed'));
  await page.goto(url);
  await page.getByRole('button', {name: 'استبدال وحدة', exact: true}).click();
  await page.getByPlaceholder('سبب العيب/الاستبدال').fill('عيب مصنعي');
  await page.getByRole('button', {name: 'اعتماد الاستبدال', exact: true}).click();
  await expect(page.getByTestId('notice')).toContainText(/المحاولة السابقة|نفس المحاولة/);
  await expect(page.getByRole('button', {name: 'استعادة الاستبدال', exact: true})).toBeVisible();
  await expect(page.getByText('لا تبدأ عملية جديدة قبل معرفة نتيجة المحاولة السابقة.')).toBeVisible();
});
