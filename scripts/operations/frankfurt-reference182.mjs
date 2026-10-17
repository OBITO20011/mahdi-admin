import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {migrationManifest,manifestDigest,sha256,canonicalLf} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql} from '../testing/realtime151-contract.mjs';
import {assertReference171,assertProduct171Catalog} from './frankfurt-reference171.mjs';
import {aclEntries} from './managed-catalog-policy.mjs';
import {inventoryBefore198Presentation as inventory} from '../audit/source-before198-presentation.mjs';
import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
export const readyReference182Name='local-reference-001-139-150-151-160-164-170-171-180-182-ready.json';
export const withdrawalVersions=Object.freeze(['180','181','182']);
export function assertWithdrawals182Catalog(catalog){
 assertProduct171Catalog(catalog);
 const closed=(row,section)=>assert.ok(!aclEntries(row.acl,row,section).some(a=>['PUBLIC','anon','authenticated'].includes(a.grantee)),'WITHDRAWALS_RPC_ONLY');
 for(const name of ['owner_cash_withdrawals','owner_cash_withdrawal_reversals']){
  const table=catalog.tables.find(t=>t.schema==='public'&&t.name===name);assert.ok(table,'WITHDRAWAL_TABLE_REQUIRED:'+name);
  assert.equal(table.owner,'postgres');assert.equal(table.rls,true);closed(table,'tables');
  for(const column of table.columns)closed({...table,acl:column.acl??[]},'columns');
 }
 const sequence=catalog.tables.find(t=>t.schema==='public'&&t.name==='owner_cash_withdrawal_number_seq');
 assert.ok(sequence,'WITHDRAWAL_SEQUENCE_REQUIRED');assert.equal(sequence.kind,'S');assert.equal(sequence.owner,'postgres');closed(sequence,'tables');
 const routines=catalog.functions.filter(f=>f.schema==='public'&&f.identity.includes('owner')&&f.identity.includes('withdrawal'));
 assert.ok(routines.length>=10,'WITHDRAWAL_ROUTINES_REQUIRED');
 const publicNames=new Set(['create_owner_cash_withdrawal_v1','reverse_owner_cash_withdrawal_v1','get_owner_withdrawals_report','get_shift_owner_withdrawals_v1']);
 for(const routine of routines){
  assert.equal(routine.owner,'postgres');assert.ok(routine.definition.includes('SECURITY DEFINER'));
  assert.deepEqual(routine.configuration,['search_path=public, pg_temp']);
  const grants=aclEntries(routine.acl,routine,'functions');
  assert.ok(!grants.some(a=>['PUBLIC','anon'].includes(a.grantee)));
  assert.equal(grants.some(a=>a.grantee==='authenticated'&&a.privilege==='EXECUTE'),publicNames.has(routine.identity.split('(')[0]));
 }
}
export function assertReference182(reference,manifest,proofText,source,proof171,proof164,proof150){
 assert.equal(reference.format,7,'READY182_REFERENCE_REQUIRED');assert.equal(reference.migrationCeiling,182,'READY182_REFERENCE_REQUIRED');
 assert.equal(manifest.length,151);assert.equal(manifest.at(-1)?.name,'182_owner_withdrawal_monitoring.sql');
 assert.deepEqual(reference.manifest,manifest);assert.equal(reference.manifestDigest,manifestDigest(manifest));
 assert.deepEqual(reference.appliedVersions,manifest.map(m=>m.name.slice(0,3)));
 assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql));assert.equal(reference.catalogSha256,sha256(JSON.stringify(reference.catalog)));
 assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql));assert.equal(reference.realtimeSha256,sha256(JSON.stringify(reference.realtimePublication)));
 assertReference171(reference.base171,manifest.filter(m=>Number(m.name.slice(0,3))<=171),proof171,source,proof164,proof150);
 assert.deepEqual(reference.realtimePublication,reference.base171.realtimePublication);
 const proof=JSON.parse(proofText);assert.equal(proof.migrationCeiling,182);assert.equal(proof.infrastructureOk,true);
 assert.equal(proof.applicationReady,true);assert.equal(proof.managedAccess,false);assert.deepEqual(proof.manifest,manifest.map(m=>m.name));
 assert.deepEqual(proof.sourceHashes,source.sources);assert.ok(proof.results.every(r=>r.sqlstate===null));
 const coverage=verifyProbeCoverage(source,proof.results);assert.deepEqual(proof.coverage,coverage);
 assert.deepEqual(reference.readiness,{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),coverage,queries:proof.results.length,errors:0});
 assert.deepEqual(Object.keys(reference.prefixes).sort(),['171',...withdrawalVersions]);
 for(const [version,snapshot] of Object.entries(reference.prefixes)){
  assert.equal(snapshot.catalogSha256,sha256(JSON.stringify(snapshot.catalog)));
  assert.deepEqual(snapshot.appliedVersions,manifest.filter(m=>Number(m.name.slice(0,3))<=Number(version)).map(m=>m.name.slice(0,3)));
  assert.deepEqual(snapshot.realtimePublication,reference.realtimePublication);
 }
 assert.deepEqual(reference.prefixes['182'].catalog,reference.catalog);assert.equal(reference.freshIncrementalDifferenceCount,0);
 assertWithdrawals182Catalog(reference.catalog);return reference;
}
export async function readReference182(root,filename){
 return assertReference182(JSON.parse(await readFile(filename,'utf8')),(await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=182),
  await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_182.json'),'utf8'),await inventory(),
  await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_171.json'),'utf8'),
  await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_164.json'),'utf8'),
  await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_150.json'),'utf8'));
}
