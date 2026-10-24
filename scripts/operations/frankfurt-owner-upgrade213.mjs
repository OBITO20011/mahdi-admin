import {compareApplicationAcl} from './application-acl-verification.mjs';
import {assertReady212Catalog} from './frankfurt-reference212.mjs';
// Owner-operated only;default dry-run reads saved local evidence,never connects.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {run as ownerRun,historySql} from './frankfurt-owner-upgrade.mjs';
import {readReady213Reference,ready213ReferenceName,assertReady213Catalog} from './frankfurt-reference213.mjs';
import {ready212ReferenceName} from './frankfurt-reference212.mjs';
import {DEFAULT_WORKDIR,assertOutsideRepository,OLD_REF} from './frankfurt-owner-build.mjs';
import {executeInput} from './build-empty-supabase.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {sha256,canonicalLf} from '../testing/maintenance-db-contract.mjs';
import {readRealtimePublication} from '../testing/realtime151-contract.mjs';
import {readNotificationSnapshot,expectedHeldNotifications} from './frankfurt-notification-hold.mjs';
import {generateAclPlan} from './frankfurt-acl-plan.mjs';
import {verifyCatalogReadOnly,persistCatalogComparison} from './frankfurt-catalog-verification.mjs';
const root=path.resolve(import.meta.dirname,'../..');
export const upgrade213Versions=Object.freeze(['213']);
export function assert213History(history,reference){
 const base=reference.prefixes['212'].appliedVersions;assert.equal(base.length,174);assert.deepEqual(reference.appliedVersions,[...base,'213']);
 assert.ok(history.length>=174&&history.length<=175,'UPGRADE213_REQUIRES_COMPLETE212_OR213');assert.deepEqual(history,reference.appliedVersions.slice(0,history.length),'UPGRADE213_UNREVIEWED_HISTORY');return reference.appliedVersions.slice(history.length);
}
export async function inputs213(reference){
 return Promise.all(reference.manifest.filter(m=>Number(m.name.slice(0,3))>138).map(async unit=>{
  const input=await readFile(path.join(root,'supabase/migrations',unit.name));
  assert.equal(sha256(canonicalLf(input.toString('utf8'))),unit.sha256,'UPGRADE213_PIN_MISMATCH');
  return {...unit,version:unit.name.slice(0,3),input};
 }));
}
export async function upgrade213WithExecutor({executor,reference,original,output,repair,finalDryRun,report={}}){
 const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,'UPGRADE213_SQL_FAILED');return r.stdout.trim();};
 const history=async()=>JSON.parse(await sql(historySql)),catalog=async()=>JSON.parse(await sql(schemaCatalogSql));
 const current=await history(),pending=assert213History(current,reference);
 const dates={beforeBuildDate:reference.buildUtcDate,afterBuildDate:await sql("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;")};
 Object.assign(report,{applied:[],recorded:[],remoteWriteAttempted:false});
 const check=async(version,name)=>{
  const prefix=reference.prefixes[version];assert.ok(prefix,'UPGRADE213_PREFIX_REQUIRED');
  const dir=path.join(output,name);await mkdir(dir);const comparison={};
  const observed=await catalog();
  const checked=await persistCatalogComparison(dir,prefix.catalog,observed,{...dates,beforeBuildDate:prefix.buildUtcDate},comparison);
  assert.equal(checked.unexpectedDifferenceCount,0,'UPGRADE213_PREFIX_UNEXPECTED_DIFFERENCE');
  assert.equal(compareApplicationAcl(prefix.catalog,observed).ok,true,'UPGRADE213_PREFIX_ACL_MISMATCH');
  if(version==='213')assertReady213Catalog(observed);else assertReady212Catalog(observed);
  assert.deepEqual(await readNotificationSnapshot(executor),expectedHeldNotifications(original),'UPGRADE213_HOLD_CHANGED');
  assert.deepEqual(await readRealtimePublication(executor),prefix.realtimePublication,'UPGRADE213_PREFIX_PUBLICATION_CHANGED');
  const plan=generateAclPlan(prefix.catalog,observed);await writeFile(path.join(dir,'acl-plan.json'),JSON.stringify(plan,null,2)+'\n');
 };
 await check(current.at(-1),'preflight-prefix');
 for(const unit of (await inputs213(reference)).filter(unit=>pending.includes(unit.version))){
  report.stage='apply-'+unit.version;report.remoteWriteAttempted=true;await sql(unit.input);report.applied.push(unit.version);
  await check(unit.version,'prefix-'+unit.version);
  report.stage='repair-'+unit.version;await repair(unit.version);report.recorded.push(unit.version);
  current.push(unit.version);assert.deepEqual(await history(),current,'UPGRADE213_RECORD_AFTER_SUCCESS_ONLY');
 }
 const observed=await catalog(),plan=generateAclPlan(reference.catalog,observed);
 await writeFile(path.join(output,'alignment.sql'),plan.commands.join('\n')+'\n');report.alignmentCommands=plan.commandCount;
 assert.equal(plan.commandCount,0,'UPGRADE213_UNEXPECTED_ACL_DIFFERENCE_REQUIRES_REVIEW');
 await verify213ReadOnly(executor,output,reference,original,dates,report);
 assertReady213Catalog(await catalog());await check('213','final-prefix');assert.deepEqual(await history(),reference.appliedVersions);
 await finalDryRun();return Object.assign(report,{ok:true,catalogUnexpectedDifferenceCount:0,realtimeMembers:13,notificationHoldUnchanged:true});
}
export async function offline213(args){
 assert.ok(args.every((value,index)=>['--dry-run','--workdir'].includes(value)||args[index-1]==='--workdir'),'UNKNOWN_OFFLINE_OPTION');
 const at=args.indexOf('--workdir'),workdir=path.resolve(at<0?DEFAULT_WORKDIR:args[at+1]);assertOutsideRepository(workdir);assertOutsideRepository(await realpath(workdir),await realpath(root));
 assert.equal((await readFile(path.join(root,'supabase/.temp/project-ref'),'utf8')).trim(),OLD_REF);
 const reference=await readReady213Reference(root,path.join(workdir,ready213ReferenceName));
 // This compares two LOCAL rebuild references. It makes no claim about the
 // latest hosted state; apply performs its own complete212 prefix check.
 const observedFile=path.join(workdir,ready212ReferenceName);
 // Saved212 is a schema baseline, not a claim that the new213 application
 // runs on212. Its complete manifest/catalog is checked against the newly
 // rebuilt213 reference's independently captured212 prefix below.
 const saved=JSON.parse(await readFile(observedFile,'utf8')),observed=saved.catalog;
 assert.equal(saved.migrationCeiling,212);assert.deepEqual(saved.manifest,reference.manifest.filter(m=>Number(m.name.slice(0,3))<=212));
 assert.equal(saved.catalogSha256,sha256(JSON.stringify(observed)));
 const afterBuildDate=saved.buildUtcDate;
 const output=path.join(workdir,'offline213-'+new Date().toISOString().replaceAll(/[:.]/gu,'-'));await mkdir(output);
 const report={mode:'offline213',output,migrationCeiling:213,remoteWriteAttempted:false,observedFile};
 try{
  const prefix=reference.prefixes['212'];await persistCatalogComparison(output,prefix.catalog,observed,{beforeBuildDate:prefix.buildUtcDate,afterBuildDate},report);
  const plan=generateAclPlan(prefix.catalog,observed);await writeFile(path.join(output,'alignment.sql'),plan.commands.join('\n')+'\n');
  assert.equal(plan.commandCount,0,'UPGRADE213_LOCAL212_BASELINE_DIFFERS');
  Object.assign(report,{ok:true,pending:['213'],prefix212Commands:plan.commandCount,latestHostedStateNotRead:true,localReferenceComparisonOnly:true});
 }catch(error){report.ok=false;report.error=error.message;}
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');return report;
}
export const verify213ReadOnly=(executor,output,reference,original,dates,report)=>
 verifyCatalogReadOnly(executor,output,reference,original,dates,report,{strictApplicationAcl:true,assertReadyCatalog:assertReady213Catalog});
export const run213=args=>ownerRun(args,{loadReference:readReady213Reference,referenceName:ready213ReferenceName,pipeline:upgrade213WithExecutor,
 inputsFor:inputs213,versions:upgrade213Versions,label:'213',offlinePlan:offline213,verifyReadOnly:verify213ReadOnly});
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const result=await run213(process.argv.slice(2));console.log(JSON.stringify({ok:result.ok,output:result.output,error:result.error,applied:result.applied,remoteWriteAttempted:result.remoteWriteAttempted}));if(!result.ok)process.exitCode=1;}
 catch(error){console.error(error.code==='ERR_ASSERTION'?error.message.split('\n')[0]:'OWNER213_PREPARATION_FAILED');process.exitCode=1;}
}
