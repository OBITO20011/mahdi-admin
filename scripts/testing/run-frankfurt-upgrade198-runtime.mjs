// Full owner-pipeline rehearsal; disposable Docker only, never hosted credentials.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile,mkdtemp,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {buildReady198Reference} from '../operations/build-acl-reference198.mjs';
import {readReady198Reference,ready198ReferenceName} from '../operations/frankfurt-reference198.mjs';
import {inputs198,upgrade198WithExecutor} from '../operations/frankfurt-owner-upgrade198.mjs';
import {executorFor} from '../operations/build-empty-supabase.mjs';
import {readNotificationSnapshot,transitionNotifications} from '../operations/frankfurt-notification-hold.mjs';
import {holdUpgradeGuard} from '../operations/frankfurt-owner-upgrade.mjs';
import {functionReference} from '../operations/frankfurt-owner-build.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-upgrade198-')),project='nawasrah-upgrade198-test',executor=executorFor(['--container','supabase_db_'+project]);
const report={startedAt:new Date().toISOString(),managedAccess:false,output};let local,guard,stage='build-reference198';
try{
 const filename=path.join(output,ready198ReferenceName);await buildReady198Reference(['--output',filename]);
 const reference=await readReady198Reference(root,filename);report.reference=filename;
 stage='bootstrap171';
 const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
  NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'171',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
  NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;
 const original=await readNotificationSnapshot(executor);await transitionNotifications(executor,original);
 for(const unit of await inputs198(reference))await copyFile(path.join(root,'supabase/migrations',unit.name),path.join(local,'supabase/migrations',unit.name));
 const cliCall=flags=>exec(process.execPath,[cli,...flags,'--local','--workdir',local,'--agent','no','--output-format','text'],{cwd:root,windowsHide:true,maxBuffer:8*1024**2});
 guard=await holdUpgradeGuard(executor);
 const options={executor,reference,original,repair:async version=>{guard.assertHeld();await cliCall(['migration','repair','--status','applied',version]);},
  finalDryRun:async()=>{await cliCall(['migration','list']);const r=await cliCall(['db','push','--dry-run','--skip-vault']);assert.match(r.stdout+r.stderr,/up to date/iu);}};
 stage='owner171-to198';
 const pipelineOutput=path.join(output,'pipeline');await mkdir(pipelineOutput);report.upgrade={};
 await upgrade198WithExecutor({...options,output:pipelineOutput,report:report.upgrade});
 assert.equal(report.upgrade.applied.length,12);assert.equal(report.upgrade.recorded.length,12);assert.equal(report.upgrade.catalogUnexpectedDifferenceCount,0);
 report.functions=await functionReference(executor,198);assert.equal(report.functions,511);
 stage='replay-no-writes';
 const replayOutput=path.join(output,'replay');await mkdir(replayOutput);report.replay={};
 await upgrade198WithExecutor({...options,output:replayOutput,report:report.replay});
 assert.deepEqual(report.replay.applied,[]);assert.deepEqual(report.replay.recorded,[]);assert.equal(report.replay.remoteWriteAttempted,false);
 report.ok=true;
}catch(error){report.ok=false;report.stage=stage;report.error=error.message;process.exitCode=1;}
finally{
 if(guard)await guard.close();
 if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:1024**2});
 report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
