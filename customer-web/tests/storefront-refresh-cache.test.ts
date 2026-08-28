import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync('src/App.tsx', 'utf8');

test('storefront does not poll the complete public data set on a fixed interval', () => {
  assert.doesNotMatch(app, /window\.setInterval\(/);
  assert.match(app, /CATALOG_STALE_TIME_MS = 90_000/);
  assert.match(app, /OFFERS_STALE_TIME_MS = 5 \* 60_000/);
  assert.match(app, /STOREFRONT_SETTINGS_STALE_TIME_MS = 10 \* 60_000/);
});

test('storefront coalesces same-query requests and refreshes stale catalog data only while visible', () => {
  assert.match(app, /pendingLoadRef/);
  assert.match(app, /catalogRequestKeyRef\.current === catalogQueryKey/);
  assert.match(app, /catalogRequestSequenceRef/);
  assert.match(app, /if \(document\.visibilityState !== 'visible'\) return/);
  assert.match(app, /document\.addEventListener\('visibilitychange', handleVisibilityChange\)/);
  assert.match(app, /CATALOG_STALE_TIME_MS - elapsedMs \+ 50/);
});

test('manual retry and reconnect continue to force a fresh public catalog read', () => {
  assert.match(app, /onRefresh=\{\(\) => void loadCatalog\(true, true\)\}/);
  assert.match(app, /onRetry=\{\(\) => void loadCatalog\(true, true\)\}/);
  assert.match(app, /void loadCatalogRef\.current\(true, true\);/);
});
