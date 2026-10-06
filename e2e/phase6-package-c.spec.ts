import {test, expect} from './isolated-test';
const url = '/e2e/phase6-package-c-harness.html';
test('POS product keyboard activation adds once per Enter or Space and retains capacity limits', async ({page}) => {
  await page.route('**/rest/v1/rpc/search_admin_products', route => route.fulfill({json: [
    {id: 'keyboard-product', sku: 'KB1', barcode: '123', name_ar: 'صنف لوحة المفاتيح',
      available_quantity: 2, on_hand_quantity: 2, units_per_sale_unit: 1,
      sale_price_in_minor_units: 1000, default_sale_price_in_minor_units: 1000, is_active: true,
      sale_unit: {id: 'sale-unit', code: 'PACK', name_ar: 'طرد'}},
  ]}));
  await page.goto(`${url}?kind=pos`);
  const card = page.locator('[data-pos-product-card="keyboard-product"]');
  await expect(card).toHaveJSProperty('tagName', 'BUTTON');
  await card.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', {name: 'سلة المبيعات الحالية (1)'})).toBeVisible();
  const row = page.getByRole('heading', {name: 'صنف لوحة المفاتيح', level: 5}).locator('..').locator('..');
  const quantity = row.locator('span.font-bold.text-white');
  await expect(quantity).toHaveText('1');
  await card.focus(); await page.keyboard.press('Space');
  await expect(quantity).toHaveText('2');
  await card.focus(); await page.keyboard.press('Enter');
  await expect(quantity).toHaveText('2');
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
