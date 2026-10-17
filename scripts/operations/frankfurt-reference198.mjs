import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {migrationManifest,manifestDigest,sha256,canonicalLf} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql,realtime151Tables} from '../testing/realtime151-contract.mjs';
import {assertChequesCatalog} from './frankfurt-reference-cheques.mjs';
import {aclEntries,compareManagedCatalog} from './managed-catalog-policy.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';
import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
export const ready198Ceiling=198;
export const ready198ReferenceName='local-reference-through198-ready.json';
export function assertReady198Catalog(catalog){
 assertChequesCatalog(catalog);
 const batches=catalog.tables.find(t=>t.schema==='public'&&t.name==='go_live_import_batches');
 assert.ok(batches,'GO_LIVE_BATCH_TABLE_REQUIRED');
 assert.ok(!aclEntries(batches.acl,batches,'tables').some(a=>['PUBLIC','anon','authenticated'].includes(a.grantee)),'STARTUP_BATCH_RPC_ONLY');
 for(const name of ['preview_customer_collection_v1','get_customer_collections_v1','get_customer_outstanding_orders_page']){
  const f=catalog.functions.find(f=>f.schema==='public'&&f.identity.startsWith(name+'('));
  assert.ok(f,'COLLECTION_READER_REQUIRED:'+name);assert.match(f.definition,/'cashier'/u);
 }

}
export function assertReady198Reference(reference,manifest,proofText,source){
 assert.equal(reference.format,9,'READY198_REFERENCE_REQUIRED');assert.equal(reference.migrationCeiling,198,'READY198_REFERENCE_REQUIRED');
 assert.equal(manifest.length,160);assert.equal(manifest.at(-1)?.name,'198_cashier_customer_collection_access.sql');
 assert.deepEqual(reference.manifest,manifest);assert.equal(reference.manifestDigest,manifestDigest(manifest));
 assert.deepEqual(reference.appliedVersions,manifest.map(m=>m.name.slice(0,3)));
 assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql));assert.equal(reference.catalogSha256,sha256(JSON.stringify(reference.catalog)));
 assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql));assert.equal(reference.realtimeSha256,sha256(JSON.stringify(reference.realtimePublication)));
 assert.deepEqual(reference.realtimePublication.tables.map(t=>t.schema+'.'+t.name).sort(),realtime151Tables.map(t=>'public.'+t).sort(),'EXACT13_REALTIME_MEMBERS');
 assert.equal(reference.realtimePublication.publication.allTables,false);assert.equal(reference.realtimePublication.publication.owner,'postgres');
 const proof=JSON.parse(proofText);assert.equal(proof.migrationCeiling,198);assert.equal(proof.managedAccess,false);
 assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.deepEqual(proof.sourceHashes,source.sources);
 assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results));assert.ok(proof.results.every(r=>r.sqlstate===null));
 assert.deepEqual(proof.manifest,manifest.map(m=>m.name));
 assert.equal(compareManagedCatalog(proof.catalog,reference.catalog,{beforeBuildDate:proof.startedAt.slice(0,10),afterBuildDate:reference.buildUtcDate}).unexpected.length,0,'REFERENCE_MUST_MATCH_GENUINE198_DATABASE_PROOF');
 assert.deepEqual(reference.readiness,{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),coverage:proof.coverage,queries:proof.results.length,errors:0});
 const versions=manifest.filter(m=>Number(m.name.slice(0,3))>=138).map(m=>m.name.slice(0,3));
 assert.deepEqual(Object.keys(reference.prefixes),versions);
 for(const version of versions){
  const snapshot=reference.prefixes[version];assert.equal(snapshot.catalogSha256,sha256(JSON.stringify(snapshot.catalog)));
  assert.deepEqual(snapshot.appliedVersions,manifest.filter(m=>Number(m.name.slice(0,3))<=Number(version)).map(m=>m.name.slice(0,3)));
  if(Number(version)>=151)assert.deepEqual(snapshot.realtimePublication,reference.realtimePublication);
 }
 assert.deepEqual(reference.prefixes['198'].catalog,reference.catalog);assert.equal(reference.freshIncrementalDifferenceCount,0);
 assert.equal(reference.functions,511);assertReady198Catalog(reference.catalog);return reference;
}
export async function readReady198Reference(root,filename){
 return assertReady198Reference(JSON.parse(await readFile(filename,'utf8')),(await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=198),
  await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_198.json'),'utf8'),await inventory());
}
