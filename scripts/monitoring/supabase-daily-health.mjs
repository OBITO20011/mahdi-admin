export const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const DATABASE_WARNING_BYTES = 400_000_000; // Decimal MB, not disk/storage size.
export const DATABASE_SIZE_SQL = 'BEGIN READ ONLY; SELECT pg_database_size(current_database()); ROLLBACK;';

const validResult = value => value && ['ok', 'http_failure', 'unreachable', 'invalid_response', 'unconfigured', 'read_failure'].includes(value.status)
  && typeof value.healthy === 'boolean' && (value.status === 'ok' || value.healthy === false);
const check = (kind, result, checkedAt) => ({
  key: `developer:supabase:daily-${kind}`, source: 'Supabase daily read', severity: 'high',
  healthy: result.healthy, observedAt: checkedAt,
  summary: kind === 'keepalive'
    ? (result.healthy ? 'قراءة Supabase اليومية نجحت.' : 'فشلت قراءة Supabase اليومية؛ تحقق من توفر المشروع.')
    : (result.healthy ? 'حجم قاعدة البيانات دون حد التنبيه.' : 'حجم قاعدة البيانات بلغ 400MB أو تعذر قياسه.'),
  details: {status: result.status, ...(kind === 'keepalive' ? {httpStatus: result.httpStatus ?? 0}
    : {databaseBytes: result.databaseBytes ?? 'unavailable', warningBytes: DATABASE_WARNING_BYTES})},
});

export function sizeResult(raw) {
  const value = typeof raw === 'string' && /^\d+$/u.test(raw.trim()) ? Number(raw.trim()) : raw;
  if (!Number.isSafeInteger(value) || value < 0) return {status: 'read_failure', healthy: false};
  return {status: 'ok', healthy: value < DATABASE_WARNING_BYTES, databaseBytes: value};
}

export async function readKeepalive({url, publishableKey, fetchImpl = fetch}) {
  let endpoint;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.search || parsed.hash
      || !(parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)))) throw new Error();
    endpoint = new URL('/rest/v1/rpc/get_public_storefront_settings', parsed);
  } catch { return {status: 'unconfigured', healthy: false}; }
  if (!publishableKey) return {status: 'unconfigured', healthy: false};
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST', redirect: 'error', headers: {'content-type': 'application/json', apikey: publishableKey,
        ...(publishableKey.startsWith('eyJ') ? {authorization: `Bearer ${publishableKey}`} : {})},
      body: '{}', signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 200) return {status: 'http_failure', healthy: false, httpStatus: response.status};
    const value = await response.json();
    if (!value || typeof value.ordersEnabled !== 'boolean' || typeof value.storeNameAr !== 'string')
      return {status: 'invalid_response', healthy: false, httpStatus: 200};
    return {status: 'ok', healthy: true, httpStatus: 200}; // No response body/URL/key stored or logged.
  } catch { return {status: 'unreachable', healthy: false}; }
}

/** @param {{enabled?:boolean,now?:Date,previous?:unknown,url:string,publishableKey:string,fetchImpl?:typeof fetch,readDatabaseSize:(sql:string)=>Promise<unknown>}} options */
export async function collectDailySupabase({enabled = false, now = new Date(), previous = null, url, publishableKey,
  fetchImpl = fetch, readDatabaseSize}) {
  if (!enabled) return {checks: [], state: null, sampled: false};
  const age = now.getTime() - Date.parse(previous?.checkedAt);
  const cached = Number.isFinite(age) && age >= 0 && age < DAILY_INTERVAL_MS
    && validResult(previous?.keepalive) && validResult(previous?.size)
    && (previous.size.status !== 'ok' || (Number.isSafeInteger(previous.size.databaseBytes)
      && previous.size.databaseBytes >= 0 && previous.size.healthy === (previous.size.databaseBytes < DATABASE_WARNING_BYTES)))
    && (previous.keepalive.status !== 'ok' || (previous.keepalive.healthy && previous.keepalive.httpStatus === 200));
  let state;
  if (cached) {
    // Persist only the known technical projection, never arbitrary cached content.
    const {status, healthy, httpStatus} = previous.keepalive;
    state = {checkedAt: previous.checkedAt, keepalive: {status, healthy, ...(httpStatus === undefined ? {} : {httpStatus})},
      size: sizeResult(previous.size.status === 'ok' ? previous.size.databaseBytes : null)};
  } else {
    const keepalive = await readKeepalive({url, publishableKey, fetchImpl});
    let size;
    try { size = sizeResult(await readDatabaseSize(DATABASE_SIZE_SQL)); }
    catch { size = sizeResult(null); }
    state = {checkedAt: now.toISOString(), keepalive, size};
  }
  return {checks: [check('keepalive', state.keepalive, state.checkedAt), check('size', state.size, state.checkedAt)],
    state, sampled: !cached};
}
