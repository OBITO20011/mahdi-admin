// Independent integration proof: real public writers, no mocked balances.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile);
const project='nawasrah-integration182-test',executor=executorFor(['--container','supabase_db_'+project]);
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-integration182-'));
const report={startedAt:new Date().toISOString(),managedAccess:false,output};let local,stage='bootstrap182';
const id=n=>'92600000-0000-4000-8000-'+String(n).padStart(12,'0');
const q=v=>v===null?'NULL':"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb';
const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
const json=async input=>JSON.parse(await sql(input));
const rpc=command=>json(`BEGIN;SET LOCAL ROLE authenticated;
 DO $$BEGIN PERFORM set_config('request.jwt.claims',${q(JSON.stringify({sub:id(1),role:'authenticated',aal:'aal2'}))},true);END$$;
 SELECT public.${command};COMMIT;`);
const balance=()=>json(`SELECT public.phase42_customer_receivable_total_internal(${q(id(401))});`);
try{
 const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
  NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'182',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
  NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;
 await sql(`ALTER TABLE orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;`);
 await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
 stage='RPC-only eight startup tables';
 const tables=['go_live_setup_state','go_live_import_batches','customer_opening_balances','supplier_opening_balances',
  'customer_collection_operations','customer_collection_opening_allocations','customer_collection_order_payments','supplier_opening_payments'];
 report.clientTablePrivileges=await json(`SELECT COALESCE(jsonb_agg(jsonb_build_object('table',t,'role',r,'privilege',p)),'[]'::jsonb)
  FROM unnest(ARRAY[${tables.map(q)}]) t CROSS JOIN unnest(ARRAY['anon','authenticated']) r
  CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
  WHERE has_table_privilege(r,'public.'||t,p);`);
 assert.deepEqual(report.clientTablePrivileges,[],'NO_STARTUP_CLIENT_TABLE_PRIVILEGES');
 assert.equal(await json(`SELECT count(*) FROM pg_class WHERE oid=ANY(ARRAY[${tables.map(t=>q('public.'+t)+'::regclass')}]) AND relrowsecurity`),8);
 stage='cash day:163 collections and182 withdrawals';
 await rpc(`set_go_live_main_branch_v1(${q(id(200))})`);
 await rpc(`record_customer_opening_balances_v1('integration182-customer-opening-0001',${j([{customer_id:id(401),amount_in_minor_units:5000,original_debt_date:'2020-01-01'}])})`);
 await rpc(`record_supplier_opening_balances_v1('integration182-supplier-opening-0001',${j([{supplier_id:id(301),direction:'payable',amount_in_minor_units:7000,original_balance_date:'2020-01-01'}])})`);
 await rpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(302))},p_branch_id:=${q(id(200))},p_warehouse_id:=${q(id(201))},
  p_idempotency_key:='integration182-stock-000000000001',p_payment_method:='deferred',p_lines:=${j([{client_line_id:id(901),line_kind:'base_unit',commercial_quantity:100,base_unit_name:'باكيت',gross_amount_in_minor_units:20000,line_discount_in_minor_units:0,components:[{product_id:id(101),base_quantity:100}]}])})`);
 await rpc(`open_cash_shift(${q(id(200))},100000)`);
 const shift=await json(`SELECT to_jsonb(id) FROM cash_shifts WHERE status='open';`);
 const sale=async(method,quantity)=>rpc(`create_pos_sale_v2(${q(id(201))},${q(id(200))},${q(id(401))},'يوم التكامل',${q(method)},${j([
  {commercial_line_kind:'base_unit',product_id:id(101),base_quantity:quantity,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,${method==='debt'?0:quantity*1000},${q('integration182-'+method+'-sale-00000001')})`);
 const cash=await sale('cash',12),debt=await sale('debt',10);
 assert.equal(cash.totalInMinorUnits,12000);assert.equal(debt.totalInMinorUnits,10000);
 const collection=await rpc(`collect_customer_balance_v1(${q(id(401))},8000,'cash',${q(id(200))},NULL,'افتتاحي ثم طلب','integration182-collection-00000001')`);
 assert.deepEqual([collection.openingAmountInMinorUnits,collection.ordersAmountInMinorUnits],[5000,3000]);
 await rpc(`pay_supplier_opening_balance_v1(${q(id(301))},${q(id(200))},4000,'cash',NULL,'من الدرج','integration182-supplier-pay-00001')`);
 const item=await json(`SELECT to_jsonb(id) FROM order_items WHERE order_id=${q(cash.orderId)}`);
 const returned=await rpc(`settle_admin_sales_return_v1(${q(cash.orderId)},'integration182-cash-return-000001',${j([
  {return_scope:'base_unit',order_item_id:item,quantity:2,stock_disposition:'restock'}])},${j([
  {root_source_kind:'base_order_item',root_source_id:item,source_kind:'base_order_item',source_id:item,product_id:id(101),quantity:2,sellable_restock_quantity:2,defect_non_sellable_quantity:0,customer_damage_quantity:0}])},'مرتجع يوم التكامل','cash',NULL,NULL)`);
 assert.equal(returned.moneyRefundInMinorUnits,2000);assert.equal(returned.debtReductionInMinorUnits,0);
 const profitBefore=(await rpc('get_home_dashboard()')).summary.monthProfitInMinorUnits;
 const firstWithdrawal=await rpc(`create_owner_cash_withdrawal_v1(${q(shift)},20000,'سحب يوم التكامل','integration182-withdraw-00000001')`);
 await rpc(`reverse_owner_cash_withdrawal_v1(${q(firstWithdrawal.withdrawalId)},'إرجاع يوم التكامل','integration182-reverse-000000001')`);
 await rpc(`create_owner_cash_withdrawal_v1(${q(shift)},15000,NULL,'integration182-withdraw-00000002')`);
 const homeAfter=await rpc('get_home_dashboard()');
 assert.equal(homeAfter.summary.monthProfitInMinorUnits,profitBefore,'withdrawals never change profit');
 assert.equal(homeAfter.summary.monthOwnerWithdrawalsInMinorUnits,15000,'home must show server net withdrawal');
 assert.equal(homeAfter.summary.monthRemainingAfterWithdrawalsInMinorUnits,profitBefore-15000);
 const summary=await rpc(`get_cash_shift_summary(${q(shift)})`);
 const expected={openingCashInMinorUnits:100000,cashSalesInMinorUnits:12000,cashReceiptsInMinorUnits:8000,
  cashSupplierPaymentsInMinorUnits:4000,cashRefundsInMinorUnits:2000,expectedCashInMinorUnits:99000,
  openingDebtCashReceiptsInMinorUnits:5000,openingSupplierCashPaymentsInMinorUnits:4000,ownerWithdrawalsInMinorUnits:35000,ownerWithdrawalReturnsInMinorUnits:20000};
 // 100.000 +12.000 +8.000 -4.000 -2.000 -20.000 +20.000 -15.000 =99.000. Manual oracle.
 for(const [field,value] of Object.entries(expected))assert.equal(summary[field],value,field);
 assert.equal(await balance(),7000);
 stage='live versus frozen closing financial JSON';
 const open=await rpc(`get_cash_shift_closing_report(${q(shift)})`);
 await rpc(`close_cash_shift(${q(shift)},99000,NULL)`);
 const closed=await rpc(`get_cash_shift_closing_report(${q(shift)})`);
 for(const field of ['openingCashInMinorUnits','cashSalesInMinorUnits','cliqSalesInMinorUnits','cardSalesInMinorUnits',
  'cashReceiptsInMinorUnits','cliqReceiptsInMinorUnits','cashSupplierPaymentsInMinorUnits','cliqSupplierPaymentsInMinorUnits',
  'cashExpensesInMinorUnits','cliqExpensesInMinorUnits','cashRefundsInMinorUnits','cliqRefundsInMinorUnits','expectedCashInMinorUnits'])
  assert.deepEqual(closed.shift[field],open.shift[field],'frozen shift.'+field);
 for(const section of ['sales','collections','outflows','returnQuantityBreakdown','ownerWithdrawals'])assert.deepEqual(closed[section],open[section],section);
 for(const [field,value] of Object.entries(open.reconciliation))if(!['actualCashInMinorUnits','cashDiscrepancyInMinorUnits','isBalanced'].includes(field))
  assert.deepEqual(closed.reconciliation[field],value,'reconciliation.'+field);
 assert.equal(closed.reconciliation.expectedCashInMinorUnits,99000);assert.equal(closed.reconciliation.actualCashInMinorUnits,99000);
 assert.equal(closed.reconciliation.cashDiscrepancyInMinorUnits,0);assert.equal(closed.reconciliation.isBalanced,true);
 assert.deepEqual(await rpc(`get_cash_shift_closing_report(${q(shift)})`),closed,'frozen snapshot replay');
 assert.equal(closed.ownerWithdrawals.netInMinorUnits,15000);
 assert.equal(closed.ownerWithdrawals.netMovementAfterWithdrawalsInMinorUnits,-1000);
 report.cashDay={expected,withdrawals:{withdrawn:35000,returned:20000,net:15000,profitUnchanged:true},collection:{opening:5000,orders:3000},endingCustomerDebt:7000,financialJsonParity:true,
  allowedClosingChanges:['actualCashInMinorUnits','cashDiscrepancyInMinorUnits','isBalanced','shift close/status/time metadata','snapshot status/generated time']};
 stage='status-set measurement (report only)';
 const measure=async()=>({canonical:await balance(),home:(await rpc('get_home_dashboard()')).summary.customerReceivablesInMinorUnits});
 const baseline=await measure();assert.deepEqual(baseline,{canonical:7000,home:7000});
 // Real CHECK: delivered is not a valid current order status. Never disable it.
 await assert.rejects(()=>sql(`UPDATE orders SET status='delivered' WHERE id=${q(debt.orderId)};`),/orders_status_check/u);
 // Explicit diagnostic-only legacy row state, rolled back. This is not a
 // claim that a supported modern Return writer creates an unpaid returned row.
 const legacy=await json(`BEGIN;UPDATE orders SET status='returned' WHERE id=${q(debt.orderId)};
 DO $$BEGIN PERFORM set_config('request.jwt.claims',${q(JSON.stringify({sub:id(1),role:'authenticated',aal:'aal2'}))},true);END$$;
 SELECT jsonb_build_object('canonical',(SELECT SUM(public.phase42_customer_receivable_total_internal(id)) FROM customers),
  'home',(public.get_home_dashboard()->'summary'->>'customerReceivablesInMinorUnits')::bigint,
  'facts',(public.phase6_financial_facts_internal(NULL,NOW()-INTERVAL '1 day',NOW()+INTERVAL '1 day','Asia/Amman',false)->'balances'->>'customerDueInMinorUnits')::bigint,
  'returnedOrderDue',(SELECT outstanding_total_in_minor_units FROM public.phase42_order_financial_position_internal(${q(debt.orderId)})));ROLLBACK;`);
 assert.deepEqual(legacy,{canonical:0,home:7000,facts:7000,returnedOrderDue:7000});
 assert.deepEqual(await measure(),baseline,'diagnostic rolled back');
 report.receivableStatusMeasurement={baseline,deliveredRejectedByCheck:true,legacyReturned:legacy,
  supportedWriterClaim:false,explanation:'A valid-schema legacy returned row with debt differs by7000;current supported operations above match. No SQL/product correction.'};
 report.ok=true;
}catch(error){report.ok=false;report.stage=stage;report.error=error.message;process.exitCode=1;}
finally{
 if(local)await exec(process.execPath,[path.join(root,'node_modules/supabase/dist/supabase.js'),'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true});
 report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}
