// Actual supported payments on valid legacy invoices;no forged completion.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';
import {assertPackageDDbLint} from './package-d-db-lint-policy.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),project='nawasrah-all-collections203-test';
const cli=path.join(root,'node_modules/supabase/dist/supabase.js'),executor=executorFor(['--container','supabase_db_'+project]);
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-all-collections203-'));
const report={output,startedAt:new Date().toISOString(),managedAccess:false,cases:[]};let local,stage='bootstrap202',counter=0,shift;
const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`,owner=id(1),branch=id(200),customer=id(405);
const q=v=>"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb',key=()=>`collections203-runtime-${String(++counter).padStart(8,'0')}`;
const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
const json=async input=>JSON.parse((await sql(input)).split('\n').at(-1));
const auth=(body,role='authenticated')=>`BEGIN;SELECT set_config('request.jwt.claims',${q(JSON.stringify({sub:owner,role,aal:'aal2'}))},true);SET LOCAL ROLE ${role};${body}COMMIT;`;
const rpc=call=>json(auth(`SELECT public.${call};`));
const record=(name,details={})=>{const value={name,passed:true,...details};report.cases.push(value);console.log(JSON.stringify(value));};
const expected=(cash=0,cliq=0,bank=0,cheque=0,other=0)=>({cashInMinorUnits:cash,cliqInMinorUnits:cliq,bankTransferInMinorUnits:bank,chequeInMinorUnits:cheque,otherInMinorUnits:other,totalInMinorUnits:cash+cliq+bank+cheque+other});
const facts=(b='NULL')=>json(`SELECT public.phase6_financial_facts_internal(${b},date_trunc('day',NOW() AT TIME ZONE 'Asia/Amman') AT TIME ZONE 'Asia/Amman',(date_trunc('day',NOW() AT TIME ZONE 'Asia/Amman')+INTERVAL '1 day') AT TIME ZONE 'Asia/Amman','Asia/Amman',true);`);
const reportRead=b=>rpc(`get_operational_business_report(${q(b)},(NOW() AT TIME ZONE 'Asia/Amman')::DATE,(NOW() AT TIME ZONE 'Asia/Amman')::DATE)`);
const payCall=(order,amount,method,k=key())=>`record_customer_order_payment_once(${q(order)},${amount},${q(method)},'LOCAL203',NULL,${q(k)})`;
async function parity(want,main=want){
 const f=await facts(),home=await rpc('get_home_dashboard()');assert.deepEqual(f.cashFlow.customerCollections,want);assert.deepEqual(home.summary.todayCollections,want);
 assert.equal(home.financialFactsStatus,'available');assert.equal(home.summary.todayCashCollectedInMinorUnits,want.cashInMinorUnits);assert.equal(home.summary.todayCliqCollectedInMinorUnits,want.cliqInMinorUnits);
 assert.deepEqual(f.dailyBreakdown.at(-1).customerCollections,want);assert.deepEqual((await reportRead(branch)).cashFlow.customerCollections,main);
 assert.deepEqual((await facts(q(id(999)))).cashFlow.customerCollections,expected());return {f,home,drawer:await rpc(`get_cash_shift_summary(${q(shift)})`)};
}
try{
 const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
  NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'202',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
  NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;stage='four real legacy methods before203';
 await sql('ALTER TABLE orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;');await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
 await rpc(`set_go_live_main_branch_v1(${q(branch)})`);await rpc(`open_cash_shift(${q(branch)},100000)`);shift=await json(`SELECT to_jsonb(id) FROM cash_shifts WHERE status='open' AND branch_id=${q(branch)};`);
 // Legacy identity/lifecycle fixture only;all subsequent money uses public writers.
 for(const [n,c] of [[991,401],[992,402],[993,403],[994,401]])await sql(`INSERT INTO orders(id,order_number,customer_id,customer_name_snapshot,branch_id,status,source,payment_method,total_in_minor_units,amount_paid_in_minor_units) VALUES(${q(id(n))},${q('UNDATED203-'+n)},${q(id(c))},'عميل قديم',${q(branch)},'completed','website','debt',5000,0);`);
 const calls=['cash','cliq','bank_transfer'].map((m,i)=>payCall(id(991+i),1000,m)),payments=[];for(const call of calls)payments.push(await rpc(call));
 const chequeCall=`receive_customer_cheque_v1(${q(id(401))},${q(branch)},'بنك الاختبار','UNDATED203',CURRENT_DATE+2,1000,NULL,${q(key())})`;await rpc(chequeCall);
 assert.equal(await sql('SELECT count(*) FROM order_status_history;'),'0');const before=await facts();assert.deepEqual(before.cashFlow.customerCollections,expected());assert.equal((await rpc(`get_cash_shift_summary(${q(shift)})`)).expectedCashInMinorUnits,101000);
 assert.deepEqual((await rpc('get_home_dashboard()')).summary.todayCollections,expected());assert.deepEqual((await reportRead(branch)).cashFlow.customerCollections,expected());
 record('202 omits four actual legacy methods despite payment evidence;cash drawer101000,Home/report zero',{actual:expected(1000,1000,1000,1000)});
 stage='explicit203 read-only correction';const catalogBefore=await json(schemaCatalogSql),data=await readApplicationFingerprint(executor),migration=await readFile(path.join(root,'supabase/migrations/203_customer_payment_receipts_without_completion.sql'),'utf8');await sql(migration);
 assert.deepEqual(await readApplicationFingerprint(executor),data);const differences=catalogDifference(catalogBefore,await json(schemaCatalogSql));assert.equal(differences.length,1);assert.ok(differences[0].before.identity.startsWith('phase6_financial_facts_internal('));
 const a={...differences[0].before},b={...differences[0].after};delete a.definition;delete b.definition;assert.deepEqual(a,b,'all ACL/owner/config/security/volatility exact');
 let p=await parity(expected(1000,1000,1000,1000));assert.deepEqual(p.f.sales,before.sales);assert.deepEqual(p.f.balances,before.balances);assert.equal(p.home.summary.todaySalesInMinorUnits,0);assert.equal(await sql('SELECT count(*) FROM order_status_history;'),'0');
 record('203 includes all four persisted methods by their own dates;no synthetic completion,revenue/profit/debt unchanged;one read body only');
 const fingerprint=await readApplicationFingerprint(executor);assert.equal((await rpc(calls[0])).idempotent,true);assert.equal((await rpc(chequeCall)).idempotentReplay,true);assert.deepEqual(await readApplicationFingerprint(executor),fingerprint);record('legacy payment and registered-cheque replay unchanged,including sequences');
 stage='actual legacy reversals';for(const payment of payments)await rpc(`reverse_customer_order_payment(${q(payment.payment_id)},'عكس قبض قديم للاختبار')`);
 p=await parity(expected(0,0,0,1000));assert.equal(p.drawer.expectedCashInMinorUnits,100000);assert.equal(p.f.cashFlow.cashRefundedInMinorUnits,0);assert.equal(p.home.summary.todaySalesInMinorUnits,0);record('legacy cash/CliQ/transfer reversals remove exactly each payment,refunds separate,cheque original retained');
 stage='owner scenario remains once alongside legacy';await sql(`INSERT INTO customers(id,full_name,phone,credit_limit_in_minor_units) VALUES(${q(customer)},'عميل السيناريو','0796600405',1000000);`);
 await rpc(`record_customer_opening_balances_v1(${q(key())},${j([{customer_id:customer,amount_in_minor_units:'5000',original_debt_date:'2020-01-01'}])})`);
 const collect=(amount,method)=>rpc(`collect_customer_balance_v1(${q(customer)},${amount},${q(method)},${q(branch)},'LOCAL203',NULL,${q(key())})`);
 await collect(3000,'cash');await collect(1000,'cliq');
 await rpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(branch)},p_warehouse_id:=${q(id(201))},p_idempotency_key:=${q(key())},p_payment_method:='deferred',p_lines:=${j([{client_line_id:id(901),line_kind:'base_unit',commercial_quantity:1000,base_unit_name:'باكيت',gross_amount_in_minor_units:200000,line_discount_in_minor_units:0,components:[{product_id:id(101),base_quantity:1000}]}])})`);
 const sale=await rpc(`create_pos_sale_v2(${q(id(201))},${q(branch)},${q(customer)},'سيناريو المالك','debt',${j([{commercial_line_kind:'base_unit',product_id:id(101),base_quantity:30,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,0,${q(key())})`);assert.equal(sale.success,true);
 await rpc(payCall(sale.orderId,2000,'cash'));const mixed=await collect(4000,'cash');assert.deepEqual([mixed.openingAmountInMinorUnits,mixed.ordersAmountInMinorUnits],[1000,3000]);
 p=await parity(expected(9000,1000,0,1000));assert.equal(p.drawer.expectedCashInMinorUnits,109000);assert.equal(p.home.summary.todaySalesInMinorUnits,30000);assert.equal(p.f.sales.grossSalesInMinorUnits,30000);assert.equal(p.f.sales.netProfitInMinorUnits,24000);
 assert.equal(await sql('SELECT SUM(amount_in_minor_units) FROM customer_payments WHERE NOT is_reversed;'),'6000');assert.equal(await sql('SELECT SUM(amount_in_minor_units) FROM customer_collection_opening_allocations;'),'5000');
 record('owner opening3cash+1CliQ+order2cash+mixed4cash=10 once,plus legacy cheque1,total11;drawer109000;modern gross30/profit24 only');
 stage='real legacy reversal after period boundary';const extra=await rpc(payCall(id(991),250,'cash')),cut=await sql('SELECT clock_timestamp();');await rpc(`reverse_customer_order_payment(${q(extra.payment_id)},'عكس بعد حد الفترة')`);const end=await sql('SELECT clock_timestamp();');
 const onlyReversal=await json(`SELECT public.phase6_financial_facts_internal(NULL,${q(cut)}::timestamptz,${q(end)}::timestamptz,'Asia/Amman',true);`);assert.deepEqual(onlyReversal.cashFlow.customerCollections,expected(-250));await parity(expected(9000,1000,0,1000));record('legacy receipt before boundary excluded;actual later reversal signed -250,whole day unchanged');
 stage='branch attribution and existing other tender';await sql(`INSERT INTO branches(id,code,name_ar,is_active) VALUES(${q(id(210))},'LEG203','فرع ثان',true);INSERT INTO orders(id,order_number,customer_id,branch_id,status,source,payment_method,total_in_minor_units,amount_paid_in_minor_units) VALUES(${q(id(995))},'UNDATED203-OTHER',${q(id(402))},${q(id(210))},'completed','website','debt',1000,0);`);
 await rpc(payCall(id(995),200,'bank_transfer'));await rpc(payCall(id(991),50,'card'));
 p=await parity(expected(9000,1000,200,1000,50),expected(9000,1000,0,1000,50));assert.deepEqual((await reportRead(id(210))).cashFlow.customerCollections,expected(0,0,200));assert.equal(p.drawer.expectedCashInMinorUnits,109000);assert.equal(p.home.summary.todaySalesInMinorUnits,30000);record('known order branch attribution unchanged;legacy card50 visible as other instead of silently discarded;no drawer/profit change');
 stage='replay and unchanged permissions/lint';for(const role of ['anon','authenticated','service_role']){const denied=await executeInput(executor,auth("SELECT public.phase6_financial_facts_internal(NULL,NOW()-INTERVAL '1 day',NOW(),'Asia/Amman',false);",role));assert.notEqual(denied.code,0);assert.match(denied.stderr,/permission denied/u);}
 const finalCatalog=await json(schemaCatalogSql),finalData=await readApplicationFingerprint(executor);await sql(migration);assert.deepEqual(await json(schemaCatalogSql),finalCatalog);assert.deepEqual(await readApplicationFingerprint(executor),finalData);
 const {stdout:lint}=await exec(process.execPath,[cli,'db','lint','--local','--level','warning','--workdir',local],{cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024**2});assertPackageDDbLint(lint);record('203 replay zero effects;private facts still denied;unchanged DB-lint policy');report.ok=true;
}catch(error){report.ok=false;report.stage=stage;report.error=error.message;process.exitCode=1;}
finally{if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:1024**2});report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
