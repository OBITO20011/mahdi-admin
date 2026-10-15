// Runs the REAL --verify-only branch with operator/transport I/O routed to a
// disposable bootstrap DB. No managed connection,CLI link,password or network.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {run,TARGET,functionReference} from '../operations/frankfurt-owner-build.mjs';
import {buildEmptyProjectInput,executeInput,executorFor} from '../operations/build-empty-supabase.mjs';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
import {readNotificationSnapshot,transitionNotifications} from '../operations/frankfurt-notification-hold.mjs';
import {assessBuildCron} from '../operations/build-cron-report.mjs';
import {readOnlyPsqlSessionArgs} from '../operations/frankfurt-catalog-verification.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile);
const project='nawasrah-frankfurt-verify-only-test',container='supabase_db_'+project;
const cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const evidence=await mkdtemp(path.join(tmpdir(),'nawasrah-verify-runtime-'));
const workdir=path.join(evidence,'owner-workdir'),report={startedAt:new Date().toISOString(),evidence,productionAccess:false};
let local,stage='bootstrap';
const readCatalog=async executor=>{const r=await executeInput(executor,schemaCatalogSql);assert.equal(r.code,0);return JSON.parse(r.stdout.trim());};
try{
 const {stdout}=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
  NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'138',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
  NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(stdout).isolatedProjectRoot;
 const executor=executorFor(['--container',container]);
 const catalog=await readCatalog(executor),snapshot=await readNotificationSnapshot(executor);
 const date=await executeInput(executor,"SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;");assert.equal(date.code,0);
 const reference={manifest:(await buildEmptyProjectInput(root)).manifest,postgresVersion:'17.6',buildUtcDate:date.stdout.trim(),
  catalogQuerySha256:createHash('sha256').update(schemaCatalogSql).digest('hex'),catalog,
  functions:await functionReference(executor),notificationSnapshot:snapshot,cronAudit:assessBuildCron(snapshot.jobs)};
 await mkdir(path.join(workdir,'supabase/.temp'),{recursive:true});
 await writeFile(path.join(workdir,'local-reference.json'),JSON.stringify(reference));
 await writeFile(path.join(workdir,'notification-before.json'),JSON.stringify(snapshot));
 await writeFile(path.join(workdir,'supabase/.temp/project-ref'),TARGET.id);
 await writeFile(path.join(workdir,'supabase/.temp/pooler-url'),'postgresql://postgres.'+TARGET.id+'@aws-0-eu-central-1.pooler.supabase.com:5432/postgres');
 const originalBuildReport='{"preserveOriginalBuildReport":true}\n';
 await writeFile(path.join(workdir,'last-report.json'),originalBuildReport);
 stage='hold-fixture';await transitionNotifications(executor,snapshot);
 const heldBefore=await readCatalog(executor),stateBefore=await readNotificationSnapshot(executor);
 let prompts=0,connections=0;
 const io={readProjects:async()=>[{...TARGET,status:'ACTIVE_HEALTHY',database:{version:'17.6',postgres_engine:'17'},created_at:reference.buildUtcDate+'T00:00:00Z'}],
  confirmTarget:async()=>{prompts++;},readPassword:async()=>{prompts++;return 'runtime-only-fixture';},
  executor:(connection,env)=>{
   connections++;assert.equal(connection[5],'postgres.'+TARGET.id);assert.equal(env.PGOPTIONS,undefined);
   return {command:'docker',args:['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1',...readOnlyPsqlSessionArgs],env};
  }};
 stage='verify-only-real-branch';
 const verified=await run(['--verify-only','--workdir',workdir],io);
 assert.equal(verified.ok,true,JSON.stringify({stage:verified.stage,error:verified.error}));
 assert.equal(verified.mode,'verify-only');assert.equal(verified.readOnly,true);assert.equal(verified.remoteWrites,false);
 assert.equal(verified.linkPerformed,false);assert.deepEqual(verified.applied,[]);assert.deepEqual(verified.recorded,[]);
 assert.equal(verified.catalogDifferences.length,1);assert.equal(verified.catalogDifferences[0].expected,true);
 assert.equal(verified.notificationComparison.expectedChanges.length,5);assert.deepEqual(verified.notificationComparison.differences,[]);
 assert.deepEqual(catalogDifference(heldBefore,await readCatalog(executor)),[]);assert.deepEqual(await readNotificationSnapshot(executor),stateBefore);
 assert.equal(await readFile(path.join(workdir,'last-report.json'),'utf8'),originalBuildReport);
 assert.ok(!(await readFile(path.join(workdir,'last-verify-report.json'),'utf8')).includes('runtime-only-fixture'));
 report.positive={ok:true,expectedCatalogDelta:1,expectedNotificationBits:5,catalogAndSchedulerUnchanged:true,originalBuildReportPreserved:true};
 stage='read-only-negative-write';
 const roEnv={...process.env};delete roEnv.PGOPTIONS;
 const ro=io.executor(['','','','','','postgres.'+TARGET.id],roEnv);
 const denied=await executeInput(ro,'CREATE TABLE public.verify_write_must_fail(id integer);');
 assert.notEqual(denied.code,0);assert.match(denied.stderr,/read-only/iu);report.writeGuard=true;
 stage='injected-local-difference';
 const changed=await executeInput(executor,'ALTER TABLE public.products ADD COLUMN verify_evidence_probe integer;');assert.equal(changed.code,0);
 const negativeBefore=await readCatalog(executor);
 const mismatch=await run(['--verify-only','--workdir',workdir],io);
 assert.equal(mismatch.ok,false);assert.equal(mismatch.error,'HOLD_CATALOG_EXPECTS_EXACTLY_ONE_DELTA');
 const saved=JSON.parse(await readFile(path.join(workdir,'catalog-differences.json'),'utf8'));
 assert.equal(saved.differences.length,2);assert.equal(saved.differences.filter(d=>d.expected).length,1);
 const table=saved.differences.find(d=>d.schema==='public'&&d.object==='products');
 assert.ok(table);assert.equal(table.type,'tables');
 assert.ok(!table.local.columns.some(c=>c.name==='verify_evidence_probe'));assert.ok(table.remote.columns.some(c=>c.name==='verify_evidence_probe'));
 assert.deepEqual(saved.differences,mismatch.catalogDifferences);assert.deepEqual(saved.notificationComparison.differences,[]);
 assert.deepEqual(catalogDifference(negativeBefore,await readCatalog(executor)),[]);assert.deepEqual(await readNotificationSnapshot(executor),stateBefore);
 assert.equal(await readFile(path.join(workdir,'last-report.json'),'utf8'),originalBuildReport);
 assert.equal(prompts,4);assert.equal(connections,3); // Two verify sessions + negative write guard.
 report.negative={unexpectedDeltaDetected:true,allDetailsPersisted:true,catalogAndSchedulerUnchanged:true};
 report.ok=true;
}catch(error){report.ok=false;report.stage=stage;report.error=error.code==='ERR_ASSERTION'?error.message:'VERIFY_RUNTIME_FAILED';process.exitCode=1;}
finally{
 if(local)try{await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true});report.cleanup='owned-stack-stopped-no-backup';}
 catch{report.ok=false;report.cleanup='FAILED';process.exitCode=1;}
 report.endedAt=new Date().toISOString();await writeFile(path.join(evidence,'runtime-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
