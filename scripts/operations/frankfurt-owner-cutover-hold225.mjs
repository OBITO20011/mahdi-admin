import assert from 'node:assert/strict';
import {readFile,realpath,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createInterface} from 'node:readline/promises';
import {pathToFileURL} from 'node:url';
import {verifiedSupabaseCa} from '../backup/supabase-ca.mjs';
import {manifestDigest,sha256} from '../testing/maintenance-db-contract.mjs';
import {executeInput} from './build-empty-supabase.mjs';
import {DEFAULT_WORKDIR,OLD_REF,TARGET,assertOutsideRepository,connectionFromLink,ownerPassword} from './frankfurt-owner-build.mjs';
import {historySql,holdUpgradeGuard} from './frankfurt-owner-upgrade.mjs';
import {read225SourceEvidence} from './frankfurt-owner-upgrade225.mjs';
import {readReady222Reference,ready222ReferenceName} from './frankfurt-reference222.mjs';
import {readReady225Reference,ready225ReferenceName} from './frankfurt-reference225.mjs';
import {heldJobNames,notificationSnapshotSql} from './frankfurt-notification-hold.mjs';
import {ownerTelegramJob} from './owner-telegram217-notifications.mjs';
import {assert220Notifications,upgrade220ServerBindingSql} from './upgrade220-runtime-state.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const evidenceName='cutover-hold225-original.json';
const cleanupJob='cleanup-guest-order-gateway-requests';
export const cutoverHoldJobs=Object.freeze([cleanupJob,...heldJobNames,ownerTelegramJob.name]);
const hash=/^[0-9a-f]{64}$/u;
const query=sql=>sql.replace(/^BEGIN READ ONLY;/u,'').replace(/;ROLLBACK;$/u,'');
const historySelect=query(historySql);
const notificationSelect=query(notificationSnapshotSql);
const bindingSelect=query(upgrade220ServerBindingSql);
const ordersClosed="(SELECT count(*)=1 AND bool_and(NOT orders_enabled) FROM public.storefront_settings)";
const hasExactlyOneSetting="(SELECT count(*)=1 FROM public.storefront_settings)";
const leaseIdle="(SELECT count(*)=1 AND bool_and(id AND run_id IS NULL AND (lease_expires_at IS NULL OR lease_expires_at<clock_timestamp())) FROM public.owner_telegram_dispatch_settings)";
const dispatchOff="(SELECT count(*)=1 AND bool_and(id AND NOT enabled) FROM public.owner_telegram_dispatch_settings)";
const stateSelect=`SELECT jsonb_build_object('history',(${historySelect}),'notifications',(${notificationSelect}),
 'binding',(${bindingSelect}),'ordersClosed',${ordersClosed},'singleSetting',${hasExactlyOneSetting},
 'leaseIdle',${leaseIdle},'dispatchOff',${dispatchOff})`;
const sqlJson=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";

export function parseCutoverHoldArgs(args){
 const flags=new Set();
 const options={phase:'',mode:'dry-run',workdir:DEFAULT_WORKDIR,verification:null};
 const modes=['--apply','--dry-run','--verify','--plan'];
 for(let i=0;i<args.length;i++){
  const flag=args[i];
  assert.ok(!flags.has(flag),'CUTOVER_HOLD_DUPLICATE_OPTION');
  flags.add(flag);
  if(['--hold-upgrade','--hold-reset'].includes(flag)){
   assert.ok(!options.phase,'CUTOVER_HOLD_ONE_PHASE_REQUIRED');
   options.phase=flag.slice(7);
  }else if(modes.includes(flag)){
   options.mode=flag.slice(2);
  }else if(flag==='--workdir'||flag==='--verify-report'){
   const value=args[++i];
   assert.ok(value&&!value.startsWith('--'),'CUTOVER_HOLD_OPTION_VALUE_REQUIRED');
   if(flag==='--workdir')options.workdir=path.resolve(value);
   else options.verification=path.resolve(value);
  }else assert.fail('CUTOVER_HOLD_UNKNOWN_OPTION');
 }
 assert.ok(options.phase,'CUTOVER_HOLD_PHASE_REQUIRED');
 assert.ok(modes.filter(flag=>flags.has(flag)).length<=1,'CUTOVER_HOLD_ONE_MODE_REQUIRED');
 assert.equal(Boolean(options.verification),options.phase==='reset'&&['apply','dry-run'].includes(options.mode),
  'CUTOVER_HOLD_RESET_VERIFY_REPORT_REQUIRED');
 return options;
}

async function readState(executor,reference,phase){
 const result=await executeInput(executor,`BEGIN READ ONLY;${stateSelect};ROLLBACK;`);
 assert.equal(result.code,0,'CUTOVER_HOLD_STATE_READ_FAILED');
 const state=JSON.parse(result.stdout.trim());
 const expected=phase==='upgrade'?reference.appliedVersions.filter(v=>Number(v)<=220):reference.appliedVersions;
 assert.equal(expected.length,phase==='upgrade'?181:185,'CUTOVER_HOLD_REFERENCE_HISTORY_INVALID');
 assert.deepEqual(state.history,expected,'CUTOVER_HOLD_HISTORY_MISMATCH');
 assert.equal(state.singleSetting,true,'CUTOVER_HOLD_STOREFRONT_SETTING_REQUIRED');
 assert.equal(state.leaseIdle,true,'CUTOVER_HOLD_DISPATCH_LEASE_MUST_BE_IDLE');
 assert.deepEqual(state.notifications.jobs.map(j=>j.name).sort(),[...cutoverHoldJobs].sort(),'CUTOVER_HOLD_CRON_INVENTORY_MISMATCH');
 assert220Notifications(state.notifications,reference.notificationSnapshot,{serverBinding:state.binding});
 return state;
}

function reportState(state){
 return {ordersClosed:state.ordersClosed,triggerEnabled:state.notifications.trigger.enabled,dispatchEnabled:!state.dispatchOff,historyCeiling:Number(state.history.at(-1)),historyFiles:state.history.length,
  jobs:state.notifications.jobs.map(({id,name,active})=>({id,name,active}))};
}
function matchesHold(state,phase){
 return state.notifications.jobs.every(job=>job.active===(phase==='reset'&&job.name===cleanupJob));
}
function fullyHeld(state,phase){
 return state.ordersClosed&&matchesHold(state,phase)
  &&(phase==='upgrade'||state.notifications.trigger.enabled==='D'&&state.dispatchOff);
}
function assertHold(state,phase){
 assert.equal(state.ordersClosed,true,'CUTOVER_HOLD_ORDERS_STILL_OPEN');
 assert.ok(matchesHold(state,phase),'CUTOVER_HOLD_CRON_STATE_MISMATCH');
 if(phase==='reset'){
  assert.equal(state.notifications.trigger.enabled,'D','CUTOVER_HOLD_RESET_TRIGGER_MUST_BE_HELD');
  assert.equal(state.dispatchOff,true,'CUTOVER_HOLD_RESET_DISPATCH_MUST_BE_DISABLED');
 }
}
function snapshotIdentity(state){
 const {notifications,binding}=state;
 return sha256(JSON.stringify({binding,trigger:{...notifications.trigger,enabled:null},jobs:notifications.jobs.map(job=>({...job,active:null}))}));
}
const baseManifestDigest=reference=>manifestDigest(reference.manifest.filter(unit=>Number(unit.name.slice(0,3))<=220));
async function originalEvidence(file,reference,state){
 const evidence=JSON.parse(await readFile(file,'utf8'));
 assert.equal(evidence.format,1,'CUTOVER_HOLD_EVIDENCE_FORMAT');
 assert.equal(evidence.projectRef,TARGET.id,'CUTOVER_HOLD_EVIDENCE_PROJECT');
 assert.equal(evidence.baseManifestDigest,baseManifestDigest(reference),'CUTOVER_HOLD_EVIDENCE_REFERENCE');
 assert.equal(evidence.original.historyCeiling,220,'CUTOVER_HOLD_EVIDENCE_ORIGINAL_CEILING');
 assert.equal(evidence.original.historyFiles,181,'CUTOVER_HOLD_EVIDENCE_ORIGINAL_HISTORY');
 assert.equal(evidence.inventorySha256,snapshotIdentity(state),'CUTOVER_HOLD_EVIDENCE_INVENTORY');
 assert.deepEqual(evidence.original.jobs.map(({id,name})=>({id,name})),
  reportState(state).jobs.map(({id,name})=>({id,name})),'CUTOVER_HOLD_EVIDENCE_JOB_IDENTITY');
 assert.ok(evidence.original.jobs.every(job=>typeof job.active==='boolean')&&typeof evidence.original.ordersClosed==='boolean'
  &&['O','D'].includes(evidence.original.triggerEnabled)&&typeof evidence.original.dispatchEnabled==='boolean',
  'CUTOVER_HOLD_EVIDENCE_ORIGINAL_REQUIRED');
 return evidence;
}
async function saveOriginal(file,reference,state){
 const saved={format:1,projectRef:TARGET.id,baseManifestDigest:baseManifestDigest(reference),inventorySha256:snapshotIdentity(state),
  capturedAt:new Date().toISOString(),original:reportState(state)};
 try{await writeFile(file,JSON.stringify(saved,null,2)+'\n',{flag:'wx'});}
 catch(error){if(error.code!=='EEXIST')throw error;}
 await originalEvidence(file,reference,state);
}
async function assertVerified225(file,executor,reference,checkSource){
 const verified=JSON.parse(await readFile(file,'utf8'));
 assert.ok(verified.projectRef===TARGET.id&&verified.mode==='verify-only'&&verified.ok===true&&verified.complete===true&&verified.targetCeiling===225
  &&verified.remoteWriteAttempted===false&&verified.protectionPending===false
  &&verified.protection?.strictIsolatedRestore===true&&verified.protection?.complete===true
  &&hash.test(verified.protection.afterArchiveSha256)&&hash.test(verified.protection.afterSourceEvidenceSha256),
 'CUTOVER_HOLD_VERIFIED_225_REQUIRED');
 if(!checkSource)return;
 const evidence=await read225SourceEvidence(executor);
 assert.deepEqual(evidence.history,reference.appliedVersions,'CUTOVER_HOLD_VERIFY_HISTORY_CHANGED');
 assert.equal(sha256(JSON.stringify(evidence)),verified.protection.afterSourceEvidenceSha256,
  'CUTOVER_HOLD_SOURCE_CHANGED_SINCE_VERIFY225');
}

function transitionSql(before,phase){
 const after=structuredClone(before);
 after.ordersClosed=true;
 if(phase==='reset'){
  after.notifications.trigger.enabled='D';
  after.dispatchOff=true;
 }
 const changes=after.notifications.jobs.filter(job=>{
  const desired=phase==='reset'&&job.name===cleanupJob;
  if(job.active===desired)return false;
  job.active=desired;
  return true;
 });
 const changeJobs=changes.map(job=>`PERFORM cron.alter_job(${job.id}::bigint,active:=${job.active});`).join('\n');
 return `\\set VERBOSITY verbose
 BEGIN ISOLATION LEVEL SERIALIZABLE;
 SET LOCAL lock_timeout='5s';
 SET LOCAL search_path=pg_catalog,public,pg_temp;
 ${phase==='reset'&&before.notifications.trigger.enabled!=='D'?'LOCK TABLE public.orders IN ACCESS EXCLUSIVE MODE;':''}
 LOCK TABLE public.storefront_settings,public.owner_telegram_dispatch_settings IN SHARE ROW EXCLUSIVE MODE;
 DO $cutover_hold$ BEGIN
 IF (${stateSelect}) IS DISTINCT FROM ${sqlJson(before)} THEN RAISE EXCEPTION 'CUTOVER_HOLD_PRECONDITION_CHANGED';END IF;
 ${before.ordersClosed?'':"UPDATE public.storefront_settings SET orders_enabled=false,updated_at=clock_timestamp() WHERE orders_enabled;"}
 ${phase==='reset'&&before.notifications.trigger.enabled!=='D'?'ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;':''}
 ${phase==='reset'&&!before.dispatchOff?'UPDATE public.owner_telegram_dispatch_settings SET enabled=false WHERE enabled;':''}
 ${changeJobs}
 IF (${stateSelect}) IS DISTINCT FROM ${sqlJson(after)} THEN RAISE EXCEPTION 'CUTOVER_HOLD_POSTCONDITION_FAILED';END IF;
 END $cutover_hold$;
 COMMIT;`;
}

// The sole injection seam is for the disconnected archive rehearsal.
export async function cutoverHoldWithExecutor({executor,reference,phase,mode,evidenceFile,verification=null}){
 assert.ok(['upgrade','reset'].includes(phase)&&['dry-run','apply','verify'].includes(mode),'CUTOVER_HOLD_INVALID_MODE');
 const before=await readState(executor,reference,phase);
 if(mode==='verify'){
  assertHold(before,phase);
  return {ok:true,phase,mode,remoteWriteAttempted:false,...reportState(before)};
 }
 if(phase==='reset'){
  assert.equal(before.ordersClosed,true,'CUTOVER_HOLD_ORDERS_STILL_OPEN');
  await originalEvidence(evidenceFile,reference,before);
  assert.ok(matchesHold(before,'upgrade')||matchesHold(before,'reset'),'CUTOVER_HOLD_RESET_REQUIRES_UPGRADE_HOLD');
  // 225's verify-only proof binds the exact database state before cleanup resumes.
  // Repeating the RESET hold when it is already in effect performs no write.
  await assertVerified225(verification,executor,reference,!fullyHeld(before,'reset'));
 }
 if(mode==='dry-run')return {ok:true,phase,mode,remoteWriteAttempted:false,before:reportState(before),
  requested:{ordersClosed:true,activeJobs:phase==='reset'?[cleanupJob]:[],
   triggerEnabled:phase==='reset'?'D':before.notifications.trigger.enabled,
   dispatchEnabled:phase==='reset'?false:!before.dispatchOff}};
 if(phase==='upgrade')await saveOriginal(evidenceFile,reference,before);
 const noOp=fullyHeld(before,phase);
 if(!noOp){
  const result=await executeInput(executor,transitionSql(before,phase));
  const code=result.stderr.match(/\bCUTOVER_HOLD_(?:PRECONDITION_CHANGED|POSTCONDITION_FAILED)\b/u)?.[0]??'CUTOVER_HOLD_TRANSACTION_FAILED';
  assert.equal(result.code,0,code);
 }
 const after=await readState(executor,reference,phase);
 assertHold(after,phase);
 assert.equal(snapshotIdentity(after),snapshotIdentity(before),'CUTOVER_HOLD_POSTCONDITION_INVENTORY_CHANGED');
 return {ok:true,phase,mode,remoteWriteAttempted:!noOp,noOp,evidenceFile,...reportState(after)};
}

export async function runCutoverHold225(args){
 const options=parseCutoverHoldArgs(args);
 if(options.mode==='plan')return {ok:true,phase:options.phase,mode:'plan',networkAccess:false,
  remoteWriteAttempted:false,dryRunDefault:true,applyRequiresOwner:true};
 const workdir=await realpath(options.workdir);
 assertOutsideRepository(workdir,await realpath(root));
 if(options.verification)assertOutsideRepository(await realpath(options.verification),await realpath(root));
 assert.equal((await readFile(path.join(root,'supabase/.temp/project-ref'),'utf8')).trim(),OLD_REF,'CUTOVER_HOLD_REPOSITORY_LINK_CHANGED');
 assert.equal((await readFile(path.join(workdir,'supabase/.temp/project-ref'),'utf8')).trim(),TARGET.id,'CUTOVER_HOLD_TARGET_LINK_MISMATCH');
 const reference=options.phase==='upgrade'
  ?await readReady222Reference(root,path.join(workdir,ready222ReferenceName))
  :await readReady225Reference(root,path.join(workdir,ready225ReferenceName));
 const connection=connectionFromLink(await readFile(path.join(workdir,'supabase/.temp/pooler-url'),'utf8'));
 const ca=verifiedSupabaseCa();
 assert.ok(process.stdin.isTTY,'CUTOVER_HOLD_OWNER_TERMINAL_REQUIRED');
 const terminal=createInterface({input:process.stdin,output:process.stdout});
 try{assert.equal(await terminal.question(`مرحلة تجميد ${options.phase}. للتأكيد اكتب ${TARGET.id}: `),TARGET.id,'CUTOVER_HOLD_OWNER_CONFIRMATION_REQUIRED');}
 finally{terminal.close();}
 const env={...process.env,PGPASSWORD:await ownerPassword(),PGSSLMODE:'verify-full',PGSSLROOTCERT:ca.path,
  PGCONNECT_TIMEOUT:'10',PGPASSFILE:path.join(workdir,'NO_PASSWORD_FILE')};
 delete env.PGOPTIONS;
 delete env.SUPABASE_DB_PASSWORD;
 const command=process.env.NAWASRAH_PG_BIN?path.join(process.env.NAWASRAH_PG_BIN,'psql.exe')
  :path.join(process.env.LOCALAPPDATA,'NawasrahBackup/postgresql-17.11/bin/psql.exe');
 const executor={command,args:[...connection,'-X','-q','-At','-w','-v','ON_ERROR_STOP=1'],env};
 let guard;
 try{
  if(options.mode==='apply')guard=await holdUpgradeGuard(executor);
  return await cutoverHoldWithExecutor({...options,executor,reference,evidenceFile:path.join(workdir,evidenceName)});
 }finally{
  try{if(guard)await guard.close();}
  finally{delete env.PGPASSWORD;}
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{console.log(JSON.stringify(await runCutoverHold225(process.argv.slice(2))));}
 catch(error){
  // A receipt, connection error or assertion diff can contain live settings.
  const code=String(error.message).match(/^CUTOVER_HOLD_[A-Z0-9_]+/u)?.[0]??'CUTOVER_HOLD_ABORTED';
  console.error(JSON.stringify({ok:false,code}));
  process.exitCode=1;
 }
}
