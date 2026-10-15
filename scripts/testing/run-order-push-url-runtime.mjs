import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {executeInput,executorFor} from '../operations/build-empty-supabase.mjs';
import {read139Input,apply139} from '../operations/frankfurt-migration139.mjs';
import {readNotificationSnapshot,transitionNotifications} from '../operations/frankfurt-notification-hold.mjs';
import {functionReference} from '../operations/frankfurt-owner-build.mjs';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile);
const project='nawasrah-order-push139-test',container='supabase_db_'+project;
const cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const evidence=await mkdtemp(path.join(tmpdir(),'nawasrah-push139-'));
const report={startedAt:new Date().toISOString(),evidence,productionAccess:false};
let local,stage='bootstrap138';
try{
 const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
  NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'138',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
  NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;
 const executor=executorFor(['--container',container]);
 await functionReference(executor,138);
 const original=await readNotificationSnapshot(executor);await transitionNotifications(executor,original);
 const held=await readNotificationSnapshot(executor),unit=await read139Input(root);
 await copyFile(path.join(root,'supabase/migrations',unit.name),path.join(local,'supabase/migrations',unit.name));
 stage='apply139-preserve-hold';
 report.application={};
 await apply139(executor,unit,async()=>{await exec(process.execPath,[cli,'migration','repair','139','--status','applied','--local','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:4*1024**2});},report.application);
 assert.deepEqual(await readNotificationSnapshot(executor),held);
 // Runtime enables only the disposable local fixture trigger,not managed state.
 const enabled=await executeInput(executor,'ALTER TABLE public.orders ENABLE TRIGGER trg_notify_new_website_order_push;');assert.equal(enabled.code,0);
 stage='probe';
 const beforeProbe=await executeInput(executor,schemaCatalogSql);assert.equal(beforeProbe.code,0);
 // Only the test transaction's extension stub needs its actual owner. The SQL
 // SET LOCAL ROLE postgres preserves the real application-probe privilege.
 const fixtureExecutor={...executor,args:[...executor.args]};
 fixtureExecutor.args[fixtureExecutor.args.indexOf('-U')+1]='supabase_admin';
 const probes=await executeInput(fixtureExecutor,await readFile(path.join(root,'scripts/testing/order-push-url-runtime.sql')));
 assert.equal(probes.code,0,'PUSH139_PROBE_FAILED:'+probes.stderr);
 report.probes=JSON.parse(probes.stdout.trim());assert.equal(report.probes.length,6);assert.ok(report.probes.every(p=>p.passed));
 const afterProbe=await executeInput(executor,schemaCatalogSql);assert.equal(afterProbe.code,0);
 assert.deepEqual(catalogDifference(JSON.parse(beforeProbe.stdout.trim()),JSON.parse(afterProbe.stdout.trim())),[],'PROBE_MUST_RESTORE_FULL_CATALOG');
 report.probeCatalogUnchanged=true;
 stage='rollback-proof';
 const clean=await executeInput(executor,"SELECT jsonb_build_object('orders',(SELECT count(*) FROM public.orders),'queue',(SELECT count(*) FROM net.http_request_queue),'url',(SELECT count(*) FROM vault.secrets WHERE name='order_push_webhook_url'));");
 assert.equal(clean.code,0);assert.deepEqual(JSON.parse(clean.stdout.trim()),{orders:0,queue:0,url:0});
 report.noHttpDispatched=true;report.functions=await functionReference(executor,139);
 stage='acl';
 for(const role of ['anon','authenticated','service_role']){
  const denied=await executeInput(executor,`SET ROLE ${role};SELECT public.enqueue_order_push_webhook('{}'::jsonb);`);
  assert.notEqual(denied.code,0);assert.match(denied.stderr,/permission denied for function enqueue_order_push_webhook/u);
 }
 report.deniedRoles=['anon','authenticated','service_role'];
 const refs=await executeInput(executor,"BEGIN READ ONLY;SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN('f','p','w') AND position('acjtabdqqnpwhdvbvnyw' IN pg_get_functiondef(p.oid))>0;ROLLBACK;");
 assert.equal(refs.code,0);assert.equal(refs.stdout.trim(),'0');report.currentOldProjectReferences=0;
 report.ok=true;
}catch(error){report.ok=false;report.stage=stage;report.error=error.code==='ERR_ASSERTION'?error.message:'PUSH139_RUNTIME_FAILED';process.exitCode=1;}
finally{
 if(local)try{await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true});report.cleanup='owned-stack-stopped';}
 catch{report.cleanup='FAILED';process.exitCode=1;report.ok=false;}
 report.endedAt=new Date().toISOString();await writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}
