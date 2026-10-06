// Phase 5 re-scope runtime proof (docs/agent/PHASE5_RESCOPE.md).
// Default mode builds 001-129 and asserts findings C, B, A and A+ are fixed,
// full-shift reversal stays atomic around a non-reversible operation, and the
// D lock-order path completes without deadlock in both real orderings.
// NAWASRAH_PHASE5_FIX_MODE=before builds 001-127 and asserts the same
// scenarios reproduce the original defects, so the proof is two-sided.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
const productB = '92400000-0000-0000-0000-000000000102';
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

const startSession = (name) => {
  const child = spawn('docker', [
    'exec', '-i', databaseContainer, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1',
  ], { cwd: projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.write(`SET application_name=${sqlLiteral(name)};
    SET statement_timeout='60s'; SET lock_timeout='30s';\n`);
  const completed = new Promise((resolve) => {
    child.on('close', (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
  return { child, completed, output: () => ({ stdout, stderr }) };
};

const waitForBlocked = async (name) => {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const state = await readJson(`SELECT jsonb_build_object('blocked',exists(
      SELECT 1 FROM pg_stat_activity activity
      WHERE activity.application_name=${sqlLiteral(name)}
        AND cardinality(pg_blocking_pids(activity.pid))>0));`, 'Blocked session probe');
    if (state.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Session ${name} did not block as expected.`);
};

const createBaseSale = async ({ key, quantity, paymentMethod, amountPaid, customer = null,
  targetBranchId = branchId, targetWarehouseId = warehouseId, productId = productA }) => {
  const items = JSON.stringify([{
    commercial_line_kind: 'base_unit',
    product_id: productId,
    base_quantity: quantity,
    price_authority: 'server_catalog',
    line_discount_in_minor_units: 0,
  }]);
  const result = await readJson(`${ownerClaims}
    SELECT public.create_pos_sale_v2(
      ${sqlLiteral(targetWarehouseId)},${sqlLiteral(targetBranchId)},
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

const deadlockCount = async () => Number((await readJson(`SELECT jsonb_build_object('value',deadlocks)
  FROM pg_stat_database WHERE datname=current_database();`, 'Deadlock counter')).value);

// Every row a full-shift reversal could touch for this shift, plus global
// audit/inventory totals. Equal before/after proves zero partial writes.
const shiftFingerprint = async (shiftId) => (await readJson(`SELECT jsonb_build_object('value',md5(concat_ws('|',
  (SELECT to_jsonb(s)::text FROM public.cash_shifts s WHERE s.id=${sqlLiteral(shiftId)}),
  (SELECT count(*)::text FROM public.cash_shift_reversals WHERE shift_id=${sqlLiteral(shiftId)}),
  (SELECT string_agg(to_jsonb(o)::text,',' ORDER BY o.id) FROM public.orders o WHERE o.cash_shift_id=${sqlLiteral(shiftId)}),
  (SELECT string_agg(to_jsonb(p)::text,',' ORDER BY p.id) FROM public.customer_payments p WHERE p.cash_shift_id=${sqlLiteral(shiftId)}),
  (SELECT string_agg(to_jsonb(e)::text,',' ORDER BY e.id) FROM public.operational_expenses e WHERE e.shift_id=${sqlLiteral(shiftId)}),
  (SELECT count(*)::text FROM public.pos_sale_reversals),
  (SELECT count(*)::text FROM public.audit_logs),
  (SELECT sum(on_hand_quantity)::text||'/'||sum(reserved_quantity)::text FROM public.inventory_balances)
)));`, `Fingerprint shift ${shiftId}`)).value;

const createShiftBranch = async (suffix) => {
  const ids = { branch: randomUUID(), warehouse: randomUUID(), shift: randomUUID() };
  await runSqlText(`
    INSERT INTO public.branches(id,code,name_ar,is_active)
    VALUES (${sqlLiteral(ids.branch)},${sqlLiteral(`P5-${suffix}`)},${sqlLiteral(`Phase 5 ${suffix}`)},true);
    INSERT INTO public.warehouses(id,branch_id,code,name_ar,is_active)
    VALUES (${sqlLiteral(ids.warehouse)},${sqlLiteral(ids.branch)},${sqlLiteral(`P5-WH-${suffix}`)},
      ${sqlLiteral(`Phase 5 WH ${suffix}`)},true);
    INSERT INTO public.cash_shifts(id,shift_number,branch_id,opened_by,opening_cash_in_minor_units)
    VALUES (${sqlLiteral(ids.shift)},${sqlLiteral(`P5-SHIFT-${suffix}`)},${sqlLiteral(ids.branch)},
      ${sqlLiteral(ownerId)},0);
    INSERT INTO public.inventory_balances(warehouse_id,product_id,on_hand_quantity,reserved_quantity)
    VALUES (${sqlLiteral(ids.warehouse)},${sqlLiteral(productA)},20,0),
           (${sqlLiteral(ids.warehouse)},${sqlLiteral(productB)},20,0);`, `Branch/shift ${suffix}`);
  return ids;
};

const reverseReceiptSql = (paymentId) => `${ownerClaims}
  SELECT public.reverse_customer_order_payment(${sqlLiteral(paymentId)},'Phase 5 probe');`;

// Full-shift reversal is all-or-nothing on the real path: a shift with
// reversible POS cash sale + expense and one non-reversible operation (a debt
// sale with a later receipt) is rejected with zero writes anywhere.
const runShiftAtomicityScenario = async () => {
  const ids = await createShiftBranch('ATOM');
  await createBaseSale({
    key: 'phase5-atomic-cash-sale-0001', quantity: 1, paymentMethod: 'cash', amountPaid: 1000,
    targetBranchId: ids.branch, targetWarehouseId: ids.warehouse,
  });
  await readJson(`${ownerClaims}
    SELECT public.create_operational_expense(${sqlLiteral(ids.branch)},
      'Phase 5 atomicity','Reversible expense',150,'cash',NULL);`, 'Reversible expense');
  const debtSale = await createBaseSale({
    key: 'phase5-atomic-debt-sale-0001', quantity: 1, paymentMethod: 'debt', amountPaid: 0,
    customer: customerId, targetBranchId: ids.branch, targetWarehouseId: ids.warehouse, productId: productB,
  });
  await readJson(`${ownerClaims}
    SELECT public.record_customer_order_payment_once(${sqlLiteral(debtSale.orderId)},300,'cash',NULL,NULL,
      'phase5-atomic-receipt-key-0001');`, 'Later receipt on debt sale');

  const preview = await readJson(`${ownerClaims}
    SELECT public.preview_cash_shift_full_reversal(${sqlLiteral(ids.shift)});`, 'Atomicity preview');
  const supported = preview.operations.filter((operation) => operation.status === 'SUPPORTED').length;
  const blocked = preview.operations.filter((operation) => operation.status === 'BLOCKED').length;
  assert.equal(preview.canExecute, false);
  assert.ok(supported >= 2, `POS cash sale and expense are reversible on their own: ${JSON.stringify(preview.operations)}`);
  assert.ok(blocked >= 1);

  const before = await shiftFingerprint(ids.shift);
  const execution = await runSqlText(`${ownerClaims}
    SELECT public.reverse_cash_shift_with_operations(
      ${sqlLiteral(ids.shift)},'Phase 5 atomicity probe',${sqlLiteral(`phase5-atomic-${randomUUID()}`)});`,
  'Full-shift reversal with a non-reversible operation', { expectFailure: true });
  assert.match(execution.stderr, /عكس الوردية محجوب/u);
  assert.equal(await shiftFingerprint(ids.shift), before);
  return { supportedOperations: supported, blockedOperations: blocked, execution: 'rejected-zero-writes' };
};

// Finding A+ (owner decision: block). No current writer can create a receipt
// on a completed non-debt order: receipts need an outstanding balance and
// settlement receipts are only written for debt completions. The state is
// therefore FAULT-INJECTED with triggers disabled, to exercise the guard.
const runPaidOrderReversalScenario = async () => {
  const ids = await createShiftBranch('APLUS');
  const sale = await createBaseSale({
    key: 'phase5-aplus-debt-sale-0001', quantity: 2, paymentMethod: 'debt', amountPaid: 0,
    customer: customerId, targetBranchId: ids.branch, targetWarehouseId: ids.warehouse,
  });
  const receipt = await readJson(`${ownerClaims}
    SELECT public.record_customer_order_payment_once(${sqlLiteral(sale.orderId)},500,'cash',NULL,NULL,
      'phase5-aplus-receipt-key-0001');`, 'Receipt on debt sale');
  await runSqlText(`SET session_replication_role = replica;
    UPDATE public.orders SET payment_method='cash_on_delivery', payment_status='paid',
      amount_paid_in_minor_units=total_in_minor_units
    WHERE id=${sqlLiteral(sale.orderId)};
    SET session_replication_role = origin;`, 'FAULT INJECTION: completed non-debt order with receipt');

  if (!fixed) {
    await readJson(reverseReceiptSql(receipt.payment_id), 'Pre-fix receipt reversal');
    const after = await readJson(`SELECT jsonb_build_object(
      'reversed',(SELECT is_reversed FROM public.customer_payments WHERE id=${sqlLiteral(receipt.payment_id)}),
      'amountPaid',(SELECT amount_paid_in_minor_units FROM public.orders WHERE id=${sqlLiteral(sale.orderId)}),
      'total',(SELECT total_in_minor_units FROM public.orders WHERE id=${sqlLiteral(sale.orderId)}));`,
    'Pre-fix state after reversal');
    assert.equal(after.reversed, true);
    assert.equal(after.amountPaid, after.total, 'Pre-fix: receipt reversed but order stays fully paid.');
    return { state: 'fault-injected', standalone: 'accepted-order-stays-paid' };
  }

  const before = await shiftFingerprint(ids.shift);
  const failure = await runSqlText(reverseReceiptSql(receipt.payment_id), 'Guarded receipt reversal',
    { expectFailure: true });
  assert.match(failure.stderr, /PAYMENT_REVERSAL_PAID_ORDER_UNSUPPORTED/u);
  assert.equal(await shiftFingerprint(ids.shift), before);
  return { state: 'fault-injected', standalone: 'rejected-zero-writes' };
};


const createDedicatedBranch = async (suffix) => {
  const ids = { branch: randomUUID(), warehouse: randomUUID(), shift: randomUUID() };
  await runSqlText(`
    INSERT INTO public.branches(id,code,name_ar,is_active)
    VALUES (${sqlLiteral(ids.branch)},${sqlLiteral(`P5D-${suffix}`)},${sqlLiteral(`Phase 5 D ${suffix}`)},true);
    INSERT INTO public.warehouses(id,branch_id,code,name_ar,is_active)
    VALUES (${sqlLiteral(ids.warehouse)},${sqlLiteral(ids.branch)},${sqlLiteral(`P5D-WH-${suffix}`)},
      ${sqlLiteral(`Phase 5 D WH ${suffix}`)},true);
    INSERT INTO public.cash_shifts(id,shift_number,branch_id,opened_by,opening_cash_in_minor_units)
    VALUES (${sqlLiteral(ids.shift)},${sqlLiteral(`P5D-SHIFT-${suffix}`)},${sqlLiteral(ids.branch)},
      ${sqlLiteral(ownerId)},0);
    INSERT INTO public.inventory_balances(warehouse_id,product_id,on_hand_quantity,reserved_quantity)
    VALUES (${sqlLiteral(ids.warehouse)},${sqlLiteral(productA)},20,0),
           (${sqlLiteral(ids.warehouse)},${sqlLiteral(productB)},20,0);`, `Dedicated branch ${suffix}`);
  // A reversible POS cash sale so full-shift reversal really runs and holds locks.
  await createBaseSale({
    key: `phase5-d-${suffix}-pos-sale-0001`, quantity: 1, paymentMethod: 'cash', amountPaid: 1000,
    targetBranchId: ids.branch, targetWarehouseId: ids.warehouse,
  });
  // A legacy V1 website order on the same branch, ready for cash completion.
  const created = await readJson(`${ownerClaims}
    SELECT public.create_customer_order(
      'عميل Phase 5 D',${sqlLiteral(`0791555${suffix}`)},NULL,'Irbid','Ramtha','D','Street','1',
      NULL,NULL,NULL,NULL,NULL,'D address',NULL,'manual',
      ${sqlLiteral(ids.branch)},${sqlLiteral(ids.warehouse)},
      ${sqlLiteral(JSON.stringify([{ product_id: productB, quantity: 1 }]))}::jsonb,
      0,0,'Phase 5 D order',NULL,'website');`, `Create V1 website order ${suffix}`);
  ids.order = created.order_id;
  assert.ok(ids.order);
  await runSqlText(`${ownerClaims}
    SELECT public.update_order_status(${sqlLiteral(ids.order)},'confirmed','D');
    SELECT public.update_order_status(${sqlLiteral(ids.order)},'preparing','D');
    SELECT public.update_order_status(${sqlLiteral(ids.order)},'ready','D');`, `Ready V1 order ${suffix}`);
  const attached = await readJson(`SELECT jsonb_build_object('shift',cash_shift_id)
    FROM public.orders WHERE id=${sqlLiteral(ids.order)};`, 'V1 order shift before completion');
  assert.equal(attached.shift, null, 'A not-yet-completed website order is not attached to any shift.');
  return ids;
};

const completionSql = (orderId) => `${ownerClaims}
  SELECT public.complete_website_order_with_payment(${sqlLiteral(orderId)},'cash',NULL,'Phase 5 D');`;
const shiftReversalSql = (shiftId) => `${ownerClaims}
  SELECT public.reverse_cash_shift_with_operations(
    ${sqlLiteral(shiftId)},'Phase 5 D probe',${sqlLiteral(`phase5-d-${randomUUID()}`)});`;

const holdThenRace = async ({ label, holderSql, racerSql }) => {
  const holder = startSession(`p5d-${label}-holder`);
  holder.child.stdin.write(`BEGIN;\n${holderSql}\nSELECT 'HOLDER_DONE';\n`);
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const { stdout, stderr } = holder.output();
    if (stdout.includes('HOLDER_DONE')) break;
    if (stderr.includes('ERROR')) throw new Error(`D holder ${label} failed:\n${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.ok(holder.output().stdout.includes('HOLDER_DONE'), `D holder ${label} did not finish.`);
  const racer = startSession(`p5d-${label}-racer`);
  racer.child.stdin.end(`${racerSql}\n`);
  await waitForBlocked(`p5d-${label}-racer`);
  holder.child.stdin.end('COMMIT;\n');
  const [holderResult, racerResult] = await Promise.all([holder.completed, racer.completed]);
  return { holderResult, racerResult };
};

// Finding D: complete_website_order_with_payment locks Order -> Shift while
// full-shift reversal locks Shift -> Orders(cash_shift_id = shift). Both real
// orderings on real functions, measured by PostgreSQL's deadlock counter.
const runLockOrderScenario = async () => {
  const deadlocksBefore = await deadlockCount();

  const first = await createDedicatedBranch('101');
  const completionFirst = await holdThenRace({
    label: 'completion-first', holderSql: completionSql(first.order), racerSql: shiftReversalSql(first.shift),
  });
  assert.equal(completionFirst.holderResult.code, 0, completionFirst.holderResult.stderr);
  assert.notEqual(completionFirst.racerResult.code, 0);
  assert.doesNotMatch(completionFirst.racerResult.stderr, /deadlock/iu);
  // The waiting reversal either sees the newly attached website order in its
  // preview, or its lock planner detects the changed resource set (40001 safe
  // retry, by design). A retry must then hit the business block, never a write.
  const planChanged = /PHASE4_LOCK_PLAN_CHANGED_RETRY/u.test(completionFirst.racerResult.stderr);
  if (!planChanged) assert.match(completionFirst.racerResult.stderr, /عكس الوردية محجوب/u);
  const retry = await runSqlText(shiftReversalSql(first.shift), 'D reversal retry', { expectFailure: true });
  assert.match(retry.stderr, /عكس الوردية محجوب/u);

  const second = await createDedicatedBranch('102');
  const reversalFirst = await holdThenRace({
    label: 'reversal-first', holderSql: shiftReversalSql(second.shift), racerSql: completionSql(second.order),
  });
  assert.equal(reversalFirst.holderResult.code, 0, reversalFirst.holderResult.stderr);
  assert.doesNotMatch(reversalFirst.racerResult.stderr, /deadlock/iu);
  const racerOutcome = reversalFirst.racerResult.code === 0
    ? 'completed-after-reversal-commit'
    : reversalFirst.racerResult.stderr.split(/\r?\n/u).find((line) => /ERROR/u.test(line)) || 'error';

  const deadlockDelta = (await deadlockCount()) - deadlocksBefore;
  assert.equal(deadlockDelta, 0);
  return {
    completionFirst: {
      completion: 'committed',
      waitingReversal: planChanged ? 'PHASE4_LOCK_PLAN_CHANGED_RETRY (40001 safe retry)' : 'business block',
      retry: 'business block (website order not reversible)',
    },
    reversalFirst: { reversal: 'committed', websiteCompletion: racerOutcome },
    preCompletionOrderShift: null,
    deadlockDelta,
  };
};

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
      NAWASRAH_MAX_MIGRATION: fixed ? '129' : '127',
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
  const shiftAtomicity = await runShiftAtomicityScenario();
  const paidOrderReversal = await runPaidOrderReversalScenario();
  const lockOrder = fixed ? await runLockOrderScenario() : 'after-mode-only';
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
    ok: true, mode, freshRebuild: fixed ? '001-129' : '001-127',
    grants, replay, shiftAtomicity, paidOrderReversal, lockOrder, shiftRefund, lint,
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
