import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {canonicalLf,canonicalDefinitionLf, futureMigrationViolations, GRANDFATHERED_MIGRATION_CEILING, manifestDigest,
  migrationManifest, referenceIsFresh, renderFunctionReference} from '../scripts/testing/maintenance-db-contract.mjs';

const root = path.resolve('.');
test('function definition digest and visible body share idempotent EOL normalization,not migration hashes',()=>{
 const definition='CREATE FUNCTION public.probe() RETURNS int LANGUAGE sql AS $$\n SELECT 1;\n$$;\n';
 const row={identity:'probe()',owner:'postgres',securityDefiner:false,volatility:'v',configuration:[],acl:null,executeGrants:[],extension:null,definition};
 const mixed=definition.replace('\n SELECT','\r\r\n SELECT'),manifest=[{name:'199_probe.sql',sha256:'example'}];
 assert.equal(renderFunctionReference(manifest,[row]),renderFunctionReference(manifest,[{...row,definition:mixed}]));
 assert.notEqual(renderFunctionReference(manifest,[row]),renderFunctionReference(manifest,[{...row,definition:definition.replace('SELECT 1','SELECT 2')}]));
 assert.equal(canonicalDefinitionLf(canonicalDefinitionLf(mixed)),definition);
 assert.equal(canonicalDefinitionLf('SELECT\r1;'),'SELECT\r1;');
 assert.equal(canonicalLf('a\r\r\nb'),'a\r\nb','Historical migration fingerprints must NOT acquire definition-only normalization');
});
test('generated DB reference is fresh for exact migration names/content,not just the ceiling', async () => {
  const manifest = await migrationManifest(root);
  const text = await readFile('docs/generated/DB_FUNCTIONS.md', 'utf8');
  assert.ok(referenceIsFresh(text, manifest), 'DB_FUNCTIONS_STALE: npm run docs:db-functions');
  assert.equal(referenceIsFresh(text, [...manifest, {name: '139_future.sql', sha256: 'different'}]), false);
  assert.equal(referenceIsFresh(text, [{...manifest[0], sha256: 'edited'}, ...manifest.slice(1)]), false);
  assert.equal(referenceIsFresh(text, [{...manifest[0], name: '001_renamed.sql'}, ...manifest.slice(1)]), false);
  assert.equal(referenceIsFresh('missing metadata', manifest), false);
  assert.equal(canonicalLf('a\r\nb\r\n'), 'a\nb\n');
});
test('every future migration must be explicit and may not add new before-functions/text patches', async () => {
  assert.equal(GRANDFATHERED_MIGRATION_CEILING, 138); // Policy boundary,not current approved ceiling.
  const manifest = await migrationManifest(root);
  for (const entry of manifest.filter(m => Number(m.name.split('_')[0]) > GRANDFATHERED_MIGRATION_CEILING)) {
    const sql = await readFile(path.join(root, 'supabase/migrations', entry.name), 'utf8');
    assert.deepEqual(futureMigrationViolations(sql), [], entry.name);
  }
});
test('migration policy rejects unquoted/quoted/mixed-case/new-renamed layers and text patching controls', () => {
  for (const sql of [
    'CREATE FUNCTION public._before_new() RETURNS void AS $$BEGIN END$$ LANGUAGE plpgsql;',
    'CREATE OR REPLACE FUNCTION "public"."_old_before_new"() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;',
    'CREATE FUNCTION _x_before_new() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;',
    'ALTER FUNCTION public.x(int) RENAME TO _x_before_new;',
    'ALTER FUNCTION "public"."x"() RENAME TO "_before_new";',
    'DO $$ BEGIN SELECT pg_get_functiondef(1); END $$;',
    'DO $$ BEGIN SELECT "pg_catalog"."pg_get_functiondef"(1); END $$;',
    'DO $$ BEGIN v_sql := REPLACE(v_sql,\'old\',\'new\'); EXECUTE v_sql; END $$;',
    'DO $$ BEGIN EXECUTE format(\'CREATE OR REPLACE FUNCTION public.x() RETURNS void AS ...\'); END $$;',
    'DO $$ BEGIN v_sql := regexp_replace(v_sql,\'a\',\'b\'); EXECUTE v_sql; END $$;',
  ]) assert.ok(futureMigrationViolations(sql).length > 0, sql);
  for (const sql of [
    'CREATE OR REPLACE FUNCTION public.x() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;',
    '-- pg_get_functiondef(1); CREATE FUNCTION x_before_y()\nSELECT 1;',
    '/* nested /* pg_get_functiondef(1) */ CREATE FUNCTION x_before_y() */ SELECT 1;',
    "SELECT replace(customer_name,'a','b');",
    'SELECT public._old_before_new();', // Existing calls are not new layers.
  ]) assert.deepEqual(futureMigrationViolations(sql), [], sql);
});
test('deterministic reference includes overloads,full definitions,owner/ACL/config and extension provenance', () => {
  const row = {identity: 'f(integer)', owner: 'postgres', securityDefiner: true, volatility: 's', configuration: ['search_path=public, pg_temp'],
    executeGrants: [{role: 'authenticated'}], acl: ['authenticated=X/postgres'], extension: null, definition: 'CREATE FUNCTION public.f(integer) RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;\r\n'};
  const rows = [row, {...row, identity: 'f(text)'}], manifest = [{name: '001_x.sql', sha256: 'test'}];
  const text = renderFunctionReference(manifest, rows);
  assert.equal(text, renderFunctionReference(manifest, [...rows].reverse()));
  assert.ok(referenceIsFresh(text, manifest)); assert.ok(text.includes(manifestDigest(manifest)));
  for (const value of ['f(integer)', 'f(text)', 'search_path=public, pg_temp', 'authenticated=X/postgres', row.definition.trimEnd()])
    assert.ok(text.includes(value), value);
});
test('reference runtime only rebuilds isolated schema and compares full generated bytes in CI', async () => {
  const script = await readFile('scripts/testing/generate-db-functions.mjs', 'utf8');
  assert.match(script, /nawasrah-maintenance-reference-test/u); assert.match(script, /BEGIN READ ONLY/u);
  assert.match(script, /n\.nspname='public'/u); assert.match(script, /DB_FUNCTIONS_STALE/u);
  assert.doesNotMatch(script, /process\.env\.(?:DATABASE_URL|SUPABASE_DB_PASSWORD|NAWASRAH_SUPABASE_DATABASE_URL)/u);
  const ci = await readFile('.github/workflows/quality.yml', 'utf8');
  assert.match(ci, /npm run docs:db-functions:check/u);
});
