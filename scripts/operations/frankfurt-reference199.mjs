import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {migrationManifest,manifestDigest,canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql,realtime151Tables} from '../testing/realtime151-contract.mjs';
import {inventoryBeforeHomeDamage201 as inventory} from '../audit/source-before-home-damage201.mjs';
import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
import {assertReady198Catalog} from './frankfurt-reference198.mjs';
import {aclEntries,compareManagedCatalog} from './managed-catalog-policy.mjs';
export const ready199Ceiling=199,ready199ReferenceName='local-reference-through199-ready.json';
export function assertReady199Catalog(catalog){
  assertReady198Catalog(catalog);
  for(const name of ['get_owner_warehouses_v1','save_owner_warehouse_v1']){
    const functions=catalog.functions.filter(f=>f.schema==='public'&&f.identity.startsWith(name+'('));
    assert.equal(functions.length,1,'WAREHOUSE_RPC_EXACT_OVERLOAD:'+name);
    const f=functions[0];assert.equal(f.owner,'postgres');assert.match(f.definition,/SECURITY DEFINER/u);
    assert.deepEqual(f.configuration,['search_path=public, pg_temp']);
    assert.match(f.definition,/assert_erp_role\(ARRAY\['owner'\]/u);
    const acl=aclEntries(f.acl,f,'functions');
    assert.ok(!acl.some(a=>['anon','PUBLIC'].includes(a.grantee)),'WAREHOUSE_RPC_NOT_PUBLIC');
    assert.ok(acl.some(a=>a.grantee==='authenticated'&&a.privilege==='EXECUTE'),'WAREHOUSE_RPC_EXECUTE_REQUIRED');
  }
}
export function assertReady199Reference(reference,manifest,proofText,source){
  assert.equal(reference.format,10,'READY199_REFERENCE_REQUIRED');assert.equal(reference.migrationCeiling,199,'READY199_REFERENCE_REQUIRED');
  assert.equal(manifest.length,161);assert.equal(manifest.at(-1)?.name,'199_owner_warehouse_management.sql');
  assert.deepEqual(reference.manifest,manifest);assert.equal(reference.manifestDigest,manifestDigest(manifest));
  assert.deepEqual(reference.appliedVersions,manifest.map(m=>m.name.slice(0,3)));
  assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql));assert.equal(reference.catalogSha256,sha256(JSON.stringify(reference.catalog)));
  assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql));assert.equal(reference.realtimeSha256,sha256(JSON.stringify(reference.realtimePublication)));
  assert.deepEqual(reference.realtimePublication.tables.map(t=>t.schema+'.'+t.name).sort(),realtime151Tables.map(t=>'public.'+t).sort());
  assert.equal(reference.realtimePublication.publication.allTables,false);assert.equal(reference.realtimePublication.publication.owner,'postgres');
  assert.deepEqual(Object.keys(reference.prefixes),['198','199']);
  for(const version of ['198','199']){
    const p=reference.prefixes[version];assert.equal(p.catalogSha256,sha256(JSON.stringify(p.catalog)));
    assert.deepEqual(p.appliedVersions,manifest.filter(m=>Number(m.name.slice(0,3))<=Number(version)).map(m=>m.name.slice(0,3)));
    assert.deepEqual(p.realtimePublication,reference.realtimePublication);
  }
  assert.deepEqual(reference.prefixes['199'].catalog,reference.catalog);assert.equal(reference.freshIncrementalDifferenceCount,0);
  const proof=JSON.parse(proofText);assert.equal(proof.migrationCeiling,199);assert.equal(proof.managedAccess,false);
  assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.deepEqual(proof.sourceHashes,source.sources);
  assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results));assert.ok(proof.results.every(r=>r.sqlstate===null));
  assert.deepEqual(proof.manifest,manifest.map(m=>m.name));
  const compared=compareManagedCatalog(proof.catalog,reference.catalog,{beforeBuildDate:proof.startedAt.slice(0,10),afterBuildDate:reference.buildUtcDate});
  assert.deepEqual(compared.unexpected,[]);assert.deepEqual(compared.expected,[]);
  assert.deepEqual(reference.readiness,{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),coverage:proof.coverage,queries:proof.results.length,errors:0});
  assert.equal(reference.functions,513);assertReady199Catalog(reference.catalog);return reference;
}
export async function readReady199Reference(root,filename){
  return assertReady199Reference(JSON.parse(await readFile(filename,'utf8')),
    (await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=199),
    await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_199.json'),'utf8'),await inventory());
}
