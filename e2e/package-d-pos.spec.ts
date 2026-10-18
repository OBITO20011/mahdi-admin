import {test, expect} from './isolated-test';

async function openCart(page: import('@playwright/test').Page) {
  const button = page.getByRole('button', {name: 'مراجعة السلة والعميل', exact: true});
  if (await button.isVisible()) await button.click();
}
async function closeCart(page: import('@playwright/test').Page) {
  const button = page.getByRole('button', {name: 'رجوع للبيع', exact: true});
  if (await button.isVisible()) await button.click();
}

const warehouseId = '22222222-2222-4222-8222-222222222222';
const productId = '44444444-4444-4444-8444-444444444444';
const flavorId = '99999999-9999-4999-8999-999999999999';
const url = '/e2e/phase6-package-c-harness.html?kind=pos';

test('POS base and single-SKU parcel share physical capacity in the selected warehouse', async ({page}) => {
  await page.route('**/rest/v1/rpc/search_admin_products', route => route.fulfill({json: [{
    id: productId, sku: 'D2', name_ar: 'منتج الاختبار', warehouse_id: warehouseId,
    available_quantity: 5, on_hand_quantity: 5, units_per_sale_unit: 3,
    sale_price_in_minor_units: 1000, default_sale_price_in_minor_units: 2700, is_active: true,
    sale_unit: {code: 'PACK', name_ar: 'طرد'},
  }]}));
  await page.route('**/rest/v1/rpc/get_pos_configurable_parcel_options_v1', route => route.fulfill({json: {options: []}}));
  await page.goto(url);
  await expect(page.getByRole('button', {name: 'بطاقة 💳'})).toHaveCount(0);
  const card = page.locator(`[data-pos-product-card="${productId}"]`);
  await card.click(); // Three physical units.
  await page.getByRole('radio', {name: 'باكيت', exact: true}).click();
  await card.click(); await card.click(); // Two additional physical units.
  await openCart(page);
  await expect(page.getByRole('heading', {name: 'سلة المبيعات الحالية (2)'})).toBeVisible();
  const rows = page.getByRole('heading', {name: 'منتج الاختبار', level: 5});
  await expect(rows).toHaveCount(2);
  await closeCart(page);
  await card.click(); // Over capacity: neither line can grow.
  await openCart(page);
  const quantities = rows.locator('..').locator('..').locator('[data-pos-quantity]');
  await expect(quantities).toHaveText(['1', '2']);
  await closeCart(page);
  await expect(page.getByLabel('مستودع البيع', {exact: true})).toBeDisabled();
});

test('POS parcel builder requires exact allowed composition and edits one instance independently', async ({page}) => {
  await page.route('**/rest/v1/rpc/search_admin_products', route => route.fulfill({json: []}));
  await page.route('**/rest/v1/rpc/get_pos_configurable_parcel_options_v1', route => route.fulfill({json: {options: [{
    familyProductId: productId, nameAr: 'عائلة الاختبار', parcelConfigurationId: flavorId,
    configurationRevision: 3, unitsPerParcel: 3, parcelPriceInMinorUnits: 2700,
    components: [{productId, nameAr: 'نكهة أ', sku: 'A', availableQuantity: 5},
      {productId: flavorId, nameAr: 'نكهة ب', sku: 'B', availableQuantity: 5}],
  }]}}));
  await page.goto(url);
  await page.getByRole('radio', {name: 'طرد مشكّل', exact: true}).click();
  await page.getByRole('button', {name: 'تركيب طرد: عائلة الاختبار'}).click();
  const dialog = page.getByRole('dialog', {name: 'تركيب طرد: عائلة الاختبار'});
  const add = dialog.getByRole('button', {name: 'إضافة الطرد المكتمل'});
  await expect(add).toBeDisabled();
  await dialog.getByLabel('كمية نكهة أ').fill('2'); await expect(add).toBeDisabled();
  await dialog.getByLabel('كمية نكهة ب').fill('2'); await expect(add).toBeDisabled();
  await dialog.getByLabel('كمية نكهة ب').fill('1'); await expect(add).toBeEnabled();
  await add.click(); await expect(dialog).toHaveCount(0);
  await openCart(page);
  await expect(page.getByRole('heading', {name: 'سلة المبيعات الحالية (1)'})).toBeVisible();
  await page.getByRole('button', {name: 'تعديل الطرد'}).click();
  await expect(dialog.getByLabel('كمية نكهة أ')).toHaveValue('2');
  await expect(dialog.getByLabel('كمية نكهة ب')).toHaveValue('1');
  await dialog.getByLabel('كمية نكهة أ').fill('1'); await dialog.getByLabel('كمية نكهة ب').fill('2');
  await add.click(); await expect(page.getByRole('heading', {name: 'سلة المبيعات الحالية (1)'})).toBeVisible();
});

test('POS unknown response reload recovers the immutable request instead of starting a new sale', async ({page}) => {
  const branchId = '33333333-3333-4333-8333-333333333333';
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/rest/v1/rpc/search_admin_products', route => route.fulfill({json: [{
    id: productId, sku: 'D2', name_ar: 'منتج الاختبار', warehouse_id: warehouseId,
    available_quantity: 5, on_hand_quantity: 5, units_per_sale_unit: 1,
    sale_price_in_minor_units: 1000, default_sale_price_in_minor_units: 1000, is_active: true,
    sale_unit: {code: 'PACK', name_ar: 'طرد'},
  }]}));
  await page.route('**/rest/v1/rpc/get_pos_configurable_parcel_options_v1', route => route.fulfill({json: {options: []}}));
  await page.route('**/rest/v1/rpc/get_open_pos_shift', route => route.fulfill({json: {success: true,
    hasOpenShift: true, shift: {id: flavorId, branchId, shiftNumber: 'D2', startTime: '2026-10-07T00:00:00Z'}}}));
  await page.route('**/rest/v1/orders?*', route => route.fulfill({json:
    new URL(route.request().url()).searchParams.get('select') === 'created_at'
      ? {created_at: '2026-10-07T00:00:00Z'} : []}));
  await page.route('**/rest/v1/rpc/create_pos_sale_v2', async route => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) {await route.abort('failed'); return;}
    await route.fulfill({json: {success: true, operationId: flavorId,
      orderId: '66666666-6666-4666-8666-666666666666', orderNumber: 'D2-REPLAY', customerName: 'زبون نقدي',
      warehouseId, branchId, idempotentReplay: true, subtotalInMinorUnits: 1000, discountInMinorUnits: 0,
      totalInMinorUnits: 1000, amountPaidInMinorUnits: 1000, changeDueInMinorUnits: 0, paymentMethod: 'cash', paymentStatus: 'paid',
      items: [{id: '77777777-7777-4777-8777-777777777777', productId, productName: 'منتج الاختبار', sku: 'D2',
        salePackage: 'طرد', commercialLineKind: 'legacy_single_sku_parcel', quantity: 1, baseQuantity: 1,
        unitsPerSalePackage: 1, unitPriceInMinorUnits: 1000, lineTotalInMinorUnits: 1000,
        allocatedDiscountInMinorUnits: 0, netRefundableAmountInMinorUnits: 1000, cogsInMinorUnits: 300,
        profitInMinorUnits: 700, parcelInstances: []}],
    }});
  });
  await page.goto(url); await page.locator(`[data-pos-product-card="${productId}"]`).click();
  await page.getByRole('button', {name: /^إتمام البيع ·/}).click();
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem(
    'nawasrah:pos-v2:attempt:v1:11111111-1111-4111-8111-111111111111') || 'null'));
  await expect.poll(async () => (await state())?.status).toBe('OUTCOME_UNKNOWN');
  const before = await state();
  await page.reload();
  await expect(page.locator(`[data-pos-product-card="${productId}"]`)).toBeDisabled();
  await page.getByRole('button', {name: 'استرجاع محاولة البيع'}).click();
  await expect.poll(async () => (await state())?.status).toBe('SUCCEEDED');
  const after = await state();
  expect(after.request).toEqual(before.request); expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  await expect(page.getByText('رقم الفاتورة: D2-REPLAY', {exact: true})).toBeVisible();
  // This browser test proves UI/adapter behavior. Actual commit/zero-write
  // evidence is independently exercised by the isolated database runner.
});
