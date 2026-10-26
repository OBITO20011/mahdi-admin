// Full local214 acceptance. Every database uses a disposable Docker identity.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {enrichService214Evidence} from '../audit/enrich-service214-evidence.mjs';
const exec = promisify(execFile), root = path.resolve(import.meta.dirname, '../..');
const output = await mkdtemp(path.join(tmpdir(), 'nawasrah-handover214-gate-'));
const reference = path.join(output, 'local-reference-through214-ready.json');
for (const args of [
  ['scripts/testing/verify-edge-locks213.mjs'],
  ['scripts/testing/run-staff-z-edge-runtime.mjs'],
  ['scripts/testing/run-handover-z214-runtime.mjs'],
  ['scripts/testing/run-handover-z-maps-runtime.mjs'],
  ['scripts/testing/run-handover-z-shifts-runtime.mjs'],
  ['scripts/testing/run-handover-z-collections-runtime.mjs'],
  ['scripts/audit/run-table-access-diagnostic.mjs', '--migration-ceiling', '214', '--require-access'],
  ['scripts/audit/run-service-access-diagnostic.mjs', '--migration-ceiling', '214'],
  ['scripts/operations/build-acl-reference214.mjs', '--output', reference],
  ['scripts/testing/run-handover-upgrade214-runtime.mjs', reference],
  ['scripts/testing/run-trial-reset-runtime.mjs', reference, '--current214'],
  ['scripts/testing/run-reset214-cli-contract.mjs', reference],
]) {
  const result = await exec(process.execPath, args, {cwd: root, windowsHide: true, maxBuffer: 16 * 1024 ** 2});
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  if (args[0] === 'scripts/audit/run-table-access-diagnostic.mjs') {
    const summary = JSON.parse(result.stdout.trim().split('\n').at(-1));
    await copyFile(path.join(summary.output, 'diagnostic.json'), path.join(root, 'docs/operations/TABLE_ACCESS_AFTER_214.json'));
  }
  if (args[0] === 'scripts/audit/run-service-access-diagnostic.mjs') {
    const summary = JSON.parse(result.stdout.trim().split('\n').at(-1));
    await enrichService214Evidence(path.join(summary.output, 'diagnostic.json'));
  }
}
