import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const generator = new URL('../customer-web/scripts/generate-seo-pages.mjs', import.meta.url);

test('SEO audit override rejects non-loopback and partial configuration before any fetch', () => {
  for (const overrides of [
    {NAWASRAH_SEO_AUDIT_API_URL: 'https://example.invalid', NAWASRAH_SEO_AUDIT_API_KEY: 'audit-key'},
    {NAWASRAH_SEO_AUDIT_API_URL: 'http://127.0.0.1:54321'},
  ]) {
    const result = spawnSync(process.execPath, [fileURLToPath(generator)], {
      env: {...process.env, NAWASRAH_SEO_AUDIT_API_URL: '', NAWASRAH_SEO_AUDIT_API_KEY: '', ...overrides},
      encoding: 'utf8', windowsHide: true,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Isolated SEO audit (API must be a plain loopback|requires both)/u);
    assert.doesNotMatch(result.stderr, /Catalog RPC returned|Offers RPC returned/u);
  }
});
