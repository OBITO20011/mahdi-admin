import { test, expect, type Page } from './isolated-test';

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});

const base = process.env.CUSTOMER_BASE_URL ?? 'http://127.0.0.1:4174';
const rpc = '**/rest/v1/rpc/public_storefront_catalog_page225';
const products = [
  { nameAr: 'مياه ليمون', sku: 'SEARCH-LIME', barcode: '6290000000001' },
  { nameAr: 'عصير خوخ', sku: 'SEARCH-PEACH', barcode: '6290000000002' },
  { nameAr: 'بسكويت تمر', sku: 'SEARCH-DATE', barcode: '6290000000003' },
].map((product, index) => ({
  ...product,
  id: `00000000-0000-4000-8000-00000000070${index}`,
  saleUnitId: '00000000-0000-4000-8000-000000000701',
  unitNameAr: 'باكيت',
  unitsPerSalePackage: 1,
  salePriceInMinorUnits: 1200,
  salePackagePriceInMinorUnits: 1200,
  availableQuantity: 24,
  availableSalePackages: 24,
  isAvailable: true,
}));

function catalog(items: typeof products) {
  return {
    items,
    categories: [],
    brands: [],
    saleUnits: [],
    limit: 24,
    offset: 0,
    total: items.length,
    summary: { availableProducts: items.length, availableSalePackages: items.length * 24, lowStockProducts: 0 },
  };
}

async function openSearch(page: Page) {
  await page.goto(base + '/products/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('catalog-products-grid').locator('article')).toHaveCount(3);
  await page.getByRole('button', { name: 'فتح البحث' }).tap();
  return page.locator('#mobile-catalog-search');
}

test('mobile storefront searches Arabic, SKU and barcode and reports a missing result', async ({ page }) => {
  const searches: string[] = [];
  await page.route(rpc, async route => {
    const search: string | null = route.request().postDataJSON().p_search;
    if (search) searches.push(search);
    const items = search
      ? products.filter(product => [product.nameAr, product.sku, product.barcode].some(value => value.includes(search)))
      : products;
    await route.fulfill({ json: catalog(items) });
  });
  const search = await openSearch(page);
  const cards = page.getByTestId('catalog-products-grid').locator('article');

  for (const [input, name] of [
    ['ليمون', 'مياه ليمون'],
    ['SEARCH-PEACH', 'عصير خوخ'],
    ['6290000000003', 'بسكويت تمر'],
  ]) {
    await search.fill(input);
    await expect(search).toHaveValue(input);
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText(name);
    await expect(search).toHaveAttribute('aria-busy', 'false');
  }

  await search.fill('غير موجود في الكتالوج');
  await expect(page.getByRole('heading', { name: 'لا توجد نتيجة مطابقة' })).toBeVisible();
  await expect(cards).toHaveCount(0);
  expect(searches).toEqual(['ليمون', 'SEARCH-PEACH', '6290000000003', 'غير موجود في الكتالوج']);
});

test('mobile storefront debounces a burst and discards a delayed obsolete result', async ({ page }) => {
  const searches: string[] = [];
  const cancelled: string[] = [];
  let releaseOld!: () => void;
  const waitingForOld = new Promise<void>(resolve => { releaseOld = resolve; });
  page.on('requestfailed', request => {
    if (request.url().endsWith('/rpc/public_storefront_catalog_page225')) {
      cancelled.push(request.postDataJSON().p_search);
    }
  });
  await page.route(rpc, async route => {
    const search: string | null = route.request().postDataJSON().p_search;
    if (search) searches.push(search);
    if (search === 'ليمون') {
      await waitingForOld;
      // An aborted browser request may no longer accept its reply.
      await route.fulfill({ json: catalog([products[0]]) }).catch(() => {});
      return;
    }
    await route.fulfill({ json: catalog(search ? [products[2]] : products) });
  });

  try {
    const search = await openSearch(page);
    await search.fill('ليمون');
    await expect.poll(() => searches).toEqual(['ليمون']);
    await expect(page.getByRole('status').filter({ hasText: 'جاري البحث…' })).toBeVisible();
    await expect(page.getByText('مياه ليمون', { exact: true })).toHaveCount(0);

    const clockStart = new Date('2026-11-26T12:00:00Z');
    await page.clock.install({ time: clockStart });
    await page.clock.pauseAt(new Date(clockStart.getTime() + 10000));
    for (const input of ['ت', 'تم', 'تمر']) {
      await search.fill(input);
      await expect(search).toHaveValue(input);
    }
    await expect(search).toHaveAttribute('aria-busy', 'true');
    await page.clock.runFor(200);

    const cards = page.getByTestId('catalog-products-grid').locator('article');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('بسكويت تمر');
    await expect.poll(() => cancelled).toContain('ليمون');
    expect(searches).toEqual(['ليمون', 'تمر']);
    releaseOld();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('بسكويت تمر');
    await expect(search).toHaveAttribute('aria-busy', 'false');
  } finally {
    releaseOld();
  }
});
