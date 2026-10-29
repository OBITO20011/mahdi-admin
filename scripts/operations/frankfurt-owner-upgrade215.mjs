// Owner-only entrypoint. Default dry-run is local and never asks for a password.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {run as ownerRun,historySql} from './frankfurt-owner-upgrade.mjs';
import {readReady215Reference,ready215ReferenceName,assertReady215Catalog} from './frankfurt-reference215.mjs';
import {assertReady214Catalog} from './frankfurt-reference214.mjs';
import {DEFAULT_WORKDIR,OLD_REF,assertOutsideRepository} from './frankfurt-owner-build.mjs';
import {executeInput} from './build-empty-supabase.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {sha256,canonicalLf} from '../testing/maintenance-db-contract.mjs';
import {readNotificationSnapshot,expectedHeldNotifications} from './frankfurt-notification-hold.mjs';
import {readRealtimePublication} from '../testing/realtime151-contract.mjs';
import {compareApplicationAcl} from './application-acl-verification.mjs';
import {generateAclPlan} from './frankfurt-acl-plan.mjs';
import {persistCatalogComparison,verifyCatalogReadOnly} from './frankfurt-catalog-verification.mjs';
import {registeredBackupPreflight} from './backup-task-preflight.mjs';
import {operationalManifest,operationalSchema} from './operational-schema.mjs';
import {upgradePreparationCode} from './upgrade-preparation-errors.mjs';
const root=path.resolve(import.meta.dirname,'../..');
export const upgrade215Versions=Object.freeze(['215']);
export function assert215History(history,reference){
 const base=reference.prefixes['214'].appliedVersions;assert.equal(base.length,176);assert.deepEqual(reference.appliedVersions,[...base,'215']);
 assert.ok(Array.isArray(history)&&[176,177].includes(history.length),'UPGRADE215_REQUIRES_COMPLETE214_OR215');
 assert.deepEqual(history,reference.appliedVersions.slice(0,history.length),'UPGRADE215_UNREVIEWED_HISTORY');return reference.appliedVersions.slice(history.length);
}
export async function inputs215(reference){return Promise.all(reference.manifest.filter(m=>Number(m.name.slice(0,3))>138).map(async unit=>{
 const input=await readFile(path.join(root,'supabase/migrations',unit.name));assert.equal(sha256(canonicalLf(input.toString('utf8'))),unit.sha256,'UPGRADE215_PIN_MISMATCH');return {...unit,version:unit.name.slice(0,3),input};
}));}
export const verify215ReadOnly=(executor,output,reference,original,dates,report)=>verifyCatalogReadOnly(executor,output,reference,original,dates,report,{strictApplicationAcl:true,assertReadyCatalog:assertReady215Catalog});
export async function upgrade215WithExecutor({executor,reference,original,output,repair,finalDryRun,report={}}){
 const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,'UPGRADE215_SQL_FAILED');return r.stdout.trim();};
 const history=async()=>JSON.parse(await sql(historySql)),catalog=async()=>JSON.parse(await sql(schemaCatalogSql)),current=await history(),pending=assert215History(current,reference);
 const dates={beforeBuildDate:reference.buildUtcDate,afterBuildDate:await sql("SELECT(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;")};
 Object.assign(report,{applied:[],recorded:[],remoteWriteAttempted:false});
 const check=async(version,name)=>{
  const prefix=reference.prefixes[version];assert.ok(prefix,'UPGRADE215_PREFIX_REQUIRED');const dir=path.join(output,name);await mkdir(dir);const observed=await catalog();
  const comparison=await persistCatalogComparison(dir,prefix.catalog,observed,{...dates,beforeBuildDate:prefix.buildUtcDate},{});
  assert.equal(comparison.unexpectedDifferenceCount,0,'UPGRADE215_UNEXPECTED_CATALOG_DIFFERENCE');
  const acl=compareApplicationAcl(prefix.catalog,observed);await writeFile(path.join(dir,'application-acl-comparison.json'),JSON.stringify(acl,null,2)+'\n');assert.equal(acl.ok,true,'UPGRADE215_ACL_MISMATCH');
  if(version==='214')assertReady214Catalog(observed);else assertReady215Catalog(observed);
  assert.deepEqual(await readRealtimePublication(executor),prefix.realtimePublication,'UPGRADE215_PUBLICATION_CHANGED');assert.deepEqual(await readNotificationSnapshot(executor),expectedHeldNotifications(original),'UPGRADE215_HOLD_CHANGED');
 };
 await check(current.at(-1),'preflight-prefix');
 for(const unit of(await inputs215(reference)).filter(u=>pending.includes(u.version))){
  report.stage='apply-'+unit.version;report.remoteWriteAttempted=true;await sql(unit.input);report.applied.push(unit.version);await check(unit.version,'prefix-'+unit.version);
  report.stage='repair-'+unit.version;await repair(unit.version);report.recorded.push(unit.version);current.push(unit.version);assert.deepEqual(await history(),current,'UPGRADE215_RECORD_AFTER_SUCCESS_ONLY');
 }
 const plan=generateAclPlan(reference.catalog,await catalog());await writeFile(path.join(output,'alignment.sql'),plan.commands.join('\n')+'\n');report.alignmentCommands=plan.commandCount;assert.equal(plan.commandCount,0,'UPGRADE215_ACL_REPAIR_REQUIRES_OWNER_REVIEW');
 await verify215ReadOnly(executor,output,reference,original,dates,report);await check('215','final-prefix');assert.deepEqual(await history(),reference.appliedVersions);await finalDryRun();
 return Object.assign(report,{ok:true,catalogUnexpectedDifferenceCount:0,notificationHoldUnchanged:true,realtimeMembers:13});
}
export async function offline215(args){
 assert.ok(args.every((v,i)=>['--dry-run','--workdir'].includes(v)||args[i-1]==='--workdir'),'UNKNOWN_OFFLINE_OPTION');
 const at=args.indexOf('--workdir'),workdir=path.resolve(at<0?DEFAULT_WORKDIR:args[at+1]);assertOutsideRepository(workdir);assertOutsideRepository(await realpath(workdir),await realpath(root));
 assert.equal((await readFile(path.join(root,'supabase/.temp/project-ref'),'utf8')).trim(),OLD_REF);
 const reference=await readReady215Reference(root,path.join(workdir,ready215ReferenceName));await inputs215(reference);
 const output=path.join(workdir,'offline215-'+new Date().toISOString().replaceAll(/[:.]/gu,'-'));await mkdir(output);
 const report={ok:true,mode:'offline215',output,migrationCeiling:215,migrations:177,pending:['215'],prefix214Migrations:176,remoteWriteAttempted:false,networkAccess:false,latestHostedStateNotRead:true,localReferenceComparisonOnly:true};
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');return report;
}
export async function run215(args,{preflight=registeredBackupPreflight,manifest=()=>operationalManifest(),runOwner=ownerRun}={}){
 // BEFORE ownerRun asks for a password or opens any database session.
 if(args.includes('--apply'))await preflight(root);
 await manifest();assert.ok([operationalSchema.ceiling,...operationalSchema.legacyArchiveCeilings].includes(215),'UPGRADE_ADAPTER_NOT_CURRENT');
 return runOwner(args,{loadReference:readReady215Reference,referenceName:ready215ReferenceName,pipeline:upgrade215WithExecutor,inputsFor:inputs215,versions:upgrade215Versions,label:'215',offlinePlan:offline215,verifyReadOnly:verify215ReadOnly});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{const r=await run215(process.argv.slice(2));console.log(JSON.stringify({ok:r.ok,output:r.output,error:r.error,applied:r.applied,recorded:r.recorded,remoteWriteAttempted:r.remoteWriteAttempted}));if(!r.ok)process.exitCode=1;}catch(error){console.error(upgradePreparationCode(error));process.exitCode=1;}}
