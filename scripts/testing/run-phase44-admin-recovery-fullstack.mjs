import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {randomBytes, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');
const bootstrapPath = path.join(here, 'bootstrap-isolated-supabase.mjs');
const phase3SqlPath = path.join(here, 'phase3-configurable-parcel-contracts-runtime.sql');
const cliPath = path.join(projectRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
const posOnly = process.env.NAWASRAH_PACKAGE_D_POS_FULLSTACK === '1';
const projectId = `nawasrah-phase44-admin-${randomUUID().slice(0, 8)}-test`;
const databaseContainer = `supabase_db_${projectId}`;
const branchId = '92400000-0000-0000-0000-000000000200';
const warehouseId = '92400000-0000-0000-0000-000000000201';
const productId = '92400000-0000-0000-0000-000000000101';
const vitePort = 4183;
const controlPort = 4184;
const email = `phase44-${randomUUID()}@example.test`;
const password = `T-${randomBytes(24).toString('base64url')}!9a`;
const turnstileTestSecret = '1x0000000000000000000000000000000AA';
let isolatedProjectRoot = '';
let vite;
let control;

const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const runSql = (sql) => new Promise((resolve, reject) => {
  const child = spawn('docker', ['exec', '-i', databaseContainer, 'psql', '-U', 'postgres',
    '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'],
  {cwd: projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
  let stdout = ''; let stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (code) => code === 0 ? resolve(stdout.trim())
    : reject(new Error(`Slice 4 isolated SQL failed: ${stderr.trim()}`)));
  child.stdin.end(`SET statement_timeout='60s'; SET lock_timeout='30s';\n${sql}`);
});
const json = async (sql) => {
  const output = await runSql(sql);
  const line = output.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean).at(-1);
  assert.ok(line, 'Expected JSON from Slice 4 isolated SQL.');
  return JSON.parse(line);
};
const jsonLines = async (sql) => (await runSql(sql)).split(/\r?\n/u)
  .map((entry) => entry.trim()).filter(Boolean).map((entry) => JSON.parse(entry));
const waitForHttp = async (url) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url, {signal: AbortSignal.timeout(1_000)});
      if (response.ok) return;
    } catch (error) { if (attempt === 119) throw error; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}.`);
};
const snapshotSql = (orderId) => `WITH operation_ids AS (
  SELECT operation_id id FROM public.sales_return_events WHERE order_id=${literal(orderId)}
  UNION SELECT operation_id FROM public.sales_replacement_events
    WHERE root_order_id=${literal(orderId)}
), relevant_products AS (
  SELECT product_id FROM public.order_items WHERE order_id=${literal(orderId)}
  UNION SELECT component.product_id FROM public.order_parcel_components component
    JOIN public.order_parcel_instances instance ON instance.id=component.parcel_instance_id
    WHERE instance.order_id=${literal(orderId)}
  UNION SELECT item.product_id FROM public.sales_replacement_items item
    JOIN public.sales_replacement_events event ON event.id=item.replacement_event_id
    WHERE event.root_order_id=${literal(orderId)}
), durable_content AS (
  SELECT jsonb_build_object(
    'order',(SELECT to_jsonb(customer_order) FROM public.orders customer_order
      WHERE customer_order.id=${literal(orderId)}),
    'operations',COALESCE((SELECT jsonb_agg(to_jsonb(operation) ORDER BY operation.id)
      FROM public.business_operations operation WHERE operation.id IN (SELECT id FROM operation_ids)),'[]'::jsonb),
    'returns',COALESCE((SELECT jsonb_agg(to_jsonb(event) ORDER BY event.id)
      FROM public.sales_return_events event WHERE event.order_id=${literal(orderId)}),'[]'::jsonb),
    'returnItems',COALESCE((SELECT jsonb_agg(to_jsonb(item) ORDER BY item.id)
      FROM public.sales_return_items item WHERE item.order_id=${literal(orderId)}),'[]'::jsonb),
    'componentInspections',COALESCE((SELECT jsonb_agg(to_jsonb(inspection)
      ORDER BY inspection.sales_return_item_id,inspection.parcel_component_id)
      FROM public.sales_return_component_inspections inspection
      WHERE inspection.return_operation_id IN (SELECT id FROM operation_ids)),'[]'::jsonb),
    'replacements',COALESCE((SELECT jsonb_agg(to_jsonb(event) ORDER BY event.id)
      FROM public.sales_replacement_events event WHERE event.root_order_id=${literal(orderId)}),'[]'::jsonb),
    'replacementItems',COALESCE((SELECT jsonb_agg(to_jsonb(item) ORDER BY item.id)
      FROM public.sales_replacement_items item WHERE item.operation_id IN (SELECT id FROM operation_ids)),'[]'::jsonb),
    'consumptions',COALESCE((SELECT jsonb_agg(to_jsonb(consumption) ORDER BY consumption.id)
      FROM public.sales_aftercare_consumptions consumption
      WHERE consumption.operation_id IN (SELECT id FROM operation_ids)),'[]'::jsonb),
    'movements',COALESCE((SELECT jsonb_agg(to_jsonb(movement) ORDER BY movement.id)
      FROM public.inventory_movements movement
      WHERE movement.operation_id IN (SELECT id FROM operation_ids)),'[]'::jsonb),
    'returnEffects',COALESCE((SELECT jsonb_agg(to_jsonb(effect) ORDER BY effect.id)
      FROM public.phase42_return_inventory_effects effect
      WHERE effect.operation_id IN (SELECT id FROM operation_ids)),'[]'::jsonb),
    'returnEvidence',COALESCE((SELECT jsonb_agg(to_jsonb(evidence) ORDER BY evidence.operation_id)
      FROM public.phase42_return_settlement_evidence evidence
      WHERE evidence.operation_id IN (SELECT id FROM operation_ids)),'[]'::jsonb),
    'replacementEffects',COALESCE((SELECT jsonb_agg(to_jsonb(effect) ORDER BY effect.id)
      FROM public.phase43_replacement_inventory_effects effect
      WHERE effect.operation_id IN (SELECT id FROM operation_ids)),'[]'::jsonb),
    'replacementEvidence',COALESCE((SELECT jsonb_agg(to_jsonb(evidence) ORDER BY evidence.operation_id)
      FROM public.phase43_replacement_settlement_evidence evidence
      WHERE evidence.operation_id IN (SELECT id FROM operation_ids)),'[]'::jsonb),
    'inventoryBalances',COALESCE((SELECT jsonb_agg(to_jsonb(balance)
      ORDER BY balance.warehouse_id,balance.product_id)
      FROM public.inventory_balances balance WHERE balance.warehouse_id=${literal(warehouseId)}
        AND balance.product_id IN (SELECT product_id FROM relevant_products)),'[]'::jsonb),
    'cashShifts',COALESCE((SELECT jsonb_agg(to_jsonb(shift) ORDER BY shift.id)
      FROM public.cash_shifts shift WHERE shift.id IN (SELECT cash_shift_id
        FROM public.sales_return_events WHERE order_id=${literal(orderId)}
          AND cash_shift_id IS NOT NULL)),'[]'::jsonb),
    'customerPayments',COALESCE((SELECT jsonb_agg(to_jsonb(payment) ORDER BY payment.id)
      FROM public.customer_payments payment WHERE payment.order_id=${literal(orderId)}),'[]'::jsonb),
    'auditLogs',COALESCE((SELECT jsonb_agg(to_jsonb(log) ORDER BY log.id)
      FROM public.audit_logs log WHERE log.entity_id IN (
        SELECT id FROM public.sales_return_events WHERE order_id=${literal(orderId)}
        UNION SELECT id FROM public.sales_replacement_events
          WHERE root_order_id=${literal(orderId)})),'[]'::jsonb)
  ) value
)
SELECT jsonb_build_object('sha256',ENCODE(extensions.digest(
  CONVERT_TO(value::text,'UTF8'),'sha256'),'hex'),'content',value,
  'orderReturns',JSONB_ARRAY_LENGTH(value->'returns'),
  'orderReplacements',JSONB_ARRAY_LENGTH(value->'replacements'),
  'returnItems',JSONB_ARRAY_LENGTH(value->'returnItems'),
  'replacementItems',JSONB_ARRAY_LENGTH(value->'replacementItems'),
  'returnEffects',JSONB_ARRAY_LENGTH(value->'returnEffects'),
  'replacementEffects',JSONB_ARRAY_LENGTH(value->'replacementEffects'))
FROM durable_content;`;

const fingerprintMutationProbeSql = (orderId) => `BEGIN;
${snapshotSql(orderId)}
UPDATE public.inventory_balances SET on_hand_quantity=on_hand_quantity+7
WHERE warehouse_id=${literal(warehouseId)} AND product_id=${literal(productId)};
${snapshotSql(orderId)}
ROLLBACK;`;
const posSnapshotSql = `WITH content AS (SELECT jsonb_build_object(
  'orders',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM orders t),
  'items',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM order_items t),
  'operations',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM business_operations t),
  'payments',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM customer_payments t),
  'shifts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM cash_shifts t),
  'balances',(SELECT jsonb_agg(to_jsonb(t) ORDER BY warehouse_id,product_id) FROM inventory_balances t),
  'movements',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM inventory_movements t),
  'instances',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM order_parcel_instances t),
  'components',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM order_parcel_components t)) value)
  SELECT jsonb_build_object('sha256',encode(extensions.digest(convert_to(value::text,'UTF8'),'sha256'),'hex'),
    'content',value) FROM content;`;

const createSale = async (actorId, label, quantity = 1) => {
  const claims = `SELECT set_config('request.jwt.claims',
    '{"sub":"${actorId}","role":"authenticated","aal":"aal2"}',false);`;
  const items = JSON.stringify([{commercial_line_kind: 'base_unit', product_id: productId,
    base_quantity: quantity, price_authority: 'server_catalog', line_discount_in_minor_units: 0}]);
  const created = await json(`${claims} SELECT public.create_pos_sale_v2(
    ${literal(warehouseId)},${literal(branchId)},NULL,${literal(label)},'cash',
    ${literal(items)}::jsonb,0,10000,${literal(`phase44-s4-${randomUUID()}`)});`);
  assert.equal(created.success, true);
  return json(`SELECT jsonb_build_object('orderId',orders.id,'orderItemId',items.id,
    'productId',items.product_id,'warehouseId',orders.warehouse_id)
    FROM public.orders orders JOIN public.order_items items ON items.order_id=orders.id
    WHERE orders.id=${literal(created.orderId)};`);
};

try {
  const {stdout} = await execFileAsync(process.execPath, [bootstrapPath], {
    cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024, timeout: 420_000,
    env: {...process.env, NAWASRAH_ISOLATED_PROJECT_ID: projectId,
      TURNSTILE_SECRET: turnstileTestSecret,
      NAWASRAH_SKIP_REDUNDANT_DB_RESET: 'true',
      NAWASRAH_SUPABASE_EXCLUDE:
        'realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'},
  });
  const bootstrap = JSON.parse(stdout);
  assert.equal(bootstrap.ok, true);
  isolatedProjectRoot = bootstrap.isolatedProjectRoot;
  console.log(JSON.stringify({stage: 'DB port guard', ...bootstrap.dbPortGuard}));
  const phase3 = await readFile(phase3SqlPath, 'utf8');
  if (posOnly) {
    const first = phase3.indexOf('\nDO $$'); const second = phase3.indexOf('\nDO $$', first + 1);
    assert.ok(first >= 0 && second > first); await runSql(phase3.slice(0, second));
    await runSql(`SELECT set_config('request.jwt.claims',
      '{"sub":"92400000-0000-0000-0000-000000000001","role":"authenticated"}',false);
      SET ROLE authenticated; SELECT save_product_parcel_configuration_v1(
        '92400000-0000-0000-0000-000000000100','configurable_mix',true,5,
        ARRAY['92400000-0000-0000-0000-000000000101','92400000-0000-0000-0000-000000000102']::uuid[]);
      SELECT set_configurable_parcel_feature_state_v1('ENABLED');`);
  } else assert.equal((await json(phase3)).ok, true);

  const {stdout: statusOutput} = await execFileAsync(process.execPath, [cliPath, 'status',
    '-o', 'json', '--workdir', isolatedProjectRoot], {cwd: projectRoot, windowsHide: true});
  const status = JSON.parse(statusOutput);
  const apiUrl = status.API_URL || status.api_url;
  const anonKey = status.ANON_KEY || status.anon_key;
  const serviceRoleKey = status.SERVICE_ROLE_KEY || status.service_role_key;
  assert.ok(apiUrl && anonKey && serviceRoleKey, 'Incomplete isolated Supabase status.');

  const createdResponse = await fetch(`${apiUrl}/auth/v1/admin/users`, {method: 'POST', headers: {
    apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json'}, body: JSON.stringify({email, password, email_confirm: true,
      user_metadata: {full_name: 'Phase 4.4 Slice 4 Admin'}})});
  const createdUser = await createdResponse.json();
  assert.ok(createdResponse.ok && createdUser.id, 'Could not create Slice 4 Admin user.');
  await runSql(`INSERT INTO public.profiles(id,full_name,is_active)
    VALUES (${literal(createdUser.id)},'Phase 4.4 Slice 4 Admin',true)
    ON CONFLICT (id) DO UPDATE SET is_active=true;
    INSERT INTO public.user_roles(user_id,role_id)
    SELECT ${literal(createdUser.id)},id FROM public.roles WHERE code='admin'
    ON CONFLICT (user_id,role_id) DO NOTHING;`);

  const fixtures = {};
  for (const project of posOnly ? [] : ['desktop-chromium', 'mobile-webkit']) {
    fixtures[project] = {};
    for (const scenario of ['lostReplacement', 'lostReturn', 'malformedReplacement',
      'sameContext', 'crossContext', 'timeoutBeforeCommit', 'staleResponse',
      'deterministicRejection', 'fingerprintProbe']) {
      fixtures[project][scenario] = await createSale(createdUser.id, `${project} ${scenario}`,
        scenario === 'deterministicRejection' ? 2 : 1);
    }
  }

  control = createServer(async (request, response) => {
    const url = new URL(request.url || '/', `http://127.0.0.1:${controlPort}`);
    if (url.pathname === '/health') { response.end('ok'); return; }
    if (posOnly && url.pathname === '/pos-snapshot') {
      try {response.setHeader('content-type','application/json'); response.end(JSON.stringify(await json(posSnapshotSql)));}
      catch (error) {response.statusCode=500; response.end(String(error));} return;
    }
    if (!['/snapshot', '/fingerprint-probe'].includes(url.pathname)) {
      response.statusCode = 404; response.end('not found'); return;
    }
    const orderId = url.searchParams.get('orderId');
    if (!orderId || !/^[0-9a-f-]{36}$/iu.test(orderId)) {
      response.statusCode = 400; response.end('invalid order'); return;
    }
    try {
      const value = url.pathname === '/snapshot'
        ? await json(snapshotSql(orderId))
        : await jsonLines(fingerprintMutationProbeSql(orderId));
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(value));
    } catch (error) { response.statusCode = 500; response.end(String(error)); }
  });
  await new Promise((resolve, reject) => control.listen(controlPort, '127.0.0.1', resolve)
    .once('error', reject));

  vite = spawn(process.execPath, [path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
    '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], {
    cwd: projectRoot, windowsHide: true, stdio: 'ignore', env: {...process.env,
      VITE_SUPABASE_URL: apiUrl, VITE_SUPABASE_PUBLISHABLE_KEY: anonKey},
  });
  await waitForHttp(`http://127.0.0.1:${vitePort}`);

  const playwrightArgs = [
    path.join(projectRoot, 'node_modules', 'playwright', 'cli.js'), 'test',
    posOnly ? 'e2e/package-d-pos-fullstack.spec.ts' : 'e2e/phase44-admin-recovery-fullstack.spec.ts', '--project=desktop-chromium',
    '--project=mobile-webkit', '--workers=1', '--retries=0'];
  if (process.env.PHASE44_PLAYWRIGHT_GREP) {
    playwrightArgs.push('--grep', process.env.PHASE44_PLAYWRIGHT_GREP);
  }
  const {stdout: playwrightOutput, stderr: playwrightError} = await execFileAsync(process.execPath,
    playwrightArgs, {
    cwd: projectRoot, windowsHide: true, maxBuffer: 8 * 1024 * 1024,
    env: {...process.env, CI: '1', PHASE44_ADMIN_BASE_URL: `http://127.0.0.1:${vitePort}`,
      PHASE44_CONTROL_URL: `http://127.0.0.1:${controlPort}`,
      PHASE44_ADMIN_EMAIL: email, PHASE44_ADMIN_PASSWORD: password,
      PHASE44_FIXTURES: JSON.stringify(fixtures)},
    });
  if (playwrightOutput.trim()) process.stdout.write(playwrightOutput);
  if (playwrightError.trim()) process.stderr.write(playwrightError);
  console.log(JSON.stringify({ok: true, scenarios: posOnly ? 4 : 9,
    browsers: ['desktop-chromium', 'mobile-webkit'], realPublicRpc: true,
    realIsolatedDatabase: true, productionRequests: 0}, null, 2));
} finally {
  if (control) await new Promise((resolve) => control.close(resolve));
  vite?.kill();
  if (isolatedProjectRoot) await execFileAsync(process.execPath, [cliPath, 'stop', '--no-backup',
    '--workdir', isolatedProjectRoot], {cwd: projectRoot, windowsHide: true,
    maxBuffer: 1024 * 1024}).catch(() => undefined);
}
