// Quarantined prototype only: no target arguments, URLs, env files or hosted CLI.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {project,container,localContext} from './sales-only-phase1-context.mjs';
import {verifyPhase1} from './sales-only-phase1-runtime.mjs';
import {readVerificationSourceFreeze,assertVerificationSourceFreeze} from './verification-source-freeze.mjs';
import {assertFrozenSource} from './sales-only-phase1-freeze.mjs';

assert.equal(process.argv.length,2,'NO_TARGET_OR_RESUME_ARGUMENTS_ALLOWED');
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile);
const cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const output=path.join(root,'test-results/sales-only-phase1');await mkdir(output,{recursive:true});
const report={ok:false,startedAt:new Date().toISOString(),hostedAccess:false,activeMigrationCeiling:219,activeMigrationFiles:180,cases:[]};
let local,ownedId;
const docker=(...args)=>exec('docker',args,{cwd:root,windowsHide:true,maxBuffer:32*1024**2});
try {
 assertFrozenSource();
 const sourceFreeze=await readVerificationSourceFreeze(root);
 const boot=await exec(process.execPath,['scripts/testing/bootstrap-isolated-supabase.mjs'],{cwd:root,windowsHide:true,maxBuffer:32*1024**2,env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'219',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 const info=JSON.parse(boot.stdout);assert.equal(info.isolatedProjectId,project);local=info.isolatedProjectRoot;
 const inspected=JSON.parse((await docker('inspect',container)).stdout)[0];ownedId=inspected.Id;
 const canonical=p=>path.resolve(p).replaceAll('\\','/');
 assert.equal(canonical(inspected.Config.Labels['com.supabase.cli.workdir']),canonical(local),'BOOTSTRAP_WORKDIR_OWNERSHIP');
 for(const network of Object.keys(inspected.NetworkSettings.Networks))await docker('network','disconnect',network,container);
 const c=localContext(ownedId);report.networkAttachments=0;
 await c.sql('SELECT cron.alter_job(jobid,active:=false) FROM cron.job;ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;');
 await c.sql(await readFile(new URL('./package-e-golden-day-fixture.sql',import.meta.url),'utf8'));
 await c.rpc(`set_go_live_main_branch_v1(${c.q(c.id(200))})`);
 await verifyPhase1(c,report);
 assertFrozenSource();
 assertVerificationSourceFreeze(sourceFreeze,await readVerificationSourceFreeze(root));
 report.sourceFreeze={fileCount:sourceFreeze.fileCount,sha256:sourceFreeze.sha256};report.ok=true;
} catch(error) {
 report.failureCode=error.code??'PHASE1_VERIFICATION_FAILED';
 // Synthetic test diagnostic only; no env/credentials or external payloads.
 console.error(String(error.message).slice(0,5000));process.exitCode=1;
} finally {
 if(local&&ownedId){
  try{
   // If the engine is unavailable, leave its owned volume intact and STOP.
   await docker('version','--format','{{.Server.Version}}');
   const inspected=JSON.parse((await docker('inspect',container)).stdout)[0];assert.equal(inspected.Id,ownedId);assert.equal(inspected.Config.Labels['com.supabase.cli.project'],project);
   await exec(process.execPath,[cli,'stop','--workdir',local,'--no-backup'],{cwd:root,windowsHide:true,maxBuffer:8*1024**2});
   report.cleanup=true;
  }catch{report.cleanup=false;report.ok=false;report.cleanupNeedsOwner=true;process.exitCode=1;}
 }
 report.finishedAt=new Date().toISOString();report.elapsedSeconds=(Date.parse(report.finishedAt)-Date.parse(report.startedAt))/1000;
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({ok:report.ok,cases:report.cases.length,cleanup:report.cleanup,report:'test-results/sales-only-phase1/report.json'}));
}
