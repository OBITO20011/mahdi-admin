import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {migrationManifest,manifestDigest,canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql,realtime151Tables} from '../testing/realtime151-contract.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';
import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
import {assertReady207Catalog} from './frankfurt-reference207.mjs';
import {aclEntries} from './managed-catalog-policy.mjs';
import {compareManagedCatalog} from './managed-catalog-policy.mjs';
export const ready208Ceiling=208,ready208ReferenceName='local-reference-through208-ready.json';
export function assertReady208Catalog(catalog){
 assertReady207Catalog(catalog);
 const tables=['supplier_replacement_cases','supplier_replacement_events','supplier_replacement_inventory_effects'];
 for(const name of tables){
  const rows=catalog.tables.filter(t=>t.schema==='public'&&t.name===name);assert.equal(rows.length,1,'REPLACEMENT208_TABLE:'+name);
  const t=rows[0];assert.equal(t.owner,'postgres');assert.equal(t.rls,true);
  assert.ok(!aclEntries(t.acl,t,'tables').some(a=>['PUBLIC','anon','authenticated','service_role'].includes(a.grantee)),'REPLACEMENT208_PRIVATE_TABLE:'+name);
  for(const suffix of ['_immutable','_no_truncate']){
   const trigger=catalog.triggers.filter(x=>x.schema==='public'&&x.table===name&&x.name===name+suffix);assert.equal(trigger.length,1);assert.equal(trigger[0].enabled,'O');assert.match(trigger[0].definition,/inventory_damage_reject_mutation_internal/u);
  }
 }
 const publicFunctions=['execute_supplier_replacement_v1','preview_supplier_replacement_v1','get_supplier_replacements_page_v1','get_supplier_replacement_options_v1'];
 const privateFunctions=['sr208_assert_role_internal','sr208_operation_manifest_internal','sr208_assert_operation_internal','sr208_inventory_fingerprint_internal','sr208_case_dto_internal','sr208_append_event_internal','phase6_financial_facts_before208_internal','phase6_financial_facts_internal'];
 for(const name of [...publicFunctions,...privateFunctions]){
  const rows=catalog.functions.filter(f=>f.schema==='public'&&f.identity.startsWith(name+'('));assert.equal(rows.length,1,'REPLACEMENT208_ONE_FUNCTION:'+name);const f=rows[0];
  assert.equal(f.owner,'postgres');assert.deepEqual(f.configuration,['search_path=public, pg_temp']);assert.match(f.definition,/SECURITY DEFINER/u);
  const grants=aclEntries(f.acl,f,'functions').filter(a=>a.grantee!=='postgres');
  assert.deepEqual(grants.map(a=>[a.grantee,a.privilege,a.grantable]),publicFunctions.includes(name)?[['authenticated','EXECUTE',false]]:[],'REPLACEMENT208_FUNCTION_ACL:'+name);
 }
 for(const name of ['supplier_replacement208_key','supplier_replacement208_first_event']){
  const rows=catalog.indexes.filter(i=>i.schema==='public'&&i.name===name);assert.equal(rows.length,1);assert.equal(rows[0].unique,true);assert.equal(rows[0].valid,true);
 }
 const publicationTables=catalog.publicationMembership?.tables??[];assert.ok(!publicationTables.some(t=>tables.includes(t.table)));
}
export function assertReady208Reference(reference,manifest,proofText,source){
  assert.equal(reference.format,19,'READY208_REFERENCE_REQUIRED');assert.equal(reference.migrationCeiling,208,'READY208_REFERENCE_REQUIRED');
  assert.equal(manifest.length,170);assert.equal(manifest.at(-1)?.name,'208_supplier_replacement_and_damage.sql');
  assert.deepEqual(reference.manifest,manifest);assert.equal(reference.manifestDigest,manifestDigest(manifest));
  assert.deepEqual(reference.appliedVersions,manifest.map(m=>m.name.slice(0,3)));
  assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql));assert.equal(reference.catalogSha256,sha256(JSON.stringify(reference.catalog)));
  assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql));assert.equal(reference.realtimeSha256,sha256(JSON.stringify(reference.realtimePublication)));
  assert.deepEqual(reference.realtimePublication.tables.map(t=>t.schema+'.'+t.name).sort(),realtime151Tables.map(t=>'public.'+t).sort());
  assert.equal(reference.realtimePublication.publication.allTables,false);assert.equal(reference.realtimePublication.publication.owner,'postgres');
  assert.deepEqual(Object.keys(reference.prefixes),['199','200','201','202','203','204','205','206','207','208']);
  for(const version of ['199','200','201','202','203','204','205','206','207','208']){
    const p=reference.prefixes[version];assert.equal(p.catalogSha256,sha256(JSON.stringify(p.catalog)));
    assert.deepEqual(p.appliedVersions,manifest.filter(m=>Number(m.name.slice(0,3))<=Number(version)).map(m=>m.name.slice(0,3)));
    assert.deepEqual(p.realtimePublication,reference.realtimePublication);
  }
  assert.deepEqual(reference.prefixes['208'].catalog,reference.catalog);assert.equal(reference.freshIncrementalDifferenceCount,0);
  const proof=JSON.parse(proofText);assert.equal(proof.migrationCeiling,208);assert.equal(proof.managedAccess,false);
  assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.deepEqual(proof.sourceHashes,source.sources);
  assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results));assert.ok(proof.results.every(r=>r.sqlstate===null));
  assert.deepEqual(proof.manifest,manifest.map(m=>m.name));
  const compared=compareManagedCatalog(proof.catalog,reference.catalog,{beforeBuildDate:proof.startedAt.slice(0,10),afterBuildDate:reference.buildUtcDate});
  assert.deepEqual(compared.unexpected,[]);assert.deepEqual(compared.expected,[]);
  assert.deepEqual(reference.readiness,{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),coverage:proof.coverage,queries:proof.results.length,errors:0});
  assert.equal(reference.functions,534);assertReady208Catalog(reference.catalog);return reference;
}
export async function readReady208Reference(root,filename){
  return assertReady208Reference(JSON.parse(await readFile(filename,'utf8')),
    (await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=208),
    await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_208.json'),'utf8'),await inventory());
}
