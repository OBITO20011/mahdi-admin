import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {migrationManifest,manifestDigest,canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql,realtime151Tables} from '../testing/realtime151-contract.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';
import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
import {assertReady200Catalog} from './frankfurt-reference200.mjs';
import {aclEntries,compareManagedCatalog} from './managed-catalog-policy.mjs';
export const ready203Ceiling=203,ready203ReferenceName='local-reference-through203-ready.json';
export function assertReady203Catalog(catalog){
  assertReady200Catalog(catalog);
  const table=catalog.tables.find(t=>t.schema==='public'&&t.name==='inventory_damage_events');
  assert.ok(table,'DAMAGE_TABLE_REQUIRED');assert.equal(table.owner,'postgres');assert.equal(table.rls,true);
  const tableAcl=aclEntries(table.acl,table,'tables');
  assert.ok(!tableAcl.some(a=>['anon','authenticated','PUBLIC'].includes(a.grantee)),'DAMAGE_DIRECT_CLIENT_PRIVILEGE');
  for(const name of ['inventory_damage_period_totals_internal','capture_final_return_damage_internal','inventory_damage_reject_mutation_internal']){
    const functions=catalog.functions.filter(f=>f.schema==='public'&&f.identity.startsWith(name+'('));
    assert.equal(functions.length,1,'DAMAGE_PRIVATE_EXACT_OVERLOAD:'+name);const f=functions[0];
    assert.equal(f.owner,'postgres');assert.match(f.definition,/SECURITY DEFINER/u);assert.deepEqual(f.configuration,['search_path=public, pg_temp']);
    assert.ok(!aclEntries(f.acl,f,'functions').some(a=>['anon','authenticated','PUBLIC','service_role'].includes(a.grantee)&&a.privilege==='EXECUTE'),'DAMAGE_PRIVATE_EXECUTE');
  }
  for(const name of ['inventory_damage_events_immutable','inventory_damage_events_no_truncate','capture_final_return_damage'])
    {const triggers=catalog.triggers.filter(t=>t.name===name);assert.equal(triggers.length,1,'DAMAGE_TRIGGER_REQUIRED:'+name);assert.equal(triggers[0].enabled,'O','DAMAGE_TRIGGER_ENABLED:'+name);}
}
export function assertReady203Reference(reference,manifest,proofText,source){
  assert.equal(reference.format,14,'READY203_REFERENCE_REQUIRED');assert.equal(reference.migrationCeiling,203,'READY203_REFERENCE_REQUIRED');
  assert.equal(manifest.length,165);assert.equal(manifest.at(-1)?.name,'203_customer_payment_receipts_without_completion.sql');
  assert.deepEqual(reference.manifest,manifest);assert.equal(reference.manifestDigest,manifestDigest(manifest));
  assert.deepEqual(reference.appliedVersions,manifest.map(m=>m.name.slice(0,3)));
  assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql));assert.equal(reference.catalogSha256,sha256(JSON.stringify(reference.catalog)));
  assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql));assert.equal(reference.realtimeSha256,sha256(JSON.stringify(reference.realtimePublication)));
  assert.deepEqual(reference.realtimePublication.tables.map(t=>t.schema+'.'+t.name).sort(),realtime151Tables.map(t=>'public.'+t).sort());
  assert.equal(reference.realtimePublication.publication.allTables,false);assert.equal(reference.realtimePublication.publication.owner,'postgres');
  assert.deepEqual(Object.keys(reference.prefixes),['199','200','201','202','203']);
  for(const version of ['199','200','201','202','203']){
    const p=reference.prefixes[version];assert.equal(p.catalogSha256,sha256(JSON.stringify(p.catalog)));
    assert.deepEqual(p.appliedVersions,manifest.filter(m=>Number(m.name.slice(0,3))<=Number(version)).map(m=>m.name.slice(0,3)));
    assert.deepEqual(p.realtimePublication,reference.realtimePublication);
  }
  assert.deepEqual(reference.prefixes['203'].catalog,reference.catalog);assert.equal(reference.freshIncrementalDifferenceCount,0);
  const proof=JSON.parse(proofText);assert.equal(proof.migrationCeiling,203);assert.equal(proof.managedAccess,false);
  assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.deepEqual(proof.sourceHashes,source.sources);
  assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results));assert.ok(proof.results.every(r=>r.sqlstate===null));
  assert.deepEqual(proof.manifest,manifest.map(m=>m.name));
  const compared=compareManagedCatalog(proof.catalog,reference.catalog,{beforeBuildDate:proof.startedAt.slice(0,10),afterBuildDate:reference.buildUtcDate});
  assert.deepEqual(compared.unexpected,[]);assert.deepEqual(compared.expected,[]);
  assert.deepEqual(reference.readiness,{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),coverage:proof.coverage,queries:proof.results.length,errors:0});
  assert.equal(reference.functions,516);assertReady203Catalog(reference.catalog);return reference;
}
export async function readReady203Reference(root,filename){
  return assertReady203Reference(JSON.parse(await readFile(filename,'utf8')),
    (await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=203),
    await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_203.json'),'utf8'),await inventory());
}
