import {access, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hasPrivateSeoFields} from './seo-output-privacy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const buildEnvironment=JSON.parse(await readFile(path.join(dist,'nawasrah-environment.json'),'utf8'));
const origin=buildEnvironment.storeOrigin;
const staging=buildEnvironment.environment!=='production';
const officialName = 'النواصرة لتجارة الجملة والمواد الغذائية';

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
invariant(locations.every((location) => !/\/admin|\/checkout|\/tracking|\/receipt|\/favorites|\/search/u.test(location) && (staging || !location.includes('pages.dev'))), 'sitemap contains a backup, Admin, or private URL');
invariant(robots.includes(`Sitemap: ${origin}/sitemap.xml`), 'robots points to the wrong sitemap');

const rootHtml = await readRoute('/');
if(staging){invariant(robots.includes('Disallow: /\n'),'staging must disallow indexing');invariant(rootHtml.includes('noindex, nofollow, noarchive'),'staging must be noindex');}
invariant(rootHtml.includes(`<title>${officialName} |`), 'homepage title does not use the official entity name');
invariant(rootHtml.includes(`rel="canonical" href="${origin}/"`), 'homepage canonical is invalid');
invariant(rootHtml.includes(`property="og:image" content="${origin}/nawasrah-social-card.jpg"`), 'homepage social image is missing');
const rootTypes = graphTypes(structuredData(rootHtml));
invariant(rootTypes.has('Store') && rootTypes.has('WebSite'), 'homepage entity graph is incomplete');
invariant(rootHtml.includes('النواصرة لتجارة الجملة والمواد الغذائية'), 'homepage entity graph is missing the alternate business name');
invariant(rootHtml.includes('+962795957700'), 'homepage entity graph is missing the public business phone');

const aboutHtml = await readRoute('/about/');
const aboutTypes = graphTypes(structuredData(aboutHtml));
invariant(locations.includes(`${origin}/about/`), 'sitemap is missing the about page');
invariant(aboutTypes.has('AboutPage') && aboutTypes.has('BreadcrumbList'), 'about page schema is incomplete');
invariant(aboutHtml.includes('النواصرة لتجارة الجملة والمواد الغذائية'), 'about page is missing the alternate business name');
invariant(aboutHtml.includes('nawasrah-social-card.jpg'), 'about page is missing the brand share image');
invariant(aboutHtml.includes(`rel="canonical" href="${origin}/about/"`), 'about page canonical is invalid');

const productLocation = locations.find((location) => location.startsWith(`${origin}/product/`));
const categoryLocation = locations.find((location) => location.startsWith(`${origin}/category/`));
if (productLocation) {
  const productRoute = new URL(productLocation).pathname;
  const html = await readRoute(productRoute);
  const types = graphTypes(structuredData(html));
  invariant(types.has('Product') && types.has('BreadcrumbList'), 'product schema is incomplete');
  invariant(html.includes(`rel="canonical" href="${productLocation}"`), 'product canonical does not match sitemap');
  invariant(html.includes('property="og:type" content="product"'), 'product Open Graph type is missing');
  invariant(!hasPrivateSeoFields(html), 'product SEO leaks a private field');
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
  invariant(html.includes(`property="og:image" content="${origin}/nawasrah-social-card.jpg"`) && html.includes('property="og:image:width" content="1200"') && html.includes('property="og:image:height" content="630"') && html.includes(`name="twitter:image" content="${origin}/nawasrah-social-card.jpg"`), `share metadata missing: ${location}`);
  invariant(occurrences(html, /rel="canonical"/gu) === 1, `canonical is duplicated: ${location}`);
  invariant((staging || !html.includes('pages.dev')), `generated SEO contains pages.dev: ${location}`);
}

console.log(JSON.stringify({ok: true, sitemapUrls: locations.length, productChecked: Boolean(productLocation), categoryChecked: Boolean(categoryLocation)}));
