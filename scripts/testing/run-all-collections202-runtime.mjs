// Owner19Oct actual customer money: original authenticated writers, isolated DB.
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
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),project='nawasrah-all-collections202-test';
const cli=path.join(root,'node_modules/supabase/dist/supabase.js'),executor=executorFor(['--container','supabase_db_'+project]);
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-all-collections202-'));
const report={output,startedAt:new Date().toISOString(),managedAccess:false,cases:[]};let local,stage='bootstrap201',counter=0;
const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`,owner=id(1),branch=id(200),warehouse=id(201),customer=id(401);
const q=v=>"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb',key=()=>`collections202-runtime-${String(++counter).padStart(8,'0')}`;
const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
const json=async input=>JSON.parse((await sql(input)).split('\n').at(-1));
const auth=body=>`BEGIN;SELECT set_config('request.jwt.claims',${q(JSON.stringify({sub:owner,role:'authenticated',aal:'aal2'}))},true);SET LOCAL ROLE authenticated;${body}COMMIT;`;
const rpc=call=>json(auth(`SELECT public.${call};`));
const record=(name,details={})=>{const v={name,passed:true,...details};report.cases.push(v);console.log(JSON.stringify(v));};
const facts=(b='NULL',offset=0)=>json(`SELECT public.phase6_financial_facts_internal(${b},(date_trunc('day',NOW() AT TIME ZONE 'Asia/Amman')+INTERVAL '${offset} day') AT TIME ZONE 'Asia/Amman',(date_trunc('day',NOW() AT TIME ZONE 'Asia/Amman')+INTERVAL '${offset+1} day') AT TIME ZONE 'Asia/Amman','Asia/Amman',true);`);
const collect=(amount,method,k=key(),c=customer)=>rpc(`collect_customer_balance_v1(${q(c)},${amount},${q(method)},${q(branch)},'LOCAL202',NULL,${q(k)})`);
const expected=(cash=0,cliq=0,bank=0,cheque=0,other=0)=>({cashInMinorUnits:cash,cliqInMinorUnits:cliq,bankTransferInMinorUnits:bank,chequeInMinorUnits:cheque,otherInMinorUnits:other,totalInMinorUnits:cash+cliq+bank+cheque+other});
let shift;
const drawer=async()=>{const s=await rpc(`get_cash_shift_summary(${q(shift)})`);assert.equal(s.expectedCashInMinorUnits,100000+s.cashReceiptsInMinorUnits);return s;};
async function parity(want){
 const f=await facts(),home=await rpc('get_home_dashboard()');
 assert.deepEqual(f.cashFlow.customerCollections,want);assert.deepEqual(home.summary.todayCollections,want);
 assert.equal(home.summary.todayCashCollectedInMinorUnits,want.cashInMinorUnits);assert.equal(home.summary.todayCliqCollectedInMinorUnits,want.cliqInMinorUnits);
 assert.deepEqual(f.dailyBreakdown.at(-1).customerCollections,want);
 const r=await rpc(`get_operational_business_report(${q(branch)},(NOW() AT TIME ZONE 'Asia/Amman')::DATE,(NOW() AT TIME ZONE 'Asia/Amman')::DATE)`);
 assert.deepEqual(r.cashFlow.customerCollections,want);assert.deepEqual((await facts(q(id(999)))).cashFlow.customerCollections,expected());
 return {f,home,drawer:await drawer()};
}
try{
 const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
  NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'201',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
  NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;stage='actual opening cash3 and CliQ1 before202';
 await sql('ALTER TABLE orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;');
 await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
 await rpc(`set_go_live_main_branch_v1(${q(branch)})`);
 await rpc(`record_customer_opening_balances_v1(${q(key())},${j([{customer_id:customer,amount_in_minor_units:'5000',original_debt_date:'2020-01-01'}])})`);
 await rpc(`open_cash_shift(${q(branch)},100000)`);shift=await json(`SELECT to_jsonb(id) FROM cash_shifts WHERE branch_id=${q(branch)} AND status='open';`);
 const openingCash=await collect(3000,'cash'),openingCliq=await collect(1000,'cliq');
 assert.equal(openingCash.openingAmountInMinorUnits,3000);assert.equal(openingCliq.openingAmountInMinorUnits,1000);
 const before=await facts();assert.equal(before.cashFlow.cashCollectedInMinorUnits,0);assert.equal(before.cashFlow.cliqCollectedInMinorUnits,0);assert.equal((await drawer()).expectedCashInMinorUnits,103000);
 record('201 reproduces opening receipts missing from Home/report while drawer correctly includes cash3',{cash:3000,cliq:1000});
 const beforeCatalog=await json(schemaCatalogSql),data=await readApplicationFingerprint(executor);
 const migration=await readFile(path.join(root,'supabase/migrations/202_all_customer_collections_read_model.sql'),'utf8');
 stage='apply202 exact read-only catalog/data';await sql(migration);
 assert.deepEqual(await readApplicationFingerprint(executor),data,'read migration changes no business data');
 const differences=catalogDifference(beforeCatalog,await json(schemaCatalogSql));assert.equal(differences.length,2);
 assert.deepEqual(differences.map(d=>d.before.identity.split('(')[0]).sort(),['_get_home_dashboard_before133','phase6_financial_facts_internal']);
 for(const d of differences){const a={...d.before},b={...d.after};delete a.definition;delete b.definition;assert.deepEqual(a,b,'ACL/owner/security/config/volatility exact');}
 const first=await parity(expected(3000,1000));assert.deepEqual(first.f.sales,before.sales);assert.deepEqual(first.f.balances,before.balances);
 record('202 counts opening3+CliQ1 exactly,Home/report/day/branch parity,profit/debt/writers/ACL unchanged');
 stage='actual order payment and mixed unified allocation';
 await rpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q(key())},p_payment_method:='deferred',p_lines:=${j([{client_line_id:id(901),line_kind:'base_unit',commercial_quantity:1000,base_unit_name:'باكيت',gross_amount_in_minor_units:200000,line_discount_in_minor_units:0,components:[{product_id:id(101),base_quantity:1000}]}])})`);
 const sale=await rpc(`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(customer)},'المقبوض الفعلي','debt',${j([{commercial_line_kind:'base_unit',product_id:id(101),base_quantity:30,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,0,${q(key())})`);assert.equal(sale.success,true);
 const payKey=key(),payCall=`record_customer_order_payment_once(${q(sale.orderId)},2000,'cash',NULL,NULL,${q(payKey)})`;
 const pay=await rpc(payCall),mixedKey=key(),mixed=await collect(4000,'cash',mixedKey);
 assert.equal(mixed.openingAmountInMinorUnits,1000);assert.equal(mixed.ordersAmountInMinorUnits,3000);
 assert.equal(await sql('SELECT SUM(amount_in_minor_units) FROM customer_payments;'),'5000');
 assert.equal(await sql('SELECT SUM(amount_in_minor_units) FROM customer_collection_opening_allocations;'),'5000');
 let p=await parity(expected(9000,1000));assert.equal(p.drawer.expectedCashInMinorUnits,109000);assert.equal(p.drawer.cashReceiptsInMinorUnits,9000);
 record('owner scenario exact:opening3cash+1CliQ+order2cash+mixed4cash=10 total;order allocation3 counted once',{collections:p.f.cashFlow.customerCollections,drawer:p.drawer.expectedCashInMinorUnits});
 const snapshot=await readApplicationFingerprint(executor);assert.equal((await rpc(payCall)).idempotent,true);assert.equal((await collect(4000,'cash',mixedKey)).idempotentReplay,true);
 assert.deepEqual(await readApplicationFingerprint(executor),snapshot);await parity(expected(9000,1000));record('payment and unified replay create no rows,amounts or sequence changes');
 stage='four actual methods and cheque clearing';await collect(1500,'bank_transfer');
 const cheque=await rpc(`receive_customer_cheque_v1(${q(customer)},${q(branch)},'بنك الاختبار','ALL202-A',CURRENT_DATE+2,2500,NULL,${q(key())})`);
 p=await parity(expected(9000,1000,1500,2500));assert.equal(p.drawer.expectedCashInMinorUnits,109000);
 const gross=p.f.sales.netProfitInMinorUnits;await rpc(`clear_deferred_cheque_v1(${q(cheque.cheque.id)},1,${q(key())})`);
 p=await parity(expected(9000,1000,1500,2500));assert.equal(p.drawer.expectedCashInMinorUnits,109000);assert.equal(p.f.sales.netProfitInMinorUnits,gross);
 record('bank1.5+registered cheque2.5 counted once,outside drawer;clearing adds no new receipt',{collections:p.f.cashFlow.customerCollections});
 stage='real compensation claim receipt';const second=id(402);
 await rpc(`record_customer_opening_balances_v1(${q(key())},${j([{customer_id:second,amount_in_minor_units:'1000',original_debt_date:'2020-01-01'}])})`);
 const bounced=await rpc(`receive_customer_cheque_v1(${q(second)},${q(branch)},'بنك الاختبار','ALL202-B',CURRENT_DATE+2,1000,NULL,${q(key())})`);
 await rpc(`return_deferred_cheque_v1(${q(bounced.cheque.id)},1,'ارتداد للاختبار',${q(key())})`);
 const claim=await collect(500,'cash',key(),second);assert.equal(claim.compensationAmountInMinorUnits,500);assert.equal(claim.ordersAmountInMinorUnits,0);assert.equal(claim.openingAmountInMinorUnits,0);
 p=await parity(expected(9500,1000,1500,3500));assert.equal(p.drawer.expectedCashInMinorUnits,109500);
 record('compensation claim cash0.5 enters drawer/counts once;original cheque evidence remains in its method',{collections:p.f.cashFlow.customerCollections});
 stage='mixed collection reversal';await rpc(`reverse_customer_collection_v1(${q(mixed.operationId)},'عكس التحصيل المختلط للاختبار')`);
 p=await parity(expected(5500,1000,1500,3500));assert.equal(p.drawer.expectedCashInMinorUnits,105500);assert.equal(p.f.sales.netProfitInMinorUnits,gross);
 assert.equal(p.f.cashFlow.cashRefundedInMinorUnits,0);record('mixed reversal removes opening1+order3 once,refunds separate,drawer/profit exact');
 stage='standalone order payment reversal';await rpc(`reverse_customer_order_payment(${q(pay.payment_id)},'عكس دفعة الطلب للاختبار')`);
 p=await parity(expected(3500,1000,1500,3500));assert.equal(p.drawer.expectedCashInMinorUnits,103500);record('standalone order payment reversal subtracts exactly2,not entire unified receipt');
 stage='reversal after period boundary';
 const prior=await collect(250,'cash');assert.equal(prior.openingAmountInMinorUnits,250);
 const cut=await sql('SELECT clock_timestamp();');
 await rpc(`reverse_customer_collection_v1(${q(prior.operationId)},'عكس بعد حد الفترة للاختبار')`);
 const end=await sql('SELECT clock_timestamp();');
 const reversalOnly=await json(`SELECT public.phase6_financial_facts_internal(NULL,${q(cut)}::timestamptz,${q(end)}::timestamptz,'Asia/Amman',true);`);
 assert.deepEqual(reversalOnly.cashFlow.customerCollections,expected(-250));
 // The existing daily chart emits complete-day series only; this sub-day
 // probe exercises exact event boundaries in cashFlow,not a daily chart.
 assert.deepEqual(reversalOnly.dailyBreakdown,[]);
 await parity(expected(3500,1000,1500,3500));
 record('actual reversal after arbitrary period boundary is signed -0.25;prior receipt excluded,whole-day total unchanged;no clock/immutable-history manipulation');
 stage='zero period,replay,lint';assert.deepEqual((await facts('NULL',-10)).cashFlow.customerCollections,expected());
 const catalog=await json(schemaCatalogSql),endData=await readApplicationFingerprint(executor);await sql(migration);assert.deepEqual(await json(schemaCatalogSql),catalog);assert.deepEqual(await readApplicationFingerprint(executor),endData);
 const {stdout:lint}=await exec(process.execPath,[cli,'db','lint','--local','--level','warning','--workdir',local],{cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024**2});assertPackageDDbLint(lint);
 record('successful empty period is six exact zeros;202 replay has zero catalog/business effects;unchanged DB lint');report.ok=true;
}catch(error){report.ok=false;report.stage=stage;report.error=error.message;process.exitCode=1;}
finally{if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:1024**2});report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
