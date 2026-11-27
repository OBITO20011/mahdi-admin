import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, {type TestContext} from 'node:test';
import {runFastDownAlert} from '../scripts/monitoring/fast-down-alert.mjs';

const storefront = 'https://store.example.test/';
const admin = 'https://admin.example.test/';
const database = 'https://abcdefghijklmnopqrst.supabase.co/rest/v1/rpc/get_public_storefront_settings';
const technicalBot = ['987654321', 'synthetic-developer-fixture'].join(':');
const ownerBot = ['123456789', 'synthetic-owner-fixture'].join(':');
const publicKey = 'sb_publishable_' + 'synthetic-database-fixture';
const devChat = '87654321';
const ownerChat = '12345678';

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fast-down-alert-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const env: NodeJS.ProcessEnv = {
    DEV_FAST_DOWN_STOREFRONT_ORIGIN: storefront,
    DEV_FAST_DOWN_ADMIN_ORIGIN: admin,
    DEV_FAST_DOWN_SUPABASE_ORIGIN: new URL(database).origin,
    DEV_FAST_DOWN_ANON_KEY: publicKey,
    DEV_FAST_DOWN_STATE_FILE: path.join(directory, 'state.json'),
    DEV_TELEGRAM_BOT_TOKEN: technicalBot,
    DEV_TELEGRAM_CHAT_ID: devChat,
    OWNER_TELEGRAM_BOT_TOKEN: ownerBot,
    OWNER_TELEGRAM_CHAT_ID: ownerChat,
  };
  const bodies: Record<string, () => Response> = {
    [storefront]: () => new Response('<html></html>', {headers: {'content-type': 'text/html; charset=utf-8'}}),
    [admin]: () => new Response('<html></html>', {headers: {'content-type': 'text/html'}}),
    [database]: () => Response.json({storeNameAr: 'متجر الاختبار', ordersEnabled: false}),
  };
  const requests: {href: string; options: RequestInit; headers: Headers}[] = [];
  const messages: {chat_id: string; text: string}[] = [];
  let acceptDelivery = true;
  const fetchImpl: typeof fetch = async (input, options = {}) => {
    const href = String(input);
    requests.push({href, options, headers: new Headers(options.headers)});
    if (Object.hasOwn(bodies, href)) return bodies[href]();
    if (href === 'https://api.telegram.org/bot' + technicalBot + '/sendMessage') {
      assert.equal(options.redirect, 'error');
      assert.equal(typeof options.body, 'string');
      messages.push(JSON.parse(options.body as string));
      if (!acceptDelivery) throw new Error('Synthetic transport failure ' + technicalBot);
      return Response.json({ok: true});
    }
    assert.fail('Unexpected fake endpoint');
  };
  const stateFile = path.join(directory, 'state.json');
  return {
    env, stateFile, requests, messages, bodies, run: () => runFastDownAlert({env, fetchImpl}),
    read: () => readFile(stateFile, 'utf8'),
    denyDelivery: () => {acceptDelivery = false;},
    allowDelivery: () => {acceptDelivery = true;},
  };
}
const unavailable = () => new Response('synthetic unavailable', {status: 503});

test('each service independently requires three failures; persistent failures and recovery are delivered once', async t => {
  for (const [url, name] of [[storefront,'المتجر'],[admin,'لوحة الإدارة'],[database,'قاعدة البيانات']]) {
    await t.test(name, async t => {
      const f = await fixture(t);
      const working = f.bodies[url];
      f.bodies[url] = unavailable;
      await f.run();
      await f.run();
      assert.equal(f.messages.length, 0);
      await f.run();
      await f.run();
      assert.deepEqual(f.messages.map(m => m.text), [`تعطل ${name} بعد ثلاثة فحوص متتالية.`]);
      f.bodies[url] = working;
      await f.run();
      await f.run();
      assert.deepEqual(f.messages.map(m => m.text),
        [`تعطل ${name} بعد ثلاثة فحوص متتالية.`, `عاد ${name} إلى العمل.`]);
      assert.ok(f.messages.every(m => m.chat_id === devChat));
      assert.ok(f.requests.every(x => !x.href.includes(ownerBot)));
    });
  }
});

test('a passing check clears its consecutive failure count without clearing another service’s count', async t => {
  const f = await fixture(t);
  const up = f.bodies[storefront];
  f.bodies[storefront] = unavailable;
  f.bodies[admin] = unavailable;
  await f.run();
  await f.run();
  f.bodies[storefront] = up;
  await f.run();
  f.bodies[storefront] = unavailable;
  await f.run();
  await f.run();
  assert.deepEqual(f.messages.map(x => x.text), ['تعطل لوحة الإدارة بعد ثلاثة فحوص متتالية.']);
  await f.run();
  assert.equal(f.messages.at(-1)?.text, 'تعطل المتجر بعد ثلاثة فحوص متتالية.');
});

test('the database probe calls the existing RPC via uncached GET and validates the expected JSON', async t => {
  const f = await fixture(t);
  assert.equal((await f.run()).checks.find(x => x.id === 'database')?.healthy, true);
  const db = f.requests.find(x => x.href === database);
  assert.ok(db);
  assert.equal(db.options.method, 'GET');
  assert.equal(db.options.cache, 'no-store');
  assert.equal(db.headers.get('cache-control'), 'no-cache');
  assert.equal(db.options.redirect, 'error');
  assert.equal(db.options.credentials, 'omit');
  assert.equal(db.headers.get('apikey'), publicKey);
  assert.equal(db.headers.get('authorization'), null);
  assert.ok(f.requests.filter(x => x.href !== database).every(x => !x.headers.has('apikey')));
  f.bodies[database] = () => Response.json({ordersEnabled: 'false', storeNameAr: 'متجر الاختبار'});
  assert.equal((await f.run()).checks.find(x => x.id === 'database')?.healthy, false);
  f.bodies[database] = () => new Response('<html>proxy page</html>');
  assert.equal((await f.run()).checks.find(x => x.id === 'database')?.healthy, false);
});

test('legacy anon credentials work and privileged Supabase keys are rejected before probing', async t => {
  const f = await fixture(t);
  const jwt = (role: string) => ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({role})).toString('base64url'), 'test'].join('.');
  for (const key of [jwt('service_role'),'sb_secret_' + 'synthetic-fixture']) {
    f.env.DEV_FAST_DOWN_ANON_KEY = key;
    await assert.rejects(f.run, {message:'FAST_DOWN_ALERT_PUBLIC_KEY_REQUIRED'});
  }
  assert.equal(f.requests.length, 0);
  f.env.DEV_FAST_DOWN_ANON_KEY = jwt('anon');
  await f.run();
  assert.equal(f.requests.find(x => x.href === database)?.headers.get('authorization'), 'Bearer ' + jwt('anon'));
});

test('owner-only credentials and a shared developer/owner recipient or bot fail closed', async t => {
  const f = await fixture(t);
  delete f.env.DEV_TELEGRAM_BOT_TOKEN;
  await assert.rejects(f.run, {message:'FAST_DOWN_ALERT_CONFIG_INVALID'});
  f.env.DEV_TELEGRAM_BOT_TOKEN = ownerBot;
  await assert.rejects(f.run, {message:'FAST_DOWN_ALERT_CONFIG_INVALID'});
  f.env.DEV_TELEGRAM_BOT_TOKEN = technicalBot;
  f.env.DEV_TELEGRAM_CHAT_ID = ownerChat;
  await assert.rejects(f.run, {message:'FAST_DOWN_ALERT_CONFIG_INVALID'});
  assert.equal(f.requests.length, 0);
});

test('failed Telegram sends are retried on the next needed check and no secret enters state or status', async t => {
  const f = await fixture(t);
  const working = f.bodies[database];
  f.bodies[database] = unavailable;
  await f.run();
  await f.run();
  f.denyDelivery();
  const failed = await f.run();
  assert.equal(failed.ok, false);
  const trace = JSON.stringify(failed) + await f.read();
  for (const value of [technicalBot, publicKey, devChat, ownerChat, ownerBot, 'Synthetic transport failure']) {
    assert.equal(trace.includes(value), false);
  }
  f.allowDelivery();
  await f.run();
  f.bodies[database] = working;
  f.denyDelivery();
  assert.equal((await f.run()).ok,false);
  f.allowDelivery();
  assert.equal((await f.run()).ok,true);
  await f.run();
  assert.equal(f.messages.length, 4);
});

test('unapproved database origins and damaged state fail before probes', async t => {
  const f = await fixture(t);
  const url = f.env.DEV_FAST_DOWN_SUPABASE_ORIGIN;
  f.env.DEV_FAST_DOWN_SUPABASE_ORIGIN = 'https://example.test/';
  await assert.rejects(f.run, {message:'FAST_DOWN_ALERT_CONFIG_INVALID'});
  f.env.DEV_FAST_DOWN_SUPABASE_ORIGIN = url;
  await writeFile(f.stateFile, '{bad');
  await assert.rejects(f.run, {message:'FAST_DOWN_ALERT_STATE_UNREADABLE'});
  assert.equal(f.requests.length,0);
});

test('CLI diagnostics suppress configuration values', async t => {
  const f = await fixture(t);
  const hidden = 'synthetic-user-password';
  const child = spawnSync(process.execPath, ['scripts/monitoring/fast-down-alert.mjs'], {
    env: {...f.env, DEV_FAST_DOWN_STOREFRONT_ORIGIN: `https://operator:${hidden}@store.example.test`},
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
  assert.equal(child.stderr.trim(), 'FAST_DOWN_ALERT_RUN_FAILED');
  assert.ok(!child.stderr.includes(hidden));
});
