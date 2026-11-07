// One owned Docker219 source,real owner220 pipeline,encrypted backups and strict Restore.
// No hosted URL,credentials or external transport is accepted.
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
import {readReady220Reference} from '../operations/frankfurt-reference220.mjs';
import {upgrade220WithExecutor,run220} from '../operations/frankfurt-owner-upgrade220.mjs';
import {read220BackupEvidence,assert220ProtectionComplete} from '../operations/upgrade220-protection.mjs';
import {readOnlyPsqlSessionArgs} from '../operations/frankfurt-catalog-verification.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const project='nawasrah-owner-upgrade220-test',container='supabase_db_'+project,executor=executorFor(['--container',container]);
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-owner-upgrade220-')),report={output,hostedAccess:false,ok:false,timings:{}};
let local,stage='reference',containerId;
const sql=async(input,ex=executor)=>{const r=await executeInput(ex,input);assert.equal(r.code,0,'LOCAL_OWNER220_SQL_FAILED:'+r.stderr.slice(-400));return r.stdout.trim();};
const owned=async()=>{assert.ok(containerId);const value=JSON.parse((await exec('docker',['inspect',container],{windowsHide:true})).stdout)[0];assert.equal(value.Id,containerId,'OWNER220_OWNED_SOURCE_REQUIRED');};
const timed=async(name,run)=>{const start=performance.now();try{return await run();}finally{report.timings[name]=Math.round(performance.now()-start);}};
const save=async(name,value)=>{const file=path.join(output,name);await writeFile(file,JSON.stringify(value,null,2)+'\n');return file;};
const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const claims=`SELECT set_config('request.jwt.claims','${JSON.stringify({sub:id(1),role:'authenticated',aal:'aal2'})}',true);SET LOCAL ROLE authenticated;`;
try{
 assert.equal(process.argv.length,3,'LOCAL220_REFERENCE_REQUIRED');const reference=await readReady220Reference(root,process.argv[2]);
 assert.equal((await exec('docker',['ps','-aq','--filter','name=^/'+container+'$'],{windowsHide:true})).stdout.trim(),'','OWNER220_EXISTING_CONTAINER_NOT_REUSED');
 stage='bootstrap219';const boot=await exec(process.execPath,['scripts/testing/bootstrap-isolated-supabase.mjs'],{cwd:root,windowsHide:true,maxBuffer:16*1024**2,env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'219',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;containerId=JSON.parse((await exec('docker',['inspect',container],{windowsHide:true})).stdout)[0].Id;
 await sql('SELECT cron.alter_job(jobid,active:=false) FROM cron.job;ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;');
 stage='postlaunch-fixture';const fixture=await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'),unschedule="SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='run-advanced-monitoring';";assert.equal(fixture.split(unschedule).length,2,'OWNER220_EXACT_FIXTURE_SAMPLER_STATEMENT');await sql(fixture.replace(unschedule,'-- Keep all six maintenance-held cron identities for the real owner preflight.'));
 await sql(`BEGIN;${claims}SELECT public.set_go_live_main_branch_v1('${id(200)}');SELECT public.open_cash_shift('${id(200)}',10000);COMMIT;`);
 const owner=call=>sql(`BEGIN;${claims}SELECT public.${call};COMMIT;`);
 await owner(`create_direct_supplier_receipt_v2(p_supplier_id:='${id(301)}',p_branch_id:='${id(200)}',p_warehouse_id:='${id(201)}',p_idempotency_key:='owner220-receipt-00001',p_payment_method:='deferred',p_lines:='[{"client_line_id":"${id(990)}","line_kind":"base_unit","commercial_quantity":20,"base_unit_name":"باكيت","gross_amount_in_minor_units":10000,"line_discount_in_minor_units":0,"components":[{"product_id":"${id(103)}","base_quantity":20}]}]'::jsonb)`);
 await owner(`create_pos_sale_v2('${id(201)}','${id(200)}',NULL,'زبون نقدي','cash','[{"commercial_line_kind":"base_unit","product_id":"${id(103)}","base_quantity":2,"price_authority":"server_catalog","line_discount_in_minor_units":0}]'::jsonb,0,2000,'owner220-cash-00001')`);
 await owner(`create_pos_sale_with_initial_payment_v1('${id(201)}','${id(200)}','${id(401)}','زبون اختبار','[{"commercial_line_kind":"base_unit","product_id":"${id(103)}","base_quantity":1,"price_authority":"server_catalog","line_discount_in_minor_units":0}]'::jsonb,0,400,'cash',NULL,'owner220-partial-00001')`);
 // Emulate a post-launch configured transport while MAINTENANCE prevents sends.
 // No dispatch/outbox function or HTTP call is executed.
 await sql("UPDATE public.storefront_settings SET orders_enabled=false;UPDATE public.owner_telegram_dispatch_settings SET enabled=true;UPDATE public.business_alert_settings SET daily_summary_enabled=true;ALTER TABLE public.orders ENABLE TRIGGER trg_notify_new_website_order_push;SELECT nextval('net.http_request_queue_id_seq');SELECT nextval('net.http_request_queue_id_seq');SELECT nextval('net.http_request_queue_id_seq');");
 const source={session:()=>new SnapshotSession('docker',executor.args),readObject:async()=>{throw Error('OWNER220_NO_STORAGE_FIXTURE_OBJECTS');},
  roles:async destination=>{await owned();await exec('docker',['exec',container,'pg_dumpall','-U','supabase_admin','--roles-only','--no-role-passwords','--no-tablespaces','-f','/tmp/owner220-roles.sql'],{windowsHide:true});await exec('docker',['cp',container+':/tmp/owner220-roles.sql',destination],{windowsHide:true});},
  dump:async(snapshot,destination)=>{await owned();await exec('docker',['exec',container,'pg_dump','-U','postgres','-d','postgres','-Fc','--snapshot='+snapshot,'-f','/tmp/owner220.dump'],{windowsHide:true,timeout:600_000});await exec('docker',['cp',container+':/tmp/owner220.dump',destination],{windowsHide:true});}};
 const passphrase='disposable-local-owner220-fixture-only',backupRoot=path.join(output,'Frankfurt-kzevmysfydaslxcerogt');
 stage='backup219';const before=await timed('backup219',()=>createCompleteBackup({projectRef:'kzevmysfydaslxcerogt',outputRoot:backupRoot,passphrase,source}));assert.equal(before.historyCeiling,219);const beforeFile=await save('backup219.json',before);
 await read220BackupEvidence(beforeFile,219);
 stage='restore219';report.restore219=await timed('restore219',()=>restoreCompleteBackup({archivePath:before.archivePath,passphrase,reportPath:path.join(output,'restore219.json')}));assert.equal(report.restore219.allRowsAndHashesMatch,true);
 const cliCall=flags=>exec(process.execPath,[cli,...flags,'--local','--workdir',local,'--agent','no','--output-format','text'],{cwd:root,windowsHide:true,maxBuffer:8*1024**2});
 const run=async(name,backupEvidence=before)=>{const dir=path.join(output,name);await mkdir(dir);return upgrade220WithExecutor({executor,reference,output:dir,backupEvidence,report:{projectRef:'kzevmysfydaslxcerogt',startedAt:new Date().toISOString()},
  repair:async version=>{const unit=reference.manifest.find(m=>m.name.startsWith(version+'_'));await copyFile(path.join(root,'supabase/migrations',unit.name),path.join(local,'supabase/migrations',unit.name));await cliCall(['migration','repair','--status','applied',version]);},
  finalDryRun:async()=>{const r=await cliCall(['db','push','--dry-run','--skip-vault']);assert.match(r.stdout+r.stderr,/up to date/iu);}});};
 stage='negative-source-commitment';await assert.rejects(()=>run('wrong-backup',{...before,sourceEvidenceSha256:'0'.repeat(64)}),/SOURCE_CHANGED_SINCE_BACKUP/u);
 stage='apply220';report.apply=await timed('apply220',()=>run('apply'));report.apply.endedAt=new Date().toISOString();const applyFile=await save('apply220.json',report.apply);
 assert.deepEqual(report.apply.applied,['220']);assert.deepEqual(report.apply.recorded,['220']);assert.equal(report.apply.protectionPending,true);assert.equal(report.apply.complete,false);
 assert.equal(await sql('SELECT enabled FROM public.owner_telegram_dispatch_settings;'),'t');assert.equal(await sql('SELECT daily_summary_enabled FROM public.business_alert_settings;'),'t');
 stage='replay';await assert.rejects(()=>run('replay'),/ALREADY_APPLIED_USE_VERIFY_ONLY/u);assert.equal(await sql('SELECT count(*) FROM supabase_migrations.schema_migrations;'),'181');
 stage='backup220';const after=await timed('backup220',()=>createCompleteBackup({projectRef:'kzevmysfydaslxcerogt',outputRoot:backupRoot,passphrase,source}));assert.equal(after.historyCeiling,220);const afterFile=await save('backup220.json',after);
 stage='restore220';report.restore220=await timed('restore220',()=>restoreCompleteBackup({archivePath:after.archivePath,passphrase,reportPath:path.join(output,'restore220.json')}));
 const restoreFile=path.join(output,'restore220.json');report.protection=await assert220ProtectionComplete({backupFile:afterFile,restoreFile,upgradeFile:applyFile});assert.equal(report.protection.complete,true);
 const readonly={...executor,args:[...executor.args,...readOnlyPsqlSessionArgs]},verifyArgs=['--verify-only','--backup-evidence',afterFile,'--restore-evidence',restoreFile,'--upgrade-report',applyFile];
 const verify=async name=>{const dir=path.join(output,name);await mkdir(dir);return run220(verifyArgs,{runOwner:async(_args,configuration)=>{const result={};await configuration.verifyReadOnly(readonly,dir,reference,null,null,result);return result;}});};
 stage='verify-only';report.verify=await timed('verifyOnly',()=>verify('verify'));assert.equal(report.verify.complete,true);assert.equal(report.verify.protectionPending,false);
 report.negatives=['wrong-source-commitment','apply-replay'];
 for(const [name,mutate,undo]of [
  ['acl','GRANT TRUNCATE ON public.products TO anon;','REVOKE TRUNCATE ON public.products FROM anon;'],
  ['body',"ALTER FUNCTION public.release_owner_telegram_dispatch_v1(uuid) RESET search_path;","ALTER FUNCTION public.release_owner_telegram_dispatch_v1(uuid) SET search_path=public,pg_temp;"],
  ['extra-cron',"SELECT cron.schedule('owner220-unexpected','* * * * *','SELECT 1;');SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='owner220-unexpected';","SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='owner220-unexpected';"],
 ]){stage='negative-'+name;await sql(mutate);await assert.rejects(()=>verify('negative-'+name));await sql(undo);report.negatives.push(name);}
 // Extra-cron add/delete advances its sequence. A NEW backup/Restore is required;
 // do not pretend the old evidence still describes the source after any drift.
 stage='negative-stale-restore';await assert.rejects(()=>verify('negative-stale-restore'),/SOURCE_CHANGED_SINCE_RESTORE/u);report.negatives.push('stale-restore');
 assert.equal((await exec('docker',['ps','-aq','--filter','name=^/nawasrah-full-restore-'+process.pid+'-'],{windowsHide:true})).stdout.trim(),'','DEFAULT_RESTORE_MUST_REMOVE_OWN_CONTAINER');
 Object.assign(report,{ok:true,realMoneyAndInventoryRowsUnchanged:true,notificationSettingsPreserved:true,defaultRestoreContainerDeleted:true,noExternalTransportInvoked:true});
}catch(error){Object.assign(report,{ok:false,stage,error:error.message.split('\n')[0],cause:error.cause?.message?.split('\n')[0],assertionCause:error.actual instanceof Error?{code:error.actual.code,message:error.actual.message.split('\n')[0],location:error.actual.stack?.split('\n').slice(1,4)}:undefined});process.exitCode=1;}
finally{await save('summary.json',{ok:report.ok,stage:report.stage,error:report.ok?undefined:'LOCAL_OWNER220_PROOF_FAILED',hostedAccess:false,timings:report.timings,negatives:report.negatives??[],strictBeforeRestore:report.restore219?.ok===true,strictAfterRestore:report.restore220?.ok===true,protectionComplete:report.protection?.complete===true});if(local){await owned();await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:8*1024**2});report.databaseStopped=true;}await save('report.json',report);console.log(JSON.stringify({ok:report.ok,stage:report.stage,error:report.error,output,timings:report.timings,hostedAccess:false}));}
