import { expect, test } from '@playwright/test';

const customerBaseUrl =
  process.env.CUSTOMER_BASE_URL ?? 'http://127.0.0.1:4174';
const trackingToken = '11111111-2222-4333-8444-555555555555';

const trackingPayload = {
  success: true,
  order_number: 'WEB-TRACK-001',
  status: 'out_for_delivery',
  payment_method: 'cash_on_delivery',
  payment_status: 'unpaid',
  total: 12750,
  item_count: 3,
  created_at: '2026-08-31T08:00:00.000Z',
  updated_at: '2026-08-31T08:30:00.000Z',
  tracking_token: trackingToken,
  tracking_path: `/#track=${trackingToken}`,
  delivery_started_at: '2026-08-31T08:30:00.000Z',
  estimated_arrival_at: '2026-08-31T09:00:00.000Z',
  driver_phone: '0790000000',
  timeline: [
    { status: 'new', created_at: '2026-08-31T08:00:00.000Z' },
    { status: 'confirmed', created_at: '2026-08-31T08:10:00.000Z' },
    { status: 'preparing', created_at: '2026-08-31T08:20:00.000Z' },
    { status: 'out_for_delivery', created_at: '2026-08-31T08:30:00.000Z' },
  ],
};

test.describe('التتبع العام للطلب', () => {
  test('رابط الرمز الآمن يعرض خطًا زمنيًا فعليًا ويحدثه يدويًا فقط', async ({ page }) => {
    let trackingRequests = 0;
    await page.route('**/rest/v1/rpc/track_guest_order_by_token', async (route) => {
      trackingRequests += 1;
      expect(route.request().postDataJSON()).toEqual({
        p_tracking_token: trackingToken,
      });
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(trackingPayload),
      });
    });

    await page.goto(`${customerBaseUrl}/#track=${trackingToken}`, {
      waitUntil: 'domcontentloaded',
    });

    const trackingDialog = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'أين وصل طلبك؟' }),
    });
    await expect(trackingDialog).toBeVisible();
    await expect(trackingDialog.getByText('WEB-TRACK-001')).toBeVisible();
    await expect(
      trackingDialog
        .locator('strong')
        .filter({ hasText: 'الطلب في الطريق إليك' }),
    ).toBeVisible();
    await expect(trackingDialog.getByText('وصلنا الطلب')).toBeVisible();
    await expect(trackingDialog.getByText('تمت مراجعة الطلب')).toBeVisible();
    await expect(trackingDialog.getByText('جاري تجهيز الطلب')).toBeVisible();
    await expect(trackingDialog.getByText('١٢٫٧٥٠ د.أ')).toBeVisible();
    await expect(trackingDialog.getByText('إلى العنوان المسجل')).toBeVisible();
    await expect(
      trackingDialog.getByText(/عنوان العميل|موقع التوصيل على الخريطة/),
    ).toHaveCount(0);
    expect(trackingRequests).toBe(1);

    await trackingDialog.getByRole('button', { name: 'تحديث الحالة' }).click();
    await expect.poll(() => trackingRequests).toBe(2);
  });
});
