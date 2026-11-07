// No connection URL/options. Creates one named disposable219 database itself.
import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SnapshotSession} from '../backup/snapshot-session.mjs';
import {assertCounts} from './package-e-scale-contract.mjs';
import {proveDraft220} from './posthandover220-proof.mjs';
assert.deepEqual(process.argv.slice(2),['--isolated-draft220'],'EXPLICIT_QUARANTINED_LOCAL_PREVIEW_ONLY');
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),project='nawasrah-posthandover220-test',container='supabase_db_'+project;
const output=await mkdtemp(path.join(process.env.RUNNER_TEMP??tmpdir(),'nawasrah-draft220-')),params={skus:3000,families:120,customers:500,suppliers:30,orders:50000,modern:100,receipts:4000,payments:20000,legacy_returns:1000,shifts:730,movements:200000,days:365};
const id=(k,n)=>`929${String(k).padStart(5,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`,owner=id(1,1),branch=id(10,2);
const report={output,params,hostedAccess:false,activeCeiling:219,activeMigrationFiles:180};let local,containerId;
const inspect=async()=>JSON.parse((await exec('docker',['inspect',container],{windowsHide:true})).stdout)[0];
const own=async()=>{assert.ok(containerId);assert.equal((await inspect()).Id,containerId,'DRAFT220_REQUIRES_OWN_CREATED_CONTAINER');};
const args=['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-At','-w','-v','ON_ERROR_STOP=1'];
const sql=async(text,variables={})=>{await own();return new Promise((resolve,reject)=>{const p=spawn('docker',[...args,...Object.entries(variables).flatMap(([k,v])=>['-v',k+'='+v])],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';p.stdout.on('data',s=>out+=s);p.stderr.on('data',s=>err+=s);p.on('error',reject);p.on('close',code=>code===0?resolve(out.trim()):reject(Error('LOCAL_DRAFT220_SQL_FAILED:'+err.slice(-3000))));p.stdin.end(text);});};
const claims=`SELECT set_config('request.jwt.claims','${JSON.stringify({sub:owner,role:'authenticated',aal:'aal2'})}',true);SET LOCAL ROLE authenticated;`;
try{
 assert.equal((await exec('docker',['ps','-aq','--filter','name=^/'+container+'$'],{windowsHide:true})).stdout.trim(),'','EXISTING_CONTAINER_MUST_NOT_BE_REUSED');
 const boot=await exec(process.execPath,['scripts/testing/bootstrap-isolated-supabase.mjs'],{cwd:root,windowsHide:true,maxBuffer:16*1024**2,env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'219',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;containerId=(await inspect()).Id;
 await sql("SELECT cron.alter_job(jobid,active:=false) FROM cron.job;ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;ALTER ROLE authenticated SET statement_timeout='8s';ALTER ROLE anon SET statement_timeout='3s';");
 const raw=await readFile(path.join(root,'scripts/testing/package-e-scale-fixture.sql'),'utf8'),[setup,rest]=raw.split('-- E2_BATCH_BEGIN'),[batch,finish]=rest.split('-- E2_BATCH_END');assert.ok(setup&&batch&&finish);
 const batches=[];for(let from=1;from<=params.modern;from+=100)batches.push('BEGIN;'+claims+batch.replaceAll('__E2_FROM__',String(from)).replaceAll('__E2_TO__',String(Math.min(from+99,params.modern)))+'COMMIT;');
 await sql(setup+batches.join('\n')+finish,params);
 const counts=JSON.parse(await sql("SELECT jsonb_build_object('skus',(SELECT count(*) FROM products WHERE NOT is_flavor_master),'families',(SELECT count(*) FROM products WHERE is_flavor_master),'customers',(SELECT count(*) FROM customers),'suppliers',(SELECT count(*) FROM suppliers),'orders',(SELECT count(*) FROM orders),'items',(SELECT count(*) FROM order_items),'receipts',(SELECT count(*) FROM supplier_receipts)+(SELECT count(*) FROM purchase_receipts),'payments',(SELECT count(*) FROM customer_payments),'returns',(SELECT count(*) FROM sales_returns)+(SELECT count(*) FROM sales_return_events),'replacements',(SELECT count(*) FROM sales_replacement_events WHERE issuance_status='issued'),'shifts',(SELECT count(*) FROM cash_shifts),'movements',(SELECT count(*) FROM inventory_movements));"));assertCounts(counts,params);report.counts=counts;
 const record=async proof=>{report.proof=proof;await writeFile(path.join(output,'proof220.json'),JSON.stringify(report,null,2)+'\n');};
 await proveDraft220({root,session:async()=>{await own();return new SnapshotSession('docker',args);},owner,branch,id,record});report.ok=true;
}catch(e){report.ok=false;report.error=e.message;process.exitCode=1;console.error(report.error);}
finally{
 if(local){await own();await exec(process.execPath,['node_modules/supabase/dist/supabase.js','stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:4*1024**2});report.databaseStopped=true;}
 await writeFile(path.join(output,'proof220.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,output,activeCeiling:219,summary:report.proof?.summary}));
}
