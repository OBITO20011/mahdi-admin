// Disposable local PostgreSQL only. This runner is extended as T-B contracts
// land; the evidence explicitly names the contracts actually tested.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile, writeFile, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {aftercare215Context} from './aftercare215-context.mjs';
import {verifyInspectedReplacement215} from './aftercare215-inspected-runtime.mjs';
import {verifyInspectedSecurity215} from './aftercare215-security-runtime.mjs';
import {verifySupplierCredit215} from './aftercare215-credit-runtime.mjs';
import {verifyReturnPreview215} from './aftercare215-return-preview-runtime.mjs';

assert.equal(process.argv.length, 2, 'LOCAL_ONLY_NO_ARGUMENTS');
const exec = promisify(execFile), root = path.resolve(import.meta.dirname, '../..');
const project = 'nawasrah-tb215-test', container = 'supabase_db_' + project;
const cli = path.join(root, 'node_modules/supabase/dist/supabase.js');
const output = await mkdtemp(path.join(tmpdir(), 'nawasrah-aftercare215-'));
const report = {scope: 'G2/G3/G6 and ordinary-return pure preview foundations; sealedG1/G4/G5/UI/full delivery still pending', hostedConnections: 0, output, cases: [], ok: false};
const source = path.join(root, 'supabase/migrations/215_inspected_aftercare_and_supplier_credit.sql');
let local, stage = 'bootstrap214';
const pass = name => { report.cases.push({name, passed: true}); console.log(JSON.stringify(report.cases.at(-1))); };
try {
  const boot = await exec(process.execPath, [path.join(root, 'scripts/testing/bootstrap-isolated-supabase.mjs')], {
    cwd: root, windowsHide: true, maxBuffer: 32 * 1024 ** 2,
    env: {...process.env, NAWASRAH_ISOLATED_PROJECT_ID: project, NAWASRAH_MAX_MIGRATION: '214', NAWASRAH_SKIP_REDUNDANT_DB_RESET: 'true', NAWASRAH_SUPABASE_EXCLUDE: 'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'},
  });
  local = JSON.parse(boot.stdout).isolatedProjectRoot;
  const c = aftercare215Context(container);
  stage = 'apply215';
  const migration = await readFile(source, 'utf8');
  report.migrationCanonicalLfSha256 = createHash('sha256').update(migration.replaceAll('\r\n', '\n')).digest('hex');
  const before = await c.fingerprint();
  await c.sql(migration);
  const after = await c.fingerprint();
  for (const [table, digest] of Object.entries(before.tables)) assert.equal(after.tables[table], digest, 'NO_BACKFILL:' + table);
  assert.deepEqual(after.sequences, before.sequences);
  pass('214 to215 installs transactionally; every pre-existing table/sequence unchanged');
  stage = 'fixture'; await c.initialize();
  stage = 'inspected-warranty'; await verifyInspectedReplacement215(c, pass);
  stage = 'roles-races-rollback'; await verifyInspectedSecurity215(c, pass);
  stage = 'supplier-payable-credit'; await verifySupplierCredit215(c, pass);
  stage = 'ordinary-return-preview'; await verifyReturnPreview215(c, pass);
  assert.equal(createHash('sha256').update((await readFile(source, 'utf8')).replaceAll('\r\n', '\n')).digest('hex'), report.migrationCanonicalLfSha256, 'MIGRATION_CHANGED_DURING_VERIFICATION');
  report.ok = true;
} catch (error) {
  Object.assign(report, {stage, error: error.message}); process.exitCode = 1;
} finally {
  if (local) await exec(process.execPath, [cli, 'stop', '--no-backup', '--workdir', local], {cwd: root, windowsHide: true, maxBuffer: 1024 ** 2});
  report.endedAt = new Date().toISOString();
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
