import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..'), group = process.argv[2];
assert.ok(['core', 'package-f'].includes(group));
const files = JSON.parse(process.env.PRIVATE_CI_FILES ?? 'null');
assert.ok(Array.isArray(files) && files.every(file => /^e2e\/[a-z0-9_.\/-]+\.[cm]?[jt]sx?$/iu.test(file) && !file.includes('..')));
if (group === 'package-f') assert.ok(files.length > 0);
const shard = process.argv.slice(3);
assert.ok(group === 'core' ? shard.length === 0 : shard.length === 1 && /^--shard=[123]\/3$/u.test(shard[0]));
function run(command, args) {
  const result = spawnSync(command, args, {cwd: root, stdio: 'inherit', env: {...process.env, NAWASRAH_BROWSER_GROUP: group}});
  if (result.error) throw result.error; if (result.status !== 0) process.exit(result.status ?? 1);
}
const node = args => run(process.execPath, args);
const npm = args => process.platform === 'win32' ? run('cmd.exe', ['/d', '/s', '/c', 'npm.cmd', ...args]) : run('npm', args);
if (group === 'core') {
  npm(['run', 'lint']); npm(['test']); npm(['--prefix', 'customer-web', 'run', 'lint']); npm(['--prefix', 'customer-web', 'test']);
}
node(['scripts/testing/verify-browser-network-isolation.mjs']);
if (files.length) node(['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.ci.config.ts', ...shard, ...files]);
else console.log('No browser specs affected;all type/lint/unit gates completed. Full suite remains manual/weekly/release.');
