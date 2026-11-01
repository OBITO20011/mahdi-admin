import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import relay, {handleWebhook, RelayInbox, type RelayEnv, MAX_BODY_BYTES, MAX_AGE_MS, safeAlert, telegramMessage} from '../workers/sentry-telegram-relay/src/index';

const secret = () => 'synthetic-local-' + 'a'.repeat(32);
const token = () => '123456:' + 'synthetic'.repeat(5);
const now = () => Date.now();
const fixture = () => ({action: 'triggered', data: {event: {event_id: 'a'.repeat(32), issue_id: '901', project: 11, received: now() / 1000,
  environment: 'prelaunch-trial', release: 'b'.repeat(40), tags: [['screen', 'pos'], ['error_code', 'REACT_RENDER_ERROR']]}}});
type Fixture = ReturnType<typeof fixture>;
class LocalState {
  db: DatabaseSync; queue: Promise<unknown> = Promise.resolve(); alarms: number[] = [];
  constructor(db = new DatabaseSync(':memory:')) {this.db = db;}
  storage = {sql: {exec: <T extends Record<string, unknown>>(query: string, ...args: (string | number)[]) => {
    const statement = this.db.prepare(query), rows = (statement.columns().length ? statement.all(...args) : (statement.run(...args), [])) as T[];
    return {toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]()};
  }}, setAlarm: async (time: number) => {this.alarms.push(time);}};
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {const next = this.queue.then(fn); this.queue = next.catch(() => undefined); return next;}
}
function setup() {
  const state = new LocalState();
  const env: RelayEnv = {SENTRY_CLIENT_SECRET: secret(), DEV_TELEGRAM_BOT_TOKEN: token(), DEV_TELEGRAM_CHAT_ID: '-12345', RELAY_ENABLED: 'true',
    SENTRY_ADMIN_PROJECT_ID: '11', SENTRY_STORE_PROJECT_ID: '12', SENTRY_ORG_SLUG: 'synthetic-test',
    RELAY_INBOX: {idFromName: name => name, get: () => ({fetch: req => inbox.fetch(req)})}};
  const inbox = new RelayInbox(state, env); return {state, env, inbox};
}
async function request(body: unknown = fixture(), headers: Record<string, string> = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret()), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
  const signature = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
  return new Request('https://local.invalid/sentry', {method: 'POST', body: text, headers: {'content-type': 'application/json', 'sentry-hook-resource': 'event_alert', 'sentry-hook-timestamp': String(Math.floor(now() / 1000)), 'sentry-hook-signature': signature, ...headers}});
}
test('valid raw-body signature queues durable sanitized message;duplicate and cold start never resend', async () => {
  const {state, env, inbox} = setup(), event = fixture();
  assert.equal((await handleWebhook(await request(event), env)).status, 202); assert.equal(state.alarms.length, 1);
  assert.equal((await handleWebhook(await request(event), env)).status, 200);
  const cold = new RelayInbox(new LocalState(state.db), env); let sent = 0;
  const fetchBefore = globalThis.fetch; globalThis.fetch = async (url, init) => {
    sent++; assert.equal(String(url), 'https://api.telegram.org/bot' + token() + '/sendMessage'); assert.equal(init?.redirect, 'manual');
    const message = JSON.parse(String(init?.body)); assert.equal(message.chat_id, '-12345'); assert.equal(message.disable_web_page_preview, true);
    assert.match(message.text, /عطل الواجهة · إدارة/u); assert.match(message.text, /الإصدار: bbbbbbbb/u);
    return Response.json({ok: true, result: {message_id: 5, chat: {id: -12345}}});
  };
  try {await Promise.all([cold.alarm(), inbox.alarm()]); await cold.alarm();} finally {globalThis.fetch = fetchBefore;}
  assert.equal(sent, 1); const row = state.db.prepare('SELECT * FROM relay').get(); assert.equal(row?.status, 'sent'); assert.equal(row?.payload, '');
});
test('signature missing/invalid/malformed or body changed is refused before persistence', async () => {
  const {env, state} = setup();
  for (const signature of ['', 'x'.repeat(64), '0'.repeat(64), 'abcd']) assert.equal((await handleWebhook(await request(fixture(), {'sentry-hook-signature': signature}), env)).status, 401);
  const original = await request(fixture()); const modified = new Request(original.url, {method: 'POST', headers: original.headers, body: '{}'});
  assert.equal((await handleWebhook(modified, env)).status, 401); assert.equal(state.db.prepare('SELECT count(*) n FROM relay').get()?.n, 0);
});
test('signed event time closes unsigned header replay hole;expired/future/missing body time fails', async () => {
  const {env} = setup();
  for (const age of [MAX_AGE_MS + 5000, -120000]) {const body = fixture(); body.data.event.received = (now() - age) / 1000; assert.equal((await handleWebhook(await request(body), env)).status, 401);}
  const missing = fixture() as unknown as {data: {event: Record<string, unknown>}}; delete missing.data.event.received;
  assert.equal((await handleWebhook(await request(missing), env)).status, 401);
  for (const time of ['', 'not-a-date', String(Math.floor((now() - MAX_AGE_MS - 5000) / 1000)), String(Math.floor((now() + 120000) / 1000))]) assert.equal((await handleWebhook(await request(fixture(), {'sentry-hook-timestamp': time}), env)).status, 401);
});
test('ten parallel deliveries and different request IDs share one persistent event claim', async () => {
  const {env, state} = setup(), body = fixture(); const responses = await Promise.all(Array.from({length: 10}, async (_, i) => handleWebhook(await request(body, {'request-id': String(i)}), env)));
  assert.equal(responses.filter(r => r.status === 202).length, 1); assert.equal(state.db.prepare('SELECT count(*) n FROM relay').get()?.n, 1);
});
test('sensitive arbitrary payload values do not enter message or persistent row', async () => {
  const {env, state} = setup(), data = fixture() as Fixture & Record<string, unknown>;
  const pii = 'اسم خاص < > & 0799999999 12345.678 token=secret cart=private';
  Object.assign(data.data.event, {message: pii, title: pii, exception: {values: [{value: pii}]}, request: {url: 'https://shop.invalid/private?token=secret', data: pii}, user: {name: pii}, metadata: {value: pii}});
  Object.assign(data, {actor: {name: pii}, installation: {secret: pii}});
  assert.equal((await handleWebhook(await request(data), env)).status, 202);
  const stored = String(state.db.prepare('SELECT payload FROM relay').get()?.payload);const alert = JSON.parse(stored);
  const message = telegramMessage(alert, env.SENTRY_ORG_SLUG);
  for (const marker of ['اسم خاص', '0799999999', '12345.678', 'secret', 'cart=', 'shop.invalid', '<', '>', '&']) assert.ok(!message.includes(marker) && !stored.includes(marker), marker);
  assert.ok(message.length < 4096); assert.match(message, /عدد الأحداث: غير متاح/u);
});
test('only exact allowlists survive even when incoming tags contain PII;big count stays decimal text', () => {
  const {env} = setup(), body = fixture();body.data.event.project = 12;
  Object.assign(body.data.event, {environment: 'production private', release: 'customer-token', tags: {screen: '/product/private-id?phone=079', error_code: 'TypeError private'}});
  Object.assign(body.data, {issue: {count: '99999999999999999999'}});
  const safe = safeAlert(body, env)!;assert.equal(safe.project, 'متجر');assert.equal(safe.screen, 'unknown');assert.equal(safe.environment, 'unknown');assert.equal(safe.release, 'unknown');assert.equal(safe.errorCode, 'FRONTEND_ERROR');assert.equal(safe.count, '99999999999999999999');
  assert.ok(!telegramMessage(safe, env.SENTRY_ORG_SLUG).includes('private'));
});
test('POST only, right path, bounded body including chunked streams and malformed JSON', async () => {
  const {env} = setup(); assert.equal((await handleWebhook(new Request('https://local.invalid/sentry'), env)).status, 405);
  const req = await request();assert.equal((await handleWebhook(new Request('https://local.invalid/elsewhere', req), env)).status, 404);
  assert.equal((await handleWebhook(await request('x'.repeat(MAX_BODY_BYTES + 1)), env)).status, 413);
  assert.equal((await handleWebhook(await request({}, {'content-length': String(MAX_BODY_BYTES + 1)}), env)).status, 413);
  assert.equal((await handleWebhook(await request('not-json'), env)).status, 400);
  assert.equal((await handleWebhook(await request({}, {'content-type': 'text/plain'}), env)).status, 415);
});
test('unconfigured/disabled, unknown resource/action/project/identity never sends or queues', async () => {
  const {env, state} = setup();assert.equal((await handleWebhook(await request(), {...env, RELAY_ENABLED: 'false'})).status, 503);
  assert.equal((await handleWebhook(await request(), {...env, SENTRY_ORG_SLUG: '../malicious'})).status, 503);
  assert.equal((await handleWebhook(await request(fixture(), {'sentry-hook-resource': 'issue'}), env)).status, 422);
  for (const mutation of [{project: 999}, {issue_id: '1/?token=secret'}, {event_id: 'PII'}]) {const body = fixture();Object.assign(body.data.event, mutation);assert.equal((await handleWebhook(await request(body), env)).status, 422);}
  const body = fixture(); body.action = 'resolved';assert.equal((await handleWebhook(await request(body), env)).status, 422);
  assert.equal(state.db.prepare('SELECT count(*) n FROM relay').get()?.n, 0);
});
test('Telegram rejection/timeout/wrong chat/result never logs raw details or loops;duplicate remains ignored', async () => {
  for (const mode of ['reject', 'throw', 'wrong-chat', 'missing-message', 'redirect']) {
    const {env, inbox, state} = setup(), body = fixture();assert.equal((await handleWebhook(await request(body), env)).status, 202);
    let calls = 0;const logs: unknown[] = [], originalFetch = globalThis.fetch, originalWarn = console.warn;
    globalThis.fetch = async () => {calls++;if (mode === 'throw') throw new Error(token() + ' private');if (mode === 'redirect') return new Response(null, {status: 302, headers: {Location: 'https://must-not-follow.invalid'}});return Response.json(mode === 'reject' ? {ok: false, description: token()} : {ok: true, result: {message_id: mode === 'missing-message' ? undefined : 1, chat: {id: 999}}});};
    console.warn = value => logs.push(value);
    try {await inbox.alarm();await inbox.alarm();} finally {globalThis.fetch = originalFetch; console.warn = originalWarn;}
    assert.equal(calls, 1);assert.equal(state.db.prepare('SELECT status FROM relay').get()?.status, 'failed');assert.equal((await handleWebhook(await request(body), env)).status, 200);
    assert.ok(!JSON.stringify(logs).includes(token()));assert.ok(logs.every(l => /RELAY_TELEGRAM_(FAILED|REJECTED)/u.test(String(l))));
  }
});
test('expired signed body cannot be refreshed by changing only the header;pending alarm has bounded batch size', async () => {
  const {env, state, inbox} = setup();
  for (let i = 0; i < 7; i++) {const body = fixture();body.data.event.event_id = i.toString(16).padStart(32, '0');assert.equal((await handleWebhook(await request(body), env)).status, 202);}
  const originalFetch = globalThis.fetch;let sent = 0;
  globalThis.fetch = async () => {sent++;return Response.json({ok: true, result: {message_id: sent, chat: {id: -12345}}});};
  try {await inbox.alarm();assert.equal(sent, 5);await inbox.alarm();assert.equal(sent, 7);await inbox.alarm();assert.equal(sent, 7);} finally {globalThis.fetch = originalFetch;}
  assert.equal(state.db.prepare("SELECT count(*) n FROM relay WHERE status = 'sent'").get()?.n, 7);
  const old = fixture();old.data.event.received = (now() - MAX_AGE_MS - 1000) / 1000;
  const signed = await request(old);signed.headers.set('sentry-hook-timestamp', String(Math.floor(now() / 1000)));
  assert.equal((await handleWebhook(signed, env)).status, 401);
});
test('alarm disabled after enqueue cannot send;failed alarm setup refuses acknowledgement', async () => {
  const {env, inbox, state} = setup();await handleWebhook(await request(), env);env.RELAY_ENABLED = 'false';const f = globalThis.fetch;globalThis.fetch = async () => {throw new Error('must-not-send');};
  try {await inbox.alarm();} finally {globalThis.fetch = f;}
  assert.equal(state.db.prepare('SELECT status FROM relay').get()?.status, 'disabled');
  const next = setup();next.state.storage.setAlarm = async () => {throw new Error('private');};assert.equal((await handleWebhook(await request(), next.env)).status, 503);assert.equal(next.state.db.prepare('SELECT count(*) n FROM relay').get()?.n, 0);
});
test('Worker internal failure response and logs are fixed;no raw exceptions', async () => {
  const {env} = setup();env.RELAY_INBOX.get = () => {throw new Error(secret() + ' private');}; const warn = console.warn, logs: unknown[] = [];console.warn = v => logs.push(v);
  try {const result = await relay.fetch(await request(), env);assert.equal(result.status, 503);assert.deepEqual(await result.json(), {code: 'RELAY_UNAVAILABLE'});} finally {console.warn = warn;}
  assert.deepEqual(logs, ['{"code":"RELAY_INTERNAL_FAILED"}']);
});
test('Worker off by default with SQLite replay storage and no secret value or application dependency', () => {
  const config = readFileSync('workers/sentry-telegram-relay/wrangler.toml', 'utf8');assert.match(config, /RELAY_ENABLED = "false"/u);assert.match(config, /new_sqlite_classes = \["RelayInbox"\]/u);assert.match(config, /\[observability\]\nenabled = false/u);
  const source = readFileSync('workers/sentry-telegram-relay/src/index.ts', 'utf8');assert.doesNotMatch(source, /from ['"].*(?:src\/|supabase|sentry\/)/u);assert.doesNotMatch(source, /console\.(?:error|log)\(/u);
  assert.match(readFileSync('docs/operations/SENTRY_TELEGRAM_AR.md', 'utf8'), /SENTRY_CLIENT_SECRET/u);
});
