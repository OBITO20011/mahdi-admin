import AxeBuilder from '@axe-core/playwright';
import {checkLayout} from './package-f-layout';
import { expect, test, type Page } from './isolated-test';
import { ordersFixture } from './package-f-orders.fixture';

const base = process.env.ADMIN_BASE_URL ?? 'http://127.0.0.1:4173';
const url = (query = '') => `${base}/e2e/package-f-orders-harness.html?${query}`;
async function layout(page: Page) {
  await checkLayout(page,page.getByTestId('orders-workbench'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const escaped = await page.getByTestId('orders-workbench').evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const failures: string[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (!node.textContent?.trim() || !parent || parent.closest('.sr-only') || !parent.getClientRects().length) continue;
      const box = parent.closest('p,h1,h2,h3,h4,h5,button,dt,dd,td,th,summary,div') ?? parent;
      const bounds = box.getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(node);
      for (const rect of range.getClientRects()) if (rect.width && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)) failures.push(node.textContent.trim());
    }
    return failures;
  });
  expect(escaped).toEqual([]);
  await expect(page.getByTestId('orders-workbench')).not.toContainText(/[٠-٩]/);
}
async function accessibility(page: Page) {
  const result = await new AxeBuilder({ page }).include('[data-testid="orders-workbench"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => ({ id: v.id, targets: v.nodes.map((node) => node.target) }))).toEqual([]);
}
for (const theme of ['light', 'dark']) for (const width of [390, 820, 1440]) {
  test(`Orders ${theme} ${width}: token layout, Latin digits, text containment and axe`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1125 });
    await page.goto(url(`theme=${theme}&long`));
    await expect(page.getByRole('heading', { name: 'الطلبات', exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await layout(page);
    await accessibility(page);
    if (width < 768) await expect(page.locator('[data-order-card]')).toHaveCount(6);
    else await expect(page.getByRole('table', { name: 'قائمة الطلبات' })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`orders-${theme}-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'فتح الطلب W-10481', exact: true }).click();
    await expect(page.getByTestId('order-detail-panel')).toBeVisible();
    await layout(page);
    await accessibility(page);
    await page.getByTestId('orders-scroll').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await layout(page);
    const shortButtons = await page.getByTestId('orders-workbench').getByRole('button').evaluateAll((buttons) => buttons.filter((button) => button.getClientRects().length && button.getBoundingClientRect().height < 44).map((button) => button.textContent));
    expect(shortButtons).toEqual([]);
  });
}
for (const theme of ['light', 'dark']) {
  test(`phone detail ${theme}: immediate full viewport, sticky back, original card scroll and axe`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url(`theme=${theme}`));
    const card = page.getByRole('button', { name: 'فتح الطلب W-10477', exact: true });
    await card.scrollIntoViewIfNeeded();
    const scroll = page.getByTestId('orders-scroll');
    const before = await scroll.evaluate((element) => element.scrollTop);
    expect(before).toBeGreaterThan(0); // challenge a card below the initial viewport
    const cardTop = (await card.boundingBox())!.y;
    await card.click();
    const panel = page.getByTestId('order-detail-panel');
    await expect(panel).toBeInViewport();
    const bounds = (await panel.boundingBox())!;
    expect(bounds.x).toBe(0); expect(bounds.y).toBe(0);
    expect(bounds.width).toBe(390); expect(bounds.height).toBe(844);
    await expect(panel.getByRole('dialog', { name: 'تفاصيل الطلب W-10477' })).toBeVisible();
    await expect(panel.getByTestId('order-commercial-summary')).toBeInViewport();
    const back = panel.getByRole('button', { name: 'رجوع للطلبات', exact: true });
    await expect(back).toBeInViewport();
    expect(await page.evaluate(() => !document.elementFromPoint(20, innerHeight - 20)?.closest('.admin-bottom-tabs'))).toBe(true);
    await accessibility(page);
    await layout(page);
    await page.getByTestId('order-detail-scroll').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(back).toBeInViewport();
    await back.click();
    await expect(panel).toHaveCount(0);
    await expect(card).toBeInViewport();
    await expect(card).toBeFocused();
    expect(await scroll.evaluate((element) => element.scrollTop)).toBeCloseTo(before, 0);
    expect((await card.boundingBox())!.y).toBeCloseTo(cardTop, 0);
    await expect(page.locator('.admin-bottom-tabs')).toBeInViewport();
    await accessibility(page);
  });

  test(`desktop table ${theme} 1280: selected detail with single-line order numbers/times and contained scrolling`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(url(`theme=${theme}&select&long`));
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByTestId('order-detail-panel')).toBeVisible();
    const table = page.getByRole('table', { name: 'قائمة الطلبات' });
    for (const selector of ['[data-order-number]', '[data-order-time]']) {
      const cells = table.locator(selector);
      await expect(cells).toHaveCount(6);
      const rows = await cells.evaluateAll((elements) => elements.map((element) => {
        const range = document.createRange(); range.selectNodeContents(element);
        const lines = new Set([...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => Math.round(rect.top)));
        return { text: element.textContent, lines: lines.size, whitespace: getComputedStyle(element).whiteSpace };
      }));
      for (const row of rows) { expect(row.lines, row.text!).toBe(1); expect(row.whitespace).toBe('nowrap'); }
    }
    expect(await table.evaluate((element) => {
      const container = element.parentElement!;
      return getComputedStyle(container).overflowX === 'auto' && container.scrollWidth > container.clientWidth;
    })).toBe(true);
    await layout(page);
    await accessibility(page);
    await expect(page.getByTestId('orders-workbench')).not.toContainText('العدّادات المتاحة من القارئ');
    await expect(page.getByText('تتحدث القائمة تلقائياً.', { exact: false })).toBeVisible();
  });
}
test('search, filters, sort, selection and refresh preserve intent without clearing another order', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1125 });
  await page.goto(url());
  await page.getByRole('tab', { name: /مكتملة/ }).click();
  await expect(page.getByRole('button', { name: 'فتح الطلب W-10480', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /الكل/ }).click();
  await page.getByRole('searchbox', { name: 'البحث في الطلبات' }).fill('W-10482');
  await expect(page.getByRole('button', { name: /^فتح الطلب/ })).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'البحث في الطلبات' }).fill('');
  await page.getByRole('combobox', { name: 'ترتيب الطلبات' }).selectOption('oldest');
  await expect(page.getByRole('button', { name: /^فتح الطلب/ }).first()).toHaveAccessibleName('فتح الطلب W-10477');
  await page.getByRole('button', { name: 'تحديث', exact: true }).click();
  await expect(page.getByTestId('orders-action')).toHaveText('refresh');
});
test('all active order flows remain reachable with identical action identity and input', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url('theme=dark'));
  await page.getByRole('button', { name: 'فتح الطلب W-10482', exact: true }).click();
  await page.getByRole('button', { name: 'قبول الطلب وبدء التجهيز', exact: true }).click();
  await expect(page.getByTestId('orders-action')).toContainText(`"method":"confirmOrder","args":["${ordersFixture[0].id}",null]`);
  await page.getByRole('button', { name: 'إلغاء الطلب مع ذكر السبب', exact: true }).click();
  await page.getByPlaceholder('مثال: الزبون طلب الإلغاء').fill('طلب العميل الإلغاء');
  await page.getByRole('button', { name: 'تأكيد الإلغاء', exact: true }).click();
  await expect(page.getByTestId('orders-action')).toContainText(`"method":"cancelOrder","args":["${ordersFixture[0].id}","طلب العميل الإلغاء"]`);
  await page.getByRole('button', { name: 'إغلاق', exact: true }).click();
  await page.getByRole('button', { name: 'فتح الطلب W-10481', exact: true }).click();
  await page.getByRole('button', { name: 'بدء التوصيل وتحديد وقت الوصول', exact: true }).click();
  await page.getByLabel('رقم هاتف السائق').fill('0791234567');
  await page.getByRole('button', { name: 'بدء التوصيل', exact: true }).click();
  await expect(page.getByTestId('orders-action')).toContainText(`"method":"startOrUpdateOrderDelivery","args":["${ordersFixture[1].id}",30,"0791234567",null]`);
  await page.getByRole('button', { name: 'إغلاق', exact: true }).click();
  await page.getByRole('button', { name: 'فتح الطلب W-10478', exact: true }).click();
  await page.getByRole('button', { name: 'تسليم الطلب وتسجيل الحساب', exact: true }).click();
  await page.getByRole('button', { name: 'دفع جزئي', exact: true }).click();
  await page.getByLabel(/المبلغ المقبوض الآن/).fill('50');
  await page.getByRole('button', { name: 'CliQ', exact: true }).click();
  await page.getByLabel('رقم مرجع CliQ *').fill('CLIQ-TEST-123');
  await page.getByRole('button', { name: 'اعتماد التسليم والحساب', exact: true }).click();
  await expect(page.getByTestId('orders-action')).toContainText('"method":"completeWebsiteOrderWithSettlement"');
  await expect(page.getByTestId('orders-action')).toContainText('"amountCollected":50,"deliveryFee":2,"referenceNumber":"CLIQ-TEST-123"');
});
test('detail preserves contact/address tools, parcel composition and print', async ({ page }) => {
  await page.goto(url('select'));
  const panel = page.getByTestId('order-detail-panel');
  const commercial = panel.getByTestId('order-commercial-summary');
  await commercial.getByText('عرض مكونات الطرود (3)', { exact: true }).click();
  await expect(commercial.getByRole('list', { name: 'مكونات طرد مشكّل رقم 1' })).toContainText('جبنة (CHEESE) — 10 باكيت');
  await panel.getByText('التواصل وملف العميل', { exact: true }).click();
  await panel.getByRole('button', { name: 'ملف العميل', exact: true }).click();
  await expect(page.getByTestId('orders-action')).toContainText('"method":"openCustomerProfile","args":["customer-1"]');
  await panel.getByText('تفاصيل الطلب والحساب', { exact: true }).click();
  await panel.getByText('العنوان والخريطة وتعديل الموقع', { exact: true }).click();
  await expect(panel.getByRole('link', { name: 'Google Maps' })).toBeVisible();
  await panel.getByRole('button', { name: 'تعديل العنوان', exact: true }).click();
  await expect(page.getByRole('heading', { name: /تعديل/ }).last()).toBeVisible();
  await page.getByRole('dialog', { name: 'تعديل عنوان التوصيل' }).getByRole('button', { name: 'إغلاق', exact: true }).click();
  await page.evaluate(() => { window.print = () => { document.body.dataset.printed = 'true'; }; });
  await panel.getByRole('button', { name: 'طباعة الطلب', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-printed', 'true');
});
for (const theme of ['light', 'dark']) {
  test(`live phone ${theme}: back restores lower card after actual list reload completes`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let listReads = 0;
    let releaseList: (() => void) | undefined;
    await page.route('http://127.0.0.1:4176/rest/v1/**', async (route) => {
      const request = route.request(); const parsed = new URL(request.url());
      const path = parsed.pathname.split('/').pop()!;
      if (path === 'get_operational_orders_page') {
        listReads += 1;
        // Explicit response barrier: exercise the loading/remount, not a lucky fast fixture.
        if (listReads > 2) await new Promise<void>((resolve) => { releaseList = resolve; });
        const visible = request.postDataJSON().p_filter === 'all' ? ordersFixture : [ordersFixture[0]];
        await route.fulfill({ json: { order_ids: visible.map((order) => order.id), total_count: visible.length, summary: { review_count: 1, active_count: 3, due_in_minor_units: 0 } } }); return;
      }
      if (path === 'orders') {
        const id = parsed.searchParams.get('id');
        const rows = ordersFixture.filter((order) => id?.startsWith('eq.') ? id === `eq.${order.id}` : id?.includes(order.id)).map((order) => ({
          id: order.id, order_number: order.orderNumber, source: 'website', customer_name_snapshot: order.customerName,
          customers: { id: order.customerId, full_name: order.customerName, phone: '0791234567' }, customer_addresses: { governorate: 'الرمثا', area: 'الحي الشرقي' },
          status: order.status, payment_method: order.paymentMethod, payment_status: order.paymentStatus,
          subtotal_in_minor_units: 90200, delivery_fee_in_minor_units: 2000, discount_in_minor_units: 0, total_in_minor_units: 92200,
          amount_paid_in_minor_units: 0, branch_id: 'orders-branch', created_at: order.createdAt, updated_at: order.updatedAt,
          order_items: id?.startsWith('eq.') ? [] : [{ count: 3 }], order_status_history: [],
        }));
        await route.fulfill({ json: request.headers().accept?.includes('object') ? rows[0] : rows }); return;
      }
      await route.fulfill({ json: [] });
    });
    await page.goto(url(`theme=${theme}&live`));
    await expect(page.locator('[data-order-card]')).toHaveCount(1);
    await page.getByRole('tab', { name: /الكل/ }).click();
    await expect.poll(() => listReads).toBe(2);
    await expect(page.locator('[data-order-card]')).toHaveCount(6);
    await page.evaluate(() => document.fonts.ready);
    const card = page.getByRole('button', { name: 'فتح الطلب W-10477', exact: true });
    await card.scrollIntoViewIfNeeded();
    const scroll = page.getByTestId('orders-scroll');
    const before = await scroll.evaluate((element) => element.scrollTop);
    const cardTop = (await card.boundingBox())!.y;
    expect(before).toBeGreaterThan(500);
    await card.click();
    await expect.poll(() => listReads).toBe(3);
    await expect(page.getByText('جاري تحميل الطلبات...', { exact: true })).toBeAttached();
    await expect(page.locator('[data-order-card]')).toHaveCount(0);
    await expect(page.getByTestId('order-detail-panel').getByText('طباعة الطلب', { exact: true })).toBeVisible();
    releaseList!();
    await expect(page.locator('[data-order-card]')).toHaveCount(6);
    await page.getByRole('button', { name: 'رجوع للطلبات', exact: true }).click();
    await expect.poll(() => listReads).toBe(4);
    await expect(page.getByText('جاري تحميل الطلبات...', { exact: true })).toBeVisible();
    await expect(page.locator('[data-order-card]')).toHaveCount(0);
    releaseList!();
    await expect(page.locator('[data-order-card]')).toHaveCount(6);
    await expect(page.getByTestId('order-detail-panel')).toHaveCount(0);
    await expect.poll(async () => Math.abs(await scroll.evaluate((element) => element.scrollTop) - before)).toBeLessThanOrEqual(2);
    await expect(card).toBeInViewport();
    await expect(card).toBeFocused();
    expect(Math.abs((await card.boundingBox())!.y - cardTop)).toBeLessThanOrEqual(2);
    expect(listReads).toBe(4); // no additional RPC introduced by restoration
    await accessibility(page);
  });
}

test('live controller retains bounded RPC paging/search and selected-only detail reader', async ({ page }) => {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.route('http://127.0.0.1:4176/rest/v1/**', async (route) => {
    const request = route.request(); const parsed = new URL(request.url());
    const path = parsed.pathname.split('/').pop()!;
    if (path === 'get_operational_orders_page') {
      requests.push({ path, body: request.postDataJSON() });
      await route.fulfill({ json: { order_ids: [ordersFixture[0].id], total_count: 1, summary: { review_count: 1, active_count: 0, due_in_minor_units: 0 } } }); return;
    }
    if (path === 'orders') {
      const row = { id: ordersFixture[0].id, order_number: 'W-10482', source: 'website', customer_name_snapshot: 'سوبرماركت الأمل', customers: { id: 'customer-0', full_name: 'سوبرماركت الأمل', phone: '0791234567' }, customer_addresses: { governorate: 'الرمثا', area: 'الحي الشرقي' }, status: 'new', payment_method: 'cash_on_delivery', payment_status: 'unpaid', subtotal_in_minor_units: 90200, delivery_fee_in_minor_units: 2000, discount_in_minor_units: 0, total_in_minor_units: 92200, amount_paid_in_minor_units: 0, branch_id: 'orders-branch', created_at: '2026-10-09T07:42:00.000Z', updated_at: '2026-10-09T07:42:00.000Z', order_items: parsed.searchParams.has('id') && !parsed.searchParams.get('id')!.startsWith('in.') ? [] : [{ count: 3 }], order_status_history: [] };
      requests.push({ path, body: Object.fromEntries(parsed.searchParams) });
      await route.fulfill({ json: request.headers().accept?.includes('object') ? row : [row] }); return;
    }
    await route.fulfill({ json: [] });
  });
  await page.goto(url('live'));
  await expect(page.getByRole('button', { name: 'فتح الطلب W-10482', exact: true })).toBeVisible();
  expect(requests[0]).toEqual({ path: 'get_operational_orders_page', body: { p_page: 1, p_page_size: 25, p_filter: 'action', p_search: null, p_sort: 'newest' } });
  expect(requests.filter((r) => r.path === 'orders' && String(r.body.id).startsWith('eq.'))).toHaveLength(0);
  await page.getByRole('button', { name: 'فتح الطلب W-10482', exact: true }).click();
  await expect(page.getByTestId('order-detail-panel').getByText('طباعة الطلب', { exact: true })).toBeVisible();
  expect(requests.some((r) => r.path === 'orders' && r.body.id === `eq.${ordersFixture[0].id}`)).toBe(true);
  // Phone details now cover the list; return through the real navigation before searching.
  if (page.viewportSize()!.width < 768) await page.getByRole('button', { name: 'رجوع للطلبات', exact: true }).click();
  await page.getByRole('searchbox', { name: 'البحث في الطلبات' }).fill('الأمل');
  await expect.poll(() => requests.filter((r) => r.path === 'get_operational_orders_page').at(-1)?.body.p_search).toBe('الأمل');
});
