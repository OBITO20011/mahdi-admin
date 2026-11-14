// Owner-approved pre-launch222: additive explicit-price writers after220.
// Entry remains owner-operated; this PR authorizes no hosted invocation.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {run as ownerRun,historySql} from './frankfurt-owner-upgrade.mjs';
import {readReady222Reference,ready222ReferenceName,assertReady222Catalog} from './frankfurt-reference222.mjs';
import {assertReady220Catalog} from './frankfurt-reference220.mjs';
import {DEFAULT_WORKDIR,OLD_REF,assertOutsideRepository} from './frankfurt-owner-build.mjs';
import {executeInput} from './build-empty-supabase.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {sha256,canonicalLf} from '../testing/maintenance-db-contract.mjs';
import {readRealtimePublication} from '../testing/realtime151-contract.mjs';
import {compareApplicationAcl} from './application-acl-verification.mjs';
import {persistCatalogComparison} from './frankfurt-catalog-verification.mjs';
import {registeredBackupPreflight} from './backup-task-preflight.mjs';
import {operationalManifest,operationalSchema} from './operational-schema.mjs';
import {upgradePreparationCode} from './upgrade-preparation-errors.mjs';
import {SnapshotSession} from '../backup/snapshot-session.mjs';
import {captureEvidence} from '../backup/complete-backup.mjs';
import {read222BackupEvidence,assert222ProtectionComplete} from './upgrade222-protection.mjs';
import {capture220RuntimeState as capture222RuntimeState,bind220CatalogTrigger as bind222CatalogTrigger} from './upgrade220-runtime-state.mjs';
import {assert222SourceRowsPreserved} from './upgrade222-data.mjs';
import {frozen220TriggerAclProfile as frozen222TriggerAclProfile,expectFrankfurt220TriggerAcl as expectFrankfurt222TriggerAcl} from './frozen220-trigger-acl.mjs';
const root=path.resolve(import.meta.dirname,'../..');
export const upgrade222Versions=Object.freeze(['222']);
export function assert222History(history,reference){
 const base=reference.prefixes['220'].appliedVersions;assert.equal(base.length,181);assert.deepEqual(reference.appliedVersions,[...base,'222']);
 assert.ok(Array.isArray(history)&&[181,182].includes(history.length),'UPGRADE222_REQUIRES_COMPLETE220_OR222');
 assert.deepEqual(history,reference.appliedVersions.slice(0,history.length),'UPGRADE222_UNREVIEWED_HISTORY');return reference.appliedVersions.slice(history.length);
}
export async function inputs222(reference){return Promise.all(reference.manifest.filter(m=>Number(m.name.slice(0,3))>138).map(async unit=>{
 const input=await readFile(path.join(root,'supabase/migrations',unit.name));assert.equal(sha256(canonicalLf(input.toString('utf8'))),unit.sha256,'UPGRADE222_PIN_MISMATCH');return {...unit,version:unit.name.slice(0,3),input};
}));}
export async function read222SourceEvidence(executor){
 const session=new SnapshotSession(executor.command,executor.args,executor.env??process.env);
 try{await session.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;');return await captureEvidence(session);}finally{await session.close();}
}
async function verify222Prefix(executor,output,reference,version,runtime,report){
 const read=await executeInput(executor,schemaCatalogSql);assert.equal(read.code,0,'UPGRADE222_CATALOG_READ_FAILED');const observed=JSON.parse(read.stdout.trim()),prefix=reference.prefixes[version];assert.ok(prefix);
 const expected=bind222CatalogTrigger(prefix.catalog,runtime),dates={beforeBuildDate:prefix.buildUtcDate,afterBuildDate:new Date().toISOString().slice(0,10)};
 await writeFile(path.join(output,'catalog-observed.json'),JSON.stringify(observed,null,2)+'\n');
 assert.equal(frozen222TriggerAclProfile(observed.functions),'frankfurt','UPGRADE222_FRANKFURT_TRIGGER_ACL_REQUIRED');
 expected.functions=expectFrankfurt222TriggerAcl(expected.functions);
 // Compare the exact observed catalog against the Frankfurt-bound reference.
 await writeFile(path.join(output,'runtime-state.json'),JSON.stringify(runtime,null,2)+'\n');
 const comparison=await persistCatalogComparison(output,expected,observed,dates,report);assert.equal(comparison.unexpectedDifferenceCount,0,'UPGRADE222_UNEXPECTED_CATALOG_DIFFERENCE');
 const acl=compareApplicationAcl(expected,observed);await writeFile(path.join(output,'application-acl-comparison.json'),JSON.stringify(acl,null,2)+'\n');assert.equal(acl.ok,true,'UPGRADE222_ACL_MISMATCH');
 if(version==='220')assertReady220Catalog(observed,{notificationTriggerEnabled:runtime.notifications.trigger.enabled});else assertReady222Catalog(observed,{notificationTriggerEnabled:runtime.notifications.trigger.enabled});
 assert.deepEqual(await readRealtimePublication(executor),prefix.realtimePublication,'UPGRADE222_PUBLICATION_CHANGED');
 assert.deepEqual(await capture222RuntimeState(executor,reference),runtime,'UPGRADE222_RUNTIME_STATE_CHANGED');
 report.catalogUnexpectedDifferenceCount=0;report.runtimeStatePreserved=true;return observed;
}
export async function upgrade222WithExecutor({executor,reference,output,repair,finalDryRun,report={},backupEvidence}){
 assert.ok(backupEvidence,'UPGRADE222_BACKUP_EVIDENCE_REQUIRED');
 const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,'UPGRADE222_SQL_FAILED');return r.stdout.trim();};
 const current=JSON.parse(await sql(historySql)),pending=assert222History(current,reference);assert.deepEqual(pending,['222'],'UPGRADE222_ALREADY_APPLIED_USE_VERIFY_ONLY');
 const runtime=await capture222RuntimeState(executor,reference),before=await read222SourceEvidence(executor);
 assert.equal(sha256(JSON.stringify(before)),backupEvidence.sourceEvidenceSha256,'UPGRADE222_SOURCE_CHANGED_SINCE_BACKUP');
 Object.assign(report,{applied:[],recorded:[],remoteWriteAttempted:false,targetCeiling:222,beforeBackup:{sha256:backupEvidence.sha256,sourceEvidenceSha256:backupEvidence.sourceEvidenceSha256,finishedAt:backupEvidence.finishedAt}});
 const pre=path.join(output,'preflight-prefix');await mkdir(pre);await verify222Prefix(executor,pre,reference,'220',runtime,report);
 const unit=(await inputs222(reference)).find(u=>u.version==='222');assert.ok(unit);
 report.stage='apply-222';report.remoteWriteAttempted=true;await sql(unit.input);report.applied.push('222');
 const post=path.join(output,'prefix-222');await mkdir(post);await verify222Prefix(executor,post,reference,'222',runtime,report);
 report.stage='repair-222';await repair('222');report.recorded.push('222');assert.deepEqual(JSON.parse(await sql(historySql)),reference.appliedVersions,'UPGRADE222_RECORD_AFTER_SUCCESS_ONLY');
 const after=await read222SourceEvidence(executor);
 // Only the officially recorded history row and reviewed DDL may differ.
 for(const key of ['roles','memberships','sequences','storage','pgNetSequenceState','preload'])assert.deepEqual(after[key],before[key],'UPGRADE222_PROTECTED_STATE_CHANGED:'+key);
 assert222SourceRowsPreserved(before,after);
 await finalDryRun();Object.assign(report,{ok:true,complete:false,protectionPending:true,realtimeMembers:13,allBusinessRowsPreserved:true,nextAction:'BACKUP222_THEN_ISOLATED_RESTORE_THEN_VERIFY_ONLY'});return report;
}
export async function offline222(args){
 assert.ok(args.every((v,i)=>['--dry-run','--workdir'].includes(v)||args[i-1]==='--workdir'),'UNKNOWN_OFFLINE_OPTION');
 const at=args.indexOf('--workdir'),workdir=path.resolve(at<0?DEFAULT_WORKDIR:args[at+1]);assertOutsideRepository(workdir);assertOutsideRepository(await realpath(workdir),await realpath(root));
 assert.equal((await readFile(path.join(root,'supabase/.temp/project-ref'),'utf8')).trim(),OLD_REF);
 const reference=await readReady222Reference(root,path.join(workdir,ready222ReferenceName));await inputs222(reference);
 const output=path.join(workdir,'offline222-'+new Date().toISOString().replaceAll(/[:.]/gu,'-'));await mkdir(output);
 const report={ok:true,mode:'offline222',output,migrationCeiling:222,migrations:182,pending:['222'],prefix220Migrations:181,remoteWriteAttempted:false,networkAccess:false,latestHostedStateNotRead:true,localReferenceComparisonOnly:true,protectionRequired:'BACKUP220_BEFORE_APPLY_AND_BACKUP222_RESTORE_BEFORE_VERIFY_COMPLETE'};
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');return report;
}
export function upgrade222Arguments(args){
 const values=['--backup-evidence','--restore-evidence','--upgrade-report'],extra={},forward=[];
 for(let i=0;i<args.length;i++){const key=args[i];if(values.includes(key)){assert.ok(!extra[key]&&args[i+1]&&!args[i+1].startsWith('--'),'UPGRADE222_ONE_EVIDENCE_VALUE_REQUIRED');extra[key]=path.resolve(args[++i]);}else forward.push(key);}
 if(forward.includes('--apply'))assert.ok(extra['--backup-evidence']&&!extra['--restore-evidence']&&!extra['--upgrade-report'],'UPGRADE222_BEFORE_BACKUP_REQUIRED');
 else if(forward.includes('--verify-only'))assert.ok(values.every(k=>extra[k]),'UPGRADE222_BACKUP_RESTORE_APPLY_REPORT_REQUIRED');
 else assert.equal(Object.keys(extra).length,0,'UPGRADE222_OFFLINE_HAS_NO_PROTECTION_INPUT');
 return {forward,extra};
}
export async function run222(args,{preflight=registeredBackupPreflight,manifest=()=>operationalManifest(),runOwner=ownerRun}={}){
 const {forward,extra}=upgrade222Arguments(args);let backupEvidence,protection;
 if(forward.includes('--apply')){await preflight(root);backupEvidence=await read222BackupEvidence(extra['--backup-evidence'],220);}
 if(forward.includes('--verify-only'))protection=await assert222ProtectionComplete({backupFile:extra['--backup-evidence'],restoreFile:extra['--restore-evidence'],upgradeFile:extra['--upgrade-report']});
 await manifest();assert.equal(operationalSchema.upgradeCommand,'frankfurt-owner-upgrade222','UPGRADE_ADAPTER_NOT_CURRENT');
 return runOwner(forward,{loadReference:readReady222Reference,referenceName:ready222ReferenceName,pipeline:options=>upgrade222WithExecutor({...options,backupEvidence}),inputsFor:inputs222,versions:upgrade222Versions,label:'222',offlinePlan:offline222,
  verifyReadOnly:async(executor,output,reference,_original,_dates,report)=>{const runtime=await capture222RuntimeState(executor,reference);await verify222Prefix(executor,output,reference,'222',runtime,report);assert.equal(sha256(JSON.stringify(await read222SourceEvidence(executor))),protection.afterSourceEvidenceSha256,'UPGRADE222_SOURCE_CHANGED_SINCE_RESTORE');Object.assign(report,{targetCeiling:222,complete:true,protectionPending:false,protection});}});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{const r=await run222(process.argv.slice(2));console.log(JSON.stringify({ok:r.ok,complete:r.complete,protectionPending:r.protectionPending,output:r.output,error:r.error,applied:r.applied,recorded:r.recorded,nextAction:r.nextAction,remoteWriteAttempted:r.remoteWriteAttempted}));if(!r.ok)process.exitCode=1;}catch(error){console.error(upgradePreparationCode(error));process.exitCode=1;}}
