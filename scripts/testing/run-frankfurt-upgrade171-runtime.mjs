// Same owner pipeline;all targets are disposable local Docker databases.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {schemaCatalogSql} from './schema-catalog.mjs';
import {buildReference171} from '../operations/build-acl-reference171.mjs';
import {readReference171,readyReference171Name,productVersions,assertProduct171Catalog} from '../operations/frankfurt-reference171.mjs';
import {upgrade171WithExecutor,inputs171,allUpgrade171Versions,offline171Plan} from '../operations/frankfurt-owner-upgrade171.mjs';
import {readNotificationSnapshot,transitionNotifications} from '../operations/frankfurt-notification-hold.mjs';
import {holdUpgradeGuard,historySql} from '../operations/frankfurt-owner-upgrade.mjs';
import {readRealtimePublication} from './realtime151-contract.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-upgrade171-')),report={startedAt:new Date().toISOString(),managedAccess:false,output};
const project='nawasrah-upgrade171-test',executor=executorFor(['--container','supabase_db_'+project]);let local,guard,stage='reference171';
const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
try{
 const referencePath=path.join(output,readyReference171Name);await buildReference171(['--output',referencePath]);
 const reference=await readReference171(root,referencePath);
 stage='bootstrap138';const b=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
  NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'138',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
  NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(b.stdout).isolatedProjectRoot;
 const original=await readNotificationSnapshot(executor);await transitionNotifications(executor,original);
 await sql(`GRANT SELECT,INSERT,UPDATE,DELETE ON public.units,public.orders,public.audit_logs TO anon,authenticated;
  GRANT SELECT,USAGE ON SEQUENCE public.cash_shift_number_seq TO anon,authenticated;
  GRANT EXECUTE ON FUNCTION public.authorize_admin_ai_assistant_request() TO anon;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;`);
 stage='offline-forecast';const initialCatalog=JSON.parse(await sql(schemaCatalogSql));
 const forecast=offline171Plan(reference,initialCatalog);assert.equal(forecast.notApplied,true);report.forecastCommands=forecast.commands;
 for(const unit of await inputs171(reference))await copyFile(path.join(root,'supabase/migrations',unit.name),path.join(local,'supabase/migrations',unit.name));
 const cliCall=flags=>exec(process.execPath,[cli,...flags,'--local','--workdir',local,'--agent','no','--output-format','text'],{cwd:root,windowsHide:true,maxBuffer:8*1024**2});
 const repair=async version=>{guard.assertHeld();await cliCall(['migration','repair','--status','applied',version]);};
 const finalDryRun=async()=>{await cliCall(['migration','list']);const r=await cliCall(['db','push','--dry-run','--skip-vault']);assert.match(r.stdout+r.stderr,/up to date/iu);};
 stage='owner-pipeline171';guard=await holdUpgradeGuard(executor);report.upgrade={};
 await upgrade171WithExecutor({executor,reference,original,output,repair,finalDryRun,report:report.upgrade});
 assert.deepEqual(report.upgrade.applied,allUpgrade171Versions);assert.deepEqual(report.upgrade.recorded,allUpgrade171Versions);
 assert.equal(report.upgrade.alignmentCommands,report.forecastCommands,'OFFLINE_FORECAST_EQUALS_ALL_ACTUAL_ALIGNMENT_PHASES');
 const catalog=JSON.parse(await sql(schemaCatalogSql));assertProduct171Catalog(catalog);
 const pub=await readRealtimePublication(executor);assert.deepEqual(JSON.parse(await sql(historySql)),reference.appliedVersions);
 stage='replay';const replayOutput=path.join(output,'replay');await mkdir(replayOutput);report.replay={};
 await upgrade171WithExecutor({executor,reference,original,output:replayOutput,repair:async()=>assert.fail('NO_REPLAY_REPAIR'),finalDryRun,report:report.replay});
 assert.deepEqual(report.replay.applied,[]);assert.equal(report.replay.remoteWriteAttempted,false);
 assert.deepEqual(JSON.parse(await sql(schemaCatalogSql)),catalog);assert.deepEqual(await readRealtimePublication(executor),pub);
 stage='recorded-prefix-definition-drift-must-fail-before-writes';
 await sql('ALTER TABLE public.product_cost_corrections DISABLE ROW LEVEL SECURITY;');
 const negativeOutput=path.join(output,'negative');await mkdir(negativeOutput);const negative={};
 await assert.rejects(()=>upgrade171WithExecutor({executor,reference,original,output:negativeOutput,repair:async()=>assert.fail('NO_REPAIR_ON_DRIFT'),
  finalDryRun:async()=>assert.fail('NO_DRY_ON_DRIFT'),report:negative}),/NON_ACL_APPLICATION_DRIFT/u);
 assert.equal(negative.remoteWriteAttempted,false);await sql('ALTER TABLE public.product_cost_corrections ENABLE ROW LEVEL SECURITY;');
 const details=JSON.parse(await readFile(path.join(negativeOutput,'preflight-prefix/catalog-differences.json'),'utf8'));
 assert.ok(details.differences.some(d=>d.object==='product_cost_corrections'&&d.local.rls===true&&d.remote.rls===false),'PREFIX_FAILURE_DETAILS_REQUIRED');
 report.ok=true;report.reference=referencePath;report.productApplied=productVersions;report.rpcOnly=true;report.replayZeroWrites=true;report.driftRejected=true;
}catch(error){report.ok=false;report.stage=stage;report.error=error.message;process.exitCode=1;}
finally{
 if(guard)await guard.close();if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true});
 report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
