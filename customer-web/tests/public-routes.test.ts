import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getCategoryPath,
  getProductPath,
  getStorePagePath,
  readStoreLocationRoute,
} from '../src/utils/publicRoutes';

function location(pathname: string, hash = '') {
  return {pathname, hash} as Pick<Location, 'pathname' | 'hash'>;
}

test('public SEO paths map to the existing storefront destinations', () => {
  assert.equal(readStoreLocationRoute(location('/')).page, 'home');
  assert.equal(readStoreLocationRoute(location('/products')).page, 'catalog');
  assert.equal(readStoreLocationRoute(location('/offers')).page, 'offers');
  assert.deepEqual(readStoreLocationRoute(location('/category/drinks')), {
    page: 'catalog', productKey: '', categorySlug: 'drinks', trackingToken: '', receiptToken: '', isLegacyHash: false,
  });
  assert.equal(readStoreLocationRoute(location('/product/NWS-100')).productKey, 'NWS-100');
});

test('legacy shared product and private tracking hashes remain compatible', () => {
  const legacyProduct = readStoreLocationRoute(location('/', '#product=NWS%20100%2F2'));
  assert.equal(legacyProduct.productKey, 'NWS 100/2');
  assert.equal(legacyProduct.isLegacyHash, true);
  const tracking = readStoreLocationRoute(location('/', '#track=12345678-1234-1234-1234-123456789012'));
  assert.equal(tracking.trackingToken, '12345678-1234-1234-1234-123456789012');
  assert.equal(getStorePagePath('catalog'), '/products');
  assert.equal(getCategoryPath('drinks & juice'), '/category/drinks%20%26%20juice');
  assert.equal(getProductPath('NWS 100/2'), '/product/NWS%20100%2F2');
});
