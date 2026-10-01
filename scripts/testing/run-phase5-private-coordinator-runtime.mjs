import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { assertPhase5DbLint } from './phase5-db-lint-policy.mjs';

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');
const projectId = 'nawasrah-phase5-slice3-runtime-test';
const container = `supabase_db_${projectId}`;
const cli = path.join(root, 'node_modules/supabase/dist/supabase.js');
const owner = '92400000-0000-0000-0000-000000000001';
const salesActor = '92400000-0000-0000-0000-000000000002';
const branch = '92400000-0000-0000-0000-000000000200';
const warehouse = '92400000-0000-0000-0000-000000000201';
const product = '92400000-0000-0000-0000-000000000101';
const claims = `SELECT set_config('request.jwt.claims',
  '{"sub":"${owner}","role":"authenticated","aal":"aal2"}',false);`;
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
let workdir = '';
const passed = [];

const sql = (text, failure = false) => new Promise((resolve, reject) => {
  const p = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'],
  { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  p.stdout.on('data', (c) => { stdout += c; });
  p.stderr.on('data', (c) => { stderr += c; });
  p.on('error', reject);
  p.on('close', (code) => {
    if ((code !== 0) !== failure) reject(new Error(`Unexpected SQL exit ${code}: ${stderr}`));
    else resolve({ stdout, stderr });
  });
  p.stdin.end(`SET statement_timeout='10s';\n${text}`);
});
const json = async (text) => JSON.parse((await sql(text)).stdout.trim().split(/\r?\n/u).at(-1));
const rejected = async (text, pattern) => assert.match((await sql(text, true)).stderr, pattern);
const fingerprint = () => json(`SELECT to_jsonb(encode(extensions.digest((jsonb_build_object(
  'ops',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM phase5_private.financial_operation_events t),
  'collections',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM phase5_private.collection_events t),
  'reversals',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM phase5_private.payment_reversal_events t),
  'movements',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY operation_id),'[]') FROM phase5_private.reversal_tender_movements t),
  'completions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY operation_id),'[]') FROM phase5_private.reversal_coordinator_completions t),
  'guards',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY operation_id),'[]') FROM phase5_private.reversal_coordinator_guards t),
  'publicPayments',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.customer_payments t),
  'orders',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.orders t),
  'inventory',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY warehouse_id,product_id),'[]') FROM public.inventory_balances t),
  'inventoryMovements',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.inventory_movements t),
  'returns',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.sales_return_events t),
  'shiftReversals',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.cash_shift_reversals t),
  'shiftReversalOperations',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.cash_shift_reversal_operations t),
  'audit',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.audit_logs t),
  'shifts',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.cash_shifts t)
))::text,'sha256'),'hex'));`);
const lines = JSON.stringify([{ commercial_line_kind: 'base_unit', product_id: product,
  base_quantity: 1, price_authority: 'server_catalog', line_discount_in_minor_units: 0 }]);
const createSale = async (method = 'debt', quantity = 1) => {
  const customer = randomUUID();
  await sql(`INSERT INTO public.customers(id,full_name,phone,credit_limit_in_minor_units)
    VALUES (${q(customer)},'Isolated Slice 3',${q(`079${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`)},1000000);`);
  return json(`${claims} SELECT public.create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(customer)},
    'Isolated Slice 3',${q(method)},${q(JSON.stringify(JSON.parse(lines).map((line) => ({ ...line, base_quantity:quantity }))))}::jsonb,
    0,${1000 * quantity},${q(randomUUID())});`);
};
const payment = async (order, amount, method = 'cliq') => {
  const result = await json(`${claims} SELECT public.record_customer_order_payment(${q(order)},
    ${amount},${q(method)},${method === 'cliq' ? q(randomUUID()) : 'NULL'},'Slice 3 source');`);
  return json(`SELECT to_jsonb(p) FROM public.customer_payments p WHERE payment_number=${q(result.payment_number)};`);
};
const anchor = (order, p) => json(`SELECT phase5_private.anchor_existing_collection_v1(
  ${q(owner)},${q(order)},${q(p.id)},${q(randomUUID())});`);
const reverseSql = (order, c, p, key, method = 'cliq') => `SELECT phase5_private.coordinate_payment_reversal_v1(
  ${q(owner)},${q(order)},${q(c.collectionEventId)},${q(p.id)},${q(method)},
  ${method === 'cliq' ? "'R-S3'" : 'NULL'},'Exact full reversal',${q(key)});`;

const createCustomerSale = async (collected, delivery = 0) => {
  await sql(`UPDATE public.configurable_parcel_feature_settings SET feature_state='ENABLED';
    UPDATE public.storefront_settings SET orders_enabled=true,minimum_order_in_minor_units=0,
      inside_ramtha_delivery_fee_in_minor_units=${delivery},outside_ramtha_delivery_fee_in_minor_units=${delivery};
    INSERT INTO public.inventory_balances(warehouse_id,product_id,on_hand_quantity,reserved_quantity)
      SELECT w.id,${q(product)},100,0 FROM public.warehouses w JOIN public.branches b ON b.id=w.branch_id
      WHERE w.is_active AND b.is_active ON CONFLICT (warehouse_id,product_id) DO UPDATE
        SET on_hand_quantity=public.inventory_balances.on_hand_quantity+100;`);
  const phone = `079${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  const order = await json(`SELECT set_config('request.jwt.claim.role','service_role',false);
    SELECT public.submit_guest_customer_order_v2(${q(randomUUID())},repeat('c',64),repeat('d',64),
      'Isolated Customer Slice 3',${q(phone)},'إربد','الرمثا','الحي الشرقي','شارع الاختبار',
      NULL,NULL,NULL,NULL,NULL,NULL,
      ${q(JSON.stringify([{ commercial_line_kind: 'base_unit', product_id: product,
    base_quantity: 1, expected_unit_price_in_minor_units: 1000 }]))}::jsonb,
      NULL,'cash_on_delivery','inside_ramtha',1000,0,${delivery},${1000 + delivery});`);
  assert.ok(order.order_id);
  await sql(`INSERT INTO public.cash_shifts(id,shift_number,branch_id,opened_by,opening_cash_in_minor_units)
    SELECT ${q(randomUUID())},${q(randomUUID())},o.branch_id,${q(owner)},0 FROM public.orders o
    WHERE o.id=${q(order.order_id)} AND NOT EXISTS (SELECT 1 FROM public.cash_shifts s
      WHERE s.branch_id=o.branch_id AND s.status='open');
    UPDATE public.orders SET status='ready' WHERE id=${q(order.order_id)};`);
  const completed = await json(`${claims} SELECT public.complete_website_order_with_settlement_v2(
    ${q(order.order_id)},${q(randomUUID())},'cash',${collected},${delivery},NULL,'Slice 3 completion');`);
  assert.equal(completed.success, true);
  return completed;
};

const session = (name) => {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'],
  { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const result = { child, stdout: '', stderr: '' };
  child.stdout.on('data', (c) => { result.stdout += c; });
  child.stderr.on('data', (c) => { result.stderr += c; });
  result.closed = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code));
  });
  child.stdin.write(`SET application_name=${q(name)}; SET statement_timeout='10s'; BEGIN;\n`);
  return result;
};
const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Observed lock barrier missing: ${label}`);
};
const race = async (firstMethod, secondMethod, samePayload) => {
  const sale = await createSale();
  const p = await payment(sale.orderId, 1000);
  const c = await anchor(sale.orderId, p);
  const key = randomUUID();
  const first = session(`p5s3-first-${key}`);
  let second;
  try {
    first.child.stdin.write(`${reverseSql(sale.orderId, c, p, key, firstMethod)} SELECT 'S3_READY';\n`);
    await waitFor(() => first.stdout.includes('S3_READY'), 'winner coordinator completed inside held transaction');
    const app = `p5s3-second-${key}`;
    second = session(app);
    second.child.stdin.end(`${reverseSql(sale.orderId, c, p, key, secondMethod)} COMMIT;\n`);
    await waitFor(async () => (await json(`SELECT to_jsonb(EXISTS (SELECT 1 FROM pg_stat_activity a
      JOIN pg_locks l ON l.pid=a.pid WHERE a.application_name=${q(app)} AND l.locktype='advisory'
      AND NOT l.granted AND cardinality(pg_blocking_pids(a.pid))>0));`)), 'loser waiting on real idempotency lock');
    first.child.stdin.end('COMMIT;\n');
    assert.equal(await first.closed, 0, first.stderr);
    if (samePayload) {
      assert.equal(await second.closed, 0, second.stderr);
      const firstResult = JSON.parse(first.stdout.trim().split(/\r?\n/u).find((line) => line.startsWith('{')));
      const secondResult = JSON.parse(second.stdout.trim().split(/\r?\n/u).find((line) => line.startsWith('{')));
      assert.deepEqual(secondResult, firstResult);
    } else {
      assert.notEqual(await second.closed, 0);
      assert.match(second.stderr, /23505: PHASE5_PAYMENT_REVERSAL_IDEMPOTENCY_CONFLICT/u);
    }
    assert.deepEqual(await json(`SELECT jsonb_build_object('operations',
      (SELECT count(*) FROM phase5_private.financial_operation_events WHERE idempotency_key=${q(key)}),
      'movements',(SELECT count(*) FROM phase5_private.reversal_tender_movements WHERE original_payment_id=${q(p.id)}),
      'completions',(SELECT count(*) FROM phase5_private.reversal_coordinator_completions c
        JOIN phase5_private.reversal_tender_movements m USING(operation_id) WHERE m.original_payment_id=${q(p.id)}));`),
    { operations: 1, movements: 1, completions: 1 });
  } finally {
    if (!first.child.stdin.destroyed && !first.child.stdin.writableEnded) first.child.stdin.end('ROLLBACK;\n');
    if (second && !second.child.stdin.destroyed && !second.child.stdin.writableEnded) second.child.stdin.end('ROLLBACK;\n');
    await Promise.all([first.closed, second?.closed]);
  }
};

const shiftLockMatrix = async () => {
  const sale = await createSale();
  const p = await payment(sale.orderId, 1000, 'cash');
  const historicalShift = p.cash_shift_id;
  await json(`${claims} SELECT public.close_cash_shift(${q(historicalShift)},1000,'Historical anchor fixture');`);
  const currentShift = 'f2600000-0000-0000-0000-000000000001';
  await sql(`INSERT INTO public.cash_shifts(id,shift_number,branch_id,opened_by,opening_cash_in_minor_units)
    VALUES(${q(currentShift)},'S3-CURRENT-B',${q(branch)},${q(owner)},0);`);
  const before = await fingerprint();
  const blocker = session('p5s3-full-shift-resource-holder');
  try {
    blocker.child.stdin.write(`SELECT id FROM public.cash_shifts WHERE id=${q(historicalShift)} FOR UPDATE;
      SELECT id FROM public.orders WHERE id=${q(sale.orderId)} FOR UPDATE; SELECT 'S3_READY';\n`);
    await waitFor(() => blocker.stdout.includes('S3_READY'), 'full-Shift-order resource holder');
    await rejected(`SET statement_timeout='250ms'; SELECT phase5_private.anchor_existing_collection_v1(
      ${q(salesActor)},${q(sale.orderId)},${q(p.id)},'unauthorized-held-shift');`,
    /42501: PHASE5_(COORDINATOR_ACTOR_UNAUTHORIZED|COLLECTION_ACTOR_SOURCE_UNAUTHORIZED)/u);
    await rejected(`SELECT phase5_private.anchor_existing_collection_v1(
      ${q(owner)},${q(sale.orderId)},${q(p.id)},'contended-historical-anchor');`,
    /40001: PHASE5_LOCK_CONTENTION_RETRY/u);
    assert.equal(await fingerprint(), before);
  } finally {
    blocker.child.stdin.end('ROLLBACK;\n');
    assert.equal(await blocker.closed, 0, blocker.stderr);
  }
  const c = await anchor(sale.orderId, p);
  assert.equal(c.cashShiftId, historicalShift);
  assert.equal(await json(`SELECT to_jsonb(count(*)) FROM phase5_private.reversal_tender_movements;`), 0);
  // Historical A is not a new FK dependency of a reversal reusing its anchor.
  const oldShiftHolder = session('p5s3-historical-only-holder');
  try {
    oldShiftHolder.child.stdin.write(`SELECT id FROM public.cash_shifts WHERE id=${q(historicalShift)} FOR UPDATE;
      SELECT 'S3_READY';\n`);
    await waitFor(() => oldShiftHolder.stdout.includes('S3_READY'), 'historical-only Shift holder');
    const result = await json(reverseSql(sale.orderId, c, p, randomUUID(), 'cash'));
    assert.equal(result.cashShiftId, currentShift);
    assert.equal(result.reversedAmountInMinorUnits, 1000);
    assert.equal(result.reversalTenderMethod, 'cash');
    assert.equal(result.sourceRecordedAt, await json(`SELECT to_jsonb(to_char(created_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) FROM public.customer_payments WHERE id=${q(p.id)};`));
    assert.notEqual(result.sourceRecordedAt, c.operationEventAt, 'anchoring does not rewrite source time');
  } finally {
    oldShiftHolder.child.stdin.end('ROLLBACK;\n');
    assert.equal(await oldShiftHolder.closed, 0, oldShiftHolder.stderr);
  }
  passed.push('historical A/current B: FK contention rejects pre-write; no irrelevant historical lock on Cash reversal');
};

const fkParentContentionMatrix = async () => {
  const sale = await createSale();
  const p = await payment(sale.orderId, 1000);
  const c = await anchor(sale.orderId, p);
  const customer = await json(`SELECT to_jsonb(customer_id) FROM public.orders WHERE id=${q(sale.orderId)};`);
  for (const [table, id] of [['profiles', owner], ['customers', customer],
    ['customer_payments', p.id], ['orders', sale.orderId]]) {
    const before = await fingerprint();
    const holder = session(`p5s3-fk-${table}`);
    try {
      holder.child.stdin.write(`SELECT id FROM public.${table} WHERE id=${q(id)} FOR UPDATE;
        SELECT 'S3_READY';\n`);
      await waitFor(() => holder.stdout.includes('S3_READY'), `${table} parent row held`);
      await rejected(reverseSql(sale.orderId, c, p, randomUUID()),
        /40001: PHASE5_LOCK_CONTENTION_RETRY/u);
      assert.equal(await fingerprint(), before, `${table} contention must leave zero durable writes`);
    } finally {
      holder.child.stdin.end('ROLLBACK;\n');
      assert.equal(await holder.closed, 0, holder.stderr);
    }
  }
  const result = await json(reverseSql(sale.orderId, c, p, randomUUID()));
  assert.equal(result.success, true, 'released parent locks allow a fresh legitimate attempt');
  passed.push('real profile/customer/payment/Order parent contention: safe retry, zero writes, released-lock success');
};

const shiftCloseRace = async () => {
  const sale = await createSale();
  const p = await payment(sale.orderId, 1000);
  const c = await anchor(sale.orderId, p);
  const shift = await json(`SELECT to_jsonb(id) FROM public.cash_shifts
    WHERE branch_id=${q(branch)} AND status='open';`);
  const before = await fingerprint();
  const closer = session('p5s3-close-first');
  try {
    closer.child.stdin.write(`${claims} SELECT public.close_cash_shift(${q(shift)},0,'Slice 3 close race');
      SELECT 'S3_READY';\n`);
    await waitFor(() => closer.stdout.includes('S3_READY'), 'actual close RPC holding uncommitted close');
    await rejected(reverseSql(sale.orderId, c, p, randomUUID(), 'cash'),
      /40001: PHASE5_LOCK_CONTENTION_RETRY/u);
    assert.equal(await fingerprint(), before);
  } finally {
    closer.child.stdin.end('ROLLBACK;\n');
    assert.equal(await closer.closed, 0, closer.stderr);
  }
  assert.equal(await fingerprint(), before);
  const coordinator = session('p5s3-coordinator-first');
  let waitingClose;
  try {
    coordinator.child.stdin.write(`${reverseSql(sale.orderId, c, p, randomUUID(), 'cash')}
      SELECT 'S3_READY';\n`);
    await waitFor(() => coordinator.stdout.includes('S3_READY'), 'coordinator holds current Shift');
    waitingClose = session('p5s3-close-second');
    waitingClose.child.stdin.end(`${claims} SELECT public.close_cash_shift(${q(shift)},0,'Slice 3 reverse direction'); ROLLBACK;\n`);
    await waitFor(async () => await json(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity
      WHERE application_name='p5s3-close-second' AND cardinality(pg_blocking_pids(pid))>0));`),
    'actual close waits for coordinator Shift lock');
    coordinator.child.stdin.end('ROLLBACK;\n');
    assert.equal(await coordinator.closed, 0, coordinator.stderr);
    assert.equal(await waitingClose.closed, 0, waitingClose.stderr);
  } finally {
    if (!coordinator.child.stdin.writableEnded) coordinator.child.stdin.end('ROLLBACK;\n');
    await Promise.all([coordinator.closed, waitingClose?.closed]);
  }
  assert.equal(await fingerprint(), before, 'both isolated race directions roll back all durable state');
  passed.push('actual close_cash_shift RPC versus coordinator in both scheduling directions; zero durable residue');
};

const strongestShiftMatrix = async () => {
  const sale = await createSale();
  const p = await payment(sale.orderId, 1000, 'cash');
  const current = p.cash_shift_id;
  const before = await fingerprint();
  const locker = session('p5s3-strongest-shift');
  try {
    locker.child.stdin.write(`SELECT phase5_private.lock_coordinator_context_v1(
      ${q(owner)},${q(sale.orderId)},true,${q(p.id)}); SELECT 'S3_READY';\n`);
    await waitFor(() => locker.stdout.includes('S3_READY'), 'same Shift current/historical plan locked');
    await rejected(`SELECT id FROM public.cash_shifts WHERE id=${q(current)} FOR KEY SHARE NOWAIT;`,
      /55P03/u);
  } finally {
    locker.child.stdin.end('ROLLBACK;\n');
    assert.equal(await locker.closed, 0, locker.stderr);
  }
  // Invert the UUID relationship deliberately: current lower than historical.
  await json(`${claims} SELECT public.close_cash_shift(${q(current)},0,'Inverse UUID fixture');`);
  const lower = '02600000-0000-0000-0000-000000000001';
  assert.ok(lower < current);
  await sql(`INSERT INTO public.cash_shifts(id,shift_number,branch_id,opened_by,opening_cash_in_minor_units)
    VALUES(${q(lower)},'S3-LOWER-CURRENT',${q(branch)},${q(owner)},0);`);
  const inverseBefore = await fingerprint();
  const inverse = session('p5s3-inverse-shift');
  try {
    inverse.child.stdin.write(`SELECT phase5_private.lock_coordinator_context_v1(
      ${q(owner)},${q(sale.orderId)},true,${q(p.id)}); SELECT 'S3_READY';\n`);
    await waitFor(() => inverse.stdout.includes('S3_READY'), 'inverse UUID plan acquired');
    await rejected(`SELECT id FROM public.cash_shifts WHERE id=${q(lower)} FOR KEY SHARE NOWAIT;`, /55P03/u);
    await sql(`BEGIN; SELECT id FROM public.cash_shifts WHERE id=${q(current)} FOR KEY SHARE NOWAIT; ROLLBACK;`);
    await rejected(`SELECT id FROM public.cash_shifts WHERE id=${q(current)} FOR UPDATE NOWAIT;`, /55P03/u);
  } finally {
    inverse.child.stdin.end('ROLLBACK;\n');
    assert.equal(await inverse.closed, 0, inverse.stderr);
  }
  assert.equal(await fingerprint(), inverseBefore);
  assert.notEqual(before, inverseBefore, 'historical close/current open setup is real');
  passed.push('same-Shift strongest UPDATE and inverse-UUID current UPDATE/historical KEY SHARE verified with competing row locks');
};

const changedDiscoveryMatrix = async () => {
  const sale = await createSale();
  const p = await payment(sale.orderId, 1000);
  const c = await anchor(sale.orderId, p);
  const before = await fingerprint();
  // Disposable instrumentation changes one source between the first plan and
  // fresh revalidation. Production function bytes and durable fixtures survive.
  await rejected(`BEGIN;
    ALTER FUNCTION phase5_private.coordinator_lock_plan_v1(uuid,boolean) RENAME TO slice3_original_plan;
    CREATE FUNCTION phase5_private.coordinator_lock_plan_v1(p_order_id uuid,p_cash_outflow boolean)
    RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$ DECLARE planned jsonb; BEGIN
      planned := phase5_private.slice3_original_plan(p_order_id,p_cash_outflow);
      IF current_setting('slice3.plan_mutated',true) IS DISTINCT FROM 'yes' THEN
        PERFORM set_config('slice3.plan_mutated','yes',true);
        UPDATE public.customer_payments SET reference_number='S3-CHANGED-DISCOVERY' WHERE id=${q(p.id)};
      END IF;
      RETURN planned;
    END; $$;
    ${reverseSql(sale.orderId,c,p,randomUUID())} ROLLBACK;`,
  /40001: PHASE5_LOCK_PLAN_CHANGED_RETRY/u);
  assert.equal(await fingerprint(), before);
  assert.equal((await json(reverseSql(sale.orderId,c,p,randomUUID()))).success,true);
  passed.push('changed source discovery rejects before writes; rollback restores original planner and source');
};

const fullShiftReversalRace = async () => {
  const sale = await createSale();
  const p = await payment(sale.orderId,1000,'cash');
  const shift = p.cash_shift_id;
  const before = await fingerprint();
  const deadlocksBefore = await json(`SELECT to_jsonb(deadlocks) FROM pg_stat_database WHERE datname=current_database();`);
  const heldOrder = session('p5s3-full-order-barrier');
  let full;
  try {
    heldOrder.child.stdin.write(`SELECT id FROM public.orders WHERE id=${q(sale.orderId)} FOR UPDATE;
      SELECT 'S3_READY';\n`);
    await waitFor(() => heldOrder.stdout.includes('S3_READY'),'Order barrier before actual full reversal');
    full = session('p5s3-full-rpc-first');
    full.child.stdin.end(`${claims} SELECT public.reverse_cash_shift_with_operations(
      ${q(shift)},'Slice 3 actual full reversal contention',${q(randomUUID())}); ROLLBACK;\n`);
    await waitFor(async () => await json(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity
      WHERE application_name='p5s3-full-rpc-first' AND cardinality(pg_blocking_pids(pid))>0));`),
    'actual full reversal holds Shift and waits on Order');
    await rejected(`SELECT phase5_private.anchor_existing_collection_v1(
      ${q(owner)},${q(sale.orderId)},${q(p.id)},${q(randomUUID())});`,/40001: PHASE5_LOCK_CONTENTION_RETRY/u);
    assert.equal(await fingerprint(),before);
    heldOrder.child.stdin.end('ROLLBACK;\n');
    assert.equal(await heldOrder.closed,0,heldOrder.stderr);
    const code = await full.closed;
    if (code !== 0) {
      assert.match(full.stderr,/P0001/u,'existing aftercare/payment dependency can reject the full reversal');
      assert.doesNotMatch(full.stderr,/40P01|55P03|57014/u);
    }
  } finally {
    if (!heldOrder.child.stdin.writableEnded) heldOrder.child.stdin.end('ROLLBACK;\n');
    await Promise.all([heldOrder.closed,full?.closed]);
  }
  assert.equal(await fingerprint(),before);
  const anchorHolder = session('p5s3-anchor-first');
  let second;
  try {
    anchorHolder.child.stdin.write(`SELECT phase5_private.anchor_existing_collection_v1(
      ${q(owner)},${q(sale.orderId)},${q(p.id)},${q(randomUUID())}); SELECT 'S3_READY';\n`);
    await waitFor(() => anchorHolder.stdout.includes('S3_READY'),'anchor holds historical FK and Order locks');
    second = session('p5s3-full-rpc-second');
    second.child.stdin.end(`${claims} SELECT public.reverse_cash_shift_with_operations(
      ${q(shift)},'Slice 3 inverse actual full reversal',${q(randomUUID())}); ROLLBACK;\n`);
    await waitFor(async () => await json(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity
      WHERE application_name='p5s3-full-rpc-second' AND cardinality(pg_blocking_pids(pid))>0));`),
    'actual full reversal waits for the pre-acquired historical Shift lock');
    anchorHolder.child.stdin.end('ROLLBACK;\n');
    assert.equal(await anchorHolder.closed,0,anchorHolder.stderr);
    if (await second.closed !== 0) {
      assert.match(second.stderr,/P0001/u);
      assert.doesNotMatch(second.stderr,/40P01|55P03|57014/u);
    }
  } finally {
    if (!anchorHolder.child.stdin.writableEnded) anchorHolder.child.stdin.end('ROLLBACK;\n');
    await Promise.all([anchorHolder.closed,second?.closed]);
  }
  assert.equal(await fingerprint(),before);
  const after = await json(`SELECT to_jsonb(deadlocks) FROM pg_stat_database WHERE datname=current_database();`);
  assert.equal(after-deadlocksBefore,0);
  passed.push('actual full-Shift reversal RPC versus source anchoring both directions; zero residue and deadlockDelta=0; existing dependency rejection preserved');
};

const distinctKeyRace = async () => {
  for (const direction of ['A-first','B-first']) {
    const sale = await createSale();
    const p = await payment(sale.orderId,1000);
    const c = await anchor(sale.orderId,p);
    const winnerKey = randomUUID();
    const loserKey = randomUUID();
    const winner = session(`p5s3-distinct-${direction}`);
    let loser;
    try {
      winner.child.stdin.write(`${reverseSql(sale.orderId,c,p,winnerKey)} SELECT 'S3_READY';\n`);
      await waitFor(() => winner.stdout.includes('S3_READY'),'different-key winner holds Order gate');
      const app = `p5s3-distinct-loser-${direction}`;
      loser = session(app);
      loser.child.stdin.end(`${reverseSql(sale.orderId,c,p,loserKey)} COMMIT;\n`);
      await waitFor(async () => await json(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity a
        JOIN pg_locks l ON l.pid=a.pid WHERE a.application_name=${q(app)} AND l.locktype='advisory'
        AND NOT l.granted AND cardinality(pg_blocking_pids(a.pid))>0));`),'different-key loser waits on root gate');
      winner.child.stdin.end('COMMIT;\n');
      assert.equal(await winner.closed,0,winner.stderr);
      assert.notEqual(await loser.closed,0);
      assert.match(loser.stderr,/23505: PHASE5_PAYMENT_ALREADY_REVERSED/u);
      assert.deepEqual(await json(`SELECT jsonb_build_object('loserOperations',
        (SELECT count(*) FROM phase5_private.financial_operation_events WHERE idempotency_key=${q(loserKey)}),
        'movements',(SELECT count(*) FROM phase5_private.reversal_tender_movements WHERE original_payment_id=${q(p.id)}));`),
      {loserOperations:0,movements:1});
    } finally {
      if (!winner.child.stdin.writableEnded) winner.child.stdin.end('ROLLBACK;\n');
      await Promise.all([winner.closed,loser?.closed]);
    }
  }
  passed.push('two different keys reverse one exact payment: root gate serialization, one movement, zero loser operation in both directions');
};

const sharedShiftCrossSaleRace = async () => {
  const a = await createSale();
  const b = await createSale();
  const pa = await payment(a.orderId,1000);
  const pb = await payment(b.orderId,1000);
  const ca = await anchor(a.orderId,pa);
  const cb = await anchor(b.orderId,pb);
  const first = session('p5s3-shared-shift-winner');
  const key = randomUUID();
  try {
    first.child.stdin.write(`${reverseSql(a.orderId,ca,pa,randomUUID(),'cash')} SELECT 'S3_READY';\n`);
    await waitFor(() => first.stdout.includes('S3_READY'),'cross-sale current Cash Shift held');
    const beforeLoser = await fingerprint();
    await rejected(reverseSql(b.orderId,cb,pb,key,'cash'),/40001: PHASE5_LOCK_CONTENTION_RETRY/u);
    assert.equal(await fingerprint(),beforeLoser);
    first.child.stdin.end('COMMIT;\n');
    assert.equal(await first.closed,0,first.stderr);
  } finally {
    if (!first.child.stdin.writableEnded) first.child.stdin.end('ROLLBACK;\n');
    await first.closed;
  }
  const result = await json(reverseSql(b.orderId,cb,pb,key,'cash'));
  assert.equal(result.success,true);
  assert.equal(result.orderId,b.orderId);
  assert.equal(result.originalPaymentId,pb.id);
  passed.push('different sales sharing current Cash Shift: fail-fast zero-write loser then valid retry bound to its own sale/payment');
};

const postReturnCapacityMatrix = async () => {
  for (const paid of [300, 1000]) {
    const sale = await createSale();
    const p = await payment(sale.orderId, paid);
    const c = await anchor(sale.orderId, p);
    const item = await json(`SELECT to_jsonb(id) FROM public.order_items WHERE order_id=${q(sale.orderId)};`);
    const items = JSON.stringify([{ return_scope: 'base_unit', order_item_id: item,
      quantity: 1, stock_disposition: 'damaged' }]);
    const returned = await json(`${claims} SELECT public.settle_sales_return_v1(
      ${q(sale.orderId)},${q(randomUUID())},${q(items)}::jsonb,'Slice 3 post-Return capacity',
      'cliq','S3-RETURN-REF',NULL);`);
    assert.equal(returned.success, true);
    const before = await fingerprint();
    await rejected(reverseSql(sale.orderId, c, p, randomUUID()),
      /PHASE5_.*CAPACITY/u);
    assert.equal(await fingerprint(), before, 'refunded collection cannot be reversed again');
  }
  passed.push('real settled partial/full-paid Returns reject reversal of refund backing with zero financial writes');
};

const deliveryCapacityMatrix = async () => {
  const sale = await createCustomerSale(0,300);
  const merchandisePayment = await payment(sale.order_id,1000);
  const deliveryPayment = await payment(sale.order_id,300);
  const merchandise = await anchor(sale.order_id,merchandisePayment);
  const delivery = await anchor(sale.order_id,deliveryPayment);
  const item = await json(`SELECT to_jsonb(id) FROM public.order_items WHERE order_id=${q(sale.order_id)};`);
  const items = JSON.stringify([{return_scope:'base_unit',order_item_id:item,quantity:1,stock_disposition:'damaged'}]);
  const returned = await json(`${claims} SELECT public.settle_sales_return_v1(
    ${q(sale.order_id)},${q(randomUUID())},${q(items)}::jsonb,'Delivery remains separate',
    'cliq','S3-DELIVERY-REF',NULL);`);
  assert.equal(returned.moneyRefundInMinorUnits,1000);
  assert.equal(returned.deliveryRefundInMinorUnits,0);
  const before = await fingerprint();
  await rejected(reverseSql(sale.order_id,merchandise,merchandisePayment,randomUUID()),
    /PHASE5_PAYMENT_REVERSAL_CAPACITY_EXCEEDED/u);
  assert.equal(await fingerprint(),before);
  const key = randomUUID();
  const result = await json(reverseSql(sale.order_id,delivery,deliveryPayment,key));
  assert.equal(result.financialPosition.candidateCoverage,1000);
  assert.equal(result.financialPosition.settledMoneyRefund,1000);
  assert.equal(result.financialPosition.collectedDelivery,0);
  const after = await fingerprint();
  assert.deepEqual(await json(reverseSql(sale.order_id,delivery,deliveryPayment,key)),result);
  assert.equal(await fingerprint(),after);
  passed.push('real Customer delivery: merchandise refund excludes delivery; backing reversal rejects, exact delivery payment reversal and replay remain valid');
};

const historicalCompletenessMatrix = async () => {
  const sale = await createSale('debt',2);
  const a = await payment(sale.orderId,700), b = await payment(sale.orderId,300);
  const ca = await anchor(sale.orderId,a), cb = await anchor(sale.orderId,b);
  const firstCall = reverseSql(sale.orderId,ca,a,randomUUID());
  const first = await json(firstCall);
  const call = reverseSql(sale.orderId,cb,b,randomUUID());
  const result = await json(call);
  assert.equal(result.financialPosition.candidateCoverage,0);
  const before = await fingerprint();
  assert.deepEqual(await json(firstCall),first);
  assert.deepEqual(await json(call),result);
  assert.equal(await fingerprint(),before);
  const forgedPosition = { ...result.financialPosition,collectionCoverageBefore:1000,candidateCoverage:700 };
  const cases = [
    ['omitted prior + coherent forged position/result',
      `prior_reversal_operation_ids=ARRAY[]::uuid[],position_snapshot=${q(JSON.stringify(forgedPosition))}::jsonb`],
    ['duplicated prior',`prior_reversal_operation_ids=ARRAY[${q(first.operationId)}::uuid,${q(first.operationId)}::uuid]`],
    ['substituted prior identity',`prior_reversal_operation_ids=ARRAY[${q(randomUUID())}::uuid]`],
    ['missing collection source',`sources_snapshot=(SELECT jsonb_agg(s) FROM jsonb_array_elements(sources_snapshot) s WHERE s->>'sourceId'<>${q(a.id)})`],
    ['duplicate collection source',`sources_snapshot=sources_snapshot || (SELECT jsonb_build_array(s) FROM jsonb_array_elements(sources_snapshot) s WHERE s->>'sourceId'=${q(a.id)})`],
    ['extra source identity',`sources_snapshot=sources_snapshot || ${q(JSON.stringify([{ kind:'customer_payment',sourceId:randomUUID() }]))}::jsonb`],
  ];
  for (const [label, mutation] of cases) {
    await rejected(`BEGIN; ALTER TABLE phase5_private.reversal_coordinator_completions DISABLE TRIGGER USER;
      UPDATE phase5_private.reversal_coordinator_completions SET ${mutation} WHERE operation_id=${q(result.operationId)};
      UPDATE phase5_private.reversal_coordinator_completions SET result_snapshot=jsonb_set(result_snapshot,
        '{financialPosition}',position_snapshot) WHERE operation_id=${q(result.operationId)};
      ${call} ROLLBACK;`,/PHASE5_POSITION_(HISTORY_INCOMPLETE|IDENTITY_INVALID)/u);
    assert.equal(await fingerprint(),before,label);
  }
  // Initial finalization must reject the same omitted history, before commit.
  const later = await payment(sale.orderId,100);
  const laterCollection = await anchor(sale.orderId,later);
  const laterCall = reverseSql(sale.orderId,laterCollection,later,randomUUID());
  const laterBefore = await fingerprint();
  for (const mutation of [
    `prior_reversal_operation_ids=ARRAY[]::uuid[],position_snapshot=jsonb_set(position_snapshot,'{candidateCoverage}','1000')`,
    `sources_snapshot=(SELECT jsonb_agg(s) FROM jsonb_array_elements(sources_snapshot) s WHERE s->>'sourceId'<>${q(a.id)})`,
  ]) {
    await rejected(`BEGIN;
      ALTER TABLE phase5_private.reversal_coordinator_completions DISABLE TRIGGER phase5_reversal_completion_immutable;
      CREATE FUNCTION phase5_private.slice3_test_history() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN UPDATE phase5_private.reversal_coordinator_completions SET ${mutation}
          WHERE operation_id=NEW.operation_id; RETURN NEW; END; $$;
      CREATE TRIGGER slice3_history AFTER INSERT ON phase5_private.reversal_coordinator_completions
        FOR EACH ROW EXECUTE FUNCTION phase5_private.slice3_test_history();
      ${laterCall} ROLLBACK;`,/PHASE5_POSITION_HISTORY_INCOMPLETE/u);
    assert.equal(await fingerprint(),laterBefore);
  }
  // Later anchored payments and later operational reversals do not rewrite replay history.
  const laterResult = await json(laterCall);
  assert.equal(laterResult.financialPosition.candidateCoverage,0);
  const evolved = await fingerprint();
  assert.deepEqual(await json(firstCall),first);
  assert.deepEqual(await json(call),result);
  assert.equal(await fingerprint(),evolved);
  passed.push('historical exact-set sources/prior reversals: six adversarial variants, finalization/replay parity, later-history replay zero-write');

  const customer = await createCustomerSale(0,300);
  const merchandisePayment = await payment(customer.order_id,1000);
  const deliveryPayment = await payment(customer.order_id,300);
  await anchor(customer.order_id,merchandisePayment);
  const delivery = await anchor(customer.order_id,deliveryPayment);
  const item = await json(`SELECT to_jsonb(id) FROM public.order_items WHERE order_id=${q(customer.order_id)};`);
  const returnItems = JSON.stringify([{ return_scope:'base_unit',order_item_id:item,quantity:1,stock_disposition:'damaged' }]);
  await json(`${claims} SELECT public.settle_sales_return_v1(${q(customer.order_id)},${q(randomUUID())},
    ${q(returnItems)}::jsonb,'Historical Return membership','cliq','S3-HISTORY',NULL);`);
  const returnOp = await json(`SELECT to_jsonb(operation_id) FROM public.sales_return_events WHERE order_id=${q(customer.order_id)};`);
  const deliveryCall = reverseSql(customer.order_id,delivery,deliveryPayment,randomUUID());
  const beforeDelivery = await fingerprint();
  await rejected(`BEGIN;
    ALTER TABLE phase5_private.reversal_coordinator_completions DISABLE TRIGGER phase5_reversal_completion_immutable;
    CREATE FUNCTION phase5_private.slice3_test_history() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN UPDATE phase5_private.reversal_coordinator_completions SET settled_return_operation_ids=ARRAY[]::uuid[],
        position_snapshot=jsonb_set(position_snapshot,'{settledMoneyRefund}','0')
        WHERE operation_id=NEW.operation_id; RETURN NEW; END; $$;
    CREATE TRIGGER slice3_history AFTER INSERT ON phase5_private.reversal_coordinator_completions
      FOR EACH ROW EXECUTE FUNCTION phase5_private.slice3_test_history();
    ${deliveryCall} ROLLBACK;`,/PHASE5_POSITION_HISTORY_INCOMPLETE/u);
  assert.equal(await fingerprint(),beforeDelivery);
  const deliveryResult = await json(deliveryCall);
  const returnBefore = await fingerprint();
  for (const mutation of [
    `settled_return_operation_ids=ARRAY[]::uuid[],position_snapshot=jsonb_set(position_snapshot,'{settledMoneyRefund}','0')`,
    `settled_return_operation_ids=ARRAY[${q(returnOp)}::uuid,${q(returnOp)}::uuid]`,
    `settled_return_operation_ids=ARRAY[${q(randomUUID())}::uuid]`,
  ]) {
    await rejected(`BEGIN; ALTER TABLE phase5_private.reversal_coordinator_completions DISABLE TRIGGER USER;
      UPDATE phase5_private.reversal_coordinator_completions SET ${mutation} WHERE operation_id=${q(deliveryResult.operationId)};
      UPDATE phase5_private.reversal_coordinator_completions SET result_snapshot=jsonb_set(result_snapshot,
        '{financialPosition}',position_snapshot) WHERE operation_id=${q(deliveryResult.operationId)};
      ${deliveryCall} ROLLBACK;`,/PHASE5_POSITION_(HISTORY_INCOMPLETE|IDENTITY_INVALID)/u);
    assert.equal(await fingerprint(),returnBefore);
  }
  assert.deepEqual(await json(deliveryCall),deliveryResult);
  assert.equal(await fingerprint(),returnBefore);
  // A Return committed after a valid reversal is excluded from that older snapshot.
  const paidSale = await createSale();
  const extra = await payment(paidSale.orderId,300);
  const extraCollection = await anchor(paidSale.orderId,extra);
  const oldCall = reverseSql(paidSale.orderId,extraCollection,extra,randomUUID());
  const oldResult = await json(oldCall);
  const paidItem = await json(`SELECT to_jsonb(id) FROM public.order_items WHERE order_id=${q(paidSale.orderId)};`);
  await json(`${claims} SELECT public.settle_sales_return_v1(${q(paidSale.orderId)},${q(randomUUID())},
    ${q(JSON.stringify([{ return_scope:'base_unit',order_item_id:paidItem,quantity:1,stock_disposition:'damaged' }]))}::jsonb,
    'Later Return does not rewrite history','cliq','S3-LATER',NULL);`);
  const afterReturn = await fingerprint();
  assert.deepEqual(await json(oldCall),oldResult);
  assert.equal(await fingerprint(),afterReturn);
  passed.push('historical settled Return exact-set: omission/duplicate/substitution reject; legitimate later Return preserves immutable replay');
};

try {
  // An explicit same-project temporary stack may be adopted during development
  // only. Normal local/CI runs bootstrap and reset a fresh isolated stack.
  if (process.env.NAWASRAH_SLICE3_ISOLATED_ROOT) {
    assert.notEqual(process.env.CI, '1', 'CI must rebuild; development stack adoption is not a final gate');
    workdir = path.resolve(process.env.NAWASRAH_SLICE3_ISOLATED_ROOT);
    assert.equal(path.dirname(workdir), path.resolve(os.tmpdir()));
    assert.match(path.basename(workdir), /^nawasrah-isolated-supabase-/u);
    assert.match(await readFile(path.join(workdir, 'supabase/config.toml'), 'utf8'),
      new RegExp(`project_id = "${projectId}"`, 'u'));
  } else {
    const boot = await exec(process.execPath, [path.join(root, 'scripts/testing/bootstrap-isolated-supabase.mjs')], {
      cwd: root, windowsHide: true, timeout: 360000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, NAWASRAH_ISOLATED_PROJECT_ID: projectId, NAWASRAH_MAX_MIGRATION: '126',
        NAWASRAH_SUPABASE_EXCLUDE: 'realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor' },
    });
    workdir = JSON.parse(boot.stdout).isolatedProjectRoot;
  }
  assert.equal(await json(`SELECT to_jsonb(to_regclass('phase5_private.reversal_tender_movements') IS NOT NULL);`), true);
  if (!process.env.NAWASRAH_SLICE3_ISOLATED_ROOT) {
    assert.deepEqual(await json(`SELECT jsonb_build_object('count',count(*),'minimum',min(version),
      'maximum',max(version)) FROM supabase_migrations.schema_migrations;`),
    { count: 126, minimum: '001', maximum: '126' });
    passed.push('fresh full-schema rebuild 001-126');
  } else passed.push('explicit development stack adopted; fresh rebuild proof not claimed');
  const fixture = await readFile(path.join(root, 'scripts/testing/phase3-configurable-parcel-contracts-runtime.sql'), 'utf8');
  const start = fixture.indexOf('DO $$');
  const end = fixture.indexOf('DO $$', start + 5);
  assert.ok(start > 0 && end > start);
  await sql(fixture.slice(0, end));
  if (process.env.NAWASRAH_SLICE3_ONLY_LOCK_MATRIX === '1') {
    await shiftLockMatrix();
  } else {
  await shiftLockMatrix();
  await fkParentContentionMatrix();
  await shiftCloseRace();
  await strongestShiftMatrix();
  await fullShiftReversalRace();
  await changedDiscoveryMatrix();
  await postReturnCapacityMatrix();
  await deliveryCapacityMatrix();
  await historicalCompletenessMatrix();
  const sale = await createSale();
  const a = await payment(sale.orderId, 700);
  const b = await payment(sale.orderId, 300);
  await anchor(sale.orderId, a);
  const cb = await anchor(sale.orderId, b);
  const key = randomUUID();
  const call = reverseSql(sale.orderId, cb, b, key, 'cash');
  const beforePublic = await json(`SELECT jsonb_build_object('paid',amount_paid_in_minor_units,
    'payment', (SELECT to_jsonb(p) FROM public.customer_payments p WHERE id=${q(b.id)}))
    FROM public.orders WHERE id=${q(sale.orderId)};`);
  const result = await json(call);
  assert.equal(result.success, true);
  assert.equal(result.coordinatorVersion, 503);
  assert.equal(result.financialPosition.collectionCoverageBefore, 1000);
  assert.equal(result.financialPosition.candidateCoverage, 700);
  assert.equal(result.reversedAmountInMinorUnits, 300);
  assert.equal(result.reversalTenderMethod, 'cash');
  assert.notEqual(result.sourceRecordedAt, result.operationEventAt);
  assert.deepEqual(await json(`SELECT jsonb_build_object('paid',amount_paid_in_minor_units,
    'payment', (SELECT to_jsonb(p) FROM public.customer_payments p WHERE id=${q(b.id)}))
    FROM public.orders WHERE id=${q(sale.orderId)};`), beforePublic);
  passed.push('70+30 full exact reversal; cross-tender Cash; private public-projection coexistence');
  const fp = await fingerprint();
  assert.deepEqual(await json(call), result);
  assert.equal(await fingerprint(), fp);
  passed.push('committed operational replay is exact and content-sensitive zero-write');
  await rejected(reverseSql(sale.orderId, cb, b, key), /PHASE5_PAYMENT_REVERSAL_IDEMPOTENCY_CONFLICT/u);
  await rejected(reverseSql(sale.orderId, cb, b, `${key}-changed`), /PHASE5_PAYMENT_ALREADY_REVERSED/u);
  assert.equal(await fingerprint(), fp);
  for (const injection of [
    `UPDATE phase5_private.reversal_tender_movements SET amount_in_minor_units=301 WHERE operation_id=${q(result.operationId)};`,
    `UPDATE phase5_private.reversal_tender_movements SET source_recorded_at=source_recorded_at+interval '1 second' WHERE operation_id=${q(result.operationId)};`,
    `DELETE FROM phase5_private.reversal_tender_movements WHERE operation_id=${q(result.operationId)};`,
    `UPDATE phase5_private.reversal_coordinator_completions SET result_snapshot='{}' WHERE operation_id=${q(result.operationId)};`,
  ]) {
    await rejected(`BEGIN; ALTER TABLE phase5_private.reversal_tender_movements DISABLE TRIGGER USER;
      ALTER TABLE phase5_private.reversal_coordinator_completions DISABLE TRIGGER USER;
      ${injection} ${call} ROLLBACK;`, /PHASE5_OPERATIONAL_REVERSAL_(EVIDENCE_INVALID|RESULT_INVALID|COMPLETION_REQUIRED)/u);
    assert.equal(await fingerprint(), fp);
  }
  passed.push('missing/mismatched movement/result/source-time replay rejection with rollback');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await rejected(`SET ROLE ${role}; ${call}`, /permission denied for schema phase5_private/u);
  }
  await rejected(call.replace(q(owner), q(salesActor)), /PHASE5_COORDINATOR_ACTOR_UNAUTHORIZED/u);
  assert.equal(await fingerprint(), fp);
  passed.push('runtime private ACL and unauthorized actor denial');
  const salesSale = await createSale();
  const salesClaims = claims.replace(owner, salesActor);
  const salesPaymentResult = await json(`${salesClaims} SELECT public.record_customer_order_payment(
    ${q(salesSale.orderId)},700,'cliq','S3-SALES-SOURCE','Original Sales actor');`);
  const salesPayment = await json(`SELECT to_jsonb(p) FROM public.customer_payments p
    WHERE payment_number=${q(salesPaymentResult.payment_number)};`);
  const salesAnchor = await json(`SELECT phase5_private.anchor_existing_collection_v1(
    ${q(salesActor)},${q(salesSale.orderId)},${q(salesPayment.id)},${q(randomUUID())});`);
  await rejected(reverseSql(salesSale.orderId, salesAnchor, salesPayment, randomUUID()).replace(q(owner), q(salesActor)),
    /42501: PHASE5_COORDINATOR_ACTOR_UNAUTHORIZED/u);
  const ownerReversal = await json(reverseSql(salesSale.orderId, salesAnchor, salesPayment, randomUUID()));
  assert.equal(ownerReversal.success, true);
  assert.equal(ownerReversal.reversedAmountInMinorUnits, 700);
  passed.push('Sales may anchor its own real payment but only an authorized financial actor may reverse it');
  const foundationSale = await createSale();
  const fa = await payment(foundationSale.orderId, 700);
  const fb = await payment(foundationSale.orderId, 300);
  const fca = await anchor(foundationSale.orderId, fa);
  const fcb = await anchor(foundationSale.orderId, fb);
  const fkey = randomUUID();
  await json(`SELECT phase5_private.commit_customer_payment_reversal_v1(${q(owner)},${q(foundationSale.orderId)},
    ${q(fcb.collectionEventId)},${q(fb.id)},'cliq','R-S3','Exact full reversal',${q(fkey)});`);
  const foundationFp = await fingerprint();
  await rejected(reverseSql(foundationSale.orderId, fcb, fb, fkey), /PHASE5_OPERATIONAL_REVERSAL_COMPLETION_REQUIRED/u);
  await rejected(reverseSql(foundationSale.orderId, fca, fa, randomUUID()), /PHASE5_OPERATIONAL_REVERSAL_COMPLETION_REQUIRED/u);
  assert.equal(await fingerprint(), foundationFp);
  passed.push('foundation-only replay and prior foundation reversal both fail closed without adoption');
  const faultSale = await createSale();
  const faultPayment = await payment(faultSale.orderId, 1000);
  const faultCollection = await anchor(faultSale.orderId, faultPayment);
  const faultCall = reverseSql(faultSale.orderId, faultCollection, faultPayment, randomUUID());
  const faultFp = await fingerprint();
  for (const table of ['financial_operation_events', 'payment_reversal_events',
    'reversal_tender_movements', 'reversal_coordinator_completions']) {
    await rejected(`BEGIN;
      CREATE FUNCTION phase5_private.slice3_test_abort() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'S3_INJECTED_ABORT'; END; $$;
      CREATE TRIGGER slice3_fault AFTER INSERT ON phase5_private.${table}
        FOR EACH ROW EXECUTE FUNCTION phase5_private.slice3_test_abort();
      ${faultCall} ROLLBACK;`, /S3_INJECTED_ABORT/u);
    assert.equal(await fingerprint(), faultFp);
  }
  passed.push('fault after each business/evidence write rolls back complete content footprint');
  await rejected(`BEGIN;
    ALTER TABLE phase5_private.reversal_tender_movements DISABLE TRIGGER phase5_reversal_movement_immutable;
    CREATE FUNCTION phase5_private.slice3_test_corrupt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN UPDATE phase5_private.reversal_tender_movements SET amount_in_minor_units=amount_in_minor_units+1
        WHERE operation_id=NEW.operation_id; RETURN NEW; END; $$;
    CREATE TRIGGER slice3_corrupt AFTER INSERT ON phase5_private.reversal_tender_movements
      FOR EACH ROW EXECUTE FUNCTION phase5_private.slice3_test_corrupt();
    ${faultCall} ROLLBACK;`, /PHASE5_OPERATIONAL_REVERSAL_EVIDENCE_INVALID/u);
  assert.equal(await fingerprint(), faultFp);
  passed.push('same wrong-amount movement rejected during initial finalization and committed replay');
  const fullCustomer = await createCustomerSale(1000);
  const fullSources = await json(`SELECT phase5_private.discover_collection_population_v1(${q(fullCustomer.order_id)});`);
  assert.equal(fullSources.length, 1);
  assert.equal(fullSources[0].kind, 'modern_customer_initial');
  assert.equal(fullSources[0].amountInMinorUnits, 1000);
  const partialCustomer = await createCustomerSale(300);
  const partialPayment = await json(`SELECT to_jsonb(p) FROM public.customer_payments p
    WHERE payment_number=${q(partialCustomer.customer_payment_number)};`);
  await anchor(partialCustomer.order_id, partialPayment);
  const laterPayment = await payment(partialCustomer.order_id, 700);
  const laterCollection = await anchor(partialCustomer.order_id, laterPayment);
  const customerResult = await json(reverseSql(partialCustomer.order_id, laterCollection, laterPayment, randomUUID()));
  assert.equal(customerResult.financialPosition.collectionCoverageBefore, 1000);
  assert.equal(customerResult.financialPosition.candidateCoverage, 300);
  passed.push('real Customer V2 full initial source and partial completion linked payment counted once');
  const deadlocksBefore = await json(`SELECT to_jsonb(deadlocks) FROM pg_stat_database WHERE datname=current_database();`);
  await race('cliq', 'cliq', true);
  await race('cash', 'cliq', false);
  await race('cliq', 'cash', false);
  await distinctKeyRace();
  await sharedShiftCrossSaleRace();
  const deadlocksAfter = await json(`SELECT to_jsonb(deadlocks) FROM pg_stat_database WHERE datname=current_database();`);
  assert.equal(deadlocksAfter - deadlocksBefore, 0);
  passed.push('real two-session same-key and both changed-payload race directions; deadlockDelta=0');
  // Exact replay is a historical result, not a fresh open-Shift eligibility check.
  await json(`${claims} SELECT public.close_cash_shift(${q(result.cashShiftId)},0,'Isolated close for replay');`);
  const closedFp = await fingerprint();
  assert.deepEqual(await json(call), result);
  assert.equal(await fingerprint(), closedFp);
  await rejected(reverseSql(faultSale.orderId, faultCollection, faultPayment, randomUUID(), 'cash'),
    /PHASE5_CASH_REVERSAL_SHIFT_REQUIRED/u);
  assert.equal(await fingerprint(), closedFp);
  const cliq = await json(faultCall);
  assert.equal(cliq.cashShiftId, null);
  assert.equal(cliq.reversalTenderMethod, 'cliq');
  passed.push('closed-Shift exact replay; Cash without open Shift rejects; valid CliQ has no fake Cash Shift');
  }
  const lint = await exec(process.execPath, [cli, 'db', 'lint', '--local', '--level', 'warning', '--workdir', workdir],
    { cwd: root, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  assertPhase5DbLint(lint.stdout);
  passed.push('strict fresh DB lint');
  console.log(JSON.stringify({ ok: true, passed, remaining: 'Affected prior-slice/final candidate regression gates and independent review still required before sign-off.' }, null, 2));
} finally {
  if (workdir) {
    await exec(process.execPath, [cli, 'stop', '--no-backup', '--workdir', workdir],
      { cwd: root, windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    const inventory = await exec('docker', ['ps', '--format', '{{.Names}}'], { windowsHide: true });
    assert.equal(inventory.stdout.split(/\r?\n/u).some((name) => name.includes(projectId)), false);
  }
}
