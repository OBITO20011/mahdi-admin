import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { isExpectedGatewayReadinessRejection } from './gateway-readiness-contract.mjs';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');
const bootstrapPath = path.join(here, 'bootstrap-isolated-supabase.mjs');
const cliPath = path.join(projectRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
const projectId = 'nawasrah-m10-browser-e2e-test';
const databaseContainer = `supabase_db_${projectId}`;
const publicSupabaseUrl = 'https://m10-test.supabase.co';
const vitePort = 4174;
const testSiteKey = '1x00000000000000000000AA';
const testSecret = process.env.TURNSTILE_TEST_SECRET;
const fixtureProductIds = [
  '8a000000-0000-4000-8a00-000000000001',
  '8a000000-0000-4000-8a00-000000000010',
  '8a000000-0000-4000-8a00-000000000011',
  '8a000000-0000-4000-8a00-000000000012',
];

if (!testSecret) {
  throw new Error('TURNSTILE_TEST_SECRET is required for the isolated M10 browser E2E test.');
}

const runSql = (sql) => new Promise((resolve, reject) => {
  const child = spawn('docker', [
    'exec', '-i', databaseContainer, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A',
  ], { cwd: projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (code) => code === 0
    ? resolve(stdout.trim())
    : reject(new Error(`M10 isolated SQL failed: ${stderr.trim()}`)));
  child.stdin.end(sql);
});

const waitForHttp = async (url) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch (error) {
      if (attempt === 59) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}.`);
};

const waitForGatewayTurnstileReadiness = async (apiUrl, anonKey) => {
  let consecutiveSuccesses = 0;
  let lastError = 'no readiness response';
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${apiUrl}/functions/v1/submit-guest-order`, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          authorization: `Bearer ${anonKey}`,
          'content-type': 'application/json',
          origin: `http://127.0.0.1:${vitePort}`,
          // RFC 5737 documentation-only addresses keep readiness probes out of
          // the browser scenario's localhost rate-limit bucket.
          'x-forwarded-for': `192.0.2.${attempt + 1}`,
        },
        body: JSON.stringify({
          contractVersion: 'phase3-customer-reservation-v2',
          idempotencyKey: crypto.randomUUID(),
          clientSessionId: crypto.randomUUID(),
          turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
          customer: {
            fullName: 'M10 readiness probe',
            phone: `0798${String(attempt).padStart(6, '0')}`,
            governorate: 'Irbid',
            city: 'Ramtha',
            area: 'test',
            street: 'test',
          },
          items: [],
          paymentMethod: 'cash_on_delivery',
          deliveryZone: 'inside_ramtha',
          expectedQuote: {
            subtotalInMinorUnits: 0,
            discountInMinorUnits: 0,
            deliveryFeeInMinorUnits: 0,
            totalInMinorUnits: 0,
          },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const result = await response.json();
      // The deliberately empty order must fail after Turnstile and before any
      // business transaction at the exact order-validation boundary. Generic
      // auth, rate-limit, malformed, and 5xx responses do not prove readiness.
      if (!isExpectedGatewayReadinessRejection(response, result)) {
        throw new Error(
          `Unexpected readiness response: HTTP ${response.status}, code ${String(result?.code || 'missing')}.`
        );
      }
      consecutiveSuccesses += 1;
      if (consecutiveSuccesses === 3) return;
    } catch (error) {
      consecutiveSuccesses = 0;
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Turnstile was not stable through the isolated Gateway: ${lastError}`);
};

const assertPublicCatalogFixtures = async (apiUrl, anonKey) => {
  const response = await fetch(`${apiUrl}/rest/v1/rpc/get_public_storefront_catalog_page`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      p_limit: 48,
      p_offset: 0,
      p_product_ids: fixtureProductIds,
    }),
  });
  if (!response.ok) {
    throw new Error(`M10 catalog fixture preflight failed with HTTP ${response.status}.`);
  }
  const payload = await response.json();
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const visibleIds = new Set(items.map((item) => item?.id).filter(Boolean));
  const missing = fixtureProductIds.filter((id) => !visibleIds.has(id));
  const stocked = new Map(items.map((item) => [item?.id, item?.availableQuantity]));
  const wrongStock = [
    [fixtureProductIds[0], 10],
    [fixtureProductIds[2], 20],
    [fixtureProductIds[3], 20],
  ].filter(([id, expected]) => stocked.get(id) !== expected);
  if (missing.length > 0 || wrongStock.length > 0) {
    throw new Error(
      `M10 catalog fixture preflight failed: selected sale unit PKT; ` +
      `missing product IDs=${missing.join(',') || 'none'}; ` +
      `stock mismatches=${wrongStock.map(([id, expected]) => `${id}:expected-${expected}:actual-${stocked.get(id) ?? 'absent'}`).join(',') || 'none'}.`
    );
  }
};

let isolatedProjectRoot;
let vite;
try {
  const functionEnvironment = [
    `TURNSTILE_SECRET_KEY=${testSecret}`,
    'TURNSTILE_TEST_MODE=true',
    // Cloudflare's official dummy widget reports example.com in current
    // Siteverify responses; localhost is retained for older dummy responses.
    'TURNSTILE_ALLOWED_HOSTNAMES=example.com,localhost',
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
  ], { cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024 });
  const status = JSON.parse(statusOutput);
  const apiUrl = status.API_URL || status.api_url;
  const anonKey = status.ANON_KEY || status.anon_key;
  if (!apiUrl || !anonKey) throw new Error('M10 isolated Supabase public configuration is missing.');

  await runSql(`
DO $$
DECLARE v_category UUID; v_unit UUID; v_warehouse UUID;
BEGIN
  SELECT id INTO v_category FROM public.categories ORDER BY created_at, id LIMIT 1;
  SELECT id INTO v_unit FROM public.units WHERE code = 'PKT' LIMIT 1;
  SELECT id INTO v_warehouse FROM public.warehouses WHERE is_active ORDER BY created_at, id LIMIT 1;
  IF v_category IS NULL OR v_unit IS NULL OR v_warehouse IS NULL THEN
    RAISE EXCEPTION 'M10 seed prerequisites are missing (active category, PKT unit, or active warehouse).';
  END IF;
  INSERT INTO public.products (
    id, sku, name_ar, category_id, unit_id, purchase_unit_id, sale_unit_id,
    units_per_purchase_unit, units_per_sale_unit,
    default_sale_price_in_minor_units, cost_price_in_minor_units,
    sale_price_in_minor_units, wholesale_price_in_minor_units,
    min_stock_level, is_active, is_flavor_master
  ) VALUES (
    '8a000000-0000-4000-8a00-000000000001', 'M10-CHECKOUT-001', 'صنف اختبار M10',
    v_category, v_unit, v_unit, v_unit, 1, 1, 1275, 500, 1275, 1275, 1, true, false
  ) ON CONFLICT (id) DO UPDATE SET
    category_id=EXCLUDED.category_id, unit_id=EXCLUDED.unit_id,
    purchase_unit_id=EXCLUDED.purchase_unit_id, sale_unit_id=EXCLUDED.sale_unit_id,
    units_per_purchase_unit=EXCLUDED.units_per_purchase_unit,
    units_per_sale_unit=EXCLUDED.units_per_sale_unit,
    default_sale_price_in_minor_units=EXCLUDED.default_sale_price_in_minor_units,
    sale_price_in_minor_units=EXCLUDED.sale_price_in_minor_units,
    wholesale_price_in_minor_units=EXCLUDED.wholesale_price_in_minor_units,
    is_active=true;
  INSERT INTO public.inventory_balances (warehouse_id, product_id, on_hand_quantity, reserved_quantity)
  VALUES (v_warehouse, '8a000000-0000-4000-8a00-000000000001', 10, 0)
  ON CONFLICT (warehouse_id, product_id) DO UPDATE SET on_hand_quantity = 10, reserved_quantity = 0;

  INSERT INTO public.products (
    id, sku, name_ar, category_id, unit_id, purchase_unit_id, sale_unit_id,
    units_per_purchase_unit, units_per_sale_unit,
    default_sale_price_in_minor_units, cost_price_in_minor_units,
    sale_price_in_minor_units, wholesale_price_in_minor_units,
    min_stock_level, is_active, is_flavor_master, wac_cost_in_minor_units_exact
  ) VALUES (
    '8a000000-0000-4000-8a00-000000000010', 'M10-MIX-FAMILY', 'مجموعة نكهات غير قابلة للبيع',
    v_category, v_unit, v_unit, v_unit, 5, 5, 5000, 500, 1000, 5000, 1, true, true, 500.000000
  ) ON CONFLICT (id) DO UPDATE SET
    category_id=EXCLUDED.category_id, unit_id=EXCLUDED.unit_id,
    purchase_unit_id=EXCLUDED.purchase_unit_id, sale_unit_id=EXCLUDED.sale_unit_id,
    units_per_purchase_unit=EXCLUDED.units_per_purchase_unit,
    units_per_sale_unit=EXCLUDED.units_per_sale_unit,
    default_sale_price_in_minor_units=EXCLUDED.default_sale_price_in_minor_units,
    sale_price_in_minor_units=EXCLUDED.sale_price_in_minor_units,
    wholesale_price_in_minor_units=EXCLUDED.wholesale_price_in_minor_units,
    is_active=true, is_flavor_master=true;
  INSERT INTO public.products (
    id, sku, name_ar, category_id, flavor_master_product_id, flavor_name_ar,
    unit_id, purchase_unit_id, sale_unit_id, units_per_purchase_unit, units_per_sale_unit,
    default_sale_price_in_minor_units, cost_price_in_minor_units,
    sale_price_in_minor_units, wholesale_price_in_minor_units,
    min_stock_level, is_active, is_flavor_master, wac_cost_in_minor_units_exact
  ) VALUES
    ('8a000000-0000-4000-8a00-000000000011', 'M10-MIX-A', 'نكهة اختبار أولى', v_category,
      '8a000000-0000-4000-8a00-000000000010', 'نكهة أ', v_unit, v_unit, v_unit, 1, 1,
      1000, 500, 1000, 1000, 1, true, false, 500.000000),
    ('8a000000-0000-4000-8a00-000000000012', 'M10-MIX-B', 'نكهة اختبار ثانية', v_category,
      '8a000000-0000-4000-8a00-000000000010', 'نكهة ب', v_unit, v_unit, v_unit, 1, 1,
      1000, 500, 1000, 1000, 1, true, false, 500.000000)
  ON CONFLICT (id) DO UPDATE SET
    category_id=EXCLUDED.category_id,
    flavor_master_product_id='8a000000-0000-4000-8a00-000000000010',
    unit_id=EXCLUDED.unit_id, purchase_unit_id=EXCLUDED.purchase_unit_id,
    sale_unit_id=EXCLUDED.sale_unit_id,
    units_per_purchase_unit=EXCLUDED.units_per_purchase_unit,
    units_per_sale_unit=EXCLUDED.units_per_sale_unit,
    default_sale_price_in_minor_units=EXCLUDED.default_sale_price_in_minor_units,
    sale_price_in_minor_units=EXCLUDED.sale_price_in_minor_units,
    wholesale_price_in_minor_units=EXCLUDED.wholesale_price_in_minor_units,
    is_active=true, is_flavor_master=false;
  INSERT INTO public.product_parcel_configurations (
    id, family_product_id, composition_mode, configuration_revision, is_active
  ) VALUES (
    '8a000000-0000-4000-8a00-000000000300',
    '8a000000-0000-4000-8a00-000000000010', 'configurable_mix', 1, true
  ) ON CONFLICT (id) DO UPDATE SET composition_mode='configurable_mix', configuration_revision=1, is_active=true;
  INSERT INTO public.inventory_balances (warehouse_id, product_id, on_hand_quantity, reserved_quantity)
  VALUES
    (v_warehouse, '8a000000-0000-4000-8a00-000000000011', 20, 0),
    (v_warehouse, '8a000000-0000-4000-8a00-000000000012', 20, 0)
  ON CONFLICT (warehouse_id, product_id) DO UPDATE SET on_hand_quantity=20, reserved_quantity=0;
  UPDATE public.configurable_parcel_feature_settings
  SET feature_state='ENABLED', updated_at=NOW()
  WHERE feature_key='configurable_parcels';
  UPDATE public.storefront_settings SET orders_enabled=true, minimum_order_in_minor_units=0,
    inside_ramtha_delivery_fee_in_minor_units=0, outside_ramtha_delivery_fee_in_minor_units=0
  WHERE id='00000000-0000-0000-0000-000000000001';
END $$;
  `);

  await assertPublicCatalogFixtures(apiUrl, anonKey);
  await waitForGatewayTurnstileReadiness(apiUrl, anonKey);

  vite = spawn(process.execPath, [
    path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
    '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort',
  ], {
    cwd: path.join(projectRoot, 'customer-web'),
    windowsHide: true,
    env: {
      ...process.env,
      VITE_SUPABASE_URL: publicSupabaseUrl,
      VITE_SUPABASE_PUBLISHABLE_KEY: anonKey,
      VITE_TURNSTILE_SITE_KEY: testSiteKey,
    },
    stdio: 'ignore',
  });
  await waitForHttp(`http://127.0.0.1:${vitePort}`);

  await execFileAsync(process.execPath, [
    path.join(projectRoot, 'node_modules', 'playwright', 'cli.js'),
    'test', 'e2e/customer-checkout-isolated.spec.ts',
    '--project=desktop-chromium', '--project=mobile-webkit', '--workers=1',
  ], {
    cwd: projectRoot,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      CUSTOMER_BASE_URL: `http://127.0.0.1:${vitePort}`,
      M10_CUSTOMER_BASE_URL: `http://127.0.0.1:${vitePort}`,
      M10_PUBLIC_SUPABASE_URL: publicSupabaseUrl,
      M10_ISOLATED_API_URL: apiUrl,
    },
  });

  const summary = JSON.parse(await runSql(`SELECT json_build_object(
    'orders', (SELECT COUNT(*) FROM public.orders WHERE source='website' AND idempotency_key IS NOT NULL),
    'order_items', (SELECT COUNT(*) FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id WHERE o.source='website'),
    'reserved', (SELECT reserved_quantity FROM public.inventory_balances WHERE product_id='8a000000-0000-4000-8a00-000000000001'),
    'blank_detail_rows', (SELECT COUNT(*) FROM public.customer_addresses ca JOIN public.orders o ON o.customer_address_id=ca.id WHERE o.source='website' AND ca.street IS NULL),
    'tracking_tokens', (SELECT COUNT(*) FROM public.orders WHERE source='website' AND tracking_token IS NOT NULL),
    'duplicate_idempotency_keys', (SELECT COUNT(*) FROM (SELECT idempotency_key FROM public.orders WHERE source='website' GROUP BY idempotency_key HAVING COUNT(*) > 1) duplicates),
    'parcel_instances', (SELECT COUNT(*) FROM public.order_parcel_instances instance JOIN public.orders o ON o.id=instance.order_id WHERE o.source='website'),
    'parcel_components', (SELECT COUNT(*) FROM public.order_parcel_components component JOIN public.order_parcel_instances instance ON instance.id=component.parcel_instance_id JOIN public.orders o ON o.id=instance.order_id WHERE o.source='website')
  );`));
  if (summary.orders !== 11 || summary.order_items !== 11 || summary.reserved !== 9 || summary.blank_detail_rows !== 0 || summary.tracking_tokens !== 11 || summary.duplicate_idempotency_keys !== 0 || summary.parcel_instances !== 2 || summary.parcel_components !== 4) {
    throw new Error(`M10 browser reconciliation failed: ${JSON.stringify(summary)}`);
  }
  console.log(JSON.stringify({ ok: true, desktop_and_mobile_orders: 11, ...summary }, null, 2));
} finally {
  vite?.kill();
  if (isolatedProjectRoot) {
    await execFileAsync(process.execPath, [cliPath, 'stop', '--no-backup', '--workdir', isolatedProjectRoot], {
      cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024,
    }).catch(() => undefined);
  }
}
