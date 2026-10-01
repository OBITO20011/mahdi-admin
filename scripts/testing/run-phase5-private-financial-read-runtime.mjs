import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { assertPhase5DbLint } from './phase5-db-lint-policy.mjs';

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');
const projectId = 'nawasrah-phase5-slice4-runtime-test';
const container = `supabase_db_${projectId}`;
const cli = path.join(root, 'node_modules/supabase/dist/supabase.js');
const owner = '92400000-0000-0000-0000-000000000001';
const branch = '92400000-0000-0000-0000-000000000200';
const warehouse = '92400000-0000-0000-0000-000000000201';
const product = '92400000-0000-0000-0000-000000000101';
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const claims = `SELECT set_config('request.jwt.claims',
  '{"sub":"${owner}","role":"authenticated","aal":"aal2"}',false);`;
const passed = [];
let workdir = '';

const sql = (text, failure = false) => new Promise((resolve, reject) => {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'],
  { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (c) => { stdout += c; });
  child.stderr.on('data', (c) => { stderr += c; });
  child.on('error', reject);
  child.on('close', (code) => {
    if ((code !== 0) !== failure) reject(new Error(`SQL exit ${code}: ${stderr}`));
    else resolve({ stdout, stderr });
  });
  child.stdin.end(`SET statement_timeout='10s';\n${text}`);
});
const json = async (text) => JSON.parse((await sql(text)).stdout.trim().split(/\r?\n/u).at(-1));
const rejectSql = async (text, pattern) => assert.match((await sql(text, true)).stderr, pattern);
const read = (order) => json(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
  SELECT phase5_private.read_order_financial_position_v1(${q(order)}); COMMIT;`);
const fingerprint = () => json(`SELECT to_jsonb(encode(extensions.digest((jsonb_build_object(
  'nodes',(SELECT jsonb_agg(to_jsonb(n) ORDER BY node_key) FROM phase5_private.financial_graph_nodes_v1() n),
  'inventory',(SELECT jsonb_agg(to_jsonb(t) ORDER BY warehouse_id,product_id) FROM public.inventory_balances t),
  'products',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.products t),
  'shifts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.cash_shifts t),
  'audit',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.audit_logs t),
  'guards',(SELECT jsonb_agg(to_jsonb(t) ORDER BY operation_id) FROM phase5_private.reversal_coordinator_guards t)
))::text,'sha256'),'hex'));`);
const sale = async (method = 'debt', quantity = 1) => {
  const customer = randomUUID();
  await sql(`INSERT INTO public.customers(id,full_name,phone,credit_limit_in_minor_units)
    VALUES(${q(customer)},'Slice4 isolated',${q(`079${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`)},1000000);`);
  return json(`${claims} SELECT public.create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(customer)},
    'Slice4 isolated',${q(method)},${q(JSON.stringify([{ commercial_line_kind: 'base_unit', product_id: product,
    base_quantity: quantity, price_authority: 'server_catalog', line_discount_in_minor_units: 0 }]))}::jsonb,
    0,${1000 * quantity},${q(randomUUID())});`);
};
const payment = async (order, amount, tender = 'cliq') => {
  const result = await json(`${claims} SELECT public.record_customer_order_payment(${q(order)},${amount},
    ${q(tender)},${tender === 'cliq' ? q(randomUUID()) : 'NULL'},'Slice4 real source');`);
  return json(`SELECT to_jsonb(p) FROM public.customer_payments p WHERE payment_number=${q(result.payment_number)};`);
};
const anchor = (order, p) => json(`SELECT phase5_private.anchor_existing_collection_v1(
  ${q(owner)},${q(order)},${q(p.id)},${q(randomUUID())});`);
const reversal = (order, p, c, key = randomUUID(), tender = 'cliq') =>
  `SELECT phase5_private.coordinate_payment_reversal_v1(${q(owner)},${q(order)},${q(c.collectionEventId)},
    ${q(p.id)},${q(tender)},${tender === 'cliq' ? "'S4-REV'" : 'NULL'},'Full exact payment',${q(key)});`;
const returnCall = async (order, tender = null) => {
  const item = await json(`SELECT to_jsonb(id) FROM public.order_items WHERE order_id=${q(order)};`);
  return json(`${claims} SELECT public.settle_sales_return_v1(${q(order)},${q(randomUUID())},
    ${q(JSON.stringify([{ return_scope: 'base_unit', order_item_id: item, quantity: 1, stock_disposition: 'damaged' }]))}::jsonb,
    'Slice4 return',${tender ? q(tender) : 'NULL'},${tender === 'cliq' ? "'S4-REF'" : 'NULL'},NULL);`);
};
const customerSale = async (collected, delivery = 0) => {
  await sql(`UPDATE public.configurable_parcel_feature_settings SET feature_state='ENABLED';
    UPDATE public.storefront_settings SET orders_enabled=true,minimum_order_in_minor_units=0,
      inside_ramtha_delivery_fee_in_minor_units=${delivery},outside_ramtha_delivery_fee_in_minor_units=${delivery};
    INSERT INTO public.inventory_balances(warehouse_id,product_id,on_hand_quantity,reserved_quantity)
      SELECT w.id,${q(product)},100,0 FROM public.warehouses w JOIN public.branches b ON b.id=w.branch_id
      WHERE w.is_active AND b.is_active ON CONFLICT(warehouse_id,product_id) DO UPDATE
        SET on_hand_quantity=public.inventory_balances.on_hand_quantity+100;`);
  const result = await json(`SELECT set_config('request.jwt.claim.role','service_role',false);
    SELECT public.submit_guest_customer_order_v2(${q(randomUUID())},repeat('c',64),repeat('d',64),
      'Slice4 Customer',${q(`079${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`)},
      'إربد','الرمثا','الحي الشرقي','شارع الاختبار',NULL,NULL,NULL,NULL,NULL,NULL,
      ${q(JSON.stringify([{ commercial_line_kind: 'base_unit', product_id: product, base_quantity: 1,
    expected_unit_price_in_minor_units: 1000 }]))}::jsonb,
      NULL,'cash_on_delivery','inside_ramtha',1000,0,${delivery},${1000 + delivery});`);
  await sql(`INSERT INTO public.cash_shifts(id,shift_number,branch_id,opened_by,opening_cash_in_minor_units)
    SELECT ${q(randomUUID())},${q(randomUUID())},o.branch_id,${q(owner)},0 FROM public.orders o
    WHERE o.id=${q(result.order_id)} AND NOT EXISTS(SELECT 1 FROM public.cash_shifts s WHERE s.branch_id=o.branch_id AND s.status='open');
    UPDATE public.orders SET status='ready' WHERE id=${q(result.order_id)};`);
  return json(`${claims} SELECT public.complete_website_order_with_settlement_v2(${q(result.order_id)},
    ${q(randomUUID())},'cash',${collected},${delivery},NULL,'Slice4 completion');`);
};
const corruption = async (order, text, pattern = /PHASE5_|PHASE42_|PHASE43_/u) => {
  const before = await fingerprint();
  await rejectSql(`BEGIN; ${text} SELECT phase5_private.read_order_financial_position_v1(${q(order)}); ROLLBACK;`, pattern);
  assert.equal(await fingerprint(), before, 'corruption and rejection must roll back complete content');
};

const checkCallGraph = async () => {
  const functions = await json(`SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,
    'signature',p.oid::regprocedure::text,'volatility',p.provolatile,'definer',p.prosecdef,
    'source',p.prosrc,'owner',pg_get_userbyid(p.proowner))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('phase5_private','public');`);
  const queue = ['read_order_financial_facts_v1', 'read_order_financial_position_v1', 'reconcile_order_financial_position_v1']
    .map((name) => ['phase5_private', name]);
  const seen = new Set();
  while (queue.length) {
    const [schema, name] = queue.shift();
    const matches = functions.filter((f) => f.schema === schema && f.name === name);
    assert.ok(matches.length, `${schema}.${name} must resolve in full catalog`);
    for (const f of matches) {
      if (seen.has(f.signature)) continue;
      seen.add(f.signature);
      assert.ok(['s', 'i'].includes(f.volatility), `transitive volatile helper forbidden: ${f.signature}`);
      assert.doesNotMatch(f.source, /\b(?:INSERT\s+INTO|UPDATE\s+(?:public|phase5_private)\.|DELETE\s+FROM|FOR\s+(?:UPDATE|SHARE|NO\s+KEY\s+UPDATE|KEY\s+SHARE)|pg_advisory|nextval|setval|\bEXECUTE\b)\b/iu);
      for (const match of f.source.matchAll(/\b(public|phase5_private)\.([a-z0-9_]+)\s*\(/gu)) queue.push([match[1], match[2]]);
    }
  }
  assert.ok(seen.size >= 14, 'transitive catalog review must actually include closed validators');
  passed.push(`STABLE/read-only transitive source/canonical-catalog call graph: ${seen.size} signatures`);
};

const snapshotProof = async () => {
  const s = await sale();
  const before = await read(s.orderId);
  // Disposable DB-only instrumentation, not part of Migration127. Pause AFTER
  // facts are read, BEFORE derive/reconciliation. Production graph is checked
  // above and the original function is restored in finally.
  await sql(`ALTER FUNCTION phase5_private.read_order_financial_facts_v1(uuid) RENAME TO slice4_original_facts;
    CREATE FUNCTION phase5_private.read_order_financial_facts_v1(p_order_id uuid) RETURNS jsonb
      LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
      DECLARE f jsonb; BEGIN f:=phase5_private.slice4_original_facts(p_order_id); PERFORM pg_sleep(3); RETURN f; END; $$;
    REVOKE ALL ON FUNCTION phase5_private.read_order_financial_facts_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;`);
  try {
    const app = `s4-snapshot-${randomUUID()}`;
    const reader = json(`SET application_name=${q(app)}; SELECT phase5_private.reconcile_order_financial_position_v1(${q(s.orderId)});`);
    const deadline = Date.now() + 10000;
    let observed = false;
    while (Date.now() < deadline) {
      observed = await json(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(app)} AND wait_event='PgSleep'));`);
      if (observed) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(observed, true, 'observed pause between facts and derivation required');
    // Every live transaction owns its virtual-XID ExclusiveLock. That is not
    // an Order/Shift/business lock; inspect relation/tuple/advisory resources.
    const heldLocks = await json(`SELECT jsonb_agg(jsonb_build_object('type',l.locktype,'mode',l.mode,'relation',l.relation::regclass::text))
      FROM pg_locks l JOIN pg_stat_activity a USING(pid) WHERE a.application_name=${q(app)};`);
    assert.ok(heldLocks.some((l) => l.type === 'relation'), 'inspect actual read relation locks');
    assert.deepEqual(heldLocks.filter((l) => ['advisory','tuple'].includes(l.type)
      || (l.type === 'relation' && l.mode !== 'AccessShareLock')), []);
    const p = await payment(s.orderId, 300); await anchor(s.orderId, p);
    const oldResult = await reader;
    assert.deepEqual(oldResult.canonical, before);
    assert.equal(oldResult.publicProjection.amountPaidInMinorUnits, 0);
    assert.equal(oldResult.differences.amountPaidMinusCoverageInMinorUnits, 0);
  } finally {
    await sql(`DROP FUNCTION phase5_private.read_order_financial_facts_v1(uuid);
      ALTER FUNCTION phase5_private.slice4_original_facts(uuid) RENAME TO read_order_financial_facts_v1;`);
  }
  assert.equal((await read(s.orderId)).collectionCoverageInMinorUnits, 300);
  const stable = await json(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
    SELECT to_jsonb(phase5_private.read_order_financial_position_v1(${q(s.orderId)}) =
      phase5_private.reconcile_order_financial_position_v1(${q(s.orderId)})->'canonical'); COMMIT;`);
  assert.equal(stable, true);
  passed.push('observed read-between-facts/derivation concurrent committed collection: old coherent snapshot, next fresh, no read business gates');
};

try {
  const boot = await exec(process.execPath, [path.join(root, 'scripts/testing/bootstrap-isolated-supabase.mjs')], {
    cwd: root, windowsHide: true, timeout: 360000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NAWASRAH_ISOLATED_PROJECT_ID: projectId, NAWASRAH_MAX_MIGRATION: '127',
      NAWASRAH_SKIP_REDUNDANT_DB_RESET: 'true',
      NAWASRAH_SUPABASE_EXCLUDE: 'realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor' },
  });
  const bootstrap = JSON.parse(boot.stdout);
  workdir = bootstrap.isolatedProjectRoot;
  assert.equal(bootstrap.ok,true); assert.equal(bootstrap.authBaselineEmpty,true);
  assert.ok(!bootstrap.reusedDatabaseVolume || !bootstrap.resetSkipped,
    'an existing database volume MUST be reset, never adopted as a fresh rebuild');
  assert.deepEqual(await json(`SELECT jsonb_build_object('count',count(*),'minimum',min(version),'maximum',max(version))
    FROM supabase_migrations.schema_migrations;`), { count: 127, minimum: '001', maximum: '127' });
  passed.push('fresh full-schema isolated rebuild 001-127');
  console.log('Slice4 fresh rebuild verified; starting real-source and zero-write probes.');
  const fixture = await readFile(path.join(root, 'scripts/testing/phase3-configurable-parcel-contracts-runtime.sql'), 'utf8');
  const start = fixture.indexOf('DO $$'); const end = fixture.indexOf('DO $$', start + 5);
  assert.ok(start > 0 && end > start); await sql(fixture.slice(0, end));
  await checkCallGraph();
  const s = await sale();
  const a = await payment(s.orderId, 700); const b = await payment(s.orderId, 300);
  await anchor(s.orderId, a); const cb = await anchor(s.orderId, b);
  const key = randomUUID(); const call = reversal(s.orderId, b, cb, key, 'cash');
  const originalResult = await json(call);
  const beforeRead = await fingerprint();
  const position = await read(s.orderId);
  assert.equal(position.collectionCoverageInMinorUnits, 700);
  assert.equal(position.outstandingTotalInMinorUnits, 300);
  assert.equal(position.customerCashNetFlowInMinorUnits, -300);
  assert.equal(position.customerCliqNetFlowInMinorUnits, 1000);
  assert.equal(position.customerNetMoneyFlowInMinorUnits, 700);
  const diagnostics = await json(`SELECT phase5_private.reconcile_order_financial_position_v1(${q(s.orderId)});`);
  assert.equal(diagnostics.differences.amountPaidMinusCoverageInMinorUnits, 300);
  assert.equal(diagnostics.repairPerformed, false);
  assert.deepEqual(await json(call), originalResult);
  assert.equal(await fingerprint(), beforeRead);
  passed.push('700+300 full reversal, economic/tender separation, stale public projection diagnosed not repaired; historical replay/reads zero-write');
  for (const method of ['cash','cliq']) {
    const paid = await sale(method); assert.equal((await read(paid.orderId)).collectionsInMinorUnits, 1000);
    await corruption(paid.orderId, `ALTER TABLE public.business_operations DISABLE TRIGGER USER;
      UPDATE public.business_operations SET result_snapshot=jsonb_set(result_snapshot,'{amountPaidInMinorUnits}','"1000"')
      WHERE id=(SELECT operation_id FROM public.orders WHERE id=${q(paid.orderId)});`, /PHASE5_READ_MONEY_INVALID/u);
  }
  passed.push('real modern POS initial collections have no fabricated payment inflow');
  const unanchored = await sale(); const missing = await payment(unanchored.orderId, 100);
  await rejectSql(`SELECT phase5_private.read_order_financial_position_v1(${q(unanchored.orderId)});`, /PHASE5_/u);
  // Assignable incomplete evidence on another Order does not contaminate this one.
  assert.deepEqual(await read(s.orderId), position); await anchor(unanchored.orderId, missing);
  passed.push('missing anchor rejects selected Order, unrelated assignable incomplete Order does not contaminate');
  for (const [orderIdentity, pattern] of [[s.orderId, /PHASE5_COLLECTION_EVIDENCE_INVALID/u], [null, /PHASE5_READ_UNASSIGNABLE_EVIDENCE/u]]) {
    await corruption(s.orderId, `INSERT INTO phase5_private.financial_operation_events(id,operation_type,
      idempotency_key,actor_scope_type,actor_scope_id,request_fingerprint,request_identity_snapshot,result_type,result_snapshot,operation_event_at)
      VALUES(gen_random_uuid(),'customer_collection_v1',${q(randomUUID())},'erp_user',${q(owner)},repeat('A',64),
      jsonb_build_object('orderId',${orderIdentity ? q(orderIdentity) : 'NULL'}),'customer_collection_committed_v1','{}',clock_timestamp());`, pattern);
  }
  passed.push('request-only orphan and JSON-null unassignable financial operation rejected with content-sensitive rollback');
  await corruption(s.orderId, `ALTER TABLE phase5_private.reversal_tender_movements DISABLE TRIGGER USER;
    UPDATE phase5_private.reversal_tender_movements SET amount_in_minor_units=301 WHERE operation_id=${q(originalResult.operationId)};`);
  await corruption(s.orderId, `ALTER TABLE phase5_private.reversal_coordinator_completions DISABLE TRIGGER USER;
    DELETE FROM phase5_private.reversal_coordinator_completions WHERE operation_id=${q(originalResult.operationId)};`);
  await corruption(s.orderId, `ALTER TABLE phase5_private.collection_events DISABLE TRIGGER USER;
    UPDATE phase5_private.collection_events SET order_id=${q(unanchored.orderId)} WHERE original_payment_id=${q(a.id)};`, /PHASE5_READ_INCONSISTENT_ORDER_OWNERSHIP/u);
  passed.push('movement corruption, foundation-only reversal and contradictory Order ownership reject; complete rollback');
  for (const [paid, tender, expectedDebt, expectedRefund] of [[0,null,1000,0],[300,'cash',700,300],[1000,'cash',0,1000]]) {
    const rs = await sale();
    if (paid) { const p = await payment(rs.orderId, paid); await anchor(rs.orderId, p); }
    const returned = await returnCall(rs.orderId, tender);
    assert.equal(returned.debtReductionInMinorUnits, expectedDebt);
    assert.equal(returned.moneyRefundInMinorUnits, expectedRefund);
    const value = await read(rs.orderId);
    assert.equal(value.settledDebtReductionInMinorUnits, expectedDebt);
    assert.equal(value.settledMoneyRefundInMinorUnits, expectedRefund);
    assert.equal(value.outstandingTotalInMinorUnits, 0);
    assert.equal(value.refundableCollectedInMinorUnits, 0);
    assert.equal(value.customerCashNetFlowInMinorUnits, expectedRefund === 0 ? 0 : -expectedRefund);
    assert.equal(value.customerCliqNetFlowInMinorUnits, paid);
    await corruption(rs.orderId, `ALTER TABLE public.business_operations DISABLE TRIGGER USER;
      ALTER TABLE public.phase42_return_settlement_evidence DISABLE TRIGGER USER;
      UPDATE public.business_operations SET result_snapshot=jsonb_set(result_snapshot,'{moneyRefundInMinorUnits}',to_jsonb(${q(String(expectedRefund))}::text))
        WHERE id=${q(returned.operationId)};
      UPDATE public.phase42_return_settlement_evidence SET result_snapshot=(SELECT result_snapshot FROM public.business_operations WHERE id=${q(returned.operationId)})
        WHERE operation_id=${q(returned.operationId)};`, /PHASE5_READ_MONEY_INVALID/u);
  }
  passed.push('actual debt-only/mixed/refund-only Returns, historical snapshot meanings and cross-tender refund no recreated debt');
  const full = await customerSale(1300,300);
  assert.equal((await read(full.order_id)).deliveryInMinorUnits,300);
  const deliveryReturn = await returnCall(full.order_id,'cash');
  assert.equal(deliveryReturn.moneyRefundInMinorUnits,1000);
  const deliveryPosition = await read(full.order_id);
  assert.equal(deliveryPosition.customerNetMoneyFlowInMinorUnits,300);
  assert.equal(deliveryPosition.collectedDeliveryInMinorUnits,300);
  assert.equal(deliveryPosition.refundableCollectedInMinorUnits,0);
  const partial = await customerSale(300);
  const cp = await json(`SELECT to_jsonb(p) FROM public.customer_payments p WHERE payment_number=${q(partial.customer_payment_number)};`);
  await anchor(partial.order_id,cp);
  assert.equal((await read(partial.order_id)).collectionsInMinorUnits,300);
  for (const identity of [full.order_id,partial.order_id]) {
    await corruption(identity, `ALTER TABLE public.business_operations DISABLE TRIGGER USER;
      UPDATE public.business_operations SET result_snapshot=jsonb_set(result_snapshot,'{amount_paid_in_minor_units}',to_jsonb((result_snapshot->>'amount_paid_in_minor_units')::text))
        WHERE operation_type='phase3_customer_completion_v1' AND request_identity_snapshot->>'order_id'=${q(identity)};`, /PHASE5_READ_MONEY_INVALID/u);
  }
  passed.push('real Customer full initial delivery and partial linked payment counted once');
  const historical = await sale('debt',2);
  const hp = await payment(historical.orderId,300); await anchor(historical.orderId,hp);
  const hr = await returnCall(historical.orderId);
  assert.equal(hr.debtReductionInMinorUnits,1000);
  const laterPayment = await payment(historical.orderId,700); await anchor(historical.orderId,laterPayment);
  assert.equal((await read(historical.orderId)).outstandingTotalInMinorUnits,0);
  assert.equal((await read(historical.orderId)).settledDebtReductionInMinorUnits,1000);
  passed.push('historical debt-first Return allocation survives later collection without recomputing its snapshot');

  for (const allDamage of [true,false]) {
    const lines = [{commercial_line_kind:'configurable_parcel',family_product_id:'92400000-0000-0000-0000-000000000100',
      parcel_configuration_id:'92400000-0000-0000-0000-000000000300',configuration_revision:1,
      price_authority:'server_catalog',line_discount_in_minor_units:0,parcel_instances:[{components:[
        {product_id:product,base_quantity:2},{product_id:'92400000-0000-0000-0000-000000000102',base_quantity:3}]}]}];
    const ps = await json(`${claims} SELECT public.create_pos_sale_v2(${q(warehouse)},${q(branch)},NULL,'Slice4 Parcel',
      'cash',${q(JSON.stringify(lines))}::jsonb,1000,4000,${q(randomUUID())});`);
    const parcel = await json(`SELECT jsonb_build_object('id',p.id,'item',p.order_item_id,'components',
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.order_parcel_components c WHERE c.parcel_instance_id=p.id))
      FROM public.order_parcel_instances p WHERE p.order_id=${q(ps.orderId)};`);
    const request = [{return_scope:'parcel_instance',order_item_id:parcel.item,parcel_instance_id:parcel.id,
      components:parcel.components.map((c) => {
        const damaged = allDamage || c.product_id === product;
        return {parcel_component_id:c.id,accepted_quantity:damaged ? 0 : c.base_quantity,
          rejected_quantity:damaged ? c.base_quantity : 0,accepted_condition:damaged ? null : 'sellable',
          accepted_stock_disposition:damaged ? null : 'restock',rejection_reason:damaged ? 'customer_damage' : null,
          rejected_stock_disposition:damaged ? 'returned_to_customer' : null};
      })}];
    const expected = allDamage ? 0 : 2000;
    const result = await json(`${claims} SELECT public.settle_sales_return_v1(${q(ps.orderId)},${q(randomUUID())},
      ${q(JSON.stringify(request))}::jsonb,'Historical damage',${expected ? "'cash'" : 'NULL'},NULL,NULL);`);
    assert.equal(result.merchandiseEntitlementInMinorUnits,expected);
    assert.equal((await read(ps.orderId)).settledMerchandiseReturnEntitlementInMinorUnits,expected);
    if (!allDamage) {
      await corruption(ps.orderId, `ALTER TABLE public.phase42_return_inventory_effects DISABLE TRIGGER USER;
        DELETE FROM public.phase42_return_inventory_effects WHERE operation_id=${q(result.operationId)};`);
      await corruption(ps.orderId, `ALTER TABLE public.inventory_movements DISABLE TRIGGER USER;
        INSERT INTO public.inventory_movements SELECT (jsonb_populate_record(NULL::public.inventory_movements,
          to_jsonb(m)||jsonb_build_object('id',gen_random_uuid(),'product_id',${q(product)}::uuid,'mutation_sequence',
            (SELECT max(mutation_sequence)+1 FROM public.inventory_movements)))).* FROM public.inventory_movements m
          WHERE reference_type='phase4_sales_return' AND reference_id=${q(result.returnId)} LIMIT 1;`,
      /PHASE5_READ_RETURN_EVIDENCE_INVALID/u);
    }
  }
  passed.push('whole Parcel damage cap and mixed sellable/damage Return, missing effect and extra actual Return movement fail closed');
  const draftSale = await sale();
  const draftId = randomUUID(); const draftOp = randomUUID();
  const draftRequest = JSON.stringify({ order_id:draftSale.orderId });
  await sql(`INSERT INTO public.business_operations(id,operation_type,idempotency_key,request_fingerprint,
    initiated_by,result_snapshot,completed_at,request_identity_version,request_identity_snapshot,actor_scope_type,actor_scope_hash)
    VALUES(${q(draftOp)},'phase4_return_v1',${q(randomUUID())},public.phase3_request_fingerprint_internal(${q(draftRequest)}::jsonb),
      ${q(owner)},jsonb_build_object('success',true,'operationId',${q(draftOp)},'returnId',${q(draftId)}),
      statement_timestamp(),401,${q(draftRequest)}::jsonb,'erp_user',public.phase3_actor_scope_hash_internal('erp_user',${q(owner)},NULL,NULL));
    INSERT INTO public.sales_return_events(id,return_number,operation_id,order_id,branch_id,warehouse_id,reason,
      contract_version,settlement_status,merchandise_refund_amount_in_minor_units,
      outstanding_debt_before_snapshot_in_minor_units,net_collected_before_snapshot_in_minor_units,
      debt_reduction_amount_in_minor_units,money_refund_amount_in_minor_units,
      raw_customer_damage_deduction_in_minor_units,applied_customer_damage_deduction_in_minor_units)
    VALUES(${q(draftId)},${q(randomUUID())},${q(draftOp)},${q(draftSale.orderId)},${q(branch)},${q(warehouse)},
      'Valid unfinalized draft',401,'draft',0,1000,0,0,0,0,0);`);
  assert.equal((await read(draftSale.orderId)).settledMerchandiseReturnEntitlementInMinorUnits,0);
  await sql(`SELECT public.phase4_cancel_draft_aftercare_internal(${q(draftOp)});`);
  assert.equal((await read(draftSale.orderId)).settledMerchandiseReturnEntitlementInMinorUnits,0);
  passed.push('structurally valid draft/cancelled foundation result does not imply operational settlement or consume money');

  // Arithmetic probes exercise the pure decoder/deriver, not invented durable
  // operational evidence. Real source/Return/reversal validity is proven above.
  const facts = (c,v,d,r,t=1000,l=0) => ({ contractVersion:504,orderId:s.orderId,totalInMinorUnits:t,deliveryInMinorUnits:l,
    sources:[{amountInMinorUnits:c,tenderMethod:'cliq'}],
    reversals:v ? [{amount_in_minor_units:v,actual_tender:'cliq'}] : [],
    returns:d || r ? [{debt_reduction_amount_in_minor_units:d,money_refund_amount_in_minor_units:r,refund_method:r ? 'cash' : null}] : [] });
  const derive = (f) => `SELECT phase5_private.derive_financial_position_v1(${q(JSON.stringify(f))}::jsonb);`;
  const recollection = await json(derive(facts(1300,300,0,0)));
  assert.equal(recollection.collectionCoverageInMinorUnits,1000);
  for (const zone of ['UTC','Pacific/Auckland','Asia/Amman']) {
    assert.deepEqual(await json(`SET TimeZone=${q(zone)}; ${derive(facts(1300,300,0,0))}`),recollection);
  }
  const deliveryResidual = await json(derive(facts(1000,0,0,1000,1100,100)));
  assert.equal(deliveryResidual.deliveryOutstandingInMinorUnits,100);
  assert.equal(deliveryResidual.customerNetMoneyFlowInMinorUnits,0);
  for (const f of [facts(1000,0,0,1100),facts(1000,0,300,0),facts(100,300,0,0),
    facts(1000,0,0,1000,1100,200),facts(-1,0,0,0),facts(null,0,0,0),facts('1000',0,0,0),facts(1.5,0,0,0)]) {
    await rejectSql(derive(f),/PHASE5_READ_(MONEY|FINANCIAL_DOMAIN)_INVALID/u);
  }
  await rejectSql(`SELECT phase5_private.money_v1('9223372036854775808'::jsonb);`,/PHASE5_READ_MONEY_INVALID/u);
  await rejectSql(`SELECT phase5_private.money_v1(NULL);`,/PHASE5_READ_MONEY_INVALID/u);
  passed.push('exact arithmetic SQL/JSON-null/text/fraction/negative/overflow matrix; valid gross recollection and delivery-only debt');
  for (const role of ['anon','authenticated','service_role']) {
    for (const fn of ['read_order_financial_facts_v1','read_order_financial_position_v1','reconcile_order_financial_position_v1']) {
      await rejectSql(`SET ROLE ${role}; SELECT phase5_private.${fn}(${q(s.orderId)});`, /permission denied for schema phase5_private/u);
    }
  }
  passed.push('nine actual app-role private read denials');
  await snapshotProof();
  await checkCallGraph();
  const lint = await exec(process.execPath,[cli,'db','lint','--local','--level','warning','--workdir',workdir],
    { cwd:root, windowsHide:true,maxBuffer:4*1024*1024 });
  assertPhase5DbLint(lint.stdout); passed.push('strict isolated full-schema DB lint');
  console.log(JSON.stringify({ ok:true,passed,remaining:'Focused completeness, affected regression and final candidate/independent gates remain required.' },null,2));
} finally {
  if (workdir) {
    await exec(process.execPath,[cli,'stop','--no-backup','--workdir',workdir],
      { cwd:root,windowsHide:true,timeout:120000,maxBuffer:4*1024*1024 });
    const inventory = await exec('docker',['ps','--format','{{.Names}}'],{ windowsHide:true });
    assert.equal(inventory.stdout.split(/\r?\n/u).some((name) => name.includes(projectId)),false);
  }
}
