import {measureHome219,assertHome219SamplesRejected,finishHome219Report} from './home-performance219-benchmark.mjs';
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
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),project='nawasrah-home219-scale-test';
const cli=path.join(root,'node_modules/supabase/dist/supabase.js'),executor=executorFor(['--container','supabase_db_'+project]);
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-home219-scale-'));
const report={startedAt:new Date().toISOString(),output,profile:'FULL',managedAccess:false,parameters:fullScale};let local,stage='bootstrap219';
const id=(k,n)=>`929${String(k).padStart(5,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`,owner=id(1,1);
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const auth=body=>`BEGIN;DO $$BEGIN PERFORM set_config('request.jwt.claims',${q(JSON.stringify({sub:owner,role:'authenticated',aal:'aal2'}))},true);END$$;SET LOCAL ROLE authenticated;${body}COMMIT;`;
const sql=async(text,variables={})=>{const r=await executeInput({...executor,args:[...executor.args,...Object.entries(variables).flatMap(([k,v])=>['-v',k+'='+v])]},text);assert.equal(r.code,0,r.stderr.slice(-6000));return r.stdout.trim();};
const json=async text=>JSON.parse(await sql(text));
const explain=query=>`SET LOCAL statement_timeout='60s';EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) ${query}`;
try{
 const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
  NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'219',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
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
 // Require a successful canonical read: a fast unavailable fallback is not
 // performance acceptance. Cash+CliQ must equal the canonical daily facts.
 const currentHome=await json(auth('SELECT public.get_home_dashboard();'));
 assert.equal(currentHome.financialFactsStatus,'available');
 const currentFacts=await json(`SELECT public.phase6_financial_facts_internal(NULL,date_trunc('day',NOW() AT TIME ZONE 'Asia/Amman') AT TIME ZONE 'Asia/Amman',(date_trunc('day',NOW() AT TIME ZONE 'Asia/Amman')+INTERVAL '1 day') AT TIME ZONE 'Asia/Amman','Asia/Amman',false);`);
 assert.equal(currentHome.summary.todayCashCollectedInMinorUnits,currentFacts.cashFlow.cashCollectedInMinorUnits);
 assert.equal(currentHome.summary.todayCliqCollectedInMinorUnits,currentFacts.cashFlow.cliqCollectedInMinorUnits);
 const homeQuery='SELECT public.get_home_dashboard();';
 const originalBody=await originalHomeFactsDefinition(root,203,{privateName:true});
 const beforeHome=query=>'BEGIN;'+originalBody+auth(query).replace(/^BEGIN;/u,'').replace(/COMMIT;$/u,'ROLLBACK;');
 const definitionQuery="SELECT to_jsonb(prosrc) FROM pg_proc WHERE oid='public.phase6_financial_facts_before208_internal(uuid,timestamptz,timestamptz,text,boolean)'::regprocedure;";
 const currentDefinition=await json(definitionQuery);report.timings=[];
 const benches=[
  {name:'original217-home',query:beforeHome(explain(homeQuery)),referenceLimitMs:3000},
  {name:'current219-home',query:auth(explain(homeQuery)).replace('BEGIN;','BEGIN READ ONLY;'),limitMs:3000,targetMs:1000},
 ];
 report.originalTimings=[];report.optimizedTimings=[];
 const pairSql=auth(homeQuery).replace(/COMMIT;$/u,'')+'RESET ROLE;'+originalBody+'SET LOCAL ROLE authenticated;'+homeQuery+'ROLLBACK;';
 const pair=(await sql(pairSql)).split(/\r?\n/u).map(row=>JSON.parse(row));
 assert.equal(pair.length,2,'HOME219_EXACT_TWO_SAME_TRANSACTION_READS');
 assert.deepEqual(pair[0],pair[1],'HOME219_CURRENT_LITERAL_FINANCIAL_JSON_PARITY');
 const originalBenchmark=await measureHome219({name:'original217-home',query:benches[0].query,json});
 report.originalTimings.push(originalBenchmark);
 const optimized=await measureHome219({name:'current219-home',query:benches[1].query,json,evidenceKind:'optimized-current'});
 report.optimizedTimings.push(optimized);
 stage='real deliberate slowdown negative';
 // PostgreSQL actually sleeps inside the measured query. No synthetic timing
 // substitution,removed assertion,or altered acceptance threshold is involved.
 const slowHome="WITH deliberate_delay AS MATERIALIZED (SELECT pg_sleep(3.1)) SELECT public.get_home_dashboard() FROM deliberate_delay;";
 const slowPair=(await sql(auth(homeQuery+slowHome))).split(/\r?\n/u).map(row=>JSON.parse(row));
 assert.equal(slowPair.length,2);
 assert.deepEqual(slowPair[0],slowPair[1],'HOME219_SLOWDOWN_LITERAL_JSON_PARITY');
 const negative=await measureHome219({name:'deliberate-server-slowdown-current219',query:auth(explain(slowHome)).replace('BEGIN;','BEGIN READ ONLY;'),json,evidenceKind:'negative-control'});
 assertHome219SamplesRejected(negative);report.realSlowdownNegative=negative;
 report.financialJsonExactlyEqual=true;report.originalSlowValuesRetained=true;
 assert.equal(await json(definitionQuery),currentDefinition,'HOME219_CURRENT_DEFINITION_UNCHANGED');
 await writeFile(path.join(output,'performance-report.json'),JSON.stringify(report,null,2)+'\n');
 stage='acceptance-current219';
 assert.ok(optimized.withinLimit,'FULL219_HOME_P95_EXCEEDS_EXISTING_3_SECOND_GATE');
 report.ok=true;
}catch(error){report.ok=false;report.stage=stage;report.error=error.message;process.exitCode=1;}
finally{
 const ok=await finishHome219Report({report,output,stop:async()=>{if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:1024**2});}});
 if(!ok)process.exitCode=1;
}
