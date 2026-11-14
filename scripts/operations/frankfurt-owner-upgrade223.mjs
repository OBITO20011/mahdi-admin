// Owner-operated upgrade from 222 to the optional OFF quantity counter.
// Entry remains owner-operated; this PR authorizes no hosted invocation.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {run as ownerRun,historySql} from './frankfurt-owner-upgrade.mjs';
import {readReady223Reference,ready223ReferenceName,assertReady223Catalog} from './frankfurt-reference223.mjs';
import {assertReady222Catalog} from './independent-prices222-catalog.mjs';
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
import {read223BackupEvidence,assert223ProtectionComplete} from './upgrade223-protection.mjs';
import {capture220RuntimeState as capture223RuntimeState,bind220CatalogTrigger as bind223CatalogTrigger} from './upgrade220-runtime-state.mjs';
import {assert223SourceRowsPreserved} from './upgrade223-data.mjs';
import {frozen220TriggerAclProfile as frozen223TriggerAclProfile,expectFrankfurt220TriggerAcl as expectFrankfurt223TriggerAcl} from './frozen220-trigger-acl.mjs';
const root=path.resolve(import.meta.dirname,'../..');
export const upgrade223Versions=Object.freeze(['223']);
export function assert223History(history,reference){
 const base=reference.prefixes['222'].appliedVersions;assert.equal(base.length,182);assert.deepEqual(reference.appliedVersions,[...base,'223']);
 assert.ok(Array.isArray(history)&&[182,183].includes(history.length),'UPGRADE223_REQUIRES_COMPLETE222_OR223');
 assert.deepEqual(history,reference.appliedVersions.slice(0,history.length),'UPGRADE223_UNREVIEWED_HISTORY');return reference.appliedVersions.slice(history.length);
}
export async function inputs223(reference){return Promise.all(reference.manifest.filter(m=>Number(m.name.slice(0,3))>138).map(async unit=>{
 const input=await readFile(path.join(root,'supabase/migrations',unit.name));assert.equal(sha256(canonicalLf(input.toString('utf8'))),unit.sha256,'UPGRADE223_PIN_MISMATCH');return {...unit,version:unit.name.slice(0,3),input};
}));}
export async function read223SourceEvidence(executor){
 const session=new SnapshotSession(executor.command,executor.args,executor.env??process.env);
 try{await session.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;');return await captureEvidence(session);}finally{await session.close();}
}
async function verify223Prefix(executor,output,reference,version,runtime,report){
 const read=await executeInput(executor,schemaCatalogSql);assert.equal(read.code,0,'UPGRADE223_CATALOG_READ_FAILED');const observed=JSON.parse(read.stdout.trim()),prefix=reference.prefixes[version];assert.ok(prefix);
 const expected=bind223CatalogTrigger(prefix.catalog,runtime),dates={beforeBuildDate:prefix.buildUtcDate,afterBuildDate:new Date().toISOString().slice(0,10)};
 await writeFile(path.join(output,'catalog-observed.json'),JSON.stringify(observed,null,2)+'\n');
 assert.equal(frozen223TriggerAclProfile(observed.functions),'frankfurt','UPGRADE223_FRANKFURT_TRIGGER_ACL_REQUIRED');
 expected.functions=expectFrankfurt223TriggerAcl(expected.functions);
 // Compare the exact observed catalog against the Frankfurt-bound reference.
 await writeFile(path.join(output,'runtime-state.json'),JSON.stringify(runtime,null,2)+'\n');
 const comparison=await persistCatalogComparison(output,expected,observed,dates,report);assert.equal(comparison.unexpectedDifferenceCount,0,'UPGRADE223_UNEXPECTED_CATALOG_DIFFERENCE');
 const acl=compareApplicationAcl(expected,observed);await writeFile(path.join(output,'application-acl-comparison.json'),JSON.stringify(acl,null,2)+'\n');assert.equal(acl.ok,true,'UPGRADE223_ACL_MISMATCH');
 if(version==='222')assertReady222Catalog(observed,{notificationTriggerEnabled:runtime.notifications.trigger.enabled});else assertReady223Catalog(observed,{notificationTriggerEnabled:runtime.notifications.trigger.enabled});
 assert.deepEqual(await readRealtimePublication(executor),prefix.realtimePublication,'UPGRADE223_PUBLICATION_CHANGED');
 assert.deepEqual(await capture223RuntimeState(executor,reference),runtime,'UPGRADE223_RUNTIME_STATE_CHANGED');
 report.catalogUnexpectedDifferenceCount=0;report.runtimeStatePreserved=true;return observed;
}
export async function upgrade223WithExecutor({executor,reference,output,repair,finalDryRun,report={},backupEvidence}){
 assert.ok(backupEvidence,'UPGRADE223_BACKUP_EVIDENCE_REQUIRED');
 const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,'UPGRADE223_SQL_FAILED');return r.stdout.trim();};
 const current=JSON.parse(await sql(historySql)),pending=assert223History(current,reference);assert.deepEqual(pending,['223'],'UPGRADE223_ALREADY_APPLIED_USE_VERIFY_ONLY');
 const runtime=await capture223RuntimeState(executor,reference),before=await read223SourceEvidence(executor);
 assert.equal(sha256(JSON.stringify(before)),backupEvidence.sourceEvidenceSha256,'UPGRADE223_SOURCE_CHANGED_SINCE_BACKUP');
 Object.assign(report,{applied:[],recorded:[],remoteWriteAttempted:false,targetCeiling:223,beforeBackup:{sha256:backupEvidence.sha256,sourceEvidenceSha256:backupEvidence.sourceEvidenceSha256,finishedAt:backupEvidence.finishedAt}});
 const pre=path.join(output,'preflight-prefix');await mkdir(pre);await verify223Prefix(executor,pre,reference,'222',runtime,report);
 const unit=(await inputs223(reference)).find(u=>u.version==='223');assert.ok(unit);
 report.stage='apply-223';report.remoteWriteAttempted=true;await sql(unit.input);report.applied.push('223');
 const post=path.join(output,'prefix-223');await mkdir(post);await verify223Prefix(executor,post,reference,'223',runtime,report);
 report.stage='repair-223';await repair('223');report.recorded.push('223');assert.deepEqual(JSON.parse(await sql(historySql)),reference.appliedVersions,'UPGRADE223_RECORD_AFTER_SUCCESS_ONLY');
 const after=await read223SourceEvidence(executor);
 // Only the officially recorded history row and reviewed DDL may differ.
 for(const key of ['roles','memberships','sequences','storage','pgNetSequenceState','preload'])assert.deepEqual(after[key],before[key],'UPGRADE223_PROTECTED_STATE_CHANGED:'+key);
 assert223SourceRowsPreserved(before,after);
 await finalDryRun();Object.assign(report,{ok:true,complete:false,protectionPending:true,realtimeMembers:13,allBusinessRowsPreserved:true,nextAction:'BACKUP223_THEN_ISOLATED_RESTORE_THEN_VERIFY_ONLY'});return report;
}
export async function offline223(args){
 assert.ok(args.every((v,i)=>['--dry-run','--workdir'].includes(v)||args[i-1]==='--workdir'),'UNKNOWN_OFFLINE_OPTION');
 const at=args.indexOf('--workdir'),workdir=path.resolve(at<0?DEFAULT_WORKDIR:args[at+1]);assertOutsideRepository(workdir);assertOutsideRepository(await realpath(workdir),await realpath(root));
 assert.equal((await readFile(path.join(root,'supabase/.temp/project-ref'),'utf8')).trim(),OLD_REF);
 const reference=await readReady223Reference(root,path.join(workdir,ready223ReferenceName));await inputs223(reference);
 const output=path.join(workdir,'offline223-'+new Date().toISOString().replaceAll(/[:.]/gu,'-'));await mkdir(output);
 const report={ok:true,mode:'offline223',output,migrationCeiling:223,migrations:183,pending:['223'],prefix222Migrations:182,remoteWriteAttempted:false,networkAccess:false,latestHostedStateNotRead:true,localReferenceComparisonOnly:true,protectionRequired:'BACKUP222_BEFORE_APPLY_AND_BACKUP223_RESTORE_BEFORE_VERIFY_COMPLETE'};
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');return report;
}
export function upgrade223Arguments(args){
 const values=['--backup-evidence','--restore-evidence','--upgrade-report'],extra={},forward=[];
 for(let i=0;i<args.length;i++){const key=args[i];if(values.includes(key)){assert.ok(!extra[key]&&args[i+1]&&!args[i+1].startsWith('--'),'UPGRADE223_ONE_EVIDENCE_VALUE_REQUIRED');extra[key]=path.resolve(args[++i]);}else forward.push(key);}
 if(forward.includes('--apply'))assert.ok(extra['--backup-evidence']&&!extra['--restore-evidence']&&!extra['--upgrade-report'],'UPGRADE223_BEFORE_BACKUP_REQUIRED');
 else if(forward.includes('--verify-only'))assert.ok(values.every(k=>extra[k]),'UPGRADE223_BACKUP_RESTORE_APPLY_REPORT_REQUIRED');
 else assert.equal(Object.keys(extra).length,0,'UPGRADE223_OFFLINE_HAS_NO_PROTECTION_INPUT');
 return {forward,extra};
}
export async function run223(args,{preflight=registeredBackupPreflight,manifest=()=>operationalManifest(),runOwner=ownerRun}={}){
 const {forward,extra}=upgrade223Arguments(args);let backupEvidence,protection;
 if(forward.includes('--apply')){await preflight(root);backupEvidence=await read223BackupEvidence(extra['--backup-evidence'],222);}
 if(forward.includes('--verify-only'))protection=await assert223ProtectionComplete({backupFile:extra['--backup-evidence'],restoreFile:extra['--restore-evidence'],upgradeFile:extra['--upgrade-report']});
 await manifest();assert.equal(operationalSchema.upgradeCommand,'frankfurt-owner-upgrade223','UPGRADE_ADAPTER_NOT_CURRENT');
 return runOwner(forward,{loadReference:readReady223Reference,referenceName:ready223ReferenceName,pipeline:options=>upgrade223WithExecutor({...options,backupEvidence}),inputsFor:inputs223,versions:upgrade223Versions,label:'223',offlinePlan:offline223,
  verifyReadOnly:async(executor,output,reference,_original,_dates,report)=>{const runtime=await capture223RuntimeState(executor,reference);await verify223Prefix(executor,output,reference,'223',runtime,report);assert.equal(sha256(JSON.stringify(await read223SourceEvidence(executor))),protection.afterSourceEvidenceSha256,'UPGRADE223_SOURCE_CHANGED_SINCE_RESTORE');Object.assign(report,{targetCeiling:223,complete:true,protectionPending:false,protection});}});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{const r=await run223(process.argv.slice(2));console.log(JSON.stringify({ok:r.ok,complete:r.complete,protectionPending:r.protectionPending,output:r.output,error:r.error,applied:r.applied,recorded:r.recorded,nextAction:r.nextAction,remoteWriteAttempted:r.remoteWriteAttempted}));if(!r.ok)process.exitCode=1;}catch(error){console.error(upgradePreparationCode(error));process.exitCode=1;}}
