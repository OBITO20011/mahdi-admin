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
  path.join(root, 'scripts/testing/run-phase44-lineage-valuation-runtime.mjs'),
  'utf8',
);

test('Phase 4.4 Slice 2 is a focused lineage runtime and preserves final gates', () => {
  assert.equal(
    packageJson.scripts['test:phase44-lineage:runtime'],
    'node scripts/testing/run-phase44-lineage-valuation-runtime.mjs',
  );
  assert.doesNotMatch(
    packageJson.scripts['test:phase44-lineage:runtime'],
    /canonical|quality|playwright/u,
  );
});

test('Phase 4.4 Slice 2 encodes the complete approved break matrix', () => {
  assert.match(runtime, /SLICE_2_BREAK_MATRIX/u);
  for (const scenario of [
    'replacementDepthTwo',
    'historicalPriceIsolation',
    'historicalCostIsolation',
    'originalLeafAfterReplacement',
    'staleFirstReplacement',
    'wrongParentOrRoot',
    'sameTupleWrongPhysicalIdentity',
    'committedReplayZeroWrite',
  ]) {
    assert.match(runtime, new RegExp(`${scenario}:`, 'u'));
  }
});

test('Slice 2 expectations come from immutable anchors and per-identity evidence', () => {
  assert.match(runtime, /readImmutableAnchors/u);
  assert.match(runtime, /readCurrentPhysicalContext/u);
  assert.match(runtime, /readPerIdentityReturnEvidence/u);
  assert.match(runtime, /readDurableFingerprint/u);
  assert.match(runtime, /public\.settle_sales_replacement_v1/u);
  assert.match(runtime, /public\.settle_admin_sales_return_v1/u);
  assert.doesNotMatch(runtime, /currentWac\s*\*\s*returned/u);
});

test('Slice 2 remains compatible with the private inactive Migration 123 foundation', () => {
  assert.match(runtime, /freshRebuild: currentPackageD \? '001-131' : '001-123'/u);
  assert.match(runtime, /operationalSchema: currentPackageD \? '001-132' : 'historical'/u);
  assert.match(runtime, /migration123: currentPackageD \? 'RETIRED_BY_132' : 'PRIVATE_INACTIVE'/u);
  assert.match(runtime, /NAWASRAH_MAX_MIGRATION: '131'/u);
  assert.match(runtime, /132_package_d_system_unification\.sql/u);
  assert.match(runtime, /slice: 'lineage-valuation'/u);
  assert.doesNotMatch(runtime, /123_/u);
});
