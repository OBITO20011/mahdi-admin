import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const sourceSupabaseRoot = path.join(projectRoot, 'supabase');
const runtimeSqlPath = path.join(
  scriptDirectory,
  'phase3-configurable-parcel-contracts-runtime.sql',
);
const cliPath = path.join(projectRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
const migrationHead = Number(process.env.NAWASRAH_V1_LOCATION_MIGRATION_HEAD || 115);
assert.ok([114, 115].includes(migrationHead), 'Location compatibility supports heads 114 or 115.');

const OWNER = '92400000-0000-0000-0000-000000000001';
const PRODUCT = '92400000-0000-0000-0000-000000000103';
const BRANCH_A = '92400000-0000-0000-0000-000000000200';
const WAREHOUSE_A = '92400000-0000-0000-0000-000000000201';
const SHIFT_A = '92400000-0000-0000-0000-000000000202';
const BRANCH_B = '92400000-0000-0000-0000-000000000210';
const WAREHOUSE_B = '92400000-0000-0000-0000-000000000211';
const SHIFT_B = '92400000-0000-0000-0000-000000000212';
const INVALID_WAREHOUSE = '92400000-0000-0000-0000-000000000299';
const INACTIVE_WAREHOUSE = '92400000-0000-0000-0000-000000000213';
const projectId = `nawasrah-phase3-v1-location-${migrationHead}-test`;
const databaseContainer = `supabase_db_${projectId}`;
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'nawasrah-v1-location-'));
const isolatedSupabaseRoot = path.join(temporaryRoot, 'supabase');

const escapeLiteral = (value) => value.replaceAll("'", "''");
const sqlValue = (value) => value === null ? 'NULL' : `'${escapeLiteral(value)}'`;
const claimsSql = `SELECT set_config(
  'request.jwt.claims',
  '{"sub":"${OWNER}","role":"authenticated","aal":"aal2"}',
  false
);`;

const runSql = (sql) => new Promise((resolve, reject) => {
  const child = spawn('docker', [
    'exec', '-i', databaseContainer,
    'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
  ], { cwd: projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  const timeout = setTimeout(() => child.kill('SIGKILL'), 60_000);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (code) => {
    clearTimeout(timeout);
    if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    else reject(new Error(`${stderr}\n${stdout}`));
  });
  child.stdin.end(`SET statement_timeout='45s'; SET lock_timeout='35s';\n${sql}`);
});

const readJson = async (sql) => {
  const { stdout } = await runSql(sql);
  const line = stdout.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean).at(-1);
  assert.ok(line, 'Expected JSON SQL output.');
  return JSON.parse(line);
};

const callV1 = ({ warehouseId, branchId, key, customerName }) => readJson(`${claimsSql}
  SELECT public.create_pos_sale(
    ${sqlValue(warehouseId)}::uuid,
    ${sqlValue(branchId)}::uuid,
    NULL,
    ${sqlValue(customerName)},
    'cash',
    '[{"product_id":"${PRODUCT}","quantity":1}]'::jsonb,
    0,
    4500,
    ${sqlValue(key)}
  );`);

const callFailure = async (input) => {
  try {
    await callV1(input);
    assert.fail('Expected V1 location call to fail.');
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

const orderState = (orderId) => readJson(`SELECT jsonb_build_object(
  'warehouseId', orders.warehouse_id,
  'branchId', orders.branch_id,
  'shiftId', orders.cash_shift_id,
  'source', orders.source,
  'status', orders.status,
  'inventoryA', (SELECT on_hand_quantity FROM public.inventory_balances
    WHERE warehouse_id='${WAREHOUSE_A}' AND product_id='${PRODUCT}'),
  'inventoryB', (SELECT on_hand_quantity FROM public.inventory_balances
    WHERE warehouse_id='${WAREHOUSE_B}' AND product_id='${PRODUCT}')
) FROM public.orders orders WHERE orders.id='${orderId}';`);

const keyedBusinessState = (key) => readJson(`WITH target AS (
  SELECT id FROM public.orders WHERE idempotency_key=${sqlValue(key)}
) SELECT jsonb_build_object(
  'orders', (SELECT jsonb_agg(to_jsonb(orders) ORDER BY orders.id)
    FROM public.orders orders WHERE orders.id IN (SELECT id FROM target)),
  'items', (SELECT jsonb_agg(to_jsonb(item) ORDER BY item.id)
    FROM public.order_items item WHERE item.order_id IN (SELECT id FROM target)),
  'movements', (SELECT jsonb_agg(to_jsonb(movement) ORDER BY movement.id)
    FROM public.inventory_movements movement
    WHERE movement.reference_id IN (SELECT id FROM target)),
  'balances', (SELECT jsonb_agg(to_jsonb(balance) ORDER BY balance.warehouse_id)
    FROM public.inventory_balances balance
    WHERE balance.product_id='${PRODUCT}'
      AND balance.warehouse_id IN ('${WAREHOUSE_A}','${WAREHOUSE_B}')),
  'shifts', (SELECT jsonb_agg(to_jsonb(shift) ORDER BY shift.id)
    FROM public.cash_shifts shift WHERE shift.id IN ('${SHIFT_A}','${SHIFT_B}')),
  'counts', jsonb_build_object(
    'orders', (SELECT count(*) FROM public.orders),
    'items', (SELECT count(*) FROM public.order_items),
    'movements', (SELECT count(*) FROM public.inventory_movements),
    'payments', (SELECT count(*) FROM public.customer_payments),
    'auditLogs', (SELECT count(*) FROM public.audit_logs)
  )
);`);

const installIsolatedProject = async () => {
  await mkdir(isolatedSupabaseRoot, { recursive: true });
  await Promise.all([
    cp(path.join(sourceSupabaseRoot, 'config.toml'), path.join(isolatedSupabaseRoot, 'config.toml')),
    cp(path.join(sourceSupabaseRoot, 'seed.sql'), path.join(isolatedSupabaseRoot, 'seed.sql')),
    cp(path.join(sourceSupabaseRoot, 'functions'), path.join(isolatedSupabaseRoot, 'functions'), {
      recursive: true,
    }),
    cp(path.join(sourceSupabaseRoot, 'migrations'), path.join(isolatedSupabaseRoot, 'migrations'), {
      recursive: true,
    }),
  ]);
  const migrationRoot = path.join(isolatedSupabaseRoot, 'migrations');
  for (const name of await readdir(migrationRoot)) {
    const number = Number(name.match(/^(\d+)_/u)?.[1]);
    if (Number.isFinite(number) && number > migrationHead) {
      await rm(path.join(migrationRoot, name));
    }
  }
  const configPath = path.join(isolatedSupabaseRoot, 'config.toml');
  const config = await readFile(configPath, 'utf8');
  await writeFile(configPath, config.replace(
    /^project_id\s*=\s*"[^"]+"\s*$/mu,
    `project_id = "${projectId}"`,
  ), 'utf8');
  const cleanupPath = path.join(migrationRoot, '034_prelaunch_test_data_cleanup.sql');
  const cleanup = await readFile(cleanupPath, 'utf8');
  const expected = `    public.supplier_payments,\n    public.supplier_receipt_items,`;
  const replacement = `    public.supplier_payments,\n    public.supplier_return_items,\n    public.supplier_returns,\n    public.stock_count_items,\n    public.stock_counts,\n    public.supplier_receipt_items,`;
  assert.ok(cleanup.includes(expected));
  await writeFile(cleanupPath, cleanup.replace(expected, replacement), 'utf8');
  await execFileAsync(process.execPath, [cliPath, 'start', '--workdir', temporaryRoot], {
    cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024, timeout: 240_000,
  });
  await execFileAsync(process.execPath, [cliPath, 'db', 'reset', '--local', '--workdir', temporaryRoot], {
    cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024, timeout: 180_000,
  });
};

try {
  await installIsolatedProject();
  const runtimeSql = await readFile(runtimeSqlPath, 'utf8');
  const fixtureEnd = runtimeSql.indexOf('\nDO $$', runtimeSql.indexOf('\nDO $$') + 1);
  assert.ok(fixtureEnd > 0, 'Could not isolate the Phase-3 fixture block.');
  await runSql(runtimeSql.slice(0, fixtureEnd));
  await runSql(`
    UPDATE public.warehouses SET created_at='2020-01-01T00:00:00Z'
    WHERE id='${WAREHOUSE_A}';
    INSERT INTO public.branches (id, code, name_ar, is_active)
    VALUES ('${BRANCH_B}', 'P3-BR-B', 'فرع Phase 3 ب', true);
    INSERT INTO public.warehouses (id, branch_id, code, name_ar, is_active, created_at)
    VALUES
      ('${WAREHOUSE_B}', '${BRANCH_B}', 'P3-WH-B', 'مستودع Phase 3 ب', true, '2021-01-01T00:00:00Z'),
      ('${INACTIVE_WAREHOUSE}', '${BRANCH_B}', 'P3-WH-X', 'مستودع غير نشط', false, '2022-01-01T00:00:00Z');
    INSERT INTO public.cash_shifts (
      id, shift_number, branch_id, opened_by, opening_cash_in_minor_units
    ) VALUES ('${SHIFT_B}', 'P3-SHIFT-2', '${BRANCH_B}', '${OWNER}', 0);
    INSERT INTO public.inventory_balances (
      warehouse_id, product_id, on_hand_quantity, reserved_quantity
    ) VALUES ('${WAREHOUSE_B}', '${PRODUCT}', 100, 0);
  `);

  const scenarios = {};
  const runSuccess = async (name, input) => {
    const result = await callV1(input);
    scenarios[name] = {
      resultKeys: Object.keys(result).sort(),
      idempotentReplay: result.idempotentReplay,
      state: await orderState(result.orderId),
    };
    return result;
  };

  await runSuccess('explicitWarehouseAndBranch', {
    warehouseId: WAREHOUSE_A, branchId: BRANCH_A,
    key: 'phase3-v1-location-explicit-0001', customerName: 'Explicit',
  });
  const inferredBranch = await runSuccess('explicitWarehouseNullBranch', {
    warehouseId: WAREHOUSE_A, branchId: null,
    key: 'phase3-v1-location-inferred-0001', customerName: 'Inferred',
  });
  const defaultLocation = await runSuccess('nullWarehouseNullBranch', {
    warehouseId: null, branchId: null,
    key: 'phase3-v1-location-default-0001', customerName: 'Default',
  });
  await runSuccess('nullWarehouseExplicitBranch', {
    warehouseId: null, branchId: BRANCH_B,
    key: 'phase3-v1-location-null-wh-branch-0001', customerName: 'Null warehouse',
  });
  await runSuccess('mismatchedWarehouseAndBranch', {
    warehouseId: WAREHOUSE_A, branchId: BRANCH_B,
    key: 'phase3-v1-location-mismatch-0001', customerName: 'Mismatch',
  });
  await runSuccess('nullIdempotencyFallback', {
    warehouseId: WAREHOUSE_A, branchId: null,
    key: null, customerName: 'No key',
  });

  const replayCase = async (name, result, key, shiftId, input) => {
    const before = await keyedBusinessState(key);
    const replay = await readJson(`BEGIN;
      UPDATE public.cash_shifts SET status='cancelled', cancelled_by='${OWNER}',
        cancelled_at=NOW(), cancellation_reason='isolated location replay'
      WHERE id='${shiftId}';
      ${claimsSql}
      SELECT public.create_pos_sale(
        ${sqlValue(input.warehouseId)}::uuid, ${sqlValue(input.branchId)}::uuid,
        NULL, ${sqlValue(input.customerName)}, 'cash',
        '[{"product_id":"${PRODUCT}","quantity":1}]'::jsonb,
        0, 4500, ${sqlValue(key)}
      );
      ROLLBACK;`);
    assert.equal(replay.orderId, result.orderId);
    assert.equal(replay.idempotentReplay, true);
    assert.deepEqual(await keyedBusinessState(key), before);
    scenarios[name] = { success: true, zeroWrites: true, orderId: replay.orderId };
  };
  await replayCase(
    'inferredBranchReplayAfterShiftClose', inferredBranch,
    'phase3-v1-location-inferred-0001', SHIFT_A,
    { warehouseId: WAREHOUSE_A, branchId: null, customerName: 'Inferred' },
  );
  await replayCase(
    'defaultLocationReplayAfterShiftClose', defaultLocation,
    'phase3-v1-location-default-0001', SHIFT_A,
    { warehouseId: null, branchId: null, customerName: 'Default' },
  );

  scenarios.invalidWarehouse = await callFailure({
    warehouseId: INVALID_WAREHOUSE, branchId: null,
    key: 'phase3-v1-location-invalid-0001', customerName: 'Invalid',
  });
  scenarios.inactiveWarehouse = await callFailure({
    warehouseId: INACTIVE_WAREHOUSE, branchId: null,
    key: 'phase3-v1-location-inactive-0001', customerName: 'Inactive',
  });

  console.log(JSON.stringify({
    ok: true,
    migrationHead,
    defaultSelectionRule: 'active warehouse ordered by created_at ascending',
    scenarios,
  }, null, 2));
} finally {
  try {
    await execFileAsync(process.execPath, [cliPath, 'stop', '--no-backup', '--workdir', temporaryRoot], {
      cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024, timeout: 120_000,
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
