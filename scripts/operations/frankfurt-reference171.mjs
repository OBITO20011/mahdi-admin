import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {migrationManifest,manifestDigest,sha256,canonicalLf} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql} from '../testing/realtime151-contract.mjs';
import {assertReference164,assertStartupTableAcl} from './frankfurt-reference164.mjs';
import {aclEntries} from './managed-catalog-policy.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';
import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
export const readyReference171Name='local-reference-001-139-150-151-160-164-170-171-ready.json';
export const productVersions=Object.freeze(['170','171']);
export function assertProduct171Catalog(catalog){
 assertStartupTableAcl(catalog);
 const table=catalog.tables.find(t=>t.schema==='public'&&t.name==='product_cost_corrections');
 assert.ok(table,'COST_CORRECTIONS_TABLE_REQUIRED');assert.equal(table.owner,'postgres');assert.equal(table.rls,true);
 const closed=atoms=>assert.ok(!atoms.some(a=>['PUBLIC','anon','authenticated'].includes(a.grantee)),'PRODUCT_CORRECTIONS_RPC_ONLY');
 closed(aclEntries(table.acl,table,'tables'));for(const c of table.columns)closed(aclEntries(c.acl??[],table,'columns'));
 for(const name of ['update_product_master_v3','update_product_flavor_v1','product_edit_snapshot_internal',
  'product_edit_assert_version_internal','product_has_cost_history_internal','product_cost_corrections_reject_mutation']){
  const functions=catalog.functions.filter(f=>f.schema==='public'&&f.identity.startsWith(name+'('));assert.equal(functions.length,1,'EXACT_INTERNAL_SIGNATURE:'+name);
  closed(aclEntries(functions[0].acl,functions[0],'functions'));
 }
}
export function assertReference171(reference,manifest,proofText,source,proof164,proof150){
 assert.equal(reference.format,6,'READY171_REFERENCE_REQUIRED');assert.equal(reference.migrationCeiling,171,'READY171_REFERENCE_REQUIRED');
 assert.equal(manifest.length,148);assert.equal(manifest.at(-1)?.name,'171_product_cost_preserved_on_edit.sql');
 assert.deepEqual(reference.manifest,manifest);assert.equal(reference.manifestDigest,manifestDigest(manifest));
 assert.deepEqual(reference.appliedVersions,manifest.map(m=>m.name.slice(0,3)));
 assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql));assert.equal(reference.catalogSha256,sha256(JSON.stringify(reference.catalog)));
 assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql));assert.equal(reference.realtimeSha256,sha256(JSON.stringify(reference.realtimePublication)));
 assertReference164(reference.base164,manifest.filter(m=>Number(m.name.slice(0,3))<=164),proof164,source,proof150);
 assert.deepEqual(reference.realtimePublication,reference.base164.realtimePublication);
 const proof=JSON.parse(proofText);assert.equal(proof.migrationCeiling,171);assert.equal(proof.infrastructureOk,true);
 assert.equal(proof.applicationReady,true);assert.equal(proof.managedAccess,false);assert.deepEqual(proof.manifest,manifest.map(m=>m.name));
 assert.deepEqual(proof.sourceHashes,source.sources);assert.ok(proof.results.every(r=>r.sqlstate===null));
 const coverage=verifyProbeCoverage(source,proof.results);assert.deepEqual(proof.coverage,coverage);
 assert.deepEqual(reference.readiness,{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),coverage,queries:proof.results.length,errors:0});
 assert.deepEqual(Object.keys(reference.prefixes).sort(),['164',...productVersions]);
 for(const [version,snapshot] of Object.entries(reference.prefixes)){
  assert.equal(snapshot.catalogSha256,sha256(JSON.stringify(snapshot.catalog)));
  assert.deepEqual(snapshot.appliedVersions,manifest.filter(m=>Number(m.name.slice(0,3))<=Number(version)).map(m=>m.name.slice(0,3)));
  assert.deepEqual(snapshot.realtimePublication,reference.realtimePublication);
 }
 assert.deepEqual(reference.prefixes['171'].catalog,reference.catalog);assert.equal(reference.freshIncrementalDifferenceCount,0);
 assertProduct171Catalog(reference.catalog);return reference;
}
export async function readReference171(root,filename){
 return assertReference171(JSON.parse(await readFile(filename,'utf8')),await migrationManifest(root),
  await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_171.json'),'utf8'),await inventory(),
  await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_164.json'),'utf8'),
  await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_150.json'),'utf8'));
}
