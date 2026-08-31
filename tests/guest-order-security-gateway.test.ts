import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  TURNSTILE_ACTION,
  extractTrustedClientIp,
  hmacSha256Hex,
  normalizeJordanPhone,
  verifyTurnstileToken,
} from '../supabase/functions/submit-guest-order/security.ts';
import { handleGuestOrderRequest } from '../supabase/functions/submit-guest-order/index.ts';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/086_guest_order_abuse_gateway.sql',
    import.meta.url
  ),
  'utf8'
);
const lineItemLimitMigration = readFileSync(
  new URL(
    '../supabase/migrations/087_guest_order_line_item_limit.sql',
    import.meta.url
  ),
  'utf8'
);
const edgeFunction = readFileSync(
  new URL('../supabase/functions/submit-guest-order/index.ts', import.meta.url),
  'utf8'
);
const customerService = readFileSync(
  new URL('../customer-web/src/services/orders.service.ts', import.meta.url),
  'utf8'
);
const edgeConfig = readFileSync(
  new URL('../supabase/config.toml', import.meta.url),
  'utf8'
);

const validVerification = {
  success: true,
  action: TURNSTILE_ACTION,
  hostname: 'nawasrah-store.pages.dev',
  challenge_ts: '2026-08-30T10:00:00Z',
};

function verifier(payload: unknown, status = 200): typeof fetch {
  return async () => new Response(JSON.stringify(payload), { status });
}

const verificationOptions = {
  token: 'opaque-turnstile-token',
  remoteIp: '203.0.113.15',
  idempotencyKey: '11111111-1111-4111-8111-111111111111',
  secret: 'test-only-secret',
  allowedHostnames: new Set(['nawasrah-store.pages.dev']),
};

test('Turnstile accepts a valid token only in its expected context', async () => {
  const result = await verifyTurnstileToken({
    ...verificationOptions,
    fetchImpl: verifier(validVerification),
  });
  assert.equal(result.success, true);

  for (const payload of [
    { success: false, 'error-codes': ['invalid-input-response'] },
    { success: false, 'error-codes': ['timeout-or-duplicate'] },
    { ...validVerification, action: 'different-action' },
    { ...validVerification, hostname: 'attacker.example' },
  ]) {
    const rejected = await verifyTurnstileToken({
      ...verificationOptions,
      fetchImpl: verifier(payload),
    });
    assert.equal(rejected.success, false);
  }
});

test('official Turnstile test action is accepted only in explicit server test mode', async () => {
  const testPayload = {
    ...validVerification,
    action: 'test',
    hostname: 'localhost',
  };
  const productionResult = await verifyTurnstileToken({
    ...verificationOptions,
    allowedHostnames: new Set(['localhost']),
    fetchImpl: verifier(testPayload),
  });
  assert.equal(productionResult.success, false);

  const isolatedResult = await verifyTurnstileToken({
    ...verificationOptions,
    allowedHostnames: new Set(['localhost']),
    testMode: true,
    fetchImpl: verifier(testPayload),
  });
  assert.equal(isolatedResult.success, true);

  const currentOfficialTestPayload = {
    success: true,
    hostname: 'example.com',
    metadata: { result_with_testing_key: true },
  };
  const currentProductionResult = await verifyTurnstileToken({
    ...verificationOptions,
    allowedHostnames: new Set(['example.com']),
    fetchImpl: verifier(currentOfficialTestPayload),
  });
  assert.equal(currentProductionResult.success, false);

  const currentIsolatedResult = await verifyTurnstileToken({
    ...verificationOptions,
    allowedHostnames: new Set(['example.com']),
    testMode: true,
    fetchImpl: verifier(currentOfficialTestPayload),
  });
  assert.equal(currentIsolatedResult.success, true);
});

test('Turnstile verification fails closed when Siteverify is unavailable', async () => {
  const unavailable = await verifyTurnstileToken({
    ...verificationOptions,
    fetchImpl: verifier({}, 503),
  });
  assert.equal(unavailable.success, false);
  assert.deepEqual(unavailable['error-codes'], ['siteverify-unavailable']);
});

test('trusted client IP uses only the final Supabase forwarding hop', () => {
  const headers = new Headers({
    'cf-connecting-ip': '203.0.113.30',
    'x-real-ip': '203.0.113.31',
    forwarded: 'for=203.0.113.32',
    'x-forwarded-for': '198.51.100.4, 10.0.0.2',
  });
  assert.equal(extractTrustedClientIp(headers), '10.0.0.2');
  assert.equal(
    extractTrustedClientIp(new Headers({ 'x-forwarded-for': '198.51.100.4, 203.0.113.8' })),
    '203.0.113.8'
  );
  assert.equal(
    extractTrustedClientIp(new Headers({
      'cf-connecting-ip': '203.0.113.30',
      'x-real-ip': '203.0.113.31',
      forwarded: 'for=203.0.113.32',
    })),
    null
  );
  assert.equal(extractTrustedClientIp(new Headers()), null);
});

test('rate-limit identifiers are namespaced one-way HMACs', async () => {
  const phone = normalizeJordanPhone('+962 79 123 4567');
  assert.equal(phone, '0791234567');
  const phoneHash = await hmacSha256Hex('test-secret', 'phone', phone!);
  const ipHash = await hmacSha256Hex('test-secret', 'ip', phone!);
  assert.match(phoneHash, /^[0-9a-f]{64}$/);
  assert.notEqual(phoneHash, ipHash);
  assert.doesNotMatch(phoneHash, /0791234567/);
});

test('migration closes direct RPC execution and exposes only service gateway primitives', () => {
  assert.match(migration, /CREATE TABLE public\.guest_order_gateway_requests/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.guest_order_gateway_requests[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.authorize_guest_order_gateway/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /v_ip_burst >= 6/);
  assert.match(migration, /v_ip_short >= 20/);
  assert.match(migration, /v_session_short >= 4/);
  assert.match(migration, /v_phone_short >= 3/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.submit_guest_customer_order[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.submit_guest_customer_order[\s\S]*TO service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.authorize_guest_order_gateway[\s\S]*TO service_role/);
});

test('customer browser uses the Edge gateway instead of the mutation RPC', () => {
  assert.match(customerService, /invokePublicEdgeFunction<RpcPayload>\(\s*'submit-guest-order'/);
  assert.doesNotMatch(
    customerService,
    /supabase\.rpc\(\s*['"]submit_guest_customer_order['"]/
  );
  assert.match(edgeFunction, /verifyTurnstileToken/);
  assert.match(edgeFunction, /extractTrustedClientIp\(request\.headers/);
  assert.match(edgeFunction, /hmacSha256Hex\(hashSecret, 'phone'/);
  assert.match(edgeFunction, /'authorize_guest_order_gateway'/);
  assert.match(edgeFunction, /'submit_guest_customer_order'/);
  assert.match(
    edgeConfig,
    /\[functions\.submit-guest-order\]\s*\r?\nverify_jwt = false/
  );
});

test('M5 keeps a fifty-item limit identical in the private core and gateway', () => {
  assert.match(
    lineItemLimitMigration,
    /CREATE OR REPLACE FUNCTION public\._calculate_guest_promotion[\s\S]*?jsonb_array_length\(p_items\) > 50/
  );
  assert.match(
    lineItemLimitMigration,
    /CREATE OR REPLACE FUNCTION public\.submit_guest_customer_order_core[\s\S]*?jsonb_array_length\(p_items\) > 50/
  );
  assert.match(edgeFunction, /const MAX_GUEST_ORDER_LINE_ITEMS = 50/);
  assert.match(edgeFunction, /code: 'too_many_line_items'/);
  assert.match(
    lineItemLimitMigration,
    /REVOKE ALL ON FUNCTION public\.submit_guest_customer_order_core[\s\S]*?FROM PUBLIC, anon, authenticated/
  );
});

test('gateway logs contain request IDs and outcomes but no raw identifiers', () => {
  assert.doesNotMatch(edgeFunction, /console\.(?:info|error|warn)\([^\n]*(?:clientIp|phone|turnstileToken)/);
  assert.match(edgeFunction, /logSecurityEvent\('guest_order_accepted'/);
  assert.match(edgeFunction, /logSecurityEvent\('rate_limit_rejected'/);
});

const gatewayBody = {
  idempotencyKey: '11111111-1111-4111-8111-111111111111',
  turnstileToken: 'opaque-turnstile-token',
  clientSessionId: '22222222-2222-4222-8222-222222222222',
  customer: {
    fullName: 'عميل اختبار',
    phone: '0791234567',
    governorate: 'إربد',
    city: 'الرمثا',
    area: 'الحي الشرقي',
    street: 'شارع الاختبار',
    building: '',
    addressNotes: '',
    googleMapsUrl: '',
    latitude: null,
    longitude: null,
    customerNotes: '',
  },
  items: [
    { product_id: '33333333-3333-4333-8333-333333333333', quantity: 1 },
  ],
  promotionCode: null,
  paymentMethod: 'cash_on_delivery',
  deliveryZone: 'inside_ramtha',
};

const testEnvironment = (name: string): string | undefined => ({
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-credential',
  TURNSTILE_SECRET_KEY: 'isolated-turnstile-secret',
  GUEST_ORDER_HASH_SECRET: 'isolated-hmac-secret-with-sufficient-entropy',
  TURNSTILE_ALLOWED_HOSTNAMES: 'nawasrah-store.pages.dev',
})[name];

function gatewayRequest(overrides: Record<string, unknown> = {}): Request {
  return new Request('https://project.supabase.co/functions/v1/submit-guest-order', {
    method: 'POST',
    headers: {
      origin: 'http://127.0.0.1:4174',
      'content-type': 'application/json',
      'x-forwarded-for': '198.51.100.4, 203.0.113.80',
    },
    body: JSON.stringify({ ...gatewayBody, ...overrides }),
  });
}

test('runtime gateway accepts valid Turnstile and returns one canonical order result', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/siteverify')) {
      return new Response(JSON.stringify(validVerification), { status: 200 });
    }
    if (url.endsWith('/authorize_guest_order_gateway')) {
      return new Response(JSON.stringify({
        allowed: true,
        reason: 'allowed',
        retry_after_seconds: 0,
        idempotent_replay: false,
      }), { status: 200 });
    }
    if (url.endsWith('/submit_guest_customer_order')) {
      return new Response(JSON.stringify({
        success: true,
        order_id: '44444444-4444-4444-8444-444444444444',
        order_number: 'WEB-SECURITY-001',
        subtotal: 1000,
        discount: 0,
        delivery_fee: 0,
        total: 1000,
        delivery_zone: 'inside_ramtha',
        payment_method: 'cash_on_delivery',
      }), { status: 200 });
    }
    if (url.endsWith('/finalize_guest_order_gateway')) {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected isolated URL: ${url}`);
  };

  const response = await handleGuestOrderRequest(gatewayRequest(), {
    getEnv: testEnvironment,
    fetchImpl,
  });
  const payload = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 200);
  assert.equal(payload.order_number, 'WEB-SECURITY-001');
  assert.equal(calls.filter((url) => url.includes('/siteverify')).length, 1);
  assert.equal(calls.filter((url) => url.endsWith('/submit_guest_customer_order')).length, 1);
  assert.equal(calls.filter((url) => url.endsWith('/finalize_guest_order_gateway')).length, 1);
});

test('runtime gateway accepts exactly 50 line items and preserves their variant identities', async () => {
  let submittedItems: unknown[] | null = null;
  const items = Array.from({length: 50}, (_, index) => ({
    product_id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, '0')}`,
    quantity: (index % 3) + 1,
  }));
  const response = await handleGuestOrderRequest(gatewayRequest({items}), {
    getEnv: testEnvironment,
    fetchImpl: async (input, init) => {
      const url = String(input);
      if (url.includes('/siteverify')) {
        return new Response(JSON.stringify(validVerification), {status: 200});
      }
      if (url.endsWith('/authorize_guest_order_gateway')) {
        return new Response(JSON.stringify({allowed: true}), {status: 200});
      }
      if (url.endsWith('/submit_guest_customer_order')) {
        submittedItems = (JSON.parse(String(init?.body)) as {p_items: unknown[]}).p_items;
        return new Response(JSON.stringify({
          success: true,
          order_id: '44444444-4444-4444-8444-444444444444',
          order_number: 'WEB-SECURITY-050',
        }), {status: 200});
      }
      return new Response(null, {status: 204});
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(submittedItems, items);
});

test('runtime gateway rejects 51 line items before Turnstile or database work', async () => {
  let networkCalls = 0;
  const response = await handleGuestOrderRequest(gatewayRequest({
    items: Array.from({length: 51}, (_, index) => ({
      product_id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, '0')}`,
      quantity: 1,
    })),
  }), {
    getEnv: testEnvironment,
    fetchImpl: async () => {
      networkCalls += 1;
      return new Response('{}', {status: 500});
    },
  });
  const payload = await response.json() as {code?: string; error?: string};
  assert.equal(response.status, 400);
  assert.equal(payload.code, 'too_many_line_items');
  assert.match(payload.error || '', /50 صنفًا/);
  assert.equal(networkCalls, 0);
});

test('runtime gateway rejects invalid or replayed Turnstile before every database RPC', async () => {
  for (const errorCode of ['invalid-input-response', 'timeout-or-duplicate']) {
    let databaseCalls = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('/siteverify')) {
        return new Response(JSON.stringify({
          success: false,
          'error-codes': [errorCode],
        }), { status: 200 });
      }
      databaseCalls += 1;
      return new Response('{}', { status: 500 });
    };
    const response = await handleGuestOrderRequest(gatewayRequest(), {
      getEnv: testEnvironment,
      fetchImpl,
    });
    assert.equal(response.status, 400);
    assert.equal(databaseCalls, 0);
  }
});

test('runtime gateway rejects a missing Turnstile token before every database RPC', async () => {
  let networkCalls = 0;
  const response = await handleGuestOrderRequest(
    gatewayRequest({ turnstileToken: '' }),
    {
      getEnv: testEnvironment,
      fetchImpl: async () => {
        networkCalls += 1;
        return new Response('{}', { status: 500 });
      },
    }
  );
  assert.equal(response.status, 400);
  assert.equal(networkCalls, 0);
  assert.match(await response.text(), /تعذر التحقق/);
});

test('runtime gateway rejects origin, malformed JSON and streaming oversized bodies', async () => {
  let networkCalls = 0;
  const dependencies = {
    getEnv: testEnvironment,
    fetchImpl: async () => {
      networkCalls += 1;
      return new Response('{}', { status: 500 });
    },
  };
  const invalidOrigin = await handleGuestOrderRequest(new Request(
    'https://project.supabase.co/functions/v1/submit-guest-order',
    {
      method: 'POST',
      headers: {
        origin: 'https://attacker.example',
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.80',
      },
      body: JSON.stringify(gatewayBody),
    }
  ), dependencies);
  assert.equal(invalidOrigin.status, 403);

  const malformed = await handleGuestOrderRequest(new Request(
    'https://project.supabase.co/functions/v1/submit-guest-order',
    {
      method: 'POST',
      headers: {
        origin: 'http://127.0.0.1:4174',
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.80',
      },
      body: '{malformed',
    }
  ), dependencies);
  assert.equal(malformed.status, 400);

  const oversized = await handleGuestOrderRequest(new Request(
    'https://project.supabase.co/functions/v1/submit-guest-order',
    {
      method: 'POST',
      headers: {
        origin: 'http://127.0.0.1:4174',
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.80',
      },
      body: JSON.stringify({value: 'x'.repeat(70 * 1024)}),
    }
  ), dependencies);
  assert.equal(oversized.status, 413);
  assert.equal(networkCalls, 0);
});

test('runtime gateway retry keeps the same idempotency key and canonical order', async () => {
  let authorizationCalls = 0;
  let orderCalls = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('/siteverify')) {
      return new Response(JSON.stringify(validVerification), { status: 200 });
    }
    if (url.endsWith('/authorize_guest_order_gateway')) {
      authorizationCalls += 1;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.p_idempotency_key, gatewayBody.idempotencyKey);
      return new Response(JSON.stringify({
        allowed: true,
        reason: 'allowed',
        idempotent_replay: authorizationCalls > 1,
      }), { status: 200 });
    }
    if (url.endsWith('/submit_guest_customer_order')) {
      orderCalls += 1;
      return new Response(JSON.stringify({
        success: true,
        order_id: '44444444-4444-4444-8444-444444444444',
        order_number: 'WEB-SECURITY-001',
        idempotent_replay: orderCalls > 1,
      }), { status: 200 });
    }
    return new Response(null, { status: 204 });
  };

  const responses = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await handleGuestOrderRequest(gatewayRequest(), {
      getEnv: testEnvironment,
      fetchImpl,
    });
    responses.push(await response.json() as Record<string, unknown>);
  }
  assert.deepEqual(
    responses.map((payload) => payload.order_id),
    [
      '44444444-4444-4444-8444-444444444444',
      '44444444-4444-4444-8444-444444444444',
    ]
  );
  assert.equal(authorizationCalls, 2);
  assert.equal(orderCalls, 2);
});
