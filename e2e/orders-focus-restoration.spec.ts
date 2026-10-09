import { test, expect } from './isolated-test';
import { ordersFixture } from './package-f-orders.fixture';

for (const theme of ['light', 'dark']) {
  for (const intent of ['search', 'filter']) {
    test(`phone ${theme}: accepted back reload respects immediate ${intent} focus`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const queries: Array<Record<string, unknown>> = [];
      let releaseBackRead: (() => void) | undefined;
      const fixture = ordersFixture[0];
      await page.route('http://127.0.0.1:4176/rest/v1/**', async (route) => {
        const request = route.request();
        const parsed = new URL(request.url());
        const path = parsed.pathname.split('/').pop();
        if (path === 'get_operational_orders_page') {
          queries.push(request.postDataJSON());
          // Only the back read is held: a real user starts another interaction
          // before the accepted reload. No sleeps or artificial response retries.
          if (queries.length === 3) await new Promise<void>((resolve) => { releaseBackRead = resolve; });
          await route.fulfill({ json: { order_ids: [fixture.id], total_count: 1, summary: { review_count: 1, active_count: 0, due_in_minor_units: 0 } } });
          return;
        }
        if (path === 'orders') {
          const row = {
            id: fixture.id, order_number: fixture.orderNumber, source: 'website', customer_name_snapshot: fixture.customerName,
            customers: { id: fixture.customerId, full_name: fixture.customerName, phone: '0791234567' },
            customer_addresses: { governorate: 'الرمثا', area: 'الحي الشرقي' },
            status: 'new', payment_method: 'cash_on_delivery', payment_status: 'unpaid',
            subtotal_in_minor_units: 90200, delivery_fee_in_minor_units: 2000, discount_in_minor_units: 0,
            total_in_minor_units: 92200, amount_paid_in_minor_units: 0, branch_id: 'orders-branch',
            created_at: fixture.createdAt, updated_at: fixture.updatedAt,
            order_items: parsed.searchParams.get('id')?.startsWith('eq.') ? [] : [{ count: 3 }], order_status_history: [],
          };
          await route.fulfill({ json: request.headers().accept?.includes('object') ? row : [row] });
          return;
        }
        await route.fulfill({ json: [] });
      });

      await page.goto(`/e2e/package-f-orders-harness.html?theme=${theme}&live`);
      const card = page.getByRole('button', { name: `فتح الطلب ${fixture.orderNumber}`, exact: true });
      await card.click();
      await expect(page.getByTestId('order-detail-panel').getByText('طباعة الطلب', { exact: true })).toBeVisible();
      await expect.poll(() => queries.length).toBe(2);
      await page.getByRole('button', { name: 'رجوع للطلبات', exact: true }).click();

      const search = page.getByRole('searchbox', { name: 'البحث في الطلبات' });
      const all = page.getByRole('tab', { name: /الكل/ });
      if (intent === 'search') {
        await search.focus();
        await search.pressSequentially('ا');
        await expect(search).toHaveValue('ا');
      } else {
        // Safari does not focus buttons on pointer activation. Exercise an
        // explicitly focused filter, as a keyboard user does, on both engines.
        await all.focus();
        await all.press('Enter');
      }
      await expect.poll(() => Boolean(releaseBackRead)).toBe(true);
      releaseBackRead!();
      await expect(card).toBeVisible();

      if (intent === 'search') {
        // The pending reload must not interrupt an in-progress word.
        await expect(search).toBeFocused();
        await search.pressSequentially('لأمل');
        await expect(search).toHaveValue('الأمل');
        await expect.poll(() => queries.at(-1)?.p_search).toBe('الأمل');
        await expect(card).toBeVisible();
        await expect(search).toBeFocused();
        await expect(search).toHaveValue('الأمل');
      } else {
        await expect(all).toBeFocused();
        await expect(all).toHaveAttribute('aria-selected', 'true');
        await expect.poll(() => queries.at(-1)?.p_filter).toBe('all');
        await expect(search).toHaveValue('');
      }
    });
  }
}
