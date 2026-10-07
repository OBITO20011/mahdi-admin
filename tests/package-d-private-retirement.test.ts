import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
const migration=readFileSync('supabase/migrations/132_package_d_system_unification.sql','utf8');
test('private retirement is explicit, fail-closed and in the same migration transaction',()=>{
  assert.match(migration,/^BEGIN;/);assert.match(migration,/COMMIT;\s*$/);
  const retirement=migration.slice(migration.indexOf('-- D4:'));
  assert.match(retirement,/LOCK TABLE[\s\S]*IN ACCESS EXCLUSIVE MODE/);
  assert.match(retirement,/PACKAGE_D_PRIVATE_DATA_PRESENT/);assert.match(retirement,/PACKAGE_D_PRIVATE_CALLER_PRESENT/);
  assert.match(retirement,/FROM cron\.job/);
  assert.doesNotMatch(retirement.replace(/^--.*$/gm,''),/\bCASCADE\b|\bEXECUTE\b|pg_get_functiondef/);
  assert.match(retirement,/DROP SCHEMA phase5_private RESTRICT;/);
  const expected=new Set<string>();
  for(const file of readdirSync('supabase/migrations').filter(f=>/^12[3-7]_/.test(f))) {
    const sql=readFileSync(`supabase/migrations/${file}`,'utf8');
    for(const match of sql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION (phase5_private\.\w+)\(([\s\S]*?)\)\s*RETURNS/g)) {
      const args=match[2].trim()?match[2].split(',').map(arg=>arg.trim().split(/\s+/).slice(1).join(' ').replace(/ DEFAULT[\s\S]*/,'')).join(','):'';
      expected.add(`${match[1]}(${args})`);
    }
  }
  const actual=[...retirement.matchAll(/DROP FUNCTION (phase5_private\.\w+\([^;]*\)) RESTRICT;/g)].map(m=>m[1]);
  assert.equal(new Set(actual).size,actual.length);assert.deepEqual([...new Set(actual)].sort(),[...expected].sort());
  assert.equal([...retirement.matchAll(/DROP TABLE phase5_private\.\w+ RESTRICT;/g)].length,6);
});
test('only unused private verification is retired; active operational money tests and historical migrations remain',()=>{
  const pkg=JSON.parse(readFileSync('package.json','utf8'));
  assert.equal(pkg.scripts['test:phase5-operational-fixes:runtime'],'node scripts/testing/run-phase5-operational-fixes-runtime.mjs');
  for(const slice of [1,2,3,4]) assert.equal(pkg.scripts[`test:phase5-slice${slice}:runtime`],undefined);
  assert.equal(existsSync('tests/phase5-operational-fixes.test.ts'),true);
  assert.equal(existsSync('docs/agent/evidence/phase5-preimplementation'),false);
  assert.equal(readdirSync('supabase/migrations').filter(f=>/^12[3-7]_/.test(f)).length,5);
});
