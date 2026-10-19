import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {migrationManifest,manifestDigest,canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql,realtime151Tables} from '../testing/realtime151-contract.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';
import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
import {assertReady199Catalog} from './frankfurt-reference199.mjs';
import {aclEntries,compareManagedCatalog} from './managed-catalog-policy.mjs';
export const ready200Ceiling=200,ready200ReferenceName='local-reference-through200-ready.json';
export function assertReady200Catalog(catalog){
  assertReady199Catalog(catalog);
  for(const name of ['update_product_master','update_product_master_v2']){
    const functions=catalog.functions.filter(f=>f.schema==='public'&&f.identity.startsWith(name+'('));
    assert.equal(functions.length,1,'LEGACY_COST_EXACT_OVERLOAD:'+name);
    const f=functions[0];assert.equal(f.owner,'postgres');assert.match(f.definition,/SECURITY DEFINER/u);
    assert.deepEqual(f.configuration,['search_path=public, pg_temp']);
    const acl=aclEntries(f.acl,f,'functions');
    assert.ok(!acl.some(a=>['anon','authenticated','PUBLIC'].includes(a.grantee)&&a.privilege==='EXECUTE'),'LEGACY_COST_CLIENT_EXECUTE_FORBIDDEN');
  }
}
export function assertReady200Reference(reference,manifest,proofText,source){
  assert.equal(reference.format,11,'READY200_REFERENCE_REQUIRED');assert.equal(reference.migrationCeiling,200,'READY200_REFERENCE_REQUIRED');
  assert.equal(manifest.length,162);assert.equal(manifest.at(-1)?.name,'200_revoke_legacy_product_cost_writers.sql');
  assert.deepEqual(reference.manifest,manifest);assert.equal(reference.manifestDigest,manifestDigest(manifest));
  assert.deepEqual(reference.appliedVersions,manifest.map(m=>m.name.slice(0,3)));
  assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql));assert.equal(reference.catalogSha256,sha256(JSON.stringify(reference.catalog)));
  assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql));assert.equal(reference.realtimeSha256,sha256(JSON.stringify(reference.realtimePublication)));
  assert.deepEqual(reference.realtimePublication.tables.map(t=>t.schema+'.'+t.name).sort(),realtime151Tables.map(t=>'public.'+t).sort());
  assert.equal(reference.realtimePublication.publication.allTables,false);assert.equal(reference.realtimePublication.publication.owner,'postgres');
  assert.deepEqual(Object.keys(reference.prefixes),['199','200']);
  for(const version of ['199','200']){
    const p=reference.prefixes[version];assert.equal(p.catalogSha256,sha256(JSON.stringify(p.catalog)));
    assert.deepEqual(p.appliedVersions,manifest.filter(m=>Number(m.name.slice(0,3))<=Number(version)).map(m=>m.name.slice(0,3)));
    assert.deepEqual(p.realtimePublication,reference.realtimePublication);
  }
  assert.deepEqual(reference.prefixes['200'].catalog,reference.catalog);assert.equal(reference.freshIncrementalDifferenceCount,0);
  const proof=JSON.parse(proofText);assert.equal(proof.migrationCeiling,200);assert.equal(proof.managedAccess,false);
  assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.deepEqual(proof.sourceHashes,source.sources);
  assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results));assert.ok(proof.results.every(r=>r.sqlstate===null));
  assert.deepEqual(proof.manifest,manifest.map(m=>m.name));
  const compared=compareManagedCatalog(proof.catalog,reference.catalog,{beforeBuildDate:proof.startedAt.slice(0,10),afterBuildDate:reference.buildUtcDate});
  assert.deepEqual(compared.unexpected,[]);assert.deepEqual(compared.expected,[]);
  assert.deepEqual(reference.readiness,{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),coverage:proof.coverage,queries:proof.results.length,errors:0});
  assert.equal(reference.functions,513);assertReady200Catalog(reference.catalog);return reference;
}
export async function readReady200Reference(root,filename){
  return assertReady200Reference(JSON.parse(await readFile(filename,'utf8')),
    (await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=200),
    await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_200.json'),'utf8'),await inventory());
}
