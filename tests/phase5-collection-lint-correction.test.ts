import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertPhase5DbLint } from '../scripts/testing/phase5-db-lint-policy.mjs';

const read = (name: string) => readFileSync(`supabase/migrations/${name}`, 'utf8')
  .replace(/\r\n?/gu, '\n');
const original = read('124_phase5_canonical_collection_reversal_writers.sql');
const correction = read('125_phase5_collection_lock_lint_correction.sql');
const writer = (sql: string) => {
  const start = sql.indexOf('FUNCTION phase5_private.commit_customer_collection_v1(');
  assert.ok(start >= 0);
  const end = sql.indexOf('\n$$;', start);
  assert.ok(end > start);
  return sql.slice(start, end + 4);
};

test('Migration 125 changes only unused assignment, preserving all collection behavior and lock order', () => {
  const expected = writer(original)
    .replace('  v_shift_id UUID;\n', '')
    .replace('  v_shift_id := public.phase4_lock_customer_order_context_internal(',
      '  PERFORM public.phase4_lock_customer_order_context_internal(');
  assert.equal(writer(correction), expected);
  assert.match(correction, /^BEGIN;/u);
  assert.match(correction, /COMMIT;\s*$/u);
  assert.equal((correction.match(/CREATE OR REPLACE FUNCTION/gu) ?? []).length, 1);
  assert.match(correction, /SECURITY INVOKER\s+SET search_path = pg_catalog/u);
  assert.match(correction, /FROM PUBLIC, anon, authenticated, service_role/u);
  assert.match(correction, /OWNER TO postgres/u);
  assert.doesNotMatch(correction, /\bGRANT\b|SECURITY DEFINER|\b(?:DROP|TRUNCATE)\b/u);
});

const finding = (fn: string, message: string, level = 'warning extra') => ({
  function: fn, issues: [{ level, message, sqlState: '00000' }],
});

test('strict lint rejects the exact CI unused-shift warning in every structured output shape', () => {
  const bad = finding('phase5_private.commit_customer_collection_v1', 'never read variable "v_shift_id"');
  for (const payload of [bad, [bad], { results: [bad] }]) {
    assert.throws(() => assertPhase5DbLint(JSON.stringify(payload)));
  }
});

test('strict lint rejects mixed wrapper/root findings even when results look clean', () => {
  const allowed = finding('public._transfer_inventory_between_warehouses_phase2_legacy',
    'unused parameter "p_transfer_date"');
  const bad = finding('phase5_private.commit_customer_collection_v1', 'never read variable "v_shift_id"');
  for (const results of [[], [allowed], [bad]]) {
    for (const root of [bad, allowed, { function: bad.function }, { issues: bad.issues }]) {
      for (const payload of [{ results, ...root }, { ...root, results }]) {
        assert.throws(() => assertPhase5DbLint(JSON.stringify(payload)),
          /ambiguous|unsupported/iu);
      }
    }
  }
});

test('strict lint rejects hidden findings and malformed wrapper or row shapes', () => {
  const bad = finding('phase5_private.commit_customer_collection_v1', 'never read variable "v_shift_id"');
  for (const payload of [
    { results: [], findings: [bad] },
    { results: [], errors: [bad] },
    { results: [], unexpected: bad },
    { results: [], message: bad },
    { results: bad },
    { results: null },
    { results: [null] },
    { results: [[]] },
    { results: [{ results: [] }] },
    [null], [[]], null, true, 1, 'clean',
  ]) assert.throws(() => assertPhase5DbLint(JSON.stringify(payload)));
});

test('strict lint validates all rows and issues without masking an unexpected finding', () => {
  const allowed = finding('public._transfer_inventory_between_warehouses_phase2_legacy',
    'unused parameter "p_transfer_date"');
  const bad = finding('phase5_private.commit_customer_collection_v1', 'never read variable "v_shift_id"');
  for (const rows of [[allowed, bad], [bad, allowed]]) {
    for (const payload of [rows, { results: rows }]) {
      assert.throws(() => assertPhase5DbLint(JSON.stringify(payload)));
    }
  }
  assert.throws(() => assertPhase5DbLint(JSON.stringify({
    ...allowed, issues: [...allowed.issues, ...bad.issues],
  })));
});

test('strict lint preserves exclusive supported clean and compatibility output shapes', () => {
  const allowed = finding('public._transfer_inventory_between_warehouses_phase2_legacy',
    'unused parameter "p_transfer_date"');
  for (const payload of [allowed, [allowed], { results: [allowed] },
    { results: [allowed], message: 'db lint' }]) {
    assert.deepEqual(assertPhase5DbLint(JSON.stringify(payload)), [
      { function: allowed.function, ...allowed.issues[0] },
    ]);
  }
  for (const payload of [[], { results: [] }, { results: [], message: 'db lint' }]) {
    assert.deepEqual(assertPhase5DbLint(JSON.stringify(payload)), []);
  }
  assert.deepEqual(assertPhase5DbLint('No schema errors found.'), []);
});

test('strict lint allows only the exact historical compatibility warning and clean output', () => {
  const allowed = finding('public.transfer_inventory_between_warehouses', 'unused parameter "p_transfer_date"');
  assert.equal(assertPhase5DbLint(JSON.stringify([allowed])).length, 1);
  assert.equal(assertPhase5DbLint(JSON.stringify([
    finding('public._transfer_inventory_between_warehouses_phase2_legacy',
      'unused parameter "p_transfer_date"'),
  ])).length, 1);
  assert.deepEqual(assertPhase5DbLint('No schema errors found'), []);
  assert.deepEqual(assertPhase5DbLint('[]'), []);
  for (const bad of [
    finding('public.transfer_inventory_between_warehouses', 'unused parameter "other"'),
    finding('other_function', 'unused parameter "p_transfer_date"'),
    finding('public.transfer_inventory_between_warehouses', 'unused parameter "p_transfer_date"', 'error'),
  ]) assert.throws(() => assertPhase5DbLint(JSON.stringify([allowed, bad])));
  for (const text of ['', 'garbage', '{}', '{"results":null}',
    '{"function":"x","issues":[]}']) assert.throws(() => assertPhase5DbLint(text));
});
