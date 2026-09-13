import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const bootstrapPath = path.join(scriptDirectory, 'bootstrap-isolated-supabase.mjs');
const runtimeSqlPath = path.join(scriptDirectory, 'pos-idempotency-runtime.sql');
const cliPath = path.join(projectRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
const projectId = process.env.NAWASRAH_POS_TEST_PROJECT_ID || 'nawasrah-pos-idempotency-test';
const databaseContainer = process.env.NAWASRAH_POS_TEST_CONTAINER || `supabase_db_${projectId}`;
const skipBootstrap = process.env.NAWASRAH_SKIP_BOOTSTRAP === '1';
let isolatedProjectRoot = '';

assert.match(databaseContainer, /^supabase_db_nawasrah-[a-z0-9-]+-test$/u);

const runSql = (sql, { allowFailure = false } = {}) => new Promise((resolve, reject) => {
  const child = spawn(
    'docker',
    [
      'exec', '-i', databaseContainer,
      'psql', '-U', 'postgres', '-d', 'postgres',
      '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
    ],
    { cwd: projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (code) => {
    const result = { code, stdout: stdout.trim(), stderr: stderr.trim() };
    if (code === 0 || allowFailure) resolve(result);
    else reject(new Error(`POS idempotency SQL failed: ${stderr}`));
  });
  child.stdin.end(sql);
});

const claims = (userId) => `SELECT set_config(
  'request.jwt.claims',
  '{"sub":"${userId}","role":"authenticated","aal":"aal2"}',
  false
);`;

const saleSql = ({ key, productId, quantity, userId = '91100000-0000-0000-0000-000000000001' }) => `
${claims(userId)}
SELECT public.create_pos_sale(
  '91100000-0000-0000-0000-000000000020',
  '91100000-0000-0000-0000-000000000010',
  NULL,
  'زبون نقدي',
  'cliq',
  jsonb_build_array(jsonb_build_object(
    'product_id', '${productId}'::UUID,
    'quantity', ${quantity}
  )),
  0,
  0,
  '${key}'
);`;

const parseLastJson = (stdout) => {
  const line = stdout.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean).at(-1);
  if (!line) throw new Error('Expected a JSON result from isolated POS runtime.');
  return JSON.parse(line);
};

try {
  if (!skipBootstrap) {
    const { stdout } = await execFileAsync(process.execPath, [bootstrapPath], {
      cwd: projectRoot,
      env: { ...process.env, NAWASRAH_ISOLATED_PROJECT_ID: projectId },
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      timeout: 360_000,
    });
    const bootstrap = JSON.parse(stdout);
    assert.equal(bootstrap.ok, true);
    isolatedProjectRoot = bootstrap.isolatedProjectRoot;
  }

  const runtimeSql = await readFile(runtimeSqlPath, 'utf8');
  const sequential = await runSql(runtimeSql);
  const sequentialSummary = parseLastJson(sequential.stdout);
  assert.equal(sequentialSummary.ok, true);

  const identicalKey = 'pos-idempotency-concurrent-same-0001';
  const identicalProduct = '91100000-0000-0000-0000-000000000064';
  const identicalResults = await Promise.all([
    runSql(saleSql({ key: identicalKey, productId: identicalProduct, quantity: 1 })),
    runSql(saleSql({ key: identicalKey, productId: identicalProduct, quantity: 1 })),
  ]);
  const identicalPayloads = identicalResults.map((result) => parseLastJson(result.stdout));
  assert.equal(new Set(identicalPayloads.map((payload) => payload.orderId)).size, 1);
  assert.equal(identicalPayloads.filter((payload) => payload.idempotentReplay === false).length, 1);
  assert.equal(identicalPayloads.filter((payload) => payload.idempotentReplay === true).length, 1);

  const identicalState = parseLastJson((await runSql(`
SELECT json_build_object(
  'orders', (SELECT count(*) FROM public.orders WHERE idempotency_key = '${identicalKey}'),
  'items', (SELECT count(*) FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id WHERE o.idempotency_key='${identicalKey}'),
  'movements', (SELECT count(*) FROM public.inventory_movements im JOIN public.orders o ON o.id=im.reference_id WHERE o.idempotency_key='${identicalKey}'),
  'movement_quantity', (SELECT sum(im.quantity) FROM public.inventory_movements im JOIN public.orders o ON o.id=im.reference_id WHERE o.idempotency_key='${identicalKey}'),
  'stock', (SELECT on_hand_quantity FROM public.inventory_balances WHERE warehouse_id='91100000-0000-0000-0000-000000000020' AND product_id='${identicalProduct}'),
  'audits', (SELECT count(*) FROM public.audit_logs al JOIN public.orders o ON o.id=al.entity_id WHERE o.idempotency_key='${identicalKey}'),
  'replay_audits', (SELECT count(*) FROM public.audit_logs al JOIN public.orders o ON o.id=al.entity_id WHERE o.idempotency_key='${identicalKey}' AND al.action='REPLAY_WHOLESALE_POS_SALE')
);`)).stdout);
  assert.deepEqual(identicalState, {
    orders: 1,
    items: 1,
    movements: 1,
    movement_quantity: -1,
    stock: 99,
    audits: 2,
    replay_audits: 0,
  });

  const conflictKey = 'pos-idempotency-concurrent-conflict-1';
  const conflictProduct = '91100000-0000-0000-0000-000000000065';
  const conflictResults = await Promise.all([
    runSql(saleSql({ key: conflictKey, productId: conflictProduct, quantity: 1 }), { allowFailure: true }),
    runSql(saleSql({ key: conflictKey, productId: conflictProduct, quantity: 2 }), { allowFailure: true }),
  ]);
  assert.equal(conflictResults.filter((result) => result.code === 0).length, 1);
  assert.equal(conflictResults.filter((result) => result.code !== 0).length, 1);
  assert.match(conflictResults.find((result) => result.code !== 0).stderr, /IDEMPOTENCY_CONFLICT/u);

  const conflictState = parseLastJson((await runSql(`
SELECT json_build_object(
  'orders', count(*),
  'package_quantity', max(oi.sale_package_quantity),
  'base_quantity', max(oi.quantity),
  'total', max(o.total_in_minor_units),
  'movement_quantity', min(im.quantity),
  'stock', (SELECT on_hand_quantity FROM public.inventory_balances WHERE warehouse_id='91100000-0000-0000-0000-000000000020' AND product_id='${conflictProduct}'),
  'audits', (SELECT count(*) FROM public.audit_logs al JOIN public.orders ao ON ao.id=al.entity_id WHERE ao.idempotency_key='${conflictKey}')
)
FROM public.orders o
JOIN public.order_items oi ON oi.order_id=o.id
JOIN public.inventory_movements im ON im.reference_id=o.id AND im.product_id=oi.product_id
WHERE o.idempotency_key='${conflictKey}';`)).stdout);
  assert.equal(conflictState.orders, 1);
  assert.equal(conflictState.package_quantity, conflictState.base_quantity);
  assert.equal(conflictState.movement_quantity, -conflictState.base_quantity);
  assert.equal(conflictState.stock, 100 - conflictState.base_quantity);
  assert.equal(conflictState.total, 1200 * conflictState.package_quantity);
  assert.equal(conflictState.audits, 2);

  const crossUser = await runSql(saleSql({
    key: ['pos-idempotency', 'sequential', '000001'].join('-'),
    productId: '91100000-0000-0000-0000-000000000061',
    quantity: 1,
    userId: '91100000-0000-0000-0000-000000000002',
  }), { allowFailure: true });
  assert.notEqual(crossUser.code, 0);
  assert.match(crossUser.stderr, /IDEMPOTENCY_CONFLICT/u);
  assert.doesNotMatch(crossUser.stderr, /POS-[0-9]/u);

  const legacyKey = 'pos-idempotency-incomplete-legacy-01';
  const legacyProduct = '91100000-0000-0000-0000-000000000064';
  const legacySale = parseLastJson((await runSql(saleSql({
    key: legacyKey,
    productId: legacyProduct,
    quantity: 1,
  }))).stdout);
  await runSql(`UPDATE public.order_items SET sale_package_quantity=NULL WHERE order_id='${legacySale.orderId}'::UUID;`);
  const legacyReplay = await runSql(saleSql({
    key: legacyKey,
    productId: legacyProduct,
    quantity: 1,
  }), { allowFailure: true });
  assert.notEqual(legacyReplay.code, 0);
  assert.match(legacyReplay.stderr, /IDEMPOTENCY_CONFLICT/u);

  const legacyState = parseLastJson((await runSql(`
SELECT json_build_object(
  'orders', (SELECT count(*) FROM public.orders WHERE idempotency_key='${legacyKey}'),
  'movements', (SELECT count(*) FROM public.inventory_movements WHERE reference_id='${legacySale.orderId}'::UUID),
  'audits', (SELECT count(*) FROM public.audit_logs WHERE entity_id='${legacySale.orderId}'::UUID),
  'total', (SELECT total_in_minor_units FROM public.orders WHERE id='${legacySale.orderId}'::UUID)
);`)).stdout);
  assert.deepEqual(legacyState, { orders: 1, movements: 1, audits: 2, total: 1100 });

  console.log(JSON.stringify({
    ok: true,
    sequential: sequentialSummary,
    concurrentIdentical: identicalState,
    concurrentConflict: conflictState,
    crossUserCollision: 'rejected-without-order-disclosure',
    incompleteLegacyIdentity: 'failed-closed',
  }, null, 2));
} finally {
  if (!skipBootstrap && isolatedProjectRoot) {
    await execFileAsync(process.execPath, [cliPath, 'stop', '--no-backup', '--workdir', isolatedProjectRoot], {
      cwd: projectRoot,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      timeout: 120_000,
    });
  }
}
