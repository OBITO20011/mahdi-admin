import { expect, test, type Page } from '@playwright/test';

const customerBaseUrl = process.env.M10_CUSTOMER_BASE_URL;
const publicSupabaseUrl = process.env.M10_PUBLIC_SUPABASE_URL;
const isolatedApiUrl = process.env.M10_ISOLATED_API_URL;
const enabled = Boolean(customerBaseUrl && publicSupabaseUrl && isolatedApiUrl);

const productName = 'صنف اختبار M10';

async function useIsolatedBackend(page: Page) {
  if (!publicSupabaseUrl || !isolatedApiUrl) throw new Error('M10 isolation is not configured.');

  await page.route(`${publicSupabaseUrl}/**`, async (route) => {
    const requested = new URL(route.request().url());
    const target = new URL(requested.pathname + requested.search, isolatedApiUrl);
    const headers = {
      ...route.request().headers(),
      origin: 'http://127.0.0.1:4174',
      'x-forwarded-for': '127.0.0.1',
    };
    const response = await route.fetch({ url: target.toString(), headers });
    await route.fulfill({ response });
  });
}

test.describe('M10 isolated browser checkout', () => {
  test.skip(!enabled, 'Run through scripts/testing/run-customer-checkout-browser-e2e.mjs only.');

  test('browser → cart snapshot → Turnstile → gateway → receipt → token tracking', async ({ page }) => {
    await useIsolatedBackend(page);
    await page.goto(`${customerBaseUrl}/#catalog`, { waitUntil: 'domcontentloaded' });

    await page.getByRole('button', { name: `إضافة ${productName} إلى السلة` }).click();
    await page.getByRole('button', { name: 'فتح السلة' }).click();
    await page.getByRole('button', { name: 'إتمام الطلب بدون تسجيل دخول' }).click();

    const checkout = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'إتمام طلب الجملة' }),
    });
    await checkout.getByLabel('الاسم الكامل*').fill('عميل M10');
    await checkout.getByLabel('رقم الهاتف*').fill('0797001010');
    await checkout.getByLabel('المحافظة*').selectOption({ label: 'إربد' });
    await checkout.getByLabel('المدينة*').fill('الرمثا');
    await checkout.getByLabel('المنطقة أو الحي*').fill('حي الاختبار');
    await expect(checkout.getByLabel(/تفاصيل العنوان والتوصيل \(اختياري\)/)).toHaveValue('');

    await checkout.getByRole('button', { name: 'مراجعة الطلب قبل الإرسال' }).click();
    const review = page.getByRole('dialog', { name: 'راجع طلبك قبل الإرسال' });
    await expect(review.getByText('تم التحقق الأمني وجاهز للإرسال.')).toBeVisible({ timeout: 30_000 });
    const submit = review.getByRole('button', { name: 'تأكيد وحفظ الطلب في الإدارة' });
    await expect(submit).toBeEnabled();
    await submit.click();

    const receipt = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'تم تسجيل طلبك' }),
    });
    await expect(receipt).toBeVisible({ timeout: 30_000 });
    await expect(receipt.getByText('تم ربط الطلب بملف العميل الموجود حسب رقم الهاتف.').or(
      receipt.getByText('تم إنشاء ملف عميل جديد وربطه بهذا الطلب تلقائيًا.')
    )).toBeVisible();

    await receipt.getByRole('button', { name: 'متابعة الطلب' }).click();
    const tracking = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'أين وصل طلبك؟' }),
    });
    await expect(tracking).toBeVisible({ timeout: 30_000 });
    await expect(tracking.locator('strong').filter({ hasText: 'وصلنا الطلب' })).toBeVisible();
  });

});
