import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {collectDailySupabase} from '../monitoring/supabase-daily-health.mjs';
import {runIncidentCycle} from '../monitoring/developer-alert-core.mjs';

const exec = promisify(execFile), root = path.resolve(import.meta.dirname, '../..');
const cli = path.join(root, 'node_modules/supabase/dist/supabase.js');
const projectId = 'nawasrah-daily-health-test', container = 'supabase_db_' + projectId;
let workdir, stage = 'isolated-bootstrap';
const sql = async query => (await exec('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres',
  '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', query], {windowsHide: true})).stdout.trim();
try {
  const {stdout} = await exec(process.execPath, [path.join(root, 'scripts/testing/bootstrap-isolated-supabase.mjs')], {
    cwd: root, windowsHide: true, timeout: 600_000, maxBuffer: 8 * 1024 * 1024, env: {...process.env,
      NAWASRAH_ISOLATED_PROJECT_ID: projectId, NAWASRAH_MAX_MIGRATION: '138', NAWASRAH_SKIP_REDUNDANT_DB_RESET: 'true',
      NAWASRAH_SUPABASE_EXCLUDE: 'realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
  const boot = JSON.parse(stdout); assert.equal(boot.ok, true); workdir = boot.isolatedProjectRoot;
  stage = 'local-status';
  // CLI credentials are captured only in memory, never in logs/artifacts.
  const {stdout: statusText} = await exec(process.execPath, [cli, 'status', '-o', 'json', '--workdir', workdir], {windowsHide: true});
  const status = JSON.parse(statusText), url = status.API_URL || status.api_url, publishableKey = status.ANON_KEY || status.anon_key;
  assert.ok(new URL(url).hostname === '127.0.0.1' || new URL(url).hostname === 'localhost'); assert.ok(publishableKey);
  const snapshot = () => sql(`BEGIN READ ONLY; SELECT md5(to_jsonb(s)::text) FROM public.storefront_settings s; ROLLBACK;`);
  const before = await snapshot();
  stage = 'daily-real-reads';
  let reads = 0, calls = 0;
  const config = {enabled: true, now: new Date('2026-10-12T12:00:00Z'), url, publishableKey,
    fetchImpl: async (...args) => { calls++; return fetch(...args); },
    readDatabaseSize: async query => { reads++; return sql(query); }};
  const result = await collectDailySupabase(config);
  assert.ok(result.checks.every(c => c.healthy)); assert.equal(calls, 1); assert.equal(reads, 1);
  assert.equal(result.state.size.databaseBytes, Number(await sql('BEGIN READ ONLY; SELECT pg_database_size(current_database()); ROLLBACK;')));
  assert.equal(await snapshot(), before); // Existing public stable RPC does not mutate settings.
  const cached = await collectDailySupabase({...config, now: new Date('2026-10-12T12:05:00Z'), previous: result.state});
  assert.equal(cached.sampled, false); assert.equal(calls, 1); assert.equal(reads, 1);
  const broken = await collectDailySupabase({...config, fetchImpl: async () => new Response('unavailable', {status: 503})});
  stage = 'fake-alert-dedup-recovery';
  const sent = [], send = async ({kind}) => { sent.push(kind); return true; };
  const incident = await runIncidentCycle({checks: broken.checks, send, now: config.now});
  const duplicate = await runIncidentCycle({checks: broken.checks, state: incident.state, send, now: config.now});
  await runIncidentCycle({checks: result.checks, state: duplicate.state, send, now: config.now});
  assert.deepEqual(sent, ['incident', 'recovery']);
  console.log(JSON.stringify({ok: true, migrations: '001-138', actualRestReads: calls, actualDatabaseReads: reads,
    databaseBytes: result.state.size.databaseBytes, cacheReused: true, settingsUnchanged: true, fakeAlerts: sent, productionAccess: false}));
} catch (error) {
  // Never emit CLI stdout/stderr/status (may contain local credentials).
  console.error(JSON.stringify({error: 'ISOLATED_DAILY_HEALTH_RUNTIME_FAILED', stage, kind: error.name})); process.exitCode = 1;
} finally {
  if (workdir) await exec(process.execPath, [cli, 'stop', '--no-backup', '--workdir', workdir], {windowsHide: true, timeout: 120_000});
}
