import {test, expect} from './isolated-test';
const url = '/e2e/phase6-package-c-harness.html';
test('POS product keyboard activation adds once per Enter or Space and retains capacity limits', async ({page}) => {
  await page.route('**/rest/v1/rpc/search_admin_products', route => route.fulfill({json: [
    {id: 'keyboard-product', sku: 'KB1', barcode: '123', name_ar: 'صنف لوحة المفاتيح',
      available_quantity: 2, on_hand_quantity: 2, units_per_sale_unit: 1,
      warehouse_id: '22222222-2222-4222-8222-222222222222',
      sale_price_in_minor_units: 1000, default_sale_price_in_minor_units: 1000, is_active: true,
      sale_unit: {id: 'sale-unit', code: 'PACK', name_ar: 'طرد'}},
  ]}));
  await page.goto(`${url}?kind=pos`);
  const card = page.locator('[data-pos-product-card="keyboard-product"]');
  await expect(card).toHaveJSProperty('tagName', 'BUTTON');
  await card.focus(); await page.keyboard.press('Enter');
  if (page.viewportSize()!.width >= 1024) await expect(page.getByRole('heading', {name: 'سلة المبيعات الحالية (1)'})).toBeVisible();
  else await expect(page.getByRole('button', {name: 'مراجعة السلة والعميل'})).toContainText('صنف واحد');
  const quantity = page.locator('[data-pos-quantity]:visible, [data-pos-product-quantity="keyboard-product"]:visible');
  await expect(quantity).toHaveText('1');
  const search = page.getByPlaceholder('ابحث باسم المنتج أو الباركود أو SKU...');
  await expect(search).toBeFocused();
  // Held Enter cannot repeatedly activate the card, even when delivered there.
  await card.dispatchEvent('keydown', {key: 'Enter', repeat: true});
  await expect(quantity).toHaveText('1');
  // Keyboard-wedge scanner types into search, not the previously selected card.
  await page.keyboard.type('123'); await page.keyboard.press('Enter');
  await expect(search).toHaveValue('123'); await expect(quantity).toHaveText('1');
  await search.fill('');
  await card.focus(); await page.keyboard.press('Space');
  await expect(quantity).toHaveText('2');
  await card.focus(); await page.keyboard.press('Enter');
  await expect(quantity).toHaveText('2');
});

test('dirty Admin input survives Escape; summary and native unlisted focus follow browser Tab order', async ({page}) => {
  await page.goto(url);
  await page.getByRole('button', {name: 'فتح النافذة', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: 'نافذة الاختبار', exact: true});
  await dialog.getByLabel('حقل الاختبار', {exact: true}).fill('تعديلات غير محفوظة');
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('حقل الاختبار', {exact: true})).toHaveValue('تعديلات غير محفوظة');
  const summary = dialog.locator('summary');
  await summary.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', {name: 'بعد الملخص'})).toBeFocused();
  await dialog.getByLabel('عنصر أصلي خارج القائمة').focus(); await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', {name: 'بعد العنصر الأصلي'})).toBeFocused();
});

test('supplier payment Escape is blocked during request and busy clears after rejection', async ({page}) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await page.route('**/rest/v1/rpc/record_supplier_receipt_payment', async route => {
    calls++; await held;
    await route.fulfill({status: 400, json: {message: 'TEST_PAYMENT_REJECTED'}});
  });
  await page.goto(url);
  await page.getByRole('button', {name: 'فتح دفعة المورد'}).click();
  const dialog = page.getByRole('dialog', {name: 'دفعة المورد'});
  await dialog.getByRole('button', {name: 'تأكيد تسجيل الدفعة'}).click();
  await expect.poll(() => calls).toBe(1);
  await expect(dialog.locator('[aria-busy="true"]')).toHaveCount(1);
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  release();
  await expect(dialog.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
});
test('Admin dialog traps Tab, protects busy close, isolates nested Escape and restores focus', async ({page}) => {
  await page.goto(url);
  const opener = page.getByRole('button', {name: 'فتح النافذة', exact: true});
  await opener.click();
  const dialog = page.getByRole('dialog', {name: 'نافذة الاختبار', exact: true});
  const close = dialog.getByRole('button', {name: 'إغلاق', exact: true});
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', {name: 'آخر زر'})).toBeFocused();
  await page.keyboard.press('Tab'); await expect(close).toBeFocused();
  await dialog.getByRole('button', {name: 'فتح نافذة داخلية'}).click();
  await expect(page.getByRole('dialog', {name: 'نافذة داخلية', exact: true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', {name: 'نافذة داخلية', exact: true})).toHaveCount(0);
  await expect(dialog.getByRole('button', {name: 'فتح نافذة داخلية'})).toBeFocused();
  await dialog.getByRole('button', {name: 'تغيير الانشغال'}).click();
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  await close.click(); await expect(dialog).toBeVisible();
  await dialog.getByRole('button', {name: 'تغيير الانشغال'}).click();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});
test('stock action cards use native keyboard buttons and payment labels bind exact inputs', async ({page}) => {
  await page.goto(url);
  const low = page.getByRole('button', {name: /منخفض المخزون/});
  await low.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toHaveText('منخفض');
  const out = page.getByRole('button', {name: /نفذت من المخزن/});
  await out.focus(); await page.keyboard.press('Space');
  await expect(page.getByRole('status')).toHaveText('نفد');
  await page.getByRole('button', {name: 'فتح النافذة', exact: true}).click();
  await expect(page.getByLabel(/مبلغ الدفعة/)).toHaveAttribute('type', 'number');
  await page.getByLabel('طريقة الدفع *').selectOption('cliq');
  await expect(page.getByLabel('رقم مرجع CliQ *')).toHaveAttribute('required', '');
  await expect(page.getByLabel('ملاحظات (اختياري)')).toBeVisible();
});
test('Cart Escape dismisses confirmation first, then restores opener without changing cart', async ({page}) => {
  await page.goto(url);
  const opener = page.getByRole('button', {name: 'فتح السلة', exact: true});
  await opener.click();
  const cart = page.getByRole('dialog', {name: 'سلة طلب الجملة'});
  await cart.getByRole('button', {name: 'إفراغ السلة', exact: true}).click();
  await expect(cart.getByText('هل أنت متأكد من حذف جميع الأصناف من السلة؟')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(cart.getByText('هل أنت متأكد من حذف جميع الأصناف من السلة؟')).toHaveCount(0);
  await expect(cart.getByText('اختبار', {exact: true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(cart).not.toBeVisible(); await expect(opener).toBeFocused();
});
