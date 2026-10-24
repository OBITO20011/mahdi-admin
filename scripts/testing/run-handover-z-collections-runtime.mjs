// Two independent psql sessions, including the former order/shift inversion.
import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile, writeFile, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {executorFor, executeInput} from '../operations/build-empty-supabase.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';

assert.equal(process.argv.length, 2, 'LOCAL_ONLY_NO_ARGUMENTS');
const root = path.resolve(import.meta.dirname, '../..'), exec = promisify(execFile);
const project = 'nawasrah-zcollections214-test', container = 'supabase_db_' + project;
const executor = executorFor(['--container', container]);
const output = await mkdtemp(path.join(tmpdir(), 'nawasrah-zcollections214-'));
const report = {output, managedAccess: false, cases: [], races: []};
const id = n => `92600000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), branch = id(200), warehouse = id(201), product = id(101);
const q = value => "'" + String(value).replaceAll("'", "''") + "'", j = value => q(JSON.stringify(value)) + '::jsonb';
let local, stage = 'bootstrap213', counter = 0;
const key = () => 'z214-collection-race-' + String(++counter).padStart(10, '0');
const sql = async text => {const r = await executeInput(executor, text); assert.equal(r.code, 0, r.stderr); return r.stdout.trim();};
const json = async text => JSON.parse((await sql(text)).split('\n').at(-1));
const auth = (text, app = 'z214-main') => `BEGIN;SET LOCAL statement_timeout='20s';SET LOCAL application_name=${q(app)};
  SELECT set_config('request.jwt.claims',${q(JSON.stringify({sub: owner, role: 'authenticated', aal: 'aal2'}))},true);
  SET LOCAL ROLE authenticated;${text}COMMIT;`;
const rpc = call => json(auth('SELECT public.' + call + ';'));
const collect = (customer, amount = 10000, k = key()) => `collect_customer_balance_v1(${q(customer)},${amount},'cash',${q(branch)},NULL,'اختبار ترتيب الأقفال',${q(k)})`;
const reverse = operation => `reverse_customer_collection_v1(${q(operation)},'عكس تحصيل مختلط لاختبار الأقفال')`;
async function fixture() {
  const customer = id(800 + counter++);
  await sql(`INSERT INTO customers(id,full_name,phone,credit_limit_in_minor_units) VALUES(${q(customer)},'عميل سباق ز',${q('079' + String(counter).padStart(7, '0'))},1000000);`);
  await rpc(`record_customer_opening_balances_v1(${q(key())},${j([{customer_id: customer, amount_in_minor_units: 100000, original_debt_date: '2020-01-01'}])})`);
  const sale = await rpc(`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(customer)},'عميل سباق ز','debt',${j([
    {commercial_line_kind: 'base_unit', product_id: product, base_quantity: 100, price_authority: 'server_catalog', line_discount_in_minor_units: 0},
  ])},0,0,${q(key())})`);
  const initial = await rpc(collect(customer, 120000));
  assert.deepEqual([initial.openingAmountInMinorUnits, initial.ordersAmountInMinorUnits], [100000, 20000]);
  return {customer, order: sale.orderId, operation: initial.operationId};
}
async function held(text) {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], {
    cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  const done = new Promise((resolve, reject) => {
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(stdout) : reject(Error(stderr)));
  });
  void done.catch(() => undefined);
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => {stdout += chunk; if (stdout.includes('Z214_HELD')) resolve();});
    child.stderr.on('data', chunk => {stderr += chunk;});
    child.on('close', () => reject(Error(stderr || 'HOLDER_CLOSED')));
  });
  child.stdin.write(auth(text, 'z214-holder').replace(/COMMIT;$/, "SELECT 'Z214_HELD';") + '\n');
  await ready;
  return {finish: async (tail = '') => {child.stdin.end(tail + 'COMMIT;\n'); return done;}};
}
async function waitForBlock() {
  for (let i = 0; i < 100; i++) {
    const rows = await json(`SELECT COALESCE(jsonb_agg(jsonb_build_object('wait',wait_event,'blockers',cardinality(pg_blocking_pids(pid)))),'[]')
      FROM pg_stat_activity WHERE application_name='z214-waiter' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0;`);
    if (rows.length) return rows;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert.fail('REAL_SECOND_SESSION_BLOCKING_REQUIRED');
}
async function race(firstSql, second, tail = '') {
  const holder = await held(firstSql);
  const pending = executeInput(executor, auth('SELECT public.' + second + ';', 'z214-waiter'));
  let blocked;
  try {blocked = await waitForBlock();} finally {await holder.finish(tail);}
  const result = await pending;
  assert.equal(result.code, 0, result.stderr);
  report.races.push({blockedByPostgres: true, blocked, deadlock: false, bothCommitted: true});
}
async function reconcile(f, opening, orderDue, cash, activeCollections = 1) {
  assert.equal(await json(`SELECT to_jsonb(is_reversed) FROM customer_collection_operations WHERE id=${q(f.operation)};`), true);
  const total = await rpc(`get_customer_debt_aging(${q(f.customer)})`);
  assert.equal(total.total_in_minor_units, opening + orderDue);
  const positions = await json(`SELECT jsonb_build_object(
    'orderDue',(SELECT outstanding_total_in_minor_units FROM phase42_order_financial_position_internal(${q(f.order)})),
    'openingDue',(SELECT SUM(b.amount_in_minor_units)-COALESCE((SELECT SUM(a.amount_in_minor_units)
      FROM customer_collection_opening_allocations a JOIN customer_collection_operations c ON c.id=a.operation_id
      WHERE c.customer_id=${q(f.customer)} AND NOT c.is_reversed),0) FROM customer_opening_balances b WHERE b.customer_id=${q(f.customer)} AND NOT b.is_reversed),
    'activeCollections',(SELECT COUNT(*) FROM customer_collection_operations WHERE customer_id=${q(f.customer)} AND NOT is_reversed));`);
  assert.deepEqual(positions, {orderDue, openingDue: opening, activeCollections});
  const shift = await json(`SELECT to_jsonb(id) FROM cash_shifts WHERE branch_id=${q(branch)} AND status='open';`);
  const summary = await rpc(`get_cash_shift_summary(${q(shift)})`);
  assert.equal(summary.expectedCashInMinorUnits, cash);
}
try {
  const boot = await exec(process.execPath, [path.join(root, 'scripts/testing/bootstrap-isolated-supabase.mjs')], {
    cwd: root, windowsHide: true, maxBuffer: 8 * 1024 ** 2,
    env: {...process.env, NAWASRAH_ISOLATED_PROJECT_ID: project, NAWASRAH_MAX_MIGRATION: '213', NAWASRAH_SKIP_REDUNDANT_DB_RESET: 'true',
      NAWASRAH_SUPABASE_EXCLUDE: 'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'},
  });
  local = JSON.parse(boot.stdout).isolatedProjectRoot;
  await sql('ALTER TABLE orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;');
  await sql(await readFile(path.join(root, 'scripts/testing/package-e-golden-day-fixture.sql'), 'utf8'));
  const before = await readApplicationFingerprint(executor);
  await sql(await readFile(path.join(root, 'supabase/migrations/214_handover_z_corrections.sql'), 'utf8'));
  assert.deepEqual(await readApplicationFingerprint(executor), before, 'MIGRATION_ZERO_DATA_WRITES');
  await rpc(`set_go_live_main_branch_v1(${q(branch)})`);
  await rpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q(key())},p_payment_method:='deferred',p_lines:=${j([
    {client_line_id: id(990), line_kind: 'base_unit', commercial_quantity: 1000, base_unit_name: 'باكيت', gross_amount_in_minor_units: 200000, line_discount_in_minor_units: 0, components: [{product_id: product, base_quantity: 1000}]},
  ])})`);
  const opened = await rpc(`open_cash_shift(${q(branch)},0)`);
  let cumulativeCash = 0;
  for (const direction of ['reverse-first', 'collect-first', 'canonical-early-locks']) {
    stage = direction;
    const f = await fixture(), next = collect(f.customer), undo = reverse(f.operation);
    if (direction === 'reverse-first') await race('SELECT public.' + undo + ';', next);
    else if (direction === 'collect-first') await race('SELECT public.' + next + ';', undo);
    else {
      // Stage the real collector's canonical early locks BEFORE it reaches shift
      // rows. The old reversal took the shift and waited on this order, creating
      // a cycle when the real collector continued. The repaired reversal waits
      // on the same customer hierarchy before taking any row lock.
      const early = `SELECT pg_advisory_xact_lock(hashtextextended('go-live-collection-customer:'||${q(f.customer)},0));
        SELECT pg_advisory_xact_lock(hashtextextended('phase4-order|'||${q(f.order)},0));`;
      await race(early, undo, 'SELECT public.' + next + ';');
    }
    cumulativeCash += 10000;
    await reconcile(f, direction === 'reverse-first' ? 90000 : 100000, direction === 'reverse-first' ? 100000 : 90000, cumulativeCash);
    const committed = await readApplicationFingerprint(executor);
    assert.equal((await rpc(undo)).idempotentReplay, true);
    assert.equal((await rpc(next)).idempotentReplay, true);
    assert.deepEqual(await readApplicationFingerprint(executor), committed, 'BOTH_REPLAYS_ZERO_WRITES');
    report.cases.push({direction, outstanding: 190000, drawerIncrement: 10000, replayZeroWrites: true});
    console.log(JSON.stringify(report.cases.at(-1)));
  }
  stage = 'concurrent duplicate reverse';
  const f = await fixture(), undo = reverse(f.operation);
  await race('SELECT public.' + undo + ';', undo);
  await reconcile(f, 100000, 100000, cumulativeCash, 0);
  report.cases.push({direction: 'duplicate-reverse', outstanding: 200000, drawerIncrement: 0});
  stage = 'closed shift zero-write refusal';
  const closed = await fixture();
  await rpc(`close_cash_shift(${q(opened.id)},${cumulativeCash + 120000},NULL)`);
  const snapshot = await readApplicationFingerprint(executor);
  const result = await executeInput(executor, auth('SELECT public.' + reverse(closed.operation) + ';'));
  assert.notEqual(result.code, 0); assert.match(result.stderr, /وردية مغلقة/);
  assert.deepEqual(await readApplicationFingerprint(executor), snapshot);
  report.cases.push({direction: 'closed-shift', denied: true, unchangedFingerprint: true});
  report.ok = true;
} catch (error) {
  report.ok = false; report.stage = stage; report.error = error.message; process.exitCode = 1;
} finally {
  if (local) await exec(process.execPath, [path.join(root, 'node_modules/supabase/dist/supabase.js'), 'stop', '--no-backup', '--workdir', local], {cwd: root, windowsHide: true});
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ok: report.ok, stage, error: report.error, output, cases: report.cases.length, races: report.races.length}));
}
