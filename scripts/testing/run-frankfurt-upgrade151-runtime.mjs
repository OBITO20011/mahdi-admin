// Owner command rehearsal: Docker138 -> literal139/150/151 -> official history
// -> exact ACL alignment -> read-only catalog/publication verification.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {schemaCatalogSql} from './schema-catalog.mjs';
import {readReference151,readyReference151Name} from '../operations/frankfurt-reference151.mjs';
import {buildReference151} from '../operations/build-acl-reference151.mjs';
import {readNotificationSnapshot,transitionNotifications} from '../operations/frankfurt-notification-hold.mjs';
import {upgradeWithExecutor,upgradeInputs,historySql,holdUpgradeGuard} from '../operations/frankfurt-owner-upgrade.mjs';
import {generateAclPlan,alignmentTransaction} from '../operations/frankfurt-acl-plan.mjs';
import {readRealtimePublication} from './realtime151-contract.mjs';
import {verifyCatalogReadOnly} from '../operations/frankfurt-catalog-verification.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-upgrade151-')),report={startedAt:new Date().toISOString(),managedAccess:false,output};
const project='nawasrah-upgrade151-test';let local,guard,stage='local-reference151';
try{
 const referencePath=path.join(output,readyReference151Name);
 await buildReference151(['--output',referencePath]);
 const reference=await readReference151(root,referencePath);
 stage='bootstrap138';
 const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
  NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'138',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
  NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;const executor=executorFor(['--container','supabase_db_'+project]);
 const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,'REHEARSAL_SQL_FAILED');return r.stdout.trim();};
 const catalog=async()=>JSON.parse(await sql(schemaCatalogSql));
 const original=await readNotificationSnapshot(executor);await transitionNotifications(executor,original);
 stage='managed-acl-fixture';
 // Controlled extra-grant categories from the owner's saved snapshot; never
 // import credentials,tenant data or execute a saved function definition.
 await sql(`GRANT SELECT,INSERT,UPDATE,DELETE ON public.units,public.orders,public.audit_logs TO anon,authenticated;
 GRANT SELECT,USAGE ON SEQUENCE public.cash_shift_number_seq TO anon,authenticated;
 GRANT EXECUTE ON FUNCTION public.authorize_admin_ai_assistant_request() TO anon;
 ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;
 ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;`);
 for(const unit of await upgradeInputs(reference))await copyFile(path.join(root,'supabase/migrations',unit.name),path.join(local,'supabase/migrations',unit.name));
 const cliCall=flags=>exec(process.execPath,[cli,...flags,'--local','--workdir',local,'--agent','no','--output-format','text'],{cwd:root,windowsHide:true,maxBuffer:8*1024**2});
 const repair=async version=>{guard.assertHeld();await cliCall(['migration','repair','--status','applied',version]);};
 const finalDryRun=async()=>{await cliCall(['migration','list']);const r=await cliCall(['db','push','--dry-run','--skip-vault']);assert.match(r.stdout+r.stderr,/up to date/iu);};
 stage='owner-pipeline';report.upgrade={};
 guard=await holdUpgradeGuard(executor);guard.assertHeld();
 await upgradeWithExecutor({executor,reference,original,output,repair,finalDryRun,report:report.upgrade});
 assert.deepEqual(report.upgrade.applied,['139','150','151']);assert.deepEqual(report.upgrade.recorded,['139','150','151']);
 assert.equal(report.upgrade.catalogUnexpectedDifferenceCount,0);assert.equal(report.upgrade.realtimeMembers,13);
 report.outerGuardHeldDuringAlignment=true;
 stage='replay-no-writes';const before=await catalog(),pub=await readRealtimePublication(executor);
 const replayOutput=path.join(output,'replay');await mkdir(replayOutput);report.replay={};
 await upgradeWithExecutor({executor,reference,original,output:replayOutput,repair:async()=>assert.fail('NO_REPLAY_REPAIR'),finalDryRun,report:report.replay});
 assert.deepEqual(report.replay.applied,[]);assert.equal(report.replay.remoteWriteAttempted,false);
 assert.deepEqual(await catalog(),before);assert.deepEqual(await readRealtimePublication(executor),pub);
 stage='publication-negative-control';
 await sql('ALTER PUBLICATION supabase_realtime DROP TABLE public.orders;');
 const negativeOutput=path.join(output,'negative');await mkdir(negativeOutput);const negative={};
 await assert.rejects(()=>verifyCatalogReadOnly(executor,negativeOutput,reference,original,{beforeBuildDate:reference.buildUtcDate,afterBuildDate:reference.buildUtcDate},negative),/REALTIME_PUBLICATION_MISMATCH/u);
 const evidence=JSON.parse(await readFile(path.join(negativeOutput,'realtime-comparison.json'),'utf8'));
 assert.ok(evidence.differences.length>0);report.publicationDriftRejectedAndPersisted=true;
 await sql('ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;');
 stage='missing-139-fails-before-align';
 const finalPlan=generateAclPlan(reference.catalog,await catalog());
 assert.throws(()=>alignmentTransaction({...finalPlan,prerequisites:[{identity:'pending139'}]}));
 assert.deepEqual(JSON.parse(await sql(historySql)),reference.appliedVersions);
 report.ok=true;
}catch(error){report.ok=false;report.stage=stage;report.error=error.code==='ERR_ASSERTION'?error.message:'UPGRADE151_REHEARSAL_FAILED';process.exitCode=1;}
finally{
 if(guard)await guard.close();
 if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true});
 report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({ok:report.ok,stage:report.stage,error:report.error,output,startedAt:report.startedAt,endedAt:report.endedAt,
  applied:report.upgrade?.applied,recorded:report.upgrade?.recorded,alignmentCommands:report.upgrade?.alignmentCommands,
  replayWrite:report.replay?.remoteWriteAttempted,publicationDriftRejectedAndPersisted:report.publicationDriftRejectedAndPersisted}));
}
