import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync, appendFileSync} from 'node:fs';
import path from 'node:path';
import {ciRoute, isPackageFSpec, selectAffectedSpecs} from './private-ci-scope.mjs';
import {packageFShardCount,packageFShards} from './package-f-ci-shards.mjs';
import {listBrowserTests} from './ci-browser-discovery.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const git = args => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
const mode = ciRoute({flag: process.env.PRIVATE_CI_BUDGET_MODE, isPrivate: process.env.CI_REPOSITORY_PRIVATE === 'true', event: process.env.GITHUB_EVENT_NAME});
assert.notEqual(mode, 'disabled', 'Dormant scheduled scope must not execute');
const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean);
const specs = tracked.filter(name => /^e2e\/.*\.spec\.ts$/u.test(name)).sort();
let selected = specs, reason = 'full';
if (mode === 'affected') {
  const allReport = JSON.parse(execFileSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test',
    '--list', '--reporter=json', '--config', 'playwright.config.ts'], {cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024}));
  assert.deepEqual(allReport.errors, []); const discovered = new Set();
  const visit = suite => {
    for (const spec of suite.specs ?? []) discovered.add(path.relative(root, path.isAbsolute(spec.file) ? spec.file : path.resolve(root, 'e2e', spec.file)).replaceAll('\\', '/'));
    for (const child of suite.suites ?? []) visit(child);
  }; for (const suite of allReport.suites) visit(suite);
  const discoveredSpecs = [...discovered].sort(); assert.ok(discoveredSpecs.length > 0);
  selected = discoveredSpecs;
  const base = process.env.CI_BASE_SHA;
  if (!base || /^0+$/u.test(base)) reason = 'missing-base-full-browser';
  else {
    assert.match(base, /^[a-f0-9]{40}$/u);
    // Failure to establish diff fails the push; never substitutes an empty set.
    const changed = git(['diff', '--name-only', base, 'HEAD', '--']).split('\n').filter(Boolean);
    const contents = Object.fromEntries(tracked.filter(file => /\.(?:tsx?|m?js|jsx|css|html|json)$/u.test(file)
      && !file.startsWith('docs/')).map(file => [file, readFileSync(path.join(root, file), 'utf8')]));
    const result = selectAffectedSpecs(contents, changed, {typescript: await import('typescript'), discoveredSpecs}); selected = result.files; reason = result.reason;
  }
}
const core = selected.filter(file => !isPackageFSpec(file)), packageF = selected.filter(isPackageFSpec);
const list = (group, files, shard) => {
  if (!files.length) return [];
  return listBrowserTests(group,{files,shard,ci:true}).map(row=>row.key);
};
let shards = [...packageFShards], cases = null;
if (mode === 'affected') {
  const fullIds = [...list('core', core), ...list('package-f', packageF)];
  const perShard = packageFShards.map(shard => list('package-f', packageF, shard));
  const partition = [...list('core', core), ...perShard.flat()];
  assert.equal(new Set(partition).size, partition.length, 'Duplicate affected test identity');
  assert.deepEqual(partition.sort(), fullIds.sort(), 'Affected shard union loses/substitutes tests');
  shards = packageFShards.filter(shard => perShard[shard - 1].length > 0); cases = fullIds.length;
}
const outputs = {mode, full: String(mode === 'full'), core_files: JSON.stringify(core), package_f_files: JSON.stringify(packageF),
  package_f_needed: String(packageF.length > 0), shard_count:String(packageFShardCount), shards: JSON.stringify(shards.length ? shards : [1])};
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([k, v]) => `${k}=${v}\n`).join(''));
console.log(JSON.stringify({mode, reason, coreFiles: core.length, packageFFiles: packageF.length, shards, cases}));
