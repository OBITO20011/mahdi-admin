// Owner-operated only;default dry-run reads saved local evidence,never connects.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {run as ownerRun,historySql} from './frankfurt-owner-upgrade.mjs';
import {readReady201Reference,ready201ReferenceName,assertReady201Catalog} from './frankfurt-reference201.mjs';
import {readReady200Reference,ready200ReferenceName} from './frankfurt-reference200.mjs';
import {DEFAULT_WORKDIR,assertOutsideRepository,OLD_REF} from './frankfurt-owner-build.mjs';
import {executeInput} from './build-empty-supabase.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {sha256,canonicalLf} from '../testing/maintenance-db-contract.mjs';
import {readRealtimePublication} from '../testing/realtime151-contract.mjs';
import {readNotificationSnapshot,expectedHeldNotifications} from './frankfurt-notification-hold.mjs';
import {generateAclPlan} from './frankfurt-acl-plan.mjs';
import {alignWithExecutor} from './frankfurt-align-acl.mjs';
import {verifyCatalogReadOnly,persistCatalogComparison} from './frankfurt-catalog-verification.mjs';
const root=path.resolve(import.meta.dirname,'../..');
export const upgrade201Versions=Object.freeze(['201']);
export function assert201History(history,reference){
 const base=reference.prefixes['200'].appliedVersions;
 assert.equal(base.length,162);assert.equal(reference.appliedVersions.length,163);
 assert.deepEqual(reference.appliedVersions,[...base,'201']);
 assert.ok(history.length===162||history.length===163,'UPGRADE201_REQUIRES_COMPLETE200_OR201');
 assert.deepEqual(history,reference.appliedVersions.slice(0,history.length),'UPGRADE201_UNREVIEWED_HISTORY');
 return history.length===162?['201']:[];
}
export async function inputs201(reference){
 return Promise.all(reference.manifest.filter(m=>Number(m.name.slice(0,3))>138).map(async unit=>{
  const input=await readFile(path.join(root,'supabase/migrations',unit.name));
  assert.equal(sha256(canonicalLf(input.toString('utf8'))),unit.sha256,'UPGRADE201_PIN_MISMATCH');
  return {...unit,version:unit.name.slice(0,3),input};
 }));
}
export async function upgrade201WithExecutor({executor,reference,original,output,repair,finalDryRun,report={}}){
 const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,'UPGRADE201_SQL_FAILED');return r.stdout.trim();};
 const history=async()=>JSON.parse(await sql(historySql)),catalog=async()=>JSON.parse(await sql(schemaCatalogSql));
 const current=await history(),pending=assert201History(current,reference);
 const dates={beforeBuildDate:reference.buildUtcDate,afterBuildDate:await sql("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;")};
 Object.assign(report,{applied:[],recorded:[],remoteWriteAttempted:false});
 const check=async(version,name)=>{
  const prefix=reference.prefixes[version];assert.ok(prefix,'UPGRADE201_PREFIX_REQUIRED');
  const dir=path.join(output,name);await mkdir(dir);const comparison={};
  const observed=await catalog();
  await persistCatalogComparison(dir,prefix.catalog,observed,{...dates,beforeBuildDate:prefix.buildUtcDate},comparison);
  assert.deepEqual(await readNotificationSnapshot(executor),expectedHeldNotifications(original),'UPGRADE201_HOLD_CHANGED');
  assert.deepEqual(await readRealtimePublication(executor),reference.realtimePublication,'UPGRADE201_PUBLICATION_CHANGED');
  const plan=generateAclPlan(prefix.catalog,observed);await writeFile(path.join(dir,'acl-plan.json'),JSON.stringify(plan,null,2)+'\n');
 };
 await check(current.at(-1),'preflight-prefix');
 for(const unit of (await inputs201(reference)).filter(unit=>pending.includes(unit.version))){
  report.stage='apply-'+unit.version;report.remoteWriteAttempted=true;await sql(unit.input);report.applied.push(unit.version);
  await check(unit.version,'prefix-'+unit.version);
  report.stage='repair-'+unit.version;await repair(unit.version);report.recorded.push(unit.version);
  current.push(unit.version);assert.deepEqual(await history(),current,'UPGRADE201_RECORD_AFTER_SUCCESS_ONLY');
 }
 const observed=await catalog(),plan=generateAclPlan(reference.catalog,observed);
 await writeFile(path.join(output,'alignment.sql'),plan.commands.join('\n')+'\n');report.alignmentCommands=plan.commandCount;
 if(plan.commandCount){report.remoteWriteAttempted=true;report.alignment={};await alignWithExecutor(executor,reference,observed,original,dates,output,report.alignment);}
 else await verifyCatalogReadOnly(executor,output,reference,original,dates,report);
 assertReady201Catalog(await catalog());await check('201','final-prefix');assert.deepEqual(await history(),reference.appliedVersions);
 await finalDryRun();return Object.assign(report,{ok:true,catalogUnexpectedDifferenceCount:0,realtimeMembers:13,notificationHoldUnchanged:true});
}
export async function offline201(args){
 assert.ok(args.every((value,index)=>['--dry-run','--workdir'].includes(value)||args[index-1]==='--workdir'),'UNKNOWN_OFFLINE_OPTION');
 const at=args.indexOf('--workdir'),workdir=path.resolve(at<0?DEFAULT_WORKDIR:args[at+1]);assertOutsideRepository(workdir);assertOutsideRepository(await realpath(workdir),await realpath(root));
 assert.equal((await readFile(path.join(root,'supabase/.temp/project-ref'),'utf8')).trim(),OLD_REF);
 const reference=await readReady201Reference(root,path.join(workdir,ready201ReferenceName));
 // This compares two LOCAL rebuild references. It makes no claim about the
 // latest hosted upgrade200; apply performs its own current prefix check.
 const observedFile=path.join(workdir,ready200ReferenceName);
 const saved=await readReady200Reference(root,observedFile),observed=saved.catalog;
 const afterBuildDate=saved.buildUtcDate;
 const output=path.join(workdir,'offline201-'+new Date().toISOString().replaceAll(/[:.]/gu,'-'));await mkdir(output);
 const report={mode:'offline201',output,migrationCeiling:201,remoteWriteAttempted:false,observedFile};
 try{
  const prefix=reference.prefixes['200'];await persistCatalogComparison(output,prefix.catalog,observed,{beforeBuildDate:prefix.buildUtcDate,afterBuildDate},report);
  const plan=generateAclPlan(prefix.catalog,observed);await writeFile(path.join(output,'alignment.sql'),plan.commands.join('\n')+'\n');
  Object.assign(report,{ok:true,pending:['201'],prefix200Commands:plan.commandCount,latestHostedStateNotRead:true,localReferenceComparisonOnly:true});
 }catch(error){report.ok=false;report.error=error.message;}
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');return report;
}
export const run201=args=>ownerRun(args,{loadReference:readReady201Reference,referenceName:ready201ReferenceName,pipeline:upgrade201WithExecutor,
 inputsFor:inputs201,versions:upgrade201Versions,label:'201',offlinePlan:offline201});
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const result=await run201(process.argv.slice(2));console.log(JSON.stringify({ok:result.ok,output:result.output,error:result.error,applied:result.applied,remoteWriteAttempted:result.remoteWriteAttempted}));if(!result.ok)process.exitCode=1;}
 catch(error){console.error(error.code==='ERR_ASSERTION'?error.message.split('\n')[0]:'OWNER201_PREPARATION_FAILED');process.exitCode=1;}
}
