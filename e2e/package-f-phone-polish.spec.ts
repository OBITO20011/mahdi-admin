import AxeBuilder from '@axe-core/playwright';
import {test, expect, type Page} from './isolated-test';
import {analyzePackageFAccessibility} from './package-f-accessibility';
import {checkLayout} from './package-f-layout';

async function audit(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await checkLayout(page, page.locator('body'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const result = await analyzePackageFAccessibility(page, new AxeBuilder({page}));
  expect(result.violations.filter(row => row.impact === 'serious' || row.impact === 'critical')).toEqual([]);
}

for (const theme of ['light', 'dark']) {
  test(`phone profile ${theme}: three keyboard tabs, sticky header, unchanged reads and payment`, async ({page}) => {
    await page.setViewportSize({width: 390, height: 900});
    await page.goto(`/e2e/package-f-customers-harness.html?theme=${theme}`);
    await page.getByRole('button', {name: 'فتح ملف بقالة أبو خالد', exact: true}).filter({visible: true}).click();
    const detail = page.getByTestId('customer-detail'), tabs = page.getByRole('tablist', {name: 'تفاصيل العميل'});
    await expect(tabs.getByRole('tab')).toHaveText(['الملخص', 'الطلبات', 'العناوين']);
    await expect(tabs.getByRole('tab', {name: 'الملخص'})).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('customer-aging-detail')).toBeVisible();
    await expect(detail.getByRole('heading', {name: 'سجل طلبات المتجر'})).toBeHidden();
    await expect(page.getByTestId('customer-payment-sticky')).toBeInViewport();
    await tabs.getByRole('tab', {name: 'الطلبات', exact: true}).click();
    await expect(detail.getByText('W-10479', {exact: true})).toBeVisible();
    await expect(page.getByTestId('customer-aging-detail')).toBeHidden();
    await tabs.getByRole('tab', {name: 'الطلبات', exact: true}).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(tabs.getByRole('tab', {name: 'العناوين'})).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(detail.getByRole('tabpanel', {name: 'العناوين'})).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(detail.getByRole('button', {name: 'عنوان', exact: true})).toBeFocused();
    await page.getByRole('dialog', {name: 'ملف العميل', exact: true}).evaluate(element => element.scrollTo({top: element.scrollHeight, behavior: 'instant'}));
    await expect(page.getByTestId('customer-fixed-header')).toBeInViewport();
    await expect(page.getByTestId('customer-payment-sticky')).toBeInViewport();
    await audit(page);
  });

  test(`phone customer actions ${theme}: named sheet,44px,cancelled confirmation and restoration`, async ({page}) => {
    const calls: string[] = [];
    page.on('request', request => {if (/toggle_customer_block|soft_delete_customer/.test(request.url())) calls.push(request.url());});
    await page.setViewportSize({width: 390, height: 900});
    await page.goto(`/e2e/package-f-customers-harness.html?theme=${theme}`);
    const trigger = page.getByRole('button', {name: 'إجراءات بقالة أبو خالد', exact: true}).filter({visible: true});
    await expect(page.getByRole('button', {name: 'حظر بقالة أبو خالد', exact: true})).toBeHidden();
    await trigger.click();
    const sheet = page.getByRole('dialog', {name: 'إجراءات بقالة أبو خالد', exact: true});
    await expect(sheet).toBeVisible();
    for (const label of ['حظر بقالة أبو خالد', 'حذف بقالة أبو خالد']) {
      const action = sheet.getByRole('button', {name: label, exact: true});
      expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await action.evaluate(button => getComputedStyle(button, '::after').content)).toContain(label);
    }
    await audit(page);
    let confirmation = '';
    page.once('dialog', async dialog => {confirmation = dialog.message(); await dialog.dismiss();});
    await sheet.getByRole('button', {name: 'حظر بقالة أبو خالد', exact: true}).click();
    expect(confirmation).toBe('هل تريد حظر العميل بقالة أبو خالد؟');
    await expect(sheet).toHaveCount(0); expect(calls).toEqual([]);
    await expect(trigger).toBeFocused();
  });

  test(`phone expense rare action ${theme}: original prompt, no mutation on cancellation`, async ({page}) => {
    const writes: string[] = [];
    page.on('request', request => {if (request.url().includes('reverse_operational_expense')) writes.push(request.url());});
    await page.setViewportSize({width: 390, height: 900});
    await page.goto(`/e2e/package-f-financial-harness.html?theme=${theme}`);
    const trigger = page.getByRole('button', {name: 'إجراءات المصروف EXP-10481', exact: true});
    await trigger.click();
    const sheet = page.getByRole('dialog', {name: 'إجراءات المصروف EXP-10481', exact: true});
    await expect(sheet.getByRole('button', {name: 'عكس المصروف مع حفظ السجل', exact: true})).toBeVisible();
    await audit(page);
    let prompt = '';
    page.once('dialog', async dialog => {prompt = dialog.message(); await dialog.dismiss();});
    await sheet.getByRole('button', {name: 'عكس المصروف مع حفظ السجل', exact: true}).click();
    expect(prompt).toBe('اكتب سبب عكس المصروف (لا يمكن حذفه):');
    expect(writes).toEqual([]); await expect(trigger).toBeFocused();
  });

  test(`phone receiving rare action ${theme}: actual existing cancellation preview remains reachable`, async ({page}) => {
    await page.setViewportSize({width: 390, height: 900});
    await page.goto(`/e2e/package-f-purchasing-harness.html?view=direct&theme=${theme}`);
    await page.getByRole('button', {name: 'إجراءات سند الاستلام', exact: true}).click();
    const sheet = page.getByRole('dialog', {name: 'إجراءات سند الاستلام', exact: true});
    await expect(sheet.getByRole('button', {name: 'إلغاء السند وعكس المخزون', exact: true})).toBeVisible();
    await audit(page);
    await sheet.getByRole('button', {name: 'إلغاء السند وعكس المخزون', exact: true}).click();
    const confirmation = page.getByRole('dialog', {name: 'تأكيد إلغاء سند الاستلام', exact: true});
    await expect(confirmation).toHaveAttribute('data-state', 'open');
    await expect(confirmation.getByText('هذه دفعة نقدية من وردية مغلقة', {exact: false})).toBeVisible();
    await expect(confirmation.getByRole('button', {name: 'إلغاء السند وعكس دفعة 400.000', exact: true})).toBeEnabled();
  });
}

for (const width of [1024, 1440]) for (const theme of ['light', 'dark']) {
  test(`desktop profile remains complete ${theme} ${width}`, async ({page}) => {
    await page.setViewportSize({width, height: 900});
    await page.goto(`/e2e/package-f-customers-harness.html?theme=${theme}`);
    await page.getByRole('button', {name: 'فتح ملف بقالة أبو خالد', exact: true}).filter({visible: true}).click();
    await expect(page.getByRole('tablist', {name: 'تفاصيل العميل'})).toBeHidden();
    await expect(page.getByTestId('customer-aging-detail')).toBeVisible();
    await expect(page.getByTestId('customer-detail').getByRole('heading', {name: 'عناوين التوصيل'})).toBeVisible();
    await expect(page.getByTestId('customer-detail').getByRole('heading', {name: 'سجل طلبات المتجر'})).toBeVisible();
    expect(await page.getByTestId('customer-fixed-header').evaluate(element => getComputedStyle(element).position)).toBe('static');
    await audit(page);
  });
}
