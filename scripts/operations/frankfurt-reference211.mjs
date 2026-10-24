import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import path from 'node:path';
import {migrationManifest,manifestDigest,canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql,catalogDifference} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql,realtime151Tables} from '../testing/realtime151-contract.mjs';
import {verifiedInventoryBeforeTrialR as inventory} from '../audit/source-before-trial-owner-r.mjs';import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
import {assertReady210Catalog,assert210Transition} from './frankfurt-reference210.mjs';
import {assert209PublicationTransition} from './frankfurt-reference209.mjs';
import {aclEntries,compareManagedCatalog} from './managed-catalog-policy.mjs';
export const ready211Ceiling=211,ready211ReferenceName='local-reference-through211-ready.json';
const publicNames=['execute_aftercare_supplier_v1','preview_aftercare_supplier_v1','get_aftercare_damage_candidates_v1'];
const privateNames=['sr211_source_internal','sr211_blocked_internal','sr211_links_manifest_internal','sr211_assert_operation_before211_internal','aftercare211_assert_replacement_root_internal'];
const changedPrivateNames=['sr208_assert_operation_internal','parcel209_replacement_issuer_internal','package_d_guard_physical_capacity_internal','phase43_assert_operational_replacement_evidence_internal','phase42_assert_operational_return_evidence_internal'];
export function assert211Transition(before,after){
 const differences=catalogDifference(before,after),functions=differences.filter(d=>d.section==='functions');
 assert.equal(functions.length,13,'AFTERCARE211_EXACT_FUNCTION_DELTA');
 for(const d of functions){const name=(d.after??d.before).identity.split('(')[0];
  if(changedPrivateNames.includes(name)){assert.ok(d.before&&d.after);assert.deepEqual({...d.after,definition:d.before.definition},d.before,'AFTERCARE211_ASSERT_ACL_OWNER_CONFIG');}
  else{assert.ok([...publicNames,...privateNames].includes(name),'AFTERCARE211_UNAPPROVED_FUNCTION');assert.equal(d.before,null);}
 }
 for(const d of differences.filter(d=>d.section!=='functions')){
  const row=d.after??d.before;assert.ok(['tables','constraints','indexes','triggers'].includes(d.section),'AFTERCARE211_UNAPPROVED_SECTION:'+d.section);
  assert.ok((row.name==='aftercare_supplier_links'||row.table==='aftercare_supplier_links')
    ||(d.section==='constraints'&&row.table==='supplier_replacement_cases'&&['supplier_replacement_cases_origin_check','supplier_replacement_cases_check1','supplier_replacement211_origin','supplier_replacement211_source'].includes(row.name)),
   'AFTERCARE211_UNAPPROVED_OBJECT:'+JSON.stringify(row));
 }
}
export function assertReady211Catalog(catalog){
 assertReady210Catalog(catalog);
 const tables=catalog.tables.filter(t=>t.schema==='public'&&t.name==='aftercare_supplier_links');assert.equal(tables.length,1);const t=tables[0];assert.equal(t.owner,'postgres');assert.equal(t.rls,true);
 assert.deepEqual(aclEntries(t.acl,t,'tables').filter(a=>a.grantee!=='postgres'),[],'AFTERCARE211_PRIVATE_TABLE');
 for(const suffix of ['_immutable','_no_truncate']){const triggers=catalog.triggers.filter(r=>r.schema==='public'&&r.table===t.name&&r.name===t.name+suffix);assert.equal(triggers.length,1);assert.equal(triggers[0].enabled,'O');assert.match(triggers[0].definition,/inventory_damage_reject_mutation_internal/);}
 for(const name of [...publicNames,...privateNames,...changedPrivateNames]){
  const rows=catalog.functions.filter(f=>f.schema==='public'&&f.identity.startsWith(name+'('));assert.equal(rows.length,1);const f=rows[0];assert.equal(f.owner,'postgres');assert.deepEqual(f.configuration,['search_path=public, pg_temp']);assert.match(f.definition,/SECURITY DEFINER/);
  assert.deepEqual(aclEntries(f.acl,f,'functions').filter(a=>a.grantee!=='postgres').map(a=>[a.grantee,a.privilege,a.grantable]),publicNames.includes(name)?[['authenticated','EXECUTE',false]]:[]);
  if(!['execute_aftercare_supplier_v1','parcel209_replacement_issuer_internal','package_d_guard_physical_capacity_internal'].includes(name))assert.match(f.definition,/STABLE/);
 }
 assert.ok(!catalog.publicationMembership?.tables?.some(r=>r.table===t.name));
}
export function assertReady211Reference(reference,manifest,proofText,source){
 assert.equal(reference.format,22);assert.equal(reference.migrationCeiling,211);assert.equal(manifest.length,173);assert.equal(manifest.at(-1).name,'211_aftercare_supplier_disposition.sql');
 assert.deepEqual(reference.manifest,manifest);assert.equal(reference.manifestDigest,manifestDigest(manifest));assert.deepEqual(reference.appliedVersions,manifest.map(m=>m.name.slice(0,3)));
 assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql));assert.equal(reference.catalogSha256,sha256(JSON.stringify(reference.catalog)));
 assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql));assert.equal(reference.realtimeSha256,sha256(JSON.stringify(reference.realtimePublication)));
 assert.deepEqual(reference.realtimePublication.tables.map(t=>t.schema+'.'+t.name).sort(),realtime151Tables.map(t=>'public.'+t).sort());assert.equal(reference.realtimePublication.publication.allTables,false);assert.equal(reference.realtimePublication.publication.owner,'postgres');
 assert.deepEqual(Object.keys(reference.prefixes),['208','209','210','211']);
 for(const version of ['208','209','210','211']){const p=reference.prefixes[version];assert.equal(p.catalogSha256,sha256(JSON.stringify(p.catalog)));assert.deepEqual(p.appliedVersions,manifest.filter(m=>Number(m.name.slice(0,3))<=Number(version)).map(m=>m.name.slice(0,3)));if(version==='208')assert209PublicationTransition(p.realtimePublication,reference.realtimePublication);else assert.deepEqual(p.realtimePublication,reference.realtimePublication);}
 assert210Transition(reference.prefixes['209'].catalog,reference.prefixes['210'].catalog);assert211Transition(reference.prefixes['210'].catalog,reference.catalog);assert.deepEqual(reference.prefixes['211'].catalog,reference.catalog);assert.equal(reference.freshIncrementalDifferenceCount,0);
 const proof=JSON.parse(proofText);assert.equal(proof.migrationCeiling,211);assert.equal(proof.managedAccess,false);assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.deepEqual(proof.sourceHashes,source.sources);assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results));assert.ok(proof.results.every(r=>r.sqlstate===null));assert.deepEqual(proof.manifest,manifest.map(m=>m.name));
 const compared=compareManagedCatalog(proof.catalog,reference.catalog,{beforeBuildDate:proof.startedAt.slice(0,10),afterBuildDate:reference.buildUtcDate});assert.deepEqual(compared.unexpected,[]);assert.deepEqual(compared.expected,[]);
 assert.deepEqual(reference.readiness,{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),coverage:proof.coverage,queries:proof.results.length,errors:0});assert.equal(reference.functions,554);assertReady211Catalog(reference.catalog);return reference;
}
export async function readReady211Reference(root,filename){return assertReady211Reference(JSON.parse(await readFile(filename,'utf8')),(await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=211),await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_211.json'),'utf8'),await inventory());}
