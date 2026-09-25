import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { tsImport } from 'tsx/esm/api';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');
const bootstrapPath = path.join(here, 'bootstrap-isolated-supabase.mjs');
const cliPath = path.join(projectRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
const projectId = 'nawasrah-guest-gateway-http-test';
const databaseContainer = `supabase_db_${projectId}`;
const turnstileTestSecret = process.env.TURNSTILE_TEST_SECRET;
const guestOrderHashSecret = randomBytes(32).toString('hex');

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
const requestBody = ({ idempotencyKey, sessionId, phone, street = 'شارع الاختبار' }) => ({
  idempotencyKey,
  turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
  clientSessionId: sessionId,
  customer: {
    fullName: 'عميل اختبار أمني',
    phone,
    governorate: 'إربد',
    city: 'الرمثا',
    area: 'الحي الشرقي',
    street,
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

const requestV2Body = ({ idempotencyKey, sessionId, phone, street = 'شارع الاختبار' }) => ({
  ...requestBody({idempotencyKey, sessionId, phone, street}),
  contractVersion: 'phase3-customer-reservation-v2',
  items: [{
    commercial_line_kind: 'base_unit',
    product_id: '86000000-0000-4000-8600-000000000001',
    base_quantity: 1,
    expected_unit_price_in_minor_units: 1275,
  }],
  expectedQuote: {
    subtotalInMinorUnits: 1275,
    discountInMinorUnits: 0,
    deliveryFeeInMinorUnits: 0,
    totalInMinorUnits: 1275,
  },
});

const requestParcelV2Body = ({ idempotencyKey, sessionId, phone }) => ({
  ...requestBody({idempotencyKey, sessionId, phone}),
  contractVersion: 'phase3-customer-reservation-v2',
  items: [{
    commercial_line_kind: 'configurable_parcel',
    family_product_id: '86000000-0000-4000-8600-000000000003',
    parcel_configuration_id: '86000000-0000-4000-8600-000000000300',
    configuration_revision: 1,
    parcel_quantity: 1,
    expected_unit_price_in_minor_units: 5000,
    parcel_instances: [{
      instance_sequence: 1,
      components: [
        {product_id: '86000000-0000-4000-8600-000000000005', base_quantity: 2},
        {product_id: '86000000-0000-4000-8600-000000000004', base_quantity: 3},
      ],
    }],
  }],
  expectedQuote: {
    subtotalInMinorUnits: 5000,
    discountInMinorUnits: 0,
    deliveryFeeInMinorUnits: 0,
    totalInMinorUnits: 5000,
  },
});

const uuidFor = (group, sequence) =>
  `86000000-0000-4000-${group}-${String(sequence).padStart(12, '0')}`;

let isolatedProjectRoot;
try {
  const functionEnvironment = [
    `TURNSTILE_SECRET_KEY=${turnstileTestSecret}`,
    'TURNSTILE_TEST_MODE=true',
    'TURNSTILE_ALLOWED_HOSTNAMES=example.com',
    `GUEST_ORDER_HASH_SECRET=${guestOrderHashSecret}`,
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
      NAWASRAH_SKIP_REDUNDANT_DB_RESET: 'true',
      NAWASRAH_SUPABASE_EXCLUDE: 'realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,logflare,vector,supavisor',
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
  const serviceRoleKey = status.SERVICE_ROLE_KEY || status.service_role_key;
  if (!apiUrl || !anonKey || !serviceRoleKey) {
    throw new Error('The isolated API URL or API keys are missing.');
  }

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

  INSERT INTO public.products (
    id, sku, name_ar, category_id, unit_id, purchase_unit_id, sale_unit_id,
    units_per_purchase_unit, units_per_sale_unit,
    default_sale_price_in_minor_units, cost_price_in_minor_units,
    sale_price_in_minor_units, wholesale_price_in_minor_units,
    min_stock_level, is_active, is_flavor_master
  ) VALUES
    (
      '86000000-0000-4000-8600-000000000002', 'EDGE-HTTP-INACTIVE',
      'صنف اختبار غير نشط', v_category, v_unit, v_unit, v_unit,
      1, 1, 1275, 500, 1275, 1275, 1, false, false
    ),
    (
      '86000000-0000-4000-8600-000000000003', 'EDGE-HTTP-HIDDEN-MASTER',
      'مجموعة نكهات غير قابلة للبيع', v_category, v_unit, v_unit, v_unit,
      1, 1, 1275, 500, 1275, 1275, 1, true, true
    )
  ON CONFLICT (id) DO UPDATE SET
    is_active = EXCLUDED.is_active,
    is_flavor_master = EXCLUDED.is_flavor_master;

  UPDATE public.products
  SET units_per_sale_unit=5,
      default_sale_price_in_minor_units=5000,
      sale_price_in_minor_units=5000,
      wholesale_price_in_minor_units=5000,
      wac_cost_in_minor_units_exact=500.000000
  WHERE id='86000000-0000-4000-8600-000000000003';

  INSERT INTO public.products (
    id, sku, name_ar, category_id, flavor_master_product_id, flavor_name_ar,
    unit_id, purchase_unit_id, sale_unit_id,
    units_per_purchase_unit, units_per_sale_unit,
    default_sale_price_in_minor_units, cost_price_in_minor_units,
    sale_price_in_minor_units, wholesale_price_in_minor_units,
    min_stock_level, is_active, is_flavor_master, wac_cost_in_minor_units_exact
  ) VALUES
  (
    '86000000-0000-4000-8600-000000000004', 'EDGE-HTTP-FLAVOR-B',
    'نكهة اختبار ثانية', v_category,
    '86000000-0000-4000-8600-000000000003', 'نكهة ب',
    v_unit, v_unit, v_unit, 1, 1, 1275, 500, 1275, 1275,
    1, true, false, 500.000000
  ),
  (
    '86000000-0000-4000-8600-000000000005', 'EDGE-HTTP-FLAVOR-A',
    'نكهة اختبار أولى', v_category,
    '86000000-0000-4000-8600-000000000003', 'نكهة أ',
    v_unit, v_unit, v_unit, 1, 1, 1275, 500, 1275, 1275,
    1, true, false, 500.000000
  ) ON CONFLICT (id) DO UPDATE SET
    is_active=true,
    flavor_master_product_id='86000000-0000-4000-8600-000000000003',
    wac_cost_in_minor_units_exact=500.000000;

  INSERT INTO public.product_parcel_configurations (
    id, family_product_id, composition_mode, configuration_revision, is_active
  ) VALUES (
    '86000000-0000-4000-8600-000000000300',
    '86000000-0000-4000-8600-000000000003',
    'configurable_mix', 1, true
  ) ON CONFLICT (id) DO UPDATE SET
    composition_mode='configurable_mix', configuration_revision=1, is_active=true;

  INSERT INTO public.inventory_balances (
    warehouse_id, product_id, on_hand_quantity, reserved_quantity
  ) VALUES
    (v_warehouse, '86000000-0000-4000-8600-000000000001', 500, 0),
    (v_warehouse, '86000000-0000-4000-8600-000000000004', 500, 0),
    (v_warehouse, '86000000-0000-4000-8600-000000000005', 500, 0)
  ON CONFLICT (warehouse_id, product_id)
    DO UPDATE SET on_hand_quantity = 500, reserved_quantity = 0;

  UPDATE public.configurable_parcel_feature_settings
  SET feature_state='ENABLED', updated_at=NOW()
  WHERE feature_key='configurable_parcels';

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
  const { handleGuestOrderRequest } = await tsImport(
    pathToFileURL(path.join(
      projectRoot,
      'supabase',
      'functions',
      'submit-guest-order',
      'index.ts',
    )).href,
    import.meta.url,
  );
  const observedGatewayRequest = async (body) => {
    let authorizationEvidence = null;
    const gatewaySecurityEvents = [];
    const observedFetch = async (input, init) => {
      const target = String(input);
      if (target.includes('challenges.cloudflare.com/turnstile/v0/siteverify')) {
        return new Response(JSON.stringify({
          success: true,
          hostname: 'example.com',
          action: 'test',
          metadata: {result_with_testing_key: true},
        }), {status: 200, headers: {'content-type': 'application/json'}});
      }
      const response = await fetch(input, init);
      if (target.endsWith('/rest/v1/rpc/authorize_guest_order_gateway')) {
        authorizationEvidence = {
          status: response.status,
          body: await response.clone().text(),
        };
      }
      return response;
    };
    const originalConsoleInfo = console.info;
    console.info = (...args) => gatewaySecurityEvents.push(args);
    try {
      const response = await handleGuestOrderRequest(new Request(
        'http://127.0.0.1:4174/checkout',
        {
          method: 'POST',
          headers: {
            origin: 'http://127.0.0.1:4174',
            'content-type': 'application/json',
            'x-forwarded-for': '127.0.0.1',
          },
          body: JSON.stringify(body),
        },
      ), {
        getEnv: (name) => ({
          SUPABASE_URL: apiUrl,
          SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
          TURNSTILE_SECRET_KEY: turnstileTestSecret,
          TURNSTILE_TEST_MODE: 'true',
          TURNSTILE_ALLOWED_HOSTNAMES: 'example.com',
          GUEST_ORDER_HASH_SECRET: guestOrderHashSecret,
        })[name],
        fetchImpl: observedFetch,
      });
      return {
        status: response.status,
        payload: await response.json(),
        authorizationEvidence,
        gatewaySecurityEvents,
      };
    } finally {
      console.info = originalConsoleInfo;
    }
  };
  const businessStateForKey = (idempotencyKey) => sqlJson(`
    WITH target_orders AS (
      SELECT id,operation_id FROM public.orders
      WHERE idempotency_key='${idempotencyKey}'
    ), target_operations AS (
      SELECT id FROM public.business_operations
      WHERE idempotency_key='${idempotencyKey}'
        OR id IN (SELECT operation_id FROM target_orders)
    )
    SELECT json_build_object(
      'orders',(SELECT json_agg(to_jsonb(o) ORDER BY o.id) FROM public.orders o
        WHERE o.id IN (SELECT id FROM target_orders)),
      'items',(SELECT json_agg(to_jsonb(i) ORDER BY i.id) FROM public.order_items i
        WHERE i.order_id IN (SELECT id FROM target_orders)),
      'instances',(SELECT json_agg(to_jsonb(i) ORDER BY i.id)
        FROM public.order_parcel_instances i
        WHERE i.order_id IN (SELECT id FROM target_orders)),
      'components',(SELECT json_agg(to_jsonb(c) ORDER BY c.id)
        FROM public.order_parcel_components c
        WHERE c.operation_id IN (SELECT id FROM target_operations)),
      'reservations',(SELECT json_agg(to_jsonb(r) ORDER BY r.id)
        FROM public.order_inventory_reservations r
        WHERE r.order_id IN (SELECT id FROM target_orders)),
      'operations',(SELECT json_agg(to_jsonb(op) ORDER BY op.id)
        FROM public.business_operations op
        WHERE op.id IN (SELECT id FROM target_operations)),
      'movements',(SELECT json_agg(to_jsonb(m) ORDER BY m.id)
        FROM public.inventory_movements m
        WHERE m.operation_id IN (SELECT id FROM target_operations)
          OR m.reference_id IN (SELECT id FROM target_orders)),
      'balance',(SELECT json_build_object(
          'onHand',on_hand_quantity,'reserved',reserved_quantity,'updatedAt',updated_at
        ) FROM public.inventory_balances
        WHERE product_id='86000000-0000-4000-8600-000000000001'),
      'balances',(SELECT json_agg(json_build_object(
          'productId',product_id,'onHand',on_hand_quantity,
          'reserved',reserved_quantity,'updatedAt',updated_at
        ) ORDER BY product_id) FROM public.inventory_balances
        WHERE product_id IN (
          '86000000-0000-4000-8600-000000000001',
          '86000000-0000-4000-8600-000000000004',
          '86000000-0000-4000-8600-000000000005'
        )),
      'counts',json_build_object(
        'orders',(SELECT count(*) FROM public.orders),
        'items',(SELECT count(*) FROM public.order_items),
        'operations',(SELECT count(*) FROM public.business_operations),
        'instances',(SELECT count(*) FROM public.order_parcel_instances),
        'components',(SELECT count(*) FROM public.order_parcel_components),
        'reservations',(SELECT count(*) FROM public.order_inventory_reservations),
        'movements',(SELECT count(*) FROM public.inventory_movements),
        'payments',(SELECT count(*) FROM public.customer_payments)
      )
    );
  `);
  const throughDropAfterCommitProxy = async (body) => {
    let upstreamEvidence = null;
    const server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const forwarded = await rawGatewayRequest({
        body: Buffer.concat(chunks).toString('utf8'),
      });
      upstreamEvidence = forwarded;
      // The proxy has observed the successful real Gateway response, which is
      // downstream of the committed coordinator call. It deliberately drops
      // that response and exposes an ambiguous transport failure to the
      // simulated browser. No Production Gateway branch or flag is involved.
      response.writeHead(504, {'content-type': 'application/json'});
      response.end(JSON.stringify({code: 'simulated_transport_timeout'}));
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Drop proxy did not bind.');
      const response = await fetch(`http://127.0.0.1:${address.port}/checkout`, {
        method: 'POST',
        headers: {
          origin: 'http://127.0.0.1:4174',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(35_000),
      });
      return {
        browserStatus: response.status,
        browserPayload: await response.json(),
        upstreamEvidence,
      };
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  };

  const invalidProductRequest = requestBody({
    idempotencyKey: uuidFor('8601', 94),
    sessionId: uuidFor('8602', 94),
    phone: '0797000094',
  });
  invalidProductRequest.items = [{
    product_id: '86000000-0000-4000-8600-999999999999',
    quantity: 1,
  }];
  const inactiveProductRequest = requestBody({
    idempotencyKey: uuidFor('8601', 95),
    sessionId: uuidFor('8602', 95),
    phone: '0797000095',
  });
  inactiveProductRequest.items = [{
    product_id: '86000000-0000-4000-8600-000000000002',
    quantity: 1,
  }];
  const hiddenMasterRequest = requestBody({
    idempotencyKey: uuidFor('8601', 96),
    sessionId: uuidFor('8602', 96),
    phone: '0797000096',
  });
  hiddenMasterRequest.items = [{
    product_id: '86000000-0000-4000-8600-000000000003',
    quantity: 1,
  }];
  const overLineLimitRequest = requestBody({
    idempotencyKey: uuidFor('8601', 97),
    sessionId: uuidFor('8602', 97),
    phone: '0797000097',
  });
  overLineLimitRequest.items = Array.from({ length: 51 }, (_, index) => ({
    product_id: uuidFor('8699', index + 1),
    quantity: 1,
  }));

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
    await browserRequest(overLineLimitRequest),
    await browserRequest(invalidProductRequest),
    await browserRequest(inactiveProductRequest),
    await browserRequest(hiddenMasterRequest),
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
  if (baseline.orders !== 0 || baseline.customers !== 0 || baseline.reserved !== 0) {
    throw new Error(`Rejected checkout cases mutated business data: ${JSON.stringify(baseline)}`);
  }

  const firstKey = uuidFor('8601', 1);
  const firstBody = requestBody({
    idempotencyKey: firstKey,
    sessionId: uuidFor('8602', 1),
    phone: '0797000001',
    street: '',
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

  // Legacy V1 HTTP replay remains compatible on the full 001-119 database.
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
    'gateway_rows', (SELECT COUNT(*) FROM public.guest_order_gateway_requests WHERE idempotency_key='${firstKey}'),
    'stored_street', (
      SELECT ca.street
      FROM public.orders o
      JOIN public.customer_addresses ca ON ca.id = o.customer_address_id
      WHERE o.idempotency_key='${firstKey}'
    )
  ) FROM public.orders;`);
  if (
    replayReconciliation.orders !== 1 || replayReconciliation.customers !== 1 ||
    replayReconciliation.on_hand !== baseline.on_hand ||
    replayReconciliation.reserved !== baseline.reserved + 1 ||
    replayReconciliation.gateway_rows !== 1 || replayReconciliation.stored_street !== null
  ) {
    throw new Error(`Retry reconciliation failed: ${JSON.stringify(replayReconciliation)}`);
  }

  // M4: lose a real V2 Gateway response only after the upstream Gateway has
  // observed the successful coordinator result. The browser then retries the
  // exact business request through the real Gateway, causing a fresh
  // Turnstile verification and a read-only DB replay.
  await runSql('TRUNCATE public.guest_order_gateway_requests;');
  const timeoutKey = uuidFor('8605', 1);
  const timeoutBody = requestV2Body({
    idempotencyKey: timeoutKey,
    sessionId: uuidFor('8606', 1),
    phone: '0797300001',
  });
  const timeoutReservedBefore = Number(await runSql(
    "SELECT reserved_quantity FROM public.inventory_balances WHERE product_id='86000000-0000-4000-8600-000000000001';",
  ));
  const dropped = await throughDropAfterCommitProxy(timeoutBody);
  if (
    dropped.browserStatus !== 504 ||
    dropped.browserPayload.code !== 'simulated_transport_timeout' ||
    dropped.upstreamEvidence?.status !== 200 ||
    dropped.upstreamEvidence?.payload?.success !== true
  ) {
    throw new Error(`Timeout-after-commit proxy did not prove the commit boundary: ${JSON.stringify(dropped)}`);
  }
  const afterDroppedCommit = await businessStateForKey(timeoutKey);
  if (
    afterDroppedCommit.orders?.length !== 1 ||
    afterDroppedCommit.items?.length !== 1 ||
    afterDroppedCommit.operations?.length !== 1 ||
    afterDroppedCommit.reservations?.length !== 1 ||
    afterDroppedCommit.balance.reserved !== timeoutReservedBefore + 1
  ) {
    throw new Error(`Dropped-response transaction did not commit exactly once: ${JSON.stringify(afterDroppedCommit)}`);
  }
  const timeoutRetry = await browserRequest({
    ...timeoutBody,
    // The official Turnstile test token is reusable, but this is a new HTTP
    // request and therefore a fresh real siteverify invocation.
    turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
  });
  if (
    timeoutRetry.status !== 200 ||
    JSON.stringify(timeoutRetry.payload) !==
      JSON.stringify(dropped.upstreamEvidence.payload)
  ) {
    throw new Error(`V2 retry did not return the immutable committed result: ${JSON.stringify(timeoutRetry)}`);
  }
  const afterTimeoutRetry = await businessStateForKey(timeoutKey);
  if (JSON.stringify(afterTimeoutRetry) !== JSON.stringify(afterDroppedCommit)) {
    throw new Error('V2 timeout retry changed committed business state.');
  }

  // Repeat the same real Gateway -> real DB -> dropped-response proof with a
  // non-empty configurable Parcel.  Full before/after snapshots include IDs,
  // immutable operation evidence, child rows, balance timestamps and counts.
  await runSql('TRUNCATE public.guest_order_gateway_requests;');
  const parcelTimeoutKey = uuidFor('8605', 6);
  const parcelTimeoutBody = requestParcelV2Body({
    idempotencyKey: parcelTimeoutKey,
    sessionId: uuidFor('8606', 7),
    phone: '0797300007',
  });
  const parcelBalancesBefore = await sqlJson(`SELECT json_object_agg(
    product_id::text,json_build_object('onHand',on_hand_quantity,
      'reserved',reserved_quantity)
  ) FROM public.inventory_balances WHERE product_id IN (
    '86000000-0000-4000-8600-000000000005',
    '86000000-0000-4000-8600-000000000004'
  );`);
  const droppedParcel = await throughDropAfterCommitProxy(parcelTimeoutBody);
  if (
    droppedParcel.browserStatus !== 504 ||
    droppedParcel.browserPayload.code !== 'simulated_transport_timeout' ||
    droppedParcel.upstreamEvidence?.status !== 200 ||
    droppedParcel.upstreamEvidence?.payload?.success !== true
  ) {
    throw new Error(`Parcel timeout-after-commit boundary failed: ${JSON.stringify(droppedParcel)}`);
  }
  const afterParcelCommit = await businessStateForKey(parcelTimeoutKey);
  const parcelComponents = afterParcelCommit.components || [];
  const parcelReservations = afterParcelCommit.reservations || [];
  const parcelBalances = Object.fromEntries(
    (afterParcelCommit.balances || []).map((row) => [row.productId, row]),
  );
  const expectedParcelQuantities = {
    '86000000-0000-4000-8600-000000000005': 2,
    '86000000-0000-4000-8600-000000000004': 3,
  };
  if (
    afterParcelCommit.orders?.length !== 1 ||
    afterParcelCommit.items?.length !== 1 ||
    afterParcelCommit.operations?.length !== 1 ||
    afterParcelCommit.instances?.length !== 1 ||
    parcelComponents.length !== 2 || parcelReservations.length !== 2 ||
    afterParcelCommit.instances[0].instance_sequence !== 1
  ) {
    throw new Error(`Parcel commit cardinality mismatch: ${JSON.stringify(afterParcelCommit)}`);
  }
  for (const [productId, expectedQuantity] of Object.entries(expectedParcelQuantities)) {
    const component = parcelComponents.find((row) => row.product_id === productId);
    const reservation = parcelReservations.find((row) => row.product_id === productId);
    if (
      component?.base_quantity !== expectedQuantity ||
      reservation?.reserved_quantity !== expectedQuantity ||
      parcelBalances[productId]?.onHand !== parcelBalancesBefore[productId].onHand ||
      parcelBalances[productId]?.reserved !==
        parcelBalancesBefore[productId].reserved + expectedQuantity
    ) {
      throw new Error(`Parcel component/reservation mismatch for ${productId}.`);
    }
  }
  const parcelTimeoutRetry = await browserRequest({
    ...parcelTimeoutBody,
    turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
  });
  if (
    parcelTimeoutRetry.status !== 200 ||
    JSON.stringify(parcelTimeoutRetry.payload) !==
      JSON.stringify(droppedParcel.upstreamEvidence.payload)
  ) {
    throw new Error(`Parcel retry did not return the immutable result: ${JSON.stringify(parcelTimeoutRetry)}`);
  }
  const afterParcelRetry = await businessStateForKey(parcelTimeoutKey);
  if (JSON.stringify(afterParcelRetry) !== JSON.stringify(afterParcelCommit)) {
    throw new Error('Parcel retry performed a business or idempotency-metadata write.');
  }

  // Customer V1/V2 cross-version raw-key ownership through the actual HTTP
  // Gateway. A losing version must fail closed without business writes.
  await runSql('TRUNCATE public.guest_order_gateway_requests;');
  const v1WinsKey = uuidFor('8605', 2);
  const v1WinsBody = requestBody({
    idempotencyKey: v1WinsKey,
    sessionId: uuidFor('8606', 2),
    phone: '0797300002',
  });
  const v1Wins = await browserRequest(v1WinsBody);
  if (v1Wins.status !== 200 || v1Wins.payload.success !== true) {
    throw new Error(`V1-first setup failed: ${JSON.stringify(v1Wins)}`);
  }
  const v1WinsBeforeConflict = await businessStateForKey(v1WinsKey);
  const v2Loses = await browserRequest(requestV2Body({
    idempotencyKey: v1WinsKey,
    sessionId: uuidFor('8606', 2),
    phone: '0797300002',
  }));
  if (v2Loses.status !== 400 || v2Loses.payload.code !== 'order_rejected') {
    throw new Error(`V2 did not fail closed after V1 consumed the key: ${JSON.stringify(v2Loses)}`);
  }
  if (JSON.stringify(await businessStateForKey(v1WinsKey)) !== JSON.stringify(v1WinsBeforeConflict)) {
    throw new Error('V1-first/V2-conflict mutated business state.');
  }

  await runSql('TRUNCATE public.guest_order_gateway_requests;');
  const v2WinsKey = uuidFor('8605', 3);
  const v2WinsBody = requestV2Body({
    idempotencyKey: v2WinsKey,
    sessionId: uuidFor('8606', 3),
    phone: '0797300003',
  });
  const v2Wins = await browserRequest(v2WinsBody);
  if (v2Wins.status !== 200 || v2Wins.payload.success !== true) {
    throw new Error(`V2-first setup failed: ${JSON.stringify(v2Wins)}`);
  }
  const v2WinsBeforeConflict = await businessStateForKey(v2WinsKey);
  const v1Loses = await browserRequest(requestBody({
    idempotencyKey: v2WinsKey,
    sessionId: uuidFor('8606', 3),
    phone: '0797300003',
  }));
  if (v1Loses.status !== 400 || v1Loses.payload.code !== 'order_rejected') {
    throw new Error(`V1 did not fail closed after V2 consumed the key: ${JSON.stringify(v1Loses)}`);
  }
  if (JSON.stringify(await businessStateForKey(v2WinsKey)) !== JSON.stringify(v2WinsBeforeConflict)) {
    throw new Error('V2-first/V1-conflict mutated business state.');
  }

  await runSql('TRUNCATE public.guest_order_gateway_requests;');
  const raceKey = uuidFor('8605', 4);
  const raceSession = uuidFor('8606', 4);
  const racePhone = '0797300004';
  const raceResults = await Promise.all([
    browserRequest(requestBody({idempotencyKey: raceKey, sessionId: raceSession, phone: racePhone})),
    browserRequest(requestV2Body({idempotencyKey: raceKey, sessionId: raceSession, phone: racePhone})),
  ]);
  const raceSuccesses = raceResults.filter((entry) => entry.status === 200);
  const raceFailures = raceResults.filter((entry) => entry.status === 400);
  const raceState = await businessStateForKey(raceKey);
  if (
    raceSuccesses.length !== 1 || raceFailures.length !== 1 ||
    raceFailures[0].payload.code !== 'order_rejected' || raceState.orders?.length !== 1
  ) {
    throw new Error(`Concurrent V1/V2 same-key race was not single-effect: ${JSON.stringify({raceResults, raceState})}`);
  }

  await runSql('TRUNCATE public.guest_order_gateway_requests;');
  const privacyKey = uuidFor('8605', 5);
  const privacyWinner = await browserRequest(requestV2Body({
    idempotencyKey: privacyKey,
    sessionId: uuidFor('8606', 5),
    phone: '0797300005',
  }));
  if (privacyWinner.status !== 200) throw new Error('Privacy-collision setup failed.');
  const privacyBefore = await businessStateForKey(privacyKey);
  const privacyCollision = await observedGatewayRequest(requestV2Body({
    idempotencyKey: privacyKey,
    sessionId: uuidFor('8606', 6),
    phone: '0797300006',
  }));
  const privacyText = JSON.stringify(privacyCollision.payload);
  const authorizationBody = privacyCollision.authorizationEvidence?.body || '';
  const privacySafeRejection = privacyCollision.status === 503 &&
    privacyCollision.payload.code === 'gateway_unavailable' &&
    privacyCollision.authorizationEvidence?.status >= 400 &&
    authorizationBody.includes('Gateway retry context does not match.');
  if (
    !privacySafeRejection ||
    privacyText.includes(String(privacyWinner.payload.order_id)) ||
    privacyText.includes('0797300005')
  ) {
    throw new Error(`Cross-actor collision leaked protected identity: ${privacyText}`);
  }
  if (JSON.stringify(await businessStateForKey(privacyKey)) !== JSON.stringify(privacyBefore)) {
    throw new Error('Cross-actor collision mutated business state.');
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
    v2_timeout_after_commit: {
      upstream_gateway_status: dropped.upstreamEvidence.status,
      simulated_browser_status: dropped.browserStatus,
      immutable_retry_status: timeoutRetry.status,
      immutable_retry_same_order:
        timeoutRetry.payload.order_id === dropped.upstreamEvidence.payload.order_id,
      immutable_result_snapshot:
        JSON.stringify(timeoutRetry.payload) ===
          JSON.stringify(dropped.upstreamEvidence.payload),
      exact_single_effect: JSON.stringify(afterTimeoutRetry) === JSON.stringify(afterDroppedCommit),
    },
    parcel_v2_timeout_after_commit: {
      upstream_gateway_status: droppedParcel.upstreamEvidence.status,
      simulated_browser_status: droppedParcel.browserStatus,
      immutable_retry_status: parcelTimeoutRetry.status,
      immutable_retry_same_order:
        parcelTimeoutRetry.payload.order_id === droppedParcel.upstreamEvidence.payload.order_id,
      instance_count: afterParcelCommit.instances.length,
      component_count: parcelComponents.length,
      reservation_count: parcelReservations.length,
      exact_single_effect: JSON.stringify(afterParcelRetry) === JSON.stringify(afterParcelCommit),
    },
    customer_cross_version: {
      v1_wins_v2_conflicts_zero_write: true,
      v2_wins_v1_conflicts_zero_write: true,
      simultaneous_single_order: raceState.orders?.length === 1,
      simultaneous_successes: raceSuccesses.length,
      different_actor_privacy_safe: true,
      different_actor_internal_cause:
        authorizationBody.includes('Gateway retry context does not match.'),
    },
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
