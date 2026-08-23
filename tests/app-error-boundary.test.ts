import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const boundary = readFileSync(
  new URL('../src/components/common/AppErrorBoundary.tsx', import.meta.url),
  'utf8',
);

test('the app reloads once when an old deployed chunk is no longer available', () => {
  assert.match(boundary, /failed to fetch dynamically imported module/i);
  assert.match(boundary, /window\.sessionStorage\.getItem\(staleChunkReloadKey\)/);
  assert.match(boundary, /staleChunkReloadCooldownMs/);
  assert.match(boundary, /window\.location\.reload\(\)/);
  assert.match(boundary, /isStaleChunkError\(error\) && recoverFromStaleChunk\(\)/);
});
