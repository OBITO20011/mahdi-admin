import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {GoldenDayLedger, ReconciliationMismatch, decimalMicro, equalFact, roundedMinor} from './package-e-reconciliation.mjs';

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');
const projectId = 'nawasrah-package-e-golden-test';
const container = `supabase_db_${projectId}`;
const cli = path.join(root, 'node_modules/supabase/dist/supabase.js');
const id = suffix => `92600000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
const owner = id(1), branch = id(200), warehouse = id(201);
const a = id(101), b = id(102), c = id(103), family = id(100);
const cancelProduct=id(104);
const q = value => value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const j = value => `${q(JSON.stringify(value))}::jsonb`;
const today = "(NOW() AT TIME ZONE 'Asia/Amman')::date";
const ledger = new GoldenDayLedger(200000);
const milestones = [];
let workdir, shiftId, stage = 'fresh bootstrap', mismatchDetails;

const sql = text => new Promise((resolve, reject) => {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], {cwd: root, windowsHide: true, stdio: ['pipe','pipe','pipe']});
  let out = '', err = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', s => {out += s;}); child.stderr.on('data', s => {err += s;});
  child.on('error', reject); child.on('close', code => code === 0 ? resolve(out.trim()) : reject(Error(`${stage}: SQL exit${code}: ${err}`)));
  child.stdin.end(`SET statement_timeout='60s';SET lock_timeout='30s';\n${text}`);
});
const json = async text => JSON.parse((await sql(text)).split(/\r?\n/u).filter(Boolean).at(-1));
const asOwner = text => `BEGIN; SELECT set_config('request.jwt.claims',
  ${q(JSON.stringify({sub: owner, role: 'authenticated', aal: 'aal2'}))},true);
  SET LOCAL ROLE authenticated; ${text} COMMIT;`;
const asGateway = text => `BEGIN; SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
  SET LOCAL ROLE service_role; ${text} COMMIT;`;
const ownerRpc = text => json(asOwner(`SELECT public.${text};`));
const gatewayRpc = text => json(asGateway(`SELECT public.${text};`));
const check = (field, expected, actual) => equalFact(field, expected, actual, stage);
const report = () => ownerRpc(`get_operational_business_report(${q(branch)},${today},${today})`);
const supplierDue=()=>[...ledger.suppliers.values()].reduce((sum,value)=>sum+Math.max(value,0),0);
const supplierAdvances=()=>[...ledger.suppliers.values()].reduce((sum,value)=>sum+Math.max(-value,0),0);
const purchaseLine = (productId, quantity, cost, poItemId = null) => ({client_line_id: randomUUID(),
  purchase_order_item_id: poItemId, line_kind: 'base_unit', commercial_quantity: quantity,
  base_unit_name: 'باكيت', gross_amount_in_minor_units: quantity * cost, line_discount_in_minor_units: 0,
  components: [{product_id: productId, base_quantity: quantity}]});

async function monitor() {
  await json('SELECT public.run_advanced_monitoring_checks(NOW());');
  const checks = await json("SELECT jsonb_agg(jsonb_build_object('key',check_key,'status',status,'issues',issue_count,'details',details) ORDER BY check_key) FROM advanced_monitoring_checks WHERE check_key LIKE 'integrity:%';");
  const source = await readFile(path.join(root, 'supabase/migrations/130_phase5_review_followup_shift_refund_guards.sql'), 'utf8');
  const expectedKeys = [...new Set([...source.matchAll(/_set_advanced_monitoring_check\('([^']*integrity:[^']+)'/gu)].map(match => match[1]))].sort();
  assert.equal(expectedKeys.length, 13, 'Migration130 defines thirteen integrity checks; none may disappear');
  assert.deepEqual(checks.map(item => item.key), expectedKeys, 'Missing integrity check is not a healthy result');
  for (const item of checks) {
    if (item.issues && item.key === 'integrity:accounting:supplier-balances') {
      mismatchDetails = {check:item, supplierExpectations:Object.fromEntries(ledger.suppliers),
        rows:await json(`WITH monitored_dues AS (
          SELECT supplier_id,SUM(amount_due_in_minor_units)::bigint due FROM supplier_receipts
          WHERE status='completed' GROUP BY supplier_id
        ) SELECT jsonb_agg(jsonb_build_object('supplier',s.id,'balance',s.current_balance_in_minor_units,
          'monitoringReaderDue',COALESCE(d.due,0),'purchaseOrderCount',
          (SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id=s.id),
          'purchaseReceiptCount',(SELECT COUNT(*) FROM purchase_receipts pr JOIN purchase_orders po
            ON po.id=pr.purchase_order_id WHERE po.supplier_id=s.id),
          'activePayments',(SELECT COALESCE(SUM(p.amount_in_minor_units),0) FROM supplier_payments p
            WHERE p.supplier_id=s.id AND NOT p.is_reversed)) ORDER BY s.id)
          FROM suppliers s LEFT JOIN monitored_dues d ON d.supplier_id=s.id
          WHERE s.current_balance_in_minor_units<>COALESCE(d.due,0);`)};
    }
    check(`monitoring.${item.key}.issue_count`, 0, item.issues);
    check(`monitoring.${item.key}.status`, 'healthy', item.status);
  }
  return checks.length;
}

async function verifyFinancial(label, withMonitoring = true) {
  stage = label;
  const actual = await report();
  for (const [key, value] of Object.entries(ledger.sales)) check(`operational.sales.${key}`, value, actual.sales[key]);
  for (const [key, value] of Object.entries(ledger.flows)) check(`operational.cashFlow.${key}`, value, actual.cashFlow[key]);
  check('operational.expenses.cash', ledger.cashExpense, actual.expenses.cashInMinorUnits);
  check('operational.expenses.cliq', ledger.cliqExpense, actual.expenses.cliqInMinorUnits);
  check('operational.expenses.total', ledger.cashExpense + ledger.cliqExpense, actual.expenses.totalInMinorUnits);
  check('operational.customerDue', ledger.sales.outstandingInMinorUnits, actual.balances.customerDueInMinorUnits);
  check('operational.supplierDue',supplierDue(),actual.balances.supplierDueInMinorUnits);
  check('operational.supplierAdvances',supplierAdvances(),actual.balances.supplierAdvancesInMinorUnits);
  const summary = await ownerRpc(`get_cash_shift_summary(${q(shiftId)})`);
  check('shift.summary.expectedCash', ledger.drawer, summary.expectedCashInMinorUnits);
  check('shift.summary.cashInflows', ledger.cash, summary.cashSalesInMinorUnits + summary.cashReceiptsInMinorUnits);
  check('shift.summary.cliqInflows', ledger.cliq, summary.cliqSalesInMinorUnits + summary.cliqReceiptsInMinorUnits);
  check('shift.summary.cashRefunds', ledger.cashRefund, summary.cashRefundsInMinorUnits);
  check('shift.summary.cliqRefunds', ledger.cliqRefund, summary.cliqRefundsInMinorUnits);
  check('shift.summary.cashExpenses', ledger.cashExpense, summary.cashExpensesInMinorUnits);
  check('shift.summary.cashSupplierPayments', ledger.cashSupplier, summary.cashSupplierPaymentsInMinorUnits);
  const due = new Map();
  for (const [orderId, order] of ledger.orders) {
    const canonical = await json(`SELECT to_jsonb(outstanding_total_in_minor_units) FROM phase42_order_financial_position_internal(${q(orderId)});`);
    check(`order.${orderId}.canonicalDue`, ledger.due(order), canonical);
    due.set(order.customerId, (due.get(order.customerId) ?? 0) + ledger.due(order));
  }
  for (const [customerId, value] of due) {
    // Read the operational due view instead of assuming a denormalized customer column.
    const actualDue = await json(`SELECT COALESCE(SUM(p.outstanding_total_in_minor_units),0)::bigint
      FROM orders o CROSS JOIN LATERAL phase42_order_financial_position_internal(o.id) p
      WHERE o.customer_id=${q(customerId)} AND o.status IN('completed','returned');`);
    check(`customer.${customerId}.due`, value, actualDue);
  }
  const integrityChecks = withMonitoring ? await monitor() : null;
  milestones.push({stage, drawer: ledger.drawer, netSales: ledger.sales.netSalesInMinorUnits,
    due: ledger.sales.outstandingInMinorUnits, integrityChecks});
}

async function directReceive(supplier, lines, paid = 0) {
  const result = await ownerRpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(supplier)},
    p_warehouse_id:=${q(warehouse)},p_branch_id:=${q(branch)},p_supplier_invoice_number:=${q(`E-${randomUUID()}`)},
    p_amount_paid_at_receipt_in_minor_units:=${paid},p_payment_method:=${q(paid ? 'cash' : 'deferred')},
    p_idempotency_key:=${q(`e-direct-${randomUUID()}`)},p_lines:=${j(lines.map(row => purchaseLine(row.id,row.quantity,row.cost)))})`);
  assert.equal(result.success, true);
  for (const line of lines) ledger.acquire(line.id, line.quantity, BigInt(line.cost * line.quantity) * 1000000n,
    {operationId:result.operation_id,referenceType:'supplier_receipt',referenceId:result.receipt_id});
  ledger.suppliers.set(supplier, (ledger.suppliers.get(supplier) ?? 0) + lines.reduce((sum,row) => sum + row.cost * row.quantity,0) - paid);
  ledger.cashSupplier += paid;
  return result;
}

async function pos(format, method, configuration) {
  const customerId = method === 'debt' ? id(401) : id(402);
  const stock = format === 'base' ? [{id:a,quantity:4}] : format === 'carton' ? [{id:c,quantity:10}] : [{id:a,quantity:2},{id:b,quantity:3}];
  const total = format === 'base' ? 4000 : format === 'carton' ? 9000 : 5000;
  const line = format === 'base' ? {commercial_line_kind:'base_unit',product_id:a,base_quantity:4} :
    format === 'carton' ? {commercial_line_kind:'legacy_single_sku_parcel',product_id:c,parcel_quantity:2,units_per_parcel:5} :
      {commercial_line_kind:'configurable_parcel',family_product_id:family,
        parcel_configuration_id:configuration.id,configuration_revision:configuration.configuration_revision,
        parcel_instances:[{components:[{product_id:a,base_quantity:2},{product_id:b,base_quantity:3}]}]};
  const request = {...line,price_authority:'server_catalog',line_discount_in_minor_units:0};
  const result = await ownerRpc(`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(customerId)},'يوم كامل',
    ${q(method)},${j([request])},0,${method === 'debt' ? 0 : total},${q(`e-pos-${randomUUID()}`)})`);
  check(`pos.${format}.${method}.success`, true, result.success);
  check(`pos.${format}.${method}.total`, total, result.totalInMinorUnits);
  const originalCosts = new Map(stock.map(row => [row.id,ledger.stock(row.id).costMicro]));
  const cogs = stock.reduce((sum,row) => sum + roundedMinor(ledger.consume(row.id,row.quantity,
    {operationId:result.operationId,referenceType:'pos_sale',referenceId:result.orderId})),0);
  ledger.addOrder(result.orderId, {customerId,total,cogs,method,paid:method === 'debt' ? 0 : total});
  const data = await json(`SELECT jsonb_build_object('item',i.id,'parcel',p.id,'components',
    (SELECT jsonb_agg(jsonb_build_object('id',x.id,'product',x.product_id,'quantity',x.base_quantity) ORDER BY x.id)
      FROM order_parcel_components x WHERE x.parcel_instance_id=p.id))
    FROM order_items i LEFT JOIN order_parcel_instances p ON p.order_item_id=i.id WHERE i.order_id=${q(result.orderId)};`);
  return {...data,orderId:result.orderId,originalCosts};
}

async function customerOrder({phone, quantity, product, promotion = null, discount = 0, method, paid}) {
  const subtotal = quantity * 1000, total = subtotal - discount + 1000;
  const submitted = await gatewayRpc(`submit_guest_customer_order_v2(${q(randomUUID())},repeat('c',64),${q(createHash('sha256').update(phone).digest('hex'))},
    'عميل يوم كامل',${q(phone)},'إربد','الرمثا','حي الاختبار','شارع الاختبار',NULL,NULL,NULL,NULL,NULL,NULL,
    ${j([{commercial_line_kind:'base_unit',product_id:product,base_quantity:quantity,expected_unit_price_in_minor_units:1000}])},
    ${q(promotion)},${q(method === 'cash' ? 'cash_on_delivery' : 'cliq')},'inside_ramtha',${subtotal},${discount},1000,${total})`);
  assert.ok(submitted.order_id);
  await ownerRpc(`accept_order_for_preparation(${q(submitted.order_id)},'يوم كامل')`);
  await ownerRpc(`update_order_status(${q(submitted.order_id)},'ready','يوم كامل')`);
  const originalCosts = new Map([[product,ledger.stock(product).costMicro]]);
  const completed = await ownerRpc(`complete_website_order_with_settlement_v2(${q(submitted.order_id)},${q(randomUUID())},
    ${q(method)},${paid},1000,${q(method === 'cliq' ? 'E-CLIQ-CUSTOMER' : null)},'يوم كامل')`);
  check('customer.completion.success',true,completed.success);
  const data = await json(`SELECT jsonb_build_object('item',i.id,'customer',o.customer_id,'discount',o.discount_in_minor_units,
    'total',o.total_in_minor_units,'branch',o.branch_id,'warehouse',o.warehouse_id,'creationOperation',o.operation_id) FROM orders o JOIN order_items i ON i.order_id=o.id
    WHERE o.id=${q(submitted.order_id)};`);
  check('customer.total',total,data.total);check('customer.discount',discount,data.discount);
  check('customer.branch',branch,data.branch);check('customer.warehouse',warehouse,data.warehouse);
  const cogs = roundedMinor(ledger.consume(product,quantity,
    {operationId:data.creationOperation,referenceType:'customer_order',referenceId:submitted.order_id}));
  ledger.addOrder(submitted.order_id,{customerId:data.customer,total,delivery:1000,cogs,method,paid});
  return {...data,orderId:submitted.order_id,originalCosts};
}

async function settleReturn(fixture, {quantity, product, entitlement, sellable = quantity, damage = 0,
  method = 'cash', replacementId = null, unitCost = fixture.originalCosts.get(product), parcel = false}) {
  const physical = [];
  let items;
  if (parcel) {
    items = [{return_scope:'parcel_instance',order_item_id:fixture.item,parcel_instance_id:fixture.parcel,
      components:fixture.components.map(component => ({parcel_component_id:component.id,
        accepted_quantity:component.quantity - (component.product === a ? 1 : 0),
        rejected_quantity:component.product === a ? 1 : 0,
        accepted_condition:'sellable',accepted_stock_disposition:'restock',
        rejection_reason:component.product === a ? 'customer_damage' : null,
        rejected_stock_disposition:component.product === a ? 'returned_to_customer' : null}))}];
    for (const component of fixture.components) physical.push({root_source_kind:'parcel_component',root_source_id:component.id,
      source_kind:'parcel_component',source_id:component.id,product_id:component.product,quantity:component.quantity,
      sellable_restock_quantity:component.quantity - (component.product === a ? 1 : 0),defect_non_sellable_quantity:0,
      customer_damage_quantity:component.product === a ? 1 : 0});
  } else {
    items = [{return_scope:'base_unit',order_item_id:fixture.item,quantity,stock_disposition:sellable ? 'restock' : 'damaged',
      ...(damage ? {customer_damage_quantity:damage} : {})}];
    physical.push({root_source_kind:'base_order_item',root_source_id:fixture.item,
      source_kind:replacementId ? 'replacement_item' : 'base_order_item',source_id:replacementId ?? fixture.item,
      product_id:product,quantity,sellable_restock_quantity:sellable,
      defect_non_sellable_quantity:quantity - sellable - damage,customer_damage_quantity:damage});
  }
  const financial = ledger.returnFinancial(fixture.orderId,entitlement,method);
  const key = `e-return-${randomUUID()}`;
  const command = `settle_admin_sales_return_v1(${q(fixture.orderId)},${q(key)},${j(items)},${j(physical)},
    'يوم كامل',${q(financial.refund ? method : null)},${q(financial.refund && method === 'cliq' ? 'E-RETURN-CLIQ' : null)},NULL)`;
  const result = await ownerRpc(command);
  check('return.success',true,result.success);
  check('return.entitlement',entitlement,result.merchandiseEntitlementInMinorUnits);
  check('return.debtReduction',financial.debt,result.debtReductionInMinorUnits);
  check('return.refund',financial.refund,result.moneyRefundInMinorUnits);
  check('return.deliveryRefund',0,result.deliveryRefundInMinorUnits);
  for (const source of physical) if (source.sellable_restock_quantity) {
    const cost = parcel ? fixture.originalCosts.get(source.product_id) : unitCost;
    const value = cost * BigInt(source.sellable_restock_quantity);
    ledger.acquire(source.product_id,source.sellable_restock_quantity,value,
      {operationId:null,referenceType:'phase4_sales_return',referenceId:result.returnId});
    ledger.restockRecoveryMicro += value;
  }
  return {command,result};
}

async function fingerprint() {
  // Content, identities and cardinality are covered, including financial and
  // cost projections. Monitoring refresh rows are deliberately excluded.
  const tables = ['orders','order_items','order_parcel_instances','order_parcel_components','business_operations',
    'inventory_balances','inventory_movements','products','customers','suppliers','customer_payments','supplier_payments',
    'cash_shifts','operational_expenses','sales_return_events','sales_return_items','sales_replacement_events',
    'sales_replacement_items','sales_aftercare_consumptions','phase42_return_settlement_evidence',
    'phase42_return_inventory_effects','phase43_replacement_settlement_evidence','phase43_replacement_inventory_effects'];
  return json(`SELECT jsonb_build_object(${tables.map(table => `${q(table)},
    (SELECT md5(COALESCE(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text),'')) FROM public.${table} t)`).join(',')});`);
}

try {
  const {stdout} = await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],
    {cwd:root,windowsHide:true,timeout:600000,maxBuffer:8*1024*1024,env:{...process.env,
      NAWASRAH_ISOLATED_PROJECT_ID:projectId,NAWASRAH_MAX_MIGRATION:'133',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
      NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
  const built = JSON.parse(stdout);assert.equal(built.ok,true);workdir = built.isolatedProjectRoot;
  const migration = await readFile(path.join(workdir,'supabase/migrations/132_package_d_system_unification.sql'),'utf8');
  const hash = createHash('sha256').update(migration.replace(/\r\n?/gu,'\n')).digest('hex').toUpperCase();
  const state = JSON.parse(await readFile(path.join(root,'docs/agent/project-state.json'),'utf8'));
  assert.equal(hash,state.migration132CanonicalLfSha256,'Golden day must exercise the actual approved132');
  const supplierMigration=await readFile(path.join(workdir,'supabase/migrations/133_package_e_supplier_po_financial_consistency.sql'),'utf8');
  const supplierHash=createHash('sha256').update(supplierMigration.replace(/\r\n?/gu,'\n')).digest('hex').toUpperCase();
  assert.equal(supplierHash,state.migration133CanonicalLfSha256,'Golden day must exercise the actual approved133');
  stage = 'catalog setup';
  await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
  await sql(`INSERT INTO suppliers(id,company_name,is_active) VALUES
    (${q(id(303))},'مورد مقدّم دون استلام',true),(${q(id(304))},'مورد سند للإلغاء',true);
    INSERT INTO products(id,sku,name_ar,category_id,unit_id,purchase_unit_id,sale_unit_id,
      units_per_purchase_unit,units_per_sale_unit,default_purchase_price_in_minor_units,default_sale_price_in_minor_units,
      cost_price_in_minor_units,sale_price_in_minor_units,wholesale_price_in_minor_units,min_stock_level,is_active,is_flavor_master,wac_cost_in_minor_units_exact)
    SELECT ${q(cancelProduct)},'E-CANCEL','صنف إلغاء مستقل',category_id,unit_id,purchase_unit_id,sale_unit_id,
      1,1,0,1000,0,1000,1000,0,true,false,0 FROM products WHERE id=${q(c)};`);
  const opened = await ownerRpc(`open_cash_shift(${q(branch)},${ledger.openingCash})`);
  shiftId = opened.id;assert.ok(shiftId);
  const configured = await ownerRpc(`save_product_parcel_configuration_v1(${q(family)},'configurable_mix',true,5,ARRAY[${q(a)},${q(b)}]::uuid[])`);
  await ownerRpc("set_configurable_parcel_feature_state_v1('ENABLED')");
  await ownerRpc("upsert_promotion_code('E_GOLDEN','fixed',1000)");
  stage = 'direct receiving';
  await directReceive(id(301),[{id:a,quantity:100,cost:200},{id:b,quantity:100,cost:300},{id:c,quantity:100,cost:500}],10000);
  stage = 'PO receiving';
  const poLine = purchaseLine(a,100,600);
  const po = await ownerRpc(`create_purchase_order_v2(p_supplier_id:=${q(id(302))},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},
    p_idempotency_key:=${q(`e-po-${randomUUID()}`)},p_lines:=${j([poLine])})`);
  await ownerRpc(`update_purchase_order_status(${q(po.purchase_order_id)},'sent')`);
  await ownerRpc(`update_purchase_order_status(${q(po.purchase_order_id)},'approved')`);
  await ownerRpc(`record_supplier_payment(p_supplier_id:=${q(id(302))},p_purchase_order_id:=${q(po.purchase_order_id)},
    p_amount_in_minor_units:=20000,p_payment_method:='cash',p_idempotency_key:=${q(`e-advance-${randomUUID()}`)})`);
  ledger.suppliers.set(id(302),-20000);ledger.cashSupplier+=20000;
  await verifyFinancial('supplier advance BEFORE receipt');
  const poItem = await json(`SELECT to_jsonb(id) FROM purchase_order_items WHERE purchase_order_id=${q(po.purchase_order_id)};`);
  const received = await ownerRpc(`receive_purchase_order_v2(p_purchase_order_id:=${q(po.purchase_order_id)},p_warehouse_id:=${q(warehouse)},
    p_idempotency_key:=${q(`e-po-receive-${randomUUID()}`)},p_payment_method:='deferred',
    p_lines:=${j([purchaseLine(a,100,600,poItem)])})`);
  check('po.received',true,received.success);
  ledger.acquire(a,100,60000n * 1000000n,{operationId:received.operation_id,referenceType:'purchase_receipt',referenceId:received.receipt_id});
  ledger.suppliers.set(id(302),40000);
  await ownerRpc(`record_supplier_payment(p_supplier_id:=${q(id(302))},p_purchase_order_id:=${q(po.purchase_order_id)},
    p_amount_in_minor_units:=5000,p_payment_method:='cash',p_idempotency_key:=${q(`e-supplier-${randomUUID()}`)})`);
  ledger.suppliers.set(id(302),35000);ledger.cashSupplier += 5000;
  stage='supplier with retained advance and no receipt';
  const advancePo=await ownerRpc(`create_purchase_order_v2(p_supplier_id:=${q(id(303))},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},
    p_idempotency_key:=${q(randomUUID())},p_lines:=${j([purchaseLine(b,50,600)])})`);
  await ownerRpc(`update_purchase_order_status(${q(advancePo.purchase_order_id)},'sent')`);
  await ownerRpc(`update_purchase_order_status(${q(advancePo.purchase_order_id)},'approved')`);
  await ownerRpc(`record_supplier_payment(p_supplier_id:=${q(id(303))},p_purchase_order_id:=${q(advancePo.purchase_order_id)},
    p_amount_in_minor_units:=10000,p_payment_method:='cash',p_idempotency_key:=${q(randomUUID())})`);
  ledger.suppliers.set(id(303),-10000);ledger.cashSupplier+=10000;
  stage='partially paid direct receipt cancellation';
  const cancelled=await directReceive(id(304),[{id:cancelProduct,quantity:10,cost:200}],500);
  await verifyFinancial('partially paid receipt BEFORE cancellation');
  const cancellationCommand=`cancel_supplier_receipt(${q(cancelled.receipt_id)},'إلغاء سند مدفوع جزئياً')`;
  const cancellation=await ownerRpc(cancellationCommand);
  check('cancel.success',true,cancellation.success);
  check('cancel.onlyActiveOwnedPayments',500,cancellation.payments_marked_reversed_in_minor_units);
  ledger.consume(cancelProduct,10,{operationId:cancellation.reversal_operation_id,
    referenceType:'supplier_receipt_cancellation',referenceId:cancelled.receipt_id});
  ledger.stock(cancelProduct).costMicro=0n; // independent opening quantity/cost were zero.
  ledger.suppliers.set(id(304),0);ledger.cashSupplier-=500;
  const cancelFingerprint=await fingerprint();
  assert.deepEqual(await ownerRpc(cancellationCommand),cancellation);
  assert.deepEqual(await fingerprint(),cancelFingerprint,'Cancellation replay must be zero-write');
  await verifyFinancial('receiving and supplier payment');

  const sales = {};
  for (const method of ['cash','cliq','debt']) for (const format of ['base','carton','mix']) {
    stage = `POS ${format}/${method}`;sales[`${format}-${method}`] = await pos(format,method,configured.configuration);
  }
  await verifyFinancial('nine POS V2 sales');
  stage = 'coupon Customer V2';
  const couponSale = await customerOrder({phone:'0796600403',quantity:10,product:a,promotion:'E_GOLDEN',discount:1000,method:'cliq',paid:6000});
  stage = 'Cash Customer V2';
  await customerOrder({phone:'0796600402',quantity:2,product:b,method:'cash',paid:3000});
  await verifyFinancial('Customer V2 coupon and completion');

  stage = 'cash receipt';
  const debtSale = sales['base-debt'];
  const receipt = await ownerRpc(`record_customer_order_payment_once(${q(debtSale.orderId)},2000,'cash',NULL,'يوم كامل',${q(`e-payment-${randomUUID()}`)})`);
  ledger.payment(debtSale.orderId,'cash',2000);
  await verifyFinancial('receipt before reversal');
  stage = 'receipt reversal';
  await ownerRpc(`reverse_customer_order_payment(${q(receipt.payment_id)},'عكس قبض يوم الاختبار')`);
  ledger.reversePayment(debtSale.orderId,'cash',2000);
  await verifyFinancial('receipt reversal on debt');
  stage = 'retained receipt';
  await ownerRpc(`record_customer_order_payment_once(${q(debtSale.orderId)},3000,'cash',NULL,'يوم كامل',${q(`e-payment-${randomUUID()}`)})`);
  ledger.payment(debtSale.orderId,'cash',3000);

  stage = 'expense';
  await ownerRpc(`create_operational_expense(${q(branch)},'تشغيل','مصروف يوم كامل',700,'cash',NULL)`);
  ledger.cashExpense += 700;
  const reversedExpense = await ownerRpc(`create_operational_expense(${q(branch)},'تشغيل','مصروف للعكس',200,'cash',NULL)`);
  ledger.cashExpense += 200;
  await verifyFinancial('expenses before reversal');
  stage = 'expense reversal';
  await ownerRpc(`reverse_operational_expense(${q(reversedExpense.expenseId)},'عكس مصروف يوم الاختبار')`);
  ledger.cashExpense -= 200;
  await verifyFinancial('expense reversal');

  stage = 'sellable return';
  await settleReturn(sales['base-cash'],{quantity:1,product:a,entitlement:1000});
  stage = 'carton defect cross-tender refund';
  await settleReturn(sales['carton-cliq'],{quantity:5,product:c,entitlement:4500,sellable:0});
  stage = 'mixed parcel customer damage';
  await settleReturn(sales['mix-cash'],{parcel:true,entitlement:4000});
  stage = 'coupon return debt first, delivery preserved';
  await settleReturn(couponSale,{quantity:5,product:a,entitlement:4500});
  await verifyFinancial('sellable/defect/damage and debt-first returns');

  stage = 'new acquisition before replacement';
  await directReceive(id(301),[{id:a,quantity:40,cost:800}]);
  const replacementCost = ledger.stock(a).costMicro;
  const replacementSale = sales['base-cliq'];
  stage = 'operational replacement';
  const replacement = await ownerRpc(`settle_sales_replacement_v1(${q(replacementSale.orderId)},${q(`e-replace-${randomUUID()}`)},
    ${j([{sourceKind:'base_order_item',sourceId:replacementSale.item,quantity:1}])},'يوم كامل',NULL)`);
  check('replacement.success',true,replacement.success);
  const replacementItem = await json(`SELECT to_jsonb(id) FROM sales_replacement_items WHERE operation_id=${q(replacement.operationId)};`);
  ledger.replacementCost += roundedMinor(ledger.consume(a,1,
    {operationId:replacement.operationId,referenceType:'phase4_replacement_item',referenceId:replacementItem}));
  stage = 'current physical replacement return';
  const replay = await settleReturn(replacementSale,{quantity:1,product:a,entitlement:1000,method:'cliq',replacementId:replacementItem,unitCost:replacementCost});
  await verifyFinancial('replacement cost and current-leaf return');
  stage = 'committed replay zero write';
  const before = await fingerprint();
  const repeated = await ownerRpc(replay.command);
  check('replay.success',true,repeated.success);
  check('replay.operationId',replay.result.operationId,repeated.operationId);
  assert.deepEqual(await fingerprint(),before,'Committed Return replay must preserve every durable field');

  stage = 'inventory and supplier reconciliation';
  for (const [product, expected] of ledger.inventory) {
    const current = await json(`SELECT jsonb_build_object('quantity',balance.on_hand_quantity,'reserved',balance.reserved_quantity,
      'wac',p.wac_cost_in_minor_units_exact::text) FROM inventory_balances balance JOIN products p ON p.id=balance.product_id
      WHERE balance.warehouse_id=${q(warehouse)} AND balance.product_id=${q(product)};`);
    check(`inventory.${product}.quantity`,expected.quantity,current.quantity);
    check(`inventory.${product}.reserved`,0,current.reserved);
    check(`inventory.${product}.wac`,product===cancelProduct?null:decimalMicro(expected.costMicro),current.wac);
    const actualMoves = await json(`SELECT jsonb_agg(jsonb_build_object('quantity',quantity,'before',balance_before,'after',balance_after,
      'operationId',operation_id,'referenceType',reference_type,'referenceId',reference_id)
      ORDER BY mutation_sequence) FROM inventory_movements WHERE warehouse_id=${q(warehouse)} AND product_id=${q(product)};`);
    assert.deepEqual(actualMoves,ledger.movements.filter(move => move.id === product).map(
      ({quantity,before,after,operationId,referenceType,referenceId}) => ({quantity,before,after,operationId,referenceType,referenceId})),
      `Inventory per-identity chronological movements ${product}`);
  }
  for (const [supplier, expected] of ledger.suppliers) {
    check(`supplier.${supplier}.due`,expected,await json(`SELECT to_jsonb(current_balance_in_minor_units) FROM suppliers WHERE id=${q(supplier)};`));
  }
  const finalReport = await report();
  const inventoryValueMicro=[...ledger.inventory.values()].reduce((sum,value)=>sum+value.costMicro*BigInt(value.quantity),0n);
  assert.equal(inventoryValueMicro,ledger.movements.reduce((sum,move)=>sum+move.valueMicro,0n)+ledger.inventoryRoundingMicro,
    'Quantity/value ledger reconciliation includes the exact canonical six-decimal WAC rounding residual');
  check('operational.inventory.valueInMinorUnits',roundedMinor(inventoryValueMicro),finalReport.inventory.valueInMinorUnits);
  check('report.supplierDue',supplierDue(),finalReport.balances.supplierDueInMinorUnits);
  check('report.supplierAdvances',supplierAdvances(),finalReport.balances.supplierAdvancesInMinorUnits);
  const daily = await gatewayRpc(`build_business_summary('daily',${today},${today},NOW())`);
  for (const [key,value] of Object.entries(ledger.sales)) check(`daily.sales.${key}`,value,daily.sales[key]);
  for (const [key,value] of Object.entries(ledger.flows)) check(`daily.cashFlow.${key}`,value,daily.cashFlow[key]);
  check('daily.supplierDue',supplierDue(),daily.balances.supplierDueInMinorUnits);
  check('daily.supplierAdvances',supplierAdvances(),daily.balances.supplierAdvancesInMinorUnits);
  const home = await ownerRpc('get_home_dashboard()');
  check('home.financialFactsStatus','available',home.financialFactsStatus);
  check('home.todayGross',ledger.sales.grossSalesInMinorUnits,home.summary.todaySalesInMinorUnits);
  check('home.todayNet',ledger.sales.netSalesInMinorUnits,home.summary.todayNetSalesInMinorUnits);
  check('home.monthNet',ledger.sales.netSalesInMinorUnits,home.summary.monthNetSalesInMinorUnits);
  check('home.monthProfit',ledger.sales.netProfitInMinorUnits,home.summary.monthProfitInMinorUnits);
  check('home.customerDue',ledger.sales.outstandingInMinorUnits,home.summary.customerReceivablesInMinorUnits);
  check('home.supplierDue',supplierDue(),home.summary.supplierPayablesInMinorUnits);
  check('home.supplierAdvances',supplierAdvances(),home.summary.supplierAdvancesInMinorUnits);
  const readFingerprint = await fingerprint();
  await report();await ownerRpc('get_home_dashboard()');
  assert.deepEqual(await fingerprint(),readFingerprint,'Financial readers must not rewrite state');
  stage = 'close shift';
  await ownerRpc(`close_cash_shift(${q(shiftId)},${ledger.drawer},NULL)`);
  const closed = await ownerRpc(`get_cash_shift_closing_report(${q(shiftId)})`);
  check('closing.expectedCash',ledger.drawer,closed.reconciliation.expectedCashInMinorUnits);
  check('closing.actualCash',ledger.drawer,closed.reconciliation.actualCashInMinorUnits);
  check('closing.discrepancy',0,closed.reconciliation.cashDiscrepancyInMinorUnits);
  check('closing.cashRefunds',ledger.cashRefund,closed.outflows.cashRefundsInMinorUnits);
  check('closing.cliqRefunds',ledger.cliqRefund,closed.outflows.cliqRefundsInMinorUnits);
  check('closing.sales.grossSalesInMinorUnits',ledger.sales.grossSalesInMinorUnits,closed.sales.grossSalesInMinorUnits);
  check('closing.sales.directCollected',39000,closed.sales.collectedDirectSalesInMinorUnits);
  check('closing.sales.initialCash',0,closed.sales.initialReceiptCashInMinorUnits);
  check('closing.sales.initialCliq',6000,closed.sales.initialReceiptCliqInMinorUnits);
  check('closing.sales.creditAtCompletion',22000,closed.sales.creditSalesInMinorUnits);
  check('closing.collections.includedInitialPayments',6000,closed.collections.initialPaymentsInMinorUnits);
  check('closing.reconciliation.totalInflows',ledger.cash+ledger.cliq,closed.reconciliation.totalInflowsInMinorUnits);
  check('closing.sales.refundsInMinorUnits',ledger.sales.refundsInMinorUnits,closed.sales.refundsInMinorUnits);
  check('closing.sales.returnEntitlementInMinorUnits',ledger.sales.returnEntitlementInMinorUnits,closed.sales.returnEntitlementInMinorUnits);
  check('closing.sales.debtReductionInMinorUnits',ledger.sales.debtReductionInMinorUnits,closed.sales.debtReductionInMinorUnits);
  check('closing.sales.netSalesInMinorUnits',ledger.sales.netSalesInMinorUnits,closed.sales.netSalesInMinorUnits);
  assert.deepEqual(await ownerRpc(`get_cash_shift_closing_report(${q(shiftId)})`),closed,'Closed report is immutable');
  await verifyFinancial('closed shift, final reports and integrity');
  console.log(JSON.stringify({ok:true,freshRebuild:'001-133',migration132:hash,migration133:supplierHash,stage,
    goldenDay:{sales:ledger.sales,cashFlow:ledger.flows,drawer:ledger.drawer,
      suppliers:{due:supplierDue(),advances:supplierAdvances(),balances:Object.fromEntries(ledger.suppliers)},inventory:Object.fromEntries(
      [...ledger.inventory].map(([key,value]) => [key,{quantity:value.quantity,wac:key===cancelProduct?null:decimalMicro(value.costMicro),
        valueMicro:(value.costMicro*BigInt(value.quantity)).toString()}]))},
    milestones,publicRpc:true,committedReplayZeroWrite:true,readerZeroWrite:true,productionAccess:0},null,2));
} catch (error) {
  console.error(JSON.stringify({ok:false,stage,kind:error instanceof ReconciliationMismatch ? 'REAL_NUMERIC_MISMATCH' : 'RUNTIME_FAILURE',
    evidence:error.evidence ?? null,details:mismatchDetails ?? null,message:error.message,milestones},null,2));
  process.exitCode = 1;
} finally {
  if (workdir) await exec(process.execPath,[cli,'stop','--no-backup','--workdir',workdir],
    {cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});
}
