import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(
  readFileSync('public/manifest.webmanifest', 'utf8'),
);
const serviceWorker = readFileSync('public/sw.js', 'utf8');
const indexHtml = readFileSync('index.html', 'utf8');
const main = readFileSync('src/main.tsx', 'utf8');
const pwaRegistration = readFileSync('src/pwa/pwa.ts', 'utf8');
const installPanel = readFileSync(
  'src/features/more/InstallAppPanel.tsx',
  'utf8',
);

test('admin app exposes a valid standalone Arabic manifest', () => {
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.lang, 'ar');
  assert.equal(manifest.dir, 'rtl');
  assert.ok(manifest.icons.some((icon: {sizes: string}) => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some((icon: {sizes: string}) => icon.sizes === '512x512'));
  assert.match(indexHtml, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(indexHtml, /rel="apple-touch-icon"/);
});

test('service worker caches only the local shell and never Supabase traffic', () => {
  assert.match(serviceWorker, /url\.origin !== self\.location\.origin/);
  assert.match(serviceWorker, /request\.method !== 'GET'/);
  assert.doesNotMatch(serviceWorker, /supabase\.co.*cache/i);
  assert.doesNotMatch(serviceWorker, /event\.request\.method === 'POST'/);
  assert.doesNotMatch(serviceWorker, /cache\.put\('\/',/);
  assert.match(serviceWorker, /event\.respondWith\(fetch\(request\)\)/);
  assert.match(main, /registerAdminServiceWorker/);
});

test('installed app checks for updates and reloads once when a new worker controls it', () => {
  assert.match(pwaRegistration, /registration\.update\(\)/);
  assert.match(pwaRegistration, /controllerchange/);
  assert.match(pwaRegistration, /window\.location\.reload\(\)/);
  assert.match(pwaRegistration, /__NAWASRAH_BUILD_ID__/);
  assert.match(serviceWorker, /new URL\(self\.location\.href\)\.searchParams\.get\('build'\)/);
  assert.match(serviceWorker, /nawasrah-admin-shell-\$\{buildId\}/);
});

test('iPhone users get visible manual installation instructions', () => {
  assert.match(installPanel, /تثبيت التطبيق على iPhone/);
  assert.match(installPanel, /إضافة إلى الشاشة الرئيسية/);
  assert.match(installPanel, /متصفح Safari/);
});
