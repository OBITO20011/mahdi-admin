// Actual owner217 pipeline on disposable Docker,including strict negative ACL,
// owner/search_path/cron and read-only checks. No hosted configuration loaded.
import assert from 'node:assert/strict';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {writeFile,mkdir,mkdtemp,copyFile} from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {readReady217Reference} from '../operations/frankfurt-reference217.mjs';import {upgrade217WithExecutor,verify217ReadOnly} from '../operations/frankfurt-owner-upgrade217.mjs';
import {readNotificationSnapshot,transitionNotifications} from '../operations/frankfurt-notification-hold.mjs';import {readOnlyPsqlSessionArgs} from '../operations/frankfurt-catalog-verification.mjs';import {readApplicationFingerprint} from './backup-restore-contract.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),cli=path.join(root,'node_modules/supabase/dist/supabase.js'),project='nawasrah-owner-upgrade217-test',executor=executorFor(['--container','supabase_db_'+project]);
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-owner-upgrade217-')),report={output,hostedAccess:false,ok:false};let local,stage='reference';
try{
 assert.equal(process.argv.length,3);const reference=await readReady217Reference(root,process.argv[2]);
 const boot=await exec(process.execPath,['scripts/testing/bootstrap-isolated-supabase.mjs'],{cwd:root,windowsHide:true,maxBuffer:16*1024**2,env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'216',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});local=JSON.parse(boot.stdout).isolatedProjectRoot;
 const original=await readNotificationSnapshot(executor);await transitionNotifications(executor,original);
 const sql=async(input,ex=executor)=>{const r=await executeInput(ex,input);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
 const cliCall=flags=>exec(process.execPath,[cli,...flags,'--local','--workdir',local,'--agent','no','--output-format','text'],{cwd:root,windowsHide:true,maxBuffer:8*1024**2});
 const run=async name=>{const dir=path.join(output,name);await mkdir(dir);return upgrade217WithExecutor({executor,reference,original,output:dir,report:{},repair:async version=>{const unit=reference.manifest.find(m=>m.name.startsWith(version+'_'));await copyFile(path.join(root,'supabase/migrations',unit.name),path.join(local,'supabase/migrations',unit.name));await cliCall(['migration','repair','--status','applied',version]);},finalDryRun:async()=>{const r=await cliCall(['db','push','--dry-run','--skip-vault']);assert.match(r.stdout+r.stderr,/up to date/iu);}});};
 stage='apply';report.apply=await run('apply');assert.deepEqual(report.apply.applied,['217']);assert.deepEqual(report.apply.recorded,['217']);assert.equal(report.apply.alignmentCommands,0);
 stage='replay';const unchanged=await readApplicationFingerprint(executor);report.replay=await run('replay');assert.deepEqual(report.replay.applied,[]);assert.equal(report.replay.remoteWriteAttempted,false);assert.deepEqual(await readApplicationFingerprint(executor),unchanged);assert.equal(await sql('SELECT count(*) FROM supabase_migrations.schema_migrations;'),'179');
 const readonly={...executor,args:[...executor.args,...readOnlyPsqlSessionArgs]},dates={beforeBuildDate:reference.buildUtcDate,afterBuildDate:await sql("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;")};
 const verify=async name=>{const dir=path.join(output,name);await mkdir(dir);const result={};await verify217ReadOnly(readonly,dir,reference,original,dates,result);return result;};
 report.strict=await verify('strict');assert.equal(report.strict.applicationAclComparison.differenceCount,0);assert.deepEqual(await readApplicationFingerprint(executor),unchanged);
 const negatives=[
  ['function-acl','GRANT EXECUTE ON FUNCTION public.get_public_pos_receipt(text) TO service_role;','REVOKE EXECUTE ON FUNCTION public.get_public_pos_receipt(text) FROM service_role;',/APPLICATION_ACL_MISMATCH|UNEXPECTED_APPLICATION_CATALOG_DIFFERENCES/u],
  ['table-acl','GRANT TRUNCATE ON public.products TO anon;','REVOKE TRUNCATE ON public.products FROM anon;',/APPLICATION_ACL_MISMATCH|UNEXPECTED_APPLICATION_CATALOG_DIFFERENCES/u],
  ['private-column','GRANT SELECT(run_id) ON public.owner_telegram_dispatch_settings TO authenticated;','REVOKE SELECT(run_id) ON public.owner_telegram_dispatch_settings FROM authenticated;',/APPLICATION_ACL_MISMATCH|UNEXPECTED_APPLICATION_CATALOG_DIFFERENCES/u],
  ['private-leaf','GRANT EXECUTE ON FUNCTION public.owner217_claim_deliveries_internal(text,integer,integer) TO service_role;','REVOKE EXECUTE ON FUNCTION public.owner217_claim_deliveries_internal(text,integer,integer) FROM service_role;',/APPLICATION_ACL_MISMATCH|UNEXPECTED_APPLICATION_CATALOG_DIFFERENCES/u],
  ['path','ALTER FUNCTION public.release_owner_telegram_dispatch_v1(uuid) RESET search_path;','ALTER FUNCTION public.release_owner_telegram_dispatch_v1(uuid) SET search_path=public,pg_temp;',/UNEXPECTED_APPLICATION_CATALOG_DIFFERENCES/u],
  ['enabled-setting','UPDATE public.owner_telegram_dispatch_settings SET enabled=true;','UPDATE public.owner_telegram_dispatch_settings SET enabled=false;',/OWNER217_SETTINGS_MUST_REMAIN_HELD/u],
  ['cron-active',"SELECT cron.alter_job(jobid,active:=true) FROM cron.job WHERE jobname='owner-telegram-dispatch';","SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='owner-telegram-dispatch';",/OWNER217_CRON_MUST_REMAIN_EXACT_AND_HELD/u],
  ['extra-cron',"SELECT cron.schedule('unexpected217-test','* * * * *','SELECT 1;');SELECT cron.alter_job(jobid,active:=false)FROM cron.job WHERE jobname='unexpected217-test';","SELECT cron.unschedule(jobid)FROM cron.job WHERE jobname='unexpected217-test';",/NOTIFICATION_STATE_MISMATCH/u],
 ];report.negatives=[];
 for(const [name,mutate,undo,pattern]of negatives){stage='negative-'+name;await sql(mutate);await assert.rejects(verify('negative-'+name),pattern);await sql(undo);report.negatives.push(name);}
 const denied=await executeInput(readonly,'CREATE TABLE public.readonly217_should_fail(id integer);');assert.notEqual(denied.code,0);assert.match(denied.stderr,/read.only/iu);assert.equal(await sql("SELECT to_regclass('public.readonly217_should_fail') IS NULL;"),'t');
 await verify('final');assert.deepEqual(await readApplicationFingerprint(executor),unchanged);Object.assign(report,{ok:true,readOnlySessionActuallyEnforced:true,allOriginalDataAndSequencesUnchangedOnReplayAndVerify:true});
}catch(error){Object.assign(report,{stage,error:error.message});throw error;}
finally{if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:8*1024**2});await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
