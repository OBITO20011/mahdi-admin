import {startInventory225Local} from './inventory225-local.mjs';
import {frankfurt220TriggerAclFixtureSql,frankfurt220TriggerAclReadSql} from './frankfurt220-trigger-acl-fixture.mjs';
import {frozen220TriggerAclProfile} from '../operations/frozen220-trigger-acl.mjs';
// One owned Docker225 source,real owner226 pipeline,encrypted backups and strict Restore.
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
import {read225SourceEvidence as read226SourceEvidence} from '../operations/frankfurt-owner-upgrade225.mjs';
import {readReady226Reference} from '../operations/frankfurt-reference226.mjs';
import {upgrade226WithExecutor,run226} from '../operations/frankfurt-owner-upgrade226.mjs';
import {checkRegistration226,pending225Registration} from '../operations/upgrade225-registration.mjs';
import {read226BackupEvidence,assert226ProtectionComplete} from '../operations/upgrade225-protection.mjs';
import {readOnlyPsqlSessionArgs} from '../operations/frankfurt-catalog-verification.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile);
const project='nawasrah-owner-upgrade226-test',container='supabase_db_'+project,executor=executorFor(['--container',container]);
const output=await mkdtemp(path.join(process.env.RUNNER_TEMP??tmpdir(),'nawasrah-owner-upgrade226-')),report={output,hostedAccess:false,ok:false,timings:{}};
let local,stage='reference',containerId,stopOwned;
const sql=async(input,ex=executor)=>{const r=await executeInput(ex,input);assert.equal(r.code,0,'LOCAL_OWNER226_SQL_FAILED:'+r.stderr.slice(-400));return r.stdout.trim();};
const owned=async()=>{assert.ok(containerId);const value=JSON.parse((await exec('docker',['inspect',container],{windowsHide:true})).stdout)[0];assert.equal(value.Id,containerId,'OWNER226_OWNED_SOURCE_REQUIRED');};
const timed=async(name,run)=>{const start=performance.now();try{return await run();}finally{report.timings[name]=Math.round(performance.now()-start);}};
const save=async(name,value)=>{const file=path.join(output,name);await writeFile(file,JSON.stringify(value,null,2)+'\n');return file;};
const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const claims=`SELECT set_config('request.jwt.claims','${JSON.stringify({sub:id(1),role:'authenticated',aal:'aal2'})}',true);SET LOCAL ROLE authenticated;`;
try{
 assert.equal(process.argv.length,3,'LOCAL226_REFERENCE_REQUIRED');const reference=await readReady226Reference(root,process.argv[2]);
 assert.equal((await exec('docker',['ps','-aq','--filter','name=^/'+container+'$'],{windowsHide:true})).stdout.trim(),'','OWNER226_EXISTING_CONTAINER_NOT_REUSED');
 stage='bootstrap225';const boot=await startInventory225Local(225,'upgrade226');local=boot.local;stopOwned=boot.stop;containerId=JSON.parse((await exec('docker',['inspect',container],{windowsHide:true})).stdout)[0].Id;
 await sql('SELECT cron.alter_job(jobid,active:=false) FROM cron.job;ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;');
 stage='postlaunch-fixture';const fixture=await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'),unschedule="SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='run-advanced-monitoring';";assert.equal(fixture.split(unschedule).length,2,'OWNER226_EXACT_FIXTURE_SAMPLER_STATEMENT');await sql(fixture.replace(unschedule,'-- Keep all six maintenance-held cron identities for the real owner preflight.'));
 await sql(`BEGIN;
 INSERT INTO public.units(id,code,name_ar) VALUES('${id(600)}','ON226-PROTECTION-BOX','صندوق');
 UPDATE public.products SET sale_unit_id='${id(600)}',purchase_unit_id='${id(600)}',
  sale_price_in_minor_units=900,cost_price_in_minor_units=800,wac_cost_in_minor_units_exact=800 WHERE id='${id(103)}';
 ${claims}SELECT public.set_go_live_main_branch_v1('${id(200)}');
 SELECT public.apply_inventory_opening_setup('${id(201)}','[{"productId":"${id(103)}","packageCount":4,"looseUnits":0}]'::JSONB,'owner226 source','${id(601)}');
 SELECT public.open_cash_shift('${id(200)}',10000);COMMIT;`);
 const owner=async call=>JSON.parse((await sql(`BEGIN;${claims}SELECT public.${call};COMMIT;`)).split(/\r?\n/u).at(-1));
 const cashOrder={branchId:id(200),warehouseId:id(201),customerId:id(401),paymentMethod:'cash',
  lines:[{commercial_line_kind:'base_unit',product_id:id(103),base_quantity:2,price_authority:'server_catalog',line_discount_in_minor_units:0}],discountInMinorUnits:0,amountReceivedInMinorUnits:1800};
 const initialSale=await owner("create_pos_sale_v2('"+id(201)+"','"+id(200)+"','"+id(401)+"','عميل226','cash','"+JSON.stringify(cashOrder.lines)+"'::JSONB,0,1800,'owner226-existing-cash-fixture')");
 assert.equal(initialSale.success,true);
 assert.equal(await sql('SELECT full_accounting FROM sales_lite1.mode;'),'t');
 // Emulate a post-launch configured transport while MAINTENANCE prevents sends.
 // No dispatch/outbox function or HTTP call is executed.
 await sql("UPDATE public.storefront_settings SET orders_enabled=false;UPDATE public.owner_telegram_dispatch_settings SET enabled=true;UPDATE public.business_alert_settings SET daily_summary_enabled=true;ALTER TABLE public.orders ENABLE TRIGGER trg_notify_new_website_order_push;SELECT nextval('net.http_request_queue_id_seq');SELECT nextval('net.http_request_queue_id_seq');SELECT nextval('net.http_request_queue_id_seq');");
 const source={session:()=>new SnapshotSession('docker',executor.args),readObject:async()=>{throw Error('OWNER226_NO_STORAGE_FIXTURE_OBJECTS');},
  roles:async destination=>{await owned();await exec('docker',['exec',container,'pg_dumpall','-U','supabase_admin','--roles-only','--no-role-passwords','--no-tablespaces','-f','/tmp/owner226-roles.sql'],{windowsHide:true});await exec('docker',['cp',container+':/tmp/owner226-roles.sql',destination],{windowsHide:true});},
  dump:async(snapshot,destination)=>{await owned();await exec('docker',['exec',container,'pg_dump','-U','postgres','-d','postgres','-Fc','--snapshot='+snapshot,'-f','/tmp/owner226.dump'],{windowsHide:true,timeout:600_000});await exec('docker',['cp',container+':/tmp/owner226.dump',destination],{windowsHide:true});}};
 const passphrase='disposable-local-owner226-fixture-only',backupRoot=path.join(output,'Frankfurt-kzevmysfydaslxcerogt');
 await owned();await sql(frankfurt220TriggerAclFixtureSql);
 const rawProfile=async()=>frozen220TriggerAclProfile(JSON.parse(await sql(frankfurt220TriggerAclReadSql)));
 assert.equal(await rawProfile(),'frankfurt');
 assert.equal(await sql('SELECT count(*) FROM sales_lite3.quantity_counters;'),'0');
 const readHistory=async()=>JSON.parse(await sql('SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations;'));
 const listCli=async flags=>{
  assert.deepEqual(flags,['migration','list','--linked','--output-format','json']);
  return {stdout:JSON.stringify({migrations:(await readHistory()).map(version=>({local:version,remote:version}))})};
 };
 stage='registration-preflight-no-write';
 const sourceBeforeRejection=await read226SourceEvidence(executor);
 for(const cli of [async()=>{throw Error('synthetic CLI connection failure');},async()=>({stdout:'{"migrations":[]}'})]){
  await assert.rejects(()=>run226(['--apply','--backup-evidence',path.join(output,'not-created.json')],{
   preflight:async()=>{},runOwner:async(_args,configuration)=>configuration.registration.preflight({cli,reference,mode:'--apply'}),
  }),/UPGRADE_REGISTRATION_PREFLIGHT_FAILED/u);
 }
 assert.deepEqual(await read226SourceEvidence(executor),sourceBeforeRejection);
 await run226(['--preflight-registration'],{runOwner:async(_args,configuration)=>
  configuration.registration.preflight({cli:listCli,reference,mode:'--preflight-registration'})});
 stage='backup225';const before=await timed('backup225',()=>createCompleteBackup({projectRef:'kzevmysfydaslxcerogt',outputRoot:backupRoot,passphrase,source}));assert.equal(before.historyCeiling,225);const beforeFile=await save('backup225.json',before);
 await read226BackupEvidence(beforeFile,225);
 stage='restore225';report.restore225=await timed('restore225',()=>restoreCompleteBackup({archivePath:before.archivePath,passphrase,reportPath:path.join(output,'restore225.json')}));assert.equal(report.restore225.allRowsAndHashesMatch,true);
 let registrations=0;
 const record=async version=>{
  assert.equal(version,'226');registrations++;
  const unit=reference.manifest.find(m=>m.name.startsWith(version+'_'));
  await copyFile(path.join(root,'supabase/migrations',unit.name),path.join(local,'supabase/migrations',unit.name));
  await sql("INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('226','parcel_price_integrity','{}');");
 };
 const finalDryRun=async()=>assert.deepEqual(await readHistory(),reference.appliedVersions);
 const run=async(name,backupEvidence=before,repair=record,applyReport={projectRef:'kzevmysfydaslxcerogt',startedAt:new Date().toISOString()})=>{
  const dir=path.join(output,name);await mkdir(dir);
  return upgrade226WithExecutor({executor,reference,output:dir,backupEvidence,report:applyReport,repair,finalDryRun});
 };
 stage='negative-source-commitment';await assert.rejects(()=>run('wrong-backup',{...before,sourceEvidenceSha256:'0'.repeat(64)}),/SOURCE_CHANGED_SINCE_BACKUP/u);
 stage='apply226-registration-interrupted';
 const first={projectRef:'kzevmysfydaslxcerogt',startedAt:new Date().toISOString()};
 await timed('apply226',()=>assert.rejects(()=>run('upgrade226-2026-11-16T12-00-00-000Z',before,async()=>{throw Error('synthetic CLI refusal');},first),/SQL_APPLIED_REGISTRATION_PENDING/u));
 assert.deepEqual(first.applied,['226']);assert.deepEqual(first.recorded,[]);
 assert.equal(JSON.parse(await readFile(first.registrationState,'utf8')).status,pending225Registration);
 assert.equal(registrations,0);
 assert.deepEqual(await readHistory(),reference.prefixes['225'].appliedVersions);
 assert.equal(await sql("SELECT to_regprocedure('public.finalize_import_flavor_identity226(uuid,timestamptz,text,text)') IS NOT NULL;"),'t');
 const resume=async name=>{
  const dir=path.join(output,name);await mkdir(dir);
  return run226(['--resume-registration','--backup-evidence',beforeFile,'--registration-state',first.registrationState],{
   preflight:async()=>{},runOwner:async(_args,configuration)=>{
    await configuration.registration.preflight({cli:listCli,reference,mode:'--resume-registration'});
    return configuration.registration.resume({executor,reference,output:dir,workdir:output,
     report:{projectRef:'kzevmysfydaslxcerogt',startedAt:new Date().toISOString()},repair:record,finalDryRun});
   },
  });
 };
 stage='resume226-reject-changed-source';
 const reader='public.finalize_import_flavor_identity226(uuid,timestamptz,text,text)';
 for(const [name,mutate,undo] of [
  ['catalog',`ALTER FUNCTION ${reader} RESET search_path;`,`ALTER FUNCTION ${reader} SET search_path=pg_catalog,public;`],
  ['data',`INSERT INTO public.product_sale_pricing_state225(product_id,changed_by) VALUES('${id(103)}','${id(1)}');`,`DELETE FROM public.product_sale_pricing_state225 WHERE product_id='${id(103)}';`],
 ]){
  await sql(mutate);
  await assert.rejects(()=>resume('resume-refuses-'+name),/UPGRADE_REGISTRATION_SOURCE_CHANGED/u);
  assert.equal(registrations,0);
  await sql(undo);
 }
 stage='resume226-registration-only';
 report.apply=await timed('resume226',()=>resume('resume'));
 report.apply.endedAt=new Date().toISOString();
 const applyFile=await save('apply226.json',report.apply);
 assert.equal(registrations,1);assert.equal(report.apply.resumedRegistration,true);
 assert.equal(JSON.parse(await readFile(first.registrationState,'utf8')).status,'REGISTRATION_COMPLETE');
 await assert.rejects(()=>resume('resume-already-complete'),/UPGRADE_REGISTRATION_PREFLIGHT_FAILED/u);
 assert.equal(registrations,1);
 await checkRegistration226({cli:listCli,reference,mode:'--verify-only'});
 assert.equal(await rawProfile(),'frankfurt','OWNER226_RAW_TRIGGER_ACL_CHANGED');
 assert.deepEqual(report.apply.applied,['226']);assert.deepEqual(report.apply.recorded,['226']);assert.equal(report.apply.protectionPending,true);assert.equal(report.apply.complete,false);
 assert.equal(await sql('SELECT enabled FROM public.owner_telegram_dispatch_settings;'),'t');assert.equal(await sql('SELECT daily_summary_enabled FROM public.business_alert_settings;'),'t');
 stage='replay';await assert.rejects(()=>run('replay'),/ALREADY_APPLIED_USE_VERIFY_ONLY/u);assert.equal(await sql('SELECT count(*) FROM supabase_migrations.schema_migrations;'),'186');
 stage='backup226';const after=await timed('backup226',()=>createCompleteBackup({projectRef:'kzevmysfydaslxcerogt',outputRoot:backupRoot,passphrase,source}));assert.equal(after.historyCeiling,226);const afterFile=await save('backup226.json',after);
 stage='restore226';report.restore226=await timed('restore226',()=>restoreCompleteBackup({archivePath:after.archivePath,passphrase,reportPath:path.join(output,'restore226.json')}));
 const restoreFile=path.join(output,'restore226.json');report.protection=await assert226ProtectionComplete({backupFile:afterFile,restoreFile,upgradeFile:applyFile});assert.equal(report.protection.complete,true);
 const readonly={...executor,args:[...executor.args,...readOnlyPsqlSessionArgs]},verifyArgs=['--verify-only','--backup-evidence',afterFile,'--restore-evidence',restoreFile,'--upgrade-report',applyFile];
 const verify=async(name,args=verifyArgs)=>{const dir=path.join(output,name);await mkdir(dir);return run226(args,{runOwner:async(_args,configuration)=>{const result={};await configuration.verifyReadOnly(readonly,dir,reference,null,null,result);return result;}});};
 stage='verify-only';report.verify=await timed('verifyOnly',()=>verify('verify'));assert.equal(report.verify.complete,true);assert.equal(report.verify.protectionPending,false);
 stage='parcel-price-and-identity';
 const fixture226=await readFile(path.join(root,'scripts/testing/parcel226-runtime.sql'),'utf8');
 await sql('BEGIN;\n'+fixture226+'\nROLLBACK;');
 report.parcelRuntimePassed=true;
 report.negatives=['registration-preflight-no-write','pending-registration','resume-catalog-drift','resume-data-drift','resume-replay','wrong-source-commitment','apply-replay'];
 for(const [name,mutate,undo]of [
  ['acl','GRANT TRUNCATE ON public.products TO anon;','REVOKE TRUNCATE ON public.products FROM anon;'],
  ['body',"ALTER FUNCTION public.release_owner_telegram_dispatch_v1(uuid) RESET search_path;","ALTER FUNCTION public.release_owner_telegram_dispatch_v1(uuid) SET search_path=public,pg_temp;"],
  ['extra-cron',"SELECT cron.schedule('owner226-unexpected','* * * * *','SELECT 1;');SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='owner226-unexpected';","SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='owner226-unexpected';"],
 ]){stage='negative-'+name;await sql(mutate);await assert.rejects(()=>verify('negative-'+name));await sql(undo);report.negatives.push(name);}
 // Extra-cron add/delete advances its sequence. A NEW backup/Restore is required;
 // do not pretend the old evidence still describes the source after any drift.
 stage='negative-stale-restore';await assert.rejects(()=>verify('negative-stale-restore'),/SOURCE_CHANGED_SINCE_RESTORE/u);report.negatives.push('stale-restore');
 assert.equal((await exec('docker',['ps','-aq','--filter','name=^/nawasrah-full-restore-'+process.pid+'-'],{windowsHide:true})).stdout.trim(),'','DEFAULT_RESTORE_MUST_REMOVE_OWN_CONTAINER');
 Object.assign(report,{ok:true,realMoneyAndInventoryRowsUnchanged:true,notificationSettingsPreserved:true,defaultRestoreContainerDeleted:true,noExternalTransportInvoked:true});
}catch(error){Object.assign(report,{ok:false,stage,error:error.message.split('\n')[0],cause:error.cause?.message?.split('\n')[0],assertionCause:error.actual instanceof Error?{code:error.actual.code,message:error.actual.message.split('\n')[0],location:error.actual.stack?.split('\n').slice(1,4)}:undefined});process.exitCode=1;}
finally{const mirror=path.join(root,'test-results/owner-upgrade226');await mkdir(mirror,{recursive:true});await writeFile(path.join(mirror,'report.json'),JSON.stringify(report,null,2)+'\n');await save('summary.json',{ok:report.ok,stage:report.stage,error:report.ok?undefined:'LOCAL_OWNER226_PROOF_FAILED',hostedAccess:false,timings:report.timings,negatives:report.negatives??[],strictBeforeRestore:report.restore225?.ok===true,strictAfterRestore:report.restore226?.ok===true,protectionComplete:report.protection?.complete===true});if(local){await owned();await stopOwned();report.databaseStopped=true;}await save('report.json',report);console.log(JSON.stringify({ok:report.ok,stage:report.stage,error:report.error,output,timings:report.timings,hostedAccess:false}));}
