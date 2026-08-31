import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const siteOrigin = (process.env.VITE_PUBLIC_SITE_ORIGIN || 'https://nawasrah-store.pages.dev').replace(/\/+$/, '');
const config = await readFile(path.join(root, 'src', 'config', 'supabase-public-config.ts'), 'utf8');
const url = config.match(/SUPABASE_URL:\s*'([^']+)'/)?.[1];
const key = config.match(/SUPABASE_PUBLISHABLE_KEY:\s*'([^']+)'/)?.[1];

if (!url || !key) throw new Error('Customer public Supabase configuration is unavailable for SEO generation.');

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
const escapedJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
const routeUrl = (route) => `${siteOrigin}${route}`;
const productRoute = (keyValue) => `/product/${encodeURIComponent(keyValue)}`;
const categoryRoute = (slug) => `/category/${encodeURIComponent(slug)}`;

async function callCatalog(offset) {
  const response = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/rpc/get_public_storefront_catalog_page`, {
    method: 'POST',
    headers: {apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({
      p_limit: 48, p_offset: offset, p_category_id: null, p_search: null,
      p_availability: 'available', p_sort: 'recommended', p_brand_id: null,
      p_sale_unit_id: null, p_product_ids: null,
    }),
  });
  if (!response.ok) throw new Error(`Catalog RPC returned ${response.status} while generating SEO pages.`);
  return response.json();
}

async function callOffers() {
  const response = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/rpc/get_public_storefront_offers`, {
    method: 'POST',
    headers: {apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
    body: '{}',
  });
  if (!response.ok) throw new Error(`Offers RPC returned ${response.status} while generating SEO pages.`);
  return response.json();
}

function injectHead(shell, {title, description, canonical, schema, image}) {
  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    '<meta name="robots" content="index, follow, max-image-preview:large" />',
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    ...(image ? [`<meta property="og:image" content="${escapeHtml(image)}" />`] : []),
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    ...(schema ? [`<script type="application/ld+json">${escapedJson(schema)}</script>`] : []),
  ].join('\n    ');
  const withoutExistingSeo = shell
    .replace(/<meta\s+name="description"[\s\S]*?\/>/, '')
    .replace(/<meta\s+property="og:title"[\s\S]*?\/>/, '')
    .replace(/<meta\s+property="og:description"[\s\S]*?\/>/, '')
    .replace(/<meta\s+name="twitter:title"[\s\S]*?\/>/, '')
    .replace(/<meta\s+name="twitter:description"[\s\S]*?\/>/, '');
  return withoutExistingSeo.replace(/<title>[\s\S]*?<\/title>/, tags);
}

async function writeRoute(route, html) {
  const output = route === '/' ? path.join(dist, 'index.html') : path.join(dist, ...route.split('/').filter(Boolean), 'index.html');
  await mkdir(path.dirname(output), {recursive: true});
  await writeFile(output, html, 'utf8');
}

const shell = await readFile(path.join(dist, 'index.html'), 'utf8');
const allProducts = [];
let catalog = await callCatalog(0);
const categories = Array.isArray(catalog.categories) ? catalog.categories : [];
while (true) {
  allProducts.push(...(Array.isArray(catalog.items) ? catalog.items : []));
  const nextOffset = Number(catalog.offset || 0) + Number(catalog.limit || 48);
  if (nextOffset >= Number(catalog.total || 0) || !Array.isArray(catalog.items) || catalog.items.length === 0) break;
  catalog = await callCatalog(nextOffset);
}
const offersPayload = await callOffers();
const offers = Array.isArray(offersPayload?.offers) ? offersPayload.offers : [];

await writeRoute('/', injectHead(shell, {
  title: 'محلات النواصرة | طلبات الجملة',
  description: 'كتالوج محلات النواصرة لطلبات الجملة من المخزون مباشرة.',
  canonical: routeUrl('/'),
  schema: {'@context': 'https://schema.org', '@type': 'Store', name: 'محلات النواصرة', url: routeUrl('/')},
}));
await writeRoute('/products', injectHead(shell, {
  title: 'المنتجات بالجملة | محلات النواصرة',
  description: 'تصفح كتالوج منتجات الجملة المتاحة من محلات النواصرة.', canonical: routeUrl('/products'),
}));
await writeRoute('/offers', injectHead(shell, {
  title: 'العروض | محلات النواصرة', description: 'العروض العامة المتاحة حاليًا من محلات النواصرة.', canonical: routeUrl('/offers'),
  schema: offers.length > 0 ? {
    '@context': 'https://schema.org', '@type': 'OfferCatalog', name: 'عروض محلات النواصرة',
    itemListElement: offers.slice(0, 20).map((offer, position) => ({
      '@type': 'Offer', position: position + 1, name: offer.code,
      description: offer.description_ar || `عرض ${offer.code}`, url: routeUrl('/offers'),
      validFrom: offer.starts_at || undefined, validThrough: offer.expires_at || undefined,
    })),
  } : undefined,
}));

const sitemapRoutes = [
  {route: '/', changefreq: 'daily', priority: '1.0'},
  {route: '/products', changefreq: 'daily', priority: '0.9'},
  {route: '/offers', changefreq: 'daily', priority: '0.8'},
];
for (const category of categories) {
  const slug = String(category.code || category.id || '').trim();
  if (!slug || Number(category.availableProductCount || 0) <= 0) continue;
  const route = categoryRoute(slug);
  sitemapRoutes.push({route, changefreq: 'daily', priority: '0.8'});
  await writeRoute(route, injectHead(shell, {
    title: `${category.nameAr} | محلات النواصرة`, description: `تصفح أصناف ${category.nameAr} بالجملة من محلات النواصرة.`, canonical: routeUrl(route),
  }));
}
const seenProductRoutes = new Set();
for (const product of allProducts) {
  const productKey = String(product.sku || product.id || '').trim();
  if (!productKey) continue;
  const route = productRoute(productKey);
  if (seenProductRoutes.has(route)) continue;
  seenProductRoutes.add(route);
  sitemapRoutes.push({route, changefreq: 'daily', priority: '0.7'});
  const image = /^https:\/\//i.test(String(product.imageUrl || '')) ? product.imageUrl : undefined;
  await writeRoute(route, injectHead(shell, {
    title: `${product.nameAr} | محلات النواصرة`, description: product.description || `اطلب ${product.nameAr} بالجملة من محلات النواصرة.`, canonical: routeUrl(route), image,
    schema: {
      '@context': 'https://schema.org', '@type': 'Product', name: product.nameAr, sku: product.sku,
      description: product.description || undefined, ...(image ? {image: [image]} : {}),
      offers: {'@type': 'Offer', priceCurrency: 'JOD', price: (Number(product.salePackagePriceInMinorUnits || 0) / 1000).toFixed(3), availability: product.isAvailable ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', url: routeUrl(route)},
    },
  }));
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapRoutes.map(({route, changefreq, priority}) => `  <url><loc>${escapeHtml(routeUrl(route))}</loc><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`).join('\n')}\n</urlset>\n`;
await writeFile(path.join(dist, 'sitemap.xml'), sitemap, 'utf8');
await writeFile(path.join(dist, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /cart\nDisallow: /checkout\nDisallow: /favorites\nDisallow: /tracking\nDisallow: /receipt\nDisallow: /search\nSitemap: ${routeUrl('/sitemap.xml')}\n`, 'utf8');
console.log(JSON.stringify({ok: true, origin: siteOrigin, categoryRoutes: sitemapRoutes.filter(({route}) => route.startsWith('/category/')).length, productRoutes: seenProductRoutes.size, sitemapUrls: sitemapRoutes.length}));
