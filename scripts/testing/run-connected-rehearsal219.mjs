// Explicit local-only entrypoint. No live config discovery, DB URL or HTTP
// credentials. Passphrase is supplied in memory by the separate local wrapper.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,rm,access} from 'node:fs/promises';
import path from 'node:path';
import {withRestoredRehearsal219,IMAGE} from '../backup/complete-backup.mjs';
import {readReady219Reference} from '../operations/frankfurt-reference219.mjs';
import {protectResetPath,privateResetDirectory} from '../operations/reset214-private-state.mjs';
import {executeResetInput} from '../operations/reset214-io.mjs';
import {rehearsal219Executor,installRehearsalNetworkGuard,removeRehearsalPrivateSnapshots} from './rehearsal219-local.mjs';
import {rehearseReset219} from './rehearsal219-reset.mjs';
import {rehearseOpeningData219,rehearseFirstSales219} from './rehearsal219-opening-day.mjs';
import {createClosedRehearsalTree} from './rehearsal219-closed-tree.mjs';
import {sha256} from './maintenance-db-contract.mjs';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..');
const args=process.argv.slice(2),keys=['--archive','--reference','--output','--closed-tree'];
assert.equal(args.length,8,'REHEARSAL_FOUR_EXPLICIT_LOCAL_PATHS_REQUIRED');
for(let i=0;i<args.length;i+=2)assert.ok(keys.includes(args[i])&&args[i+1]&&!args[i+1].startsWith('--'),'REHEARSAL_OPTION_INVALID');
assert.equal(new Set(args.filter((_,i)=>i%2===0)).size,4);
const get=key=>path.resolve(args[args.indexOf(key)+1]);
const output=get('--output'),archivePath=get('--archive'),referenceFile=get('--reference'),closedTree=get('--closed-tree');
const relative=path.relative(root,output);
assert.ok(relative&&(relative.startsWith('..'+path.sep)||path.isAbsolute(relative)),'REHEARSAL_OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
await mkdir(output,{recursive:false});await protectResetPath(output,true);
await privateResetDirectory(output);
const passphrase=process.env.NAWASRAH_REHEARSAL_ARCHIVE_PASSPHRASE;delete process.env.NAWASRAH_REHEARSAL_ARCHIVE_PASSPHRASE;
assert.ok(passphrase?.length>=16,'REHEARSAL_PASSPHRASE_REQUIRED_IN_MEMORY');
const guard=installRehearsalNetworkGuard(),started=performance.now();
const report={ok:false,sourceMain:'49b8d008ec56156c0e918bfed3772f33785d4b21',steps:[],hostedConnections:0,startedAt:new Date().toISOString()};
let stage='reference-preflight',executor,day,closed,restoreContext;
const save=()=>writeFile(path.join(output,'rehearsal.json'),JSON.stringify(report,null,2)+'\n');
const step=async(number,name,action)=>{
 stage=name;const begin=performance.now();
 try{const proof=await action();report.steps.push({number,name,ok:true,elapsedMs:Math.round(performance.now()-begin),proof});await save();return proof;}
 catch(error){report.steps.push({number,name,ok:false,elapsedMs:Math.round(performance.now()-begin)});throw error;}
};
try{
 const reference=await readReady219Reference(root,referenceFile);
 report.archive={name:path.basename(archivePath),sha256:sha256(await readFile(archivePath)),referenceSha256:sha256(await readFile(referenceFile))};
 const pins=JSON.parse(await readFile(path.join(root,'scripts/testing/rehearsal219-owner-source-pins.json'),'utf8'));pins.files=Object.fromEntries(pins.files);
 const verifyPins=async()=>{for(const [file,hash]of Object.entries(pins.files))assert.equal(sha256(await readFile(path.join(root,file))),hash,'REHEARSAL_PROTECTED_SOURCE_CHANGED');};
 await verifyPins();report.protectedSources={before:pins.files};
 // An uncached image must fail rather than initiating an external pull.
 await exec('docker',['image','inspect',IMAGE],{windowsHide:true});
 stage='strict-restore';await withRestoredRehearsal219({archivePath,passphrase,reportPath:path.join(output,'strict-restore.json')},async context=>{
  restoreContext=context;
  assert.equal(context.archiveSha256,report.archive.sha256,'REHEARSAL_ARCHIVE_CHANGED');
  report.steps.push({number:1,name:'strict-restore',ok:true,elapsedMs:Math.round(performance.now()-started),proof:context.restoreProof});await save();
  executor=await rehearsal219Executor(context);
  const sql=async text=>{const r=await executeResetInput(executor,text);assert.equal(r.code,0,'REHEARSAL_LOCAL_SQL_FAILED');return r.stdout.trim();};
  const json=async text=>JSON.parse(await sql(text));
  const ownerIds=await json("SELECT coalesce(jsonb_agg(DISTINCT p.id),'[]') FROM profiles p JOIN user_roles ur ON ur.user_id=p.id JOIN roles r ON r.id=ur.role_id WHERE p.is_active AND r.code='owner' AND EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id=p.id AND f.status='verified');");
  assert.equal(ownerIds.length,1,'REHEARSAL_SELECT_ORIGINAL_OWNER_REQUIRES_DECISION');const ownerId=ownerIds[0];
  await step(2,'preview-closure',async()=>{
   closed=await createClosedRehearsalTree({root,output,target:closedTree});
   assert.equal((await exec('git',['rev-parse','HEAD'],{cwd:closedTree,windowsHide:true})).stdout.trim(),'e1e35a5f5eb362c074e62872c3a88d70ba2c6a89');
   assert.match(await readFile(path.join(closedTree,'scripts/environments/prelaunch-trial-control.mjs'),'utf8'),/PRELAUNCH_TRIAL_OPEN=false/u);
   const r=await exec(process.execPath,['scripts/testing/run-prelaunch-closed-gates.mjs'],{cwd:closedTree,windowsHide:true,maxBuffer:16*1024**2});
   const proof=JSON.parse(r.stdout.trim().split('\n').at(-1));assert.equal(proof.ok,true);assert.equal(proof.deployments,0);return proof;
  });
  await step(3,'reset219-ordinary-interruption-resume-midnight',()=>rehearseReset219({context,executor,root,referenceFile,reference,ownerId,output}));
  await step(4,'opening-data-services',async()=>{day=await rehearseOpeningData219({sql,ownerId,root,output});return day.proof;});
  const scan=async()=>{await sql('SELECT public.run_advanced_monitoring_checks();');const result=await json('SELECT public.get_advanced_monitoring_status();');
   const checks=(result.checks??[]).map(({key,status,issueCount})=>({key,status,issueCount}));
   const integrity=checks.filter(c=>c.key.startsWith('integrity:'));assert.ok(integrity.length>5);assert.ok(integrity.every(c=>c.status==='healthy'&&Number(c.issueCount)===0),'REHEARSAL_INTEGRITY_NOT_ZERO');return {integrity,otherChecks:checks.filter(c=>!c.key.startsWith('integrity:'))};};
  await step(5,'fresh-integrity-held-cron',scan);
  await step(6,'activation-ABCD-no-senders',async()=>{
   assert.equal(await sql('SHOW cron.launch_active_jobs;'),'off','REHEARSAL_CRON_LAUNCHER_MUST_STAY_OFF');
   const card=await readFile(path.join(root,'docs/operations/GO_LIVE_CUTOVER_AR.md'),'utf8');
   const blocks=[...card.matchAll(/```sql\r?\n([\s\S]*?)```/gu)].map(m=>m[1]);
   const a=blocks.filter(b=>b.includes('CUTOVER_SCAN_JOB_COUNT')),b=blocks.filter(b=>b.includes('CUTOVER_BUSINESS_JOB_COUNT'));assert.equal(a.length,1);assert.equal(b.length,1);
   await sql("UPDATE business_alert_settings SET business_timezone='Asia/Amman',daily_summary_local_time=TIME '00:00',updated_at=now() WHERE id=true;");
   // Mock setup stage only AFTER exact Vault preservation was proved by RESET.
   // A missing Vault entry gets dummy material,never a real Telegram/Edge key.
   await sql(`DO $mock$BEGIN
    IF NOT EXISTS(SELECT 1 FROM vault.secrets WHERE name='owner_telegram_dispatch_url') THEN PERFORM vault.create_secret('https://kzevmysfydaslxcerogt.supabase.co/functions/v1/owner-telegram-dispatch','owner_telegram_dispatch_url');END IF;
    IF NOT EXISTS(SELECT 1 FROM vault.secrets WHERE name='owner_telegram_dispatch_secret') THEN PERFORM vault.create_secret(repeat('local-rehearsal-only-',3),'owner_telegram_dispatch_secret');END IF;
   END $mock$;`);
   await sql(a[0]);await sql(b[0]);await sql(await readFile(path.join(root,'docs/operations/OWNER_TELEGRAM217_ENABLE.sql'),'utf8'));
   const d='BEGIN; ALTER TABLE public.orders ENABLE TRIGGER trg_notify_new_website_order_push; COMMIT;';assert.ok(card.includes(d));await sql(d);
   const jobs=await json("SELECT jsonb_agg(jsonb_build_object('name',jobname,'active',active,'schedule',schedule) ORDER BY jobname) FROM cron.job;");assert.equal(jobs.length,6);assert.ok(jobs.every(j=>j.active));
   const settings=await json("SELECT jsonb_build_object('timezone',business_timezone,'daily',daily_summary_local_time::text) FROM business_alert_settings WHERE id;");assert.deepEqual(settings,{timezone:'Asia/Amman',daily:'00:00:00'});
   return {jobs,settings,cronLauncher:'off',edgeProcess:'not running',telegramPush:'not running',network:'none',ABCD:true};
  });
  await step(7,'first-cash-partial-shift-close',()=>rehearseFirstSales219({sql,day}));
  await step(8,'final-integrity-and-protected-sources',async()=>{const checks=await scan();await verifyPins();return {checks,protectedFileCount:Object.keys(pins.files).length};});
  day.api.close();day=null;await executor.closeLocal();executor=null;
 });
 await verifyPins();report.protectedSources.after=pins.files;report.ok=true;
}catch(error){report.failureStage=stage;report.failureCode=/^[A-Z][A-Z0-9_]+$/u.test(error.message)?error.message:'REHEARSAL_ASSERTION_FAILED';process.exitCode=1;}
finally{
 day?.api.close();await executor?.closeLocal();report.networkGuard=guard.counts();guard.close();
 try{
  const residual=(await exec('docker',['ps','-aq','--filter','name=nawasrah-full-restore-'+process.pid+'-'],{windowsHide:true})).stdout.trim();assert.equal(residual,'');
  if(restoreContext)await assert.rejects(()=>access(restoreContext.storageDirectory),{code:'ENOENT'});
  report.restoredContainerAndFilesRemoved=true;
 }catch{report.ok=false;report.restoreCleanupCode='REHEARSAL_RESTORE_CLEANUP_REVIEW_REQUIRED';process.exitCode=1;}
 if(closed)try{await closed.remove();report.temporaryTreeRemoved=true;}catch{report.ok=false;report.cleanupCode='REHEARSAL_TEMP_TREE_CLEANUP_REVIEW_REQUIRED';process.exitCode=1;}
 try{await removeRehearsalPrivateSnapshots(output);report.privateSnapshotsRemoved=true;}catch{report.ok=false;report.privateCleanupCode='REHEARSAL_PRIVATE_CLEANUP_REVIEW_REQUIRED';process.exitCode=1;}
 report.elapsedMs=Math.round(performance.now()-started);report.finishedAt=new Date().toISOString();
 // The source-only bundle has no user data. Retention snapshots remain protected
 // evidence outside Git; archive plaintext is owned and deleted by Restore.
 await rm(path.join(output,'actual-ui-services.mjs'),{force:true});await save();
 console.log(JSON.stringify({ok:report.ok,output,stage:report.failureStage,code:report.failureCode,elapsedMs:report.elapsedMs,steps:report.steps.map(({number,ok,elapsedMs})=>({number,ok,elapsedMs}))}));
}
