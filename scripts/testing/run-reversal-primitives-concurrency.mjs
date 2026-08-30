import { spawn } from 'node:child_process';

const container = 'supabase_db_nawasrah-phase7-test';
const owner = '83000000-0000-0000-0000-000000000001';
const supplier = '83000000-0000-0000-0000-000000000050';
const claimsSql = `SELECT set_config('request.jwt.claims', '{"sub":"${owner}","role":"authenticated","aal":"aal2"}', false);`;

const execute = (sql) => new Promise((resolve) => {
  const child = spawn(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A'],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  child.stdin.end(`${claimsSql}\n${sql}`);
});

const run = async (sql) => {
  const result = await execute(sql);
  if (result.code !== 0) throw new Error(`psql failed: ${result.stderr || result.stdout}`);
  return result.stdout.split(/\r?\n/).filter((line) => line && !line.startsWith('{"sub"'));
};

const parseResultJson = (result) => {
  const jsonLine = result.stdout.split(/\r?\n/).reverse().find((line) => line.trim().startsWith('{'));
  return jsonLine ? JSON.parse(jsonLine) : null;
};

const [orderId] = await run("SELECT id FROM public.orders WHERE idempotency_key='rev-pos-concurrent-sale-key-000000001' LIMIT 1;");
const [paymentId] = await run("SELECT id FROM public.supplier_payments WHERE idempotency_key='rev-supplier-concurrent-payment-key-001' LIMIT 1;");
if (!orderId || !paymentId) throw new Error('Phase 2 concurrent fixtures are missing; run reversal-primitives-runtime.sql first.');

const posKey = 'rev-pos-concurrent-reversal-key-000001';
const supplierKey = 'rev-supplier-concurrent-reversal-key-01';
const posSql = `SELECT public.reverse_pos_sale('${orderId}', 'اختبار تزامن عكس POS', '${posKey}');`;
const supplierSql = `SELECT public.reverse_supplier_payment('${paymentId}', 'اختبار تزامن عكس دفعة مورد', '${supplierKey}');`;

const [posFirst, posSecond] = await Promise.all([execute(posSql), execute(posSql)]);
const posResults = [posFirst, posSecond].map(parseResultJson);
if (posFirst.code !== 0 || posSecond.code !== 0
  || posResults.filter((entry) => entry?.success === true && entry.idempotent === false).length !== 1
  || posResults.filter((entry) => entry?.success === true && entry.idempotent === true).length !== 1) {
  throw new Error(`POS concurrent reversal was not exactly-once/idempotent: ${JSON.stringify([posFirst, posSecond])}`);
}

const [supplierFirst, supplierSecond] = await Promise.all([execute(supplierSql), execute(supplierSql)]);
const supplierResults = [supplierFirst, supplierSecond].map(parseResultJson);
if (supplierFirst.code !== 0 || supplierSecond.code !== 0
  || supplierResults.filter((entry) => entry?.success === true && entry.idempotent === false).length !== 1
  || supplierResults.filter((entry) => entry?.success === true && entry.idempotent === true).length !== 1) {
  throw new Error(`Supplier concurrent reversal was not exactly-once/idempotent: ${JSON.stringify([supplierFirst, supplierSecond])}`);
}

const [reconciliation] = await run(`
  SELECT jsonb_build_object(
    'one_pos_reversal', (SELECT COUNT(*) = 1 FROM public.pos_sale_reversals WHERE order_id='${orderId}'),
    'pos_order_cancelled', (SELECT status = 'cancelled' AND amount_paid_in_minor_units = 0 FROM public.orders WHERE id='${orderId}'),
    'one_supplier_reversal', (SELECT COUNT(*) = 1 FROM public.supplier_payment_reversals WHERE supplier_payment_id='${paymentId}'),
    'supplier_payment_reversed', (SELECT is_reversed FROM public.supplier_payments WHERE id='${paymentId}'),
    'no_negative_inventory', NOT EXISTS (SELECT 1 FROM public.inventory_balances WHERE on_hand_quantity < 0),
    'supplier_balance_reconciled', NOT EXISTS (
      SELECT 1
      FROM public.suppliers s
      WHERE s.id='${supplier}'
        AND s.current_balance_in_minor_units <> COALESCE((
          SELECT SUM(sr.amount_due_in_minor_units)
          FROM public.supplier_receipts sr
          WHERE sr.supplier_id=s.id AND sr.status='completed'
        ), 0)
    ),
    'cash_cliq_reconciled', NOT EXISTS (
      SELECT 1
      FROM public.cash_shifts cs
      WHERE cs.id = (SELECT cash_shift_id FROM public.orders WHERE id='${orderId}')
        AND (
          (public.get_cash_shift_summary(cs.id)->>'cashSalesInMinorUnits')::BIGINT <> 100
          OR (public.get_cash_shift_summary(cs.id)->>'cliqSalesInMinorUnits')::BIGINT <> 0
          OR (public.get_cash_shift_summary(cs.id)->>'cashSupplierPaymentsInMinorUnits')::BIGINT <> 0
          OR (public.get_cash_shift_summary(cs.id)->>'cliqSupplierPaymentsInMinorUnits')::BIGINT <> 0
          OR (public.get_cash_shift_summary(cs.id)->>'expectedCashInMinorUnits')::BIGINT <> 100
        )
    ),
    'cogs_profit_reconciled', (
      (public.get_operational_business_report(
        '83000000-0000-0000-0000-000000000010',
        (NOW() AT TIME ZONE 'Asia/Amman')::DATE,
        (NOW() AT TIME ZONE 'Asia/Amman')::DATE
      )->'sales'->>'grossSalesInMinorUnits')::BIGINT = 100
      AND (public.get_operational_business_report(
        '83000000-0000-0000-0000-000000000010',
        (NOW() AT TIME ZONE 'Asia/Amman')::DATE,
        (NOW() AT TIME ZONE 'Asia/Amman')::DATE
      )->'sales'->>'cogsInMinorUnits')::BIGINT = 10
      AND (public.get_operational_business_report(
        '83000000-0000-0000-0000-000000000010',
        (NOW() AT TIME ZONE 'Asia/Amman')::DATE,
        (NOW() AT TIME ZONE 'Asia/Amman')::DATE
      )->'sales'->>'grossProfitInMinorUnits')::BIGINT = 90
    ),
    'pos_audit_once', (SELECT COUNT(*) = 1 FROM public.audit_logs WHERE action='REVERSE_POS_SALE' AND details->>'order_id'='${orderId}'),
    'supplier_audit_once', (SELECT COUNT(*) = 1 FROM public.audit_logs WHERE action='REVERSE_SUPPLIER_PAYMENT' AND details->>'supplier_payment_id'='${paymentId}')
  );
`);
const reconciliationResult = JSON.parse(reconciliation);
if (Object.values(reconciliationResult).some((value) => value !== true)) {
  throw new Error(`Concurrent reversal reconciliation failed: ${JSON.stringify(reconciliationResult)}`);
}

console.log(JSON.stringify({
  ok: true,
  scenarios: 2,
  pos: 'one execution plus one idempotent replay',
  supplierPayment: 'one execution plus one idempotent replay',
  reconciliation: reconciliationResult,
}, null, 2));
