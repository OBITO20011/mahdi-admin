import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import path from 'node:path';
import {migrationManifest,manifestDigest,canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql,catalogDifference} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql,realtime151Tables} from '../testing/realtime151-contract.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
import {assertReady209Catalog,assert209PublicationTransition} from './frankfurt-reference209.mjs';
import {aclEntries,compareManagedCatalog} from './managed-catalog-policy.mjs';
export const ready210Ceiling=210,ready210ReferenceName='local-reference-through210-ready.json';
export function assert210Transition(before,after){
 const differences=catalogDifference(before,after);assert.equal(differences.length,1,'RECEIPT210_ONLY_ONE_FUNCTION_DEFINITION_DELTA');
 const d=differences[0];assert.equal(d.section,'functions');assert.match(d.before.identity,/^get_public_pos_receipt\(/u);
 assert.deepEqual({...d.after,definition:d.before.definition},d.before,'RECEIPT210_ACL_OWNER_CONFIG_UNCHANGED');
}
export function assertReady210Catalog(catalog){
 assertReady209Catalog(catalog);const rows=catalog.functions.filter(f=>f.schema==='public'&&f.identity.startsWith('get_public_pos_receipt('));assert.equal(rows.length,1);const f=rows[0];
 assert.equal(f.owner,'postgres');assert.deepEqual(f.configuration,['search_path=public, pg_temp']);assert.match(f.definition,/STABLE/);assert.match(f.definition,/SECURITY DEFINER/);
 assert.deepEqual(aclEntries(f.acl,f,'functions').filter(a=>a.grantee!=='postgres').map(a=>[a.grantee,a.privilege,a.grantable]),[['anon','EXECUTE',false],['authenticated','EXECUTE',false]]);
 for(const field of ['commercialLineKind','baseQuantity','baseUnitName','parcelInstances','components'])assert.ok(f.definition.includes("'"+field+"'"));
 assert.doesNotMatch(f.definition,/\b(INSERT|UPDATE|DELETE|MERGE|PERFORM|EXECUTE)\b/u);assert.doesNotMatch(f.definition,/'(?:customer|cost|cogs|profit|wac|purchase|id|productId|operationId)[^']*'/iu);
}
export function assertReady210Reference(reference,manifest,proofText,source){
 assert.equal(reference.format,21);assert.equal(reference.migrationCeiling,210);assert.equal(manifest.length,172);assert.equal(manifest.at(-1).name,'210_public_pos_receipt_commercial_lines.sql');
 assert.deepEqual(reference.manifest,manifest);assert.equal(reference.manifestDigest,manifestDigest(manifest));assert.deepEqual(reference.appliedVersions,manifest.map(m=>m.name.slice(0,3)));
 assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql));assert.equal(reference.catalogSha256,sha256(JSON.stringify(reference.catalog)));
 assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql));assert.equal(reference.realtimeSha256,sha256(JSON.stringify(reference.realtimePublication)));
 assert.deepEqual(reference.realtimePublication.tables.map(t=>t.schema+'.'+t.name).sort(),realtime151Tables.map(t=>'public.'+t).sort());assert.equal(reference.realtimePublication.publication.allTables,false);assert.equal(reference.realtimePublication.publication.owner,'postgres');
 assert.deepEqual(Object.keys(reference.prefixes),['208','209','210']);
 for(const version of ['208','209','210']){const p=reference.prefixes[version];assert.equal(p.catalogSha256,sha256(JSON.stringify(p.catalog)));assert.deepEqual(p.appliedVersions,manifest.filter(m=>Number(m.name.slice(0,3))<=Number(version)).map(m=>m.name.slice(0,3)));if(version==='208')assert209PublicationTransition(p.realtimePublication,reference.realtimePublication);else assert.deepEqual(p.realtimePublication,reference.realtimePublication);}
 assert210Transition(reference.prefixes['209'].catalog,reference.catalog);assert.deepEqual(reference.prefixes['210'].catalog,reference.catalog);assert.equal(reference.freshIncrementalDifferenceCount,0);
 const proof=JSON.parse(proofText);assert.equal(proof.migrationCeiling,210);assert.equal(proof.managedAccess,false);assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.deepEqual(proof.sourceHashes,source.sources);assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results));assert.ok(proof.results.every(r=>r.sqlstate===null));assert.deepEqual(proof.manifest,manifest.map(m=>m.name));
 const compared=compareManagedCatalog(proof.catalog,reference.catalog,{beforeBuildDate:proof.startedAt.slice(0,10),afterBuildDate:reference.buildUtcDate});assert.deepEqual(compared.unexpected,[]);assert.deepEqual(compared.expected,[]);
 assert.deepEqual(reference.readiness,{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),coverage:proof.coverage,queries:proof.results.length,errors:0});assert.equal(reference.functions,546);assertReady210Catalog(reference.catalog);return reference;
}
export async function readReady210Reference(root,filename){return assertReady210Reference(JSON.parse(await readFile(filename,'utf8')),(await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=210),await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_210.json'),'utf8'),await inventory());}
