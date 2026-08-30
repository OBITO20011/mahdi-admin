import { spawn } from 'node:child_process';
const container = 'supabase_db_nawasrah-phase7-test';
const owner = '71000000-0000-0000-0000-000000000001';
const branch = '71000000-0000-0000-0000-000000000010';
const warehouse = '71000000-0000-0000-0000-000000000020';
const customer = '71000000-0000-0000-0000-000000000060';
const stockOneProduct = '71000000-0000-0000-0000-000000000071';
const debtProduct = '71000000-0000-0000-0000-000000000072';
const supplier = '71000000-0000-0000-0000-000000000050';
const claimSql = `SELECT set_config('request.jwt.claims', '{"sub":"${owner}","role":"authenticated","aal":"aal2"}', false);`;

const execute = (sql) => new Promise((resolve) => {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  child.stdin.end(`${claimSql}\n${sql}`);
});

const run = async (sql) => {
  const result = await execute(sql);
  if (result.code !== 0) throw new Error(`psql command failed: ${result.stderr || result.stdout}`);
  return result.stdout
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('{"sub"'));
};

const race = execute;

const json = (value) => {
  const line = value.split(/\r?\n/).reverse().find((entry) => entry.trim().startsWith('{'));
  return line ? JSON.parse(line) : null;
};

await run(`${claimSql}
SELECT public.open_cash_shift('${branch}', 0);
SELECT public.adjust_inventory_stock('${warehouse}', '${stockOneProduct}', 1, 'UAT concurrency fixture', 'manual');`);

const saleSql = (key) => `SELECT public.create_pos_sale('${warehouse}', '${branch}', NULL, 'UAT concurrent customer', 'cash', jsonb_build_array(jsonb_build_object('product_id','${stockOneProduct}','quantity',1)), 0, 0, '${key}');`;
const saleResults = await Promise.all([race(saleSql('uat-race-stock-a-000000000000')), race(saleSql('uat-race-stock-b-000000000000'))]);
const successfulSales = saleResults.filter((result) => result.code === 0 && json(result.stdout)?.success === true);
if (successfulSales.length !== 1) throw new Error(`Expected exactly one stock=1 sale to succeed: ${JSON.stringify(saleResults)}`);

const debtLines = await run(`${claimSql}
SELECT public.create_pos_sale('${warehouse}', '${branch}', '${customer}', 'عميل اختبار UAT', 'debt', jsonb_build_array(jsonb_build_object('product_id','${debtProduct}','quantity',1)), 0, 0, 'uat-race-debt-order-00000000000');`);
const debtOrder = json(debtLines.join('\n'));
if (!debtOrder?.orderId) throw new Error('Concurrency debt order was not created.');
const customerSql = `SELECT public.record_customer_order_payment_once('${debtOrder.orderId}', 1, 'cash', NULL, 'UAT concurrent payment', 'uat-race-customer-payment-key-000000000000');`;
const customerResults = await Promise.all([race(customerSql), race(customerSql)]);
const customerJson = customerResults.map((result) => json(result.stdout)).filter(Boolean);
if (customerJson.length !== 2 || !customerJson.some((result) => result.idempotent === false) || !customerJson.some((result) => result.idempotent === true)) throw new Error(`Customer payment retry was not idempotent: ${JSON.stringify(customerResults)}`);

const [receiptId] = await run(`SELECT id FROM public.supplier_receipts WHERE supplier_id='${supplier}' AND status='completed' AND amount_due_in_minor_units > 0 ORDER BY created_at DESC LIMIT 1;`);
if (!receiptId) throw new Error('No supplier receipt eligible for concurrent payment test.');
const supplierSql = `SELECT public.record_supplier_receipt_payment('${receiptId}', 1, 'cash', NULL, 'UAT concurrent supplier payment', 'uat-race-supplier-payment-key-000000000000');`;
const supplierResults = await Promise.all([race(supplierSql), race(supplierSql)]);
const supplierJson = supplierResults.map((result) => json(result.stdout)).filter(Boolean);
if (supplierJson.length !== 2 || !supplierJson.some((result) => result.idempotent === false) || !supplierJson.some((result) => result.idempotent === true)) throw new Error(`Supplier payment retry was not idempotent: ${JSON.stringify(supplierResults)}`);

console.log(JSON.stringify({ ok: true, stockOneConcurrentSales: { succeeded: 1, safelyRejected: 1 }, customerPaymentConcurrentRetry: 'one payment plus one idempotent replay', supplierPaymentConcurrentRetry: 'one payment plus one idempotent replay' }, null, 2));
