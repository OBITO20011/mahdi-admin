// Owner-only164 upgrade. Agent uses only the Docker executor seam in rehearsal.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {run as ownerRun,upgradeWithExecutor,upgradeInputs,upgradeVersions,historySql} from './frankfurt-owner-upgrade.mjs';
import {readReference164,readyReference164Name,startupVersions,assertStartupTableAcl} from './frankfurt-reference164.mjs';
import {DEFAULT_WORKDIR,assertOutsideRepository,OLD_REF} from './frankfurt-owner-build.mjs';
import {executeInput} from './build-empty-supabase.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {sha256,canonicalLf} from '../testing/maintenance-db-contract.mjs';
import {readRealtimePublication} from '../testing/realtime151-contract.mjs';
import {readNotificationSnapshot,expectedHeldNotifications} from './frankfurt-notification-hold.mjs';
import {generateAclPlan} from './frankfurt-acl-plan.mjs';
import {forecast150} from './forecast-grants150.mjs';
import {alignWithExecutor} from './frankfurt-align-acl.mjs';
import {verifyCatalogReadOnly,persistCatalogComparison} from './frankfurt-catalog-verification.mjs';
import {compareManagedCatalog} from './managed-catalog-policy.mjs';
const root=path.resolve(import.meta.dirname,'../..');
export const allUpgrade164Versions=Object.freeze([...upgradeVersions,...startupVersions]);
export function assert164History(history){
 const base=Array.from({length:138},(_,i)=>String(i+1).padStart(3,'0'));
 assert.ok(history.length>=138&&history.length<=146,'UPGRADE164_HISTORY_LENGTH');
 assert.deepEqual(history,[...base,...allUpgrade164Versions.slice(0,history.length-138)],'UPGRADE164_UNREVIEWED_HISTORY');
 return allUpgrade164Versions.slice(history.length-138);
}
export async function inputs164(reference){
 const inputs=await upgradeInputs(reference);
 for(const version of startupVersions){
  const unit=reference.manifest.find(m=>m.name.startsWith(version+'_'));assert.ok(unit);
  const input=await readFile(path.join(root,'supabase/migrations',unit.name));
  assert.equal(sha256(canonicalLf(input.toString('utf8'))),unit.sha256,'STARTUP_MIGRATION_PIN_MISMATCH');inputs.push({...unit,version,input});
 }
 return inputs;
}
export async function upgrade164WithExecutor({executor,reference,original,output,repair,finalDryRun,report={}}){
 const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,'UPGRADE164_SQL_FAILED');return r.stdout.trim();};
 const catalog=async()=>JSON.parse(await sql(schemaCatalogSql)),history=async()=>JSON.parse(await sql(historySql));
 const dates={beforeBuildDate:reference.buildUtcDate,afterBuildDate:await sql("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;")};
 let current=await history();assert164History(current);report.applied=[];report.recorded=[];report.remoteWriteAttempted=false;
 const checkHold=async()=>assert.deepEqual(await readNotificationSnapshot(executor),expectedHeldNotifications(original),'UPGRADE164_NOTIFICATION_HOLD_CHANGED');
 await checkHold();
 if(current.length<141){
  report.base151={};const baseOutput=path.join(output,'base151');await mkdir(baseOutput);
  try{await upgradeWithExecutor({executor,reference:reference.base151,original,output:baseOutput,repair,
   finalDryRun:async()=>assert.deepEqual(await history(),reference.base151.appliedVersions),report:report.base151});}
  finally{
   report.applied.push(...(report.base151.applied??[]));report.recorded.push(...(report.base151.recorded??[]));
   report.remoteWriteAttempted=Boolean(report.base151.remoteWriteAttempted);
  }
  current=await history();
 }
 const prefix=reference.prefixes[current.at(-1)];assert.ok(prefix,'STARTUP_PREFIX_REFERENCE_REQUIRED');
 let before=await catalog();
 await writeFile(path.join(output,'preflight-catalog.json'),JSON.stringify(before,null,2)+'\n');
 const prefixOutput=path.join(output,'preflight-prefix');await mkdir(prefixOutput);report.prefixComparison={};
 await persistCatalogComparison(prefixOutput,prefix.catalog,before,{...dates,beforeBuildDate:prefix.buildUtcDate},report.prefixComparison);
 // Only ACL drift is repairable;all definitions/owner/RLS must match the
 // ACTUALLY REHEARSED corresponding prefix before a single startup write.
 const preflight=generateAclPlan(prefix.catalog,before);
 await writeFile(path.join(output,'preflight-plan.json'),JSON.stringify(preflight,null,2)+'\n');
 assert.deepEqual(await readRealtimePublication(executor),reference.realtimePublication,'STARTUP_PUBLICATION_DRIFT');
 const pending=assert164History(current);
 for(const unit of (await inputs164(reference)).filter(u=>startupVersions.includes(u.version)&&pending.includes(u.version))){
  report.stage='apply-'+unit.version;report.remoteWriteAttempted=true;await sql(unit.input);report.applied.push(unit.version);
  const after=await catalog(),expected=reference.prefixes[unit.version];
  await writeFile(path.join(output,'after-'+unit.version+'-catalog.json'),JSON.stringify(after,null,2)+'\n');
  const stageOutput=path.join(output,'prefix-'+unit.version);await mkdir(stageOutput);
  report.prefixComparisons??={};report.prefixComparisons[unit.version]={};
  await persistCatalogComparison(stageOutput,expected.catalog,after,{...dates,beforeBuildDate:expected.buildUtcDate},report.prefixComparisons[unit.version]);
  const plan=generateAclPlan(expected.catalog,after); // fails on ANY non-ACL app drift
  await writeFile(path.join(output,'after-'+unit.version+'-comparison.json'),JSON.stringify(plan,null,2)+'\n');
  if(unit.version==='164')assertStartupTableAcl(after);
  assert.deepEqual(await readRealtimePublication(executor),reference.realtimePublication);await checkHold();
  report.stage='repair-'+unit.version;await repair(unit.version);report.recorded.push(unit.version);current.push(unit.version);
  assert.deepEqual(await history(),current,'STARTUP_REPAIR_HISTORY_MISMATCH');before=after;
 }
 report.stage='align164';const plan=generateAclPlan(reference.catalog,before);
 await writeFile(path.join(output,'alignment.sql'),plan.commands.join('\n')+'\n');
 report.finalAlignmentCommands=plan.commandCount;report.baseAlignmentCommands=report.base151?.alignmentCommands??0;
 report.alignmentCommands=report.baseAlignmentCommands+report.finalAlignmentCommands;
 report.alignmentObjects=plan.objectCount;
 if(plan.commandCount){report.remoteWriteAttempted=true;report.alignment={};await alignWithExecutor(executor,reference,before,original,dates,output,report.alignment);}
 else await verifyCatalogReadOnly(executor,output,reference,original,dates,report);
 assertStartupTableAcl(await catalog());await checkHold();assert.deepEqual(await history(),reference.appliedVersions);
 await finalDryRun();Object.assign(report,{ok:true,catalogUnexpectedDifferenceCount:0,realtimeMembers:13,notificationHoldUnchanged:true});return report;
}
// Forecast,NOT verification or execution: retain observed ACL atoms on known
// objects after150,while using the exact locally rehearsed164 structural result.
export function offline164Plan(reference,observed){
 const before=generateAclPlan(reference.base151.catalog,observed,{offlinePending139:true});
 const forecast=structuredClone(reference.catalog),after150=forecast150(observed);
 for(const section of ['tables','functions','schemas','defaultPrivileges'])for(const row of forecast[section]??[]){
  const found=(after150[section]??[]).find(r=>r.schema===row.schema&&r.name===row.name&&r.identity===row.identity&&r.role===row.role&&r.type===row.type);
  if(found){row.acl=structuredClone(found.acl);if(row.columns)for(const c of row.columns){const old=found.columns.find(x=>x.name===c.name);if(old)c.acl=structuredClone(old.acl);}}
 }
 const after=generateAclPlan(reference.catalog,forecast);assertStartupTableAcl(after.predicted);
 return {before,after,pending:allUpgrade164Versions,notApplied:true,publicationCertified:false};
}
export async function offline164(args){
 assert.ok(args.every((v,i)=>['--dry-run','--workdir'].includes(v)||args[i-1]==='--workdir'),'UNKNOWN_OFFLINE_OPTION');
 const index=args.indexOf('--workdir'),workdir=path.resolve(index<0?DEFAULT_WORKDIR:args[index+1]);
 assertOutsideRepository(workdir);assertOutsideRepository(await realpath(workdir),await realpath(root));
 assert.equal((await readFile(path.join(root,'supabase/.temp/project-ref'),'utf8')).trim(),OLD_REF);
 const reference=await readReference164(root,path.join(workdir,readyReference164Name));
 const observed=JSON.parse(await readFile(path.join(workdir,'catalog-observed.json'),'utf8'));
 const output=path.join(workdir,'offline164-'+new Date().toISOString().replaceAll(/[:.]/gu,'-'));await mkdir(output);
 const report={mode:'offline164',remoteWriteAttempted:false,output,reference:readyReference164Name,migrationCeiling:164};
 try{
  await writeFile(path.join(output,'catalog-comparison-before.json'),JSON.stringify(compareManagedCatalog(reference.base151.catalog,observed),null,2)+'\n');
  await writeFile(path.join(output,'source-catalog.json'),JSON.stringify(observed,null,2)+'\n');
  const plan=offline164Plan(reference,observed);await writeFile(path.join(output,'plan.json'),JSON.stringify(plan,null,2)+'\n');
  await writeFile(path.join(output,'after-migrations-preview.sql'),plan.after.commands.join('\n')+'\n');
  Object.assign(report,{ok:true,beforeCommands:plan.before.commandCount,commands:plan.after.commandCount,objects:plan.after.objectCount,pending:plan.pending,publicationCertified:false});
 }catch(error){report.ok=false;report.error=error.message;}
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');return report;
}
export const run164=args=>ownerRun(args,{loadReference:readReference164,referenceName:readyReference164Name,pipeline:upgrade164WithExecutor,
 inputsFor:inputs164,versions:allUpgrade164Versions,label:'164',offlinePlan:offline164});
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const report=await run164(process.argv.slice(2));console.log(JSON.stringify({ok:report.ok,output:report.output,error:report.error,applied:report.applied,commands:report.alignmentCommands??report.commands,remoteWriteAttempted:report.remoteWriteAttempted}));if(!report.ok)process.exitCode=1;}
 catch(error){console.error(error.message);process.exitCode=1;}
}
