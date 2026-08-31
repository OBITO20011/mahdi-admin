import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');
const bootstrapPath = path.join(here, 'bootstrap-isolated-supabase.mjs');
const sqlPath = path.join(here, 'guest-order-line-item-limit-runtime.sql');
const databaseContainer = process.env.NAWASRAH_M5_DATABASE_CONTAINER ||
  'supabase_db_nawasrah-m5-line-item-test';

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
  child.on('close', (code) => {
    if (code === 0) resolve(stdout.trim());
    else reject(new Error(`M5 isolated SQL failed (exit ${code}): ${stderr.trim()}`));
  });
  child.stdin.end(sql);
});

if (!process.env.NAWASRAH_M5_DATABASE_CONTAINER) {
  const { stdout } = await execFileAsync(process.execPath, [bootstrapPath], {
    cwd: projectRoot,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    env: {...process.env, NAWASRAH_ISOLATED_PROJECT_ID: 'nawasrah-m5-line-item-test'},
  });
  const bootstrap = JSON.parse(stdout);
  if (!bootstrap.ok) throw new Error('The isolated Supabase bootstrap failed.');
}

const output = await runSql(await readFile(sqlPath, 'utf8'));
const summaryLine = output.split(/\r?\n/).find((line) => line.startsWith('{') && line.includes('fifty_line_items'));
if (!summaryLine) throw new Error(`M5 runtime summary is missing: ${output}`);
const summary = JSON.parse(summaryLine);
if (
  summary.ok !== true || summary.thirty_line_items !== true ||
  summary.fifty_line_items !== true || summary.fifty_one_rejected_without_effects !== true ||
  summary.fifty_item_order_rows !== 50 || summary.reserved_packages_across_test_items !== 80
) {
  throw new Error(`M5 runtime reconciliation failed: ${JSON.stringify(summary)}`);
}

const concurrentSql = `
WITH items AS (
  SELECT jsonb_agg(jsonb_build_object(
    'product_id', format('87000000-0000-4000-8700-%s', lpad(sequence::TEXT, 12, '0')),
    'quantity', 1
  ) ORDER BY sequence) AS value
  FROM generate_series(1, 50) AS sequence
)
SELECT public.submit_guest_customer_order(
  '87000000-0000-4000-8710-000000000099', 'عميل M5 التزامن', '0797001099',
  'إربد', 'الرمثا', 'حي الاختبار', 'شارع الاختبار', NULL, NULL, NULL,
  NULL, NULL, NULL, value, NULL, 'cash_on_delivery', 'inside_ramtha'
) FROM items;`;
const concurrentResults = await Promise.all([runSql(concurrentSql), runSql(concurrentSql)]);
const replayFlags = concurrentResults.map((result) => JSON.parse(result).idempotent_replay === true);
const reconciliation = JSON.parse(await runSql(`SELECT json_build_object(
  'orders', (SELECT COUNT(*) FROM public.orders WHERE idempotency_key = '87000000-0000-4000-8710-000000000099'),
  'order_items', (SELECT COUNT(*) FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id WHERE o.idempotency_key = '87000000-0000-4000-8710-000000000099'),
  'reserved_delta', (SELECT COALESCE(SUM(reserved_quantity), 0) FROM public.inventory_balances WHERE product_id::TEXT LIKE '87000000-0000-4000-8700-%') - 80
);`));
if (
  reconciliation.orders !== 1 || reconciliation.order_items !== 50 ||
  reconciliation.reserved_delta !== 50 || replayFlags.filter(Boolean).length !== 1
) {
  throw new Error(`M5 concurrent retry failed: ${JSON.stringify({replayFlags, reconciliation})}`);
}

console.log(JSON.stringify({
  ...summary,
  concurrent_requests: concurrentResults.length,
  concurrent_idempotent_replays: replayFlags.filter(Boolean).length,
  concurrent_reconciliation: reconciliation,
}, null, 2));
