import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('Customer canonical origin is alnawasreh.com across runtime and static SEO', () => {
  assert.match(read('customer-web/.env.production'), /VITE_PUBLIC_SITE_ORIGIN=https:\/\/alnawasreh\.com/u);
  assert.match(read('customer-web/src/config/publicSite.ts'), /https:\/\/alnawasreh\.com/u);
  assert.match(read('customer-web/src/utils/storefrontSeo.ts'), /getPublicStorefrontUrl/u);
  assert.match(read('customer-web/scripts/generate-seo-pages.mjs'), /https:\/\/alnawasreh\.com/u);
  assert.match(read('customer-web/public/robots.txt'), /Sitemap: https:\/\/alnawasreh\.com\/sitemap\.xml/u);
});

test('www is a redirect-only Pages surface preserving the path', () => {
  assert.equal(
    read('infra/cloudflare/www-redirect/_redirects').trim(),
    '/* https://alnawasreh.com/:splat 301',
  );
});

test('new production origins are allowed while pages.dev compatibility remains', () => {
  const guestGateway = read('supabase/functions/submit-guest-order/index.ts');
  const staffGateway = read('supabase/functions/manage-staff-users/index.ts');
  const assistant = read('supabase/functions/admin-ai-assistant/index.ts');
  assert.match(guestGateway, /https:\/\/alnawasreh\.com/u);
  assert.match(guestGateway, /https:\/\/nawasrah-store\.pages\.dev/u);
  assert.match(staffGateway, /https:\/\/admin\.alnawasreh\.com/u);
  assert.match(staffGateway, /https:\/\/nawasrah-admin\.pages\.dev/u);
  assert.match(assistant, /https:\/\/admin\.alnawasreh\.com/u);
});

test('Admin stays noindex and monitoring targets final production hostnames', () => {
  assert.match(read('index.html'), /robots" content="noindex, nofollow, noarchive/u);
  assert.match(read('public/_headers'), /X-Robots-Tag: noindex, nofollow, noarchive/u);
  const watchdog = read('scripts/monitoring/run-developer-watchdog.mjs');
  const uptime = read('.github/workflows/public-uptime.yml');
  assert.match(watchdog, /https:\/\/admin\.alnawasreh\.com/u);
  assert.match(watchdog, /https:\/\/alnawasreh\.com/u);
  assert.match(uptime, /https:\/\/admin\.alnawasreh\.com/u);
  assert.match(uptime, /https:\/\/alnawasreh\.com/u);
});

test('Business order links open the canonical Admin domain', () => {
  const alerts = read('automation/n8n/workflows/nawasrah-alerts.json');
  assert.match(alerts, /https:\/\/admin\.alnawasreh\.com\/\?screen=orders&order=/u);
  assert.doesNotMatch(alerts, /https:\/\/nawasrah-admin\.pages\.dev\/\?screen=orders&order=/u);
});
