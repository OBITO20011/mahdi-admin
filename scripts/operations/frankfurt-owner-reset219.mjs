import {expectedHeld217Notifications} from './owner-telegram217-notifications.mjs';
import {assertUpgradeAdministrator} from './backup-task-preflight.mjs';
import {prepareResetSession,startResetAttempt,validateResetResume,finishResetSession,reset219Marker} from './reset214-session.mjs';
import {reset214ArabicReason as reset219ArabicReason,reset214ResumeDisposition as reset219ResumeDisposition} from './reset214-diagnostics.mjs';
// Owner terminal only. --plan is offline; --dry-run uses read-only sessions.
// No arbitrary URL/target flags and no password in argv/files/reports.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,realpath,copyFile,access} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {TARGET,OLD_REF,DEFAULT_WORKDIR,assertOutsideRepository,connectionFromLink,ownerPassword,functionReference} from './frankfurt-owner-build.mjs';
import {readReady219Reference,ready219ReferenceName,assertReady219Catalog} from './frankfurt-reference219.mjs';
import {holdUpgradeGuard,historySql} from './frankfurt-owner-upgrade.mjs';
import {executeInput} from './build-empty-supabase.mjs';
import {resetUnits,uuid,sqlLiteral} from './trial-reset-core.mjs';
import {captureReset219,reset219WithExecutor} from './trial-reset214-core.mjs';
import {verifyCatalogReadOnly,readOnlyPsqlSessionArgs} from './frankfurt-catalog-verification.mjs';
import {verifiedSupabaseCa} from '../backup/supabase-ca.mjs';
import {sha256} from '../testing/maintenance-db-contract.mjs';
import {operationalManifest,operationalSchema} from './operational-schema.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),cli=path.join(root,'node_modules/supabase/dist/supabase.js');
export function reset219Arguments(args){
 const values=new Set(['--workdir','--owner-id','--reference']),modes=['--plan','--dry-run','--apply','--resume'];
 assert.ok(modes.filter(k=>args.includes(k)).length<=1,'RESET219_ONE_MODE_REQUIRED');
 for(const k of [...values,...modes])assert.ok(args.filter(v=>v===k).length<=1,'RESET219_DUPLICATE_OPTION');
 for(let i=0;i<args.length;i++){assert.ok(values.has(args[i])||modes.includes(args[i]),'RESET219_UNKNOWN_OPTION');if(values.has(args[i])){assert.ok(args[++i]&&!args[i].startsWith('--'),'RESET219_OPTION_VALUE_REQUIRED');}}
 const at=k=>args.includes(k)?args[args.indexOf(k)+1]:undefined;
 const mode=modes.find(k=>args.includes(k))?.slice(2)??'plan',workdir=path.resolve(at('--workdir')??DEFAULT_WORKDIR),ownerId=at('--owner-id');
 if(ownerId)uuid(ownerId);if(mode!=='plan')assert.ok(ownerId,'RESET219_OWNER_UUID_REQUIRED');
 const reference=path.resolve(at('--reference')??path.join(workdir,ready219ReferenceName));assert.equal(path.basename(reference),ready219ReferenceName,'RESET219_REFERENCE_NAME_REQUIRED');
 return {mode,workdir,ownerId,reference};
}
export async function runOwnerReset219(args){
 if(args.includes('--apply')||args.includes('--resume'))await assertUpgradeAdministrator();
 await operationalManifest();assert.equal(operationalSchema.resetCommand,'frankfurt-owner-reset219','RESET_ADAPTER_NOT_CURRENT');
 const options=reset219Arguments(args),{workdir,ownerId,mode}=options;
 assertOutsideRepository(workdir);assertOutsideRepository(await realpath(workdir),await realpath(root));
 const output=path.join(workdir,'reset219-'+new Date().toISOString().replaceAll(/[:.]/gu,'-'));await mkdir(output);
 const report={ok:false,complete:false,mode,projectRef:TARGET.id,migrationCeiling:219,migrations:180,output,startedAt:new Date().toISOString(),networkAccess:false,remoteWriteAttempted:false};
 let env,guard,old,session;
 try{
  report.stage='local-preflight';
  const reference=await readReady219Reference(root,options.reference);await resetUnits(root,reference);
  report.reference={name:ready219ReferenceName,sha256:sha256(await readFile(options.reference)),manifestDigest:reference.manifestDigest};
  if(mode==='plan'){
   Object.assign(report,{ok:true,complete:true,exactCountsAvailable:false,
    retained:['selected owner/Auth/MFA/profile/role','BR-MAIN/WH-MAIN','custom storefront_settings','all current units/categories','Vault/Auth/Edge'],
    deleted:['other trial accounts','all business data','all product-images objects'],
    nextAction:'OWNER_READ_ONLY_DRY_RUN_WITH_OWNER_UUID_FOR_EXACT_COUNTS'});return report;
  }
  if(mode==='resume')session=await prepareResetSession({workdir,output,ownerId,projectRef:TARGET.id,referenceSha256:report.reference.sha256,reference,resume:true});
  if(mode==='apply')try{await access(path.join(workdir,reset219Marker));throw new Error('RESET219_PRIOR_INCOMPLETE_ATTEMPT_USE_RESUME');}catch(error){if(error.code!=='ENOENT')throw error;}
  // Never relink the developer's old-project checkout.
  old=await readFile(path.join(root,'supabase/.temp/project-ref'));assert.equal(old.toString().trim(),OLD_REF,'RESET219_OLD_LINK_CHANGED');
  assert.equal((await readFile(path.join(workdir,'supabase/.temp/project-ref'),'utf8')).trim(),TARGET.id,'RESET219_WRONG_EXTERNAL_PROJECT');
  const connection=connectionFromLink(await readFile(path.join(workdir,'supabase/.temp/pooler-url'),'utf8'));
  assert.ok(process.stdin.isTTY,'RESET219_INTERACTIVE_TERMINAL_REQUIRED');
  const psql=path.join(process.env.NAWASRAH_PG_BIN??path.join(process.env.LOCALAPPDATA,'NawasrahBackup/postgresql-17.11/bin'),process.platform==='win32'?'psql.exe':'psql');
  await access(psql);const ca=verifiedSupabaseCa();
  const terminal=createInterface({input:process.stdin,output:process.stdout});
  try{assert.equal(await terminal.question('اكتب مرجع فرانكفورت للتأكد: '),TARGET.id,'RESET219_TARGET_CONFIRMATION_REQUIRED');}finally{terminal.close();}
  env={...process.env,PGPASSWORD:await ownerPassword(),PGSSLMODE:'verify-full',PGSSLROOTCERT:ca.path,PGCONNECT_TIMEOUT:'10',PGPASSFILE:path.join(output,'NO_PASSWORD_FILE')};
  delete env.PGOPTIONS;delete env.SUPABASE_DB_PASSWORD;delete env.PGSERVICE;delete env.PGSERVICEFILE;
  const executor={command:psql,args:[...connection,'-X','-q','-At','-w','-v','ON_ERROR_STOP=1'],env};
  const readOnly={...executor,args:[...executor.args,...readOnlyPsqlSessionArgs]};
  const query=async (input,ex=readOnly)=>{const r=await executeInput(ex,input);assert.equal(r.code,0,'RESET219_SQL_FAILED');return r.stdout.trim();};
  report.networkAccess=true;report.stage='read-only-preflight';
  assert.equal(await query("SELECT current_setting('server_version_num')::integer/10000;"),'17','RESET219_POSTGRES17_REQUIRED');
  if(mode!=='resume')assert.deepEqual(JSON.parse(await query(historySql)),reference.appliedVersions,'RESET219_COMPLETE_HISTORY_REQUIRED');
  let state;
  if(mode==='resume'){
   await validateResetResume(session,readOnly);state=session.saved.state;report.previousAttempt={...session.previous,observedRecorded:session.observedHistory};report.plan=state.plan;
  }else{
   const original=JSON.parse(await readFile(path.join(workdir,'notification-before.json'),'utf8'));
   await verifyCatalogReadOnly(readOnly,output,reference,original,{beforeBuildDate:reference.buildUtcDate,afterBuildDate:new Date().toISOString().slice(0,10)},report,{strictApplicationAcl:true,assertReadyCatalog:assertReady219Catalog,expectedNotifications:expectedHeld217Notifications});
   state=await captureReset219({executor:readOnly,ownerId,reference});report.plan=state.plan;
   if(mode==='dry-run'){Object.assign(report,{ok:true,complete:true,exactCountsAvailable:true,stage:'read-only-preview-complete'});return report;}
   session=await prepareResetSession({workdir,output,ownerId,projectRef:TARGET.id,referenceSha256:report.reference.sha256,state,reference});
  }
  // All disk and source checks BEFORE the confirmation and first mutation.
  for(const m of reference.manifest){const source=await readFile(path.join(root,'supabase/migrations',m.name));assert.equal(sha256(await readFile(path.join(workdir,'supabase/migrations',m.name))),sha256(source),'RESET219_EXTERNAL_SQL_CHANGED');}
  const confirm=createInterface({input:process.stdin,output:process.stdout});
  try{
   console.log(JSON.stringify({plan:state.plan,previous:report.previousAttempt??null}));
   const phrase=mode==='resume'?'RESUME RESET219 '+TARGET.id+' '+ownerId:'RESET219 '+TARGET.id+' '+ownerId;
   assert.equal(await confirm.question('أوقف كل الكتابات. راجع السبب والنسخة والمرحلة السابقة. اكتب '+phrase+': '),phrase,'RESET219_DESTRUCTIVE_CONFIRMATION_REQUIRED');
  }finally{confirm.close();}
  guard=await holdUpgradeGuard(executor);
  const progress=await startResetAttempt(session,executor);
  const writer=session.executor;
  report.stage='reset';report.remoteWriteAttempted=true;report.reset=progress;
  report.retentionSnapshot={sha256:session.marker.snapshotSha256,path:session.marker.snapshotPath};
  const cliCall=async flags=>{guard.assertHeld();const childEnv={...env,SUPABASE_DB_PASSWORD:env.PGPASSWORD};
   try{return await exec(process.execPath,[cli,...flags,'--workdir',workdir,'--agent','no'],{cwd:workdir,env:childEnv,windowsHide:true,maxBuffer:8*1024**2});}
   catch{throw new Error('RESET219_OFFICIAL_CLI_FAILED');}finally{delete childEnv.PGPASSWORD;delete childEnv.SUPABASE_DB_PASSWORD;}};
  await reset219WithExecutor({executor:writer,root,reference,output,ownerId,report:report.reset,session,expectedPlan:state.plan,
   emptyStorage:async()=>{const names=JSON.parse(await query("SELECT COALESCE(jsonb_agg(name ORDER BY name),'[]'::jsonb) FROM storage.objects WHERE bucket_id='product-images';"));
    for(let n=0;n<names.length;n+=100)await cliCall(['storage','rm',...names.slice(n,n+100).map(name=>'ss:///product-images/'+name),'--experimental','--linked','--yes']);},
   deleteOtherAuth:async id=>{await query(`DELETE FROM auth.users WHERE id<>${sqlLiteral(uuid(id))}::uuid;`,executor);},
   clearHistory:async()=>{await cliCall(['migration','repair','--linked','--status','reverted',...reference.appliedVersions]);await query('DELETE FROM supabase_migrations.seed_files;',executor);},
   repair:async v=>{await cliCall(['migration','repair','--linked','--status','applied',v]);},
   finalDryRun:async()=>{await cliCall(['migration','list','--linked']);const r=await cliCall(['db','push','--linked','--dry-run','--skip-vault']);assert.match(r.stdout+r.stderr,/up to date/iu,'RESET219_FINAL_DRY_RUN_FAILED');}});
  report.functions=await functionReference(executor,219);
  await copyFile(path.join(workdir,'notification-before.json'),path.join(output,'previous-notification-before.json'));
  await writeFile(path.join(workdir,'notification-before.json'),JSON.stringify(report.reset.notificationOriginal,null,2)+'\n');
  assert.equal(report.reset.complete,true);Object.assign(report,{ok:true,complete:true,stage:'complete'});return report;
 }catch(error){
  report.ok=false;report.complete=false;
  report.code=/\bRESET(?:214|215|217|219)_[A-Z0-9_]+\b/u.exec(error.message)?.[0]??(error.code==='ENOENT'?'RESET219_REQUIRED_FILE_MISSING':'RESET219_PREFLIGHT_OR_OPERATION_FAILED');
  report.reasonArabic=reset219ArabicReason(report.code);
  report.recoveryRequired=report.reset?.destructiveStarted===true;return report;
 }finally{
  if(guard)try{await guard.close();}catch{report.ok=false;report.complete=false;report.code='RESET219_GUARD_CLOSE_FAILED';}
  if(env)delete env.PGPASSWORD;
  if(old)try{assert.equal(sha256(await readFile(path.join(root,'supabase/.temp/project-ref'))),sha256(old));}catch{report.ok=false;report.code='RESET219_OLD_LINK_CHANGED';}
  // Persist the completed report before archiving retention/removing the marker.
  if(report.ok&&session)try{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await finishResetSession(session);}catch{report.ok=false;report.code='RESET219_MARKER_CLEANUP_FAILED';}
  report.complete=report.ok===true;
  report.recoveryRequired=report.reset?.destructiveStarted===true&&!report.ok;
  let hasSnapshot=false;if(session&&!report.ok)try{await access(session.markerPath);await access(session.file);hasSnapshot=true;}catch{/* No durable state,no advertised resume. */}
  if(!report.ok)Object.assign(report,reset219ResumeDisposition(report.code,hasSnapshot));else report.resumable=false;
  report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const r=await runOwnerReset219(process.argv.slice(2));console.log(JSON.stringify({ok:r.ok,complete:r.complete,mode:r.mode,output:r.output,code:r.code,reasonArabic:r.reasonArabic,plan:r.plan,networkAccess:r.networkAccess,recoveryRequired:r.recoveryRequired,resumable:r.resumable}));if(!r.ok)process.exitCode=1;}
 catch(error){console.error(error?.code==='UPGRADE_BACKUP_TASKS_NOT_VISIBLE_RUN_AS_ADMINISTRATOR'?error.code:'RESET219_LOCAL_ADMISSION_FAILED');process.exitCode=1;}
}
