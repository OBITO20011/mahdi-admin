import {
  MAX_TURNSTILE_TOKEN_LENGTH,
  extractTrustedClientIp,
  hmacSha256Hex,
  isUuid,
  normalizeJordanPhone,
  safeGatewayMessage,
  verifyTurnstileToken,
} from './security.ts';

declare const Deno: {
  env: {get(name: string): string | undefined};
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

interface GuestOrderGatewayBody {
  idempotencyKey?: unknown;
  turnstileToken?: unknown;
  clientSessionId?: unknown;
  customer?: Record<string, unknown>;
  items?: unknown;
  promotionCode?: unknown;
  paymentMethod?: unknown;
  deliveryZone?: unknown;
}

const approvedOrigins = new Set([
  'https://nawasrah-store.pages.dev',
  'http://localhost:3002',
  'http://127.0.0.1:3002',
  'http://localhost:4174',
  'http://127.0.0.1:4174',
]);

const isApprovedOrigin = (origin: string | null) => {
  if (!origin) return false;
  if (approvedOrigins.has(origin)) return true;
  return /^https:\/\/[a-z0-9-]+\.nawasrah-store\.pages\.dev$/i.test(origin);
};

const corsHeaders = (origin: string | null): HeadersInit => ({
  'Access-Control-Allow-Origin': isApprovedOrigin(origin) ? origin! : 'null',
  'Access-Control-Allow-Headers': 'apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  Vary: 'Origin',
});

const jsonResponse = (
  body: unknown,
  status: number,
  origin: string | null,
  extraHeaders: HeadersInit = {},
) => new Response(JSON.stringify(body), {
  status,
  headers: {...corsHeaders(origin), ...extraHeaders},
});

const text = (value: unknown, maxLength: number) =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const eventId = () => crypto.randomUUID();
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const MAX_GUEST_ORDER_LINE_ITEMS = 50;

async function readLimitedJsonBody(
  request: Request,
): Promise<{body?: GuestOrderGatewayBody; tooLarge?: boolean}> {
  const reader = request.body?.getReader();
  if (!reader) return {};

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      await reader.cancel();
      return {tooLarge: true};
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return {body: JSON.parse(new TextDecoder().decode(bytes)) as GuestOrderGatewayBody};
  } catch {
    return {};
  }
}

function logSecurityEvent(
  event: string,
  requestId: string,
  details: Record<string, string | number | boolean> = {},
) {
  console.info(JSON.stringify({event, requestId, ...details}));
}

async function callRpc(
  supabaseUrl: string,
  serviceRoleKey: string,
  functionName: string,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch,
) {
  return fetchImpl(`${supabaseUrl}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

interface GuestOrderHandlerDependencies {
  getEnv?: (name: string) => string | undefined;
  fetchImpl?: typeof fetch;
}

export async function handleGuestOrderRequest(
  request: Request,
  dependencies: GuestOrderHandlerDependencies = {},
): Promise<Response> {
  const getEnv = dependencies.getEnv ?? ((name: string) => Deno.env.get(name));
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const origin = request.headers.get('origin');
  const requestId = eventId();

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: isApprovedOrigin(origin) ? 204 : 403,
      headers: corsHeaders(origin),
    });
  }
  if (request.method !== 'POST') {
    return jsonResponse({error: 'Method not allowed'}, 405, origin);
  }
  if (!isApprovedOrigin(origin)) {
    return jsonResponse({error: 'Origin is not allowed'}, 403, origin);
  }

  const contentLength = Number(request.headers.get('content-length') || '0');
  if (contentLength > MAX_REQUEST_BODY_BYTES) {
    return jsonResponse({error: 'راجع بيانات الطلب ثم حاول مرة أخرى.', code: 'invalid_request'}, 413, origin);
  }

  const supabaseUrl = getEnv('SUPABASE_URL')?.replace(/\/+$/, '');
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  const turnstileSecret = getEnv('TURNSTILE_SECRET_KEY');
  const hashSecret = getEnv('GUEST_ORDER_HASH_SECRET');
  const turnstileTestMode = getEnv('TURNSTILE_TEST_MODE') === 'true';
  const allowedHostnames = new Set<string>(
    (getEnv('TURNSTILE_ALLOWED_HOSTNAMES') || 'nawasrah-store.pages.dev')
      .split(',')
      .map((hostname) => hostname.trim().toLowerCase())
      .filter(Boolean),
  );

  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    !turnstileSecret ||
    !hashSecret ||
    hashSecret.length < 32
  ) {
    logSecurityEvent('gateway_configuration_error', requestId);
    return jsonResponse({
      error: 'تعذر إرسال الطلب مؤقتًا. حاول مرة أخرى.',
      code: 'gateway_unavailable',
    }, 503, origin);
  }

  const parsedRequest = await readLimitedJsonBody(request);
  if (parsedRequest.tooLarge) {
    return jsonResponse({error: 'راجع بيانات الطلب ثم حاول مرة أخرى.', code: 'invalid_request'}, 413, origin);
  }
  if (!parsedRequest.body) {
    return jsonResponse({error: 'راجع بيانات الطلب ثم حاول مرة أخرى.', code: 'invalid_request'}, 400, origin);
  }
  const body = parsedRequest.body;

  const idempotencyKey = text(body.idempotencyKey, 64);
  const clientSessionId = text(body.clientSessionId, 64);
  const turnstileToken = text(body.turnstileToken, MAX_TURNSTILE_TOKEN_LENGTH + 1);
  const customer = body.customer || {};
  const items = Array.isArray(body.items) ? body.items : [];
  const phone = normalizeJordanPhone(customer.phone);
  const clientIp = extractTrustedClientIp(request.headers);

  if (!isUuid(idempotencyKey) || !isUuid(clientSessionId) || !phone || !clientIp) {
    return jsonResponse({error: 'راجع بيانات الطلب ثم حاول مرة أخرى.', code: 'invalid_request'}, 400, origin);
  }
  if (items.length > MAX_GUEST_ORDER_LINE_ITEMS) {
    return jsonResponse({
      error: `الحد الأقصى للطلب هو ${MAX_GUEST_ORDER_LINE_ITEMS} صنفًا. احذف صنفًا واحدًا على الأقل ثم حاول مرة أخرى.`,
      code: 'too_many_line_items',
    }, 400, origin);
  }
  if (!turnstileToken || turnstileToken.length > MAX_TURNSTILE_TOKEN_LENGTH) {
    logSecurityEvent('turnstile_missing', requestId);
    return jsonResponse({
      error: safeGatewayMessage(400, 'turnstile_required'),
      code: 'turnstile_required',
    }, 400, origin);
  }

  const turnstile = await verifyTurnstileToken({
    token: turnstileToken,
    remoteIp: clientIp,
    idempotencyKey,
    secret: turnstileSecret,
    allowedHostnames,
    testMode: turnstileTestMode,
    fetchImpl,
  });
  if (!turnstile.success) {
    logSecurityEvent('turnstile_failed', requestId, {
      duplicateOrExpired: turnstile['error-codes']?.includes('timeout-or-duplicate') === true,
    });
    return jsonResponse({
      error: safeGatewayMessage(400, 'turnstile_failed'),
      code: 'turnstile_failed',
    }, 400, origin);
  }

  const [ipHash, sessionHash, phoneHash] = await Promise.all([
    hmacSha256Hex(hashSecret, 'ip', clientIp),
    hmacSha256Hex(hashSecret, 'session', clientSessionId),
    hmacSha256Hex(hashSecret, 'phone', phone),
  ]);

  let authorizationResponse: Response;
  let authorization: {
    allowed?: boolean;
    reason?: string;
    retry_after_seconds?: number;
  };
  try {
    authorizationResponse = await callRpc(
      supabaseUrl,
      serviceRoleKey,
      'authorize_guest_order_gateway',
      {
        p_idempotency_key: idempotencyKey,
        p_ip_hash: ipHash,
        p_session_hash: sessionHash,
        p_phone_hash: phoneHash,
      },
      fetchImpl,
    );
    authorization = await authorizationResponse.json() as typeof authorization;
  } catch {
    logSecurityEvent('gateway_authorization_error', requestId);
    return jsonResponse({error: safeGatewayMessage(503, ''), code: 'gateway_unavailable'}, 503, origin);
  }

  if (!authorizationResponse.ok) {
    logSecurityEvent('gateway_authorization_error', requestId);
    return jsonResponse({error: safeGatewayMessage(503, ''), code: 'gateway_unavailable'}, 503, origin);
  }
  if (authorization.allowed !== true) {
    const retryAfter = Math.max(1, Number(authorization.retry_after_seconds) || 600);
    logSecurityEvent('rate_limit_rejected', requestId, {reason: authorization.reason || 'rate_limited'});
    return jsonResponse({
      error: safeGatewayMessage(429, 'rate_limited'),
      code: 'rate_limited',
      retryAfterSeconds: retryAfter,
    }, 429, origin, {'Retry-After': String(retryAfter)});
  }

  let orderResponse: Response;
  let orderResult: Record<string, unknown>;
  try {
    orderResponse = await callRpc(
      supabaseUrl,
      serviceRoleKey,
      'submit_guest_customer_order',
      {
        p_idempotency_key: idempotencyKey,
        p_customer_full_name: text(customer.fullName, 120),
        p_customer_phone: phone,
        p_governorate: text(customer.governorate, 80),
        p_city: text(customer.city, 80),
        p_area: text(customer.area, 120),
        p_street: text(customer.street, 300),
        p_building: text(customer.building, 120) || null,
        p_address_notes: text(customer.addressNotes, 500) || null,
        p_google_maps_url: text(customer.googleMapsUrl, 1000) || null,
        p_latitude: typeof customer.latitude === 'number' ? customer.latitude : null,
        p_longitude: typeof customer.longitude === 'number' ? customer.longitude : null,
        p_customer_notes: text(customer.customerNotes, 1000) || null,
        p_items: items,
        p_promotion_code: text(body.promotionCode, 80) || null,
        p_payment_method: text(body.paymentMethod, 30),
        p_delivery_zone: text(body.deliveryZone, 30),
      },
      fetchImpl,
    );
    orderResult = await orderResponse.json() as Record<string, unknown>;
  } catch {
    logSecurityEvent('guest_order_gateway_error', requestId);
    try {
      await callRpc(supabaseUrl, serviceRoleKey, 'finalize_guest_order_gateway', {
        p_idempotency_key: idempotencyKey,
        p_outcome: 'gateway_error',
        p_order_id: null,
      }, fetchImpl);
    } catch {
      logSecurityEvent('gateway_finalize_error', requestId);
    }
    return jsonResponse({error: safeGatewayMessage(503, ''), code: 'gateway_unavailable'}, 503, origin);
  }

  const succeeded = orderResponse.ok && orderResult.success === true;
  const orderId = succeeded && isUuid(orderResult.order_id)
    ? orderResult.order_id
    : null;

  try {
    const finalizeResponse = await callRpc(supabaseUrl, serviceRoleKey, 'finalize_guest_order_gateway', {
      p_idempotency_key: idempotencyKey,
      p_outcome: succeeded ? 'succeeded' : 'order_rejected',
      p_order_id: orderId,
    }, fetchImpl);
    if (!finalizeResponse.ok) logSecurityEvent('gateway_finalize_error', requestId);
  } catch {
    logSecurityEvent('gateway_finalize_error', requestId);
  }

  if (!succeeded) {
    logSecurityEvent('guest_order_rejected', requestId);
    return jsonResponse({
      error: 'تعذر إكمال الطلب بهذه البيانات. راجع الكميات وحاول مرة أخرى.',
      code: 'order_rejected',
    }, 400, origin);
  }

  logSecurityEvent('guest_order_accepted', requestId, {
    idempotentReplay: orderResult.idempotent_replay === true,
  });
  return jsonResponse(orderResult, 200, origin);
}

if (typeof Deno !== 'undefined') {
  Deno.serve((request) => handleGuestOrderRequest(request));
}
