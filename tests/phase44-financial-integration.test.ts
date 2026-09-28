import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const runtime = readFileSync(
  path.join(root, 'scripts/testing/run-phase44-financial-integration-runtime.mjs'),
  'utf8',
);

test('Phase 4.4 Slice 1 focused runtime is wired without broad final gates', () => {
  assert.equal(
    packageJson.scripts['test:phase44-financial:runtime'],
    'node scripts/testing/run-phase44-financial-integration-runtime.mjs',
  );
  assert.doesNotMatch(
    packageJson.scripts['test:phase44-financial:runtime'],
    /canonical|quality|playwright/u,
  );
});

test('Phase 4.4 Slice 1 uses the public coordinator and independent facts', () => {
  assert.match(runtime, /SLICE_1_BREAK_MATRIX/u);
  assert.match(runtime, /public\.settle_sales_return_v1/u);
  assert.match(runtime, /deriveFinancialPosition/u);
  assert.match(runtime, /readFinancialFacts/u);
  assert.match(runtime, /readDurableFingerprint/u);
  assert.match(runtime, /PHASE44_INJECTED_FINANCIAL_FAILURE/u);
});

test('Phase 4.4 Slice 1 keeps every approved scenario explicit', () => {
  for (const scenario of [
    'debtFirstSplit',
    'fullyPaidEntitlementBound',
    'netCollectionBound',
    'damageDeductionCap',
    'paidDeliveryNonRefundable',
    'unpaidDeliveryRemainsDebt',
    'crossSaleIsolation',
    'committedReplayZeroWrite',
    'rejectionAtomicity',
  ]) {
    assert.match(runtime, new RegExp(`${scenario}:`, 'u'));
  }
});

test('Phase 4.4 Slice 1 uses schema 001-122 and no Migration 123', () => {
  assert.match(runtime, /freshRebuild: '001-122'/u);
  assert.match(runtime, /migration123: 'ABSENT'/u);
  assert.doesNotMatch(runtime, /123_/u);
});
