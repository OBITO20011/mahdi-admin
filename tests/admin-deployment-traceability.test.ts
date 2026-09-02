import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};
const deploymentScript = readFileSync(
  'scripts/deployment/deploy-admin.mjs',
  'utf8'
);

test('admin deployment records the exact verified main commit in Cloudflare metadata', () => {
  assert.equal(
    packageJson.scripts['deploy:admin'],
    'node scripts/deployment/deploy-admin.mjs'
  );
  assert.equal(
    packageJson.scripts['deploy:admin:check'],
    'node scripts/deployment/deploy-admin.mjs --check'
  );
  assert.match(deploymentScript, /branch !== 'main'/);
  assert.match(deploymentScript, /status', '--porcelain'/);
  assert.match(deploymentScript, /ls-remote', 'origin', 'refs\/heads\/main'/);
  assert.match(deploymentScript, /localSha !== remoteMain/);
  assert.match(deploymentScript, /process\.env\.npm_execpath/);
  assert.match(deploymentScript, /run\(process\.execPath/);
  assert.match(deploymentScript, /`--commit-hash=\$\{localSha\}`/);
  assert.match(deploymentScript, /`--commit-message=\$\{commitMessage\}`/);
});
