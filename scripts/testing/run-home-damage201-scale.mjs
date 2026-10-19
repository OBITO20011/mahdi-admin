// Original full two-year fixture;never a reduced-size performance acceptance.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {fullScale,assertCounts,timingSummary} from './package-e-scale-contract.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),project='nawasrah-home-damage201-scale-test';
const cli=path.join(root,'node_modules/supabase/dist/supabase.js'),executor=executorFor(['--container','supabase_db_'+project]);
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-home-damage201-scale-'));
const report={startedAt:new Date().toISOString(),output,profile:'FULL',managedAccess:false,parameters:fullScale};let local,stage='bootstrap201';
const id=(k,n)=>`929${String(k).padStart(5,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`,owner=id(1,1);
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const auth=body=>`BEGIN;DO $$BEGIN PERFORM set_config('request.jwt.claims',${q(JSON.stringify({sub:owner,role:'authenticated',aal:'aal2'}))},true);END$$;SET LOCAL ROLE authenticated;${body}COMMIT;`;
const sql=async(text,variables={})=>{const r=await executeInput({...executor,args:[...executor.args,...Object.entries(variables).flatMap(([k,v])=>['-v',k+'='+v])]},text);assert.equal(r.code,0,r.stderr.slice(-6000));return r.stdout.trim();};
const json=async text=>JSON.parse(await sql(text));
const explain=query=>`SET LOCAL statement_timeout='60s';EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) ${query}`;
try{
 const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
  NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'201',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
  NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;
 await exec('docker',['update','--cpus','4','supabase_db_'+project],{windowsHide:true});
 await sql('ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;');
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
 assertCounts(counts,fullScale);report.counts=counts;console.log(JSON.stringify({stage:'exact full counts',counts}));
 //200 actual facts are197's explicit final definition;restore both changed
 //readers transactionally for an exact same-data comparison against201.
 const baselineSource=(await readFile(path.join(root,'supabase/migrations/197_canonical_home_customer_receivables.sql'),'utf8')).replaceAll('\r\n','\n');
 const baselineFacts=baselineSource.slice(baselineSource.indexOf('CREATE OR REPLACE FUNCTION public.phase6_financial_facts_internal('),baselineSource.indexOf('CREATE OR REPLACE FUNCTION public.run_advanced_monitoring_checks('));
 const homeSource=(await readFile(path.join(root,'supabase/migrations/134_package_e_read_performance.sql'),'utf8')).replaceAll('\r\n','\n');
 const homeStart=homeSource.indexOf('CREATE OR REPLACE FUNCTION public._get_home_dashboard_before133(');
 const homeEnd=homeSource.indexOf('\n$$;',homeStart);assert.ok(homeStart>0&&homeEnd>homeStart);
 const baseline=baselineFacts+homeSource.slice(homeStart,homeEnd+4);
 // Require a successful canonical read: a fast unavailable fallback is not
 // performance acceptance. Cash+CliQ must equal the canonical daily facts.
 const currentHome=await json(auth('SELECT public.get_home_dashboard();'));
 assert.equal(currentHome.financialFactsStatus,'available');
 const currentFacts=await json(`SELECT public.phase6_financial_facts_internal(NULL,date_trunc('day',NOW() AT TIME ZONE 'Asia/Amman') AT TIME ZONE 'Asia/Amman',(date_trunc('day',NOW() AT TIME ZONE 'Asia/Amman')+INTERVAL '1 day') AT TIME ZONE 'Asia/Amman','Asia/Amman',false);`);
 assert.equal(currentHome.summary.todayCashCollectedInMinorUnits,currentFacts.cashFlow.cashCollectedInMinorUnits);
 assert.equal(currentHome.summary.todayCliqCollectedInMinorUnits,currentFacts.cashFlow.cliqCollectedInMinorUnits);
 const homeQuery='SELECT public.get_home_dashboard();';
 const beforeHome=query=>'BEGIN;'+baseline+auth(query).replace(/^BEGIN;/u,'').replace(/COMMIT;$/u,'ROLLBACK;');
 const definitionQuery="SELECT to_jsonb(prosrc) FROM pg_proc WHERE oid='public.phase6_financial_facts_internal(uuid,timestamptz,timestamptz,text,boolean)'::regprocedure;";
 const currentDefinition=await json(definitionQuery);report.timings=[];
 const benches=[
  {name:'before200-home',query:beforeHome(explain(homeQuery)),referenceLimitMs:3000},
  {name:'after201-home',query:auth(explain(homeQuery)).replace('BEGIN;','BEGIN READ ONLY;'),limitMs:3000,targetMs:1000},
 ];
 for(const bench of benches){
  stage='full-scale p95 '+bench.name;
  for(let n=0;n<3;n++)await json(bench.query);
  const samples=[];let plan;for(let n=0;n<20;n++){plan=await json(bench.query);samples.push(plan[0]['Execution Time']);}
  const summary=timingSummary(samples),{query:omitted,...metadata}=bench;assert.ok(omitted);
  report.timings.push({...metadata,...summary,lastPlan:plan});
  console.log(JSON.stringify({stage,...metadata,...summary}));
  if(bench.name==='after201-home')assert.ok(summary.p95<3000,'FULL201_HOME_P95_EXCEEDS_EXISTING_3_SECOND_GATE');
 }
 const timing=name=>report.timings.find(t=>t.name===name).p95;
 report.overhead={homeP95DeltaMs:timing('after201-home')-timing('before200-home'),reviewThresholdMs:300};
 report.overhead.followUpSuggested=report.overhead.homeP95DeltaMs>300;console.log(JSON.stringify({stage:'before200/after201 overhead',...report.overhead}));
 assert.equal(await json(definitionQuery),currentDefinition,'BEFORE_MEASUREMENTS_MUST_ROLL_BACK_TO_CURRENT201_DEFINITION');
 report.ok=true;
}catch(error){report.ok=false;report.stage=stage;report.error=error.message;process.exitCode=1;}
finally{
 if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:1024**2});
 report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({ok:report.ok,stage:report.stage,error:report.error,output,endedAt:report.endedAt}));
}
