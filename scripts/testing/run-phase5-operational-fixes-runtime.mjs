// Phase 5 re-scope runtime proof (docs/agent/PHASE5_RESCOPE.md).
// Default mode builds 001-128 and asserts findings C, B and A are fixed.
// NAWASRAH_PHASE5_FIX_MODE=before builds 001-127 and asserts the same
// scenarios reproduce the original defects, so the proof is two-sided.
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
const phase3SqlPath = path.join(scriptDirectory, 'phase3-configurable-parcel-contracts-runtime.sql');
const cliPath = path.join(projectRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
const mode = process.env.NAWASRAH_PHASE5_FIX_MODE === 'before' ? 'before' : 'after';
const fixed = mode === 'after';
const projectId = 'nawasrah-phase5-operational-fixes-test';
const databaseContainer = `supabase_db_${projectId}`;
const ownerId = '92400000-0000-0000-0000-000000000001';
const warehouseId = '92400000-0000-0000-0000-000000000201';
const branchId = '92400000-0000-0000-0000-000000000200';
const productA = '92400000-0000-0000-0000-000000000101';
const customerId = '92550000-0000-4000-8000-000000000001';
const ownerClaims = `SELECT set_config('request.jwt.claims',
  '{"sub":"${ownerId}","role":"authenticated","aal":"aal2"}',false);`;
let isolatedProjectRoot = '';

const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;

const runSqlText = (sql, label, { expectFailure = false } = {}) => new Promise((resolve, reject) => {
  const child = spawn('docker', [
    'exec', '-i', databaseContainer,
    'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1',
  ], { cwd: projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (code) => {
    const result = { code, stdout: stdout.trim(), stderr: stderr.trim() };
    if ((!expectFailure && code !== 0) || (expectFailure && code === 0)) {
      reject(new Error(`${label} had unexpected exit ${code}:\n${stderr}\n${stdout}`));
      return;
    }
    resolve(result);
  });
  child.stdin.end(`SET statement_timeout='60s'; SET lock_timeout='30s';\n${sql}`);
});

const readJson = async (sql, label) => {
  const result = await runSqlText(sql, label);
  const value = result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).at(-1);
  assert.ok(value, `${label} did not return JSON.`);
  return JSON.parse(value);
};

const createBaseSale = async ({ key, quantity, paymentMethod, amountPaid, customer = null }) => {
  const items = JSON.stringify([{
    commercial_line_kind: 'base_unit',
    product_id: productA,
    base_quantity: quantity,
    price_authority: 'server_catalog',
    line_discount_in_minor_units: 0,
  }]);
  const result = await readJson(`${ownerClaims}
    SELECT public.create_pos_sale_v2(
      ${sqlLiteral(warehouseId)},${sqlLiteral(branchId)},
      ${customer ? sqlLiteral(customer) : 'NULL'},${sqlLiteral(`Phase5 ${key}`)},
      ${sqlLiteral(paymentMethod)},${sqlLiteral(items)}::jsonb,
      0,${amountPaid},${sqlLiteral(key)}
    );`, `Create sale ${key}`);
  assert.equal(result.success, true);
  return readJson(`SELECT jsonb_build_object(
    'orderId',customer_order.id,'orderItemId',item.id,
    'shiftId',customer_order.cash_shift_id,'total',customer_order.total_in_minor_units
  ) FROM public.orders customer_order
  JOIN public.order_items item ON item.order_id=customer_order.id
  WHERE customer_order.id=${sqlLiteral(result.orderId)};`, `Read sale ${key}`);
};

const summary = (shiftId) => readJson(`${ownerClaims}
  SELECT public.get_cash_shift_summary(${sqlLiteral(shiftId)});`, 'Shift summary');

// Finding C: a settled Phase 4.2 cash refund must reach the cashier's summary,
// the close-time columns and the closing report.
const runShiftRefundScenario = async () => {
  const sale = await createBaseSale({
    key: 'phase5-fix-cash-sale-0001', quantity: 2, paymentMethod: 'cash', amountPaid: 2000,
  });
  const before = await summary(sale.shiftId);
  const refund = await readJson(`${ownerClaims}
    SELECT public.settle_sales_return_v1(
      ${sqlLiteral(sale.orderId)},'phase5-fix-cash-return-0001',
      ${sqlLiteral(JSON.stringify([{
        return_scope: 'base_unit', order_item_id: sale.orderItemId,
        quantity: 1, stock_disposition: 'damaged',
      }]))}::jsonb,
      'Phase 5 fix runtime proof','cash',NULL,NULL
    );`, 'Settle cash Return');
  const refundAmount = refund.moneyRefundInMinorUnits;
  assert.ok(refundAmount > 0, 'Return must refund money for the scenario to be meaningful.');

  const after = await summary(sale.shiftId);
  const refundDelta = after.cashRefundsInMinorUnits - before.cashRefundsInMinorUnits;
  const expectedDelta = after.expectedCashInMinorUnits - before.expectedCashInMinorUnits;
  const counter = await readJson(`SELECT jsonb_build_object('value',cash_refunds_in_minor_units)
    FROM public.cash_shifts WHERE id=${sqlLiteral(sale.shiftId)};`, 'Refund counter');

  const report = await readJson(`${ownerClaims}
    SELECT public.get_cash_shift_closing_report(${sqlLiteral(sale.shiftId)});`, 'Live closing report');

  const close = await readJson(`${ownerClaims}
    SELECT public.close_cash_shift(
      ${sqlLiteral(sale.shiftId)},${after.expectedCashInMinorUnits},NULL
    );`, 'Close shift at summary expected cash');
  const closed = await readJson(`SELECT jsonb_build_object(
    'cashRefunds',cash_refunds_in_minor_units,
    'expectedCash',expected_cash_in_minor_units,
    'snapshotReturnCount',(closing_report_snapshot #>> '{outflows,returnCount}')::INTEGER
  ) FROM public.cash_shifts WHERE id=${sqlLiteral(sale.shiftId)};`, 'Closed shift state');

  const breakdownAmount = (report.returnBreakdown || [])
    .filter((item) => item.refundMethod === 'cash' && item.stockDisposition === 'damaged')
    .reduce((sum, item) => sum + Number(item.amountInMinorUnits), 0);

  if (fixed) {
    assert.equal(refundDelta, refundAmount, 'Summary must include the settled refund.');
    assert.equal(expectedDelta, -refundAmount, 'Expected cash must drop by the refund.');
    assert.equal(closed.cashRefunds, counter.value, 'Close must keep the refund counter.');
    assert.equal(closed.cashRefunds, after.cashRefundsInMinorUnits);
    assert.equal(report.outflows.returnCount, 1);
    assert.equal(closed.snapshotReturnCount, 1);
    assert.equal(breakdownAmount, refundAmount);
  } else {
    assert.equal(refundDelta, 0, 'Pre-fix summary ignores Phase 4.2 refunds.');
    assert.equal(expectedDelta, 0, 'Pre-fix expected cash ignores Phase 4.2 refunds.');
    assert.equal(counter.value, refundAmount, 'Migration 121 increments the counter.');
    assert.equal(closed.cashRefunds, 0, 'Pre-fix close overwrites the counter.');
    assert.equal(report.outflows.returnCount, 0);
  }
  return {
    refundAmount, refundDelta, expectedDelta,
    counterBeforeClose: counter.value, cashRefundsAfterClose: closed.cashRefunds,
    discrepancyAtClose: close.cashDiscrepancyInMinorUnits ?? close.cash_discrepancy_in_minor_units ?? null,
    reportReturnCount: report.outflows.returnCount, snapshotReturnCount: closed.snapshotReturnCount,
  };
};

// Finding B: the non-idempotent writer must not be callable by app users.
const runGrantScenario = async () => {
  const grants = await readJson(`SELECT jsonb_build_object(
    'legacy',has_function_privilege('authenticated',
      'public.record_customer_order_payment(uuid,bigint,text,text,text)','EXECUTE'),
    'once',has_function_privilege('authenticated',
      'public.record_customer_order_payment_once(uuid,bigint,text,text,text,text)','EXECUTE')
  );`, 'Payment writer grants');
  assert.equal(grants.once, true);
  assert.equal(grants.legacy, !fixed);
  return grants;
};

// Finding A: a same-key replay with a different amount must be rejected.
const runReplayScenario = async () => {
  await runSqlText(`INSERT INTO public.customers(id,full_name,phone,credit_limit_in_minor_units)
    VALUES (${sqlLiteral(customerId)},'Phase 5 fix customer','0795500001',1000000);`,
  'Create debt customer');
  const sale = await createBaseSale({
    key: 'phase5-fix-debt-sale-0001', quantity: 2,
    paymentMethod: 'debt', amountPaid: 0, customer: customerId,
  });
  const key = 'phase5-fix-payment-key-0001';
  const pay = (amount) => `${ownerClaims}
    SELECT public.record_customer_order_payment_once(
      ${sqlLiteral(sale.orderId)},${amount},'cash',NULL,NULL,${sqlLiteral(key)}
    );`;
  const first = await readJson(pay(500), 'First payment');
  assert.equal(first.idempotent, false);
  const replay = await readJson(pay(500), 'Identical replay');
  assert.equal(replay.idempotent, true);
  assert.equal(replay.payment_id, first.payment_id);

  let changed;
  if (fixed) {
    const failure = await runSqlText(pay(700), 'Changed replay', { expectFailure: true });
    assert.match(failure.stderr, /PAYMENT_IDEMPOTENCY_CONFLICT/u);
    changed = 'rejected';
  } else {
    const accepted = await readJson(pay(700), 'Changed replay accepted pre-fix');
    assert.equal(accepted.idempotent, true);
    assert.equal(accepted.amount_in_minor_units, 500);
    changed = 'silently-accepted';
  }
  const state = await readJson(`SELECT jsonb_build_object(
    'payments',(SELECT count(*) FROM public.customer_payments WHERE order_id=${sqlLiteral(sale.orderId)}),
    'paid',(SELECT amount_paid_in_minor_units FROM public.orders WHERE id=${sqlLiteral(sale.orderId)})
  );`, 'Payment state');
  assert.deepEqual(state, { payments: 1, paid: 500 });
  return { changedPayloadReplay: changed, ...state };
};

try {
  const { stdout } = await execFileAsync(process.execPath, [bootstrapPath], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NAWASRAH_ISOLATED_PROJECT_ID: projectId,
      NAWASRAH_SKIP_REDUNDANT_DB_RESET: 'true',
      NAWASRAH_MAX_MIGRATION: fixed ? '128' : '127',
      NAWASRAH_SUPABASE_EXCLUDE:
        'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor',
    },
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    timeout: 600_000,
  });
  const bootstrap = JSON.parse(stdout);
  assert.equal(bootstrap.ok, true);
  isolatedProjectRoot = bootstrap.isolatedProjectRoot;

  const phase3 = await readJson(await readFile(phase3SqlPath, 'utf8'), 'Phase 3 prerequisite fixture');
  assert.equal(phase3.ok, true);

  const grants = await runGrantScenario();
  const replay = await runReplayScenario();
  const shiftRefund = await runShiftRefundScenario();

  let lint = 'skipped-before-mode';
  if (fixed) {
    const { stdout: lintOutput } = await execFileAsync(
      process.execPath,
      [cliPath, 'db', 'lint', '--local', '--level', 'warning', '--workdir', isolatedProjectRoot],
      { cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024 * 8, timeout: 180_000 },
    );
    if (/ERROR:/u.test(lintOutput)) throw new Error(`Database lint failed:\n${lintOutput}`);
    lint = 'PASS';
  }

  console.log(JSON.stringify({
    ok: true, mode, freshRebuild: fixed ? '001-128' : '001-127',
    grants, replay, shiftRefund, lint,
  }, null, 2));
} finally {
  if (isolatedProjectRoot) {
    await execFileAsync(
      process.execPath,
      [cliPath, 'stop', '--no-backup', '--workdir', isolatedProjectRoot],
      { cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024, timeout: 120_000 },
    );
  }
}
