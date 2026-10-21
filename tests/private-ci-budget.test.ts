import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {ciRoute, selectAffectedSpecs, verifyCiBranches} from '../scripts/testing/private-ci-scope.mjs';
import {verifyFullDeliveryJobs} from '../scripts/agent/verify-delivery-ci.mjs';
import {packageFShardCount,packageFShards} from '../scripts/testing/package-f-ci-shards.mjs';

test('single private flag stays dormant for public/unset;dispatch always full;weekly dormant until private opt-in', () => {
  for (const flag of [undefined, '', 'false']) for (const isPrivate of [false, true]) {
    assert.equal(ciRoute({flag, isPrivate, event: 'push'}), 'full');
    assert.equal(ciRoute({flag, isPrivate, event: 'schedule'}), 'disabled');
  }
  assert.equal(ciRoute({flag: 'true', isPrivate: false, event: 'push'}), 'full');
  for (const event of ['push', 'pull_request']) assert.equal(ciRoute({flag: 'true', isPrivate: true, event}), 'affected');
  for (const event of ['workflow_dispatch', 'schedule']) assert.equal(ciRoute({flag: 'true', isPrivate: true, event}), 'full');
});
const files = {'e2e/a.spec.ts': "page.goto('/e2e/a.html')", 'e2e/b.spec.ts': "import './b.fixture';",
  'e2e/a.html': '<script src="./a.tsx"></script>', 'e2e/a.tsx': "import '../src/components/A';",
  'src/components/A.tsx': "import '../utils/shared';", 'src/utils/shared.ts': 'export const x=1;',
  'e2e/b.fixture.ts': "import '../src/components/B';", 'src/components/B.tsx': ''};
test('affected closure includes runtime HTML,harness,fixture,transitive imports;never filters loaded-page data', () => {
  assert.deepEqual(selectAffectedSpecs(files, ['src/utils/shared.ts']).files, ['e2e/a.spec.ts']);
  assert.deepEqual(selectAffectedSpecs(files, ['src/components/B.tsx']).files, ['e2e/b.spec.ts']);
  assert.deepEqual(selectAffectedSpecs(files, ['e2e/a.html']).files, ['e2e/a.spec.ts']);
  assert.deepEqual(selectAffectedSpecs(files, ['e2e/a.spec.ts']).files, ['e2e/a.spec.ts']);
  assert.deepEqual(selectAffectedSpecs(files, ['docs/agent/ACTIVE_TASK.json']).files, []);
});
test('unknown/deleted/config/backend/computed-runtime paths fall back to every browser spec,not no tests', () => {
  for (const changed of ['src/deleted.ts', 'package-lock.json', 'playwright.config.ts', 'supabase/migrations/139_x.sql', 'scripts/testing/x.mjs'])
    assert.deepEqual(selectAffectedSpecs(files, [changed]).files, ['e2e/a.spec.ts', 'e2e/b.spec.ts']);
  assert.deepEqual(selectAffectedSpecs({...files, 'e2e/a.tsx': 'import(dynamicModule)'}, ['src/components/B.tsx']).files, ['e2e/a.spec.ts', 'e2e/b.spec.ts']);
  assert.deepEqual(selectAffectedSpecs({...files, 'e2e/a.tsx': "import 'unconfiguredAlias/B';"}, ['src/components/B.tsx']).files, ['e2e/a.spec.ts', 'e2e/b.spec.ts']);
});
test('TS bindings recognize const imports but reject parameters shadowing identical literal names', () => {
  const known = {...files, 'e2e/a.tsx': "const p='../src/components/A'; import(/* @vite-ignore */p);"};
  assert.deepEqual(selectAffectedSpecs(known, ['src/components/B.tsx'], {typescript: ts}).files, ['e2e/b.spec.ts']);
  const unknown = {...files, 'e2e/a.tsx': "const p='../src/components/A'; function load(p:string){return import(/* @vite-ignore */p);}"};
  assert.deepEqual(selectAffectedSpecs(unknown, ['src/components/B.tsx'], {typescript: ts}).files, ['e2e/a.spec.ts', 'e2e/b.spec.ts']);
  assert.deepEqual(selectAffectedSpecs({...files, 'e2e/a.spec.ts': 'page.goto(`/e2e/a.html?theme=${theme}`)'}, ['src/components/A.tsx']).files, ['e2e/a.spec.ts']);
});
test('native discovery includes future custom test filenames,not just historical .spec.ts patterns', () => {
  const future = {...files, 'e2e/c.custom.tsx': 'export {}'};
  assert.deepEqual(selectAffectedSpecs(future, ['e2e/c.custom.tsx'], {discoveredSpecs: ['e2e/a.spec.ts', 'e2e/b.spec.ts', 'e2e/c.custom.tsx']}).files, ['e2e/c.custom.tsx']);
});
test('full aggregation retains all original branches;affected may skip only declared full branches and unneeded F', () => {
  const full = Object.fromEntries(['scope', 'quality', 'package-f-browser', 'database-runtime', 'current-database-runtime', 'pwa-release-update'].map(name => [name, {result: 'success'}]));
  verifyCiBranches(full, {mode: 'full', packageFNeeded: true});
  for (const name of Object.keys(full)) for (const result of ['skipped', 'failure', 'cancelled'])
    assert.throws(() => verifyCiBranches({...full, [name]: {result}}, {mode: 'full', packageFNeeded: true}));
  const light = {...full, 'database-runtime': {result: 'skipped'}, 'current-database-runtime': {result: 'skipped'}, 'pwa-release-update': {result:'skipped'}};
  verifyCiBranches(light, {mode: 'affected', packageFNeeded: true});
  assert.throws(() => verifyCiBranches({...light, 'package-f-browser': {result: 'skipped'}}, {mode: 'affected', packageFNeeded: true}));
  verifyCiBranches({...light, 'package-f-browser': {result: 'skipped'}}, {mode: 'affected', packageFNeeded: false});
  assert.throws(() => verifyCiBranches(light, {mode: 'invalid', packageFNeeded: true}));
});
test('same timeouts/retries/images/full runners remain;uptime schedule stays untouched and no flag is activated in code', async () => {
  const workflow = await readFile('.github/workflows/quality.yml', 'utf8');
  assert.match(workflow, /PRIVATE_CI_BUDGET_MODE == 'true'/u); assert.match(workflow, /github\.event\.repository\.private/u);
  assert.match(workflow, /run-quality-ci\.mjs core/u); assert.match(workflow, /run-quality-ci\.mjs package-f/u);
  const runner = await readFile('scripts/testing/run-private-ci.mjs', 'utf8');
  assert.doesNotMatch(runner, /--retries|--timeout|pass-with-no-tests|test\.skip/u);
  for (const fragment of ["npm(['run', 'lint'])", "npm(['test'])", "'--prefix', 'customer-web', 'test'"]) assert.ok(runner.includes(fragment));
  assert.match(await readFile('.github/workflows/public-uptime.yml', 'utf8'), /cron: '7,37 \* \* \* \*'/u);
  assert.match(await readFile('scripts/agent/verify-delivery-ci.mjs', 'utf8'), /affected push is insufficient/u);
  const weekly = await readFile('.github/workflows/private-weekly-ci.yml', 'utf8');
  assert.match(weekly, /github\.event\.repository\.private && vars\.PRIVATE_CI_BUDGET_MODE == 'true'/u);
  assert.match(weekly, /quality\.yml secrets\.yml/u);
});
test('release verification still requires ALL DB matrix jobs and full browsers,not a green affected aggregate', async () => {
  const workflow = await readFile('.github/workflows/quality.yml', 'utf8');
  const suites = workflow.match(/suite: \[([^\]]+)\]/u)![1].split(',').map(s => s.trim());
  const names = ['CI full or affected scope','Complete quality delivery gate','Isolated database runtime regression','Installed admin app release update',
    'Lint, test, build and browser QA',...packageFShards.map(n=>`Package F browser QA (${n}/${packageFShardCount})`),
    ...suites.map(s=>`Isolated current contracts (${s})`)];
  const jobs = names.map(name=>({name,conclusion:'success'})); verifyFullDeliveryJobs(jobs);
  for (const name of names) {
    assert.throws(()=>verifyFullDeliveryJobs(jobs.filter(j=>j.name!==name)));
    assert.throws(()=>verifyFullDeliveryJobs(jobs.map(j=>j.name===name?{...j,conclusion:'skipped'}:j)));
  }
});
