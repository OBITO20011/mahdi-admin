import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {localBrowserWorkerLimit} from '../scripts/testing/local-browser-workers.mjs';

test('local low-memory browser QA is single-worker,never a CPU-count percentage', () => {
  for (const bytes of [0, 0.16 * 1024 ** 3, 1.8 * 1024 ** 3, 4 * 1024 ** 3 - 1]) {
    assert.equal(localBrowserWorkerLimit(bytes), 1);
  }
});
test('local QA permits two workers at4GiB and remains capped even on large machines', () => {
  for (const bytes of [4 * 1024 ** 3, 8 * 1024 ** 3, 128 * 1024 ** 3]) {
    assert.equal(localBrowserWorkerLimit(bytes), 2);
  }
});
test('invalid memory evidence uses the conservative local worker count', () => {
  for (const bytes of [NaN, Infinity, -Infinity, -1]) assert.equal(localBrowserWorkerLimit(bytes), 1);
});
test('CI keeps its existing constant1 worker and does not use local adaptive selection', () => {
  const source = readFileSync('playwright.config.ts', 'utf8');
  assert.match(source, /workers: isCi \? 1 : localBrowserWorkerLimit\(\)/);
  assert.match(source, /retries: isCi \? 2 : 0/);
  assert.match(source, /timeout: 90_000/);
  assert.match(source, /workers: isCi/);
});
