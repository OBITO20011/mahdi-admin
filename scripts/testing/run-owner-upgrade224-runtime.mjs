import {startInventory224Local} from './inventory224-local.mjs';
import {frankfurt220TriggerAclFixtureSql,frankfurt220TriggerAclReadSql} from './frankfurt220-trigger-acl-fixture.mjs';
import {frozen220TriggerAclProfile} from '../operations/frozen220-trigger-acl.mjs';
// One owned Docker223 source,real owner224 pipeline,encrypted backups and strict Restore.
// No hosted URL,credentials or external transport is accepted.
// Official history repair has a direct local SQL transport after network detach.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile,readFile,mkdir,mkdtemp,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {performance} from 'node:perf_hooks';
import {SnapshotSession} from '../backup/snapshot-session.mjs';
import {createCompleteBackup,restoreCompleteBackup} from '../backup/complete-backup.mjs';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {readReady224Reference} from '../operations/frankfurt-reference224.mjs';
import {read224SourceEvidence,upgrade224WithExecutor,run224} from '../operations/frankfurt-owner-upgrade224.mjs';
import {checkRegistration224,pending224Registration} from '../operations/upgrade224-registration.mjs';
import {read224BackupEvidence,assert224ProtectionComplete} from '../operations/upgrade224-protection.mjs';
import {readOnlyPsqlSessionArgs} from '../operations/frankfurt-catalog-verification.mjs';
import {cutoverHoldWithExecutor} from '../operations/frankfurt-owner-cutover-hold224.mjs';
import {readNotificationSnapshot} from '../operations/frankfurt-notification-hold.mjs';
import {upgrade220ServerBindingSql} from '../operations/upgrade220-runtime-state.mjs';
import {manifestDigest,sha256} from './maintenance-db-contract.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile);
const project='nawasrah-owner-upgrade224-test',container='supabase_db_'+project,executor=executorFor(['--container',container]);
const output=await mkdtemp(path.join(process.env.RUNNER_TEMP??tmpdir(),'nawasrah-owner-upgrade224-')),report={output,hostedAccess:false,ok:false,timings:{}};
let local,stage='reference',containerId,stopOwned;
const sql=async(input,ex=executor)=>{const r=await executeInput(ex,input);assert.equal(r.code,0,'LOCAL_OWNER224_SQL_FAILED:'+r.stderr.slice(-400));return r.stdout.trim();};
const owned=async()=>{assert.ok(containerId);const value=JSON.parse((await exec('docker',['inspect',container],{windowsHide:true})).stdout)[0];assert.equal(value.Id,containerId,'OWNER224_OWNED_SOURCE_REQUIRED');};
const timed=async(name,run)=>{const start=performance.now();try{return await run();}finally{report.timings[name]=Math.round(performance.now()-start);}};
const save=async(name,value)=>{const file=path.join(output,name);await writeFile(file,JSON.stringify(value,null,2)+'\n');return file;};
const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const claims=`SELECT set_config('request.jwt.claims','${JSON.stringify({sub:id(1),role:'authenticated',aal:'aal2'})}',true);SET LOCAL ROLE authenticated;`;
try{
 assert.equal(process.argv.length,3,'LOCAL224_REFERENCE_REQUIRED');const reference=await readReady224Reference(root,process.argv[2]);
 assert.equal((await exec('docker',['ps','-aq','--filter','name=^/'+container+'$'],{windowsHide:true})).stdout.trim(),'','OWNER224_EXISTING_CONTAINER_NOT_REUSED');
 stage='bootstrap223';const boot=await startInventory224Local(223,'upgrade');local=boot.local;stopOwned=boot.stop;containerId=JSON.parse((await exec('docker',['inspect',container],{windowsHide:true})).stdout)[0].Id;
 await sql('SELECT cron.alter_job(jobid,active:=false) FROM cron.job;ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;');
 stage='postlaunch-fixture';const fixture=await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'),unschedule="SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='run-advanced-monitoring';";assert.equal(fixture.split(unschedule).length,2,'OWNER224_EXACT_FIXTURE_SAMPLER_STATEMENT');await sql(fixture.replace(unschedule,'-- Keep all six maintenance-held cron identities for the real owner preflight.'));
 await sql(`BEGIN;${claims}SELECT public.lite1_set_mode2(false);SELECT public.set_go_live_main_branch_v1('${id(200)}');SELECT public.finish_go_live_setup_v1('إنهاء بداية التشغيل');SELECT public.open_cash_shift('${id(200)}',10000);COMMIT;`);
 const owner=call=>sql(`BEGIN;${claims}SELECT public.${call};COMMIT;`);
 const cashOrder={branchId:id(200),warehouseId:id(201),customerId:id(401),paymentMethod:'cash',
  lines:[{commercial_line_kind:'base_unit',product_id:id(103),base_quantity:2}],discountInMinorUnits:0,amountReceivedInMinorUnits:2000};
 await owner("lite1_pos2('"+JSON.stringify(cashOrder)+"'::jsonb,'owner224-existing-cash-fixture')");
 // Emulate a post-launch configured transport while MAINTENANCE prevents sends.
 // No dispatch/outbox function or HTTP call is executed.
 await sql("UPDATE public.storefront_settings SET orders_enabled=false;UPDATE public.owner_telegram_dispatch_settings SET enabled=true;UPDATE public.business_alert_settings SET daily_summary_enabled=true;ALTER TABLE public.orders ENABLE TRIGGER trg_notify_new_website_order_push;SELECT nextval('net.http_request_queue_id_seq');SELECT nextval('net.http_request_queue_id_seq');SELECT nextval('net.http_request_queue_id_seq');");
 const source={session:()=>new SnapshotSession('docker',executor.args),readObject:async()=>{throw Error('OWNER224_NO_STORAGE_FIXTURE_OBJECTS');},
  roles:async destination=>{await owned();await exec('docker',['exec',container,'pg_dumpall','-U','supabase_admin','--roles-only','--no-role-passwords','--no-tablespaces','-f','/tmp/owner224-roles.sql'],{windowsHide:true});await exec('docker',['cp',container+':/tmp/owner224-roles.sql',destination],{windowsHide:true});},
  dump:async(snapshot,destination)=>{await owned();await exec('docker',['exec',container,'pg_dump','-U','postgres','-d','postgres','-Fc','--snapshot='+snapshot,'-f','/tmp/owner224.dump'],{windowsHide:true,timeout:600_000});await exec('docker',['cp',container+':/tmp/owner224.dump',destination],{windowsHide:true});}};
 const passphrase='disposable-local-owner224-fixture-only',backupRoot=path.join(output,'Frankfurt-kzevmysfydaslxcerogt');
 await owned();await sql(frankfurt220TriggerAclFixtureSql);
 const rawProfile=async()=>frozen220TriggerAclProfile(JSON.parse(await sql(frankfurt220TriggerAclReadSql)));
 assert.equal(await rawProfile(),'frankfurt');
 await owner(`lite3_set_counter223('${id(103)}',true,16,4,0,'${id(990)}','${id(10)}')`);
 const readHistory=async()=>JSON.parse(await sql('SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations;'));
 const listCli=async flags=>{
  assert.deepEqual(flags,['migration','list','--linked','--output-format','json']);
  return {stdout:JSON.stringify({migrations:(await readHistory()).map(version=>({local:version,remote:version}))})};
 };
 stage='registration-preflight-no-write';
 const sourceBeforeRejection=await read224SourceEvidence(executor);
 for(const cli of [async()=>{throw Error('synthetic CLI connection failure');},async()=>({stdout:'{"migrations":[]}'})]){
  await assert.rejects(()=>run224(['--apply','--backup-evidence',path.join(output,'not-created.json')],{
   preflight:async()=>{},runOwner:async(_args,configuration)=>configuration.registration.preflight({cli,reference,mode:'--apply'}),
  }),/UPGRADE_REGISTRATION_PREFLIGHT_FAILED/u);
 }
 assert.deepEqual(await read224SourceEvidence(executor),sourceBeforeRejection);
 await run224(['--preflight-registration'],{runOwner:async(_args,configuration)=>
  configuration.registration.preflight({cli:listCli,reference,mode:'--preflight-registration'})});
 stage='backup223';const before=await timed('backup223',()=>createCompleteBackup({projectRef:'kzevmysfydaslxcerogt',outputRoot:backupRoot,passphrase,source}));assert.equal(before.historyCeiling,223);const beforeFile=await save('backup223.json',before);
 await read224BackupEvidence(beforeFile,223);
 stage='restore223';report.restore223=await timed('restore223',()=>restoreCompleteBackup({archivePath:before.archivePath,passphrase,reportPath:path.join(output,'restore223.json')}));assert.equal(report.restore223.allRowsAndHashesMatch,true);
 let registrations=0;
 const record=async version=>{
  assert.equal(version,'224');registrations++;
  const unit=reference.manifest.find(m=>m.name.startsWith(version+'_'));
  await copyFile(path.join(root,'supabase/migrations',unit.name),path.join(local,'supabase/migrations',unit.name));
  await sql("INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('224','optional_quantity_inventory_reader','{}');");
 };
 const finalDryRun=async()=>assert.deepEqual(await readHistory(),reference.appliedVersions);
 const run=async(name,backupEvidence=before,repair=record,applyReport={projectRef:'kzevmysfydaslxcerogt',startedAt:new Date().toISOString()})=>{
  const dir=path.join(output,name);await mkdir(dir);
  return upgrade224WithExecutor({executor,reference,output:dir,backupEvidence,report:applyReport,repair,finalDryRun});
 };
 stage='negative-source-commitment';await assert.rejects(()=>run('wrong-backup',{...before,sourceEvidenceSha256:'0'.repeat(64)}),/SOURCE_CHANGED_SINCE_BACKUP/u);
 stage='apply224-registration-interrupted';
 const first={projectRef:'kzevmysfydaslxcerogt',startedAt:new Date().toISOString()};
 await timed('apply224',()=>assert.rejects(()=>run('upgrade224-2026-11-16T12-00-00-000Z',before,async()=>{throw Error('synthetic CLI refusal');},first),/SQL_APPLIED_REGISTRATION_PENDING/u));
 assert.deepEqual(first.applied,['224']);assert.deepEqual(first.recorded,[]);
 assert.equal(JSON.parse(await readFile(first.registrationState,'utf8')).status,pending224Registration);
 assert.equal(registrations,0);
 assert.deepEqual(await readHistory(),reference.prefixes['223'].appliedVersions);
 assert.equal(await sql("SELECT to_regprocedure('public.lite3_counters224(text,text,integer,integer)') IS NOT NULL;"),'t');
 const resume=async name=>{
  const dir=path.join(output,name);await mkdir(dir);
  return run224(['--resume-registration','--backup-evidence',beforeFile,'--registration-state',first.registrationState],{
   preflight:async()=>{},runOwner:async(_args,configuration)=>{
    await configuration.registration.preflight({cli:listCli,reference,mode:'--resume-registration'});
    return configuration.registration.resume({executor,reference,output:dir,workdir:output,
     report:{projectRef:'kzevmysfydaslxcerogt',startedAt:new Date().toISOString()},repair:record,finalDryRun});
   },
  });
 };
 stage='resume224-reject-changed-source';
 const reader='public.lite3_counters224(text,text,integer,integer)';
 for(const [name,mutate,undo] of [
  ['catalog',`ALTER FUNCTION ${reader} RESET search_path;`,`ALTER FUNCTION ${reader} SET search_path=pg_catalog,public;`],
  ['data',`UPDATE sales_lite3.quantity_counters SET low_threshold=5 WHERE product_id='${id(103)}';`,`UPDATE sales_lite3.quantity_counters SET low_threshold=4 WHERE product_id='${id(103)}';`],
 ]){
  await sql(mutate);
  await assert.rejects(()=>resume('resume-refuses-'+name),/UPGRADE_REGISTRATION_SOURCE_CHANGED/u);
  assert.equal(registrations,0);
  await sql(undo);
 }
 stage='resume224-registration-only';
 report.apply=await timed('resume224',()=>resume('resume'));
 report.apply.endedAt=new Date().toISOString();
 const applyFile=await save('apply224.json',report.apply);
 assert.equal(registrations,1);assert.equal(report.apply.resumedRegistration,true);
 assert.equal(JSON.parse(await readFile(first.registrationState,'utf8')).status,'REGISTRATION_COMPLETE');
 await assert.rejects(()=>resume('resume-already-complete'),/UPGRADE_REGISTRATION_PREFLIGHT_FAILED/u);
 assert.equal(registrations,1);
 await checkRegistration224({cli:listCli,reference,mode:'--verify-only'});
 assert.equal(await rawProfile(),'frankfurt','OWNER224_RAW_TRIGGER_ACL_CHANGED');
 assert.deepEqual(report.apply.applied,['224']);assert.deepEqual(report.apply.recorded,['224']);assert.equal(report.apply.protectionPending,true);assert.equal(report.apply.complete,false);
 assert.equal(await sql('SELECT enabled FROM public.owner_telegram_dispatch_settings;'),'t');assert.equal(await sql('SELECT daily_summary_enabled FROM public.business_alert_settings;'),'t');
 stage='replay';await assert.rejects(()=>run('replay'),/ALREADY_APPLIED_USE_VERIFY_ONLY/u);assert.equal(await sql('SELECT count(*) FROM supabase_migrations.schema_migrations;'),'184');
 stage='backup224';const after=await timed('backup224',()=>createCompleteBackup({projectRef:'kzevmysfydaslxcerogt',outputRoot:backupRoot,passphrase,source}));assert.equal(after.historyCeiling,224);const afterFile=await save('backup224.json',after);
 stage='restore224';report.restore224=await timed('restore224',()=>restoreCompleteBackup({archivePath:after.archivePath,passphrase,reportPath:path.join(output,'restore224.json')}));
 const restoreFile=path.join(output,'restore224.json');report.protection=await assert224ProtectionComplete({backupFile:afterFile,restoreFile,upgradeFile:applyFile});assert.equal(report.protection.complete,true);
 const readonly={...executor,args:[...executor.args,...readOnlyPsqlSessionArgs]},verifyArgs=['--verify-only','--backup-evidence',afterFile,'--restore-evidence',restoreFile,'--upgrade-report',applyFile];
 const verify=async(name,args=verifyArgs)=>{const dir=path.join(output,name);await mkdir(dir);return run224(args,{runOwner:async(_args,configuration)=>{const result={};await configuration.verifyReadOnly(readonly,dir,reference,null,null,result);return result;}});};
 stage='verify-only';report.verify=await timed('verifyOnly',()=>verify('verify'));assert.equal(report.verify.complete,true);assert.equal(report.verify.protectionPending,false);
 report.negatives=['registration-preflight-no-write','pending-registration','resume-catalog-drift','resume-data-drift','resume-replay','wrong-source-commitment','apply-replay'];
 for(const [name,mutate,undo]of [
  ['acl','GRANT TRUNCATE ON public.products TO anon;','REVOKE TRUNCATE ON public.products FROM anon;'],
  ['body',"ALTER FUNCTION public.release_owner_telegram_dispatch_v1(uuid) RESET search_path;","ALTER FUNCTION public.release_owner_telegram_dispatch_v1(uuid) SET search_path=public,pg_temp;"],
  ['extra-cron',"SELECT cron.schedule('owner224-unexpected','* * * * *','SELECT 1;');SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='owner224-unexpected';","SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='owner224-unexpected';"],
 ]){stage='negative-'+name;await sql(mutate);await assert.rejects(()=>verify('negative-'+name));await sql(undo);report.negatives.push(name);}
 // Extra-cron add/delete advances its sequence. A NEW backup/Restore is required;
 // do not pretend the old evidence still describes the source after any drift.
 stage='negative-stale-restore';await assert.rejects(()=>verify('negative-stale-restore'),/SOURCE_CHANGED_SINCE_RESTORE/u);report.negatives.push('stale-restore');
 stage='tracked-private-archive';
 await owner(`lite3_set_counter223('${id(103)}',true,18,4,1,'${id(991)}','${id(10)}')`);
 const tracked=await timed('backupWithCounter',()=>createCompleteBackup({projectRef:'kzevmysfydaslxcerogt',outputRoot:backupRoot,passphrase,source}));
 report.trackedRestore=await timed('restoreWithCounter',()=>restoreCompleteBackup({archivePath:tracked.archivePath,passphrase,reportPath:path.join(output,'tracked-restore224.json')}));
 assert.equal(report.trackedRestore.allRowsAndHashesMatch,true);
 assert.equal(report.trackedRestore.tablesCompared,report.restore224.tablesCompared);
 stage='reset-hold';
 const checked=await verify('verify-before-reset-hold',['--verify-only','--backup-evidence',await save('tracked-backup224.json',tracked),
  '--restore-evidence',path.join(output,'tracked-restore224.json'),'--upgrade-report',applyFile]);
 const proof={...checked,ok:true,mode:'verify-only',projectRef:'kzevmysfydaslxcerogt',remoteWriteAttempted:false};
 const verification=await save('verify-before-reset-hold.json',proof);
 const notifications=await readNotificationSnapshot(executor),binding=JSON.parse(await sql(upgrade220ServerBindingSql));
 const cleanup='cleanup-guest-order-gateway-requests';
 // This fixture starts at223. The real220 runtime exercises creation of this artifact.
 const evidenceFile=await save('cutover-hold224-original.json',{format:1,projectRef:proof.projectRef,
  baseManifestDigest:manifestDigest(reference.manifest.filter(unit=>Number(unit.name.slice(0,3))<=220)),
  inventorySha256:sha256(JSON.stringify({binding,trigger:{...notifications.trigger,enabled:null},jobs:notifications.jobs.map(job=>({...job,active:null}))})),
  original:{historyCeiling:220,historyFiles:181,ordersClosed:false,triggerEnabled:'O',dispatchEnabled:true,jobs:notifications.jobs.map(({id,name})=>({id,name,active:name===cleanup}))}});
 const hold=(mode,file=verification)=>cutoverHoldWithExecutor({executor,reference,phase:'reset',mode,evidenceFile,verification:file});
 await assert.rejects(()=>hold('verify'),/CUTOVER_HOLD_CRON_STATE_MISMATCH/u);
 const stale=await save('verify-stale-hold.json',{...proof,protection:{...proof.protection,afterSourceEvidenceSha256:'0'.repeat(64)}});
 await assert.rejects(()=>hold('apply',stale),/CUTOVER_HOLD_SOURCE_CHANGED_SINCE_VERIFY224/u);
 assert.deepEqual(await readNotificationSnapshot(executor),notifications);
 assert.equal((await hold('dry-run')).remoteWriteAttempted,false);
 assert.deepEqual(await readNotificationSnapshot(executor),notifications);
 assert.equal((await hold('apply')).remoteWriteAttempted,true);
 assert.equal(await sql('SELECT enabled FROM public.owner_telegram_dispatch_settings;'),'f');
 assert.equal((await readNotificationSnapshot(executor)).trigger.enabled,'D');
 assert.deepEqual((await hold('verify')).jobs.filter(job=>job.active).map(job=>job.name),[cleanup]);
 assert.equal((await hold('apply')).noOp,true);
 report.cutoverHold={strict224ProofRequired:true,staleProofRejected:true,dryRunReadOnly:true,cleanupOnly:true,repeatedNoOp:true};
 assert.equal((await exec('docker',['ps','-aq','--filter','name=^/nawasrah-full-restore-'+process.pid+'-'],{windowsHide:true})).stdout.trim(),'','DEFAULT_RESTORE_MUST_REMOVE_OWN_CONTAINER');
 Object.assign(report,{ok:true,realMoneyAndInventoryRowsUnchanged:true,notificationSettingsPreserved:true,defaultRestoreContainerDeleted:true,noExternalTransportInvoked:true});
}catch(error){Object.assign(report,{ok:false,stage,error:error.message.split('\n')[0],cause:error.cause?.message?.split('\n')[0],assertionCause:error.actual instanceof Error?{code:error.actual.code,message:error.actual.message.split('\n')[0],location:error.actual.stack?.split('\n').slice(1,4)}:undefined});process.exitCode=1;}
finally{const mirror=path.join(root,'test-results/owner-upgrade224');await mkdir(mirror,{recursive:true});await writeFile(path.join(mirror,'report.json'),JSON.stringify(report,null,2)+'\n');await save('summary.json',{ok:report.ok,stage:report.stage,error:report.ok?undefined:'LOCAL_OWNER224_PROOF_FAILED',hostedAccess:false,timings:report.timings,negatives:report.negatives??[],strictBeforeRestore:report.restore223?.ok===true,strictAfterRestore:report.restore224?.ok===true,protectionComplete:report.protection?.complete===true});if(local){await owned();await stopOwned();report.databaseStopped=true;}await save('report.json',report);console.log(JSON.stringify({ok:report.ok,stage:report.stage,error:report.error,output,timings:report.timings,hostedAccess:false}));}
