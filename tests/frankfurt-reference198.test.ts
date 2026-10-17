import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {inventoryBeforeStagingConfig as inventory} from '../scripts/audit/source-before-staging-config.mjs';
import {migrationManifest,manifestDigest,sha256} from '../scripts/testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../scripts/testing/schema-catalog.mjs';
import {realtime151Tables,realtimePublicationSql} from '../scripts/testing/realtime151-contract.mjs';
import {assertReady198Reference,ready198ReferenceName} from '../scripts/operations/frankfurt-reference198.mjs';
import {assert198History,upgrade198Versions,run198} from '../scripts/operations/frankfurt-owner-upgrade198.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
test('198 reference bound to current real DB proof,rejects historical targets,tampered ACL/body/history/publication and readiness',async()=>{
 const manifest=await migrationManifest(root),source=await inventory(),proofText=await readFile('docs/operations/TABLE_ACCESS_AFTER_198.json','utf8'),proof=JSON.parse(proofText);
 const publication={publication:{name:'supabase_realtime',owner:'postgres',allTables:false},
  tables:realtime151Tables.map(name=>({schema:'public',name,columns:[],filter:null}))};
 const catalog=structuredClone(proof.catalog),date=proof.startedAt.slice(0,10);
 const snapshot=(version:number)=>({catalog:structuredClone(catalog),catalogSha256:sha256(JSON.stringify(catalog)),appliedVersions:manifest.filter(m=>Number(m.name.slice(0,3))<=version).map(m=>m.name.slice(0,3)),buildUtcDate:date,realtimePublication:publication});
 const prefixes=Object.fromEntries(manifest.filter(m=>Number(m.name.slice(0,3))>=138).map(m=>[m.name.slice(0,3),snapshot(Number(m.name.slice(0,3)))]));
 const reference={format:9,migrationCeiling:198,manifest,manifestDigest:manifestDigest(manifest),...snapshot(198),prefixes,functions:511,
  catalogQuerySha256:sha256(schemaCatalogSql),realtimeQuerySha256:sha256(realtimePublicationSql),realtimeSha256:sha256(JSON.stringify(publication)),freshIncrementalDifferenceCount:0,
  readiness:{sourceHashes:source.sources,accessEvidenceSha256:sha256(proofText.replaceAll('\r\n','\n')),coverage:proof.coverage,queries:proof.results.length,errors:0}};
 assert.equal(assertReady198Reference(reference,manifest,proofText,source),reference);
 for(const change of [
  (r:typeof reference)=>{r.format=8;r.migrationCeiling=195;},
  (r:typeof reference)=>{r.appliedVersions.pop();},
  (r:typeof reference)=>{r.readiness.sourceHashes=[];},
  (r:typeof reference)=>{r.realtimePublication.tables.pop();r.realtimeSha256=sha256(JSON.stringify(r.realtimePublication));},
  (r:typeof reference)=>{r.freshIncrementalDifferenceCount=1;},
  (r:typeof reference)=>{r.catalog.functions.find((f:{schema:string;identity:string})=>f.schema==='public'&&f.identity.startsWith('preview_customer_collection_v1('))!.definition+='\n-- unexpected definition';r.catalogSha256=sha256(JSON.stringify(r.catalog));},
  (r:typeof reference)=>{r.catalog.tables.find((t:{schema:string;name:string})=>t.schema==='public'&&t.name==='go_live_import_batches')!.acl.push('anon=r/postgres');r.catalogSha256=sha256(JSON.stringify(r.catalog));},
 ]){const changed=structuredClone(reference);change(changed);assert.throws(()=>assertReady198Reference(changed,manifest,proofText,source));}
 const base=reference.prefixes['171']!.appliedVersions;
 for(let count=0;count<=12;count++)assert.deepEqual(assert198History([...base,...upgrade198Versions.slice(0,count)],reference),upgrade198Versions.slice(count));
 assert.throws(()=>assert198History(base.slice(0,-1),reference));assert.throws(()=>assert198History([...base,'183'],reference));
 assert.equal(ready198ReferenceName,'local-reference-through198-ready.json');
});
test('198 owner command rejects unknown modes and conflicting apply before filesystem,password or connection',async()=>{
 await assert.rejects(()=>run198(['--host','example.invalid']),/UNKNOWN_OPTION/u);
 await assert.rejects(()=>run198(['--apply','--dry-run']),/ONE_MODE_REQUIRED/u);
 const source=await readFile('scripts/operations/frankfurt-owner-upgrade198.mjs','utf8');
 for(const text of ['expectedHeldNotifications(original)','persistCatalogComparison','checkPrefix(current.at(-1)','await repair(unit.version)','await finalDryRun()','readReady198Reference'])assert.ok(source.includes(text),text);
 assert.ok(source.indexOf("await checkPrefix(unit.version")<source.indexOf('await repair(unit.version)'));
 const runtime=await readFile('scripts/testing/run-frankfurt-upgrade198-runtime.mjs','utf8');
 for(const text of ["NAWASRAH_MAX_MIGRATION:'171'",'applied.length,12','recorded.length,12','report.replay.remoteWriteAttempted,false','functionReference(executor,198)'])assert.ok(runtime.includes(text),text);
});
