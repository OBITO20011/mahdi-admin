// Owner-operated 225→226. Auth and business data remain in place.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {historySql} from './frankfurt-owner-upgrade.mjs';
import {readReady226Reference,ready226ReferenceName} from './frankfurt-reference226.mjs';
import {read225SourceEvidence as read226SourceEvidence} from './frankfurt-owner-upgrade225.mjs';
import {DEFAULT_WORKDIR,OLD_REF,TARGET,assertOutsideRepository} from './frankfurt-owner-build.mjs';
import {executeInput} from './build-empty-supabase.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {sha256,canonicalLf} from '../testing/maintenance-db-contract.mjs';
import {readRealtimePublication} from '../testing/realtime151-contract.mjs';
import {compareApplicationAcl} from './application-acl-verification.mjs';
import {persistCatalogComparison} from './frankfurt-catalog-verification.mjs';
import {registeredBackupPreflight} from './backup-task-preflight.mjs';
import {operationalManifest,operationalSchema} from './operational-schema.mjs';
import {read226BackupEvidence,assert226ProtectionComplete} from './upgrade225-protection.mjs';
import {capture220RuntimeState as capture226RuntimeState,bind220CatalogTrigger as bind226CatalogTrigger} from './upgrade220-runtime-state.mjs';
import {assert224SourceRowsPreserved as assert226SourceRowsPreserved} from './upgrade224-data.mjs';
import {frozen220TriggerAclProfile as frozen226TriggerAclProfile,expectFrankfurt220TriggerAcl as expectFrankfurt226TriggerAcl} from './frozen220-trigger-acl.mjs';
import {checkRegistration226,pending225Registration,readPendingRegistration226,registrationFailure225,registrationState225Name,runUpgrade226Owner,saveRegistration225,sourceDigest225,upgrade225ErrorCode} from './upgrade225-registration.mjs';
const root=path.resolve(import.meta.dirname,'../..');
export const upgrade226Versions=Object.freeze(['226']);
export function assert226History(history,reference){
 const base=reference.prefixes['225'].appliedVersions;assert.equal(base.length,185);assert.deepEqual(reference.appliedVersions,[...base,'226']);
 assert.ok(Array.isArray(history)&&[185,186].includes(history.length),'UPGRADE226_REQUIRES_COMPLETE225_OR226');
 assert.deepEqual(history,reference.appliedVersions.slice(0,history.length),'UPGRADE226_UNREVIEWED_HISTORY');return reference.appliedVersions.slice(history.length);
}
export async function inputs226(reference){return Promise.all(reference.manifest.filter(m=>Number(m.name.slice(0,3))>138).map(async unit=>{
 const input=await readFile(path.join(root,'supabase/migrations',unit.name));assert.equal(sha256(canonicalLf(input.toString('utf8'))),unit.sha256,'UPGRADE226_PIN_MISMATCH');return {...unit,version:unit.name.slice(0,3),input};
}));}
async function verify226Prefix(executor,output,reference,version,runtime,report){
 const read=await executeInput(executor,schemaCatalogSql);assert.equal(read.code,0,'UPGRADE226_CATALOG_READ_FAILED');const observed=JSON.parse(read.stdout.trim()),prefix=reference.prefixes[version];assert.ok(prefix);
 const expected=bind226CatalogTrigger(prefix.catalog,runtime),dates={beforeBuildDate:prefix.buildUtcDate,afterBuildDate:new Date().toISOString().slice(0,10)};
 await writeFile(path.join(output,'catalog-observed.json'),JSON.stringify(observed,null,2)+'\n');
 assert.equal(frozen226TriggerAclProfile(observed.functions),'frankfurt','UPGRADE226_FRANKFURT_TRIGGER_ACL_REQUIRED');
 expected.functions=expectFrankfurt226TriggerAcl(expected.functions);
 // Compare the exact observed catalog against the Frankfurt-bound reference.
 await writeFile(path.join(output,'runtime-state.json'),JSON.stringify(runtime,null,2)+'\n');
 const comparison=await persistCatalogComparison(output,expected,observed,dates,report);assert.equal(comparison.unexpectedDifferenceCount,0,'UPGRADE226_UNEXPECTED_CATALOG_DIFFERENCE');
 const acl=compareApplicationAcl(expected,observed);await writeFile(path.join(output,'application-acl-comparison.json'),JSON.stringify(acl,null,2)+'\n');assert.equal(acl.ok,true,'UPGRADE226_ACL_MISMATCH');
 assert.deepEqual(await readRealtimePublication(executor),prefix.realtimePublication,'UPGRADE226_PUBLICATION_CHANGED');
 assert.deepEqual(await capture226RuntimeState(executor,reference),runtime,'UPGRADE226_RUNTIME_STATE_CHANGED');
 report.catalogUnexpectedDifferenceCount=0;report.runtimeStatePreserved=true;return observed;
}
const backupCommitment=({sha256,sourceEvidenceSha256,finishedAt})=>({sha256,sourceEvidenceSha256,finishedAt});
const sourceChanged=()=>registrationFailure225('UPGRADE_REGISTRATION_SOURCE_CHANGED');
const invalidState=()=>registrationFailure225('UPGRADE_REGISTRATION_STATE_INVALID');
const initializeReport=(report,backupEvidence)=>Object.assign(report,{
 applied:[],recorded:[],remoteWriteAttempted:false,targetCeiling:226,beforeBackup:backupCommitment(backupEvidence),
});

async function finishRegistration226({executor,reference,repair,finalDryRun,report,stateFile,state,before}){
 Object.assign(report,{stage:'repair-226',status:pending225Registration,registrationState:stateFile,nextAction:'RESUME_REGISTRATION_ONLY'});
 report.remoteWriteAttempted=true;
 try{await repair('226');}catch{throw registrationFailure225(pending225Registration);}
 const after=await read226SourceEvidence(executor);
 assert.deepEqual(after.history,reference.appliedVersions,'UPGRADE226_RECORD_AFTER_SUCCESS_ONLY');
 report.recorded.push('226');
 for(const key of ['catalog','roles','memberships','sequences','storage','pgNetSequenceState','preload'])assert.deepEqual(after[key],before[key],'UPGRADE226_PROTECTED_STATE_CHANGED:'+key);
 assert226SourceRowsPreserved(before,after);
 saveRegistration225(stateFile,{...state,status:'REGISTRATION_COMPLETE'});
 report.status='REGISTRATION_COMPLETE';
 report.stage='official-cli-dry-run';
 report.nextAction=undefined;
 await finalDryRun();
 Object.assign(report,{ok:true,complete:false,protectionPending:true,realtimeMembers:13,allBusinessRowsPreserved:true,nextAction:'BACKUP226_THEN_ISOLATED_RESTORE_THEN_VERIFY_ONLY'});
 return report;
}

export async function upgrade226WithExecutor({executor,reference,output,repair,finalDryRun,report={},backupEvidence}){
 assert.ok(backupEvidence,'UPGRADE226_BACKUP_EVIDENCE_REQUIRED');
 const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,'UPGRADE226_SQL_FAILED');return r.stdout.trim();};
 const current=JSON.parse(await sql(historySql)),pending=assert226History(current,reference);assert.deepEqual(pending,['226'],'UPGRADE226_ALREADY_APPLIED_USE_VERIFY_ONLY');
 const runtime=await capture226RuntimeState(executor,reference),before=await read226SourceEvidence(executor);
 assert.equal(sha256(JSON.stringify(before)),backupEvidence.sourceEvidenceSha256,'UPGRADE226_SOURCE_CHANGED_SINCE_BACKUP');
 initializeReport(report,backupEvidence);
 const pre=path.join(output,'preflight-prefix');await mkdir(pre);await verify226Prefix(executor,pre,reference,'225',runtime,report);
 const unit=(await inputs226(reference)).find(u=>u.version==='226');assert.ok(unit);
 report.stage='apply-226';report.remoteWriteAttempted=true;await sql(unit.input);report.applied.push('226');
 const post=path.join(output,'prefix-226');await mkdir(post);await verify226Prefix(executor,post,reference,'226',runtime,report);
 const applied=await read226SourceEvidence(executor);
 assert226SourceRowsPreserved(before,applied);
 // The exact catalog transition was checked above. Every other source commitment must still match.
 assert.equal(sourceDigest225({...applied,catalog:before.catalog}),backupEvidence.sourceEvidenceSha256,'UPGRADE226_PROTECTED_SOURCE_CHANGED_AFTER_SQL');
 const stateFile=path.join(output,registrationState225Name);
 const state={format:1,status:pending225Registration,projectRef:report.projectRef,targetCeiling:226,
  referenceSha256:sourceDigest225(reference),beforeBackup:backupCommitment(backupEvidence),
  sourceSha256:sourceDigest225(applied),runtimeSha256:sourceDigest225(runtime)};
 saveRegistration225(stateFile,state);
 return finishRegistration226({executor,reference,repair,finalDryRun,report,stateFile,state,before:applied});
}

export async function resume226Registration({executor,reference,output,workdir,repair,finalDryRun,report={},backupEvidence,registrationState}){
 const {file:stateFile,state}=await readPendingRegistration226(registrationState,workdir);
 if(state.format!==1||state.projectRef!==TARGET.id||report.projectRef!==TARGET.id||state.targetCeiling!==226
  ||state.referenceSha256!==sourceDigest225(reference)
  ||sourceDigest225(state.beforeBackup)!==sourceDigest225(backupCommitment(backupEvidence)))throw invalidState();
 let applied;
 try{
  const runtime=await capture226RuntimeState(executor,reference);
  assert.equal(sourceDigest225(runtime),state.runtimeSha256);
  applied=await read226SourceEvidence(executor);
  assert.deepEqual(applied.history,reference.prefixes['225'].appliedVersions);
  assert.equal(sourceDigest225(applied),state.sourceSha256);
  const oldCatalog=JSON.parse(await readFile(path.join(path.dirname(stateFile),'preflight-prefix','catalog-observed.json'),'utf8'));
  assert.equal(sourceDigest225({...applied,catalog:oldCatalog}),backupEvidence.sourceEvidenceSha256);
  await verify226Prefix(executor,output,reference,'226',runtime,report);
  assert.equal(sourceDigest225(await read226SourceEvidence(executor)),state.sourceSha256);
 }catch{throw sourceChanged();}
 initializeReport(report,backupEvidence);
 report.applied=['226'];
 report.resumedRegistration=true;
 return finishRegistration226({executor,reference,repair,finalDryRun,report,stateFile,state,before:applied});
}
export async function offline226(args){
 assert.ok(args.every((v,i)=>['--dry-run','--workdir'].includes(v)||args[i-1]==='--workdir'),'UNKNOWN_OFFLINE_OPTION');
 const at=args.indexOf('--workdir'),workdir=path.resolve(at<0?DEFAULT_WORKDIR:args[at+1]);assertOutsideRepository(workdir);assertOutsideRepository(await realpath(workdir),await realpath(root));
 assert.equal((await readFile(path.join(root,'supabase/.temp/project-ref'),'utf8')).trim(),OLD_REF);
 const reference=await readReady226Reference(root,path.join(workdir,ready226ReferenceName));await inputs226(reference);
 const output=path.join(workdir,'offline226-'+new Date().toISOString().replaceAll(/[:.]/gu,'-'));await mkdir(output);
 const report={ok:true,mode:'offline226',output,migrationCeiling:226,migrations:186,pending:['226'],prefix225Migrations:185,remoteWriteAttempted:false,networkAccess:false,latestHostedStateNotRead:true,localReferenceComparisonOnly:true,protectionRequired:'BACKUP225_BEFORE_APPLY_AND_BACKUP226_RESTORE_BEFORE_VERIFY_COMPLETE'};
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');return report;
}
export function upgrade226Arguments(args){
 const values=['--backup-evidence','--restore-evidence','--upgrade-report','--registration-state'],extra={},forward=[];
 for(let i=0;i<args.length;i++){const key=args[i];if(values.includes(key)){assert.ok(!extra[key]&&args[i+1]&&!args[i+1].startsWith('--'),'UPGRADE226_ONE_EVIDENCE_VALUE_REQUIRED');extra[key]=path.resolve(args[++i]);}else forward.push(key);}
 const modes=forward.filter(arg=>['--apply','--verify-only','--resume-registration','--preflight-registration','--dry-run'].includes(arg));
 assert.ok(modes.length<=1,'ONE_MODE_REQUIRED');
 const hasExactly=(...keys)=>Object.keys(extra).length===keys.length&&keys.every(key=>extra[key]);
 if(forward.includes('--apply'))assert.ok(hasExactly('--backup-evidence'),'UPGRADE226_BEFORE_BACKUP_REQUIRED');
 else if(forward.includes('--resume-registration'))assert.ok(hasExactly('--backup-evidence','--registration-state'),'UPGRADE226_PENDING_REGISTRATION_EVIDENCE_REQUIRED');
 else if(forward.includes('--verify-only'))assert.ok(hasExactly('--backup-evidence','--restore-evidence','--upgrade-report'),'UPGRADE226_BACKUP_RESTORE_APPLY_REPORT_REQUIRED');
 else assert.equal(Object.keys(extra).length,0,'UPGRADE226_OFFLINE_HAS_NO_PROTECTION_INPUT');
 return {forward,extra};
}
export async function run226(args,{preflight=registeredBackupPreflight,manifest=()=>operationalManifest(),runOwner=runUpgrade226Owner}={}){
 const {forward,extra}=upgrade226Arguments(args);let protection;
 if(forward.includes('--apply')||forward.includes('--resume-registration'))await preflight(root);
 if(forward.includes('--verify-only'))protection=await assert226ProtectionComplete({backupFile:extra['--backup-evidence'],restoreFile:extra['--restore-evidence'],upgradeFile:extra['--upgrade-report']});
 await manifest();assert.equal(operationalSchema.upgradeCommand,'frankfurt-owner-upgrade226','UPGRADE_ADAPTER_NOT_CURRENT');
 const loadBeforeBackup=()=>read226BackupEvidence(extra['--backup-evidence'],225);
 return runOwner(forward,{loadReference:readReady226Reference,referenceName:ready226ReferenceName,
  pipeline:async options=>upgrade226WithExecutor({...options,backupEvidence:await loadBeforeBackup()}),
  registration:{preflight:checkRegistration226,resume:async options=>resume226Registration({...options,
   backupEvidence:await loadBeforeBackup(),registrationState:extra['--registration-state']})},
  inputsFor:inputs226,offlinePlan:offline226,
  verifyReadOnly:async(executor,output,reference,_original,_dates,report)=>{const runtime=await capture226RuntimeState(executor,reference);await verify226Prefix(executor,output,reference,'226',runtime,report);assert.equal(sha256(JSON.stringify(await read226SourceEvidence(executor))),protection.afterSourceEvidenceSha256,'UPGRADE226_SOURCE_CHANGED_SINCE_RESTORE');Object.assign(report,{targetCeiling:226,complete:true,protectionPending:false,protection});}});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{
  const r=await run226(process.argv.slice(2));
  console.log(JSON.stringify({ok:r.ok,complete:r.complete,protectionPending:r.protectionPending,output:r.output,
   error:r.error,registrationPreflight:r.registrationPreflight,status:r.status,registrationState:r.registrationState,
   applied:r.applied,recorded:r.recorded,nextAction:r.nextAction,remoteWriteAttempted:r.remoteWriteAttempted}));
  if(!r.ok)process.exitCode=1;
 }catch(error){console.error(upgrade225ErrorCode(error));process.exitCode=1;}
}
