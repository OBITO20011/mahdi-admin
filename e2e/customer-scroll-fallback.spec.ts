import {expect, test} from './isolated-test';

const base = process.env.CUSTOMER_BASE_URL ?? 'http://127.0.0.1:4174';
const products = Array.from({length: 4}, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(i + 901).padStart(12, '0')}`, sku: `SCROLL-${i}`, barcode: '', nameAr: `منتج اختبار ${i}`, description: '',
  categoryId: '00000000-0000-4000-8000-000000000010', categoryCode: 'SCROLL', categoryNameAr: 'اختبار', brandId: '', brandNameAr: '',
  unitId: '00000000-0000-4000-8000-000000000020', unitNameAr: 'باكيت', saleUnitId: '00000000-0000-4000-8000-000000000021', saleUnitNameAr: 'طرد',
  unitsPerSalePackage: 6, salePackagePriceInMinorUnits: 6000, salePriceInMinorUnits: 1000, availableQuantity: 60, availableSalePackages: 10,
  minimumOrderPackages: 1, imageUrl: '', isAvailable: true, createdAt: '2026-11-01T00:00:00Z', soldPackagesLast90Days: 0, flavorMasterProductId: null,
  flavorNameAr: null, isFlavorMaster: false, flavorSortOrder: 0,
}));

for (const missing of [false, true]) test(`merchandising rail scrolls at390;native API ${missing ? 'missing uses direct positions' : 'keeps smooth behavior'}`, async ({page}, info) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.addInitScript(({missing}) => {
    const calls: ScrollToOptions[] = [];Object.assign(window, {__scrollCalls: calls});
    const native = Element.prototype.scrollTo;
    Object.defineProperty(Element.prototype, 'scrollTo', {configurable: true, value: missing ? undefined : function (this: Element, options: ScrollToOptions) {calls.push({...options}); return Reflect.apply(native, this, [options]);}});
    if (missing) Object.defineProperty(window, 'scrollTo', {configurable: true, value: undefined});
  }, {missing});
  const errors: string[] = [];page.on('pageerror', e => errors.push(e.message));
  await page.route('**/rest/v1/rpc/get_public_storefront_settings', route => route.fulfill({json: {
    storeNameAr: 'متجر الاختبار', ordersEnabled: true, minimumOrderInMinorUnits: 0, deliveryFeeInMinorUnits: 0,
    insideRamthaDeliveryFeeInMinorUnits: 0, outsideRamthaDeliveryFeeInMinorUnits: 0, showNewestProducts: true, showBestSellers: false, showOffers: false, showLowStock: false,
  }}));
  await page.route('**/rest/v1/rpc/get_public_storefront_catalog_page', route => route.fulfill({json: {items: products, categories: [], brands: [], saleUnits: [],
    summary: {availableProducts: 4, availableSalePackages: 40, lowStockProducts: 0}, total: 4, limit: 24, offset: 0}}));
  await page.route('**/rest/v1/rpc/get_public_storefront_merchandising', route => route.fulfill({json: {newest: products, bestSellers: [], offers: [], lowStock: []}}));
  await page.goto(base);
  const rail = page.getByRole('region', {name: 'منتجات وصل حديثًا', exact: true});await expect(rail).toBeVisible();
  await page.getByRole('button', {name: 'المنتج التالي في وصل حديثًا', exact: true}).click();
  await expect.poll(() => rail.evaluate(e => Math.abs(e.scrollLeft))).toBeGreaterThan(10);
  const calls = await page.evaluate(() => (window as unknown as {__scrollCalls: ScrollToOptions[]}).__scrollCalls);
  if (missing) expect(calls).toEqual([]);else expect(calls.some(o => o.behavior === 'smooth' && typeof o.left === 'number')).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({path: info.outputPath(`rail-${missing ? 'fallback' : 'native'}-390.png`)});
});
