// Genuine local writers and a diagnostic legacy state;never a hosted database.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
import {assertPackageDDbLint} from './package-d-db-lint-policy.mjs';

const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),project='nawasrah-canonical197-test';
const cli=path.join(root,'node_modules/supabase/dist/supabase.js'),executor=executorFor(['--container','supabase_db_'+project]);
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-canonical197-'));
const report={startedAt:new Date().toISOString(),output,managedAccess:false,cases:[]};let local,stage='bootstrap196',counter=0;
const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`,owner=id(1),branch=id(200),customer=id(401);
const q=v=>"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb',key=()=>`canonical197-runtime-${String(++counter).padStart(8,'0')}`;
const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
const json=async input=>JSON.parse((await sql(input)).split('\n').at(-1));
const auth=(body,role='authenticated',actor=owner)=>`BEGIN;SELECT set_config('request.jwt.claims',${q(JSON.stringify({sub:actor,role,aal:'aal2'}))},true);SET LOCAL ROLE ${role};${body}COMMIT;`;
const rpc=call=>json(auth(`SELECT public.${call};`));
const legal=()=>json('SELECT COALESCE(SUM(public.phase42_customer_receivable_total_internal(id)),0)::BIGINT FROM customers;');
const record=(name,details={})=>{const value={name,passed:true,...details};report.cases.push(value);console.log(JSON.stringify(value));};
let period;
const facts=(b=null)=>json(`SELECT public.phase6_financial_facts_internal(${b?q(b):'NULL'},${q(period.start)},${q(period.end)},'Asia/Amman',false);`);
const sale=(c,n,method='debt')=>rpc(`create_pos_sale_v2(${q(id(201))},${q(branch)},${q(c)},'اختبار المصدر القانوني',${q(method)},${j([
 {commercial_line_kind:'base_unit',product_id:id(101),base_quantity:n,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,${method==='debt'?0:n*1000},${q(key())})`);
try{
 const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
  NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'196',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
  NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;stage='real writers and legacy reproduction';
 await sql('ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;');
 await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
 await rpc(`set_go_live_main_branch_v1(${q(branch)})`);
 await rpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(branch)},p_warehouse_id:=${q(id(201))},p_idempotency_key:=${q(key())},
  p_payment_method:='deferred',p_lines:=${j([{client_line_id:id(901),line_kind:'base_unit',commercial_quantity:1000,base_unit_name:'باكيت',gross_amount_in_minor_units:200000,line_discount_in_minor_units:0,components:[{product_id:id(101),base_quantity:1000}]}])})`);
 await rpc(`open_cash_shift(${q(branch)},100000)`);
 const debt=await sale(customer,10);
 await rpc(`record_customer_order_payment_once(${q(debt.orderId)},3000,'cash',NULL,NULL,${q(key())})`);
 // Same valid-schema diagnostic state measured in164;no claim that a supported
 // modern Return writer creates an unpaid returned row. Never disable guards.
 await sql(`UPDATE public.orders SET status='returned' WHERE id=${q(debt.orderId)};`);
 assert.equal(await legal(),0);
 const beforeHome=await rpc('get_home_dashboard()');assert.equal(beforeHome.summary.customerReceivablesInMinorUnits,7000);
 period=await json("SELECT jsonb_build_object('start',NOW()-INTERVAL '40 days','end',NOW()+INTERVAL '2 days');");
 const beforeFacts=await facts();assert.equal(beforeFacts.balances.customerDueInMinorUnits,7000);
 const beforeCatalog=await json(schemaCatalogSql),beforeData=await readApplicationFingerprint(executor);
 stage='apply original197 once and compare';
 const migration=(await readFile(path.join(root,'supabase/migrations/197_canonical_home_customer_receivables.sql'),'utf8')).replaceAll('\r\n','\n');
 await sql(migration);
 assert.deepEqual(await readApplicationFingerprint(executor),beforeData,'readers migration changes no public row or sequence');
 const differences=catalogDifference(beforeCatalog,await json(schemaCatalogSql));
 assert.equal(differences.length,2);assert.ok(differences.every(d=>d.section==='functions'));
 assert.deepEqual(differences.map(d=>d.before.identity.split('(')[0]).sort(),['phase6_financial_facts_internal','run_advanced_monitoring_checks']);
 for(const d of differences){const a={...d.before},b={...d.after};delete a.definition;delete b.definition;assert.deepEqual(b,a,'owner/ACL/search_path/volatility and every non-definition field unchanged');}
 const afterFacts=await facts(),afterHome=await rpc('get_home_dashboard()');
 assert.equal(afterFacts.balances.customerDueInMinorUnits,0);assert.equal(afterHome.summary.customerReceivablesInMinorUnits,0);
 const omitBalances=value=>Object.fromEntries(Object.entries(value).filter(([name])=>name!=='balances'));
 assert.deepEqual(omitBalances(afterFacts),omitBalances(beforeFacts),'all sales/profit/cashflow/expenses/daily/cohort JSON exact');
 const onlyHomeDebt=value=>{const copy=structuredClone(value);delete copy.generatedAt;delete copy.summary.customerReceivablesInMinorUnits;return copy;};
 assert.deepEqual(onlyHomeDebt(afterHome),onlyHomeDebt(beforeHome),'home only canonical debt changes,apart from generated timestamp');
 record('legacy returned7000:before home7000/legal0;after home0/legal0;all other JSON and all business rows unchanged',{before:7000,legal:0,after:0,catalogDifferences:2});
 await sql(`UPDATE public.orders SET status='completed' WHERE id=${q(debt.orderId)};`);
 stage='opening and compensation and unknown completion source';
 await rpc(`record_customer_opening_balances_v1(${q(key())},${j([{customer_id:customer,amount_in_minor_units:'5000',original_debt_date:'2020-01-01'}])})`);
 await sale(id(402),20);const cheque=await rpc(`receive_customer_cheque_v1(${q(id(402))},${q(branch)},'بنك الاختبار','CANONICAL197',CURRENT_DATE+2,5000,NULL,${q(key())})`);
 await rpc(`return_deferred_cheque_v1(${q(cheque.cheque.id)},1,'رجوع لاختبار المصدر القانوني',${q(key())})`);
 await sale(id(403),5,'cash');
 await sql(`INSERT INTO branches(id,code,name_ar,is_active) VALUES(${q(id(210))},'CAN197','فرع ثان',true);
  INSERT INTO customers(id,full_name,phone,is_active) VALUES(${q(id(404))},'عميل غير نشط بدين بلا تاريخ إكمال','0796600404',false);
  INSERT INTO orders(id,order_number,customer_id,branch_id,status,source,payment_method,total_in_minor_units,amount_paid_in_minor_units)
  VALUES(${q(id(904))},'CANONICAL-NO-COMPLETION',${q(id(404))},${q(id(210))},'completed','website','debt',3000,0);`);
 assert.equal(await legal(),35000);
 const complete=await facts();assert.equal(complete.balances.customerDueInMinorUnits,35000);
 assert.equal((await rpc('get_home_dashboard()')).summary.customerReceivablesInMinorUnits,35000);
 assert.deepEqual(complete.balances,{customerDueInMinorUnits:35000,customerOrderCount:3,customerCount:3});
 assert.equal((await facts(branch)).balances.customerDueInMinorUnits,32000);
 assert.equal((await facts(id(210))).balances.customerDueInMinorUnits,3000);
 assert.equal((await facts(id(999))).balances.customerDueInMinorUnits,0);
 const amounts=await json(`SELECT jsonb_object_agg(id::TEXT,phase42_customer_receivable_total_internal(id)) FROM customers;`);
 assert.equal(amounts[customer],12000);assert.equal(amounts[id(402)],20000);assert.equal(amounts[id(403)],0);assert.equal(amounts[id(404)],3000);
 const aggregate=await rpc('get_customer_debt_aging(NULL)');assert.equal(aggregate.total_in_minor_units,35000);
 for(const c of [customer,id(402),id(403),id(404)])assert.equal((await rpc(`get_customer_statement(${q(c)},1,25)`)).closing_balance_in_minor_units,amounts[c]);
 record('canonical totals include opening,returned-cheque claims,inactive/undated customers,exclude POS cash;branch attribution retained',{global:35000,main:32000,other:3000,customerBalances:amounts});
 stage='independent critical monitoring';
 await sql('SELECT public.run_advanced_monitoring_checks(CURRENT_TIMESTAMP);');
 const monitor=()=>json("SELECT jsonb_build_object('status',status,'severity',severity,'issueCount',issue_count,'details',details) FROM advanced_monitoring_checks WHERE check_key='integrity:accounting:customer-receivables';");
 const healthy=await monitor();assert.equal(healthy.status,'healthy');assert.equal(healthy.severity,'critical');
 const factsStart=migration.indexOf('CREATE OR REPLACE FUNCTION public.phase6_financial_facts_internal('),factsEnd=migration.indexOf('CREATE OR REPLACE FUNCTION public.run_advanced_monitoring_checks(');
 const body=migration.slice(factsStart,factsEnd),target="'customerDueInMinorUnits', b.due, 'customerOrderCount'";
 assert.equal(body.split(target).length,2);const fault=body.replace(target,"'customerDueInMinorUnits', b.due + 1, 'customerOrderCount'");
 const injected=await json(`BEGIN;${fault}SELECT public.run_advanced_monitoring_checks(CURRENT_TIMESTAMP);
  SELECT jsonb_build_object('status',status,'severity',severity,'details',details) FROM advanced_monitoring_checks
  WHERE check_key='integrity:accounting:customer-receivables';ROLLBACK;`);
 assert.equal(injected.status,'critical');assert.equal(injected.severity,'critical');assert.equal(injected.details.canonicalInMinorUnits,35000);
 assert.equal(injected.details.reportedInMinorUnits,35001);assert.equal(injected.details.differenceInMinorUnits,1);
 assert.deepEqual(await monitor(),healthy,'fault transaction rolled back,including monitoring state');assert.equal((await facts()).balances.customerDueInMinorUnits,35000);
 record('independent oracle healthy;genuine report-only +1 defect produces CRITICAL with exact values and rolls back',{canonical:35000,injected:35001,difference:1});
 stage='ACL and database lint';
 for(const role of ['anon','authenticated','service_role'])for(const call of ["phase6_financial_facts_internal(NULL,NOW()-INTERVAL '1 day',NOW(),'Asia/Amman',false)",'run_advanced_monitoring_checks(NOW())']){
  const denied=await executeInput(executor,auth(`SELECT public.${call};`,role));assert.notEqual(denied.code,0);assert.match(denied.stderr,/permission denied/u);
 }
 const {stdout:lint}=await exec(process.execPath,[cli,'db','lint','--local','--level','warning','--workdir',local],{cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});
 assertPackageDDbLint(lint);record('exact existing owner/security/grants and full DB-lint policy retained;private reads remain uncallable');
 report.ok=true;
}catch(error){report.ok=false;report.stage=stage;report.error=error.message;process.exitCode=1;}
finally{
 if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:1024**2});
 report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
