import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const migrationPath = path.join(
  root, 'supabase/migrations/123_phase5_private_financial_evidence_foundation.sql',
);
const migration = readFileSync(migrationPath, 'utf8');
const runtime = readFileSync(
  path.join(root, 'scripts/testing/run-phase5-private-foundation-runtime.mjs'),
  'utf8',
);
const migration122Path = path.join(
  root, 'supabase/migrations/122_phase43_admin_aftercare_integration.sql',
);
const map = readFileSync(
  path.join(root, 'docs/agent/evidence/phase5-slice1/SLICE1_OBJECT_MAP.md'), 'utf8',
);
const fingerprints = JSON.parse(readFileSync(
  path.join(root, 'docs/agent/evidence/phase5-slice1/preimplementation_evidence_fingerprints.json'),
  'utf8',
)) as { files: Record<string, string> };

const sha256 = (value: Uint8Array | string) => createHash('sha256')
  .update(value)
  .digest('hex')
  .toUpperCase();

const canonicalLf = (value: string) => value.replace(/\r\n?/gu, '\n');
const canonicalTextSha256 = (value: string) => sha256(canonicalLf(value));

const walk = (directory: string): string[] => readdirSync(directory)
  .flatMap((name) => {
    const candidate = path.join(directory, name);
    return statSync(candidate).isDirectory() ? walk(candidate) : [candidate];
  });

test('Migration 123 is the single additive Phase 5 migration over the immutable Phase 4 baseline', () => {
  const migrations = readdirSync(path.join(root, 'supabase/migrations')).sort();
  assert.equal(migrations.filter((name) => name.startsWith('123_')).length, 1);
  assert.equal(
    canonicalTextSha256(readFileSync(migration122Path, 'utf8')),
    'DF991DE73F32931B81C9C4B9C2F611F44731E99044ACBC2F5F60F4FE1192C066',
  );
  assert.match(migration, /^BEGIN;/u);
  assert.match(migration, /COMMIT;\s*$/u);
  assert.doesNotMatch(migration, /\bIF NOT EXISTS\b|\bCREATE OR REPLACE\b/iu);
  assert.doesNotMatch(migration, /\b(?:ALTER|DROP|TRUNCATE)\s+(?:TABLE|FUNCTION|TRIGGER|VIEW)\s+public\./iu);
});

test('Migration 122 canonical fingerprint ignores line-ending representation only', () => {
  const source = readFileSync(migration122Path, 'utf8');
  const lf = canonicalLf(source);
  const expected = 'DF991DE73F32931B81C9C4B9C2F611F44731E99044ACBC2F5F60F4FE1192C066';

  assert.equal(canonicalTextSha256(lf), expected);
  assert.equal(canonicalTextSha256(lf.replace(/\n/gu, '\r\n')), expected);
  assert.equal(canonicalTextSha256(lf.replace(/\n/gu, '\r')), expected);
  assert.notEqual(canonicalTextSha256(`${lf}\n-- deliberate SQL content mutation`), expected);
  assert.notEqual(canonicalTextSha256(lf.replace('BEGIN;', 'BEGIN; ')), expected);
});

test('the frozen object map keeps every Slice-1 object private and runtime-inactive', () => {
  assert.match(map, /Status: implementation map frozen before Migration 123 was authored/u);
  assert.ok((map.match(/\| (?:Private[^|]*|None[^|]*) \| None(?:;[^|]*)? \|/gu) ?? []).length >= 6);
  assert.match(map, /no public RPC or view/u);
  assert.match(map, /Zero explicit business\/application triggers on existing operational tables/u);
  assert.match(map, /44 internal triggers total: 28 on new Slice-1 tables and 16 on existing referenced tables/u);
  assert.match(map, /those internal triggers do not provide a write path into the foundation/u);
});

test('pre-implementation evidence and tooling retain their raw-byte fingerprints', () => {
  assert.ok(Object.keys(fingerprints.files).length >= 15);
  for (const [relativePath, expected] of Object.entries(fingerprints.files)) {
    assert.equal(sha256(readFileSync(path.join(root, relativePath))), expected, relativePath);
  }
});

test('operation identity is actor and operation scoped while fingerprint remains immutable evidence', () => {
  assert.match(migration, /UNIQUE \(\s*actor_scope_type,\s*actor_scope_id,\s*operation_type,\s*idempotency_key\s*\)/u);
  assert.doesNotMatch(migration, /UNIQUE \(\s*idempotency_key\s*\)/u);
  assert.match(migration, /request_fingerprint ~ '\^\[0-9A-F\]\{64\}\$'/u);
  assert.match(migration, /request_identity_snapshot JSONB NOT NULL/u);
  assert.match(migration, /result_type = 'customer_collection_committed_v1'/u);
  assert.match(migration, /result_type = 'customer_payment_reversal_committed_v1'/u);
});

test('collection and full reversal evidence preserve exact source, amount and independent tender', () => {
  assert.match(migration, /original_payment_id UUID NOT NULL UNIQUE/u);
  assert.match(migration, /CREATE FUNCTION phase5_private\.assert_collection_source\(\)/u);
  assert.match(migration, /v_payment\.payment_method NOT IN \('cash', 'cliq'\)/u);
  assert.match(migration, /v_payment\.created_by IS DISTINCT FROM v_actor_scope_id/u);
  assert.match(migration, /v_payment\.amount_in_minor_units IS DISTINCT FROM NEW\.amount_in_minor_units/u);
  assert.match(migration, /fk_phase5_reversal_exact_original_collection/u);
  assert.match(migration, /reversed_amount_in_minor_units[\s\S]*?amount_in_minor_units\s*\) ON DELETE RESTRICT/u);
  assert.match(migration, /reversal_tender_method TEXT NOT NULL CHECK \(reversal_tender_method IN \('cash', 'cliq'\)\)/u);
});

test('event time is explicit and shared structurally without a default-now claim', () => {
  assert.match(migration, /operation_event_at TIMESTAMPTZ NOT NULL/u);
  assert.match(migration, /FOREIGN KEY \(financial_operation_id, operation_type, operation_event_at\)/u);
  assert.doesNotMatch(migration, /operation_event_at[^,;\n]*DEFAULT/iu);
  assert.doesNotMatch(migration, /DEFAULT\s+(?:NOW|CLOCK_TIMESTAMP|STATEMENT_TIMESTAMP)\s*\(/iu);
});

test('private ACL, RLS, owner and invoker posture are explicit and fail closed', () => {
  assert.match(migration, /CREATE SCHEMA phase5_private AUTHORIZATION postgres/u);
  assert.match(migration, /REVOKE ALL ON SCHEMA phase5_private FROM PUBLIC, anon, authenticated, service_role/u);
  assert.equal((migration.match(/SECURITY INVOKER/gu) ?? []).length, 2);
  assert.doesNotMatch(migration, /SECURITY DEFINER/iu);
  assert.equal((migration.match(/SET search_path = pg_catalog/gu) ?? []).length, 2);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/u);
  assert.doesNotMatch(migration, /\bGRANT\b/iu);
  assert.match(migration, /ALTER FUNCTION phase5_private\.assert_collection_source\(\) OWNER TO postgres/u);
  assert.match(migration, /ALTER FUNCTION phase5_private\.reject_financial_evidence_mutation\(\) OWNER TO postgres/u);
});

test('all explicit Slice-1 triggers are confined to new tables and no application caller reaches the schema', () => {
  const triggerTargets = [...migration.matchAll(/BEFORE [\s\S]*? ON ([a-z0-9_.]+)\s*\nFOR EACH ROW/giu)]
    .map((match) => match[1]);
  assert.deepEqual(triggerTargets.sort(), [
    'phase5_private.collection_events',
    'phase5_private.collection_events',
    'phase5_private.financial_operation_events',
    'phase5_private.payment_reversal_events',
  ].sort());

  const applicationRoots = [
    path.join(root, 'src'),
    path.join(root, 'customer-web/src'),
    path.join(root, 'supabase/functions'),
    path.join(root, 'scripts/monitoring'),
  ];
  const callers = applicationRoots.flatMap(walk)
    .filter((file) => /\.(?:ts|tsx|js|mjs)$/u.test(file))
    .filter((file) => readFileSync(file, 'utf8').includes('phase5_private'));
  assert.deepEqual(callers, []);
});

test('catalog validation distinguishes explicit business triggers from internal FK triggers', () => {
  assert.match(runtime, /'explicitSlice1Triggers'/u);
  assert.match(runtime, /'internalFkTriggers'/u);
  assert.match(runtime, /'internalFkTriggersOnNewTables'/u);
  assert.match(runtime, /'internalFkTriggersOnExistingTables'/u);
  assert.match(runtime, /'internalFkBusinessFunctions'/u);
  assert.match(runtime, /assert\.equal\(catalog\.explicitSlice1Triggers, 4\)/u);
  assert.match(runtime, /assert\.equal\(catalog\.internalFkTriggers, 44\)/u);
  assert.match(runtime, /assert\.equal\(catalog\.internalFkTriggersOnNewTables, 28\)/u);
  assert.match(runtime, /assert\.equal\(catalog\.internalFkTriggersOnExistingTables, 16\)/u);
  assert.match(runtime, /assert\.equal\(catalog\.internalFkBusinessFunctions, 0\)/u);
});
