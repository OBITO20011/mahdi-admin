import {expect, test, type BrowserContext, type Page, type Route} from '@playwright/test';

const baseUrl = process.env.ADMIN_LARGE_CATALOG_BASE_URL;
const email = process.env.ADMIN_LARGE_CATALOG_EMAIL;
const password = process.env.ADMIN_LARGE_CATALOG_PASSWORD;
const enabled = Boolean(baseUrl && email && password);

const turnstileShim = `
window.turnstile = {
  render: function (_container, options) {
    window.__largeCatalogTurnstileOptions = options;
    queueMicrotask(function () { options.callback('XXXX.DUMMY.TOKEN.XXXX'); });
    return 'large-catalog-widget';
  },
  reset: function () {
    var options = window.__largeCatalogTurnstileOptions;
    if (options) queueMicrotask(function () { options.callback('XXXX.DUMMY.TOKEN.XXXX'); });
  },
  remove: function () {}
};`;

const installTurnstileShim = async (context: BrowserContext) => {
  await context.route(
    'https://challenges.cloudflare.com/turnstile/v0/api.js**',
    async (route: Route) => {
      await route.fulfill({status: 200, contentType: 'text/javascript', body: turnstileShim});
    },
  );
};

const openMoreDestination = async (
  page: Page,
  groupId: string,
  destinationId: string,
) => {
  await page.locator('[data-bottom-tab="more"]').click();
  const group = page.locator(`[data-navigation-group="${groupId}"]`);
  const trigger = group.locator('button').first();
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await page.locator(`[data-navigation-id="${destinationId}"]`).click();
};

test.describe('isolated Admin 5k catalog performance', () => {
  test.skip(!enabled, 'Run through the isolated large-catalog runner.');

  test('bounded catalog screens stay usable and reject stale search responses', async ({page, context, browserName}) => {
    await installTurnstileShim(context);
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    const rpcPayloadBytes: Record<string, number[]> = {};
    const legacyCalls: string[] = [];

    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('response', async (response) => {
      const match = new URL(response.url()).pathname.match(/\/rpc\/([^/]+)$/);
      if (!match) return;
      const rpc = match[1];
      if (rpc === 'get_admin_product_listing') legacyCalls.push(response.url());
      if (!['get_admin_product_page', 'get_admin_inventory_product_page', 'search_admin_products'].includes(rpc)) return;
      const body = await response.body().catch(() => Buffer.alloc(0));
      (rpcPayloadBytes[rpc] ||= []).push(body.byteLength);
    });

    await page.route('**/rest/v1/rpc/get_admin_product_page', async (route) => {
      const body = route.request().postDataJSON() as {p_search?: string | null};
      if (body?.p_search === 'LCAT-000001') {
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      await route.continue();
    });

    await page.goto(baseUrl!);
    await expect(page.getByText('تم التحقق ✓')).toBeVisible();
    await page.locator('input[type="email"]').fill(email!);
    await page.locator('input[type="password"]').fill(password!);
    await page.getByRole('button', {name: 'تسجيل الدخول', exact: true}).click();
    await expect(page.locator('main')).toBeVisible({timeout: 30_000});

    const productsStartedAt = Date.now();
    await openMoreDestination(page, 'products-inventory', 'catalog-products');
    await expect(page.locator('[data-product-catalog-card]')).toHaveCount(24, {timeout: 30_000});
    const productsMs = Date.now() - productsStartedAt;
    const productsDomNodes = await page.locator('*').count();
    expect(productsDomNodes).toBeLessThan(6_000);

    const productSearch = page.getByPlaceholder('اسم المنتج، SKU أو الباركود');
    await productSearch.fill('LCAT-000001');
    await page.waitForTimeout(320);
    await productSearch.fill('LCAT-004999');
    await expect(page.locator('[data-product-catalog-card]:visible').filter({hasText: 'LCAT-004999'}))
      .toHaveCount(1, {timeout: 15_000});
    await expect(page.locator('[data-product-catalog-card]:visible').filter({hasText: 'LCAT-000001'}))
      .toHaveCount(0);

    const inventoryStartedAt = Date.now();
    await page.locator('[data-bottom-tab="inventory"]').click();
    await expect(page.locator('[data-inventory-product-card]')).toHaveCount(24, {timeout: 30_000});
    const inventoryMs = Date.now() - inventoryStartedAt;
    const inventoryDomNodes = await page.locator('*').count();
    expect(inventoryDomNodes).toBeLessThan(7_000);

    const inventorySearch = page.getByPlaceholder('ابحث باسم المنتج، الكود SKU، أو الباركود...');
    await inventorySearch.fill('LCAT-005000');
    await expect(page.locator('[data-inventory-product-card]:visible').filter({hasText: 'LCAT-005000'}))
      .toHaveCount(1, {timeout: 15_000});

    const posStartedAt = Date.now();
    await openMoreDestination(page, 'sales', 'sales-pos');
    const posCards = page.locator('[data-pos-product-card]:visible');
    await expect(posCards.first()).toBeVisible({timeout: 30_000});
    expect(await posCards.count()).toBeLessThanOrEqual(40);
    const posMs = Date.now() - posStartedAt;
    const posSearch = page.getByPlaceholder('ابحث باسم المنتج أو الباركود أو SKU...');
    await posSearch.fill('LCAT-003333');
    await expect(page.locator('[data-pos-product-card]:visible').filter({hasText: '9900000003333'}))
      .toHaveCount(1, {timeout: 15_000});

    await openMoreDestination(page, 'suppliers-purchases', 'supplier-receiving');
    await expect(page.getByRole('heading', {name: 'استلام البضائع من الموردين'})).toBeVisible({timeout: 30_000});
    await page.getByRole('button', {name: 'استلام بضاعة جديد'}).first().click();
    const receivingSearch = page.getByPlaceholder(/SKU، أو الباركود لإضافته لسند الاستلام/);
    await receivingSearch.fill('LCAT-004444');
    await expect(page.locator('[data-receiving-product-result]:visible').filter({hasText: 'LCAT-004444'}))
      .toHaveCount(1, {timeout: 15_000});

    for (const sizes of Object.values(rpcPayloadBytes)) {
      expect(Math.max(...sizes)).toBeLessThan(250_000);
    }
    expect(legacyCalls).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(productsMs).toBeLessThan(30_000);
    expect(inventoryMs).toBeLessThan(30_000);
    expect(posMs).toBeLessThan(30_000);

    console.log(JSON.stringify({
      browserName,
      productsMs,
      inventoryMs,
      posMs,
      productsDomNodes,
      inventoryDomNodes,
      rpcPayloadBytes,
    }));
  });
});
