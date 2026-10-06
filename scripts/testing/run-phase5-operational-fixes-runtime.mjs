// Phase 5 re-scope runtime proof (docs/agent/PHASE5_RESCOPE.md).
// Default mode builds 001-130 and asserts findings C, B, A, A+ and the review
// follow-ups (H1 cancel guard, M2 monitoring, L7 CliQ reference) are fixed,
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
    key: 'phase5-atomic-cash-sale-0001', quantity: 1, paymentMethod: 'cash', amountPaid: 1000, // gitleaks:allow test fixture
    targetBranchId: ids.branch, targetWarehouseId: ids.warehouse,
  });
  await readJson(`${ownerClaims}
    SELECT public.create_operational_expense(${sqlLiteral(ids.branch)},
      'Phase 5 atomicity','Reversible expense',150,'cash',NULL);`, 'Reversible expense');
  const debtSale = await createBaseSale({
    key: 'phase5-atomic-debt-sale-0001', quantity: 1, paymentMethod: 'debt', amountPaid: 0, // gitleaks:allow test fixture
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

const previewShift = (shiftId) => readJson(`${ownerClaims}
  SELECT public.preview_cash_shift_full_reversal(${sqlLiteral(shiftId)});`, 'Full-shift preview');
const reverseShiftSql = (shiftId, label) => `${ownerClaims}
  SELECT public.reverse_cash_shift_with_operations(
    ${sqlLiteral(shiftId)},${sqlLiteral(`Phase 5 ${label} probe`)},${sqlLiteral(`phase5-${label}-${randomUUID()}`)});`;
const orderPaymentState = (orderId, paymentId) => readJson(`SELECT jsonb_build_object(
  'reversed',(SELECT is_reversed FROM public.customer_payments WHERE id=${sqlLiteral(paymentId)}),
  'amountPaid',(SELECT amount_paid_in_minor_units FROM public.orders WHERE id=${sqlLiteral(orderId)}),
  'total',(SELECT total_in_minor_units FROM public.orders WHERE id=${sqlLiteral(orderId)}),
  'order',(SELECT md5(to_jsonb(o)::text) FROM public.orders o WHERE o.id=${sqlLiteral(orderId)}));`,
'Order/receipt state');

// Finding A+ (owner decision: block). No current writer can create a receipt
// on a completed non-debt order: receipts need an outstanding balance and
// settlement receipts are only written for debt completions. The state is
// therefore FAULT-INJECTED with triggers disabled, to exercise the guard.
// The order is also made a website order not attached to the shift, so the
// pre-existing POS/website rules of Migration 084 do not mask the A+ rule.
const runPaidOrderReversalScenario = async () => {
  const ids = await createShiftBranch('APLUS');
  const sale = await createBaseSale({
    key: 'phase5-aplus-debt-sale-0001', quantity: 2, paymentMethod: 'debt', amountPaid: 0, // gitleaks:allow test fixture
    customer: customerId, targetBranchId: ids.branch, targetWarehouseId: ids.warehouse,
  });
  const receipt = await readJson(`${ownerClaims}
    SELECT public.record_customer_order_payment_once(${sqlLiteral(sale.orderId)},500,'cash',NULL,NULL,
      'phase5-aplus-receipt-key-0001');`, 'Receipt on debt sale');
  await runSqlText(`SET session_replication_role = replica;
    UPDATE public.orders SET source='website', cash_shift_id=NULL,
      payment_method='cash_on_delivery', payment_status='paid',
      amount_paid_in_minor_units=total_in_minor_units
    WHERE id=${sqlLiteral(sale.orderId)};
    SET session_replication_role = origin;`, 'FAULT INJECTION: completed non-debt website order with receipt');

  const preview = await previewShift(ids.shift);
  const receiptOperation = preview.operations.find((operation) =>
    operation.operationType === 'customer_payment' && operation.originalRecordId === receipt.payment_id);

  if (!fixed) {
    assert.equal(receiptOperation?.status, 'SUPPORTED');
    assert.equal(preview.canExecute, true);
    await readJson(reverseShiftSql(ids.shift, 'aplus'), 'Pre-fix full-shift reversal');
    const after = await orderPaymentState(sale.orderId, receipt.payment_id);
    assert.equal(after.reversed, true);
    assert.equal(after.amountPaid, after.total, 'Pre-fix: receipt reversed but order stays fully paid.');
    return { state: 'fault-injected', preview: 'SUPPORTED', fullShift: 'accepted-order-stays-paid' };
  }

  assert.equal(receiptOperation?.status, 'BLOCKED');
  assert.match(receiptOperation.reason, /غير آجل/u);
  assert.doesNotMatch(receiptOperation.reason, /مرتجع/u);
  assert.equal(preview.canExecute, false);

  const shiftBefore = await shiftFingerprint(ids.shift);
  const orderBefore = await orderPaymentState(sale.orderId, receipt.payment_id);
  const standalone = await runSqlText(reverseReceiptSql(receipt.payment_id), 'Guarded receipt reversal',
    { expectFailure: true });
  assert.match(standalone.stderr, /PAYMENT_REVERSAL_PAID_ORDER_UNSUPPORTED/u);
  const execution = await runSqlText(reverseShiftSql(ids.shift, 'aplus'), 'Guarded full-shift reversal',
    { expectFailure: true });
  assert.match(execution.stderr, /عكس الوردية محجوب/u);
  assert.equal(await shiftFingerprint(ids.shift), shiftBefore);
  assert.deepEqual(await orderPaymentState(sale.orderId, receipt.payment_id), orderBefore);
  return {
    state: 'fault-injected', preview: 'BLOCKED',
    standalone: 'rejected-zero-writes', fullShift: 'rejected-zero-writes',
  };
};

// Mid-execution rollback: a fault injected after the expense has already been
// reversed inside the loop (operations run ordered by type: expense, then POS
// sale) must roll back everything, including the reversal header.
const runMidExecutionRollbackScenario = async () => {
  const ids = await createShiftBranch('ROLLBACK');
  await createBaseSale({
    key: 'phase5-rollback-cash-sale-0001', quantity: 1, paymentMethod: 'cash', amountPaid: 1000, // gitleaks:allow test fixture
    targetBranchId: ids.branch, targetWarehouseId: ids.warehouse,
  });
  await readJson(`${ownerClaims}
    SELECT public.create_operational_expense(${sqlLiteral(ids.branch)},
      'Phase 5 rollback','Reversible expense',150,'cash',NULL);`, 'Reversible expense');
  const preview = await previewShift(ids.shift);
  assert.equal(preview.canExecute, true, JSON.stringify(preview.operations));

  const before = await shiftFingerprint(ids.shift);
  await runSqlText(`
    CREATE FUNCTION public.phase5_test_fault_after_expense() RETURNS TRIGGER
    LANGUAGE plpgsql AS $fault$
    BEGIN
      RAISE EXCEPTION 'PHASE5_FAULT_INJECTED expense_reversed=%', (
        SELECT bool_and(expense.is_reversed) FROM public.operational_expenses expense
        JOIN public.orders customer_order ON customer_order.cash_shift_id = expense.shift_id
        WHERE customer_order.id = NEW.order_id);
    END;
    $fault$;
    CREATE TRIGGER trg_phase5_test_fault_after_expense
    BEFORE INSERT ON public.pos_sale_reversals
    FOR EACH ROW EXECUTE FUNCTION public.phase5_test_fault_after_expense();`, 'Install fault injection');
  let failure;
  try {
    failure = await runSqlText(reverseShiftSql(ids.shift, 'rollback'), 'Faulted full-shift reversal',
      { expectFailure: true });
  } finally {
    await runSqlText(`DROP TRIGGER trg_phase5_test_fault_after_expense ON public.pos_sale_reversals;
      DROP FUNCTION public.phase5_test_fault_after_expense();`, 'Remove fault injection');
  }
  assert.match(failure.stderr, /PHASE5_FAULT_INJECTED expense_reversed=t/u,
    'The fault must fire after the expense reversal was already applied.');
  assert.equal(await shiftFingerprint(ids.shift), before);
  return { faultAfter: 'expense reversed', result: 'full rollback, zero residue' };
};

const settleReturnSql = ({ orderId, orderItemId, key, method, disposition = 'restock', reference = null }) => `${ownerClaims}
  SELECT public.settle_sales_return_v1(
    ${sqlLiteral(orderId)},${sqlLiteral(key)},
    ${sqlLiteral(JSON.stringify([{
      return_scope: 'base_unit', order_item_id: orderItemId, quantity: 1, stock_disposition: disposition,
    }]))}::jsonb,
    'Phase 5 runtime proof',${sqlLiteral(method)},${reference ? sqlLiteral(reference) : 'NULL'},NULL
  );`;

const monitoringClosingIssues = async () => {
  await runSqlText('SELECT public.run_advanced_monitoring_checks(NOW());', 'Run monitoring checks');
  return (await readJson(`SELECT jsonb_build_object('value',issue_count)
    FROM public.advanced_monitoring_checks WHERE check_key='integrity:shifts:closing';`,
  'Shift closing check')).value;
};

// H1 + M2: a shift whose only activity is a Phase 4.2 refund is not empty, and
// an open shift with such a refund is not a monitoring mismatch.
const runCancelEmptyShiftScenario = async () => {
  const ids = await createShiftBranch('CANCEL');
  const sale = await createBaseSale({
    key: 'phase5-cancel-cash-sale-0001', quantity: 2, paymentMethod: 'cash', amountPaid: 2000, // gitleaks:allow test fixture
    targetBranchId: ids.branch, targetWarehouseId: ids.warehouse,
  });
  const firstSummary = await summary(ids.shift);
  await readJson(`${ownerClaims}
    SELECT public.close_cash_shift(${sqlLiteral(ids.shift)},${firstSummary.expectedCashInMinorUnits},NULL);`,
  'Close first shift');
  const refundShift = randomUUID();
  // Opened like open_cash_shift: expected cash starts at the opening amount.
  await runSqlText(`INSERT INTO public.cash_shifts(id,shift_number,branch_id,opened_by,
      opening_cash_in_minor_units,expected_cash_in_minor_units)
    VALUES (${sqlLiteral(refundShift)},'P5-SHIFT-CANCEL-2',${sqlLiteral(ids.branch)},${sqlLiteral(ownerId)},500,500);`,
  'Open refund-only shift');

  const issuesBefore = await monitoringClosingIssues();
  await readJson(settleReturnSql({
    orderId: sale.orderId, orderItemId: sale.orderItemId, key: 'phase5-cancel-return-0001', method: 'cash', // gitleaks:allow test fixture
  }), 'Refund into the new shift');
  const attached = await readJson(`SELECT jsonb_build_object('value',count(*))
    FROM public.sales_return_events WHERE cash_shift_id=${sqlLiteral(refundShift)} AND settlement_status='settled';`,
  'Refund attached to new shift');
  assert.equal(attached.value, 1);
  const issuesAfter = await monitoringClosingIssues();

  const cancelSql = `${ownerClaims}
    SELECT public.cancel_empty_cash_shift(${sqlLiteral(refundShift)},'opened by mistake');`;
  const before = await shiftFingerprint(refundShift);
  if (!fixed) {
    assert.equal(issuesAfter - issuesBefore, 1, 'Pre-fix monitoring flags the open shift with a refund.');
    await readJson(cancelSql, 'Pre-fix cancel of refund-only shift');
    const status = await readJson(`SELECT jsonb_build_object('value',status)
      FROM public.cash_shifts WHERE id=${sqlLiteral(refundShift)};`, 'Cancelled status');
    assert.equal(status.value, 'cancelled');
    return { monitoringIssueDelta: 1, cancel: 'accepted-refund-leaves-accounting' };
  }
  assert.equal(issuesAfter - issuesBefore, 0, 'An open shift with a Phase 4.2 refund is not a mismatch.');
  const failure = await runSqlText(cancelSql, 'Cancel refund-only shift', { expectFailure: true });
  assert.match(failure.stderr, /تحتوي حركة مالية/u);
  assert.equal(await shiftFingerprint(refundShift), before);
  return { monitoringIssueDelta: 0, cancel: 'rejected-zero-writes' };
};

// Real app role: the SECURITY DEFINER paths still work for `authenticated`,
// while the revoked legacy writer is denied (B) without a superuser shortcut.
const runAuthenticatedRoleScenario = async () => {
  const sale = await createBaseSale({
    key: 'phase5-role-debt-sale-0001', quantity: 1, paymentMethod: 'debt', amountPaid: 0, // gitleaks:allow test fixture
    customer: customerId, productId: productB,
  });
  const asApp = (sql) => `BEGIN; ${ownerClaims} SET LOCAL ROLE authenticated; ${sql} COMMIT;`;
  const once = await readJson(asApp(`SELECT public.record_customer_order_payment_once(
    ${sqlLiteral(sale.orderId)},200,'cash',NULL,NULL,'phase5-role-payment-key-0001');`), 'Payment as authenticated');
  assert.equal(once.idempotent, false);
  const shiftSummary = await readJson(asApp(`SELECT public.get_cash_shift_summary(${sqlLiteral(sale.shiftId)});`),
    'Shift summary as authenticated');
  assert.ok(Number.isFinite(shiftSummary.expectedCashInMinorUnits));
  const legacySql = `BEGIN; ${ownerClaims} SET LOCAL ROLE authenticated;
    SELECT public.record_customer_order_payment(${sqlLiteral(sale.orderId)},100,'cash',NULL,NULL); ROLLBACK;`;
  if (fixed) {
    const denied = await runSqlText(legacySql, 'Legacy writer as authenticated', { expectFailure: true });
    assert.match(denied.stderr, /permission denied/u);
    return { paymentOnce: 'ok', summary: 'ok', legacyWriter: 'permission denied' };
  }
  await runSqlText(legacySql, 'Legacy writer as authenticated (pre-fix)');
  return { paymentOnce: 'ok', summary: 'ok', legacyWriter: 'executable' };
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
    key: `phase5-d-${suffix}-pos-sale-0001`, quantity: 1, paymentMethod: 'cash', amountPaid: 1000, // gitleaks:allow test fixture
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

const createReadyWebsiteOrder = async (suffix) => {
  const created = await readJson(`${ownerClaims}
    SELECT public.create_customer_order(
      'عميل Phase 5 C',${sqlLiteral(`0791666${suffix}`)},NULL,'Irbid','Ramtha','C','Street','1',
      NULL,NULL,NULL,NULL,NULL,'C address',NULL,'manual',
      ${sqlLiteral(branchId)},${sqlLiteral(warehouseId)},
      ${sqlLiteral(JSON.stringify([{ product_id: productB, quantity: 1 }]))}::jsonb,
      0,0,'Phase 5 C legacy order',NULL,'website');`, `Create legacy website order ${suffix}`);
  assert.ok(created.order_id);
  await runSqlText(`${ownerClaims}
    SELECT public.update_order_status(${sqlLiteral(created.order_id)},'confirmed','C');
    SELECT public.update_order_status(${sqlLiteral(created.order_id)},'preparing','C');
    SELECT public.update_order_status(${sqlLiteral(created.order_id)},'ready','C');`, `Ready legacy order ${suffix}`);
  return created.order_id;
};

// Finding C: settled Phase 4.2 cash and CliQ refunds must reach the cashier's
// summary, the close-time columns and the closing report, alongside legacy
// sales_returns refunds on the same shift without double counting.
const runShiftRefundScenario = async () => {
  const cashSale = await createBaseSale({
    key: 'phase5-fix-cash-sale-0001', quantity: 2, paymentMethod: 'cash', amountPaid: 2000, // gitleaks:allow test fixture
  });
  const cliqSale = await createBaseSale({
    key: 'phase5-fix-cliq-src-sale-0001', quantity: 2, paymentMethod: 'cash', amountPaid: 2000, // gitleaks:allow test fixture
  });
  const legacyOrder = await createReadyWebsiteOrder('201');
  await readJson(`${ownerClaims}
    SELECT public.complete_website_order_with_payment(${sqlLiteral(legacyOrder)},'cash',NULL,'Phase 5 C');`,
  'Complete legacy website order');
  const shiftId = cashSale.shiftId;
  const before = await summary(shiftId);

  const cashRefund = await readJson(settleReturnSql({
    orderId: cashSale.orderId, orderItemId: cashSale.orderItemId,
    key: 'phase5-fix-cash-return-0001', method: 'cash', disposition: 'damaged', // gitleaks:allow test fixture
  }), 'Settle Phase 4.2 cash Return');
  const cliqRefund = await readJson(settleReturnSql({
    orderId: cliqSale.orderId, orderItemId: cliqSale.orderItemId,
    key: 'phase5-fix-cliq-return-0001', method: 'cliq', reference: 'P5-CLIQ-REF-0001', // gitleaks:allow test fixture
  }), 'Settle Phase 4.2 CliQ Return');
  const legacyReturn = await readJson(`${ownerClaims}
    SELECT public.return_completed_website_order(${sqlLiteral(legacyOrder)},'Phase 5 C legacy','restock','cash',NULL,NULL);`,
  'Legacy website order return');
  assert.equal(legacyReturn.success, true);
  const legacyAmount = (await readJson(`SELECT jsonb_build_object('value',sum(refund_amount_in_minor_units))
    FROM public.sales_returns WHERE order_id=${sqlLiteral(legacyOrder)};`, 'Legacy refund amount')).value;
  const c42 = cashRefund.moneyRefundInMinorUnits;
  const q42 = cliqRefund.moneyRefundInMinorUnits;
  assert.ok(c42 > 0 && q42 > 0 && legacyAmount > 0);

  const after = await summary(shiftId);
  const deltas = {
    cashRefunds: after.cashRefundsInMinorUnits - before.cashRefundsInMinorUnits,
    cliqRefunds: after.cliqRefundsInMinorUnits - before.cliqRefundsInMinorUnits,
    expectedCash: after.expectedCashInMinorUnits - before.expectedCashInMinorUnits,
  };
  const counter = await readJson(`SELECT jsonb_build_object('value',cash_refunds_in_minor_units)
    FROM public.cash_shifts WHERE id=${sqlLiteral(shiftId)};`, 'Refund counter');
  const report = await readJson(`${ownerClaims}
    SELECT public.get_cash_shift_closing_report(${sqlLiteral(shiftId)});`, 'Live closing report');
  await readJson(`${ownerClaims}
    SELECT public.close_cash_shift(${sqlLiteral(shiftId)},${after.expectedCashInMinorUnits},NULL);`,
  'Close shift at summary expected cash');
  const closed = await readJson(`SELECT jsonb_build_object(
    'cashRefunds',cash_refunds_in_minor_units,'cliqRefunds',cliq_refunds_in_minor_units,
    'expectedCash',expected_cash_in_minor_units,'discrepancy',cash_discrepancy_in_minor_units,
    'snapshotReturnCount',(closing_report_snapshot #>> '{outflows,returnCount}')::INTEGER
  ) FROM public.cash_shifts WHERE id=${sqlLiteral(shiftId)};`, 'Closed shift state');
  const breakdown = (method, disposition) => (report.returnBreakdown || [])
    .filter((item) => item.refundMethod === method && item.stockDisposition === disposition)
    .reduce((sum, item) => sum + Number(item.amountInMinorUnits), 0);

  assert.equal(closed.expectedCash, after.expectedCashInMinorUnits);
  assert.equal(closed.discrepancy, 0);
  if (fixed) {
    assert.deepEqual(deltas, { cashRefunds: c42 + legacyAmount, cliqRefunds: q42, expectedCash: -(c42 + legacyAmount) });
    assert.equal(closed.cashRefunds, c42 + legacyAmount + before.cashRefundsInMinorUnits);
    assert.equal(closed.cliqRefunds, after.cliqRefundsInMinorUnits);
    assert.equal(report.outflows.returnCount, 3);
    assert.equal(closed.snapshotReturnCount, 3);
    assert.equal(breakdown('cash', 'damaged'), c42);
    assert.equal(breakdown('cliq', 'restock'), q42);
    assert.equal(breakdown('cash', 'restock'), legacyAmount);
  } else {
    assert.deepEqual(deltas, { cashRefunds: legacyAmount, cliqRefunds: 0, expectedCash: -legacyAmount },
      'Pre-fix summary sees only the legacy refund.');
    assert.ok(counter.value >= c42, 'Migration 121 increments the counter.');
    assert.equal(closed.cashRefunds, legacyAmount + before.cashRefundsInMinorUnits,
      'Pre-fix close overwrites the counter without Phase 4.2 refunds.');
    assert.equal(report.outflows.returnCount, 1);
    assert.equal(closed.snapshotReturnCount, 1);
  }
  return {
    phase42Cash: c42, phase42Cliq: q42, legacyCash: legacyAmount, deltas,
    counterBeforeClose: counter.value, closed,
    reportReturnCount: report.outflows.returnCount,
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

// Finding A (+L7): a same-key replay must carry the same order, amount,
// method and, for CliQ, the same reference.
const runReplayScenario = async () => {
  await runSqlText(`INSERT INTO public.customers(id,full_name,phone,credit_limit_in_minor_units)
    VALUES (${sqlLiteral(customerId)},'Phase 5 fix customer','0795500001',1000000);`,
  'Create debt customer');
  const sale = await createBaseSale({
    key: 'phase5-fix-debt-sale-0001', quantity: 2, // gitleaks:allow test fixture
    paymentMethod: 'debt', amountPaid: 0, customer: customerId,
  });
  const otherSale = await createBaseSale({
    key: 'phase5-fix-debt-sale-0002', quantity: 1, // gitleaks:allow test fixture
    paymentMethod: 'debt', amountPaid: 0, customer: customerId,
  });
  const pay = ({ orderId = sale.orderId, amount, method = 'cash', reference = null, key }) => `${ownerClaims}
    SELECT public.record_customer_order_payment_once(
      ${sqlLiteral(orderId)},${amount},${sqlLiteral(method)},${reference ? sqlLiteral(reference) : 'NULL'},NULL,
      ${sqlLiteral(key)});`;
  const cashKey = 'phase5-fix-payment-key-0001'; // gitleaks:allow test fixture
  const cliqKey = 'phase5-fix-payment-key-0002'; // gitleaks:allow test fixture
  const first = await readJson(pay({ amount: 500, key: cashKey }), 'First payment');
  assert.equal(first.idempotent, false);
  const replay = await readJson(pay({ amount: 500, key: cashKey }), 'Identical replay');
  assert.equal(replay.idempotent, true);
  assert.equal(replay.payment_id, first.payment_id);
  const cliq = await readJson(pay({ amount: 300, method: 'cliq', reference: 'P5-REF-0001', key: cliqKey }),
    'CliQ payment');
  assert.equal(cliq.idempotent, false);

  const variants = {
    amount: pay({ amount: 700, key: cashKey }),
    order: pay({ orderId: otherSale.orderId, amount: 500, key: cashKey }),
    method: pay({ amount: 500, method: 'cliq', reference: 'P5-REF-0009', key: cashKey }),
    cliqReference: pay({ amount: 300, method: 'cliq', reference: 'P5-REF-0002', key: cliqKey }),
  };
  const outcomes = {};
  for (const [name, sql] of Object.entries(variants)) {
    if (fixed) {
      const failure = await runSqlText(sql, `Changed ${name} replay`, { expectFailure: true });
      assert.match(failure.stderr, /PAYMENT_IDEMPOTENCY_CONFLICT/u);
      outcomes[name] = 'rejected';
    } else {
      const accepted = await readJson(sql, `Changed ${name} replay accepted pre-fix`);
      assert.equal(accepted.idempotent, true);
      outcomes[name] = 'silently-accepted';
    }
  }
  const state = await readJson(`SELECT jsonb_build_object(
    'payments',(SELECT count(*) FROM public.customer_payments WHERE order_id=${sqlLiteral(sale.orderId)}),
    'otherPayments',(SELECT count(*) FROM public.customer_payments WHERE order_id=${sqlLiteral(otherSale.orderId)}),
    'paid',(SELECT amount_paid_in_minor_units FROM public.orders WHERE id=${sqlLiteral(sale.orderId)})
  );`, 'Payment state');
  assert.deepEqual(state, { payments: 2, otherPayments: 0, paid: 800 });
  return { changedPayloadReplay: outcomes, ...state };
};


try {
  const { stdout } = await execFileAsync(process.execPath, [bootstrapPath], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NAWASRAH_ISOLATED_PROJECT_ID: projectId,
      NAWASRAH_SKIP_REDUNDANT_DB_RESET: 'true',
      NAWASRAH_MAX_MIGRATION: fixed ? '130' : '127',
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
  const midExecutionRollback = await runMidExecutionRollbackScenario();
  const cancelEmptyShift = await runCancelEmptyShiftScenario();
  const authenticatedRole = await runAuthenticatedRoleScenario();
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
    ok: true, mode, freshRebuild: fixed ? '001-130' : '001-127',
    grants, replay, shiftAtomicity, paidOrderReversal, midExecutionRollback, cancelEmptyShift,
    authenticatedRole, lockOrder, shiftRefund, lint,
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
