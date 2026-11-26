import {readFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeAtomicUtf8} from '../agent/atomic-file.mjs';
import {sendTelegramMessage} from './developer-alert-core.mjs';

const checks = {
  storefront: 'المتجر',
  admin: 'لوحة الإدارة',
  database: 'قاعدة البيانات',
};

function httpsOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.href === url.origin + '/') return url;
  } catch {
    // Do not allow URL constructor errors to put input values in logs.
  }
  throw Error('FAST_DOWN_ALERT_CONFIG_INVALID');
}

function anonHeaders(key) {
  if (/^sb_publishable_[A-Za-z0-9_-]{16,}$/u.test(key)) return {apikey: key};
  if (/^eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+$/u.test(key)) {
    try {
      const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url'));
      if (payload.role === 'anon') return {apikey: key, authorization: 'Bearer ' + key};
    } catch {
      // Invalid credentials are reported with a fixed diagnostic.
    }
  }
  throw Error('FAST_DOWN_ALERT_PUBLIC_KEY_REQUIRED');
}

function configuration(env) {
  const storefront = httpsOrigin(env.DEV_FAST_DOWN_STOREFRONT_ORIGIN);
  const admin = httpsOrigin(env.DEV_FAST_DOWN_ADMIN_ORIGIN);
  const supabase = httpsOrigin(env.DEV_FAST_DOWN_SUPABASE_ORIGIN);
  const stateFile = env.DEV_FAST_DOWN_STATE_FILE ?? '';
  const botToken = env.DEV_TELEGRAM_BOT_TOKEN ?? '';
  const chatId = env.DEV_TELEGRAM_CHAT_ID ?? '';
  if (!/^[a-z0-9]{20}\.supabase\.co$/u.test(supabase.host) ||
      storefront.origin === admin.origin || !path.isAbsolute(stateFile) ||
      !/^\d+:[A-Za-z0-9_-]+$/u.test(botToken) || !/^-?[1-9]\d*$/u.test(chatId) ||
      botToken === env.OWNER_TELEGRAM_BOT_TOKEN || chatId === env.OWNER_TELEGRAM_CHAT_ID) {
    throw Error('FAST_DOWN_ALERT_CONFIG_INVALID');
  }
  return {
    urls: {
      storefront,
      admin,
      database: new URL('/rest/v1/rpc/get_public_storefront_settings', supabase),
    },
    dbAuth: anonHeaders(env.DEV_FAST_DOWN_ANON_KEY ?? ''),
    botToken,
    chatId,
    stateFile,
  };
}

function loadState(file) {
  let saved;
  try {
    saved = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw Error('FAST_DOWN_ALERT_STATE_UNREADABLE');
    return Object.fromEntries(Object.keys(checks).map(id => [id, {failures: 0, notified: false}]));
  }
  if (saved?.version !== 1 || !Object.keys(checks).every(id => {
    const check = saved.checks?.[id];
    return Number.isInteger(check?.failures) && check.failures >= 0 &&
      check.failures <= 3 && typeof check.notified === 'boolean';
  })) throw Error('FAST_DOWN_ALERT_STATE_INVALID');
  return saved.checks;
}

async function probe(id, {urls, dbAuth}, fetchImpl) {
  const isDatabase = id === 'database';
  try {
    const response = await fetchImpl(urls[id], {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      headers: isDatabase ? {...dbAuth, accept: 'application/json', 'cache-control': 'no-cache'} : {},
      signal: AbortSignal.timeout(8000),
    });
    if (isDatabase && response.status === 200) {
      const payload = await response.json();
      return typeof payload?.ordersEnabled === 'boolean' &&
        typeof payload.storeNameAr === 'string' && payload.storeNameAr.trim().length > 0;
    }
    const isHtml = /^text\/html(?:;|$)/iu.test(response.headers.get('content-type') ?? '');
    await response.body?.cancel();
    return !isDatabase && response.status === 200 && isHtml;
  } catch {
    return false;
  }
}

export async function runFastDownAlert({env = process.env, fetchImpl = fetch} = {}) {
  const config = configuration(env);
  const previous = loadState(config.stateFile);
  const results = await Promise.all(Object.entries(checks).map(async ([id, label]) => {
    const healthy = await probe(id, config, fetchImpl);
    const {failures, notified} = previous[id];
    const next = {failures: healthy ? 0 : Math.min(failures + 1, 3), notified};
    const transition = healthy && notified ? 'recovered' : !healthy && next.failures === 3 && !notified ? 'down' : null;
    let delivered = null;

    if (transition) {
      const message = transition === 'down' ? `تعطل ${label} بعد ثلاثة فحوص متتالية.` : `عاد ${label} إلى العمل.`;
      delivered = await sendTelegramMessage({
        botToken: config.botToken, chatId: config.chatId, message, maxAttempts: 1,
        fetchImpl: (url, options) => fetchImpl(url, {...options, redirect: 'error', credentials: 'omit'}),
      });
      if (delivered) next.notified = transition === 'down';
    }
    return {id, healthy, failures: next.failures, notified: next.notified, transition, delivered};
  }));

  const state = Object.fromEntries(results.map(({id, failures, notified}) => [id, {failures, notified}]));
  writeAtomicUtf8(config.stateFile, JSON.stringify({version: 1, checks: state}) + '\n');
  return {ok: results.every(check => check.delivered !== false), checks: results};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await runFastDownAlert();
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  } catch {
    console.error('FAST_DOWN_ALERT_RUN_FAILED');
    process.exitCode = 1;
  }
}
