import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');
const bootstrapPath = path.join(here, 'bootstrap-isolated-supabase.mjs');
const cliPath = path.join(projectRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
const projectId = 'nawasrah-guest-gateway-http-test';
const databaseContainer = `supabase_db_${projectId}`;
const turnstileTestSecret = process.env.TURNSTILE_TEST_SECRET;

if (!turnstileTestSecret) {
  throw new Error('TURNSTILE_TEST_SECRET is required for the isolated HTTP test.');
}

const runSql = (sql) => new Promise((resolve, reject) => {
  const child = spawn('docker', [
    'exec', '-i', databaseContainer, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A',
  ], {
    cwd: projectRoot,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (code) => {
    if (code === 0) resolve(stdout.trim());
    else reject(new Error(`Isolated SQL failed (exit ${code}): ${stderr.trim()}`));
  });
  child.stdin.end(sql);
});

const sqlJson = async (sql) => JSON.parse(await runSql(sql));
const requestBody = ({ idempotencyKey, sessionId, phone }) => ({
  idempotencyKey,
  turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
  clientSessionId: sessionId,
  customer: {
    fullName: 'عميل اختبار أمني',
    phone,
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
  items: [{
    product_id: '86000000-0000-4000-8600-000000000001',
    quantity: 1,
  }],
  promotionCode: null,
  paymentMethod: 'cash_on_delivery',
  deliveryZone: 'inside_ramtha',
});

const uuidFor = (group, sequence) =>
  `86000000-0000-4000-${group}-${String(sequence).padStart(12, '0')}`;

let isolatedProjectRoot;
try {
  const functionEnvironment = [
    `TURNSTILE_SECRET_KEY=${turnstileTestSecret}`,
    'TURNSTILE_TEST_MODE=true',
    'TURNSTILE_ALLOWED_HOSTNAMES=example.com',
    `GUEST_ORDER_HASH_SECRET=${randomBytes(32).toString('hex')}`,
    '',
  ].join('\n');
  const { stdout } = await execFileAsync(process.execPath, [bootstrapPath], {
    cwd: projectRoot,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      NAWASRAH_ISOLATED_PROJECT_ID: projectId,
      NAWASRAH_FUNCTION_ENV_FILE_CONTENT: functionEnvironment,
    },
  });
  const bootstrap = JSON.parse(stdout);
  isolatedProjectRoot = bootstrap.isolatedProjectRoot;

  const { stdout: statusOutput } = await execFileAsync(process.execPath, [
    cliPath, 'status', '-o', 'json', '--workdir', isolatedProjectRoot,
  ], {
    cwd: projectRoot,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  const status = JSON.parse(statusOutput);
  const apiUrl = status.API_URL || status.api_url;
  const anonKey = status.ANON_KEY || status.anon_key;
  if (!apiUrl || !anonKey) throw new Error('The isolated API URL or anon key is missing.');

  await runSql(`
DO $$
DECLARE
  v_category UUID;
  v_unit UUID;
  v_warehouse UUID;
BEGIN
  SELECT id INTO v_category FROM public.categories ORDER BY created_at, id LIMIT 1;
  SELECT id INTO v_unit FROM public.units ORDER BY created_at, id LIMIT 1;
  SELECT id INTO v_warehouse FROM public.warehouses WHERE is_active ORDER BY created_at, id LIMIT 1;
  IF v_category IS NULL OR v_unit IS NULL OR v_warehouse IS NULL THEN
    RAISE EXCEPTION 'The isolated catalog seed is incomplete.';
  END IF;

  INSERT INTO public.products (
    id, sku, name_ar, category_id, unit_id, purchase_unit_id, sale_unit_id,
    units_per_purchase_unit, units_per_sale_unit,
    default_sale_price_in_minor_units, cost_price_in_minor_units,
    sale_price_in_minor_units, wholesale_price_in_minor_units,
    min_stock_level, is_active, is_flavor_master
  ) VALUES (
    '86000000-0000-4000-8600-000000000001', 'EDGE-HTTP-SECURITY',
    'صنف اختبار بوابة الطلبات', v_category, v_unit, v_unit, v_unit,
    1, 1, 1275, 500, 1275, 1275, 1, true, false
  ) ON CONFLICT (id) DO UPDATE SET is_active = true;

  INSERT INTO public.inventory_balances (
    warehouse_id, product_id, on_hand_quantity, reserved_quantity
  ) VALUES (
    v_warehouse, '86000000-0000-4000-8600-000000000001', 500, 0
  ) ON CONFLICT (warehouse_id, product_id)
    DO UPDATE SET on_hand_quantity = 500, reserved_quantity = 0;

  UPDATE public.storefront_settings
  SET orders_enabled = true,
      minimum_order_in_minor_units = 0,
      inside_ramtha_delivery_fee_in_minor_units = 0,
      outside_ramtha_delivery_fee_in_minor_units = 0
  WHERE id = '00000000-0000-0000-0000-000000000001';
END $$;
TRUNCATE public.guest_order_gateway_requests;
  `);

  const gatewayUrl = `${apiUrl}/functions/v1/submit-guest-order`;
  const rawGatewayRequest = async ({
    body,
    origin = 'http://127.0.0.1:4174',
    extraHeaders = {},
  }) => {
    let response;
    try {
      response = await fetch(gatewayUrl, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          origin,
          'content-type': 'application/json',
          'x-client-info': 'nawasrah-customer-web-security-review',
          ...extraHeaders,
        },
        body,
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      return { status: 0, payload: { code: 'transport_rejected' } };
    }
    let payload = {};
    try { payload = await response.json(); } catch { /* response assertions follow */ }
    return { status: response.status, payload };
  };
  const browserRequest = (body, extraHeaders = {}) => rawGatewayRequest({
    body: JSON.stringify(body),
    extraHeaders,
  });

  const rejectedInputs = [
    await rawGatewayRequest({ body: '{}', origin: 'https://attacker.example' }),
    await rawGatewayRequest({ body: '{malformed' }),
    await rawGatewayRequest({ body: JSON.stringify({ large: 'x'.repeat(70 * 1024) }) }),
    await browserRequest(requestBody({
      idempotencyKey: 'invalid-idempotency-key',
      sessionId: uuidFor('8602', 90),
      phone: '0797000090',
    })),
    await browserRequest(requestBody({
      idempotencyKey: uuidFor('8601', 91),
      sessionId: 'invalid-session-id',
      phone: '0797000091',
    })),
    await browserRequest(requestBody({
      idempotencyKey: uuidFor('8601', 92),
      sessionId: uuidFor('8602', 92),
      phone: '123',
    })),
    await browserRequest({
      ...requestBody({
        idempotencyKey: uuidFor('8601', 93),
        sessionId: uuidFor('8602', 93),
        phone: '0797000093',
      }),
      items: [{
        product_id: '86000000-0000-4000-8600-000000000001',
        quantity: 0,
      }],
    }),
  ];
  if (rejectedInputs.some(({ status }) => status !== 0 && (status < 400 || status >= 500))) {
    throw new Error(`Request validation did not fail safely: ${JSON.stringify(
      rejectedInputs.map(({ status }) => status),
    )}`);
  }

  const baseline = await sqlJson(`SELECT json_build_object(
    'orders', COUNT(*) FILTER (WHERE source = 'website'),
    'customers', (SELECT COUNT(*) FROM public.customers WHERE phone = '0797000001'),
    'on_hand', (SELECT on_hand_quantity FROM public.inventory_balances WHERE product_id='86000000-0000-4000-8600-000000000001'),
    'reserved', (SELECT reserved_quantity FROM public.inventory_balances WHERE product_id='86000000-0000-4000-8600-000000000001')
  ) FROM public.orders;`);

  const firstKey = uuidFor('8601', 1);
  const firstBody = requestBody({
    idempotencyKey: firstKey,
    sessionId: uuidFor('8602', 1),
    phone: '0797000001',
  });
  Object.assign(firstBody, {
    productPrice: 1,
    deliveryFee: 1,
    discount: 999999,
    subtotal: 1,
    unexpectedField: 'ignored',
  });
  firstBody.items[0].price = 1;
  firstBody.items[0].discount = 999999;
  const first = await browserRequest(firstBody);
  if (first.status !== 200 || first.payload.success !== true) {
    throw new Error(
      `Browser-equivalent request failed with HTTP ${first.status} (${String(first.payload.code || 'unknown')}).`,
    );
  }
  if (
    first.payload.subtotal !== 1275 || first.payload.total !== 1275 ||
    first.payload.discount !== 0 || first.payload.delivery_fee !== 0
  ) {
    throw new Error(`Caller-controlled pricing affected the receipt: ${JSON.stringify(first.payload)}`);
  }

  // Simulate a response lost after commit, then retry the same logical order.
  const retry = await browserRequest(firstBody);
  if (
    retry.status !== 200 || retry.payload.order_id !== first.payload.order_id ||
    retry.payload.idempotent_replay !== true
  ) {
    throw new Error('The committed order was not recoverable as one receipt after retry.');
  }

  const replayReconciliation = await sqlJson(`SELECT json_build_object(
    'orders', COUNT(*) FILTER (WHERE idempotency_key = '${firstKey}'),
    'customers', (SELECT COUNT(*) FROM public.customers WHERE phone = '0797000001'),
    'on_hand', (SELECT on_hand_quantity FROM public.inventory_balances WHERE product_id='86000000-0000-4000-8600-000000000001'),
    'reserved', (SELECT reserved_quantity FROM public.inventory_balances WHERE product_id='86000000-0000-4000-8600-000000000001'),
    'gateway_rows', (SELECT COUNT(*) FROM public.guest_order_gateway_requests WHERE idempotency_key='${firstKey}')
  ) FROM public.orders;`);
  if (
    replayReconciliation.orders !== 1 || replayReconciliation.customers !== 1 ||
    replayReconciliation.on_hand !== baseline.on_hand ||
    replayReconciliation.reserved !== baseline.reserved + 1 ||
    replayReconciliation.gateway_rows !== 1
  ) {
    throw new Error(`Retry reconciliation failed: ${JSON.stringify(replayReconciliation)}`);
  }

  await runSql('TRUNCATE public.guest_order_gateway_requests;');
  const doubleClickKey = uuidFor('8603', 1);
  const doubleClickBody = requestBody({
    idempotencyKey: doubleClickKey,
    sessionId: uuidFor('8604', 1),
    phone: '0797000002',
  });
  const doubleClickReservedBefore = Number(await runSql(
    "SELECT reserved_quantity FROM public.inventory_balances WHERE product_id='86000000-0000-4000-8600-000000000001';"
  ));
  const doubleClick = await Promise.all([
    browserRequest(doubleClickBody),
    browserRequest(doubleClickBody),
  ]);
  const doubleClickReconciliation = await sqlJson(`SELECT json_build_object(
    'orders', COUNT(*) FILTER (WHERE idempotency_key='${doubleClickKey}'),
    'reserved_delta', (SELECT reserved_quantity FROM public.inventory_balances WHERE product_id='86000000-0000-4000-8600-000000000001') - ${doubleClickReservedBefore},
    'gateway_rows', (SELECT COUNT(*) FROM public.guest_order_gateway_requests WHERE idempotency_key='${doubleClickKey}')
  ) FROM public.orders;`);
  if (
    doubleClick.some(({ status }) => status !== 200) ||
    new Set(doubleClick.map(({ payload }) => payload.order_id)).size !== 1 ||
    doubleClickReconciliation.orders !== 1 ||
    doubleClickReconciliation.reserved_delta !== 1 ||
    doubleClickReconciliation.gateway_rows !== 1
  ) {
    throw new Error(`Concurrent identical request failed: ${JSON.stringify(doubleClickReconciliation)}`);
  }

  // Probe every caller-controlled forwarding header through the real local gateway.
  await runSql('TRUNCATE public.guest_order_gateway_requests;');
  const spoofResponses = await Promise.all(Array.from({ length: 10 }, (_, index) =>
    browserRequest(requestBody({
      idempotencyKey: uuidFor('8610', index + 1),
      sessionId: uuidFor('8611', index + 1),
      phone: `07971${String(index + 1).padStart(5, '0')}`,
    }), {
      'cf-connecting-ip': `198.51.100.${index + 1}`,
      'x-real-ip': `192.0.2.${index + 1}`,
      forwarded: `for=203.0.113.${index + 1}`,
      'x-forwarded-for': `198.18.0.${index + 1}`,
    })
  ));
  const spoofIdentityCount = Number(await runSql(
    'SELECT COUNT(DISTINCT ip_hash) FROM public.guest_order_gateway_requests;'
  ));

  await runSql('TRUNCATE public.guest_order_gateway_requests;');
  const ordersBeforeAbuse = Number(await runSql(
    "SELECT COUNT(*) FROM public.orders WHERE source='website';"
  ));
  const customersBeforeAbuse = Number(await runSql(
    "SELECT COUNT(*) FROM public.customers;"
  ));
  const onHandBeforeAbuse = Number(await runSql(
    "SELECT on_hand_quantity FROM public.inventory_balances WHERE product_id='86000000-0000-4000-8600-000000000001';"
  ));
  const reservedBeforeAbuse = Number(await runSql(
    "SELECT reserved_quantity FROM public.inventory_balances WHERE product_id='86000000-0000-4000-8600-000000000001';"
  ));
  const concurrent = await Promise.all(Array.from({ length: 50 }, (_, index) =>
    browserRequest(requestBody({
      idempotencyKey: uuidFor('8620', index + 1),
      sessionId: uuidFor('8621', index + 1),
      phone: `07972${String(index + 1).padStart(5, '0')}`,
    }))
  ));
  const concurrentAllowed = concurrent.filter(({ status }) => status === 200).length;
  const concurrentLimited = concurrent.filter(({ status }) => status === 429).length;
  const abuseReconciliation = await sqlJson(`SELECT json_build_object(
    'orders_delta', (SELECT COUNT(*) FROM public.orders WHERE source='website') - ${ordersBeforeAbuse},
    'customers_delta', (SELECT COUNT(*) FROM public.customers) - ${customersBeforeAbuse},
    'on_hand_delta', (SELECT on_hand_quantity FROM public.inventory_balances WHERE product_id='86000000-0000-4000-8600-000000000001') - ${onHandBeforeAbuse},
    'reserved_delta', (SELECT reserved_quantity FROM public.inventory_balances WHERE product_id='86000000-0000-4000-8600-000000000001') - ${reservedBeforeAbuse},
    'gateway_rows', (SELECT COUNT(*) FROM public.guest_order_gateway_requests),
    'allowed_rows', (SELECT COUNT(*) FROM public.guest_order_gateway_requests WHERE decision='allowed'),
    'limited_rows', (SELECT COUNT(*) FROM public.guest_order_gateway_requests WHERE decision='rate_limited')
  );`);
  if (
    concurrentAllowed !== 6 || concurrentLimited !== 44 ||
    abuseReconciliation.orders_delta !== 6 || abuseReconciliation.customers_delta !== 6 ||
    abuseReconciliation.on_hand_delta !== 0 || abuseReconciliation.reserved_delta !== 6 ||
    abuseReconciliation.gateway_rows !== 50 || abuseReconciliation.allowed_rows !== 6 ||
    abuseReconciliation.limited_rows !== 44
  ) {
    throw new Error(`50-request reconciliation failed: ${JSON.stringify({
      concurrentAllowed, concurrentLimited, abuseReconciliation,
    })}`);
  }

  console.log(JSON.stringify({
    ok: spoofIdentityCount === 1,
    browser_gateway_status: first.status,
    retry_status: retry.status,
    retry_same_order: retry.payload.order_id === first.payload.order_id,
    retry_reconciliation: replayReconciliation,
    validation_http_statuses: rejectedInputs.map(({ status }) => status),
    server_authoritative_pricing: true,
    double_click_requests: doubleClick.length,
    double_click_same_order: new Set(doubleClick.map(({ payload }) => payload.order_id)).size === 1,
    double_click_reconciliation: doubleClickReconciliation,
    spoof_requests: spoofResponses.length,
    spoof_http_statuses: [...new Set(spoofResponses.map(({ status }) => status))],
    spoof_distinct_ip_identities: spoofIdentityCount,
    concurrent_requests: concurrent.length,
    concurrent_allowed: concurrentAllowed,
    concurrent_rate_limited: concurrentLimited,
    concurrent_reconciliation: abuseReconciliation,
  }, null, 2));

  if (spoofIdentityCount !== 1) {
    throw new Error(`Caller-controlled headers produced ${spoofIdentityCount} IP identities.`);
  }
} finally {
  if (isolatedProjectRoot) {
    await execFileAsync(process.execPath, [
      cliPath, 'stop', '--no-backup', '--workdir', isolatedProjectRoot,
    ], {
      cwd: projectRoot,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }).catch(() => undefined);
  }
}
