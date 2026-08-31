import { readFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const bootstrapPath = path.join(here, 'bootstrap-isolated-supabase.mjs');
const sql = await readFile(path.join(here, 'stale-new-orders-runtime.sql'), 'utf8');
const projectId = process.env.NAWASRAH_ISOLATED_PROJECT_ID || 'nawasrah-stale-orders-test';
const container = `supabase_db_${projectId}`;
const execFileAsync = promisify(execFile);
const claims = `SELECT set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}', false);`;

const execute = (statement) => new Promise((resolve) => {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A'], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = ''; let stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', (code) => resolve({ code, stdout, stderr }));
  child.stdin.end(statement);
});

const run = async (statement) => {
  const result = await execute(statement);
  if (result.code !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
};

if (process.env.NAWASRAH_SKIP_BOOTSTRAP !== '1') {
  const { stdout } = await execFileAsync(process.execPath, [bootstrapPath], {
    cwd: root,
    env: { ...process.env, NAWASRAH_ISOLATED_PROJECT_ID: projectId },
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  const bootstrap = JSON.parse(stdout);
  if (!bootstrap.ok) throw new Error('Isolated Supabase bootstrap failed.');
}

const runtimeOutput = await run(sql);
const summaryLine = runtimeOutput.split(/\r?\n/).reverse().find((line) => line.startsWith('{'));
const summary = summaryLine ? JSON.parse(summaryLine) : null;
if (!summary?.ok || summary.runtime_scenarios !== 8) {
  throw new Error(`Stale order runtime suite failed: ${runtimeOutput}`);
}

const cronOutput = await run(`SELECT jsonb_build_object(
  'scheduled_once', (SELECT count(*) = 1 FROM cron.job WHERE jobname = 'expire-stale-new-website-orders' AND schedule = '*/5 * * * *'),
  'function_private', NOT has_function_privilege('authenticated', 'public.expire_stale_new_website_orders(integer)', 'EXECUTE')
);`);
const cronLine = cronOutput.split(/\r?\n/).reverse().find((line) => line.startsWith('{'));
const cron = cronLine ? JSON.parse(cronLine) : null;
if (!cron || Object.values(cron).some((value) => value !== true)) {
  throw new Error(`Cron/private-function verification failed: ${cronOutput}`);
}

// A real simultaneous confirmation race: either actor may win, but the final
// state must be exactly one of (expired + released) or (preparing + retained).
const fixtureOutput = await run(`
DO $$
DECLARE
  b uuid := gen_random_uuid();
  w uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  u uuid := gen_random_uuid();
  p uuid := gen_random_uuid();
  o uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.branches(id, code, name_ar, is_active) VALUES (b, 'STALE-RACE-' || substr(b::TEXT, 1, 8), 'فرع سباق الانتهاء ' || substr(b::TEXT, 1, 8), true);
  INSERT INTO public.warehouses(id, branch_id, code, name_ar, is_active) VALUES (w, b, 'STALE-RACE-WH-' || substr(w::TEXT, 1, 8), 'مستودع سباق الانتهاء ' || substr(w::TEXT, 1, 8), true);
  INSERT INTO public.categories(id, code, name_ar, is_active) VALUES (c, 'STALE-RACE-CAT-' || substr(c::TEXT, 1, 8), 'قسم سباق الانتهاء ' || substr(c::TEXT, 1, 8), true);
  INSERT INTO public.units(id, code, name_ar) VALUES (u, 'STALE-RACE-U-' || substr(u::TEXT, 1, 8), 'قطعة ' || substr(u::TEXT, 1, 8));
  INSERT INTO public.products(id, sku, name_ar, category_id, unit_id, purchase_unit_id, sale_unit_id, units_per_purchase_unit, units_per_sale_unit, default_sale_price_in_minor_units, cost_price_in_minor_units, sale_price_in_minor_units, wholesale_price_in_minor_units, min_stock_level, is_active)
  VALUES (p, 'STALE-RACE-' || substr(p::TEXT, 1, 8), 'صنف سباق الانتهاء ' || substr(p::TEXT, 1, 8), c, u, u, u, 1, 1, 100, 25, 100, 100, 1, true);
  INSERT INTO public.inventory_balances(warehouse_id, product_id, on_hand_quantity, reserved_quantity) VALUES (w, p, 10, 1);
  INSERT INTO public.orders(id, order_number, branch_id, warehouse_id, status, source, subtotal_in_minor_units, total_in_minor_units, reservation_expires_at)
  VALUES (o, 'STALE-RACE-' || substr(o::TEXT, 1, 8), b, w, 'new', 'website', 100, 100, NOW() - INTERVAL '1 minute');
  INSERT INTO public.order_items(order_id, product_id, product_name_snapshot, sku_snapshot, quantity, unit_price_in_minor_units, line_total_in_minor_units)
  VALUES (o, p, 'صنف سباق الانتهاء', 'STALE-RACE-001', 1, 100, 100);
  PERFORM set_config('stale_orders.race_order_id', o::TEXT, false);
END $$;
SELECT current_setting('stale_orders.race_order_id');`);
const raceOrderId = fixtureOutput.split(/\r?\n/).map((line) => line.trim()).find((line) => /^[0-9a-f-]{36}$/i.test(line));
if (!raceOrderId) throw new Error(`Could not establish expiry race fixture: ${fixtureOutput}`);

const [expiryRace, confirmRace] = await Promise.all([
  execute('SELECT public.expire_stale_new_website_orders(1);'),
  execute(`${claims}\nSELECT public.accept_order_for_preparation('${raceOrderId}', 'اختبار تزامن الانتهاء والتأكيد');`),
]);
const errors = `${expiryRace.stderr}\n${confirmRace.stderr}`.toLowerCase();
if (errors.includes('deadlock detected') || errors.includes('lock timeout')) {
  throw new Error(`Expiry/confirmation race has unsafe lock behavior: ${errors}`);
}
const raceOutput = await run(`SELECT jsonb_build_object(
  'valid_terminal_state', (
    SELECT (o.status = 'expired' AND ib.reserved_quantity = 0 AND o.reservation_released_at IS NOT NULL)
        OR (o.status = 'preparing' AND ib.reserved_quantity = 1 AND o.reservation_released_at IS NULL)
    FROM public.orders o
    JOIN public.inventory_balances ib ON ib.warehouse_id = o.warehouse_id
    JOIN public.order_items oi ON oi.order_id = o.id AND oi.product_id = ib.product_id
    WHERE o.id = '${raceOrderId}'
  ),
  'never_both', (SELECT count(*) <= 1 FROM public.order_status_history WHERE order_id = '${raceOrderId}' AND new_status = 'expired'),
  'no_negative_inventory', NOT EXISTS (SELECT 1 FROM public.inventory_balances WHERE reserved_quantity < 0 OR available_quantity < 0)
);`);
const raceLine = raceOutput.split(/\r?\n/).reverse().find((line) => line.startsWith('{'));
const race = raceLine ? JSON.parse(raceLine) : null;
if (!race || Object.values(race).some((value) => value !== true)) {
  throw new Error(`Expiry/confirmation race left inconsistent state: ${raceOutput}`);
}

console.log(JSON.stringify({ ok: true, runtimeScenarios: summary.runtime_scenarios, cron, concurrencyScenarios: 1, race }, null, 2));
