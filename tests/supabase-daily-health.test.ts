import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {collectDailySupabase, DATABASE_SIZE_SQL, DATABASE_WARNING_BYTES, readKeepalive, sizeResult} from '../scripts/monitoring/supabase-daily-health.mjs';
import {runIncidentCycle} from '../scripts/monitoring/developer-alert-core.mjs';

const now = new Date('2026-10-12T12:00:00Z');
const config = {enabled: true, now, url: 'https://isolated.example.invalid', publishableKey: 'test-public-key',
  fetchImpl: async () => new Response(JSON.stringify({ordersEnabled: true, storeNameAr: 'test'})),
  readDatabaseSize: async (sql: string) => { assert.equal(sql, DATABASE_SIZE_SQL); return '123456'; }};

test('daily opt-in disabled never reads REST or database', async () => {
  const fail = async () => { throw new Error('must not run'); };
  assert.deepEqual(await collectDailySupabase({...config, enabled: false, fetchImpl: fail, readDatabaseSize: fail}),
    {checks: [], state: null, sampled: false});
});
test('real read contract uses existing stable RPC and stores only technical status', async () => {
  const result = await collectDailySupabase({...config, fetchImpl: async (url, init) => {
    assert.ok(url instanceof URL);assert.ok(init);
    assert.equal(url.pathname, '/rest/v1/rpc/get_public_storefront_settings');
    assert.equal(init.method, 'POST'); assert.equal(init.body, '{}'); assert.equal(init.redirect, 'error');
    assert.deepEqual(init.headers, {'content-type': 'application/json', apikey: config.publishableKey});
    return new Response(JSON.stringify({ordersEnabled: false, storeNameAr: 'private fixture', whatsappNumber: 'sensitive'}));
  }});
  assert.equal(result.sampled, true); assert.ok(result.checks.every(c => c.healthy));
  assert.doesNotMatch(JSON.stringify(result), /sensitive|private fixture|test-public-key|example/u);
});
test('daily cadence reuses technical result until exactly24h, rejects future/malformed cache', async () => {
  const first = await collectDailySupabase(config);
  assert.ok(first.state);
  const fail = async () => { throw new Error('must not read'); };
  const reused = await collectDailySupabase({...config, previous: first.state, now: new Date(now.getTime() + 86_399_999),
    fetchImpl: fail, readDatabaseSize: fail});
  assert.equal(reused.sampled, false); assert.deepEqual(reused.state, first.state);
  assert.equal((await collectDailySupabase({...config, previous: first.state, now: new Date(now.getTime() + 86_400_000)})).sampled, true);
  assert.equal((await collectDailySupabase({...config, previous: first.state, now: new Date(now.getTime() - 1)})).sampled, true);
  assert.equal((await collectDailySupabase({...config, previous: {...first.state, size: {healthy: true, status: 'ok', databaseBytes: -1}}})).sampled, true);
});
test('unavailable/paused/malformed/network failure is unhealthy without exposing response or exception', async () => {
  for (const code of [401, 403, 503]) {
    const value = await readKeepalive({...config, fetchImpl: async () => new Response('sensitive', {status: code})});
    assert.deepEqual(value, {status: 'http_failure', healthy: false, httpStatus: code});
  }
  assert.equal((await readKeepalive({...config, fetchImpl: async () => new Response('{}')})).status, 'invalid_response');
  assert.equal((await readKeepalive({...config, fetchImpl: async () => { throw Error('secret'); }})).status, 'unreachable');
  assert.equal((await readKeepalive({...config, url: 'http://remote.invalid'})).status, 'unconfigured');
  assert.equal((await readKeepalive({...config, publishableKey: ''})).status, 'unconfigured');
});
test('actual database size uses conservative400 decimalMB threshold and fails closed', () => {
  assert.equal(sizeResult(DATABASE_WARNING_BYTES - 1).healthy, true);
  assert.equal(sizeResult(DATABASE_WARNING_BYTES).healthy, false);
  assert.equal(sizeResult(500_000_000).healthy, false);
  for (const value of [null, '', -1, 'NaN', Infinity, true, 1.5]) assert.equal(sizeResult(value).status, 'read_failure');
});
test('database failure is independent of successful REST and routes through existing alert dedup/recovery', async () => {
  const failed = await collectDailySupabase({...config, readDatabaseSize: async () => { throw Error('password'); }});
  assert.equal(failed.checks[0].healthy, true); assert.equal(failed.checks[1].healthy, false);
  const sent: string[] = [], send = async ({kind}: {kind: string}) => { sent.push(kind); return true; };
  const first = await runIncidentCycle({checks: failed.checks, send, now});
  const second = await runIncidentCycle({checks: failed.checks, state: first.state, send, now});
  const healthy = await collectDailySupabase(config);
  await runIncidentCycle({checks: healthy.checks, state: second.state, send, now});
  assert.deepEqual(sent, ['incident', 'recovery']);
});
test('watchdog persists daily cadence and activation is opt-in; no SQL/permission/migration changes', async () => {
  const runner = await readFile('scripts/monitoring/run-developer-watchdog.mjs', 'utf8');
  assert.match(runner, /NAWASRAH_SUPABASE_DAILY_CHECKS === 'true'/u);
  assert.match(runner, /result\.state\.supabaseDaily = daily\.state/u);
  assert.match(DATABASE_SIZE_SQL, /^BEGIN READ ONLY; SELECT pg_database_size\(current_database\(\)\); ROLLBACK;$/u);
  const ps = await readFile('scripts/monitoring/run-developer-watchdog.ps1', 'utf8');
  assert.match(ps, /supabaseDailyChecksEnabled -eq \$true/u);
});
