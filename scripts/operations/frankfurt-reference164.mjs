// Current integration reference;historical151 remains independently testable.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {migrationManifest,manifestDigest,sha256,canonicalLf} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql} from '../testing/realtime151-contract.mjs';
import {assertReference151} from './frankfurt-reference151.mjs';
import {aclEntries} from './managed-catalog-policy.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';
import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
export const readyReference164Name='local-reference-001-139-150-151-160-164-ready.json';
export const startupVersions=Object.freeze(['160','161','162','163','164']);
export const startupTables=Object.freeze(['customer_collection_opening_allocations','customer_collection_operations',
 'customer_collection_order_payments','customer_opening_balances','go_live_import_batches','go_live_setup_state',
 'supplier_opening_balances','supplier_opening_payments']);
export function assertStartupTableAcl(catalog){
 for(const name of startupTables){
  const row=catalog.tables.find(t=>t.schema==='public'&&t.name===name);assert.ok(row,'STARTUP_TABLE_REQUIRED:'+name);
  assert.equal(row.owner,'postgres');assert.equal(row.rls,true,'STARTUP_RLS_REQUIRED:'+name);
  assert.ok(!aclEntries(row.acl,row,'tables').some(a=>['PUBLIC','anon','authenticated'].includes(a.grantee)),'STARTUP_RPC_ONLY:'+name);
  for(const c of row.columns)assert.ok(!aclEntries(c.acl??[],row,'columns').some(a=>['PUBLIC','anon','authenticated'].includes(a.grantee)),'STARTUP_COLUMN_GRANT:'+name);
 }
}
export function assertReference164(reference,manifest,proofText,source,baseProofText){
 assert.equal(reference.format,5,'READY164_REFERENCE_REQUIRED');assert.equal(reference.migrationCeiling,164,'READY164_REFERENCE_REQUIRED');
 assert.equal(manifest.at(-1)?.name,'164_go_live_receivables_in_reports.sql');
 assert.equal(manifest.length,146,'EXACT164_FILE_COUNT');
 assert.deepEqual(reference.manifest,manifest,'READY164_MANIFEST_MISMATCH');
 assert.equal(reference.manifestDigest,manifestDigest(manifest));
 assert.deepEqual(reference.appliedVersions,manifest.map(m=>m.name.slice(0,3)));
 assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql));
 assert.equal(reference.catalogSha256,sha256(JSON.stringify(reference.catalog)));
 assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql));
 assert.equal(reference.realtimeSha256,sha256(JSON.stringify(reference.realtimePublication)));
 assertReference151(reference.base151,manifest.filter(m=>Number(m.name.slice(0,3))<=151),baseProofText,source);
 assert.deepEqual(reference.realtimePublication,reference.base151.realtimePublication,'STARTUP_MUST_NOT_CHANGE_PUBLICATION');
 const proof=JSON.parse(proofText);assert.equal(proof.migrationCeiling,164);
 assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.equal(proof.managedAccess,false);
 assert.deepEqual(proof.manifest,manifest.map(m=>m.name));assert.deepEqual(proof.sourceHashes,source.sources);
 assert.ok(proof.results.every(r=>r.sqlstate===null),'READY164_QUERY_ERROR');
 const coverage=verifyProbeCoverage(source,proof.results);assert.deepEqual(proof.coverage,coverage);
 assert.deepEqual(reference.readiness,{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),coverage,queries:proof.results.length,errors:0});
 assert.deepEqual(Object.keys(reference.prefixes).sort(),['151',...startupVersions]);
 for(const [version,snapshot] of Object.entries(reference.prefixes)){
  assert.equal(snapshot.catalogSha256,sha256(JSON.stringify(snapshot.catalog)),'PREFIX_CATALOG_DIGEST:'+version);
  assert.deepEqual(snapshot.appliedVersions,manifest.filter(m=>Number(m.name.slice(0,3))<=Number(version)).map(m=>m.name.slice(0,3)),'PREFIX_HISTORY:'+version);
  assert.deepEqual(snapshot.realtimePublication,reference.realtimePublication,'PREFIX_PUBLICATION:'+version);
 }
 assert.deepEqual(reference.prefixes['164'].catalog,reference.catalog,'FRESH_INCREMENTAL_CATALOG_NOT_IDENTICAL');
 assert.equal(reference.freshIncrementalDifferenceCount,0);assertStartupTableAcl(reference.catalog);
 return reference;
}
export async function readReference164(root,filename){
 return assertReference164(JSON.parse(await readFile(filename,'utf8')),(await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=164),
  await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_164.json'),'utf8'),await inventory(),
  await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_150.json'),'utf8'));
}
