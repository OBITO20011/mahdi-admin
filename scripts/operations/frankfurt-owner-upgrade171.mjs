// Owner-only CLI;agent rehearsal uses disposable Docker executors exclusively.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {run as ownerRun,historySql} from './frankfurt-owner-upgrade.mjs';
import {upgrade164WithExecutor,inputs164,allUpgrade164Versions,offline164Plan} from './frankfurt-owner-upgrade164.mjs';
import {readReference171,readyReference171Name,productVersions,assertProduct171Catalog} from './frankfurt-reference171.mjs';
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
export const allUpgrade171Versions=Object.freeze([...allUpgrade164Versions,...productVersions]);
export function assert171History(history){
 const base=Array.from({length:138},(_,i)=>String(i+1).padStart(3,'0'));
 assert.ok(history.length>=138&&history.length<=148,'UPGRADE171_HISTORY_LENGTH');
 assert.deepEqual(history,[...base,...allUpgrade171Versions.slice(0,history.length-138)],'UPGRADE171_UNREVIEWED_HISTORY');
 return allUpgrade171Versions.slice(history.length-138);
}
export async function inputs171(reference){
 const inputs=await inputs164(reference);
 for(const version of productVersions){
  const unit=reference.manifest.find(m=>m.name.startsWith(version+'_'));assert.ok(unit);
  const input=await readFile(path.join(root,'supabase/migrations',unit.name));assert.equal(sha256(canonicalLf(input.toString('utf8'))),unit.sha256,'PRODUCT_MIGRATION_PIN_MISMATCH');
  inputs.push({...unit,version,input});
 }
 return inputs;
}
export async function upgrade171WithExecutor({executor,reference,original,output,repair,finalDryRun,report={}}){
 const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,'UPGRADE171_SQL_FAILED');return r.stdout.trim();};
 const catalog=async()=>JSON.parse(await sql(schemaCatalogSql)),history=async()=>JSON.parse(await sql(historySql));
 const dates={beforeBuildDate:reference.buildUtcDate,afterBuildDate:await sql("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;")};
 let current=await history();assert171History(current);Object.assign(report,{applied:[],recorded:[],remoteWriteAttempted:false});
 const checkHold=async()=>assert.deepEqual(await readNotificationSnapshot(executor),expectedHeldNotifications(original),'UPGRADE171_NOTIFICATION_HOLD_CHANGED');await checkHold();
 if(current.length<146){
  report.base164={};const baseOutput=path.join(output,'base164');await mkdir(baseOutput);
  try{await upgrade164WithExecutor({executor,reference:reference.base164,original,output:baseOutput,repair,
   finalDryRun:async()=>assert.deepEqual(await history(),reference.base164.appliedVersions),report:report.base164});}
  finally{report.applied.push(...(report.base164.applied??[]));report.recorded.push(...(report.base164.recorded??[]));report.remoteWriteAttempted=Boolean(report.base164.remoteWriteAttempted);}
  current=await history();
 }
 const prefix=reference.prefixes[current.at(-1)];assert.ok(prefix,'PRODUCT_PREFIX_REFERENCE_REQUIRED');let before=await catalog();
 const preflightOutput=path.join(output,'preflight-prefix');await mkdir(preflightOutput);report.prefixComparison={};
 await persistCatalogComparison(preflightOutput,prefix.catalog,before,{...dates,beforeBuildDate:prefix.buildUtcDate},report.prefixComparison);
 const preflight=generateAclPlan(prefix.catalog,before);await writeFile(path.join(output,'preflight-plan.json'),JSON.stringify(preflight,null,2)+'\n');
 assert.deepEqual(await readRealtimePublication(executor),reference.realtimePublication,'PRODUCT_PUBLICATION_DRIFT');
 const pending=assert171History(current);
 for(const unit of (await inputs171(reference)).filter(u=>productVersions.includes(u.version)&&pending.includes(u.version))){
  report.stage='apply-'+unit.version;report.remoteWriteAttempted=true;await sql(unit.input);report.applied.push(unit.version);
  const after=await catalog(),expected=reference.prefixes[unit.version],stageOutput=path.join(output,'prefix-'+unit.version);await mkdir(stageOutput);
  report.prefixComparisons??={};report.prefixComparisons[unit.version]={};
  await persistCatalogComparison(stageOutput,expected.catalog,after,{...dates,beforeBuildDate:expected.buildUtcDate},report.prefixComparisons[unit.version]);
  const plan=generateAclPlan(expected.catalog,after);await writeFile(path.join(stageOutput,'plan.json'),JSON.stringify(plan,null,2)+'\n');
  if(unit.version==='171')assertProduct171Catalog(after);
  assert.deepEqual(await readRealtimePublication(executor),reference.realtimePublication);await checkHold();
  report.stage='repair-'+unit.version;await repair(unit.version);report.recorded.push(unit.version);current.push(unit.version);assert.deepEqual(await history(),current);before=after;
 }
 report.stage='align171';const plan=generateAclPlan(reference.catalog,before);await writeFile(path.join(output,'alignment.sql'),plan.commands.join('\n')+'\n');
 report.finalAlignmentCommands=plan.commandCount;report.baseAlignmentCommands=report.base164?.alignmentCommands??0;report.alignmentCommands=report.baseAlignmentCommands+plan.commandCount;
 if(plan.commandCount){report.remoteWriteAttempted=true;report.alignment={};await alignWithExecutor(executor,reference,before,original,dates,output,report.alignment);}
 else await verifyCatalogReadOnly(executor,output,reference,original,dates,report);
 assertProduct171Catalog(await catalog());await checkHold();assert.deepEqual(await history(),reference.appliedVersions);await finalDryRun();
 Object.assign(report,{ok:true,catalogUnexpectedDifferenceCount:0,realtimeMembers:13,notificationHoldUnchanged:true});return report;
}
// Offline forecast is phase-labelled: align the rehearsed164 prefix first,
// then literal170/171 revoke the old writers and add the RPC-only correction.
// It is NOT a claim that all base164 ACL commands may run after171.
export function offline171Plan(reference,observed){
 const base=offline164Plan(reference.base164,observed);assertProduct171Catalog(reference.catalog);
 return {before:base.before,through164:base.after,pending:allUpgrade171Versions,
  phasePlans:[{phase:'through164',commands:base.after.commandCount},{phase:'170-171',commands:0}],
  commands:base.after.commandCount,notApplied:true,publicationCertified:false};
}
export async function offline171(args){
 assert.ok(args.every((v,i)=>['--dry-run','--workdir'].includes(v)||args[i-1]==='--workdir'),'UNKNOWN_OFFLINE_OPTION');
 const at=args.indexOf('--workdir'),workdir=path.resolve(at<0?DEFAULT_WORKDIR:args[at+1]);assertOutsideRepository(workdir);assertOutsideRepository(await realpath(workdir),await realpath(root));
 assert.equal((await readFile(path.join(root,'supabase/.temp/project-ref'),'utf8')).trim(),OLD_REF);
 const reference=await readReference171(root,path.join(workdir,readyReference171Name)),observed=JSON.parse(await readFile(path.join(workdir,'catalog-observed.json'),'utf8'));
 const output=path.join(workdir,'offline171-'+new Date().toISOString().replaceAll(/[:.]/gu,'-'));await mkdir(output);
 const report={mode:'offline171',migrationCeiling:171,remoteWriteAttempted:false,output};
 try{
  await writeFile(path.join(output,'source-catalog.json'),JSON.stringify(observed,null,2)+'\n');
  // Preserve all strict input differences BEFORE planning may reject them.
  const details=path.join(output,'input-comparison');await mkdir(details);report.inputComparison={};
  await persistCatalogComparison(details,reference.base164.base151.catalog,observed,{},report.inputComparison);
  const plan=offline171Plan(reference,observed);await writeFile(path.join(output,'plan.json'),JSON.stringify(plan,null,2)+'\n');
  await writeFile(path.join(output,'through164-alignment.sql'),plan.through164.commands.join('\n')+'\n');
  Object.assign(report,{ok:true,commands:plan.commands,objects:plan.through164.objectCount,pending:plan.pending,phasePlans:plan.phasePlans,publicationCertified:false});
 }catch(error){report.ok=false;report.error=error.message;}
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');return report;
}
export const run171=args=>ownerRun(args,{loadReference:readReference171,referenceName:readyReference171Name,pipeline:upgrade171WithExecutor,
 inputsFor:inputs171,versions:allUpgrade171Versions,label:'171',offlinePlan:offline171});
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const r=await run171(process.argv.slice(2));console.log(JSON.stringify({ok:r.ok,output:r.output,error:r.error,applied:r.applied,commands:r.alignmentCommands??r.commands,remoteWriteAttempted:r.remoteWriteAttempted}));if(!r.ok)process.exitCode=1;}
 catch(error){console.error(error.message);process.exitCode=1;}
}
