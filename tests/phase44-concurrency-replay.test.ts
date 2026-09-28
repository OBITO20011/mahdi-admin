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
  path.join(root, 'scripts/testing/run-phase44-concurrency-replay-runtime.mjs'),
  'utf8',
);

test('Phase 4.4 Slice 3 is wired as a focused real-concurrency gate', () => {
  assert.equal(
    packageJson.scripts['test:phase44-concurrency:runtime'],
    'node scripts/testing/run-phase44-concurrency-replay-runtime.mjs',
  );
  assert.doesNotMatch(
    packageJson.scripts['test:phase44-concurrency:runtime'],
    /canonical|quality|playwright/u,
  );
  assert.match(runtime, /startSession/u);
  assert.match(runtime, /waitForBlocked/u);
  assert.match(runtime, /pg_blocking_pids/u);
});

test('Slice 3 keeps every approved concurrency family explicit', () => {
  assert.match(runtime, /SLICE_3_BREAK_MATRIX/u);
  for (const scenario of [
    'firstFlightSameKey',
    'committedReplayRace',
    'sameKeyChangedPayload',
    'replayVersusNewIntent',
    'compatibleReturnCapacity',
    'oversubscribedReturnCapacity',
    'returnVersusReplacement',
    'replacementVersusReplacement',
    'sameSkuWarehouseDifferentSales',
    'loserOperationScopedZeroWrite',
  ]) {
    assert.match(runtime, new RegExp(`${scenario}:`, 'u'));
  }
});

test('Slice 3 proves operation-scoped loser state and deadlock integrity', () => {
  assert.match(runtime, /readOperationFootprint/u);
  assert.match(runtime, /assertZeroFootprint/u);
  assert.match(runtime, /readOrderState/u);
  assert.match(runtime, /pg_stat_database/u);
  assert.match(runtime, /deadlockDelta/u);
  assert.match(runtime, /assertBusinessFailure/u);
  assert.doesNotMatch(runtime, /retry|retries/iu);
});

test('Slice 3 uses schema 001-122 and reserves broad gates for Slice 5', () => {
  assert.match(runtime, /freshRebuild: '001-122'/u);
  assert.match(runtime, /migration123: 'ABSENT'/u);
  assert.match(runtime, /slice: 'concurrency-replay'/u);
  assert.doesNotMatch(runtime, /123_/u);
});
