import {inventoryBeforeNavigation206} from '../audit/source-before-navigation-cash206.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {migrationManifest,manifestDigest,canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql,realtime151Tables} from '../testing/realtime151-contract.mjs';
import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
import {assertReady204Catalog} from './frankfurt-reference204.mjs';
import {compareManagedCatalog} from './managed-catalog-policy.mjs';
export const ready205Ceiling=205,ready205ReferenceName='local-reference-through205-ready.json';
export function assertReady205Catalog(catalog){
 assertReady204Catalog(catalog);
 const old=catalog.functions.find(f=>f.identity.startsWith('get_supplier_receipts_page('));
 for(const name of ['get_receiving_purchase_context','get_supplier_receipt_display_context']){
  const matches=catalog.functions.filter(f=>f.identity.startsWith(name+'('));assert.equal(matches.length,1,'RECEIVING205_ONE_READER:'+name);const f=matches[0];
  assert.deepEqual(f.acl,old.acl,'RECEIVING205_SAME_RECEIPT_READER_ACL');assert.equal(f.owner,'postgres');assert.deepEqual(f.configuration,['search_path=public, pg_temp']);assert.match(f.definition,/STABLE/u);assert.match(f.definition,/SECURITY DEFINER/u);
 }
}
export function assertReady205Reference(reference,manifest,proofText,source){
  assert.equal(reference.format,16,'READY205_REFERENCE_REQUIRED');assert.equal(reference.migrationCeiling,205,'READY205_REFERENCE_REQUIRED');
  assert.equal(manifest.length,167);assert.equal(manifest.at(-1)?.name,'205_product_receiving_display_read_models.sql');
  assert.deepEqual(reference.manifest,manifest);assert.equal(reference.manifestDigest,manifestDigest(manifest));
  assert.deepEqual(reference.appliedVersions,manifest.map(m=>m.name.slice(0,3)));
  assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql));assert.equal(reference.catalogSha256,sha256(JSON.stringify(reference.catalog)));
  assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql));assert.equal(reference.realtimeSha256,sha256(JSON.stringify(reference.realtimePublication)));
  assert.deepEqual(reference.realtimePublication.tables.map(t=>t.schema+'.'+t.name).sort(),realtime151Tables.map(t=>'public.'+t).sort());
  assert.equal(reference.realtimePublication.publication.allTables,false);assert.equal(reference.realtimePublication.publication.owner,'postgres');
  assert.deepEqual(Object.keys(reference.prefixes),['199','200','201','202','203','204','205']);
  for(const version of ['199','200','201','202','203','204','205']){
    const p=reference.prefixes[version];assert.equal(p.catalogSha256,sha256(JSON.stringify(p.catalog)));
    assert.deepEqual(p.appliedVersions,manifest.filter(m=>Number(m.name.slice(0,3))<=Number(version)).map(m=>m.name.slice(0,3)));
    assert.deepEqual(p.realtimePublication,reference.realtimePublication);
  }
  assert.deepEqual(reference.prefixes['205'].catalog,reference.catalog);assert.equal(reference.freshIncrementalDifferenceCount,0);
  const proof=JSON.parse(proofText);assert.equal(proof.migrationCeiling,205);assert.equal(proof.managedAccess,false);
  assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.deepEqual(proof.sourceHashes,source.sources);
  assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results));assert.ok(proof.results.every(r=>r.sqlstate===null));
  assert.deepEqual(proof.manifest,manifest.map(m=>m.name));
  const compared=compareManagedCatalog(proof.catalog,reference.catalog,{beforeBuildDate:proof.startedAt.slice(0,10),afterBuildDate:reference.buildUtcDate});
  assert.deepEqual(compared.unexpected,[]);assert.deepEqual(compared.expected,[]);
  assert.deepEqual(reference.readiness,{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),coverage:proof.coverage,queries:proof.results.length,errors:0});
  assert.equal(reference.functions,519);assertReady205Catalog(reference.catalog);return reference;
}
export async function readReady205Reference(root,filename){
  return assertReady205Reference(JSON.parse(await readFile(filename,'utf8')),
    (await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=205),
    await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_205.json'),'utf8'),await inventoryBeforeNavigation206());
}
