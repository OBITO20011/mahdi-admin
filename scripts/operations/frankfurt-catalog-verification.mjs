// Read-only SQL + local evidence files. Never repair,apply,link,disable or grant.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {executeInput} from './build-empty-supabase.mjs';
import {schemaCatalogSql,catalogDifference} from '../testing/schema-catalog.mjs';
import {readNotificationSnapshot,expectedHeldNotifications,isExpectedHeldTriggerDifference,heldJobNames,heldTrigger} from './frankfurt-notification-hold.mjs';
import {compareManagedCatalog,assertManagedCatalog as assertHeldCatalog} from './managed-catalog-policy.mjs';
import {readRealtimePublication,realtimePublicationSql} from '../testing/realtime151-contract.mjs';
import {sha256} from '../testing/maintenance-db-contract.mjs';

// Configure each actual psql session,not a startup option a pooler may ignore.
// -c runs first,then -f - consumes only the read queries on the SAME connection.
export const readOnlyPsqlSessionArgs=Object.freeze(['-c','SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;','-f','-']);

/** @returns {{section:string,schema:string|null,object:string,table:string|null,type:string,change:string,expected:boolean,local:Record<string,unknown>|null,remote:Record<string,unknown>|null}} */
function detail(d,expected=false){
 const object=d.after??d.before??{};
 return {section:d.section,schema:object.schema??(d.section==='schemas'?object.name:null),
  object:object.name??object.identity??object.role??d.identity,table:object.table??null,
  type:d.section,change:d.before===null?'added':d.after===null?'removed':'changed',
  expected,local:d.before,remote:d.after};
}
const notificationRows=s=>[s.trigger,...s.jobs.map(j=>({schema:'cron',table:'job',name:j.name,definition:j}))];

/** @param {{beforeBuildDate:string,afterBuildDate:string}} dates */
export async function persistCatalogComparison(workdir,reference,observed,dates,report){
 // Persist literal differences FIRST,even if date normalization itself fails.
 /** @type {ReturnType<typeof detail>[]} */
 const differences=[];
 const artifact={capturedAt:new Date().toISOString(),dates,rawDifferences:catalogDifference(reference,observed).map(d=>detail(d,isExpectedHeldTriggerDifference(d))),
  differences,normalizationError:null};
 const filename=path.join(workdir,'catalog-differences.json');
 report.catalogDifferencesFile=filename;report.catalogComparison=artifact;
 await writeFile(path.join(workdir,'catalog-observed.json'),JSON.stringify(observed,null,2)+'\n');
 await writeFile(filename,JSON.stringify(artifact,null,2)+'\n');
 try{
  const classified=compareManagedCatalog(reference,observed,dates);
  artifact.differences=[...classified.expected,...classified.unexpected].map(d=>detail(d,isExpectedHeldTriggerDifference(d)));
  artifact.platformInformation=classified.platform.map(d=>detail(d));
  artifact.netHttpPost=classified.netHttpPost;
  artifact.unexpectedDifferenceCount=classified.unexpected.length;
 }catch{
  artifact.normalizationError='CATALOG_NORMALIZATION_FAILED';
  await writeFile(filename,JSON.stringify(artifact,null,2)+'\n');
  throw new Error('CATALOG_NORMALIZATION_FAILED');
 }
 report.catalogDifferences=artifact.differences;
 await writeFile(filename,JSON.stringify(artifact,null,2)+'\n');
 return artifact;
}

/** @param {{beforeBuildDate:string,afterBuildDate:string}} dates */
export async function verifyCatalogReadOnly(executor,workdir,reference,originalNotifications,dates,report){
 const read=await executeInput(executor,schemaCatalogSql);
 assert.equal(read.code,0,'CATALOG_READ_FAILED');
 const observed=JSON.parse(read.stdout.trim());
 report.catalogCounts=Object.fromEntries(Object.entries(observed).map(([name,rows])=>[name,rows?.length??0]));
 const comparison=await persistCatalogComparison(workdir,reference.catalog,observed,dates,report);
 const actual=await readNotificationSnapshot(executor),expected=expectedHeldNotifications(originalNotifications);
 const differences=catalogDifference({notificationState:notificationRows(expected)},{notificationState:notificationRows(actual)}).map(d=>detail(d));
 report.notificationComparison={expected,observed:actual,differences,
  expectedChanges:[{schema:'public',table:'orders',object:heldTrigger,property:'enabled',before:'O',after:'D'},
   ...heldJobNames.map(name=>({schema:'cron',table:'job',object:name,property:'active',before:true,after:false}))]};
 // Evidence is also in the standalone file on EVERY later comparison failure.
 comparison.notificationComparison=report.notificationComparison;
 await writeFile(report.catalogDifferencesFile,JSON.stringify(comparison,null,2)+'\n');
 if(reference.realtimePublication){
  assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql),'REALTIME_REFERENCE_QUERY_STALE');
  const publication=await readRealtimePublication(executor);
  const changes=catalogDifference({publication:[reference.realtimePublication]},{publication:[publication]});
  report.realtimeComparison={expected:reference.realtimePublication,observed:publication,differences:changes};
  await writeFile(path.join(workdir,'realtime-comparison.json'),JSON.stringify(report.realtimeComparison,null,2)+'\n');
  comparison.realtimeComparison=report.realtimeComparison;
  await writeFile(report.catalogDifferencesFile,JSON.stringify(comparison,null,2)+'\n');
  assert.deepEqual(publication,reference.realtimePublication,'REALTIME_PUBLICATION_MISMATCH');
 }else report.realtimeComparison={certified:false,reason:'HISTORICAL_REFERENCE_HAS_NO_PUBLICATION_SNAPSHOT'};
 // Named trigger state,not a difference count;cron rows remain exact DATA checks.
 report.catalogExpectedHold=assertHeldCatalog(reference.catalog,observed,dates);
 assert.equal(differences.length,0,'NOTIFICATION_STATE_MISMATCH');
 report.catalogUnexpectedDifferenceCount=0;
 return comparison;
}
