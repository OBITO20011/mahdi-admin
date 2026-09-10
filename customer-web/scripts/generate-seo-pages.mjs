import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const siteOrigin = (process.env.VITE_PUBLIC_SITE_ORIGIN || 'https://alnawasreh.com').replace(/\/+$/, '');
const officialName = 'محلات النواصرة التجارية';
const alternateName = 'محلات مهدي النواصرة التجارية';
const socialProfiles = ['https://www.facebook.com/profile.php?id=100042236486849'];
const homepageTitle = `${officialName} | مواد غذائية ومشروبات بالجملة`;
const homepageDescription = 'تصفح منتجات الجملة من محلات النواصرة التجارية، واطلب المواد الغذائية والمشروبات المتوفرة مباشرة من المتجر.';
const aboutTitle = `عن ${officialName} | تجارة الجملة في الرمثا`;
const aboutDescription = `تعرف على ${officialName}، المعروفة أيضًا باسم ${alternateName}، لتجارة المواد الغذائية والسكاكر والعصائر بالجملة في الرمثا، الأردن.`;
const defaultImage = `${siteOrigin}/nawasrah-store-logo.jpg`;
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
const productRoute = (keyValue) => `/product/${encodeURIComponent(keyValue)}/`;
const categoryRoute = (slug) => `/category/${encodeURIComponent(slug)}/`;

function breadcrumbSchema(items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem', position: index + 1, name: item.name, item: routeUrl(item.route),
    })),
  };
}

function pageSchema(type, name, route) {
  return {
    '@type': type,
    '@id': `${routeUrl(route)}#webpage`,
    url: routeUrl(route),
    name,
    inLanguage: 'ar-JO',
    isPartOf: {'@id': `${routeUrl('/')}#website`},
  };
}

function graphSchema(...items) {
  return {'@context': 'https://schema.org', '@graph': items};
}

function homeSchema() {
  const homepage = routeUrl('/');
  return graphSchema(
    {
      '@type': 'Store', '@id': `${homepage}#organization`, name: officialName,
      alternateName, url: homepage,
      sameAs: socialProfiles,
      logo: {'@type': 'ImageObject', url: defaultImage}, image: defaultImage,
      telephone: '+962795957700',
      address: {'@type': 'PostalAddress', addressLocality: 'الرمثا', addressCountry: 'JO'},
    },
    {
      '@type': 'WebSite', '@id': `${homepage}#website`, url: homepage,
      name: officialName, alternateName, inLanguage: 'ar-JO',
      publisher: {'@id': `${homepage}#organization`},
    },
  );
}

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

function injectHead(shell, {title, description, canonical, schema, image = defaultImage, type = 'website'}) {
  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    '<meta name="robots" content="index, follow, max-image-preview:large" />',
    `<meta property="og:type" content="${type}" />`,
    '<meta property="og:locale" content="ar_JO" />',
    `<meta property="og:site_name" content="${escapeHtml(officialName)}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta property="og:image:alt" content="${escapeHtml(title)}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
    ...(schema ? [`<script type="application/ld+json">${escapedJson(schema)}</script>`] : []),
  ].join('\n    ');
  const withoutExistingSeo = shell
    .replace(/<meta\s+(?:name|property)="(?:description|robots|og:[^"]+|twitter:[^"]+)"[^>]*\/?>/g, '')
    .replace(/<link\s+rel="canonical"[^>]*\/?>/g, '')
    .replace(/<script\s+type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/g, '');
  return withoutExistingSeo.replace(/<title>[\s\S]*?<\/title>/, tags);
}

async function writeRoute(route, html) {
  const output = route === '/'
    ? path.join(dist, 'index.html')
    : path.join(dist, ...route.split('/').filter(Boolean), 'index.html');
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
  title: homepageTitle, description: homepageDescription, canonical: routeUrl('/'), schema: homeSchema(),
}));
await writeRoute('/products/', injectHead(shell, {
  title: `المنتجات بالجملة | ${officialName}`,
  description: `تصفح كتالوج منتجات الجملة المتاحة من ${officialName}.`,
  canonical: routeUrl('/products/'),
  schema: graphSchema(
    pageSchema('CollectionPage', 'المنتجات بالجملة', '/products/'),
    breadcrumbSchema([{name: 'الرئيسية', route: '/'}, {name: 'المنتجات', route: '/products/'}]),
  ),
}));
await writeRoute('/offers/', injectHead(shell, {
  title: `العروض | ${officialName}`,
  description: `تصفح عروض الجملة العامة المتاحة حاليًا من ${officialName}.`,
  canonical: routeUrl('/offers/'),
  schema: graphSchema(
    {
      '@type': 'OfferCatalog', name: `عروض ${officialName}`, url: routeUrl('/offers/'),
      itemListElement: offers.slice(0, 20).map((offer, position) => ({
        '@type': 'Offer', position: position + 1, name: offer.code,
        description: offer.description_ar || `عرض ${offer.code}`, url: routeUrl('/offers/'),
        validFrom: offer.starts_at || undefined, validThrough: offer.expires_at || undefined,
      })),
    },
    pageSchema('CollectionPage', 'العروض', '/offers/'),
    breadcrumbSchema([{name: 'الرئيسية', route: '/'}, {name: 'العروض', route: '/offers/'}]),
  ),
}));
await writeRoute('/about/', injectHead(shell, {
  title: aboutTitle,
  description: aboutDescription,
  canonical: routeUrl('/about/'),
  schema: graphSchema(
    pageSchema('AboutPage', 'عن محلات النواصرة التجارية', '/about/'),
    breadcrumbSchema([{name: 'الرئيسية', route: '/'}, {name: 'عن المحل', route: '/about/'}]),
  ),
}));

const sitemapRoutes = [
  {route: '/', changefreq: 'daily', priority: '1.0'},
  {route: '/products/', changefreq: 'daily', priority: '0.9'},
  {route: '/offers/', changefreq: 'daily', priority: '0.8'},
  {route: '/about/', changefreq: 'monthly', priority: '0.7'},
];
for (const category of categories) {
  const slug = String(category.code || category.id || '').trim();
  if (!slug || Number(category.availableProductCount || 0) <= 0) continue;
  const route = categoryRoute(slug);
  sitemapRoutes.push({route, changefreq: 'daily', priority: '0.8'});
  await writeRoute(route, injectHead(shell, {
    title: `${category.nameAr} | ${officialName}`,
    description: `تصفح أصناف ${category.nameAr} المتاحة للطلب بالجملة من ${officialName}.`,
    canonical: routeUrl(route),
    schema: graphSchema(
      pageSchema('CollectionPage', category.nameAr, route),
      breadcrumbSchema([
        {name: 'الرئيسية', route: '/'},
        {name: 'المنتجات', route: '/products/'},
        {name: category.nameAr, route},
      ]),
    ),
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
  const productImage = /^https:\/\//i.test(String(product.imageUrl || '')) ? product.imageUrl : null;
  const socialImage = productImage || defaultImage;
  const description = product.description || `اطلب ${product.nameAr} بالجملة من ${officialName}.`;
  const productNode = {
    '@type': 'Product', '@id': `${routeUrl(route)}#product`, url: routeUrl(route),
    name: product.nameAr, ...(product.sku ? {sku: product.sku} : {}), description,
    ...(productImage ? {image: [productImage]} : {}), brand: {'@type': 'Organization', name: officialName},
    offers: {
      '@type': 'Offer', priceCurrency: 'JOD',
      price: (Number(product.salePackagePriceInMinorUnits || 0) / 1000).toFixed(3),
      availability: product.isAvailable ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: routeUrl(route),
    },
  };
  await writeRoute(route, injectHead(shell, {
    title: `${product.nameAr} | ${officialName}`, description, canonical: routeUrl(route), image: socialImage, type: 'product',
    schema: graphSchema(
      productNode,
      pageSchema('WebPage', product.nameAr, route),
      breadcrumbSchema([
        {name: 'الرئيسية', route: '/'},
        {name: 'المنتجات', route: '/products/'},
        {name: product.nameAr, route},
      ]),
    ),
  }));
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapRoutes.map(({route, changefreq, priority}) => `  <url><loc>${escapeHtml(routeUrl(route))}</loc><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`).join('\n')}\n</urlset>\n`;
await writeFile(path.join(dist, 'sitemap.xml'), sitemap, 'utf8');
await writeFile(path.join(dist, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /cart\nDisallow: /checkout\nDisallow: /favorites\nDisallow: /tracking\nDisallow: /receipt\nDisallow: /search\nSitemap: ${routeUrl('/sitemap.xml')}\n`, 'utf8');
console.log(JSON.stringify({
  ok: true, origin: siteOrigin, brand: officialName,
  categoryRoutes: sitemapRoutes.filter(({route}) => route.startsWith('/category/')).length,
  productRoutes: seenProductRoutes.size, sitemapUrls: sitemapRoutes.length,
}));
