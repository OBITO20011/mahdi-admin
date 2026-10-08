import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {fullScale,smokeScale,assertCounts,expectedFinance,timingSummary} from './package-e-scale-contract.mjs';
import {homeParity} from './package-e-home-parity.mjs';
import {reportParity} from './package-e-report-parity.mjs';

const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..');
const projectId='nawasrah-package-e-scale-test',container=`supabase_db_${projectId}`;
const cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const smoke=process.argv.includes('--smoke'),params=smoke?smokeScale:fullScale;
const resumeOwned=process.argv.includes('--resume-owned');
const monitorOnly=process.argv.includes('--monitor-only');
const id=(kind,n)=>`929${String(kind).padStart(5,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1,1),branch=id(10,2),warehouse=id(11,2);
const q=value=>`'${String(value).replaceAll("'","''")}'`;
let workdir,stage='fresh134 bootstrap',activeBench,validatedState;
const sql=(text,{variables={},seed=false,maintenance=false}={})=>new Promise((resolve,reject)=>{
  const args=['exec','-i',container,'psql','-U',maintenance?'supabase_admin':'postgres','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1',
    ...Object.entries(variables).flatMap(([key,value])=>['-v',`${key}=${value}`])];
  const child=spawn('docker',args,{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let out='',err='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',v=>{out+=v;});child.stderr.on('data',v=>{
    err+=v;for(const progress of v.matchAll(/E2_PROGRESS modern_operations=(\d+)/gu))console.log(JSON.stringify({stage:'seed',modern:Number(progress[1])}));
  });child.on('error',reject);child.on('close',code=>code===0?resolve({out:out.trim(),err}):reject(Error(`${stage}: SQL exit${code}: ${err.slice(0,1500)}\n${err.slice(-4000)}`)));
  // Bulk fixture creation is not a timed gate. Real benchmark calls retain a
  // finite60s ceiling and the original1s/3s PASS thresholds, never relaxed.
  child.stdin.end(`SET statement_timeout=${q(seed?'0':'60s')};SET lock_timeout='30s';\n${text}`);
});
const json=async text=>JSON.parse((await sql(text)).out);
const auth=(command,role='authenticated')=>`BEGIN;DO $$ BEGIN PERFORM set_config('request.jwt.claims',
  ${q(JSON.stringify(role==='anon'?{role:'anon'}:{sub:owner,role,aal:'aal2'}))},true); END $$;
  SET LOCAL ROLE ${role};${command}ROLLBACK;`;
const rpc=(command,role='authenticated')=>json(auth(`SELECT public.${command};`,role));
const migrationHash=async()=>createHash('sha256').update((await readFile(path.join(root,
  'supabase/migrations/133_package_e_supplier_po_financial_consistency.sql'),'utf8')).replace(/\r\n?/gu,'\n')).digest('hex').toUpperCase();
const counts=()=>json(`SELECT jsonb_build_object('skus',(SELECT COUNT(*) FROM products WHERE NOT is_flavor_master),
  'families',(SELECT COUNT(*) FROM products WHERE is_flavor_master),'customers',(SELECT COUNT(*) FROM customers),
  'suppliers',(SELECT COUNT(*) FROM suppliers),'orders',(SELECT COUNT(*) FROM orders),'items',(SELECT COUNT(*) FROM order_items),
  'receipts',(SELECT COUNT(*) FROM supplier_receipts)+(SELECT COUNT(*) FROM purchase_receipts),
  'payments',(SELECT COUNT(*) FROM customer_payments),'returns',(SELECT COUNT(*) FROM sales_returns)+(SELECT COUNT(*) FROM sales_return_events),
  'replacements',(SELECT COUNT(*) FROM sales_replacement_events WHERE issuance_status='issued'),
  'shifts',(SELECT COUNT(*) FROM cash_shifts),'movements',(SELECT COUNT(*) FROM inventory_movements));`);
async function verify(){
  const actual=await counts();assertCounts(actual,params);
  const structural=await json(`SELECT jsonb_build_object(
    'orderTotals',(SELECT COUNT(*) FROM orders o WHERE o.total_in_minor_units<>(SELECT SUM(i.line_total_in_minor_units) FROM order_items i WHERE i.order_id=o.id)),
    'paymentTotals',(SELECT COUNT(*) FROM orders o WHERE o.payment_method='debt' AND o.amount_paid_in_minor_units<>(SELECT SUM(p.amount_in_minor_units) FROM customer_payments p WHERE p.order_id=o.id AND NOT p.is_reversed)),
    'supplierTotals',(SELECT COUNT(*) FROM suppliers s WHERE s.current_balance_in_minor_units<>(SELECT SUM(r.total_in_minor_units) FROM supplier_receipts r WHERE r.supplier_id=s.id)),
    'movementArithmetic',(SELECT COUNT(*) FROM inventory_movements WHERE balance_after<>balance_before+quantity),
    'stockTotals',(SELECT COUNT(*) FROM inventory_balances b WHERE b.on_hand_quantity<>(SELECT SUM(m.quantity) FROM inventory_movements m WHERE m.product_id=b.product_id AND m.warehouse_id=b.warehouse_id)),
    'warehouseBranch',(SELECT COUNT(*) FROM orders o JOIN warehouses w ON w.id=o.warehouse_id WHERE o.branch_id<>w.branch_id),
    'paymentShiftTime',(SELECT COUNT(*) FROM customer_payments p JOIN cash_shifts s ON s.id=p.cash_shift_id WHERE p.created_at<s.opened_at OR p.created_at>=s.closed_at),
    'returnShiftTime',(SELECT COUNT(*) FROM sales_returns r JOIN cash_shifts s ON s.id=r.cash_shift_id WHERE r.created_at<s.opened_at OR r.created_at>=s.closed_at),
    'wac',(SELECT COUNT(*) FROM products WHERE NOT is_flavor_master AND wac_cost_in_minor_units_exact<>500));`);
  assert.ok(Object.values(structural).every(n=>n===0),JSON.stringify(structural));
  console.log(JSON.stringify({stage:'volume/relational checks',counts:actual,structural,passed:true}));
  const expected=expectedFinance(params);
  // Verify generator accounting from independent persisted sale/payment/return
  // facts. The timed business-report gate below is the approved MONTHLY path;
  // a two-year/annual report is not a prerequisite disguised as fixture setup.
  // The exploratory365-day report exceeded60s and remains a documented issue,
  // not a PASS, nor grounds to relax any actual benchmark threshold.
  const finance=await json(`SELECT jsonb_build_object(
    'gross',(SELECT SUM(total_in_minor_units) FROM orders),
    'entitlement',(SELECT SUM(refund_amount_in_minor_units) FROM sales_returns)+(SELECT SUM(money_refund_amount_in_minor_units+debt_reduction_amount_in_minor_units) FROM sales_return_events),
    'cogs',(SELECT SUM(cogs_in_minor_units) FROM order_items),
    'collected',(SELECT SUM(total_in_minor_units) FROM orders WHERE payment_method<>'debt')+(SELECT SUM(amount_in_minor_units) FROM customer_payments WHERE NOT is_reversed),
    'due',(SELECT SUM(total_in_minor_units-amount_paid_in_minor_units) FROM orders WHERE payment_method='debt'),
    'supplierDue',(SELECT SUM(current_balance_in_minor_units) FROM suppliers),
    'replacementCost',(SELECT SUM(replacement_cogs_snapshot_in_minor_units) FROM phase43_replacement_inventory_effects),
    'recovery',(SELECT SUM(i.cogs_in_minor_units) FROM sales_returns r JOIN order_items i ON i.order_id=r.order_id WHERE r.stock_disposition='restock')+(SELECT SUM(historical_restock_value_in_minor_units_exact) FROM phase42_return_inventory_effects),
    'inventoryQuantity',(SELECT SUM(on_hand_quantity) FROM inventory_balances));`);
  finance.net=finance.gross-finance.entitlement;
  assert.deepEqual(finance,expected,'Independent two-year persisted accounting facts');
  assert.equal(await json('SELECT to_jsonb(SUM(on_hand_quantity)) FROM inventory_balances;'),expected.inventoryQuantity);
  return {counts:actual,structural,expectedFinance:expected};
}
async function explain(command,role='authenticated'){
  const data=await json(auth(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT public.${command};`,role));
  assert.equal(data.length,1);assert.ok(Number.isFinite(data[0]['Execution Time']));return data[0];
}
async function nestedEvidence(command,role){
  const result=await sql(`LOAD 'auto_explain';SET auto_explain.log_min_duration='10ms';
    SET auto_explain.log_analyze=on;SET auto_explain.log_buffers=on;SET auto_explain.log_nested_statements=on;
    SET auto_explain.log_format=json;SET client_min_messages=log;${auth(`SELECT public.${command};`,role)}`,{maintenance:true});
  const plans=[];
  for(const block of result.err.split(/LOG:\s+duration:/u).slice(1)){
    const start=block.indexOf('{');if(start<0)continue;const end=block.lastIndexOf('}');
    try{const parsed=JSON.parse(block.slice(start,end+1));plans.push(parsed);}catch{/* Non-plan diagnostic line, never accepted as a measured PASS. */}
  }
  const scans=[];
  const visit=(node,query)=>{
    if(node&&typeof node==='object'){
      if(node['Node Type']&&(/Scan|Join|Sort|Aggregate/u.test(node['Node Type'])))scans.push({node:node['Node Type'],
        relation:node['Relation Name'],index:node['Index Name'],actualRows:node['Actual Rows'],loops:node['Actual Loops'],
        totalMs:node['Actual Total Time'],sharedHit:node['Shared Hit Blocks'],sharedRead:node['Shared Read Blocks'],
        removed:node['Rows Removed by Filter'],query:query.slice(0,1200)});
      for(const value of Object.values(node))if(value&&typeof value==='object')visit(value,query);
    }
  };
  for(const plan of plans)visit(plan.Plan,plan['Query Text']??'');
  return scans.sort((a,b)=>(b.totalMs??0)*(b.loops??1)-(a.totalMs??0)*(a.loops??1)).slice(0,30);
}

try{
  const immutableHash=await migrationHash();
  const state=JSON.parse(await readFile(path.join(root,'docs/agent/project-state.json'),'utf8'));
  assert.equal(immutableHash,state.migration133CanonicalLfSha256);
  const performanceHash=createHash('sha256').update((await readFile(path.join(root,
    'supabase/migrations/134_package_e_read_performance.sql'),'utf8')).replace(/\r\n?/gu,'\n')).digest('hex').toUpperCase();
  assert.equal(performanceHash,state.migration134CanonicalLfSha256);
  if(resumeOwned){
    // Resume only this runner's disposable database, never an arbitrary host.
    const {stdout:inspection}=await exec('docker',['inspect',container,'--format','{{json .Config.Labels}}'],{windowsHide:true});
    const labels=JSON.parse(inspection);
    assert.equal(labels['com.supabase.cli.project'],projectId);
    workdir=labels['com.supabase.cli.workdir'];
    assert.ok(path.basename(workdir).startsWith('nawasrah-isolated-supabase-'));
    assert.equal(await json("SELECT to_jsonb(MAX(version::integer)) FROM supabase_migrations.schema_migrations;"),134);
    assert.equal(await json("SELECT to_jsonb(COUNT(*)) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state<>'idle';"),0);
    console.log(JSON.stringify({stage:'resume owned isolated fixture; all counts/financial checks rerun',profile:smoke?'SMOKE_ONLY':'FULL'}));
  }else{
  const {stdout}=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{
    cwd:root,windowsHide:true,timeout:600000,maxBuffer:8*1024*1024,env:{...process.env,
      NAWASRAH_ISOLATED_PROJECT_ID:projectId,NAWASRAH_MAX_MIGRATION:'133',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
      NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
  const boot=JSON.parse(stdout);assert.equal(boot.ok,true);workdir=boot.isolatedProjectRoot;
  }
  await exec('docker',['update','--cpus','4',container],{windowsHide:true});
  const {stdout:host}=await exec('docker',['info','--format','{"cpus":{{.NCPU}},"memoryBytes":{{.MemTotal}}}'],{windowsHide:true});
  stage='synthetic historical + actual modern seed';
  if(!resumeOwned){
  console.log(JSON.stringify({stage,profile:smoke?'SMOKE_ONLY':'FULL',targets:params}));
  const fixture=await readFile(path.join(root,'scripts/testing/package-e-scale-fixture.sql'),'utf8');
  const [setup,rest]=fixture.split('-- E2_BATCH_BEGIN');const [batch,finish]=rest.split('-- E2_BATCH_END');
  assert.ok(setup&&batch&&finish,'Explicit seed/batch boundaries are required');
  // Commit100 independent business attempts at a time. Do not increase DB lock
  // limits to mask the artificial thousands-of-operations-in-one-TX workload.
  const batches=[];
  for(let from=1;from<=params.modern;from+=100){
    batches.push(auth(batch.replaceAll('__E2_FROM__',String(from)).replaceAll('__E2_TO__',String(Math.min(from+99,params.modern))))
      .replace(/ROLLBACK;$/u,'COMMIT;'));
  }
  await sql(setup+batches.join('\n')+finish,{variables:params,seed:true});
  }
  stage='full volume + relational/financial consistency';const validated=await verify();validatedState=validated;
  console.log(JSON.stringify({stage,passed:true,counts:validated.counts}));
  if(!resumeOwned){
    stage='full-scale literal JSON parity before134/after134';
    activeBench={name:'baseline-home-parity',command:'get_home_dashboard()',role:'authenticated'};
    if(!monitorOnly){
      await homeParity({sql,root,owner,label:smoke?'smoke-NOT-full-volume':'full-volume'});
      await reportParity({sql,root,owner,branch,label:smoke?'smoke-NOT-full-volume':'full-volume'});
    }
    await sql(await readFile(path.join(root,'supabase/migrations/134_package_e_read_performance.sql'),'utf8'));
    activeBench=undefined;
  }
  const database=await json(`SELECT jsonb_build_object('postgres',version(),'databaseBytes',pg_database_size(current_database()),
    'sharedBuffers',current_setting('shared_buffers'),'workMem',current_setting('work_mem'));`);
  if(monitorOnly){
    stage='FULL recent-evidence monitoring timing';
    const started=performance.now();
    const cycle=await json('SELECT public.run_advanced_monitoring_checks(NOW());');
    const wallMs=performance.now()-started;
    assert.equal(cycle.ok,true);
    const check=await json("SELECT to_jsonb(c) FROM advanced_monitoring_checks c WHERE check_key='integrity:aftercare:durable-evidence';");
    assert.equal(check.status,'healthy');assert.equal(check.issue_count,0);
    assert.equal(check.details.returnsChecked,params.modern);assert.equal(check.details.replacementsChecked,params.modern);
    const cachedAt=performance.now();
    await json(`SELECT public.run_advanced_monitoring_checks(${q(check.checked_at)}::timestamptz+INTERVAL '5 minutes');`);
    assert.deepEqual(await json("SELECT to_jsonb(c) FROM advanced_monitoring_checks c WHERE check_key='integrity:aftercare:durable-evidence';"),check);
    console.log(JSON.stringify({ok:true,profile:smoke?'SMOKE_ONLY':'FULL',monitorOnly:true,validated,database,
      wallMs,scanMs:check.details.durationMs,cachedCycleMs:performance.now()-cachedAt,sixHourCache:true,productionAccess:0},null,2));
  }else{
  const lastOffset=Math.max(0,(Math.ceil(params.families/24)-1)*24);
  // Fixture discovery is privileged harness setup, not a public table read.
  // The timed call uses the literal ID, just like the supported UI RPC.
  const closingShift=await json(`SELECT to_jsonb(id) FROM cash_shifts WHERE branch_id=${q(branch)}
    AND status='closed' ORDER BY closed_at DESC LIMIT 1;`);
  assert.match(closingShift,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
  const benches=[
    // Owner2026-10-08 accepts2.28s stress;1s remains a post-delivery target.
    {name:'home',command:'get_home_dashboard()',limitMs:3000,targetMs:1000},
    {name:'monthly-report',command:`get_operational_business_report(${q(branch)},date_trunc('month',NOW() AT TIME ZONE 'Asia/Amman')::date,(NOW() AT TIME ZONE 'Asia/Amman')::date)`,limitMs:3000},
    {name:'daily-report',command:`get_operational_business_report(${q(branch)},(NOW() AT TIME ZONE 'Asia/Amman')::date,(NOW() AT TIME ZONE 'Asia/Amman')::date)`,limitMs:3000},
    {name:'daily-summary',command:"build_business_summary('daily',(NOW() AT TIME ZONE 'Asia/Amman')::date,(NOW() AT TIME ZONE 'Asia/Amman')::date,NOW())",role:'service_role',limitMs:3000},
    {name:'closing-report',command:`get_cash_shift_closing_report(${q(closingShift)})`,limitMs:3000},
    ...[{name:'orders-first',page:1},{name:'orders-late',page:Math.ceil((params.orders-params.modern)/25)},{name:'orders-search',page:1,search:'E2-LEGACY-0000100'}].map(b=>({name:b.name,command:`get_operational_orders_page(${b.page},25,'all',${b.search?q(b.search):'NULL'},'newest')`,limitMs:1000})),
    ...[{name:'products-first',page:1},{name:'products-late',page:Math.ceil(params.families/24)},{name:'products-search',page:1,search:'E2-S-00010'}].map(b=>({name:b.name,command:`get_admin_product_page(${b.page},24,${b.search?q(b.search):'NULL'},NULL,'all','name')`,limitMs:1000})),
    ...[{name:'catalog-first',offset:0},{name:'catalog-late',offset:lastOffset},{name:'customer-search',offset:0,search:'باكيت الحجم 00010'}].map(b=>({name:b.name,command:`get_public_storefront_catalog_page(24,${b.offset},NULL,${b.search?q(b.search):'NULL'},'all','recommended',NULL,NULL,NULL)`,role:'anon',limitMs:1000})),
    {name:'parcel-options',command:`get_public_configurable_parcel_options(ARRAY[${Array.from({length:Math.min(24,params.families)},(_,i)=>q(id(14,i+1))).join(',')}]::uuid[])`,role:'anon',limitMs:1000},
  ];
  const results=[];
  for(const bench of benches){
    try {
    stage=bench.name;activeBench=bench;const result=await rpc(bench.command,bench.role);
    assert.ok(result&&typeof result==='object'&&result.success!==false,'A fast error response is not performance evidence');
    if(bench.name==='home')assert.equal(result.financialFactsStatus,'available');
    if(bench.name.startsWith('orders-'))assert.ok(result.order_ids?.length>0,'Order page/search must contain real rows');
    if(bench.name.startsWith('products-'))assert.ok(result.products?.length>0,'Product page/search must contain real rows');
    if(bench.name.startsWith('catalog-')||bench.name==='customer-search')assert.ok(result.items?.length>0,'Catalog page/search must contain real families');
    if(bench.name==='parcel-options')assert.equal(result.options?.length,Math.min(24,params.families));
    const first=(await explain(bench.command,bench.role))['Execution Time'];
    for(let i=0;i<3;i++)await explain(bench.command,bench.role);
    const times=[];for(let i=0;i<20;i++)times.push((await explain(bench.command,bench.role))['Execution Time']);
    const stats=timingSummary(times);const pass=stats.p95<bench.limitMs;
    const detail={name:bench.name,firstCallMs:first,...stats,limitMs:bench.limitMs,result:pass?'PASS':'SLOW'};
    console.log(JSON.stringify(detail));
    if(!pass){
      try{detail.nestedEvidence=await nestedEvidence(bench.command,bench.role);}
      catch(error){detail.nestedEvidenceUnavailable=error.message;}
      console.log(JSON.stringify({name:bench.name,nestedEvidence:detail.nestedEvidence,nestedEvidenceUnavailable:detail.nestedEvidenceUnavailable}));
    }
    results.push(detail);
    } catch(error) {
      const detail={name:bench.name,result:'UNPROVEN',p50:null,p95:null,max:null,limitMs:bench.limitMs,error:error.message};
      try{detail.nestedEvidence=await nestedEvidence(bench.command,bench.role);}
      catch(profileError){detail.nestedEvidenceUnavailable=profileError.message;}
      results.push(detail);console.log(JSON.stringify(detail));
    }
  }
  // Close300 is measured using a new real fixture each time inside a disposable
  // transaction, never a same-key replay. All creation work is outside timing.
  {
    stage='close-shift-300';const closeTimes=[];
    try {
    const before=await counts();
    for(let repetition=0;repetition<24;repetition++){
      const lines=JSON.stringify([{commercial_line_kind:'base_unit',product_id:id(15,1),base_quantity:1,price_authority:'server_catalog',line_discount_in_minor_units:0}]);
      const result=await sql(`BEGIN;DO $$BEGIN PERFORM set_config('request.jwt.claims',${q(JSON.stringify({sub:owner,role:'authenticated',aal:'aal2'}))},true);END$$;
        SET LOCAL ROLE authenticated;
        CREATE TEMP TABLE e2_close_result(elapsed_ms numeric) ON COMMIT DROP;
        DO $$DECLARE shift uuid;i integer;started timestamptz;BEGIN shift:=(public.open_cash_shift(${q(branch)},0)->>'id')::uuid;
          FOR i IN 1..300 LOOP PERFORM public.create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(id(13,1))},'حجم الإغلاق',
            'cash',${q(lines)}::jsonb,0,1000,gen_random_uuid()::text);END LOOP;
          started:=clock_timestamp();PERFORM public.close_cash_shift(shift,300000,NULL);
          INSERT INTO e2_close_result VALUES(EXTRACT(epoch FROM clock_timestamp()-started)*1000);END$$;
        SELECT to_jsonb(elapsed_ms) FROM e2_close_result;ROLLBACK;`);
      const time=JSON.parse(result.out);if(repetition===0)console.log(JSON.stringify({closeFirstCallMs:time}));
      if(repetition>=4)closeTimes.push(time);
    }
    assert.deepEqual(await counts(),before,'Every close fixture rolls back completely');
    const closeStats=timingSummary(closeTimes);results.push({name:stage,...closeStats,limitMs:3000,result:closeStats.p95<3000?'PASS':'SLOW'});
    } catch(error) {
      results.push({name:'close-shift-300',result:'UNPROVEN',p50:null,p95:null,max:null,limitMs:3000,error:error.message});
    }
    assert.equal(await migrationHash(),immutableHash,'Migration133 must never change during E2');
    console.log(JSON.stringify({ok:smoke||results.every(r=>r.result==='PASS'),profile:smoke?'SMOKE_ONLY':'FULL',
      performanceGate:smoke?'NOT_APPLICABLE':results.every(r=>r.result==='PASS')?'PASS':'OWNER_REVIEW',
      environment:{host:JSON.parse(host),database,containerCpus:4,storage:'Docker desktop local volume; physical SSD not independently verified'},
      validated,results,migration133:immutableHash,migrationsModified:false,productionAccess:0},null,2));
    if(!smoke&&results.some(r=>r.result!=='PASS'))process.exitCode=1;
  }
  }
}catch(error){
  const diagnostics={};
  if(activeBench&&validatedState){
    // A timed-out RPC cannot yield20 timings. Diagnose one committed Return
    // separately under a maintenance role, without relaxing the failed gate.
    try{
      if(activeBench.name==='baseline-home-parity'){
        try{diagnostics.baselineHome=await nestedEvidence(activeBench.command,activeBench.role);}
        catch(profileError){diagnostics.baselineHomeUnavailable=profileError.message;}
      }
      const operation=await json("SELECT to_jsonb(operation_id) FROM sales_return_events WHERE settlement_status='settled' ORDER BY id LIMIT 1;");
      diagnostics.representativeReturn=await nestedEvidence(`phase42_assert_operational_return_evidence_internal(${q(operation)},true)`,'postgres');
      diagnostics.existingIndexes=await json("SELECT jsonb_agg(jsonb_build_object('table',tablename,'name',indexname,'definition',indexdef)) FROM pg_indexes WHERE schemaname='public' AND tablename IN ('inventory_movements','sales_aftercare_consumptions','sales_return_items','sales_replacement_items','phase42_return_inventory_effects','phase43_replacement_inventory_effects');");
    }catch(profileError){diagnostics.unavailable=profileError.message;}
  }
  console.error(JSON.stringify({ok:false,stage,profile:smoke?'SMOKE_ONLY':'FULL',message:error.message,
    validated:validatedState,diagnostics,measuredGate:'NOT PASSED',productionAccess:0},null,2));process.exitCode=1;
}
finally{if(workdir)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',workdir],{cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});}
