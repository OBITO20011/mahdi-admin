const DEFAULT_REMINDER_MS = Object.freeze({
  critical: 30 * 60 * 1000,
  high: 60 * 60 * 1000,
  medium: 6 * 60 * 60 * 1000,
  low: 24 * 60 * 60 * 1000,
});

const VALID_SEVERITIES = new Set(Object.keys(DEFAULT_REMINDER_MS));
const SENSITIVE_KEY_PATTERN = /(?:token|secret|password|authorization|cookie|phone|customer|address|amount|balance)/iu;

export function parseTechnicalJson(value) {
  return JSON.parse(String(value ?? '').replace(/^\uFEFF/u, ''));
}

export function sanitizeTechnicalText(value, maxLength = 500) {
  const text = String(value ?? '')
    .replace(/https?:\/\/[^\s?#]+\?[^\s]+/giu, '[redacted-url]')
    .replace(/(?:bearer\s+|bot)\d+:[A-Za-z0-9_-]+/giu, '[redacted-credential]')
    .replace(/\b\d{9,15}\b/gu, '[redacted-number]')
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(/\s{2,}/gu, ' ')
    .trim();
  return text.slice(0, Math.max(0, maxLength));
}

export function sanitizeTechnicalDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {};
  return Object.fromEntries(
    Object.entries(details)
      .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
      .slice(0, 20)
      .map(([key, value]) => [
        sanitizeTechnicalText(key, 80),
        sanitizeTechnicalText(value, 240),
      ]),
  );
}

export function normalizeCheck(check) {
  if (!check || typeof check !== 'object') throw new TypeError('Monitoring check must be an object.');
  const key = sanitizeTechnicalText(check.key, 160);
  if (!/^developer:[a-z0-9][a-z0-9:_-]*$/u.test(key)) {
    throw new TypeError(`Invalid developer incident key: ${key || 'empty'}`);
  }
  const severity = String(check.severity || '').toLowerCase();
  if (!VALID_SEVERITIES.has(severity)) throw new TypeError(`Invalid severity for ${key}.`);
  return {
    key,
    source: sanitizeTechnicalText(check.source, 80) || 'unknown',
    severity,
    healthy: check.healthy === true,
    summary: sanitizeTechnicalText(check.summary, 240) || key,
    details: sanitizeTechnicalDetails(check.details),
    observedAt: new Date(check.observedAt || Date.now()).toISOString(),
  };
}

export function getWorkflowTransition(currentConclusion, previousConclusion) {
  const failures = new Set(['failure', 'cancelled', 'timed_out', 'action_required', 'stale']);
  const currentFailed = failures.has(currentConclusion);
  const previousFailed = failures.has(previousConclusion);
  if (currentFailed && !previousFailed) return 'incident';
  if (currentConclusion === 'success' && previousFailed) return 'recovery';
  return null;
}

export function getNotificationKind(check, previous, now = new Date()) {
  const normalized = normalizeCheck(check);
  if (!normalized.healthy) {
    if (!previous?.active || !previous?.lastNotifiedAt) return 'incident';
    const reminderMs = DEFAULT_REMINDER_MS[normalized.severity];
    if (now.getTime() - Date.parse(previous.lastNotifiedAt) >= reminderMs) return 'reminder';
    return null;
  }
  return previous?.active && previous?.lastNotifiedAt ? 'recovery' : null;
}

export function formatDeveloperAlert(check, kind, now = new Date()) {
  const normalized = normalizeCheck(check);
  const heading = kind === 'recovery'
    ? '✅ تعافي خدمة تقنية'
    : kind === 'reminder'
      ? '🔁 تذكير بعطل تقني مستمر'
      : normalized.severity === 'critical'
        ? '🚨 عطل تقني حرج'
        : '⚠️ تنبيه تقني';
  const detailLines = Object.entries(normalized.details)
    .map(([key, value]) => `- ${key}: ${value}`);
  return [
    heading,
    `المصدر: ${normalized.source}`,
    `الخطورة: ${normalized.severity.toUpperCase()}`,
    `الحادث: ${normalized.key}`,
    `الملخص: ${normalized.summary}`,
    ...detailLines,
    `الوقت: ${now.toISOString()}`,
  ].join('\n').slice(0, 3500);
}

function transitionState(previous, check, kind, delivered, now) {
  const normalized = normalizeCheck(check);
  const base = {
    active: !normalized.healthy,
    severity: normalized.severity,
    source: normalized.source,
    summary: normalized.summary,
    firstObservedAt: previous?.firstObservedAt || normalized.observedAt,
    lastObservedAt: normalized.observedAt,
    lastNotifiedAt: previous?.lastNotifiedAt || null,
    notificationCount: Number(previous?.notificationCount || 0),
    deliveryFailures: Number(previous?.deliveryFailures || 0),
    resolvedAt: previous?.resolvedAt || null,
  };

  if (!kind) {
    if (normalized.healthy && previous?.active && !previous?.lastNotifiedAt) {
      return {...base, active: false, resolvedAt: now.toISOString()};
    }
    return base;
  }
  if (!delivered) return {...base, active: previous?.active || !normalized.healthy, deliveryFailures: base.deliveryFailures + 1};
  if (kind === 'recovery') {
    return {
      ...base,
      active: false,
      lastNotifiedAt: now.toISOString(),
      notificationCount: base.notificationCount + 1,
      deliveryFailures: 0,
      resolvedAt: now.toISOString(),
    };
  }
  return {
    ...base,
    active: true,
    lastNotifiedAt: now.toISOString(),
    notificationCount: base.notificationCount + 1,
    deliveryFailures: 0,
    resolvedAt: null,
  };
}

export async function runIncidentCycle({checks, state = {version: 1, incidents: {}}, send, now = new Date()}) {
  if (typeof send !== 'function') throw new TypeError('A developer alert sender is required.');
  const nextState = {
    version: 1,
    updatedAt: now.toISOString(),
    incidents: {...(state.incidents || {})},
  };
  const notifications = [];
  for (const rawCheck of checks) {
    const check = normalizeCheck(rawCheck);
    const previous = nextState.incidents[check.key];
    const kind = getNotificationKind(check, previous, now);
    let delivered = false;
    if (kind) {
      const message = formatDeveloperAlert(check, kind, now);
      delivered = await send({eventKey: check.key, kind, message, severity: check.severity}) === true;
      notifications.push({eventKey: check.key, kind, delivered});
    }
    nextState.incidents[check.key] = transitionState(previous, check, kind, delivered, now);
  }
  return {state: nextState, notifications};
}

export async function sendTelegramMessage({botToken, chatId, message, fetchImpl = fetch, maxAttempts = 3}) {
  if (!botToken || !chatId) throw new TypeError('Developer Telegram credentials are not configured.');
  const attempts = Math.min(Math.max(Number(maxAttempts) || 1, 1), 3);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({chat_id: chatId, text: message, disable_web_page_preview: true}),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return true;
    } catch {
      // The caller records one bounded delivery failure without logging credentials.
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
  }
  return false;
}
