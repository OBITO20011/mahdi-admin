// Standalone Worker. No application client, Sentry API token, or business payload storage.
export interface RelayEnv {
  SENTRY_CLIENT_SECRET: string;
  DEV_TELEGRAM_BOT_TOKEN: string;
  DEV_TELEGRAM_CHAT_ID: string;
  RELAY_ENABLED: string;
  SENTRY_ADMIN_PROJECT_ID: string;
  SENTRY_STORE_PROJECT_ID: string;
  SENTRY_ORG_SLUG: string;
  RELAY_INBOX: {idFromName(name: string): unknown; get(id: unknown): {fetch(request: Request): Promise<Response>}};
}
export const MAX_BODY_BYTES = 128 * 1024;
export const MAX_AGE_MS = 15 * 60_000;
const MAX_FUTURE_MS = 60_000;
const RETENTION_MS = 24 * 60 * 60_000;
const codes = ['FRONTEND_ERROR', 'REACT_RENDER_ERROR', 'CHUNK_LOAD_ERROR', 'PWA_UPDATE_ERROR'];
const adminScreens = ['home', 'orders', 'sales_history', 'products', 'accounts', 'more', 'dashboard', 'pos', 'inventory', 'expenses', 'shifts', 'reports', 'users', 'purchases', 'assistant', 'go_live', 'cheques', 'warehouses'];
const storeScreens = ['/', '/products/', '/offers/', '/about/', '/product/:product/', '/category/:category/'];
const environments = ['production', 'prelaunch-trial', 'staging'];
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const decimalId = (value: unknown): string | null => typeof value === 'string' && /^[1-9][0-9]{0,24}$/u.test(value) ? value : typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
const allowed = (value: unknown, values: string[], fallback = 'unknown') => typeof value === 'string' && values.includes(value) ? value : fallback;
const response = (status: number, code: string) => new Response(JSON.stringify({code}), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
const fixedLog = (code: string) => console.warn(JSON.stringify({code}));
function configured(env: RelayEnv): boolean {
  return typeof env.SENTRY_CLIENT_SECRET === 'string' && env.SENTRY_CLIENT_SECRET.length >= 16 && env.SENTRY_CLIENT_SECRET.length <= 512
    && typeof env.DEV_TELEGRAM_BOT_TOKEN === 'string' && /^[0-9]{5,20}:[A-Za-z0-9_-]{20,128}$/u.test(env.DEV_TELEGRAM_BOT_TOKEN)
    && typeof env.DEV_TELEGRAM_CHAT_ID === 'string' && /^-?[1-9][0-9]{0,19}$/u.test(env.DEV_TELEGRAM_CHAT_ID)
    && decimalId(env.SENTRY_ADMIN_PROJECT_ID) !== null && decimalId(env.SENTRY_STORE_PROJECT_ID) !== null
    && env.SENTRY_ADMIN_PROJECT_ID !== env.SENTRY_STORE_PROJECT_ID
    && typeof env.SENTRY_ORG_SLUG === 'string' && /^[a-z0-9][a-z0-9-]{0,62}$/u.test(env.SENTRY_ORG_SLUG);
}
export async function readBoundedBody(request: Request): Promise<Uint8Array | null> {
  const length = request.headers.get('content-length');
  if (length !== null && (!/^[0-9]+$/u.test(length) || Number(length) > MAX_BODY_BYTES)) return null;
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BODY_BYTES) {await reader.cancel(); return null;}
      chunks.push(part.value);
    }
  } finally {reader.releaseLock();}
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of chunks) {bytes.set(part, offset); offset += part.length;}
  return bytes;
}
export async function validSignature(bytes: Uint8Array, signature: string | null, secret: string): Promise<boolean> {
  if (!signature || !/^[a-f0-9]{64}$/iu.test(signature)) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['verify']);
  const signed = Uint8Array.from(signature.match(/../gu)!, pair => parseInt(pair, 16));
  return crypto.subtle.verify('HMAC', key, signed, bytes as Uint8Array<ArrayBuffer>);
}
function fresh(value: number, now: number): boolean {return Number.isFinite(value) && value <= now + MAX_FUTURE_MS && value >= now - MAX_AGE_MS;}
function signedEventTime(event: Record<string, unknown>): number {
  // Sentry's header timestamp is NOT covered by the raw-body signature.
  // Require its server-received time inside the signed payload as well.
  if (typeof event.received === 'number' && Number.isFinite(event.received)) return event.received * 1000;
  return NaN;
}
function tagsOf(event: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(event.tags)) return object(event.tags);
  return Object.fromEntries(event.tags.filter((pair): pair is [string, unknown] => Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string'));
}
export interface SafeAlert {
  project: 'إدارة' | 'متجر'; environment: string; release: string; screen: string;
  errorCode: string; count: string; issueId: string; eventId: string; projectId: string;
}
export function safeAlert(payload: unknown, env: RelayEnv): SafeAlert | null {
  const body = object(payload), data = object(body.data), event = object(data.event);
  if (body.action !== 'triggered') return null;
  const projectId = decimalId(event.project), issueId = decimalId(event.issue_id);
  const project = projectId === env.SENTRY_ADMIN_PROJECT_ID ? 'إدارة' : projectId === env.SENTRY_STORE_PROJECT_ID ? 'متجر' : null;
  const eventId = typeof event.event_id === 'string' && /^[a-f0-9]{32}$/iu.test(event.event_id) ? event.event_id.toLowerCase() : null;
  if (!project || !projectId || !issueId || !eventId) return null;
  const tags = tagsOf(event), issue = object(data.issue);
  const count = typeof issue.count === 'string' && /^[0-9]{1,20}$/u.test(issue.count) ? BigInt(issue.count).toString() : Number.isSafeInteger(issue.count) && Number(issue.count) >= 0 ? String(issue.count) : 'غير متاح';
  return {project, projectId, issueId, eventId, environment: allowed(event.environment ?? tags.environment, environments),
    release: typeof event.release === 'string' && /^[a-f0-9]{40}$/iu.test(event.release) ? event.release.slice(0, 8).toLowerCase() : 'unknown',
    screen: allowed(tags.screen, project === 'إدارة' ? adminScreens : storeScreens), errorCode: allowed(tags.error_code, codes, 'FRONTEND_ERROR'), count};
}
export function telegramMessage(alert: SafeAlert, orgSlug: string): string {
  // No payload URLs/title/user/exception/request/metadata are ever copied.
  return `⚠️ عطل الواجهة · ${alert.project}\nالبيئة: ${alert.environment}\nالإصدار: ${alert.release}\nالشاشة: ${alert.screen}\nالرمز: ${alert.errorCode}\nعدد الأحداث: ${alert.count}\nhttps://sentry.io/organizations/${orgSlug}/issues/${alert.issueId}/`;
}
export async function handleWebhook(request: Request, env: RelayEnv, now = Date.now()): Promise<Response> {
  if (request.method !== 'POST') return response(405, 'METHOD_NOT_ALLOWED');
  if (new URL(request.url).pathname !== '/sentry') return response(404, 'NOT_FOUND');
  if (env.RELAY_ENABLED !== 'true') return response(503, 'RELAY_DISABLED');
  if (!configured(env)) return response(503, 'RELAY_CONFIGURATION_INVALID');
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return response(415, 'JSON_REQUIRED');
  const bytes = await readBoundedBody(request); if (!bytes) return response(413, 'PAYLOAD_TOO_LARGE');
  if (!await validSignature(bytes, request.headers.get('sentry-hook-signature'), env.SENTRY_CLIENT_SECRET)) return response(401, 'SIGNATURE_INVALID');
  const timestamp = request.headers.get('sentry-hook-timestamp');
  if (!timestamp || !/^[0-9]{10}(?:\.[0-9]{1,6})?$/u.test(timestamp) || !fresh(Number(timestamp) * 1000, now)) return response(401, 'DELIVERY_EXPIRED');
  if (request.headers.get('sentry-hook-resource') !== 'event_alert') return response(422, 'RESOURCE_NOT_ALLOWED');
  let payload: unknown; try {payload = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));} catch {return response(400, 'PAYLOAD_INVALID');}
  if (!fresh(signedEventTime(object(object(object(payload).data).event)), now)) return response(401, 'SIGNED_EVENT_EXPIRED');
  const alert = safeAlert(payload, env); if (!alert) return response(422, 'ALERT_NOT_ALLOWED');
  const inbox = env.RELAY_INBOX.get(env.RELAY_INBOX.idFromName('developer-sentry-inbox-v1'));
  return inbox.fetch(new Request('https://relay.internal/enqueue', {method: 'POST', body: JSON.stringify({alert, acceptedAt: now})}));
}
// Minimal platform surface, so root tsc checks the Worker without a second SDK.
interface SqlRows<T> extends Iterable<T> {toArray(): T[]}
export interface State {
  storage: {sql: {exec<T extends Record<string, unknown>>(query: string, ...bindings: (string | number)[]): SqlRows<T>}; setAlarm(time: number): Promise<void>};
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}
type Row = {id: string; payload: string; created: number; status: string} & Record<string, unknown>;
export class RelayInbox {
  constructor(private state: State, private env: RelayEnv) {
    this.state.storage.sql.exec('CREATE TABLE IF NOT EXISTS relay (id TEXT PRIMARY KEY, payload TEXT NOT NULL, created INTEGER NOT NULL, status TEXT NOT NULL)');
    this.state.storage.sql.exec('CREATE INDEX IF NOT EXISTS relay_status ON relay(status, created)');
  }
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/enqueue') return response(404, 'NOT_FOUND');
    const {alert, acceptedAt} = await request.json() as {alert: SafeAlert; acceptedAt: number};
    const id = alert.projectId + ':' + alert.eventId;
    // Only the verified Worker can invoke this binding. Keep a durable claim
    // before the acknowledgement; cold starts and concurrent requests share it.
    return this.state.blockConcurrencyWhile(async () => {
      const existing = this.state.storage.sql.exec<Row>('SELECT * FROM relay WHERE id = ?', id).toArray();
      if (existing.length) return response(200, 'DUPLICATE_IGNORED');
      this.state.storage.sql.exec('DELETE FROM relay WHERE created < ?', acceptedAt - RETENTION_MS);
      const count = this.state.storage.sql.exec<{n: number}>('SELECT count(*) AS n FROM relay').toArray()[0].n;
      if (count >= 5000) return response(503, 'INBOX_FULL');
      this.state.storage.sql.exec('INSERT INTO relay (id, payload, created, status) VALUES (?, ?, ?, ?)', id, JSON.stringify(alert), acceptedAt, 'pending');
      try {await this.state.storage.setAlarm(Date.now() + 1000);} catch {
        this.state.storage.sql.exec('DELETE FROM relay WHERE id = ?', id); return response(503, 'INBOX_UNAVAILABLE');
      }
      return response(202, 'ALERT_ACCEPTED');
    });
  }
  async alarm(): Promise<void> {
    const sql = this.state.storage.sql;
    if (this.env.RELAY_ENABLED !== 'true' || !configured(this.env)) {
      sql.exec("UPDATE relay SET status = 'disabled', payload = '' WHERE status = 'pending'"); return;
    }
    for (const row of sql.exec<Row>("SELECT * FROM relay WHERE status = 'pending' ORDER BY created LIMIT 5").toArray()) {
      // At most ONE Telegram attempt. Persist before network, never resend an
      // ambiguous timeout/crash: duplicates are worse than a documented loss.
      const claimed = sql.exec<Row>("UPDATE relay SET status = 'sending' WHERE id = ? AND status = 'pending' RETURNING *", row.id).toArray();
      if (!claimed.length) continue;
      sql.exec("UPDATE relay SET payload = '' WHERE id = ?", row.id);
      let status = 'failed';
      try {
        if (Date.now() - row.created > MAX_AGE_MS) {fixedLog('RELAY_QUEUED_EVENT_EXPIRED'); continue;}
        const alert = JSON.parse(row.payload) as SafeAlert;
        const res = await fetch(`https://api.telegram.org/bot${this.env.DEV_TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(5000), headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({chat_id: this.env.DEV_TELEGRAM_CHAT_ID, text: telegramMessage(alert, this.env.SENTRY_ORG_SLUG), disable_web_page_preview: true}),
        });
        const data = object(await res.json()), result = object(data.result), chat = object(result.chat);
        const chatId = typeof chat.id === 'string' ? chat.id : typeof chat.id === 'number' && Number.isSafeInteger(chat.id) ? String(chat.id) : null;
        if (res.ok && data.ok === true && Number.isSafeInteger(result.message_id) && Number(result.message_id) > 0 && chatId === this.env.DEV_TELEGRAM_CHAT_ID) status = 'sent';
        else fixedLog('RELAY_TELEGRAM_REJECTED');
      } catch {fixedLog('RELAY_TELEGRAM_FAILED');}
      finally {sql.exec('UPDATE relay SET status = ?, payload = ? WHERE id = ?', status, '', row.id);}
    }
    if (sql.exec<Row>("SELECT * FROM relay WHERE status = 'pending' LIMIT 1").toArray().length) await this.state.storage.setAlarm(Date.now() + 1000);
  }
}
export default {
  async fetch(request: Request, env: RelayEnv): Promise<Response> {
    try {return await handleWebhook(request, env);} catch {fixedLog('RELAY_INTERNAL_FAILED'); return response(503, 'RELAY_UNAVAILABLE');}
  },
};
