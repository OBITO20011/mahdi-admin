import {access, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const origin = 'https://alnawasreh.com';
const officialName = 'محلات النواصرة التجارية';

function invariant(condition, message) {
  if (!condition) throw new Error(`SEO verification failed: ${message}`);
}

function occurrences(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

function structuredData(html) {
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/u);
  invariant(match, 'JSON-LD is missing');
  return JSON.parse(match[1]);
}

function graphTypes(schema) {
  return new Set((Array.isArray(schema?.['@graph']) ? schema['@graph'] : [schema]).map((item) => item?.['@type']));
}

async function readRoute(route) {
  const output = route === '/'
    ? path.join(dist, 'index.html')
    : path.join(dist, ...route.split('/').filter(Boolean), 'index.html');
  await access(output);
  return readFile(output, 'utf8');
}

const sitemap = await readFile(path.join(dist, 'sitemap.xml'), 'utf8');
const robots = await readFile(path.join(dist, 'robots.txt'), 'utf8');
const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => match[1]);

invariant(locations.length >= 3, 'sitemap has no public routes');
invariant(new Set(locations).size === locations.length, 'sitemap contains duplicate URLs');
invariant(locations.every((location) => location.startsWith(`${origin}/`)), 'sitemap contains a non-canonical origin');
invariant(locations.every((location) => !/pages\.dev|\/admin|\/checkout|\/tracking|\/receipt|\/favorites|\/search/u.test(location)), 'sitemap contains a backup, Admin, or private URL');
invariant(robots.includes(`Sitemap: ${origin}/sitemap.xml`), 'robots points to the wrong sitemap');

const rootHtml = await readRoute('/');
invariant(rootHtml.includes(`<title>${officialName} |`), 'homepage title does not use the official entity name');
invariant(rootHtml.includes(`rel="canonical" href="${origin}/"`), 'homepage canonical is invalid');
invariant(rootHtml.includes(`property="og:image" content="${origin}/nawasrah-store-logo.jpg"`), 'homepage social image is missing');
const rootTypes = graphTypes(structuredData(rootHtml));
invariant(rootTypes.has('Store') && rootTypes.has('WebSite'), 'homepage entity graph is incomplete');

const productLocation = locations.find((location) => location.startsWith(`${origin}/product/`));
const categoryLocation = locations.find((location) => location.startsWith(`${origin}/category/`));
if (productLocation) {
  const productRoute = new URL(productLocation).pathname;
  const html = await readRoute(productRoute);
  const types = graphTypes(structuredData(html));
  invariant(types.has('Product') && types.has('BreadcrumbList'), 'product schema is incomplete');
  invariant(html.includes(`rel="canonical" href="${productLocation}"`), 'product canonical does not match sitemap');
  invariant(html.includes('property="og:type" content="product"'), 'product Open Graph type is missing');
  invariant(!/wac|supplier|reservedQuantity|availableQuantity/iu.test(html), 'product SEO leaks a private field');
}
if (categoryLocation) {
  const categoryRoute = new URL(categoryLocation).pathname;
  const html = await readRoute(categoryRoute);
  const types = graphTypes(structuredData(html));
  invariant(types.has('CollectionPage') && types.has('BreadcrumbList'), 'category schema is incomplete');
  invariant(html.includes(`rel="canonical" href="${categoryLocation}"`), 'category canonical does not match sitemap');
}

for (const location of locations) {
  invariant(location === `${origin}/` || new URL(location).pathname.endsWith('/'), `canonical route causes a redirect: ${location}`);
  const html = await readRoute(new URL(location).pathname);
  invariant(occurrences(html, /rel="canonical"/gu) === 1, `canonical is duplicated: ${location}`);
  invariant(!html.includes('pages.dev'), `generated SEO contains pages.dev: ${location}`);
}

console.log(JSON.stringify({ok: true, sitemapUrls: locations.length, productChecked: Boolean(productLocation), categoryChecked: Boolean(categoryLocation)}));
