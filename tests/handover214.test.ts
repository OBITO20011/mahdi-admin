import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {handover214Pins, sourceBeforeHandover214, pathsBeforeHandover214} from '../scripts/audit/source-before-handover214.mjs';
import {assert214History, upgrade214Versions} from '../scripts/operations/frankfurt-owner-upgrade214.mjs';
import {changed214Functions} from '../scripts/testing/handover214-contract.mjs';
import {futureMigrationViolations} from '../scripts/testing/maintenance-db-contract.mjs';
const read = (file: string) => readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const baseline = '2c2dcacaa45b20ee83da6e67fddbac3ca749d808';

test('Z exact outer inverse retains every prior pin and refuses arbitrary source mutations', () => {
  for (const [file, pin] of Object.entries(handover214Pins) as [string, {before: string; after: string; beforeText: string; added?: boolean}][]) {
    const current = read(file);
    assert.equal(hash(current), pin.after, file);
    assert.equal(hash(pin.beforeText), pin.before, file);
    assert.equal(sourceBeforeHandover214(file, current), pin.added ? null : pin.beforeText, file);
    assert.throws(() => sourceBeforeHandover214(file, current + '\nvoid unreviewed;\n'), /HANDOVER214_UNREVIEWED_SOURCE/, file);
    if (!pin.added) assert.equal(pin.beforeText, execFileSync('git', ['show', baseline + ':' + file], {encoding: 'utf8', maxBuffer: 8 * 1024 ** 2}).replaceAll('\r\n', '\n'), file);
  }
  assert.deepEqual(pathsBeforeHandover214(['supabase/unapproved.sql']), ['supabase/unapproved.sql']);
  const historical = execFileSync('git', ['diff', '--name-only', baseline, '--', 'supabase/migrations', 'scripts/audit/*-hunks.json', 'scripts/audit/handover213-inverse.json', 'scripts/audit/owner-acl212-inverse.json'], {encoding: 'utf8'}).trim().split('\n').filter(Boolean);
  assert.deepEqual(historical.filter(file => file !== 'supabase/migrations/214_handover_z_corrections.sql'), []);
});
test('214 contains only the six named existing definitions; no grant or backfill', () => {
  const sql = read('supabase/migrations/214_handover_z_corrections.sql');
  const names = [...sql.matchAll(/^CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)\(/gm)].map(match => match[1]);
  assert.deepEqual(names.sort(), [...changed214Functions].sort());
  assert.match(sql, /^--[^]*?BEGIN;[^]*COMMIT;\s*$/);
  assert.doesNotMatch(sql, /^\s*(?:GRANT|REVOKE|ALTER TABLE|CREATE TABLE|DROP |DO \$)/m);
  assert.doesNotMatch(sql, /pg_get_functiondef|EXECUTE\s+(?:format|replace)\(/i);
  const state = JSON.parse(read('docs/agent/project-state.json'));
  assert.equal(state.migrationCeiling, 214);
  assert.equal(state.migration214CanonicalLfSha256, hash(sql).toUpperCase());
  assert.deepEqual(futureMigrationViolations(sql), []);
  assert.ok(futureMigrationViolations(sql + '\n-- unreviewed bytes\n').includes('NEW_BEFORE_FUNCTION'));
  assert.ok(futureMigrationViolations('CREATE OR REPLACE FUNCTION public.package_d_settle_sales_return_before_guard_internal() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;').includes('NEW_BEFORE_FUNCTION'));
});
test('214 upgrade accepts complete212/213/214 only; missing history and future versions fail closed', () => {
  const base = JSON.parse(read('docs/operations/TABLE_ACCESS_AFTER_212.json')).manifest.map((file: string) => file.slice(0, 3));
  const reference = {prefixes: {'212': {appliedVersions: base}}, appliedVersions: [...base, '213', '214']};
  assert.deepEqual(upgrade214Versions, ['213', '214']);
  assert.deepEqual(assert214History(base, reference), ['213', '214']);
  assert.deepEqual(assert214History([...base, '213'], reference), ['214']);
  assert.deepEqual(assert214History(reference.appliedVersions, reference), []);
  for (const history of [base.slice(1), base.slice(0, -1), [...base, '214'], [...base, '213', '215'], [...reference.appliedVersions, '215']])
    assert.throws(() => assert214History(history, reference));
  const owner = read('scripts/operations/frankfurt-owner-upgrade214.mjs');
  assert.match(owner, /strictApplicationAcl:true/);
  assert.match(owner, /plan.commandCount,0/);
  assert.doesNotMatch(owner, /alignWithExecutor|GRANT EXECUTE|--no-verify-jwt/);
});
