import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {assertPackageDDbLint} from './package-d-db-lint-policy.mjs';

const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..');
const projectId='nawasrah-package-e-closing-test',container=`supabase_db_${projectId}`;
const cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const id=suffix=>`92600000-0000-4000-8000-${String(suffix).padStart(12,'0')}`;
const owner=id(1),branch=id(200),warehouse=id(201),product=id(101);
const q=value=>value===null?'NULL':`'${String(value).replaceAll("'","''")}'`;
const j=value=>`${q(JSON.stringify(value))}::jsonb`;
let workdir,stage='bootstrap';
const sql=text=>new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1'],
    {cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',value=>{out+=value;});child.stderr.on('data',value=>{err+=value;});
  child.on('error',reject);child.on('close',code=>code===0?resolve(out.trim()):reject(Error(`${stage}: ${err}`)));
  child.stdin.end(`SET statement_timeout='60s';SET lock_timeout='30s';\n${text}`);
});
const json=async text=>JSON.parse((await sql(text)).split(/\r?\n/u).filter(Boolean).at(-1));
const ownerRpc=text=>json(`BEGIN;SELECT set_config('request.jwt.claims',${q(JSON.stringify({sub:owner,role:'authenticated',aal:'aal2'}))},true);
  SET LOCAL ROLE authenticated;SELECT public.${text};COMMIT;`);
const gatewayRpc=text=>json(`BEGIN;SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
  SET LOCAL ROLE service_role;SELECT public.${text};COMMIT;`);
const sale=quantity=>[{commercial_line_kind:'base_unit',product_id:product,base_quantity:quantity,
  price_authority:'server_catalog',line_discount_in_minor_units:0}];
const pos=(quantity,method)=>ownerRpc(`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(id(401))},'إثبات الإغلاق',
  ${q(method)},${j(sale(quantity))},0,${method==='debt'?0:quantity*1000},${q(randomUUID())})`);
const fingerprint=()=>json(`SELECT jsonb_build_object(${['orders','customer_payments','cash_shifts','business_operations',
  'sales_return_events','sales_return_items','phase42_return_settlement_evidence','phase42_return_inventory_effects',
  'inventory_balances','inventory_movements','products','audit_logs']
  .map(table=>`${q(table)},(SELECT md5(COALESCE(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text),'')) FROM public.${table} t)`).join(',')});`);
const moneyState=report=>({shift:report.shift,reconciliation:report.reconciliation,
  collections:{count:report.collections.count,cashInMinorUnits:report.collections.cashInMinorUnits,cliqInMinorUnits:report.collections.cliqInMinorUnits},
  outflows:report.outflows});

async function returnUnits(orderId,quantity,entitlement,debt,refund){
  const item=await json(`SELECT to_jsonb(id) FROM order_items WHERE order_id=${q(orderId)};`);
  const physical=[{root_source_kind:'base_order_item',root_source_id:item,source_kind:'base_order_item',source_id:item,
    product_id:product,quantity,sellable_restock_quantity:quantity,defect_non_sellable_quantity:0,customer_damage_quantity:0}];
  const result=await ownerRpc(`settle_admin_sales_return_v1(${q(orderId)},${q(randomUUID())},
    ${j([{return_scope:'base_unit',order_item_id:item,quantity,stock_disposition:'restock'}])},${j(physical)},
    'إثبات صافي المبيعات',${q(refund?'cash':null)},NULL,NULL)`);
  assert.equal(result.success,true);assert.equal(result.merchandiseEntitlementInMinorUnits,entitlement);
  assert.equal(result.debtReductionInMinorUnits,debt);assert.equal(result.moneyRefundInMinorUnits,refund);
  return result;
}

try{
  const {stdout}=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{
    cwd:root,windowsHide:true,timeout:600000,maxBuffer:8*1024*1024,env:{...process.env,
      NAWASRAH_ISOLATED_PROJECT_ID:projectId,NAWASRAH_MAX_MIGRATION:'132',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
      NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
  const built=JSON.parse(stdout);assert.equal(built.ok,true);workdir=built.isolatedProjectRoot;
  await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
  const historicalShift=(await ownerRpc(`open_cash_shift(${q(branch)},10000)`)).id;
  const line={client_line_id:randomUUID(),line_kind:'base_unit',commercial_quantity:100,base_unit_name:'باكيت',
    gross_amount_in_minor_units:20000,line_discount_in_minor_units:0,components:[{product_id:product,base_quantity:100}]};
  await ownerRpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(branch)},
    p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q(randomUUID())},p_payment_method:='deferred',p_lines:=${j([line])})`);
  await pos(1,'cash');await ownerRpc(`close_cash_shift(${q(historicalShift)},11000,NULL)`);
  const historical=await ownerRpc(`get_cash_shift_closing_report(${q(historicalShift)})`);
  const snapshotBefore=await json(`SELECT to_jsonb(md5(closing_report_snapshot::text)) FROM cash_shifts WHERE id=${q(historicalShift)};`);

  stage='before132 real completion and vouchers';
  const shift=(await ownerRpc(`open_cash_shift(${q(branch)},10000)`)).id;
  await pos(2,'cash');await pos(3,'cliq');const debt=await pos(4,'debt');
  await ownerRpc("upsert_promotion_code('E_GOLDEN','fixed',1000)");
  const order=await gatewayRpc(`submit_guest_customer_order_v2(${q(randomUUID())},repeat('c',64),
    ${q(createHash('sha256').update('closing-customer').digest('hex'))},'عميل الإغلاق','0796600403','إربد','الرمثا','حي الاختبار','شارع الاختبار',
    NULL,NULL,NULL,NULL,NULL,NULL,${j([{commercial_line_kind:'base_unit',product_id:product,base_quantity:10,expected_unit_price_in_minor_units:1000}])},
    'E_GOLDEN','cliq','inside_ramtha',10000,1000,1000,10000)`);
  await ownerRpc(`accept_order_for_preparation(${q(order.order_id)},'إثبات الإغلاق')`);
  await ownerRpc(`update_order_status(${q(order.order_id)},'ready','إثبات الإغلاق')`);
  await ownerRpc(`complete_website_order_with_settlement_v2(${q(order.order_id)},${q(randomUUID())},'cliq',6000,1000,'E-FIRST-CLIQ','إثبات الإغلاق')`);
  await ownerRpc(`record_customer_order_payment_once(${q(debt.orderId)},1000,'cash',NULL,'سند لاحق',${q(randomUUID())})`);
  const mixedReturn=await returnUnits(order.order_id,5,4500,3000,1500);
  const debtOnlyReturn=await returnUnits(debt.orderId,1,1000,1000,0);
  assert.equal(await json(`SELECT COALESCE(to_jsonb(cash_shift_id),'null'::jsonb) FROM sales_return_events WHERE id=${q(debtOnlyReturn.returnId)};`),null);
  assert.equal(await json(`SELECT to_jsonb(cash_shift_id) FROM sales_return_events WHERE id=${q(mixedReturn.returnId)};`),shift);
  const before=await ownerRpc(`get_cash_shift_closing_report(${q(shift)})`);
  assert.equal(before.sales.grossSalesInMinorUnits,5000,'Before132 omits credit and first vouchers from gross');
  assert.equal(before.sales.refundsInMinorUnits,1500);
  assert.equal(before.sales.netSalesInMinorUnits,3500,'Before132 deducts only monetary refunds, not4000 debt reduction');
  assert.equal(before.reconciliation.totalInflowsInMinorUnits,12000);
  assert.equal(before.reconciliation.expectedCashInMinorUnits,11500);
  const beforeRows=await fingerprint();
  const recalculationAuditsBefore=await json("SELECT to_jsonb(COUNT(*)::int) FROM audit_logs WHERE action='RECALCULATE_SUPPLIER_BALANCE_133';");

  stage='explicit133 activation of approved reader';
  const migration=await readFile(path.join(root,'supabase/migrations/133_package_e_supplier_po_financial_consistency.sql'),'utf8');
  const hash=createHash('sha256').update(migration.replace(/\r\n?/gu,'\n')).digest('hex').toUpperCase();
  const state=JSON.parse(await readFile(path.join(root,'docs/agent/project-state.json'),'utf8'));
  assert.equal(hash,state.migration133CanonicalLfSha256);await sql(migration);
  const afterMigrationRows=await fingerprint();
  const {audit_logs:beforeAudit,...beforeHistorical}=beforeRows;
  const {audit_logs:afterAudit,...afterHistorical}=afterMigrationRows;
  assert.deepEqual(afterHistorical,beforeHistorical,'Migration preserves historical orders/returns, inventory and monetary state');
  assert.notEqual(beforeAudit,afterAudit,'Authorized one-time balance recalculation must be audited');
  assert.equal(await json("SELECT to_jsonb(COUNT(*)::int) FROM audit_logs WHERE action='RECALCULATE_SUPPLIER_BALANCE_133';"),
    recalculationAuditsBefore+await json('SELECT to_jsonb(COUNT(*)::int) FROM suppliers;'));
  const after=await ownerRpc(`get_cash_shift_closing_report(${q(shift)})`);
  assert.equal(after.sales.grossSalesInMinorUnits,19000);
  assert.equal(after.sales.collectedDirectSalesInMinorUnits,5000);
  assert.equal(after.sales.initialReceiptPaymentsInMinorUnits,6000);
  assert.equal(after.sales.initialReceiptCashInMinorUnits,0);
  assert.equal(after.sales.initialReceiptCliqInMinorUnits,6000);
  assert.equal(after.sales.creditSalesInMinorUnits,8000,'Late1000 receipt must not reclassify sale-time credit');
  assert.equal(after.sales.refundsInMinorUnits,1500);
  assert.equal(after.sales.debtReductionInMinorUnits,4000,'Include mixed and debt-only Returns exactly once');
  assert.equal(after.sales.returnEntitlementInMinorUnits,5500);
  assert.equal(after.sales.netSalesInMinorUnits,13500,'19000 gross minus5500 entitlement, not only1500 drawer outflow');
  assert.equal(after.collections.initialPaymentsInMinorUnits,6000);
  assert.equal(after.collections.initialCliqInMinorUnits,6000);
  assert.deepEqual(moneyState(after),moneyState(before),'Cash/CliQ counters, vouchers, outflows, inflows and drawer stay EXACTLY unchanged');
  assert.deepEqual(await ownerRpc(`get_cash_shift_closing_report(${q(historicalShift)})`),historical);
  assert.equal(await json(`SELECT to_jsonb(md5(closing_report_snapshot::text)) FROM cash_shifts WHERE id=${q(historicalShift)};`),snapshotBefore);
  assert.deepEqual(await fingerprint(),afterMigrationRows,'Readers perform zero writes, including audit timestamps');
  const operational=await ownerRpc(`get_operational_business_report(${q(branch)},(NOW() AT TIME ZONE 'Asia/Amman')::date,(NOW() AT TIME ZONE 'Asia/Amman')::date)`);
  assert.equal(operational.sales.grossSalesInMinorUnits,after.sales.grossSalesInMinorUnits+1000,'Current closing sale-at-completion gross agrees with operational period, plus historical shift1000');
  assert.equal(operational.sales.returnEntitlementInMinorUnits,5500);
  assert.equal(operational.sales.debtReductionInMinorUnits,4000);
  assert.equal(operational.sales.netSalesInMinorUnits,after.sales.netSalesInMinorUnits+1000);
  const daily=await gatewayRpc(`build_business_summary('daily',(NOW() AT TIME ZONE 'Asia/Amman')::date,(NOW() AT TIME ZONE 'Asia/Amman')::date,NOW())`);
  const home=await ownerRpc('get_home_dashboard()');
  assert.equal(daily.sales.netSalesInMinorUnits,14500);assert.equal(home.summary.todayNetSalesInMinorUnits,14500);
  // Corrupt only optional presentation evidence in an isolated rollback-only
  // transaction. Cash accounting must remain authoritative and close must work.
  stage='optional detail failure must not block closing';
  const fallbackBefore=await fingerprint();
  const fallback=await json(`BEGIN;
    ALTER TABLE public.business_operations DISABLE TRIGGER USER;
    UPDATE public.business_operations SET request_identity_snapshot=jsonb_set(request_identity_snapshot,
      '{payment_method}','"cash"'::jsonb)
    WHERE operation_type='phase3_customer_completion_v1' AND request_identity_snapshot->>'order_id'=${q(order.order_id)};
    SELECT set_config('request.jwt.claims',${q(JSON.stringify({sub:owner,role:'authenticated',aal:'aal2'}))},true);
    SET LOCAL ROLE authenticated;
    SELECT public.close_cash_shift(${q(shift)},11500,NULL);
    SELECT public.get_cash_shift_closing_report(${q(shift)});ROLLBACK;`);
  assert.equal(fallback.salesDetailStatus,'unavailable');
  assert.equal(Object.hasOwn(fallback.sales,'initialReceiptPaymentsInMinorUnits'),false);
  assert.deepEqual(fallback.returnBreakdown,after.returnBreakdown,'Sales fallback preserves full131 return breakdown');
  assert.deepEqual(fallback.returnQuantityBreakdown,after.returnQuantityBreakdown,'Sales fallback preserves quantities/disposition');
  assert.equal(fallback.outflows.returnCount,after.outflows.returnCount,'Sales fallback preserves modern return count');
  assert.equal(fallback.reconciliation.expectedCashInMinorUnits,11500);
  assert.equal(fallback.reconciliation.cashDiscrepancyInMinorUnits,0);
  assert.deepEqual(await fingerprint(),fallbackBefore,'Rollback restores evidence, open shift and all financial state');
  stage='clean closing after presentation-fault rollback';
  await ownerRpc(`close_cash_shift(${q(shift)},11500,NULL)`);
  const closed=await ownerRpc(`get_cash_shift_closing_report(${q(shift)})`);
  assert.deepEqual(closed.sales,after.sales);assert.equal(closed.reconciliation.cashDiscrepancyInMinorUnits,0);
  const closedRows=await fingerprint();assert.deepEqual(await ownerRpc(`get_cash_shift_closing_report(${q(shift)})`),closed);
  assert.deepEqual(await fingerprint(),closedRows);
  const lint=await exec(process.execPath,[cli,'db','lint','--local','--level','warning','--workdir',workdir],
    {cwd:root,windowsHide:true,timeout:120000,maxBuffer:8*1024*1024});
  const parsed=assertPackageDDbLint(lint.stdout,lint.stderr);
  console.log(JSON.stringify({ok:true,before:{gross:5000,net:3500,refunds:1500,inflows:12000,drawer:11500},
    after:{gross:19000,net:13500,refunds:1500,debtReduction:4000,returnEntitlement:5500,direct:5000,firstCliq:6000,credit:8000,inflows:12000,drawer:11500},
    debtOnlyWithoutShiftIncluded:true,operationalDailyHomeMatch:true,
    lateReceiptDoesNotReclassifyCredit:true,historicalSnapshotUnchanged:true,newSnapshotVerified:true,readerZeroWrite:true,
    optionalPresentationFailureDoesNotBlockClose:true,rollbackRestoresState:true,
    actualPublicRpc:true,dbLint:parsed,migration133:hash,productionAccess:0},null,2));
}catch(error){console.error(JSON.stringify({ok:false,stage,message:error.message},null,2));process.exitCode=1;}
finally{if(workdir)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',workdir],{cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});}
