import {sourceBeforeAftercare215} from '../audit/source-before-aftercare215.mjs';
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import path from 'node:path';
import {migrationManifest,manifestDigest,canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql,catalogDifference} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql,realtime151Tables} from '../testing/realtime151-contract.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
import {assert210Transition} from './frankfurt-reference210.mjs';
import {assert209PublicationTransition} from './frankfurt-reference209.mjs';
import {aclEntries,compareManagedCatalog} from './managed-catalog-policy.mjs';
import {assertReady211Catalog,assert211Transition} from './frankfurt-reference211.mjs';
export const ready212Ceiling=212,ready212ReferenceName='local-reference-through212-ready.json';
const changed=['get_cash_shift_movement_page','get_supplier_replacement_options_v1'],added=['trial212_cash_metadata_internal','get_damage_history_page_v1'];
export function assert212Transition(before,after){
 const changes=catalogDifference(before,after);assert.equal(changes.length,4,'TRIAL212_EXACT_FOUR_READERS');
 for(const change of changes){assert.equal(change.section,'functions');const name=change.after.identity.split('(')[0];assert.ok([...changed,...added].includes(name));if(changed.includes(name)){assert.ok(change.before);assert.deepEqual({...change.after,definition:change.before.definition},change.before,'TRIAL212_EXISTING_ACL_OWNER_CONFIG');}else assert.equal(change.before,null);}
 assertReady212Catalog(after);
}
export function assertReady212Catalog(catalog){
 assertReady211Catalog(catalog);
 for(const name of [...changed,...added]){const matches=catalog.functions.filter(f=>f.schema==='public'&&f.identity.startsWith(name+'('));assert.equal(matches.length,1);const f=matches[0];assert.equal(f.owner,'postgres');assert.deepEqual(f.configuration,['search_path=public, pg_temp']);assert.match(f.definition,/STABLE/);assert.match(f.definition,/SECURITY DEFINER/);assert.doesNotMatch(f.definition,/\b(?:INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM|FOR\s+UPDATE)\b/iu);assert.deepEqual(aclEntries(f.acl,f,'functions').filter(a=>a.grantee!=='postgres').map(a=>[a.grantee,a.privilege,a.grantable]),name==='trial212_cash_metadata_internal'?[]:[['authenticated','EXECUTE',false]]);}
}
export function assertReady212Reference(reference,manifest,proofText,source){
 assert.equal(reference.format,23);assert.equal(reference.migrationCeiling,212);assert.equal(manifest.length,174);assert.equal(manifest.at(-1).name,'212_trial_readable_cash_product_choices_damage_history.sql');
 assert.deepEqual(reference.manifest,manifest);assert.equal(reference.manifestDigest,manifestDigest(manifest));assert.deepEqual(reference.appliedVersions,manifest.map(m=>m.name.slice(0,3)));
 assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql));assert.equal(reference.catalogSha256,sha256(JSON.stringify(reference.catalog)));
 assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql));assert.equal(reference.realtimeSha256,sha256(JSON.stringify(reference.realtimePublication)));
 assert.deepEqual(reference.realtimePublication.tables.map(t=>t.schema+'.'+t.name).sort(),realtime151Tables.map(t=>'public.'+t).sort());assert.equal(reference.realtimePublication.publication.allTables,false);assert.equal(reference.realtimePublication.publication.owner,'postgres');
 assert.deepEqual(Object.keys(reference.prefixes),['208','209','210','211','212']);
 for(const version of ['208','209','210','211','212']){const p=reference.prefixes[version];assert.equal(p.catalogSha256,sha256(JSON.stringify(p.catalog)));assert.deepEqual(p.appliedVersions,manifest.filter(m=>Number(m.name.slice(0,3))<=Number(version)).map(m=>m.name.slice(0,3)));if(version==='208')assert209PublicationTransition(p.realtimePublication,reference.realtimePublication);else assert.deepEqual(p.realtimePublication,reference.realtimePublication);}
 assert210Transition(reference.prefixes['209'].catalog,reference.prefixes['210'].catalog);assert211Transition(reference.prefixes['210'].catalog,reference.prefixes['211'].catalog);assert212Transition(reference.prefixes['211'].catalog,reference.catalog);assert.deepEqual(reference.prefixes['212'].catalog,reference.catalog);assert.equal(reference.freshIncrementalDifferenceCount,0);
 const proof=JSON.parse(proofText);assert.equal(proof.migrationCeiling,212);assert.equal(proof.managedAccess,false);assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.deepEqual(proof.sourceHashes,source.sources);assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results));assert.ok(proof.results.every(r=>r.sqlstate===null));assert.deepEqual(proof.manifest,manifest.map(m=>m.name));
 const compared=compareManagedCatalog(proof.catalog,reference.catalog,{beforeBuildDate:proof.startedAt.slice(0,10),afterBuildDate:reference.buildUtcDate});assert.deepEqual(compared.unexpected,[]);assert.deepEqual(compared.expected,[]);
 assert.deepEqual(reference.readiness,{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),coverage:proof.coverage,queries:proof.results.length,errors:0});assert.equal(reference.functions,556);assertReady212Catalog(reference.catalog);return reference;
}
export async function readReady212Reference(root,filename){return assertReady212Reference(JSON.parse(await readFile(filename,'utf8')),(await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=212),await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_212.json'),'utf8'),await inventory({projectSource:sourceBeforeAftercare215}));}
