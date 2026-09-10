import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {SEO_BRAND} from '../src/config/seoBrand';
import {getCategoryPath, getProductPath, getStorePagePath} from '../src/utils/publicRoutes';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('official brand entity is the single runtime SEO identity', () => {
  assert.equal(SEO_BRAND.officialName, 'محلات النواصرة التجارية');
  assert.equal(SEO_BRAND.alternateName, 'محلات مهدي النواصرة التجارية');
  assert.equal(SEO_BRAND.foundingYear, 2000);
  assert.deepEqual(SEO_BRAND.socialProfiles, ['https://www.facebook.com/profile.php?id=100042236486849']);
  assert.match(SEO_BRAND.homepageTitle, /^محلات النواصرة التجارية \|/u);
});

test('public canonicals use one HTTPS origin and final slash-normalized paths', () => {
  assert.equal(getStorePagePath('catalog'), '/products/');
  assert.equal(getStorePagePath('offers'), '/offers/');
  assert.equal(getStorePagePath('about'), '/about/');
  assert.equal(getCategoryPath('CAT-WATER'), '/category/CAT-WATER/');
  assert.equal(getProductPath('NWS-12'), '/product/NWS-12/');
});

test('runtime SEO includes entity, breadcrumb, product, offer and social metadata without private data', () => {
  const seo = read('../src/utils/storefrontSeo.ts');
  assert.match(seo, /'@type': 'Store'/u);
  assert.match(seo, /'@type': 'WebSite'/u);
  assert.match(seo, /'@type': 'BreadcrumbList'/u);
  assert.match(seo, /'@type': 'Product'/u);
  assert.match(seo, /'@type': 'Offer'/u);
  assert.match(seo, /sameAs: SEO_BRAND\.socialProfiles/u);
  assert.match(seo, /summary_large_image/u);
  assert.doesNotMatch(seo, /WAC|supplier|reservedQuantity|availableQuantity/u);
});

test('static SEO generator validates every generated route and excludes private surfaces', () => {
  const generator = read('../scripts/generate-seo-pages.mjs');
  const verifier = read('../scripts/verify-seo-output.mjs');
  assert.match(generator, /officialName = 'محلات النواصرة التجارية'/u);
  assert.match(generator, /sameAs: socialProfiles/u);
  assert.match(generator, /pageSchema\('AboutPage'/u);
  assert.match(generator, /BreadcrumbList/u);
  assert.match(generator, /summary_large_image/u);
  assert.match(verifier, /sitemap contains a backup, Admin, or private URL/u);
  assert.match(verifier, /generated SEO contains pages\.dev/u);
});

test('catalog and category UI expose crawlable links while keeping current SPA handlers', () => {
  const productCard = read('../src/components/ProductCard.tsx');
  const categories = read('../src/components/HomeCategoryMosaic.tsx');
  const categoryShowcase = read('../src/components/CategoryShowcase.tsx');
  assert.match(productCard, /href=\{getProductPath\(product\.sku \|\| product\.id\)\}/u);
  assert.match(categories, /href=\{getCategoryPath\(getCategorySlug\(category\)\)\}/u);
  assert.match(categoryShowcase, /href=\{category\.id === 'all'/u);
});

test('unsupported clean paths have a noindex HTTP 404 without breaking dynamic product routes', () => {
  const handler = read('../functions/[[path]].js');
  assert.match(handler, /status: 404/u);
  assert.match(handler, /X-Robots-Tag.*noindex, nofollow, noarchive/us);
  assert.match(handler, /product\\\/\[\^\/\]\+/u);
  assert.match(handler, /about\\\/\?\$/u);
  assert.match(handler, /site\\\.webmanifest/u);
  assert.match(handler, /favicon-\(\?:48\|96\|192\|512\)\\\.png/u);
});
