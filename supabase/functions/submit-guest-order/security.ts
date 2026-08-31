export const TURNSTILE_ACTION = 'guest-order';
export const MAX_TURNSTILE_TOKEN_LENGTH = 2048;

export interface TurnstileVerification {
  success: boolean;
  action?: string;
  hostname?: string;
  challenge_ts?: string;
  'error-codes'?: string[];
  metadata?: {
    result_with_testing_key?: boolean;
  };
}

export interface TurnstileVerificationOptions {
  token: string;
  remoteIp: string;
  idempotencyKey: string;
  secret: string;
  allowedHostnames: ReadonlySet<string>;
  testMode?: boolean;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

export function normalizeJordanPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('00962')) digits = digits.slice(5);
  else if (digits.startsWith('962')) digits = digits.slice(3);
  if (digits.length === 9 && digits.startsWith('7')) digits = `0${digits}`;
  return /^07[789]\d{7}$/.test(digits) ? digits : null;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isIpAddress(value: string): boolean {
  if (value.length < 3 || value.length > 64) return false;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) {
    return value.split('.').every((part) => Number(part) <= 255);
  }
  return /^[0-9a-f:]+$/i.test(value) && value.includes(':');
}

export function extractTrustedClientIp(
  headers: Headers,
): string | null {
  // Supabase documents X-Forwarded-For as the Edge Function client-IP source.
  // Use the proxy-appended final hop and deliberately ignore CF-Connecting-IP,
  // X-Real-IP and Forwarded, which a direct caller can inject in local/runtime
  // requests. The browser body never participates in this identifier.
  const forwardedIp = headers.get('x-forwarded-for')
    ?.split(',')
    .at(-1)
    ?.trim() || '';
  return isIpAddress(forwardedIp) ? forwardedIp : null;
}

export async function hmacSha256Hex(
  secret: string,
  namespace: string,
  value: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    {name: 'HMAC', hash: 'SHA-256'},
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${namespace}:${value}`),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyTurnstileToken(
  options: TurnstileVerificationOptions,
): Promise<TurnstileVerification> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = options.endpoint ??
    'https://challenges.cloudflare.com/turnstile/v0/siteverify';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({
        secret: options.secret,
        response: options.token,
        remoteip: options.remoteIp,
        idempotency_key: options.idempotencyKey,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return {success: false, 'error-codes': ['siteverify-unavailable']};

    const result = await response.json() as TurnstileVerification;
    if (!result.success) return result;

    const usesOfficialTestKey = options.testMode === true &&
      result.metadata?.result_with_testing_key === true;
    const actionAllowed = result.action === TURNSTILE_ACTION ||
      (options.testMode === true && result.action === 'test') ||
      (usesOfficialTestKey && result.action === undefined);
    const hostnameAllowed = typeof result.hostname === 'string' &&
      options.allowedHostnames.has(result.hostname.toLowerCase());

    return actionAllowed && hostnameAllowed
      ? result
      : {...result, success: false, 'error-codes': ['context-mismatch']};
  } catch {
    return {success: false, 'error-codes': ['siteverify-unavailable']};
  } finally {
    clearTimeout(timeout);
  }
}

export function safeGatewayMessage(status: number, code: string): string {
  if (status === 429 || code === 'rate_limited') {
    return 'تم إرسال طلبات كثيرة خلال فترة قصيرة، حاول بعد قليل.';
  }
  if (code === 'turnstile_required' || code === 'turnstile_failed') {
    return 'تعذر التحقق، حاول مرة أخرى.';
  }
  if (status >= 500) return 'تعذر إرسال الطلب مؤقتًا. حاول مرة أخرى.';
  return 'راجع بيانات الطلب ثم حاول مرة أخرى.';
}
