import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Focused local harness regression, not another CI pipeline. Retain a test
// volume deliberately between runs to reproduce an interrupted runner.
const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bootstrap = path.join(root, 'scripts/testing/bootstrap-isolated-supabase.mjs');
const cli = path.join(root, 'node_modules/supabase/dist/supabase.js');
const project = 'nawasrah-harness-isolation-test';
const options = { cwd: root, windowsHide: true, timeout: 480_000, maxBuffer: 2 ** 20,
  env: { ...process.env, NAWASRAH_ISOLATED_PROJECT_ID: project,
    NAWASRAH_SKIP_REDUNDANT_DB_RESET: 'true',
    NAWASRAH_SUPABASE_EXCLUDE: 'realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor' } };
const sql = (query) => exec('docker', ['exec', `supabase_db_${project}`, 'psql',
  '-U', 'postgres', '-d', 'postgres', '-X', '-At', '-v', 'ON_ERROR_STOP=1',
  '-v', 'VERBOSITY=verbose', '-c', query], options);
const fixture = "INSERT INTO auth.users(id,email) VALUES ('ee350001-0000-4000-8000-000000000001','harness-isolation@example.invalid');";
const evidence = [];
let workdir;
try {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { stdout } = await exec(process.execPath, [bootstrap], options);
    const result = JSON.parse(stdout);
    workdir = result.isolatedProjectRoot;
    assert.equal(result.authBaselineEmpty, true);
    if (attempt > 0 || result.reusedDatabaseVolume) {
      assert.equal(result.reusedDatabaseVolume, true);
      assert.equal(result.resetSkipped, false);
    }
    assert.equal((await sql('SELECT COUNT(*) FROM auth.users;')).stdout.trim(), '0');
    await sql(fixture);
    // Sensitivity control: genuine duplicate remains a strict DB failure.
    await assert.rejects(sql(fixture), (error) =>
      /23505/u.test(error.stderr) && /constraint "users_pkey"/u.test(error.stderr));
    // A concurrent bootstrap must reject, not destroy or reset this stack.
    await assert.rejects(exec(process.execPath, [bootstrap], options), (error) =>
      /ISOLATED_TEST_STACK_ACTIVE/u.test(error.stderr));
    assert.equal((await sql('SELECT COUNT(*) FROM auth.users;')).stdout.trim(), '1');
    evidence.push({ attempt: attempt + 1, reusedVolume: result.reusedDatabaseVolume,
      resetSkipped: result.resetSkipped, cleanAuthBaseline: true,
      sameIdentityInsertSucceeded: true, realDuplicateRejected: true,
      activeStackProtected: true });
    if (attempt < 2) {
      await exec(process.execPath, [cli, 'stop', '--workdir', workdir], options);
      workdir = undefined;
    }
  }
  console.log(JSON.stringify({ok: true, evidence}, null, 2));
} finally {
  if (workdir) await exec(process.execPath, [cli, 'stop', '--no-backup', '--workdir', workdir], options);
}
