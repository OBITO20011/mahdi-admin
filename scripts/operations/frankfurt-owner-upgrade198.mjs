// Owner-operated; default offline. Agent tests use disposable Docker only.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {run as ownerRun,historySql} from './frankfurt-owner-upgrade.mjs';
import {readReady198Reference,ready198ReferenceName,assertReady198Catalog} from './frankfurt-reference198.mjs';
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
export const upgrade198Versions=Object.freeze(['180','181','182','190','191','192','193','194','195','196','197','198']);
export function assert198History(history,reference){
 const base=reference.prefixes['171'].appliedVersions;
 assert.equal(base.length,148);
 assert.ok(history.length>=base.length&&history.length<=reference.appliedVersions.length,'UPGRADE198_REQUIRES_REHEARSED171_PREFIX');
 assert.deepEqual(history,reference.appliedVersions.slice(0,history.length),'UPGRADE198_UNREVIEWED_HISTORY');
 assert.deepEqual(reference.appliedVersions.slice(base.length),upgrade198Versions);
 return upgrade198Versions.slice(history.length-base.length);
}
export async function inputs198(reference){
 return Promise.all(reference.manifest.filter(m=>Number(m.name.slice(0,3))>138).map(async unit=>{
  const version=unit.name.slice(0,3),input=await readFile(path.join(root,'supabase/migrations',unit.name));
  assert.equal(sha256(canonicalLf(input.toString('utf8'))),unit.sha256,'UPGRADE198_PIN_MISMATCH');return {...unit,version,input};
 }));
}
export async function upgrade198WithExecutor({executor,reference,original,output,repair,finalDryRun,report={}}){
 const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,'UPGRADE198_SQL_FAILED');return r.stdout.trim();};
 const catalog=async()=>JSON.parse(await sql(schemaCatalogSql)),history=async()=>JSON.parse(await sql(historySql));
 const dates={beforeBuildDate:reference.buildUtcDate,afterBuildDate:await sql("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;")};
 let current=await history();const pending=assert198History(current,reference);
 Object.assign(report,{applied:[],recorded:[],remoteWriteAttempted:false});
 const checkHold=async()=>assert.deepEqual(await readNotificationSnapshot(executor),expectedHeldNotifications(original),'UPGRADE198_NOTIFICATION_HOLD_CHANGED');
 const checkPrefix=async(version,name)=>{
  const expected=reference.prefixes[version],observed=await catalog();assert.ok(expected,'UPGRADE198_PREFIX_REQUIRED');
  const dir=path.join(output,name);await mkdir(dir);const comparison={};
  await persistCatalogComparison(dir,expected.catalog,observed,{...dates,beforeBuildDate:expected.buildUtcDate},comparison);
  const plan=generateAclPlan(expected.catalog,observed);
  await writeFile(path.join(dir,'acl-plan.json'),JSON.stringify(plan,null,2)+'\n');
  assert.deepEqual(await readRealtimePublication(executor),reference.realtimePublication,'UPGRADE198_PUBLICATION_DRIFT');
  await checkHold();return {observed,plan,comparison};
 };
 await checkPrefix(current.at(-1),'preflight-prefix');
 for(const unit of (await inputs198(reference)).filter(u=>pending.includes(u.version))){
  report.stage='apply-'+unit.version;report.remoteWriteAttempted=true;
  await sql(unit.input);report.applied.push(unit.version);
  const checked=await checkPrefix(unit.version,'prefix-'+unit.version);
  report.prefixComparisons??={};report.prefixComparisons[unit.version]={unexpected:checked.comparison.catalogComparison.unexpectedDifferenceCount,alignmentCommands:checked.plan.commandCount};
  report.stage='repair-'+unit.version;await repair(unit.version);report.recorded.push(unit.version);
  current.push(unit.version);assert.deepEqual(await history(),current,'UPGRADE198_RECORD_AFTER_SUCCESS_ONLY');
 }
 report.stage='align198';const before=await catalog(),plan=generateAclPlan(reference.catalog,before);
 await writeFile(path.join(output,'alignment.sql'),plan.commands.join('\n')+'\n');report.alignmentCommands=plan.commandCount;
 if(plan.commandCount){report.remoteWriteAttempted=true;report.alignment={};await alignWithExecutor(executor,reference,before,original,dates,output,report.alignment);}
 else await verifyCatalogReadOnly(executor,output,reference,original,dates,report);
 assertReady198Catalog(await catalog());await checkHold();assert.deepEqual(await history(),reference.appliedVersions);
 report.stage='official-cli-dry-run';await finalDryRun();
 Object.assign(report,{ok:true,catalogUnexpectedDifferenceCount:0,realtimeMembers:13,notificationHoldUnchanged:true});return report;
}
export async function offline198(args){
 assert.ok(args.every((v,i)=>['--dry-run','--workdir'].includes(v)||args[i-1]==='--workdir'),'UNKNOWN_OFFLINE_OPTION');
 const at=args.indexOf('--workdir'),workdir=path.resolve(at<0?DEFAULT_WORKDIR:args[at+1]);assertOutsideRepository(workdir);assertOutsideRepository(await realpath(workdir),await realpath(root));
 assert.equal((await readFile(path.join(root,'supabase/.temp/project-ref'),'utf8')).trim(),OLD_REF);
 const reference=await readReady198Reference(root,path.join(workdir,ready198ReferenceName));
 // This is the owner's saved successful171 verification,not a live connection.
 const observedFile=path.join(workdir,'upgrade171-2026-10-15T21-49-29-161Z/catalog-observed.json');
 const observed=JSON.parse(await readFile(observedFile,'utf8')),prefix=reference.prefixes['171'];
 const output=path.join(workdir,'offline198-'+new Date().toISOString().replaceAll(/[:.]/gu,'-'));await mkdir(output);
 const report={mode:'offline198',migrationCeiling:198,remoteWriteAttempted:false,observedFile,output};
 try{
  const saved=JSON.parse(await readFile(path.join(path.dirname(observedFile),'report.json'),'utf8'));
  const afterBuildDate=saved.catalogComparison?.dates?.afterBuildDate??saved.endedAt?.slice(0,10);
  assert.match(afterBuildDate??'',/^\d{4}-\d{2}-\d{2}$/u,'SAVED171_CAPTURE_DATE_REQUIRED');
  const comparisonOutput=path.join(output,'saved171-comparison');await mkdir(comparisonOutput);report.savedComparison={};
  await persistCatalogComparison(comparisonOutput,prefix.catalog,observed,{beforeBuildDate:prefix.buildUtcDate,afterBuildDate},report.savedComparison);
  const plan=generateAclPlan(prefix.catalog,observed);
  await writeFile(path.join(output,'plan.json'),JSON.stringify(plan,null,2)+'\n');
  await writeFile(path.join(output,'prefix171-alignment.sql'),plan.commands.join('\n')+'\n');
  Object.assign(report,{ok:true,pending:upgrade198Versions,prefix171Commands:plan.commandCount,finalCommandsOnRehearsedReference:0,
   latestHostedStateNotRead:true,publicationCertified:false});
 }catch(error){report.ok=false;report.error=error.message;}
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');return report;
}
export const run198=args=>ownerRun(args,{loadReference:readReady198Reference,referenceName:ready198ReferenceName,pipeline:upgrade198WithExecutor,
 inputsFor:inputs198,versions:upgrade198Versions,label:'198',offlinePlan:offline198});
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const r=await run198(process.argv.slice(2));console.log(JSON.stringify({ok:r.ok,output:r.output,error:r.error,applied:r.applied,commands:r.alignmentCommands??r.prefix171Commands,remoteWriteAttempted:r.remoteWriteAttempted}));if(!r.ok)process.exitCode=1;}
 catch(error){console.error(error.code==='ERR_ASSERTION'?error.message.split('\n')[0]:'OWNER198_PREPARATION_FAILED');process.exitCode=1;}
}
