import {installBenchmark219Clock} from './home-benchmark-clock219.mjs';
import {historicalShared219Compatibility} from './build-home219-read-sql.mjs';
import {measureHome219,finishHome219Report} from './home-performance219-benchmark.mjs';
import {originalHomeFactsDefinition} from './home-projection219.mjs';
// Original full two-year fixture;never a reduced-size performance acceptance.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {fullScale,assertCounts} from './package-e-scale-contract.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),project='nawasrah-home-damage202-scale-test';
const cli=path.join(root,'node_modules/supabase/dist/supabase.js'),executor=executorFor(['--container','supabase_db_'+project]);
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-home-damage202-scale-'));
const report={startedAt:new Date().toISOString(),output,profile:'FULL',managedAccess:false,parameters:fullScale};let local,clock,stage='bootstrap202';
const id=(k,n)=>`929${String(k).padStart(5,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`,owner=id(1,1);
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const auth=body=>`BEGIN;DO $$BEGIN PERFORM set_config('request.jwt.claims',${q(JSON.stringify({sub:owner,role:'authenticated',aal:'aal2'}))},true);END$$;SET LOCAL ROLE authenticated;${body}COMMIT;`;
const rawSql=async(text,variables={})=>{const r=await executeInput({...executor,args:[...executor.args,...Object.entries(variables).flatMap(([k,v])=>['-v',k+'='+v])]},text);assert.equal(r.code,0,r.stderr.slice(-6000));return r.stdout.trim();};
let sql=rawSql;
const json=async text=>JSON.parse(await sql(text));
const explain=query=>`SET LOCAL statement_timeout='60s';EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) ${query}`;
try{
 const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
  NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'202',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
  NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;
 await exec('docker',['update','--cpus','4','supabase_db_'+project],{windowsHide:true});
 await sql('ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;');
 clock=await installBenchmark219Clock({rawSql,project});sql=clock.sql;report.benchmarkClock=clock.report;
 stage='full two-year fixture';console.log(JSON.stringify({stage,parameters:fullScale}));
 const fixture=await readFile(path.join(root,'scripts/testing/package-e-scale-fixture.sql'),'utf8');
 const [setup,rest]=fixture.split('-- E2_BATCH_BEGIN'),[batch,finish]=rest.split('-- E2_BATCH_END');assert.ok(setup&&batch&&finish);
 const batches=[];for(let from=1;from<=fullScale.modern;from+=100)batches.push(auth(batch.replaceAll('__E2_FROM__',String(from)).replaceAll('__E2_TO__',String(Math.min(from+99,fullScale.modern)))));
 await sql(setup+batches.join('\n')+finish,fullScale);
 const counts=await json(`SELECT jsonb_build_object('skus',(SELECT COUNT(*) FROM products WHERE NOT is_flavor_master),'families',(SELECT COUNT(*) FROM products WHERE is_flavor_master),
  'customers',(SELECT COUNT(*) FROM customers),'suppliers',(SELECT COUNT(*) FROM suppliers),'orders',(SELECT COUNT(*) FROM orders),'items',(SELECT COUNT(*) FROM order_items),
  'receipts',(SELECT COUNT(*) FROM supplier_receipts)+(SELECT COUNT(*) FROM purchase_receipts),'payments',(SELECT COUNT(*) FROM customer_payments),
  'returns',(SELECT COUNT(*) FROM sales_returns)+(SELECT COUNT(*) FROM sales_return_events),'replacements',(SELECT COUNT(*) FROM sales_replacement_events WHERE issuance_status='issued'),
  'shifts',(SELECT COUNT(*) FROM cash_shifts),'movements',(SELECT COUNT(*) FROM inventory_movements));`);
 await clock.assertHardCase();
 assertCounts(counts,fullScale);report.counts=counts;console.log(JSON.stringify({stage:'exact full counts',counts}));
 // Restore both committed201 readers transactionally for an exact same-data
 // comparison against202;the current202 definitions must survive rollback.
 const historical=(await readFile(path.join(root,'supabase/migrations/201_home_collections_and_damage_losses.sql'),'utf8')).replaceAll('\r\n','\n');
 const baseline=historical.slice(historical.indexOf('CREATE OR REPLACE FUNCTION public.phase6_financial_facts_internal('),historical.lastIndexOf('COMMIT;'));
 const currentHome=await json(auth('SELECT public.get_home_dashboard();'));assert.equal(currentHome.financialFactsStatus,'available');
 const currentFacts=await json("SELECT public.phase6_financial_facts_internal(NULL,date_trunc('day',NOW() AT TIME ZONE 'Asia/Amman') AT TIME ZONE 'Asia/Amman',(date_trunc('day',NOW() AT TIME ZONE 'Asia/Amman')+INTERVAL '1 day') AT TIME ZONE 'Asia/Amman','Asia/Amman',false);");
 assert.deepEqual(currentHome.summary.todayCollections,currentFacts.cashFlow.customerCollections);
 const homeQuery='SELECT public.get_home_dashboard();';
 const beforeHome=query=>'BEGIN;'+baseline+auth(query).replace(/^BEGIN;/u,'').replace(/COMMIT;$/u,'ROLLBACK;');
 const definitionQuery="SELECT to_jsonb(prosrc) FROM pg_proc WHERE oid='public.phase6_financial_facts_internal(uuid,timestamptz,timestamptz,text,boolean)'::regprocedure;";
 const currentDefinition=await json(definitionQuery);report.timings=[];
 const benches=[
  {name:'before201-home',query:beforeHome(explain(homeQuery)),referenceLimitMs:3000},
  {name:'after202-home',query:auth(explain(homeQuery)).replace('BEGIN;','BEGIN READ ONLY;'),limitMs:3000,targetMs:1000},
 ];
 report.originalTimings=[];report.optimizedTimings=[];
 const originalBody=await originalHomeFactsDefinition(root,202);
 const compatibility=historicalShared219Compatibility(originalBody,clock.originalDefinition('public._get_home_dashboard_before133()'));
 const optimizedBody=compatibility.sql;
 const originalCoreDefinition=await json("SELECT to_jsonb(prosrc) FROM pg_proc WHERE oid='public._get_home_dashboard_before133()'::regprocedure;");
 const resetDefinition=await json(definitionQuery);
 // Explicit owner-approved temporary compatibility on this historical prefix.
 // BOTH original and optimized run the same original fixture/query/role/period.
 for(const bench of benches){
  stage='original full-scale '+bench.name;
  const measured=await measureHome219({name:'original-'+bench.name,query:bench.query,json});
  report.originalTimings.push(measured);
  const r=measured.rounds[0];report.timings.push({...bench,query:undefined,p50:r.p50,p95:r.p95,max:r.max,samples:r.samples,lastPlan:r.lastPlan});
 }
 stage='projection literal parity';
 const pairSql=auth(homeQuery).replace(/COMMIT;$/u,'')+'RESET ROLE;'+optimizedBody+'SET LOCAL ROLE authenticated;'+homeQuery+'ROLLBACK;';
 const pair=(await sql(pairSql)).split(/\r?\n/u).map(row=>JSON.parse(row));
 assert.equal(pair.length,2,'HOME219_EXACT_TWO_SAME_TRANSACTION_READS');
 assert.deepEqual(pair[1],pair[0],'HOME219_HISTORICAL_LITERAL_HOME_JSON_PARITY');
 report.financialJsonExactlyEqual=true;
 await sql('BEGIN;'+optimizedBody+'COMMIT;');
 try{
  const expectedDefinition=await json(definitionQuery);
  const optimizedHome=benches.find(b=>b.name==='after202-home');assert.ok(optimizedHome);
  stage='optimized full-scale '+optimizedHome.name;
  const optimized=await measureHome219({name:'optimized-'+optimizedHome.name,query:optimizedHome.query,json,assertLimit:false,evidenceKind:'optimized-current'});
  report.optimizedTimings.push(optimized);
  assert.equal(await json(definitionQuery),expectedDefinition,'HOME219_BENCHMARK_CHANGED_DEFINITION');
  report.originalSlowValuesRetained=true;
  await writeFile(path.join(output,'performance-report.json'),JSON.stringify(report,null,2)+'\n');
  assert.ok(optimized.withinLimit,'FULL202_HOME_P95_EXCEEDS_EXISTING_3_SECOND_GATE');
 }finally{
  await sql('BEGIN;'+compatibility.restoreSql+'COMMIT;');
  assert.equal(await json("SELECT to_jsonb(prosrc) FROM pg_proc WHERE oid='public._get_home_dashboard_before133()'::regprocedure;"),originalCoreDefinition,'HOME219_ORIGINAL_CORE_MUST_BE_RESTORED');
  assert.equal(await json("SELECT to_jsonb(to_regprocedure('public.home219_shared_period_facts_internal(uuid,timestamptz,timestamptz,timestamptz,timestamptz,text)') IS NULL);"),true,'HOME219_TEMPORARY_HELPER_MUST_BE_REMOVED');
  assert.equal(await json(definitionQuery),resetDefinition,'HOME219_ORIGINAL_DEFINITION_MUST_BE_RESTORED');
 }
 const timing=name=>report.timings.find(t=>t.name===name).p95;
 report.overhead={homeP95DeltaMs:timing('after202-home')-timing('before201-home'),reviewThresholdMs:300};
 report.overhead.followUpSuggested=report.overhead.homeP95DeltaMs>300;console.log(JSON.stringify({stage:'before201/after202 overhead',...report.overhead}));
 assert.equal(await json(definitionQuery),currentDefinition,'BEFORE_MEASUREMENTS_MUST_ROLL_BACK_TO_CURRENT202_DEFINITION');
 report.ok=true;
}catch(error){report.ok=false;report.stage=stage;report.error=error.message;process.exitCode=1;}
finally{
 const ok=await finishHome219Report({report,output,stop:async()=>{try{if(clock){await clock.assertHardCase();await clock.restore();report.benchmarkClockRestored=true;}}finally{if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:1024**2});}}});
 if(!ok)process.exitCode=1;
}
