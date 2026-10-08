import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(path, 'utf8');

test('Slice 4 runner uses a fresh isolated full schema and both browser projects', async () => {
  const source = await read('scripts/testing/run-phase44-admin-recovery-fullstack.mjs');
  assert.match(source, /bootstrap-isolated-supabase\.mjs/u);
  assert.match(source, /phase3-configurable-parcel-contracts-runtime\.sql/u);
  assert.match(source, /desktop-chromium[\s\S]*mobile-webkit/u);
  assert.match(source, /--retries=0/u);
  assert.match(source, /CI: '1'/u);
  assert.doesNotMatch(source, /canonical|npm run quality|test:e2e/u);
});

test('Slice 4 full-stack probes use real public RPCs and deliberate response faults', async () => {
  const source = await read('e2e/phase44-admin-recovery-fullstack.spec.ts');
  for (const rpc of ['settle_sales_replacement_v1', 'settle_admin_sales_return_v1']) {
    assert.match(source, new RegExp(rpc, 'u'));
  }
  assert.match(source, /route\.fetch\(\)[\s\S]*route\.abort\('failed'\)/u);
  assert.match(source, /issuedQuantity: 99/u);
  assert.match(source, /page\.reload\(\)/u);
  assert.match(source, /browser\.newContext\(\)/u);
  assert.match(source, /context\.newPage\(\)/u);
  assert.match(source, /deliberately reordered stale response/u);
  assert.match(source, /AFTERCARE_REVIEW_REQUIRED/u);
  assert.match(source, /استعادة الاستبدال/u);
});

test('Slice 4 asserts immutable recovery identity and zero-write durable fingerprints', async () => {
  const source = await read('e2e/phase44-admin-recovery-fullstack.spec.ts');
  const runner = await read('scripts/testing/run-phase44-admin-recovery-fullstack.mjs');
  for (const field of ['idempotencyKey', 'requestFingerprint', 'intentId']) {
    assert.match(source, new RegExp(field, 'u'));
  }
  assert.match(source, /expect\(await snapshot\(fixture\)\)\.toEqual\(committed\)/u);
  assert.match(source, /expect\(await snapshot\(fixture\)\)\.toEqual\(before\)/u);
  assert.match(source, /rpcCalls\)\.toBe\(1\)/u);
  assert.match(source, /recoveryFingerprint/u);
  assert.match(source, /content-sensitive durable fingerprint detects a same-count row mutation/u);
  assert.match(runner, /extensions\.digest/u);
  assert.match(runner, /jsonb_agg\(to_jsonb/u);
  for (const relation of ['business_operations', 'sales_return_events',
    'sales_replacement_events', 'sales_aftercare_consumptions', 'inventory_movements',
    'phase42_return_inventory_effects', 'phase42_return_settlement_evidence',
    'phase43_replacement_inventory_effects', 'phase43_replacement_settlement_evidence',
    'customer_payments', 'cash_shifts', 'audit_logs']) {
    assert.match(runner, new RegExp(relation, 'u'));
  }
  assert.match(runner, /fingerprintMutationProbeSql/u);
  assert.match(runner, /ROLLBACK/u);
});

test('full-stack recovery remains executable through the public npm entrypoint', async () => {
  const packageState = JSON.parse(await read('package.json')) as {scripts: Record<string, string>};
  assert.equal(packageState.scripts['test:phase44-admin-recovery:fullstack'],
    'node scripts/testing/run-phase44-admin-recovery-fullstack.mjs');
});
