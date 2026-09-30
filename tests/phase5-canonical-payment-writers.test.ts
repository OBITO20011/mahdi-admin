import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const migrationPath = path.join(
  root, 'supabase/migrations/124_phase5_canonical_collection_reversal_writers.sql',
);
const migration = readFileSync(migrationPath, 'utf8');
const implementationMap = readFileSync(
  path.join(root, 'docs/agent/evidence/phase5-slice2/SLICE2_IMPLEMENTATION_MAP.md'),
  'utf8',
);

const canonicalLf = (value: string) => value.replace(/\r\n?/gu, '\n');
const sha256 = (value: string) => createHash('sha256')
  .update(canonicalLf(value))
  .digest('hex')
  .toUpperCase();

test('Migration 124 is one additive transaction above the immutable 001-123 baseline', () => {
  const migrations = readdirSync(path.join(root, 'supabase/migrations')).sort();
  assert.equal(migrations.filter((name) => name.startsWith('124_')).length, 1);
  assert.equal(migrations.some((name) => name.startsWith('125_')), false);
  assert.match(migration, /^BEGIN;/u);
  assert.match(migration, /COMMIT;\s*$/u);
  assert.doesNotMatch(migration, /\bCREATE OR REPLACE\b|\bCREATE\s+[^;\n]+\s+IF NOT EXISTS\b/iu);
  assert.doesNotMatch(migration, /\b(?:ALTER|DROP|TRUNCATE)\s+(?:TABLE|TRIGGER|VIEW)\b/iu);
  assert.equal(sha256(migration).length, 64);
});

test('Slice 2 exposes exactly four private invoker functions with zero role grants', () => {
  const creates = [...migration.matchAll(
    /CREATE FUNCTION phase5_private\.([a-z0-9_]+)\(/giu,
  )].map((match) => match[1]);
  assert.deepEqual(creates, [
    'validate_customer_collection_operation_v1',
    'validate_customer_payment_reversal_operation_v1',
    'commit_customer_collection_v1',
    'commit_customer_payment_reversal_v1',
  ]);
  assert.equal((migration.match(/SECURITY INVOKER/gu) ?? []).length, 4);
  assert.equal((migration.match(/SET search_path = pg_catalog/gu) ?? []).length, 4);
  assert.doesNotMatch(migration, /SECURITY DEFINER|\bGRANT\b/iu);
  assert.equal((migration.match(/FROM PUBLIC, anon, authenticated, service_role/gu) ?? []).length, 4);
  assert.equal((migration.match(/OWNER TO postgres/gu) ?? []).length, 4);
});

test('request identity is actor scoped, canonical, fingerprinted and replayed before business locks', () => {
  assert.match(migration, /phase5-idempotency\|erp_user\|/u);
  assert.match(migration, /requestVersion', 'phase5-customer-collection-v1'/u);
  assert.match(migration, /requestVersion', 'phase5-customer-payment-reversal-v1'/u);
  assert.match(migration, /UPPER\(public\.phase3_request_fingerprint_internal\(v_request\)\)/u);
  assert.match(migration, /PHASE5_COLLECTION_IDEMPOTENCY_CONFLICT/u);
  assert.match(migration, /PHASE5_PAYMENT_REVERSAL_IDEMPOTENCY_CONFLICT/u);
  const collectionReplay = migration.indexOf(
    'RETURN phase5_private.validate_customer_collection_operation_v1(',
  );
  const collectionRootLock = migration.indexOf(
    'v_shift_id := public.phase4_lock_customer_order_context_internal(',
  );
  assert.ok(collectionReplay > 0 && collectionReplay < collectionRootLock);
});

test('fresh writers use the existing root Order lock and one post-lock event timestamp', () => {
  assert.equal((migration.match(/phase4_lock_customer_order_context_internal\(/gu) ?? []).length, 2);
  assert.equal((migration.match(/v_operation_event_at := clock_timestamp\(\)/gu) ?? []).length, 2);
  assert.doesNotMatch(migration, /operation_event_at[^;\n]*NOW\(|DEFAULT\s+NOW\(/iu);
  assert.match(migration, /FOR UPDATE;[\s\S]*?v_operation_event_at := clock_timestamp\(\)/u);
});

test('collection writer binds one exact active Cash or CliQ source payment', () => {
  assert.match(migration, /v_payment\.created_by IS DISTINCT FROM p_actor_scope_id/u);
  assert.match(migration, /v_payment\.order_id IS DISTINCT FROM p_order_id/u);
  assert.match(migration, /v_payment\.amount_in_minor_units IS DISTINCT FROM p_amount_in_minor_units/u);
  assert.match(migration, /v_payment\.payment_method IS DISTINCT FROM v_method/u);
  assert.match(migration, /v_payment\.reference_number IS DISTINCT FROM v_reference/u);
  assert.match(migration, /OR v_payment\.is_reversed/u);
  assert.match(migration, /PHASE5_COLLECTION_ALREADY_COMMITTED/u);
});

test('payment reversal is one full exact event with independent actual tender evidence', () => {
  assert.match(migration, /v_collection\.amount_in_minor_units/u);
  assert.match(migration, /reversed_amount_in_minor_units[\s\S]*?v_collection\.amount_in_minor_units/u);
  assert.match(migration, /reversalTenderMethod', v_method/u);
  assert.match(migration, /CASE WHEN v_method = 'cash' THEN v_shift_id END/u);
  assert.match(migration, /v_method = 'cliq'[\s\S]*?v_reference IS NULL/u);
  assert.match(migration, /PHASE5_PAYMENT_ALREADY_REVERSED/u);
  assert.doesNotMatch(migration, /partial[_ -]?reversal/iu);
});

test('candidate reversal enforces documented gross capacity without refund double subtraction', () => {
  assert.match(
    migration,
    /phase42_assert_operational_return_evidence_internal\(\s*v_return_operation_id, true\s*\)/u,
  );
  assert.match(migration, /v_candidate_coverage := v_collection_coverage - v_prior_reversals\s*- v_collection\.amount_in_minor_units/u);
  assert.match(migration, /v_candidate_outstanding := GREATEST\([\s\S]*?v_order\.total_in_minor_units - v_candidate_coverage - v_debt_reductions/u);
  assert.match(migration, /v_required_coverage := v_money_refunds \+ v_collected_delivery/u);
  assert.match(migration, /v_candidate_coverage < v_required_coverage/u);
  assert.doesNotMatch(migration, /v_candidate_coverage\s*:=.*v_money_refunds/u);
  assert.match(migration, /PHASE5_LEGACY_RETURN_EVIDENCE_INCOMPLETE/u);
});

test('central validators reconstruct exact request and result snapshots for replay', () => {
  assert.equal((migration.match(/request_identity_snapshot IS DISTINCT FROM v_expected_request/gu) ?? []).length, 2);
  assert.equal((migration.match(/result_snapshot IS DISTINCT FROM v_expected_result/gu) ?? []).length, 2);
  assert.equal((migration.match(/request_fingerprint IS DISTINCT FROM v_expected_fingerprint/gu) ?? []).length, 2);
  assert.equal((migration.match(
    /TO_CHAR\(\s*v_(?:operation\.)?operation_event_at AT TIME ZONE 'UTC',\s*'YYYY-MM-DD"T"HH24:MI:SS\.US"Z"'\s*\)/gu,
  ) ?? []).length, 4);
  const collectionValidator = migration.slice(
    migration.indexOf('CREATE FUNCTION phase5_private.validate_customer_collection_operation_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.validate_customer_payment_reversal_operation_v1'),
  );
  assert.doesNotMatch(collectionValidator, /v_payment\.is_reversed/u);
  assert.match(migration, /PHASE5_COLLECTION_OPERATION_INVALID/u);
  assert.match(migration, /PHASE5_PAYMENT_REVERSAL_OPERATION_INVALID/u);
});

test('implementation map keeps coexistence private and activation fail closed', () => {
  assert.match(implementationMap, /zero executable grants and zero caller edges/u);
  assert.match(implementationMap, /non-activatable/u);
  assert.match(implementationMap, /Cash reversal requires and locks the current open Shift/u);
  assert.match(implementationMap, /does not yet own the compensating\s+cash-drawer movement/u);
  assert.match(implementationMap, /settled legacy Return[\s\S]*?fail-closed/u);
});
