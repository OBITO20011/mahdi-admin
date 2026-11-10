// Draft post-launch command. Fixed owner connection guards are reused intact.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {run as ownerRun,historySql} from './frankfurt-owner-upgrade.mjs';
import {readReady220Reference,ready220ReferenceName,assertReady220Catalog} from './frankfurt-reference220.mjs';
import {assertReady219Catalog} from './frankfurt-reference219.mjs';
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
import {read220BackupEvidence,assert220ProtectionComplete} from './upgrade220-protection.mjs';
import {capture220RuntimeState,bind220CatalogTrigger} from './upgrade220-runtime-state.mjs';
import {assert220SourceRowsPreserved} from './upgrade220-data.mjs';
const root=path.resolve(import.meta.dirname,'../..');
export const upgrade220Versions=Object.freeze(['220']);
export function assert220History(history,reference){
 const base=reference.prefixes['219'].appliedVersions;assert.equal(base.length,180);assert.deepEqual(reference.appliedVersions,[...base,'220']);
 assert.ok(Array.isArray(history)&&[180,181].includes(history.length),'UPGRADE220_REQUIRES_COMPLETE219_OR220');
 assert.deepEqual(history,reference.appliedVersions.slice(0,history.length),'UPGRADE220_UNREVIEWED_HISTORY');return reference.appliedVersions.slice(history.length);
}
export async function inputs220(reference){return Promise.all(reference.manifest.filter(m=>Number(m.name.slice(0,3))>138).map(async unit=>{
 const input=await readFile(path.join(root,'supabase/migrations',unit.name));assert.equal(sha256(canonicalLf(input.toString('utf8'))),unit.sha256,'UPGRADE220_PIN_MISMATCH');return {...unit,version:unit.name.slice(0,3),input};
}));}
export async function read220SourceEvidence(executor){
 const session=new SnapshotSession(executor.command,executor.args,executor.env??process.env);
 try{await session.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;');return await captureEvidence(session);}finally{await session.close();}
}
async function verify220Prefix(executor,output,reference,version,runtime,report){
 const read=await executeInput(executor,schemaCatalogSql);assert.equal(read.code,0,'UPGRADE220_CATALOG_READ_FAILED');const observed=JSON.parse(read.stdout.trim()),prefix=reference.prefixes[version];assert.ok(prefix);
 const expected=bind220CatalogTrigger(prefix.catalog,runtime),dates={beforeBuildDate:prefix.buildUtcDate,afterBuildDate:new Date().toISOString().slice(0,10)};
 // Save literal observed catalog and the exact runtime trigger binding,then compare everything.
 await writeFile(path.join(output,'runtime-state.json'),JSON.stringify(runtime,null,2)+'\n');
 const comparison=await persistCatalogComparison(output,expected,observed,dates,report);assert.equal(comparison.unexpectedDifferenceCount,0,'UPGRADE220_UNEXPECTED_CATALOG_DIFFERENCE');
 const acl=compareApplicationAcl(prefix.catalog,observed);await writeFile(path.join(output,'application-acl-comparison.json'),JSON.stringify(acl,null,2)+'\n');assert.equal(acl.ok,true,'UPGRADE220_ACL_MISMATCH');
 (version==='219'?assertReady219Catalog:assertReady220Catalog)(observed);
 assert.deepEqual(await readRealtimePublication(executor),prefix.realtimePublication,'UPGRADE220_PUBLICATION_CHANGED');
 assert.deepEqual(await capture220RuntimeState(executor,reference),runtime,'UPGRADE220_RUNTIME_STATE_CHANGED');
 report.catalogUnexpectedDifferenceCount=0;report.runtimeStatePreserved=true;return observed;
}
export async function upgrade220WithExecutor({executor,reference,output,repair,finalDryRun,report={},backupEvidence}){
 assert.ok(backupEvidence,'UPGRADE220_BACKUP_EVIDENCE_REQUIRED');
 const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,'UPGRADE220_SQL_FAILED');return r.stdout.trim();};
 const current=JSON.parse(await sql(historySql)),pending=assert220History(current,reference);assert.deepEqual(pending,['220'],'UPGRADE220_ALREADY_APPLIED_USE_VERIFY_ONLY');
 const runtime=await capture220RuntimeState(executor,reference),before=await read220SourceEvidence(executor);
 assert.equal(sha256(JSON.stringify(before)),backupEvidence.sourceEvidenceSha256,'UPGRADE220_SOURCE_CHANGED_SINCE_BACKUP');
 Object.assign(report,{applied:[],recorded:[],remoteWriteAttempted:false,targetCeiling:220,beforeBackup:{sha256:backupEvidence.sha256,sourceEvidenceSha256:backupEvidence.sourceEvidenceSha256,finishedAt:backupEvidence.finishedAt}});
 const pre=path.join(output,'preflight-prefix');await mkdir(pre);await verify220Prefix(executor,pre,reference,'219',runtime,report);
 const unit=(await inputs220(reference)).find(u=>u.version==='220');assert.ok(unit);
 report.stage='apply-220';report.remoteWriteAttempted=true;await sql(unit.input);report.applied.push('220');
 const post=path.join(output,'prefix-220');await mkdir(post);await verify220Prefix(executor,post,reference,'220',runtime,report);
 report.stage='repair-220';await repair('220');report.recorded.push('220');assert.deepEqual(JSON.parse(await sql(historySql)),reference.appliedVersions,'UPGRADE220_RECORD_AFTER_SUCCESS_ONLY');
 const after=await read220SourceEvidence(executor);
 // Only the officially recorded history row and reviewed DDL may differ.
 for(const key of ['roles','memberships','sequences','storage','pgNetSequenceState','preload'])assert.deepEqual(after[key],before[key],'UPGRADE220_PROTECTED_STATE_CHANGED:'+key);
 assert220SourceRowsPreserved(before,after,reference);
 await finalDryRun();Object.assign(report,{ok:true,complete:false,protectionPending:true,realtimeMembers:13,allBusinessRowsPreserved:true,nextAction:'BACKUP220_THEN_ISOLATED_RESTORE_THEN_VERIFY_ONLY'});return report;
}
export async function offline220(args){
 assert.ok(args.every((v,i)=>['--dry-run','--workdir'].includes(v)||args[i-1]==='--workdir'),'UNKNOWN_OFFLINE_OPTION');
 const at=args.indexOf('--workdir'),workdir=path.resolve(at<0?DEFAULT_WORKDIR:args[at+1]);assertOutsideRepository(workdir);assertOutsideRepository(await realpath(workdir),await realpath(root));
 assert.equal((await readFile(path.join(root,'supabase/.temp/project-ref'),'utf8')).trim(),OLD_REF);
 const reference=await readReady220Reference(root,path.join(workdir,ready220ReferenceName));await inputs220(reference);
 const output=path.join(workdir,'offline220-'+new Date().toISOString().replaceAll(/[:.]/gu,'-'));await mkdir(output);
 const report={ok:true,mode:'offline220',output,migrationCeiling:220,migrations:181,pending:['220'],prefix219Migrations:180,remoteWriteAttempted:false,networkAccess:false,latestHostedStateNotRead:true,localReferenceComparisonOnly:true,protectionRequired:'BACKUP219_BEFORE_APPLY_AND_BACKUP220_RESTORE_BEFORE_VERIFY_COMPLETE'};
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');return report;
}
export function upgrade220Arguments(args){
 const values=['--backup-evidence','--restore-evidence','--upgrade-report'],extra={},forward=[];
 for(let i=0;i<args.length;i++){const key=args[i];if(values.includes(key)){assert.ok(!extra[key]&&args[i+1]&&!args[i+1].startsWith('--'),'UPGRADE220_ONE_EVIDENCE_VALUE_REQUIRED');extra[key]=path.resolve(args[++i]);}else forward.push(key);}
 if(forward.includes('--apply'))assert.ok(extra['--backup-evidence']&&!extra['--restore-evidence']&&!extra['--upgrade-report'],'UPGRADE220_BEFORE_BACKUP_REQUIRED');
 else if(forward.includes('--verify-only'))assert.ok(values.every(k=>extra[k]),'UPGRADE220_BACKUP_RESTORE_APPLY_REPORT_REQUIRED');
 else assert.equal(Object.keys(extra).length,0,'UPGRADE220_OFFLINE_HAS_NO_PROTECTION_INPUT');
 return {forward,extra};
}
export async function run220(args,{preflight=registeredBackupPreflight,manifest=()=>operationalManifest(),runOwner=ownerRun}={}){
 const {forward,extra}=upgrade220Arguments(args);let backupEvidence,protection;
 if(forward.includes('--apply')){await preflight(root);backupEvidence=await read220BackupEvidence(extra['--backup-evidence'],219);}
 if(forward.includes('--verify-only'))protection=await assert220ProtectionComplete({backupFile:extra['--backup-evidence'],restoreFile:extra['--restore-evidence'],upgradeFile:extra['--upgrade-report']});
 await manifest();assert.equal(operationalSchema.upgradeCommand,'frankfurt-owner-upgrade220','UPGRADE_ADAPTER_NOT_CURRENT');
 return runOwner(forward,{loadReference:readReady220Reference,referenceName:ready220ReferenceName,pipeline:options=>upgrade220WithExecutor({...options,backupEvidence}),inputsFor:inputs220,versions:upgrade220Versions,label:'220',offlinePlan:offline220,
  verifyReadOnly:async(executor,output,reference,_original,_dates,report)=>{const runtime=await capture220RuntimeState(executor,reference);await verify220Prefix(executor,output,reference,'220',runtime,report);assert.equal(sha256(JSON.stringify(await read220SourceEvidence(executor))),protection.afterSourceEvidenceSha256,'UPGRADE220_SOURCE_CHANGED_SINCE_RESTORE');Object.assign(report,{targetCeiling:220,complete:true,protectionPending:false,protection});}});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{const r=await run220(process.argv.slice(2));console.log(JSON.stringify({ok:r.ok,complete:r.complete,protectionPending:r.protectionPending,output:r.output,error:r.error,applied:r.applied,recorded:r.recorded,nextAction:r.nextAction,remoteWriteAttempted:r.remoteWriteAttempted}));if(!r.ok)process.exitCode=1;}catch(error){console.error(upgradePreparationCode(error));process.exitCode=1;}}
