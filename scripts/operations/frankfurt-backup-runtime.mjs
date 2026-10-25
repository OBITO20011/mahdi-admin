// Explicit owner entrypoint only. No import side effects or arbitrary project targets.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,rename,open,unlink,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createCompleteBackup,nativeSource,restoreCompleteBackup} from '../backup/complete-backup.mjs';
import {FRANKFURT_BACKUP_REF,assertBackupDatabaseProject} from '../backup/backup-public-config.mjs';
import {sha256,buildObjectKey,BUCKET_NAME,isDue} from '../offsite-backup/offsite-core.mjs';
import {createR2Client,putImmutableArchive,listObjects,latestArchiveObject,downloadAndVerify} from '../offsite-backup/r2-client.mjs';
import {verifyBackupArchive} from '../backup/verify-backup.mjs';
import {collectDailySupabase} from '../monitoring/supabase-daily-health.mjs';
import {runIncidentCycle,sendTelegramMessage} from '../monitoring/developer-alert-core.mjs';
import {postgresDiagnostic,diagnosticError,classifiedError} from '../backup/postgres-diagnostic.mjs';
import {verifiedSupabaseCa} from '../backup/supabase-ca.mjs';

export const PREFIX='erp/frankfurt-'+FRANKFURT_BACKUP_REF+'/';
export const OWNER_MODES=Object.freeze(['Plan','Backup','Upload','VerifyRemote','Restore','RestoreRemote','Watchdog','TestAlert','Status']);
const read=async file=>JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/u,''));
const optional=async file=>{try{return await read(file);}catch{return null;}};
const save=async(file,data)=>{await mkdir(path.dirname(file),{recursive:true});const temp=file+'.tmp';await writeFile(temp,JSON.stringify(data,null,2)+'\n');await rename(temp,file);};
export function validateOwnerConfig(config){
  assert.equal(config.formatVersion,1);assert.equal(config.projectRef,FRANKFURT_BACKUP_REF);
  assertBackupDatabaseProject(config.connection,config.projectRef);
  assert.equal(config.protectionScope,'LocalMachine');assert.equal(config.businessAlertsEnabled,false);
  assert.ok(path.isAbsolute(config.backupRoot)&&path.isAbsolute(config.stateRoot));
  assert.equal(path.basename(config.backupRoot),'Frankfurt-'+config.projectRef,'BACKUP_ROOT_NOT_PROJECT_ISOLATED');
  assert.equal(config.retentionCount,30);return config;
}
export const ownerPlan=()=>({ok:true,mode:'Plan',networkAttempted:false,projectRef:FRANKFURT_BACKUP_REF,legacyUnchanged:true,
  modes:OWNER_MODES,prefix:PREFIX,localRetentionCount:30,dailyRetentionDays:90,monthlyRetentionDays:365,lockDays:30,
  ownerMustVerifyR2Rules:true,technicalRecipient:'existing developer Telegram only',businessAlertsEnabled:false,
  schedules:{Backup:'23:50 daily',Upload:'02:35 daily',VerifyRemote:'03:10 Sunday',RestoreRemote:'03:50 daily gate / 90-day due',Watchdog:'every 5 minutes'},
  credentialStorage:'Windows LocalMachine DPAPI with restricted file ACL; runtime secrets in memory; archive passphrase reused from legacy encrypted configuration',
  tls:{sslmode:'verify-full',caSource:'bundled Supabase Root 2021 CA',caSha256:verifiedSupabaseCa().sha256}});
const fresh=(status,field,hours)=>status?.ok===true&&!isDue(status[field],hours)&&Date.parse(status[field])<=Date.now();
export async function runOwnerMode({mode,config,force=false,env=process.env,dependencies={}}){
  assert.ok(OWNER_MODES.includes(mode));if(mode==='Plan')return ownerPlan();validateOwnerConfig(config);
  const root=config.stateRoot,localPath=path.join(config.backupRoot,'last-backup-status.json'),offsitePath=path.join(root,'offsite-status.json');
  const restorePath=path.join(root,'restore-local.json'),remoteRestorePath=path.join(root,'restore-remote.json');
  await mkdir(root,{recursive:true});
  if(mode==='Status'){
    const operations=await Promise.all(['Backup','Upload','VerifyRemote','Restore','RestoreRemote','Watchdog','TestAlert'].map(async name=>({mode:name,...await optional(path.join(root,'operation-'+name+'.json'))})));
    return {ok:operations.every(o=>o.ok!==false),projectRef:config.projectRef,backup:await optional(localPath),offsite:await optional(offsitePath),localRestore:await optional(restorePath),remoteRestore:await optional(remoteRestorePath),watchdog:await optional(path.join(root,'watchdog-status.json')),testAlert:await optional(path.join(root,'test-alert.json')),operations,businessAlertsEnabled:false};
  }
  const lockPath=path.join(root,['Watchdog','TestAlert'].includes(mode)?'monitor.lock':'backup-offsite.lock');let lock;
  // Never steal a stale lock automatically: an operator must check the owning process.
  try{lock=await open(lockPath,'wx');await lock.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString(),mode}));}
  catch{throw new Error('FRANKFURT_OPERATION_LOCKED_CHECK_OWNER_PROCESS');}
  const source=()=>dependencies.source??nativeSource({projectRef:config.projectRef,connection:config.connection,pgBin:config.pgBinPath,password:env.NAWASRAH_FF_DB_PASSWORD});
  const passphrase=env.NAWASRAH_FF_PASSPHRASE;
  const client=()=>dependencies.r2Client??createR2Client({accountId:env.NAWASRAH_R2_ACCOUNT_ID,accessKeyId:env.NAWASRAH_R2_ACCESS_KEY_ID,secretAccessKey:env.NAWASRAH_R2_SECRET_ACCESS_KEY,jurisdiction:'eu'});
  const send=message=>(dependencies.send??sendTelegramMessage)({botToken:env.NAWASRAH_DEV_TELEGRAM_BOT_TOKEN,chatId:env.NAWASRAH_DEV_TELEGRAM_CHAT_ID,message,maxAttempts:1});
  const check=(key,healthy,summary,details={})=>({key:'developer:frankfurt:'+key,source:'Frankfurt backup watchdog',severity:'high',healthy,summary,details});
  let failed=false;
  try{
    if(mode==='TestAlert'){
      const file=path.join(root,'test-alert.json'),previous=await optional(file);
      assert.equal(previous,null,'TEST_ALERT_ALREADY_ATTEMPTED_CHECK_TELEGRAM_NO_AUTOMATIC_RESEND');
      // Persist BEFORE sending. A timeout cannot cause an unnoticed duplicate retry.
      await save(file,{ok:false,attemptedAt:new Date().toISOString(),attempts:1,recipient:'developer',state:'attempted'});
      const ok=await send('اختبار تقني واحد — حارس ونسخ فرانكفورت. لا توجد بيانات زبائن أو مبالغ في هذه الرسالة.');
      await save(file,{ok,attemptedAt:new Date().toISOString(),attempts:1,recipient:'developer',state:ok?'delivered':'unconfirmed-check-Telegram'});
      assert.ok(ok,'TEST_ALERT_DELIVERY_UNCONFIRMED_DO_NOT_BLINDLY_RETRY');return {ok,mode,attempts:1,recipient:'developer'};
    }
    if(mode==='Backup')return await createCompleteBackup({projectRef:config.projectRef,outputRoot:config.backupRoot,retentionCount:config.retentionCount,passphrase,source:source()});
    if(mode==='Restore'){
      const status=await optional(localPath);if(status?.ok!==true)throw classifiedError('BACKUP_NOT_AVAILABLE',{tool:'internal',stage:'restore-preflight'});assert.equal(status.projectRef,config.projectRef);assert.equal(await sha256(status.archivePath),status.sha256);
      const verified=await verifyBackupArchive({archivePath:status.archivePath,passphrase});assert.equal(verified.projectRef,config.projectRef);assert.equal(verified.formatVersion,2);
      return await restoreCompleteBackup({archivePath:status.archivePath,passphrase,reportPath:restorePath});
    }
    if(mode==='Upload'){
      const status=await read(localPath);assert.equal(status.ok,true);assert.equal(status.projectRef,config.projectRef);assert.equal(status.formatVersion,2);
      assert.ok(fresh(status,'finishedAt',36),'BACKUP_TOO_OLD');assert.equal(await sha256(status.archivePath),status.sha256);
      const verified=await verifyBackupArchive({archivePath:status.archivePath,passphrase});assert.equal(verified.projectRef,config.projectRef);assert.equal(verified.formatVersion,2);
      const key=buildObjectKey('erp','daily',status.finishedAt,status.archiveName).replace(/^erp\//u,PREFIX),r2=client();
      await putImmutableArchive(r2,{bucket:BUCKET_NAME,key,filePath:status.archivePath,bytes:status.archiveBytes,digest:status.sha256,pipelineName:'erp-frankfurt'});
      const monthPrefix=PREFIX+'monthly/'+key.slice(PREFIX.length).split('/').slice(1,3).join('/')+'/';
      const monthly=(await listObjects(r2,BUCKET_NAME,monthPrefix)).filter(o=>o.Key.endsWith('.nwb'));
      if(!monthly.length)await putImmutableArchive(r2,{bucket:BUCKET_NAME,key:buildObjectKey('erp','monthly',status.finishedAt,status.archiveName).replace(/^erp\//u,PREFIX),filePath:status.archivePath,bytes:status.archiveBytes,digest:status.sha256,pipelineName:'erp-frankfurt'});
      const result={...await optional(offsitePath),ok:true,projectRef:config.projectRef,lastUploadAt:new Date().toISOString(),remoteVerified:true,key,sha256:status.sha256};await save(offsitePath,result);return result;
    }
    if(['VerifyRemote','RestoreRemote'].includes(mode)){
      const prior=await optional(offsitePath),field=mode==='VerifyRemote'?'lastDownloadVerifiedAt':'lastRestoreVerifiedAt',hours=mode==='VerifyRemote'?168:2160;
      if(!force&&fresh(prior,field,hours))return {ok:true,mode,skippedNotDue:true,lastSuccessAt:prior[field]};
      const work=await mkdtemp(path.join(tmpdir(),'nawasrah-frankfurt-offsite-'));
      try{
        const r2=client(),latest=await latestArchiveObject(r2,BUCKET_NAME,PREFIX+'daily/');assert.ok(latest.Key.startsWith(PREFIX+'daily/'));
        const outputPath=path.join(work,'remote.nwb');const downloaded=await downloadAndVerify(r2,{bucket:BUCKET_NAME,key:latest.Key,outputPath});
        const verified=await verifyBackupArchive({archivePath:outputPath,passphrase});assert.ok(verified.verifiedFileCount>2);assert.equal(verified.projectRef,config.projectRef);assert.equal(verified.formatVersion,2);
        if(mode==='RestoreRemote')await restoreCompleteBackup({archivePath:outputPath,passphrase,reportPath:remoteRestorePath});
        const result={...prior,ok:true,projectRef:config.projectRef,[field]:new Date().toISOString(),downloadedKey:downloaded.key,downloadedSha256:downloaded.sha256};await save(offsitePath,result);return result;
      }finally{await rm(work,{recursive:true,force:true});}
    }
    if(mode==='Watchdog'){
      const statePath=path.join(root,'incidents.json'),state=await optional(statePath)??{version:1,incidents:{}};
      const local=await optional(localPath),offsite=await optional(offsitePath),restored=await optional(remoteRestorePath);
      const checks=[check('backup',local?.projectRef===config.projectRef&&fresh(local,'finishedAt',36),'حالة نسخة فرانكفورت الليلية.'),check('offsite',offsite?.projectRef===config.projectRef&&fresh(offsite,'lastUploadAt',36),'حالة رفع نسخة فرانكفورت إلى R2.'),check('remote-verify',fresh(offsite,'lastDownloadVerifiedAt',192),'حالة تنزيل وفحص نسخة فرانكفورت.'),check('restore',fresh(restored,'completedAt',24*100),'حالة اختبار استرجاع فرانكفورت الكامل.')];
      for(const name of ['Backup','Upload','VerifyRemote','RestoreRemote']){
        const attempt=await optional(path.join(root,'operation-'+name+'.json'));
        checks.push(check('last-'+name.toLowerCase(),attempt?.ok!==false,'نتيجة آخر تشغيل '+name+' لفرانكفورت.'));
      }
      const db=source().session();let daily,technical;
      try{
        await db.query('BEGIN READ ONLY;');
        daily=await collectDailySupabase({enabled:true,previous:state.frankfurtDaily,url:`https://${config.projectRef}.supabase.co`,publishableKey:config.publishableKey,fetchImpl:dependencies.fetchImpl,
          readDatabaseSize:async()=> (await db.query('SELECT pg_database_size(current_database());')).trim()});
        technical=JSON.parse((await db.query("SELECT public.get_advanced_monitoring_status() || jsonb_build_object('scanEnabled',coalesce((SELECT active FROM cron.job WHERE jobname='run-advanced-monitoring'),false));")).trim());
      }catch{checks.push(check('read',false,'تعذرت قراءة صحة قاعدة فرانكفورت.'));}
      finally{await db.close();}
      for(const item of daily?.checks??[])checks.push({...item,key:item.key.replace('developer:supabase:','developer:frankfurt:')});
      if(technical){const issues=(technical.checks??[]).filter(c=>['warning','critical'].includes(c.status)).length;
        const scanAt=Date.parse(technical.checkedAt),scanFresh=Number.isFinite(scanAt)&&scanAt<=Date.now()&&Date.now()-scanAt<36*3600000;
        const held=technical.scanEnabled===false;
        checks.push(check('integrity',issues===0&&!technical.scanErrorCode&&(held||scanFresh),held?'فحص السلامة الداخلي مؤجل بقرار المالك؛ لم يُفعّل الحارس cron.':'حالة فحوص سلامة النظام في فرانكفورت.',{issueCount:issues,scanFresh,held}));}
      const cycle=await runIncidentCycle({checks,state,send:({message})=>send(message)});if(daily?.state)cycle.state.frankfurtDaily=daily.state;await save(statePath,cycle.state);
      const result={ok:cycle.notifications.every(n=>n.delivered),healthy:checks.every(c=>c.healthy),internalScanHeld:technical?.scanEnabled===false,observedAt:new Date().toISOString(),checks:checks.map(({key,healthy})=>({key,healthy})),notifications:cycle.notifications.length,recipient:'developer',businessAlertsEnabled:false};await save(path.join(root,'watchdog-status.json'),result);return result;
    }
    assert.fail('UNHANDLED_OWNER_MODE');
  }catch(error){failed=true;const diagnostic=postgresDiagnostic(error,{stage:'operation-preflight'});await save(path.join(root,'operation-'+mode+'.json'),{ok:false,mode,at:new Date().toISOString(),code:'FRANKFURT_OWNER_OPERATION_FAILED_CHECK_STAGE_REPORTS',diagnostic});throw diagnosticError('FRANKFURT_OWNER_OPERATION_FAILED:'+mode,diagnostic);}
  finally{if(!failed)await save(path.join(root,'operation-'+mode+'.json'),{ok:true,mode,at:new Date().toISOString()});await lock.close();await unlink(lockPath);}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const mode=process.argv[2]??'Plan';
  try{const config=mode==='Plan'?null:await read(process.env.NAWASRAH_FF_CONFIG);const result=await runOwnerMode({mode,config,force:process.argv.includes('--force')});console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;}
  catch(error){console.error(JSON.stringify({ok:false,mode,code:'FRANKFURT_OWNER_OPERATION_FAILED_NO_CREDENTIALS_LOGGED',diagnostic:postgresDiagnostic(error,{stage:'operation-preflight',tool:'node'})}));process.exitCode=1;}
}
