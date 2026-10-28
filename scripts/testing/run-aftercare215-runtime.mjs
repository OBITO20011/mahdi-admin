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
import {verifySealedReturn215} from './aftercare215-return-v2-runtime.mjs';
import {verifyExchangePreview215} from './aftercare215-exchange-preview-runtime.mjs';
import {verifyExchange215} from './aftercare215-exchange-runtime.mjs';
import {verifyExchangeReaders215} from './aftercare215-exchange-readers-runtime.mjs';
import {verifyExchangeBoundaries215} from './aftercare215-exchange-boundary-runtime.mjs';
import {verifyDamageLedger215} from './aftercare215-damage-runtime.mjs';
import {verifyDamageBoundaries215} from './aftercare215-damage-boundary-runtime.mjs';
import {verifyExchangeReceipt215} from './aftercare215-receipt-runtime.mjs';
import {verifyExactCost215} from './aftercare215-exact-cost-runtime.mjs';
import {verifyRestore215,verifyIntegrity215} from './aftercare215-restore-runtime.mjs';
import {readVerificationSourceFreeze,assertVerificationSourceFreeze} from './verification-source-freeze.mjs';

assert.equal(process.argv.length, 2, 'LOCAL_ONLY_NO_ARGUMENTS');
const exec = promisify(execFile), root = path.resolve(import.meta.dirname, '../..');
const project = 'nawasrah-tb215-test', container = 'supabase_db_' + project;
const cli = path.join(root, 'node_modules/supabase/dist/supabase.js');
const output = await mkdtemp(path.join(tmpdir(), 'nawasrah-aftercare215-'));
const report = {scope: 'G1-G6 DB foundations/readers; UI/owner upgrade/full delivery still pending', hostedConnections: 0, output, cases: [], ok: false};
const source = path.join(root, 'supabase/migrations/215_inspected_aftercare_and_supplier_credit.sql');
let local, stage = 'bootstrap214';
const pass = name => { report.cases.push({name, passed: true}); console.log(JSON.stringify(report.cases.at(-1))); };
try {
  const frozen=await readVerificationSourceFreeze(root);
  report.sourceFreeze={sha256:frozen.sha256,fileCount:frozen.fileCount};
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
  stage = 'sealed-return-v2'; await verifySealedReturn215(c, pass);
  stage = 'exchange-boundaries'; await verifyExchangeBoundaries215(c, pass);
  stage = 'exchange-preview'; await verifyExchangePreview215(c, pass);
  stage = 'noncash-exchange'; await verifyExchange215(c, pass);
  stage = 'receipt-funding'; await verifyExchangeReceipt215(c, pass);
  stage = 'exchange-readers'; await verifyExchangeReaders215(c, pass);
  stage = 'exact-cost-boundaries'; await verifyExactCost215(c, pass);
  stage = 'damage-ledger'; await verifyDamageLedger215(c, pass);
  stage = 'integrity'; report.integrity=await verifyIntegrity215(c,pass,output);
  stage = 'restore'; report.restore=await verifyRestore215(c,output,pass);
  // Large exact-money fixture must be last; ordinary old numeric DTO probes
  // are not used as an oracle beyond JavaScript's safe-integer boundary.
  stage = 'damage-boundaries'; await verifyDamageBoundaries215(c, pass);
  assert.equal(createHash('sha256').update((await readFile(source, 'utf8')).replaceAll('\r\n', '\n')).digest('hex'), report.migrationCanonicalLfSha256, 'MIGRATION_CHANGED_DURING_VERIFICATION');
  assertVerificationSourceFreeze(frozen,await readVerificationSourceFreeze(root));
  report.repositoryStayedFrozen=true;
  report.ok = true;
} catch (error) {
  Object.assign(report, {stage, error: error.message}); process.exitCode = 1;
} finally {
  if (local) await exec(process.execPath, [cli, 'stop', '--no-backup', '--workdir', local], {cwd: root, windowsHide: true, maxBuffer: 1024 ** 2});
  report.endedAt = new Date().toISOString();
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
