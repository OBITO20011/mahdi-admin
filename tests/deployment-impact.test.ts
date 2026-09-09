import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
  DEPLOYMENT_FRESHNESS,
  adminPackageChangeAffectsBuild,
  commitAffectsDeployment,
  evaluateCloudflareDeployment,
  expectedDeploymentFromCommits,
  resolveRepositoryMainSha,
} from '../scripts/monitoring/deployment-impact.mjs';
import {runIncidentCycle} from '../scripts/monitoring/developer-alert-core.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const commit = (sha: string, files: string[], adminPackageImpact = false) => ({sha, files, adminPackageImpact});
const resolve = (app: 'admin' | 'customer', deployedSha: string, mainSha: string, commits: ReturnType<typeof commit>[]) => (
  expectedDeploymentFromCommits({app, deployedSha, mainSha, commits})
);

test('Admin remains current after a docs-only commit', () => {
  assert.equal(resolve('admin', A, B, [commit(B, ['docs/README.md'])]).status, DEPLOYMENT_FRESHNESS.CURRENT);
});

test('Customer remains current after an operational backup commit', () => {
  assert.equal(resolve('customer', A, B, [commit(B, ['scripts/backup/run-backup.ps1'])]).status, DEPLOYMENT_FRESHNESS.CURRENT);
});

test('Admin source change requires an Admin deployment', () => {
  const result = resolve('admin', A, B, [commit(B, ['src/App.tsx'])]);
  assert.equal(result.status, DEPLOYMENT_FRESHNESS.DEPLOYMENT_BEHIND);
  assert.equal(result.expectedSha, B);
});

test('Customer source change requires a Customer deployment', () => {
  const result = resolve('customer', A, B, [commit(B, ['customer-web/src/App.tsx'])]);
  assert.equal(result.status, DEPLOYMENT_FRESHNESS.DEPLOYMENT_BEHIND);
  assert.equal(result.expectedSha, B);
});

test('Admin-only change leaves Customer current', () => {
  const commits = [commit(B, ['src/App.tsx'])];
  assert.equal(resolve('admin', A, B, commits).status, DEPLOYMENT_FRESHNESS.DEPLOYMENT_BEHIND);
  assert.equal(resolve('customer', A, B, commits).status, DEPLOYMENT_FRESHNESS.CURRENT);
});

test('Customer-only change leaves Admin current', () => {
  const commits = [commit(B, ['customer-web/src/App.tsx'])];
  assert.equal(resolve('customer', A, B, commits).status, DEPLOYMENT_FRESHNESS.DEPLOYMENT_BEHIND);
  assert.equal(resolve('admin', A, B, commits).status, DEPLOYMENT_FRESHNESS.CURRENT);
});

test('dependency updates affecting both independent builds advance both expected SHAs', () => {
  const commits = [commit(B, ['package-lock.json', 'customer-web/package-lock.json'], true)];
  assert.equal(resolve('admin', A, B, commits).expectedSha, B);
  assert.equal(resolve('customer', A, B, commits).expectedSha, B);
});

test('latest relevant application commit is retained across newer unrelated commits', () => {
  const result = resolve('admin', A, C, [commit(C, ['docs/README.md']), commit(B, ['src/App.tsx'])]);
  assert.equal(result.status, DEPLOYMENT_FRESHNESS.DEPLOYMENT_BEHIND);
  assert.equal(result.expectedSha, B);
});

test('deployment matching the relevant SHA stays current when HEAD is newer', () => {
  assert.equal(resolve('admin', B, C, [commit(C, ['scripts/backup/run-backup.ps1'])]).status, DEPLOYMENT_FRESHNESS.CURRENT);
});

test('Cloudflare availability remains separate from source freshness', () => {
  const result = evaluateCloudflareDeployment({
    cloudflareAvailable: false, projectRoot: '.', app: 'admin', deployedSha: A, mainSha: B,
  });
  assert.equal(result.status, DEPLOYMENT_FRESHNESS.CLOUDFLARE_UNAVAILABLE);
  assert.notEqual(result.status, DEPLOYMENT_FRESHNESS.DEPLOYMENT_BEHIND);
});

test('actual HTTP outages retain independent uptime incidents', async () => {
  const watchdog = await readFile('scripts/monitoring/run-developer-watchdog.mjs', 'utf8');
  assert.match(watchdog, /async function collectPublicServiceChecks/u);
  assert.match(watchdog, /developer:uptime:\$\{service\.key\}/u);
  assert.match(watchdog, /developer:cloudflare:\$\{project\.key\}/u);
});

test('missing source metadata is unresolved rather than behind or down', () => {
  const result = expectedDeploymentFromCommits({app: 'admin', deployedSha: '', mainSha: B, commits: []});
  assert.equal(result.status, DEPLOYMENT_FRESHNESS.SOURCE_UNRESOLVED);
});

test('repository main SHA resolver uses the scoped safe-directory Git path', () => {
  const result = resolveRepositoryMainSha(process.cwd());
  assert.match(result.sha, /^[a-f0-9]{40}$/u);
  assert.ok(['origin', 'refs/remotes/origin/main', 'refs/heads/main'].includes(result.source));
});

test('root package changes matter to Admin only when the web build closure changes', () => {
  assert.equal(commitAffectsDeployment('admin', ['package-lock.json'], {adminPackageImpact: false}), false);
  assert.equal(commitAffectsDeployment('admin', ['package-lock.json'], {adminPackageImpact: true}), true);
});

test('TypeScript build configuration advances only its owning application', () => {
  const adminCommit = [commit(B, ['tsconfig.json'])];
  assert.equal(resolve('admin', A, B, adminCommit).status, DEPLOYMENT_FRESHNESS.DEPLOYMENT_BEHIND);
  assert.equal(resolve('customer', A, B, adminCommit).status, DEPLOYMENT_FRESHNESS.CURRENT);

  const customerCommit = [commit(B, ['customer-web/tsconfig.json'])];
  assert.equal(resolve('customer', A, B, customerCommit).status, DEPLOYMENT_FRESHNESS.DEPLOYMENT_BEHIND);
  assert.equal(resolve('admin', A, B, customerCommit).status, DEPLOYMENT_FRESHNESS.CURRENT);
});

test('Admin package comparison ignores unrelated operational dependencies', () => {
  const lock = (extra = {}) => JSON.stringify({packages: {
    '': {},
    'node_modules/react': {version: '19.0.1', dependencies: {}},
    ...extra,
  }});
  const manifest = (extra = {}) => JSON.stringify({scripts: {build: 'vite build'}, dependencies: {react: '^19.0.1', ...extra}});
  assert.equal(adminPackageChangeAffectsBuild(
    {manifest: manifest(), lock: lock()},
    {manifest: manifest({'@aws-sdk/client-s3': '^3.0.0'}), lock: lock({'node_modules/@aws-sdk/client-s3': {version: '3.0.0'}})},
  ), false);
  assert.equal(adminPackageChangeAffectsBuild(
    {manifest: manifest(), lock: lock()},
    {manifest: JSON.stringify({scripts: {build: 'vite build --minify=false'}, dependencies: {react: '^19.0.1'}}), lock: lock()},
  ), true);
});

test('deployment incidents deduplicate and emit one recovery after becoming current', async () => {
  const base = {
    key: 'developer:cloudflare:admin', source: 'Cloudflare Pages', severity: 'high',
    summary: 'Admin deployment behind.', details: {}, observedAt: '2026-09-10T00:00:00.000Z',
  };
  const deliveries: string[] = [];
  const send = async (item: {kind: string}) => { deliveries.push(item.kind); return true; };
  const first = await runIncidentCycle({
    checks: [{...base, healthy: false}], state: {version: 1, incidents: {}}, send,
    now: new Date('2026-09-10T00:00:00.000Z'),
  });
  const duplicate = await runIncidentCycle({
    checks: [{...base, healthy: false}], state: first.state, send,
    now: new Date('2026-09-10T00:05:00.000Z'),
  });
  const recovery = await runIncidentCycle({
    checks: [{...base, healthy: true, summary: 'Admin deployment current.'}], state: duplicate.state, send,
    now: new Date('2026-09-10T00:10:00.000Z'),
  });
  await runIncidentCycle({
    checks: [{...base, healthy: true, summary: 'Admin deployment current.'}], state: recovery.state, send,
    now: new Date('2026-09-10T00:15:00.000Z'),
  });
  assert.deepEqual(deliveries, ['incident', 'recovery']);
});
