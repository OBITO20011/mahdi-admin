import {assertReady212Catalog} from './frankfurt-reference212.mjs';
import {compareApplicationAcl} from './application-acl-verification.mjs';
import {assertReady213Catalog} from './frankfurt-reference213.mjs';
// Owner-operated only;default dry-run reads saved local evidence,never connects.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {run as ownerRun,historySql} from './frankfurt-owner-upgrade.mjs';
import {readReady214Reference,ready214ReferenceName,assertReady214Catalog} from './frankfurt-reference214.mjs';
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
export const upgrade214Versions=Object.freeze(['213','214']);
export function assert214History(history,reference){
 const base=reference.prefixes['212'].appliedVersions;assert.equal(base.length,174);assert.deepEqual(reference.appliedVersions,[...base,'213','214']);
 assert.ok(history.length>=174&&history.length<=176,'UPGRADE214_REQUIRES_COMPLETE212_213_OR214');assert.deepEqual(history,reference.appliedVersions.slice(0,history.length),'UPGRADE214_UNREVIEWED_HISTORY');return reference.appliedVersions.slice(history.length);
}
export async function inputs214(reference){
 return Promise.all(reference.manifest.filter(m=>Number(m.name.slice(0,3))>138).map(async unit=>{
  const input=await readFile(path.join(root,'supabase/migrations',unit.name));
  assert.equal(sha256(canonicalLf(input.toString('utf8'))),unit.sha256,'UPGRADE214_PIN_MISMATCH');
  return {...unit,version:unit.name.slice(0,3),input};
 }));
}
export async function upgrade214WithExecutor({executor,reference,original,output,repair,finalDryRun,report={}}){
 const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,'UPGRADE214_SQL_FAILED');return r.stdout.trim();};
 const history=async()=>JSON.parse(await sql(historySql)),catalog=async()=>JSON.parse(await sql(schemaCatalogSql));
 const current=await history(),pending=assert214History(current,reference);
 const dates={beforeBuildDate:reference.buildUtcDate,afterBuildDate:await sql("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;")};
 Object.assign(report,{applied:[],recorded:[],remoteWriteAttempted:false});
 const check=async(version,name)=>{
  const prefix=reference.prefixes[version];assert.ok(prefix,'UPGRADE214_PREFIX_REQUIRED');
  const dir=path.join(output,name);await mkdir(dir);const comparison={};
  const observed=await catalog();
  const checked=await persistCatalogComparison(dir,prefix.catalog,observed,{...dates,beforeBuildDate:prefix.buildUtcDate},comparison);
  assert.equal(checked.unexpectedDifferenceCount,0,'UPGRADE214_PREFIX_UNEXPECTED_DIFFERENCE');
  assert.equal(compareApplicationAcl(prefix.catalog,observed).ok,true,'UPGRADE214_PREFIX_ACL_MISMATCH');
  if(version==='214')assertReady214Catalog(observed);else if(version==='213')assertReady213Catalog(observed);else assertReady212Catalog(observed);
  assert.deepEqual(await readNotificationSnapshot(executor),expectedHeldNotifications(original),'UPGRADE214_HOLD_CHANGED');
  assert.deepEqual(await readRealtimePublication(executor),prefix.realtimePublication,'UPGRADE214_PREFIX_PUBLICATION_CHANGED');
  const plan=generateAclPlan(prefix.catalog,observed);await writeFile(path.join(dir,'acl-plan.json'),JSON.stringify(plan,null,2)+'\n');
 };
 await check(current.at(-1),'preflight-prefix');
 for(const unit of (await inputs214(reference)).filter(unit=>pending.includes(unit.version))){
  report.stage='apply-'+unit.version;report.remoteWriteAttempted=true;await sql(unit.input);report.applied.push(unit.version);
  await check(unit.version,'prefix-'+unit.version);
  report.stage='repair-'+unit.version;await repair(unit.version);report.recorded.push(unit.version);
  current.push(unit.version);assert.deepEqual(await history(),current,'UPGRADE214_RECORD_AFTER_SUCCESS_ONLY');
 }
 const observed=await catalog(),plan=generateAclPlan(reference.catalog,observed);
 await writeFile(path.join(output,'alignment.sql'),plan.commands.join('\n')+'\n');report.alignmentCommands=plan.commandCount;
 assert.equal(plan.commandCount,0,'UPGRADE214_UNEXPECTED_ACL_DIFFERENCE_REQUIRES_REVIEW');
 await verify214ReadOnly(executor,output,reference,original,dates,report);
 assertReady214Catalog(await catalog());await check('214','final-prefix');assert.deepEqual(await history(),reference.appliedVersions);
 await finalDryRun();return Object.assign(report,{ok:true,catalogUnexpectedDifferenceCount:0,realtimeMembers:13,notificationHoldUnchanged:true});
}
export async function offline214(args){
 assert.ok(args.every((value,index)=>['--dry-run','--workdir'].includes(value)||args[index-1]==='--workdir'),'UNKNOWN_OFFLINE_OPTION');
 const at=args.indexOf('--workdir'),workdir=path.resolve(at<0?DEFAULT_WORKDIR:args[at+1]);assertOutsideRepository(workdir);assertOutsideRepository(await realpath(workdir),await realpath(root));
 assert.equal((await readFile(path.join(root,'supabase/.temp/project-ref'),'utf8')).trim(),OLD_REF);
 const reference=await readReady214Reference(root,path.join(workdir,ready214ReferenceName));
 // This compares two LOCAL rebuild references. It makes no claim about the
 // latest hosted state; apply checks its actual complete212/213/214 prefix.
 const observedFile=path.join(workdir,ready212ReferenceName);
 // Saved212 is a LOCAL schema baseline, not a hosted-state claim. Compare
 // its complete manifest/catalog to the independently rebuilt212 prefix.
 const saved=JSON.parse(await readFile(observedFile,'utf8')),observed=saved.catalog;
 assert.equal(saved.migrationCeiling,212);assert.deepEqual(saved.manifest,reference.manifest.filter(m=>Number(m.name.slice(0,3))<=212));
 assert.equal(saved.catalogSha256,sha256(JSON.stringify(observed)));
 const afterBuildDate=saved.buildUtcDate;
 const output=path.join(workdir,'offline214-'+new Date().toISOString().replaceAll(/[:.]/gu,'-'));await mkdir(output);
 const report={mode:'offline214',output,migrationCeiling:214,remoteWriteAttempted:false,observedFile};
 try{
  const prefix=reference.prefixes['212'];await persistCatalogComparison(output,prefix.catalog,observed,{beforeBuildDate:prefix.buildUtcDate,afterBuildDate},report);
  const plan=generateAclPlan(prefix.catalog,observed);await writeFile(path.join(output,'alignment.sql'),plan.commands.join('\n')+'\n');
  assert.equal(plan.commandCount,0,'UPGRADE214_LOCAL212_BASELINE_DIFFERS');
  Object.assign(report,{ok:true,pending:['213','214'],prefix212Commands:plan.commandCount,latestHostedStateNotRead:true,localReferenceComparisonOnly:true});
 }catch(error){report.ok=false;report.error=error.message;}
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');return report;
}
export const verify214ReadOnly=(executor,output,reference,original,dates,report)=>
 verifyCatalogReadOnly(executor,output,reference,original,dates,report,{strictApplicationAcl:true,assertReadyCatalog:assertReady214Catalog});
export const run214=args=>ownerRun(args,{loadReference:readReady214Reference,referenceName:ready214ReferenceName,pipeline:upgrade214WithExecutor,
 inputsFor:inputs214,versions:upgrade214Versions,label:'214',offlinePlan:offline214,verifyReadOnly:verify214ReadOnly});
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const result=await run214(process.argv.slice(2));console.log(JSON.stringify({ok:result.ok,output:result.output,error:result.error,applied:result.applied,remoteWriteAttempted:result.remoteWriteAttempted}));if(!result.ok)process.exitCode=1;}
 catch(error){console.error(error.code==='ERR_ASSERTION'?error.message.split('\n')[0]:'OWNER214_PREPARATION_FAILED');process.exitCode=1;}
}
