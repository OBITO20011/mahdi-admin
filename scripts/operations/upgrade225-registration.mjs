import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {copyFile,mkdir,readFile,readdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {createInterface} from 'node:readline/promises';
import {isDeepStrictEqual,promisify} from 'node:util';
import {writeAtomicUtf8} from '../agent/atomic-file.mjs';
import {verifiedSupabaseCa} from '../backup/supabase-ca.mjs';
import {canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {executeInput} from './build-empty-supabase.mjs';
import {TARGET,OLD_REF,DEFAULT_WORKDIR,assertOutsideRepository,connectionFromLink,ownerPassword} from './frankfurt-owner-build.mjs';
import {historySql,holdUpgradeGuard} from './frankfurt-owner-upgrade.mjs';
import {upgradePreparationCode} from './upgrade-preparation-errors.mjs';

const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile);
export const pending225Registration='SQL_APPLIED_REGISTRATION_PENDING';
export const registrationState225Name='registration-state.json';
export const sourceDigest225=value=>sha256(JSON.stringify(value));
const safeCodes=new Set([
 'UPGRADE_REGISTRATION_PREFLIGHT_FAILED',pending225Registration,
 'UPGRADE_REGISTRATION_STATE_INVALID','UPGRADE_REGISTRATION_SOURCE_CHANGED',
]);
export function registrationFailure225(code){
 assert.ok(safeCodes.has(code),'UNREVIEWED_REGISTRATION_FAILURE_CODE');
 return Object.assign(new Error(code),{code});
}
export function upgrade225ErrorCode(error){
 return safeCodes.has(error?.code)?error.code:upgradePreparationCode(error);
}

// Only the Remote column is history. Local-only pending files are expected.
function parseRemoteHistory(stdout){
 const {migrations}=JSON.parse(stdout);
 if(!Array.isArray(migrations)||!migrations.every(row=>row&&typeof row.local==='string'
   &&typeof row.remote==='string'&&/^\d*$/u.test(row.local)&&/^\d*$/u.test(row.remote)
   &&(row.local||row.remote)))throw new Error('Invalid history response');
 return migrations.map(row=>row.remote).filter(Boolean);
}

export const checkRegistration225=options=>checkRegistration(options,225,185);
export const checkRegistration226=options=>checkRegistration(options,226,186);
async function checkRegistration({cli,reference,mode},ceiling,files){
 try{
  const high=mode==='--verify-only',target=String(high?ceiling:ceiling-1);
  const expected=reference.prefixes[target].appliedVersions;
  const {stdout}=await cli(['migration','list','--linked','--output-format','json']);
  if(expected.length!==(high?files:files-1)||expected.at(-1)!==target
   || !isDeepStrictEqual(parseRemoteHistory(stdout),expected))throw new Error('Unexpected history');
  return {ceiling:Number(target),files:expected.length};
 }catch{
  // Even failed CLI output can include credentials or a connection URL.
  throw registrationFailure225('UPGRADE_REGISTRATION_PREFLIGHT_FAILED');
 }
}

export function saveRegistration225(file,state){
 writeAtomicUtf8(file,JSON.stringify(state,null,2)+'\n');
}

export const readPendingRegistration225=(file,workdir)=>readPendingRegistration(file,workdir,225);
export const readPendingRegistration226=(file,workdir)=>readPendingRegistration(file,workdir,226);
async function readPendingRegistration(file,workdir,ceiling){
 try{
  const real=await realpath(file);
  const run=path.dirname(real);
  if(path.basename(real)!==registrationState225Name||path.dirname(run)!==await realpath(workdir)
   || !new RegExp(`^upgrade${ceiling}-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z$`,'u').test(path.basename(run)))throw new Error('Invalid state path');
  const state=JSON.parse(await readFile(real,'utf8'));
  if(state.status!==pending225Registration)throw new Error('Registration is not pending');
  return {file:real,state};
 }catch{
  throw registrationFailure225('UPGRADE_REGISTRATION_STATE_INVALID');
 }
}

async function checkWorkspaceMigrations(workdir,reference,inputsFor,mode){
 const directory=path.join(workdir,'supabase/migrations');
 const existing=(await readdir(directory)).filter(file=>/^\d+_.+\.sql$/u.test(file));
 assert.ok(existing.every(file=>reference.manifest.some(unit=>unit.name===file)),'UNREVIEWED_WORKDIR_MIGRATION');
 for(const unit of reference.manifest.filter(unit=>Number(unit.name.slice(0,3))<=138)){
  const source=await readFile(path.join(directory,unit.name),'utf8');
  assert.equal(sha256(canonicalLf(source)),unit.sha256,'WORKDIR138_BYTES_CHANGED');
 }
 for(const unit of await inputsFor(reference)){
  const file=path.join(directory,unit.name);
  const source=await readFile(file,'utf8').catch(error=>{
   if(error.code==='ENOENT'&&mode==='--apply')return null;
   throw error;
  });
  if(source===null)await copyFile(path.join(root,'supabase/migrations',unit.name),file);
  else assert.equal(sha256(canonicalLf(source)),unit.sha256,'WORKDIR_UPGRADE_BYTES_CHANGED');
 }
}

// Keep earlier owner shells byte-identical. Both linked operations use this
// one 225 session and the original owner confirmation and hidden prompt.
export const runUpgrade225Owner=(args,configuration)=>runVersionedUpgradeOwner(args,configuration,225);
export const runUpgrade226Owner=(args,configuration)=>runVersionedUpgradeOwner(args,configuration,226);
async function runVersionedUpgradeOwner(args,configuration,ceiling){
 const at=args.indexOf('--workdir');
 const modes=at<0?args:args.filter((_arg,index)=>index!==at&&index!==at+1);
 const [mode='--dry-run']=modes;
 assert.ok(modes.length<=1&&['--apply','--dry-run','--verify-only','--preflight-registration','--resume-registration'].includes(mode)
  &&(at<0&&args.length===modes.length||at>=0&&args[at+1]&&!args[at+1].startsWith('--')),'UNKNOWN_OPTION');
 if(mode==='--dry-run')return configuration.offlinePlan(args);
 assert.ok(!process.env.SUPABASE_CLI_BINARY_OVERRIDE,'CLI_OVERRIDE_NOT_ALLOWED');
 const workdir=path.resolve(at<0?DEFAULT_WORKDIR:args[at+1]);
 assertOutsideRepository(workdir);assertOutsideRepository(await realpath(workdir),await realpath(root));
 const oldLinkFile=path.join(root,'supabase/.temp/project-ref');
 const oldLink=await readFile(oldLinkFile);
 assert.equal(oldLink.toString().trim(),OLD_REF,'OLD_BACKUP_LINK_CHANGED');
 assert.equal((await readFile(path.join(workdir,'supabase/.temp/project-ref'),'utf8')).trim(),TARGET.id,'LINK_TARGET_MISMATCH');
 const reference=await configuration.loadReference(root,path.join(workdir,configuration.referenceName));
 const connection=connectionFromLink(await readFile(path.join(workdir,'supabase/.temp/pooler-url'),'utf8'));
 const output=path.join(workdir,'upgrade'+ceiling+'-'+new Date().toISOString().replaceAll(/[:.]/gu,'-'));
 const report={mode:mode==='--apply'?'owner-apply'+ceiling:mode.slice(2),startedAt:new Date().toISOString(),projectRef:TARGET.id,remoteWriteAttempted:false};
 let env,guard;
 try{
  assert.ok(process.stdin.isTTY,'OWNER_INTERACTIVE_TERMINAL_REQUIRED');
  const ca=verifiedSupabaseCa();
  const terminal=createInterface({input:process.stdin,output:process.stdout});
  try{
   const target=await terminal.question(ceiling+' والمواءمة فقط؛ لا تفعيل إشعارات. اكتب '+TARGET.id+': ');
   assert.equal(target,TARGET.id,'OWNER_CONFIRMATION_REQUIRED');
  }finally{terminal.close();}
  env={...process.env,PGPASSWORD:await ownerPassword(),PGSSLMODE:'verify-full',PGSSLROOTCERT:ca.path,
   PGCONNECT_TIMEOUT:'10',PGPASSFILE:path.join(output,'NO_PASSWORD_FILE')};
  delete env.PGOPTIONS;delete env.SUPABASE_DB_PASSWORD;
  const cli=async flags=>{
   guard?.assertHeld();
   const childEnv={...env,SUPABASE_DB_PASSWORD:env.PGPASSWORD};
   try{
    return await exec(process.execPath,[path.join(root,'node_modules/supabase/dist/supabase.js'),
     ...flags,'--workdir',workdir,'--agent','no'],{cwd:workdir,env:childEnv,windowsHide:true,maxBuffer:8*1024**2});
   }catch{throw new Error('OFFICIAL_CLI_STEP_FAILED');}
   finally{delete childEnv.SUPABASE_DB_PASSWORD;delete childEnv.PGPASSWORD;}
  };
  report.registrationPreflight=await configuration.registration.preflight({cli,reference,mode});
  const readOnly=mode==='--verify-only'||mode==='--preflight-registration';
  const psql=process.env.NAWASRAH_PG_BIN?path.join(process.env.NAWASRAH_PG_BIN,'psql.exe')
   :path.join(process.env.LOCALAPPDATA,'NawasrahBackup/postgresql-17.11/bin/psql.exe');
  const executor={command:psql,args:[...connection,'-X','-q','-At','-w','-v','ON_ERROR_STOP=1',
   ...(readOnly?['-c','SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;','-f','-']:[])],env};
  const version=await executeInput(executor,"SELECT current_setting('server_version_num')::integer/10000;");
  assert.equal(version.code,0,'CONNECTED_VERSION_READ_FAILED');
  assert.equal(version.stdout.trim(),'17','POSTGRES_MAJOR_MISMATCH');
  if(mode==='--preflight-registration'){report.ok=true;return report;}
  const original=JSON.parse(await readFile(path.join(workdir,'notification-before.json'),'utf8'));
  await mkdir(output);report.output=output;
  if(mode==='--verify-only'){
   await configuration.verifyReadOnly(executor,output,reference,original,null,report);
   const history=await executeInput(executor,historySql);
   assert.equal(history.code,0);
   assert.deepEqual(JSON.parse(history.stdout.trim()),reference.appliedVersions);
   report.ok=true;
   return report;
  }
  await checkWorkspaceMigrations(workdir,reference,configuration.inputsFor,mode);
  guard=await holdUpgradeGuard(executor);
  const execute=mode==='--resume-registration'?configuration.registration.resume:configuration.pipeline;
  await execute({executor,reference,output,report,workdir,
   repair:async version=>{await cli(['migration','repair','--linked','--status','applied',version]);},
   finalDryRun:async()=>{
    await configuration.registration.preflight({cli,reference,mode:'--verify-only'});
    const dry=await cli(['db','push','--linked','--dry-run','--skip-vault']);
    assert.match(dry.stdout+dry.stderr,/up to date/iu,'PENDING_MIGRATIONS');
   }});
  return report;
 }catch(error){
  report.ok=false;report.error=upgrade225ErrorCode(error);
  return report;
 }finally{
  if(guard)try{await guard.close();}catch{report.ok=false;report.guardCloseError='UPGRADE_GUARD_CLOSE_FAILED';}
  if(env)delete env.PGPASSWORD;
  assert.equal(sha256(await readFile(oldLinkFile)),sha256(oldLink),'OLD_BACKUP_LINK_CHANGED');
  report.endedAt=new Date().toISOString();
  if(report.output)writeAtomicUtf8(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 }
}
