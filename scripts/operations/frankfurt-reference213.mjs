import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import path from 'node:path';
import {migrationManifest,manifestDigest,canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql,realtime151Tables} from '../testing/realtime151-contract.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
import {compareManagedCatalog} from './managed-catalog-policy.mjs';
import {assertReady212Catalog} from './frankfurt-reference212.mjs';
import {assertReady213Catalog,assert213Transition} from '../testing/handover213-contract.mjs';
export {assertReady213Catalog};
export const ready213Ceiling=213,ready213ReferenceName='local-reference-through213-ready.json';
export function assertReady213Reference(reference,manifest,proofText,source){
 assert.equal(reference.format,24);assert.equal(reference.migrationCeiling,213);assert.equal(manifest.length,175);assert.equal(manifest.at(-1).name,'213_handover_security_hardening.sql');
 assert.deepEqual(reference.manifest,manifest);assert.equal(reference.manifestDigest,manifestDigest(manifest));assert.deepEqual(reference.appliedVersions,manifest.map(m=>m.name.slice(0,3)));
 assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql));assert.equal(reference.catalogSha256,sha256(JSON.stringify(reference.catalog)));
 assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql));assert.equal(reference.realtimeSha256,sha256(JSON.stringify(reference.realtimePublication)));
 assert.deepEqual(reference.realtimePublication.tables.map(t=>t.schema+'.'+t.name).sort(),realtime151Tables.map(t=>'public.'+t).sort());assert.equal(reference.realtimePublication.publication.allTables,false);assert.equal(reference.realtimePublication.publication.owner,'postgres');
 assert.deepEqual(Object.keys(reference.prefixes),['212','213']);
 for(const version of ['212','213']){const p=reference.prefixes[version];assert.equal(p.catalogSha256,sha256(JSON.stringify(p.catalog)));assert.deepEqual(p.appliedVersions,manifest.filter(m=>Number(m.name.slice(0,3))<=Number(version)).map(m=>m.name.slice(0,3)));assert.deepEqual(p.realtimePublication,reference.realtimePublication);}
 assertReady212Catalog(reference.prefixes['212'].catalog);assert213Transition(reference.prefixes['212'].catalog,reference.catalog);assert.deepEqual(reference.prefixes['213'].catalog,reference.catalog);assert.equal(reference.freshIncrementalDifferenceCount,0);
 const proof=JSON.parse(proofText);assert.equal(proof.migrationCeiling,213);assert.equal(proof.managedAccess,false);assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.deepEqual(proof.sourceHashes,source.sources);assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results));assert.ok(proof.results.every(r=>r.sqlstate===null));assert.deepEqual(proof.manifest,manifest.map(m=>m.name));
 const compared=compareManagedCatalog(proof.catalog,reference.catalog,{beforeBuildDate:proof.startedAt.slice(0,10),afterBuildDate:reference.buildUtcDate});assert.deepEqual(compared.unexpected,[]);assert.deepEqual(compared.expected,[]);
 assert.deepEqual(reference.readiness,{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),coverage:proof.coverage,queries:proof.results.length,errors:0});assert.equal(reference.functions,556);assertReady213Catalog(reference.catalog);return reference;
}
export async function readReady213Reference(root,filename){return assertReady213Reference(JSON.parse(await readFile(filename,'utf8')),(await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=213),await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_213.json'),'utf8'),await inventory());}
