// Owner-operated223→224: one additive OFF inventory reader; no table or writer changes.
// Entry remains owner-operated; this PR authorizes no hosted invocation.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {run as ownerRun,historySql} from './frankfurt-owner-upgrade.mjs';
import {readReady224Reference,ready224ReferenceName,assertReady224Catalog} from './frankfurt-reference224.mjs';
import {assertReady223Catalog} from './optional-quantity223-catalog.mjs';
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
import {read224BackupEvidence,assert224ProtectionComplete} from './upgrade224-protection.mjs';
import {capture220RuntimeState as capture224RuntimeState,bind220CatalogTrigger as bind224CatalogTrigger} from './upgrade220-runtime-state.mjs';
import {assert224SourceRowsPreserved} from './upgrade224-data.mjs';
import {frozen220TriggerAclProfile as frozen224TriggerAclProfile,expectFrankfurt220TriggerAcl as expectFrankfurt224TriggerAcl} from './frozen220-trigger-acl.mjs';
const root=path.resolve(import.meta.dirname,'../..');
export const upgrade224Versions=Object.freeze(['224']);
export function assert224History(history,reference){
 const base=reference.prefixes['223'].appliedVersions;assert.equal(base.length,183);assert.deepEqual(reference.appliedVersions,[...base,'224']);
 assert.ok(Array.isArray(history)&&[183,184].includes(history.length),'UPGRADE224_REQUIRES_COMPLETE223_OR224');
 assert.deepEqual(history,reference.appliedVersions.slice(0,history.length),'UPGRADE224_UNREVIEWED_HISTORY');return reference.appliedVersions.slice(history.length);
}
export async function inputs224(reference){return Promise.all(reference.manifest.filter(m=>Number(m.name.slice(0,3))>138).map(async unit=>{
 const input=await readFile(path.join(root,'supabase/migrations',unit.name));assert.equal(sha256(canonicalLf(input.toString('utf8'))),unit.sha256,'UPGRADE224_PIN_MISMATCH');return {...unit,version:unit.name.slice(0,3),input};
}));}
export async function read224SourceEvidence(executor){
 const session=new SnapshotSession(executor.command,executor.args,executor.env??process.env);
 try{await session.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;');return await captureEvidence(session);}finally{await session.close();}
}
async function verify224Prefix(executor,output,reference,version,runtime,report){
 const read=await executeInput(executor,schemaCatalogSql);assert.equal(read.code,0,'UPGRADE224_CATALOG_READ_FAILED');const observed=JSON.parse(read.stdout.trim()),prefix=reference.prefixes[version];assert.ok(prefix);
 const expected=bind224CatalogTrigger(prefix.catalog,runtime),dates={beforeBuildDate:prefix.buildUtcDate,afterBuildDate:new Date().toISOString().slice(0,10)};
 await writeFile(path.join(output,'catalog-observed.json'),JSON.stringify(observed,null,2)+'\n');
 assert.equal(frozen224TriggerAclProfile(observed.functions),'frankfurt','UPGRADE224_FRANKFURT_TRIGGER_ACL_REQUIRED');
 expected.functions=expectFrankfurt224TriggerAcl(expected.functions);
 // Compare the exact observed catalog against the Frankfurt-bound reference.
 await writeFile(path.join(output,'runtime-state.json'),JSON.stringify(runtime,null,2)+'\n');
 const comparison=await persistCatalogComparison(output,expected,observed,dates,report);assert.equal(comparison.unexpectedDifferenceCount,0,'UPGRADE224_UNEXPECTED_CATALOG_DIFFERENCE');
 const acl=compareApplicationAcl(expected,observed);await writeFile(path.join(output,'application-acl-comparison.json'),JSON.stringify(acl,null,2)+'\n');assert.equal(acl.ok,true,'UPGRADE224_ACL_MISMATCH');
 if(version==='223')assertReady223Catalog(observed,{notificationTriggerEnabled:runtime.notifications.trigger.enabled});else assertReady224Catalog(observed,{notificationTriggerEnabled:runtime.notifications.trigger.enabled});
 assert.deepEqual(await readRealtimePublication(executor),prefix.realtimePublication,'UPGRADE224_PUBLICATION_CHANGED');
 assert.deepEqual(await capture224RuntimeState(executor,reference),runtime,'UPGRADE224_RUNTIME_STATE_CHANGED');
 report.catalogUnexpectedDifferenceCount=0;report.runtimeStatePreserved=true;return observed;
}
export async function upgrade224WithExecutor({executor,reference,output,repair,finalDryRun,report={},backupEvidence}){
 assert.ok(backupEvidence,'UPGRADE224_BACKUP_EVIDENCE_REQUIRED');
 const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,'UPGRADE224_SQL_FAILED');return r.stdout.trim();};
 const current=JSON.parse(await sql(historySql)),pending=assert224History(current,reference);assert.deepEqual(pending,['224'],'UPGRADE224_ALREADY_APPLIED_USE_VERIFY_ONLY');
 const runtime=await capture224RuntimeState(executor,reference),before=await read224SourceEvidence(executor);
 assert.equal(sha256(JSON.stringify(before)),backupEvidence.sourceEvidenceSha256,'UPGRADE224_SOURCE_CHANGED_SINCE_BACKUP');
 Object.assign(report,{applied:[],recorded:[],remoteWriteAttempted:false,targetCeiling:224,beforeBackup:{sha256:backupEvidence.sha256,sourceEvidenceSha256:backupEvidence.sourceEvidenceSha256,finishedAt:backupEvidence.finishedAt}});
 const pre=path.join(output,'preflight-prefix');await mkdir(pre);await verify224Prefix(executor,pre,reference,'223',runtime,report);
 const unit=(await inputs224(reference)).find(u=>u.version==='224');assert.ok(unit);
 report.stage='apply-224';report.remoteWriteAttempted=true;await sql(unit.input);report.applied.push('224');
 const post=path.join(output,'prefix-224');await mkdir(post);await verify224Prefix(executor,post,reference,'224',runtime,report);
 report.stage='repair-224';await repair('224');report.recorded.push('224');assert.deepEqual(JSON.parse(await sql(historySql)),reference.appliedVersions,'UPGRADE224_RECORD_AFTER_SUCCESS_ONLY');
 const after=await read224SourceEvidence(executor);
 // Only the officially recorded history row and reviewed DDL may differ.
 for(const key of ['roles','memberships','sequences','storage','pgNetSequenceState','preload'])assert.deepEqual(after[key],before[key],'UPGRADE224_PROTECTED_STATE_CHANGED:'+key);
 assert224SourceRowsPreserved(before,after);
 await finalDryRun();Object.assign(report,{ok:true,complete:false,protectionPending:true,realtimeMembers:13,allBusinessRowsPreserved:true,nextAction:'BACKUP224_THEN_ISOLATED_RESTORE_THEN_VERIFY_ONLY'});return report;
}
export async function offline224(args){
 assert.ok(args.every((v,i)=>['--dry-run','--workdir'].includes(v)||args[i-1]==='--workdir'),'UNKNOWN_OFFLINE_OPTION');
 const at=args.indexOf('--workdir'),workdir=path.resolve(at<0?DEFAULT_WORKDIR:args[at+1]);assertOutsideRepository(workdir);assertOutsideRepository(await realpath(workdir),await realpath(root));
 assert.equal((await readFile(path.join(root,'supabase/.temp/project-ref'),'utf8')).trim(),OLD_REF);
 const reference=await readReady224Reference(root,path.join(workdir,ready224ReferenceName));await inputs224(reference);
 const output=path.join(workdir,'offline224-'+new Date().toISOString().replaceAll(/[:.]/gu,'-'));await mkdir(output);
 const report={ok:true,mode:'offline224',output,migrationCeiling:224,migrations:184,pending:['224'],prefix223Migrations:183,remoteWriteAttempted:false,networkAccess:false,latestHostedStateNotRead:true,localReferenceComparisonOnly:true,protectionRequired:'BACKUP223_BEFORE_APPLY_AND_BACKUP224_RESTORE_BEFORE_VERIFY_COMPLETE'};
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');return report;
}
export function upgrade224Arguments(args){
 const values=['--backup-evidence','--restore-evidence','--upgrade-report'],extra={},forward=[];
 for(let i=0;i<args.length;i++){const key=args[i];if(values.includes(key)){assert.ok(!extra[key]&&args[i+1]&&!args[i+1].startsWith('--'),'UPGRADE224_ONE_EVIDENCE_VALUE_REQUIRED');extra[key]=path.resolve(args[++i]);}else forward.push(key);}
 if(forward.includes('--apply'))assert.ok(extra['--backup-evidence']&&!extra['--restore-evidence']&&!extra['--upgrade-report'],'UPGRADE224_BEFORE_BACKUP_REQUIRED');
 else if(forward.includes('--verify-only'))assert.ok(values.every(k=>extra[k]),'UPGRADE224_BACKUP_RESTORE_APPLY_REPORT_REQUIRED');
 else assert.equal(Object.keys(extra).length,0,'UPGRADE224_OFFLINE_HAS_NO_PROTECTION_INPUT');
 return {forward,extra};
}
export async function run224(args,{preflight=registeredBackupPreflight,manifest=()=>operationalManifest(),runOwner=ownerRun}={}){
 const {forward,extra}=upgrade224Arguments(args);let backupEvidence,protection;
 if(forward.includes('--apply')){await preflight(root);backupEvidence=await read224BackupEvidence(extra['--backup-evidence'],223);}
 if(forward.includes('--verify-only'))protection=await assert224ProtectionComplete({backupFile:extra['--backup-evidence'],restoreFile:extra['--restore-evidence'],upgradeFile:extra['--upgrade-report']});
 await manifest();assert.equal(operationalSchema.upgradeCommand,'frankfurt-owner-upgrade224','UPGRADE_ADAPTER_NOT_CURRENT');
 return runOwner(forward,{loadReference:readReady224Reference,referenceName:ready224ReferenceName,pipeline:options=>upgrade224WithExecutor({...options,backupEvidence}),inputsFor:inputs224,versions:upgrade224Versions,label:'224',offlinePlan:offline224,
  verifyReadOnly:async(executor,output,reference,_original,_dates,report)=>{const runtime=await capture224RuntimeState(executor,reference);await verify224Prefix(executor,output,reference,'224',runtime,report);assert.equal(sha256(JSON.stringify(await read224SourceEvidence(executor))),protection.afterSourceEvidenceSha256,'UPGRADE224_SOURCE_CHANGED_SINCE_RESTORE');Object.assign(report,{targetCeiling:224,complete:true,protectionPending:false,protection});}});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{const r=await run224(process.argv.slice(2));console.log(JSON.stringify({ok:r.ok,complete:r.complete,protectionPending:r.protectionPending,output:r.output,error:r.error,applied:r.applied,recorded:r.recorded,nextAction:r.nextAction,remoteWriteAttempted:r.remoteWriteAttempted}));if(!r.ok)process.exitCode=1;}catch(error){console.error(upgradePreparationCode(error));process.exitCode=1;}}
