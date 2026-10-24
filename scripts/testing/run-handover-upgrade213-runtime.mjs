// Same owner upgrade pipeline,disposable local Docker only.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile,mkdir,mkdtemp,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {readReady213Reference} from '../operations/frankfurt-reference213.mjs';
import {upgrade213WithExecutor} from '../operations/frankfurt-owner-upgrade213.mjs';
import {readNotificationSnapshot,transitionNotifications} from '../operations/frankfurt-notification-hold.mjs';
import {verify213ReadOnly} from '../operations/frankfurt-owner-upgrade213.mjs';
import {readOnlyPsqlSessionArgs} from '../operations/frankfurt-catalog-verification.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const project='nawasrah-replacement-upgrade213-test',executor=executorFor(['--container','supabase_db_'+project]);
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-document-replacement-upgrade213-')),report={output,managedAccess:false,startedAt:new Date().toISOString()};let local;
try{
 assert.equal(process.argv.length,3,'LOCAL_REFERENCE_PATH_REQUIRED');const reference=await readReady213Reference(root,process.argv[2]);
 const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,
  env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'212',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
  NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;const original=await readNotificationSnapshot(executor);await transitionNotifications(executor,original);
 const cliCall=flags=>exec(process.execPath,[cli,...flags,'--local','--workdir',local,'--agent','no','--output-format','text'],{cwd:root,windowsHide:true,maxBuffer:8*1024**2});
 const run=async(name,ref=reference)=>{const dir=path.join(output,name);await mkdir(dir);const result={};
  await upgrade213WithExecutor({executor,reference:ref,original,output:dir,report:result,
   repair:async version=>{const unit=reference.manifest.find(m=>m.name.startsWith(version+'_'));await copyFile(path.join(root,'supabase/migrations',unit.name),path.join(local,'supabase/migrations',unit.name));await cliCall(['migration','repair','--status','applied',version]);},
   finalDryRun:async()=>{const r=await cliCall(['db','push','--dry-run','--skip-vault']);assert.match(r.stdout+r.stderr,/up to date/iu);}});return result;};
 report.upgrade=await run('apply');assert.deepEqual(report.upgrade.applied,['213']);assert.deepEqual(report.upgrade.recorded,['213']);assert.equal(report.upgrade.alignmentCommands,0);
 report.replay=await run('replay');assert.deepEqual(report.replay.applied,[]);assert.equal(report.replay.remoteWriteAttempted,false);
 const count=await executeInput(executor,'SELECT count(*) FROM supabase_migrations.schema_migrations;');assert.equal(count.stdout.trim(),'175');
 const sql=async text=>{const r=await executeInput(executor,text);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
 const readonly={...executor,args:[...executor.args,...readOnlyPsqlSessionArgs]},dates={beforeBuildDate:reference.buildUtcDate,afterBuildDate:await sql("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;")};
 const verify=async name=>{const dir=path.join(output,name);await mkdir(dir);const result={};await verify213ReadOnly(readonly,dir,reference,original,dates,result);return result;};
 const before=await readApplicationFingerprint(executor);report.verify=await verify('strict-verify');assert.equal(report.verify.applicationAclComparison.differenceCount,0);assert.deepEqual(await readApplicationFingerprint(executor),before);
 const receipt=reference.catalog.functions.find(f=>f.schema==='public'&&f.identity.startsWith('get_public_pos_receipt('));
 await sql(`GRANT EXECUTE ON FUNCTION public.${receipt.identity} TO service_role;`);await assert.rejects(verify('negative-function-acl'),/APPLICATION_ACL_MISMATCH/);await sql(`REVOKE EXECUTE ON FUNCTION public.${receipt.identity} FROM service_role;`);
 await sql('GRANT TRUNCATE ON products TO anon;');await assert.rejects(verify('negative-table-acl'),/APPLICATION_ACL_MISMATCH|UNEXPECTED_APPLICATION_CATALOG_DIFFERENCES/);await sql('REVOKE TRUNCATE ON products FROM anon;');
 await sql('ALTER FUNCTION public.package_d_reject_pos_cancellation_mutation() RESET search_path;');await assert.rejects(verify('negative-search-path'),/UNEXPECTED_APPLICATION_CATALOG_DIFFERENCES/);await sql('ALTER FUNCTION public.package_d_reject_pos_cancellation_mutation() SET search_path=public,pg_temp;');
 report.finalVerify=await verify('final-strict-verify');assert.deepEqual(await readApplicationFingerprint(executor),before);report.strictAclNegatives=true;report.verifyZeroWrites=true;
 report.ok=true;
}catch(error){report.ok=false;report.error=error.message;process.exitCode=1;}
finally{if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true});report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,output,error:report.error,applied:report.upgrade?.applied,recorded:report.upgrade?.recorded,replayWrite:report.replay?.remoteWriteAttempted,managedAccess:false}));}
