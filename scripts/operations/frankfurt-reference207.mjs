import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {migrationManifest,manifestDigest,canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql,realtime151Tables} from '../testing/realtime151-contract.mjs';
// Freeze the delivered207 source through the exact additive C8 recovery inverse.
import {inventoryBeforeCorrectionRecoveryC8 as inventory} from '../audit/source-before-correction-recovery-c8.mjs';
import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
import {assertReady206Catalog} from './frankfurt-reference206.mjs';
import {compareManagedCatalog} from './managed-catalog-policy.mjs';
export const ready207Ceiling=207,ready207ReferenceName='local-reference-through207-ready.json';
export function assertReady207Catalog(catalog){
 assertReady206Catalog(catalog);
 const old=catalog.functions.find(f=>f.identity.startsWith('get_cash_shift_closing_report('));
 for(const name of ['get_document_correction_preview','execute_document_correction_once','correction207_assert_role_internal']){
  const matches=catalog.functions.filter(f=>f.identity.startsWith(name+'('));assert.equal(matches.length,1,'CORRECTION207_ONE_FUNCTION:'+name);const f=matches[0];
  assert.equal(f.owner,'postgres');assert.deepEqual(f.configuration,['search_path=public, pg_temp']);assert.match(f.definition,/SECURITY DEFINER/u);
  if(name==='correction207_assert_role_internal')assert.ok(f.acl.every(a=>a.startsWith('postgres=')),'CORRECTION207_PRIVATE_ROLE_HELPER');
  else assert.deepEqual(f.acl,old.acl,'CORRECTION207_AUTHENTICATED_RPC_ACL');
  if(name!=='execute_document_correction_once')assert.match(f.definition,/STABLE/u);
 }
 const index=catalog.indexes.filter(i=>i.schema==='public'&&i.name==='uq_document_correction207_key');assert.equal(index.length,1);assert.equal(index[0].unique,true);assert.equal(index[0].valid,true);assert.match(index[0].definition,/document_correction207/u);
}
export function assertReady207Reference(reference,manifest,proofText,source){
  assert.equal(reference.format,18,'READY207_REFERENCE_REQUIRED');assert.equal(reference.migrationCeiling,207,'READY207_REFERENCE_REQUIRED');
  assert.equal(manifest.length,169);assert.equal(manifest.at(-1)?.name,'207_document_correction_preview_and_once.sql');
  assert.deepEqual(reference.manifest,manifest);assert.equal(reference.manifestDigest,manifestDigest(manifest));
  assert.deepEqual(reference.appliedVersions,manifest.map(m=>m.name.slice(0,3)));
  assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql));assert.equal(reference.catalogSha256,sha256(JSON.stringify(reference.catalog)));
  assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql));assert.equal(reference.realtimeSha256,sha256(JSON.stringify(reference.realtimePublication)));
  assert.deepEqual(reference.realtimePublication.tables.map(t=>t.schema+'.'+t.name).sort(),realtime151Tables.map(t=>'public.'+t).sort());
  assert.equal(reference.realtimePublication.publication.allTables,false);assert.equal(reference.realtimePublication.publication.owner,'postgres');
  assert.deepEqual(Object.keys(reference.prefixes),['199','200','201','202','203','204','205','206','207']);
  for(const version of ['199','200','201','202','203','204','205','206','207']){
    const p=reference.prefixes[version];assert.equal(p.catalogSha256,sha256(JSON.stringify(p.catalog)));
    assert.deepEqual(p.appliedVersions,manifest.filter(m=>Number(m.name.slice(0,3))<=Number(version)).map(m=>m.name.slice(0,3)));
    assert.deepEqual(p.realtimePublication,reference.realtimePublication);
  }
  assert.deepEqual(reference.prefixes['207'].catalog,reference.catalog);assert.equal(reference.freshIncrementalDifferenceCount,0);
  const proof=JSON.parse(proofText);assert.equal(proof.migrationCeiling,207);assert.equal(proof.managedAccess,false);
  assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.deepEqual(proof.sourceHashes,source.sources);
  assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results));assert.ok(proof.results.every(r=>r.sqlstate===null));
  assert.deepEqual(proof.manifest,manifest.map(m=>m.name));
  const compared=compareManagedCatalog(proof.catalog,reference.catalog,{beforeBuildDate:proof.startedAt.slice(0,10),afterBuildDate:reference.buildUtcDate});
  assert.deepEqual(compared.unexpected,[]);assert.deepEqual(compared.expected,[]);
  assert.deepEqual(reference.readiness,{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),coverage:proof.coverage,queries:proof.results.length,errors:0});
  assert.equal(reference.functions,523);assertReady207Catalog(reference.catalog);return reference;
}
export async function readReady207Reference(root,filename){
  return assertReady207Reference(JSON.parse(await readFile(filename,'utf8')),
    (await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=207),
    await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_207.json'),'utf8'),await inventory());
}
