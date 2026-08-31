import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const checkout = readFileSync(
  new URL('../src/components/CheckoutModal.tsx', import.meta.url),
  'utf8'
);
const service = readFileSync(
  new URL('../src/services/storefront-settings.service.ts', import.meta.url),
  'utf8'
);
const catalogService = readFileSync(
  new URL('../src/services/catalog.service.ts', import.meta.url),
  'utf8'
);

test('customer site receives public settings from Supabase', () => {
  assert.match(service, /rpc\('get_public_storefront_settings'\)/);
  assert.match(app, /fetchPublicStorefrontSettings/);
  assert.match(app, /storefrontSettings\.whatsappNumber/);
  assert.doesNotMatch(service, /purchase|supplier|costPrice|updatedBy/);
});

test('checkout shows and validates database-controlled order rules', () => {
  assert.match(checkout, /storefrontSettings\.ordersEnabled/);
  assert.match(checkout, /storefrontSettings\.minimumOrderInMinorUnits/);
  assert.match(checkout, /storefrontSettings\.insideRamthaDeliveryFeeInMinorUnits/);
  assert.match(checkout, /storefrontSettings\.outsideRamthaDeliveryFeeInMinorUnits/);
  assert.match(checkout, /deliveryZone/);
  assert.match(checkout, /storefrontSettings\.cliqAlias/);
  assert.match(app, /الطلبات متوقفة مؤقتًا/);
});

test('homepage sections respect public settings while keeping real data sources', () => {
  assert.match(app, /storefrontSettings\.showNewestProducts \? newestProducts : \[\]/);
  assert.match(app, /storefrontSettings\.showBestSellers \? bestSellerProducts : \[\]/);
  assert.match(app, /storefrontSettings\.showOffers \? offerProducts : \[\]/);
  assert.match(app, /storefrontSettings\.showLowStock \? lowStockProducts : \[\]/);
  assert.match(app, /loadFeaturedProducts/);
  assert.match(catalogService, /get_public_storefront_catalog_page/);
});

test('home merchandising uses one bounded RPC instead of four independent catalog reads', () => {
  assert.match(catalogService, /rpc\('get_public_storefront_merchandising'\)/);
  assert.match(app, /setFeaturedProducts\(await fetchPublicStorefrontMerchandising\(\)\)/);
  assert.doesNotMatch(app, /fetchPublicProductCatalog\(\{ limit: 6, sort: 'newest' \}\)/);
});
