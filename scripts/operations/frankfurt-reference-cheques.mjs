import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {migrationManifest,manifestDigest,sha256,canonicalLf} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql} from '../testing/realtime151-contract.mjs';
import {assertWithdrawals182Catalog} from './frankfurt-reference182.mjs';
import {aclEntries} from './managed-catalog-policy.mjs';
import {inventoryBefore198Presentation as inventory} from '../audit/source-before198-presentation.mjs';
import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
export const chequeCeiling=195;
export const chequeReferenceName='local-reference-through195-ready.json';
export const chequeTables=Object.freeze(['deferred_cheques','cheque_party_keys','deferred_cheque_events','deferred_cheque_allocations',
 'cheque_compensation_claims','customer_collection_cheque_allocations','supplier_cheque_claim_payments','supplier_cheque_claim_reversals']);
export function assertChequesCatalog(catalog){
 assertWithdrawals182Catalog(catalog);
 for(const name of [...chequeTables,'deferred_cheque_number_seq']){
  const row=catalog.tables.find(t=>t.schema==='public'&&t.name===name);assert.ok(row,'CHEQUE_EVIDENCE_REQUIRED:'+name);
  assert.equal(row.owner,'postgres');if(row.kind!=='S')assert.equal(row.rls,true);
  assert.ok(!aclEntries(row.acl,row,'tables').some(a=>['PUBLIC','anon','authenticated'].includes(a.grantee)),'CHEQUE_RPC_ONLY:'+name);
  for(const column of row.columns)assert.ok(!aclEntries(column.acl??[],row,'columns').some(a=>['PUBLIC','anon','authenticated'].includes(a.grantee)),'CHEQUE_COLUMN_GRANT');
 }
 const names=['receive_customer_cheque_v1','issue_supplier_cheque_v1','endorse_customer_cheque_v1','clear_deferred_cheque_v1',
  'return_deferred_cheque_v1','cancel_deferred_cheque_v1','pay_supplier_cheque_claim_v1','reverse_supplier_cheque_claim_payment_v1','get_deferred_cheques_page','get_deferred_cheque_detail',
  'preview_customer_cheque_v1','preview_supplier_cheque_v1','get_deferred_cheque_home_alerts'];
 for(const name of names){const rows=catalog.functions.filter(f=>f.schema==='public'&&f.identity.split('(')[0]===name);assert.equal(rows.length,1,name);
  const row=rows[0];assert.equal(row.owner,'postgres');assert.deepEqual(row.configuration,['search_path=public, pg_temp']);assert.match(row.definition,/SECURITY DEFINER/u);
  const grants=aclEntries(row.acl,row,'functions');assert.ok(grants.some(a=>a.grantee==='authenticated'&&a.privilege==='EXECUTE'));
  assert.ok(!grants.some(a=>['PUBLIC','anon'].includes(a.grantee)));
 }
 for(const row of catalog.functions.filter(f=>f.schema==='public'&&f.identity.split('(')[0].includes('cheque')&&f.identity.split('(')[0].endsWith('_internal'))){
  assert.equal(row.owner,'postgres');assert.deepEqual(row.configuration,['search_path=public, pg_temp']);assert.match(row.definition,/SECURITY DEFINER/u);
  assert.ok(!aclEntries(row.acl,row,'functions').some(a=>['PUBLIC','anon','authenticated'].includes(a.grantee)),'CHEQUE_HELPER_PRIVATE:'+row.identity);
 }
}
export function assertChequesReference(reference,manifest,proofText,source){
 assert.equal(reference.format,8,'READY_CHEQUES_REFERENCE_REQUIRED');assert.equal(reference.migrationCeiling,chequeCeiling,'READY_CHEQUES_REFERENCE_REQUIRED');
 assert.equal(manifest.at(-1).name,'195_deferred_cheque_readers_and_alerts.sql');assert.equal(manifest.length,157);
 assert.deepEqual(reference.manifest,manifest);assert.equal(reference.manifestDigest,manifestDigest(manifest));
 assert.deepEqual(reference.appliedVersions,manifest.map(m=>m.name.slice(0,3)));
 assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql));assert.equal(reference.catalogSha256,sha256(JSON.stringify(reference.catalog)));
 assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql));assert.equal(reference.realtimeSha256,sha256(JSON.stringify(reference.realtimePublication)));
 const proof=JSON.parse(proofText);assert.equal(proof.migrationCeiling,chequeCeiling);assert.equal(proof.managedAccess,false);
 assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.deepEqual(proof.sourceHashes,source.sources);
 assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results));assert.ok(proof.results.every(r=>r.sqlstate===null));
 assert.deepEqual(proof.manifest,manifest.map(m=>m.name));
 assert.deepEqual(reference.readiness,{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),coverage:proof.coverage,queries:proof.results.length,errors:0});
 const versions=manifest.filter(m=>Number(m.name.slice(0,3))>=138).map(m=>m.name.slice(0,3));
 assert.deepEqual(Object.keys(reference.prefixes),versions);
 for(const version of versions){const snapshot=reference.prefixes[version];assert.equal(snapshot.catalogSha256,sha256(JSON.stringify(snapshot.catalog)));
  assert.deepEqual(snapshot.appliedVersions,manifest.filter(m=>Number(m.name.slice(0,3))<=Number(version)).map(m=>m.name.slice(0,3)));
  if(Number(version)>=151)assert.deepEqual(snapshot.realtimePublication,reference.realtimePublication);
 }
 assert.deepEqual(reference.prefixes[String(chequeCeiling)].catalog,reference.catalog);assert.equal(reference.freshIncrementalDifferenceCount,0);
 assert.equal(reference.functions,505);assertChequesCatalog(reference.catalog);return reference;
}
export async function readChequesReference(root,filename){
 return assertChequesReference(JSON.parse(await readFile(filename,'utf8')),(await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=chequeCeiling),
  await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_195.json'),'utf8'),await inventory());
}
