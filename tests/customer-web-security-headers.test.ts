import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('customer storefront ships production security headers', async () => {
  const headers = await readFile('customer-web/public/_headers', 'utf8');

  assert.match(headers, /X-Frame-Options: DENY/u);
  assert.match(headers, /X-Content-Type-Options: nosniff/u);
  assert.match(headers, /Strict-Transport-Security: max-age=31536000; includeSubDomains/u);
  assert.match(headers, /Content-Security-Policy:/u);
  assert.match(headers, /connect-src 'self' https:\/\/acjtabdqqnpwhdvbvnyw\.supabase\.co wss:\/\/acjtabdqqnpwhdvbvnyw\.supabase\.co/u);
  assert.match(headers, /object-src 'none'/u);
  assert.match(headers, /frame-ancestors 'none'/u);
  assert.doesNotMatch(headers, /script-src[^\n]*'unsafe-inline'/u);
});
