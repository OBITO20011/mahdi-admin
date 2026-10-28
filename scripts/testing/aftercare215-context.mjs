import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {executorFor, executeInput} from '../operations/build-empty-supabase.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';

export function aftercare215Context(container) {
  assert.equal(container, 'supabase_db_nawasrah-tb215-test', 'ISOLATED_FIXED_CONTAINER_ONLY');
  const executor = executorFor(['--container', container]);
  const id = n => `92600000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const owner = id(1), branch = id(200), warehouse = id(201), supplier = id(301);
  const q = v => v == null ? 'NULL' : "'" + String(v).replaceAll("'", "''") + "'";
  const j = v => q(JSON.stringify(v)) + '::jsonb';
  const key = () => `aftercare215-test-${randomUUID()}`;
  const sql = async text => {
    const r = await executeInput(executor, text);
    assert.equal(r.code, 0, r.stderr);
    return r.stdout.trim();
  };
  const json = async text => JSON.parse((await sql(text)).split('\n').at(-1));
  const auth = (text, uid = owner, role = 'authenticated', aal = 'aal2', readonly = false) =>
    `BEGIN${readonly ? ' READ ONLY' : ''};SELECT set_config('request.jwt.claims',${q(JSON.stringify({sub: uid, role, aal}))},true);SET LOCAL ROLE ${role};${text}COMMIT;`;
  const rpc = (call, uid = owner, role = 'authenticated', aal = 'aal2', readonly = false) =>
    json(auth('SELECT public.' + call + ';', uid, role, aal, readonly));
  const fingerprint = () => readApplicationFingerprint(executor);
  const fail = async (call, pattern, uid = owner, role = 'authenticated', aal = 'aal2') => {
    const before = await fingerprint();
    const r = await executeInput(executor, auth('SELECT public.' + call + ';', uid, role, aal));
    assert.notEqual(r.code, 0, 'EXPECTED_REFUSAL');
    assert.match(r.stderr, pattern);
    assert.deepEqual(await fingerprint(), before, 'ALL_DATA_AND_SEQUENCES_UNCHANGED');
  };
  const receive = (pid, quantity, cost, supplierId = supplier) => rpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(supplierId)},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q(key())},p_payment_method:='deferred',p_lines:=${j([{client_line_id: id(999), line_kind: 'base_unit', commercial_quantity: quantity, base_unit_name: 'باكيت', gross_amount_in_minor_units: quantity * cost, line_discount_in_minor_units: 0, components: [{product_id: pid, base_quantity: quantity}]}])})`);
  const stock = pid => json(`SELECT jsonb_build_object('quantity',b.on_hand_quantity,'wac',p.wac_cost_in_minor_units_exact::TEXT,'reserved',b.reserved_quantity) FROM public.products p JOIN public.inventory_balances b ON b.product_id=p.id WHERE p.id=${q(pid)} AND b.warehouse_id=${q(warehouse)};`);
  const facts = () => json(`SELECT public.phase6_financial_facts_internal(${q(branch)},clock_timestamp()-INTERVAL '2 days',clock_timestamp()+INTERVAL '2 days','Asia/Amman',true);`);
  const money = () => json(`SELECT jsonb_build_object('suppliers',(SELECT jsonb_agg(jsonb_build_array(id,current_balance_in_minor_units) ORDER BY id) FROM suppliers),'customers',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM customers c),'shifts',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM cash_shifts s),'customerPayments',(SELECT count(*) FROM customer_payments),'supplierPayments',(SELECT count(*) FROM supplier_payments));`);
  const setup = async ({cost = 500, only = false, packets = 12, good = 11, supplierHeld = false, paymentMethod = 'cash', discount = 0, kind = 'parcel', soldQuantity = 3} = {}) => {
    const pid = randomUUID();
    await sql(`INSERT INTO public.products(id,sku,name_ar,category_id,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,sale_price_in_minor_units,default_sale_price_in_minor_units,cost_price_in_minor_units,wac_cost_in_minor_units_exact,is_active,is_flavor_master,parcel_only)
      SELECT ${q(pid)},${q('INSPECT215-' + pid)},'طرد اختبار الفحص',category_id,unit_id,purchase_unit_id,sale_unit_id,${packets},${packets},1000,9000,0,0,true,false,${only} FROM public.products WHERE id=${q(id(103))};`);
    await receive(pid, 100 + (kind === 'parcel' ? packets : soldQuantity), cost);
    const line = kind === 'parcel' ? {commercial_line_kind: 'legacy_single_sku_parcel', product_id: pid, parcel_quantity: 1, units_per_parcel: packets}
      : {commercial_line_kind: 'base_unit', product_id: pid, base_quantity: soldQuantity};
    const sale = await rpc(`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(id(401))},'عميل تجربة الفحص',${q(paymentMethod)},${j([{...line, price_authority: 'server_catalog', line_discount_in_minor_units: 0}])},${discount},9000,${q(key())})`);
    const item = await json(`SELECT to_jsonb(id) FROM public.order_items WHERE order_id=${q(sale.orderId)};`);
    return {pid, sale, item, payload: {orderId: sale.orderId, items: [{sourceKind: 'base_order_item', sourceId: item, quantity: packets, goodQuantity: good, supplierId: supplierHeld ? supplier : null}], reason: 'فحص الطرد الراجع واستبداله', notes: null}};
  };
  const initialize = async () => {
    await sql('ALTER TABLE orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;');
    await sql(await readFile(new URL('./package-e-golden-day-fixture.sql', import.meta.url), 'utf8'));
    await rpc(`set_go_live_main_branch_v1(${q(branch)})`);
    await rpc(`open_cash_shift(${q(branch)},500000)`);
  };
  return {executor, id, owner, branch, warehouse, supplier, q, j, key, sql, json, auth, rpc, fail, fingerprint, receive, stock, facts, money, setup, initialize};
}
