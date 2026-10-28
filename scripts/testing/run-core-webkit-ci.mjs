import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

assert.equal(process.argv.length, 2, 'CORE_WEBKIT_EXTRA_ARGUMENTS_REFUSED');
const root = path.resolve(import.meta.dirname, '../..');
const env = {...process.env, NAWASRAH_DEPLOYMENT_ENV: 'production',
  NAWASRAH_BROWSER_GROUP: 'core', NAWASRAH_CORE_BROWSER_GROUP: 'webkit'};
for (const args of [['scripts/testing/verify-browser-network-isolation.mjs'],
  ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.ci.config.ts']]) {
  const result = spawnSync(process.execPath, args, {cwd: root, env, stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
