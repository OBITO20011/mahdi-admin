import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('supabase/migrations/126_phase5_private_tender_coordinator.sql', 'utf8')
  .replace(/\r\n?/gu, '\n');
const body = (name: string) => {
  const start = migration.indexOf(`CREATE FUNCTION phase5_private.${name}(`);
  assert.ok(start >= 0, name);
  return migration.slice(start, migration.indexOf('\n$$;', start) + 4);
};

test('Slice 3 is additive, bounded and private with no public authority cutover', () => {
  assert.match(migration, /^BEGIN;/u);
  assert.match(migration, /COMMIT;\s*$/u);
  assert.doesNotMatch(migration, /CREATE OR REPLACE|SECURITY DEFINER|\bGRANT\b/u);
  assert.doesNotMatch(migration, /(?:UPDATE|INSERT INTO|DELETE FROM|ALTER TABLE|ALTER FUNCTION) public\./u);
  assert.equal(execFileSync('git', ['diff', 'HEAD', '--name-only', '--',
    'supabase/migrations/0*', 'supabase/migrations/1[01]*',
    'supabase/migrations/12[0-5]*'], { encoding: 'utf8' }).trim(), '');
  assert.deepEqual(readdirSync('supabase/migrations').filter((name) => name.startsWith('128_')),
    ['128_phase5_operational_payment_and_shift_refund_fixes.sql']);
  assert.deepEqual(readdirSync('supabase/migrations').filter((name) => name.startsWith('131_')),
    ['131_phase6_operational_report_readers.sql']);
  assert.equal(readdirSync('supabase/migrations').some((name) => name.startsWith('132_')), false);
});

test('all new evidence is immutable, forced RLS and app role mutation is revoked', () => {
  for (const table of ['reversal_tender_movements', 'reversal_coordinator_completions']) {
    assert.match(migration, new RegExp(`ON phase5_private\\.${table}\\nFOR EACH ROW EXECUTE FUNCTION phase5_private.reject_financial_evidence_mutation`, 'u'));
    assert.match(migration, new RegExp(`ALTER TABLE phase5_private\\.${table} FORCE ROW LEVEL SECURITY`, 'u'));
  }
  assert.match(migration, /FROM PUBLIC, anon, authenticated, service_role/u);
  assert.equal((migration.match(/CREATE FUNCTION/gu) ?? []).length, 11);
  assert.equal((migration.match(/SECURITY INVOKER/gu) ?? []).length, 11);
  assert.equal((migration.match(/ALTER FUNCTION[\s\S]*?OWNER TO postgres;/gu) ?? []).length, 11);
});

test('authorization and exact replay precede fresh mutation serialization', () => {
  const coordinator = body('coordinate_payment_reversal_v1');
  const auth = coordinator.indexOf('PERFORM phase5_private.authorize_coordinator_actor_v1');
  const keyLock = coordinator.indexOf('PERFORM pg_advisory_xact_lock');
  const replay = coordinator.indexOf('RETURN phase5_private.validate_operational_reversal_v1');
  const businessLocks = coordinator.indexOf('v_shift := phase5_private.lock_coordinator_context_v1');
  assert.ok(auth < keyLock && keyLock < replay && replay < businessLocks);
  assert.match(coordinator, /v_method IS NULL/u);
  assert.match(coordinator, /request_identity_snapshot IS DISTINCT FROM v_request/u);
  assert.match(coordinator, /request_fingerprint IS DISTINCT FROM v_fp/u);
});

test('frozen Shift/FK plans reuse the root domain with strongest mode before Order writes', () => {
  const locks = body('lock_coordinator_context_v1');
  assert.match(locks, /phase4-order\|/u);
  assert.doesNotMatch(migration, /phase4_lock_customer_order_context_internal/u);
  assert.match(locks, /UNNEST\(ARRAY\[v_shift, v_historical\]\)[\s\S]*ORDER BY id/u);
  assert.ok(locks.indexOf('FROM public.cash_shifts') < locks.indexOf('FROM public.orders WHERE id = p_order_id FOR UPDATE'));
  assert.match(locks, /FOR UPDATE NOWAIT/u);
  assert.match(locks, /FOR KEY SHARE NOWAIT/u);
  assert.match(locks, /v_plan IS DISTINCT FROM phase5_private.coordinator_lock_plan_v1/u);
  assert.match(locks, /40001[\s\S]*PHASE5_LOCK_PLAN_CHANGED_RETRY/u);
  assert.match(locks, /LOCK_NOT_AVAILABLE[\s\S]*40001/u);
});

test('source anchoring preserves Sales capability without granting reversal capability', () => {
  assert.match(body('authorize_coordinator_actor_v1'), /p_collection_only IS TRUE AND r.code = 'sales'/u);
  const anchor = body('anchor_existing_collection_v1');
  assert.match(anchor, /authorize_coordinator_actor_v1\(p_actor_id, true\)/u);
  assert.ok(anchor.indexOf('PHASE5_COLLECTION_ACTOR_SOURCE_UNAUTHORIZED') < anchor.indexOf('pg_advisory_xact_lock'));
  assert.match(body('coordinate_payment_reversal_v1'), /authorize_coordinator_actor_v1\(p_actor_id\)/u);
});

test('typed complete sources never infer initial collections from mutable amount_paid', () => {
  const source = body('collection_source_v1');
  const population = body('discover_collection_population_v1');
  assert.match(source, /modern_pos_initial[\s\S]*modern_customer_initial/u);
  assert.match(source, /v_amount := 0; -- Its linked real payment is the sole financial source/u);
  assert.match(source, /request_fingerprint IS DISTINCT FROM public.phase3_request_fingerprint_internal/u);
  assert.match(population, /FROM public.customer_payments WHERE order_id = p_order_id ORDER BY id/u);
  assert.match(population, /PHASE5_LEGACY_SOURCE_UNSUPPORTED/u);
  assert.doesNotMatch(source + population, /v_order\.amount_paid_in_minor_units/u);
});

test('operational success is not foundation success; finalization/replay share one tuple validator', () => {
  const validator = body('validate_operational_reversal_v1');
  assert.match(validator, /INTO STRICT v_movement/u);
  assert.match(validator, /INTO STRICT v_completion/u);
  assert.match(validator, /IS DISTINCT FROM ROW\(v_reversal.id/u);
  assert.match(validator, /v_completion.coordinator_version IS DISTINCT FROM 503/u);
  assert.match(validator, /v_completion.result_snapshot IS DISTINCT FROM v_expected/u);
  assert.match(migration, /operation_id UUID PRIMARY KEY REFERENCES phase5_private.financial_operation_events/u);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/u);
  assert.match(body('assert_operational_completion_v1'), /validate_operational_reversal_v1\(NEW.operation_id\)/u);
  const coordinator = body('coordinate_payment_reversal_v1');
  assert.equal((coordinator.match(/validate_operational_reversal_v1\(/gu) ?? []).length, 2);
});

test('source, evidence and actual outflow time/tender remain separate and immutable', () => {
  assert.match(migration, /source_recorded_at TIMESTAMPTZ NOT NULL/u);
  assert.match(migration, /evidence_recorded_at TIMESTAMPTZ NOT NULL/u);
  assert.match(migration, /reversal_executed_at TIMESTAMPTZ NOT NULL/u);
  const validator = body('validate_operational_reversal_v1');
  assert.match(validator, /v_payment.created_at, v_collection.operation_event_at, v_op.operation_event_at/u);
  assert.match(migration, /actual_tender = 'cliq' AND actual_cash_shift_id IS NULL/u);
  assert.match(body('reversal_position_v1'), /v_candidate := v_collected - v_reversed - v_amount/u);
  assert.match(body('reversal_position_v1'), /v_candidate < v_refund \+ v_delivery/u);
});

test('historical position proves exact membership from independent timed source rows', () => {
  const position = body('reversal_position_v1');
  assert.match(position, /FROM public.business_operations WHERE id = v_order.operation_id/u);
  assert.match(position, /FROM phase5_private.collection_events c[\s\S]*c.operation_event_at <= p_at/u);
  assert.match(position, /INTO v_expected_prior FROM phase5_private.payment_reversal_events[\s\S]*operation_event_at < p_at/u);
  assert.match(position, /INTO v_expected_returns FROM public.sales_return_events[\s\S]*settled_at <= p_at/u);
  for (const field of ['sources', 'prior', 'returns']) {
    assert.match(position, new RegExp(`IS DISTINCT FROM v_expected_${field}`, 'u'));
  }
  assert.match(position, /PHASE5_POSITION_HISTORY_INCOMPLETE/u);
  const coordinator = body('coordinate_payment_reversal_v1');
  assert.ok(coordinator.indexOf('v_at := clock_timestamp()') < coordinator.indexOf('v_position := phase5_private.reversal_position_v1'));
  assert.match(coordinator, /p_order_id, v_sources, v_prior, v_returns, p_payment_id, v_at/u);
});

test('continuity pins the exact LF-safe candidate, never an arbitrary runtime hash', () => {
  const state = JSON.parse(readFileSync('docs/agent/project-state.json', 'utf8')) as {
    migration126CanonicalLfSha256: string; migrationCeiling: number;
  };
  assert.equal(state.migrationCeiling, 131);
  const digest = createHash('sha256').update(migration).digest('hex').toUpperCase();
  assert.equal(state.migration126CanonicalLfSha256, digest);
  assert.equal(createHash('sha256').update(migration.replaceAll('\n', '\r\n').replace(/\r\n?/gu, '\n'))
    .digest('hex').toUpperCase(), digest);
});
