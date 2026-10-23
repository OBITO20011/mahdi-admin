// Same owner upgrade pipeline,disposable local Docker only.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile,mkdir,mkdtemp,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {readReady211Reference} from '../operations/frankfurt-reference211.mjs';
import {upgrade211WithExecutor} from '../operations/frankfurt-owner-upgrade211.mjs';
import {readNotificationSnapshot,transitionNotifications} from '../operations/frankfurt-notification-hold.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const project='nawasrah-replacement-upgrade211-test',executor=executorFor(['--container','supabase_db_'+project]);
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-document-replacement-upgrade211-')),report={output,managedAccess:false,startedAt:new Date().toISOString()};let local;
try{
 assert.equal(process.argv.length,3,'LOCAL_REFERENCE_PATH_REQUIRED');const reference=await readReady211Reference(root,process.argv[2]);
 const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,
  env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'208',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
  NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;const original=await readNotificationSnapshot(executor);await transitionNotifications(executor,original);
 const cliCall=flags=>exec(process.execPath,[cli,...flags,'--local','--workdir',local,'--agent','no','--output-format','text'],{cwd:root,windowsHide:true,maxBuffer:8*1024**2});
 const run=async(name,ref=reference)=>{const dir=path.join(output,name);await mkdir(dir);const result={};
  await upgrade211WithExecutor({executor,reference:ref,original,output:dir,report:result,
   repair:async version=>{const unit=reference.manifest.find(m=>m.name.startsWith(version+'_'));await copyFile(path.join(root,'supabase/migrations',unit.name),path.join(local,'supabase/migrations',unit.name));await cliCall(['migration','repair','--status','applied',version]);},
   finalDryRun:async()=>{const r=await cliCall(['db','push','--dry-run','--skip-vault']);assert.match(r.stdout+r.stderr,/up to date/iu);}});return result;};
 report.upgrade=await run('apply');assert.deepEqual(report.upgrade.applied,['209','210','211']);assert.deepEqual(report.upgrade.recorded,['209','210','211']);assert.equal(report.upgrade.alignmentCommands,0);
 report.replay=await run('replay');assert.deepEqual(report.replay.applied,[]);assert.equal(report.replay.remoteWriteAttempted,false);
 const count=await executeInput(executor,'SELECT count(*) FROM supabase_migrations.schema_migrations;');assert.equal(count.stdout.trim(),'173');
 report.ok=true;
}catch(error){report.ok=false;report.error=error.message;process.exitCode=1;}
finally{if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true});report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,output,error:report.error,applied:report.upgrade?.applied,recorded:report.upgrade?.recorded,replayWrite:report.replay?.remoteWriteAttempted,managedAccess:false}));}
