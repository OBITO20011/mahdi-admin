import {sourceBeforeOwnerTelegramFormat} from '../audit/source-before-owner-telegram-format.mjs';
import {assertReady212Catalog} from './frankfurt-reference212.mjs';
import {assert213Transition} from '../testing/handover213-contract.mjs';
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import path from 'node:path';
import {migrationManifest,manifestDigest,canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql,realtime151Tables} from '../testing/realtime151-contract.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
import {compareManagedCatalog} from './managed-catalog-policy.mjs';
import {assertReady213Catalog} from './frankfurt-reference213.mjs';
import {assertReady214Catalog,assert214Transition} from '../testing/handover214-contract.mjs';
export {assertReady214Catalog};
export const ready214Ceiling=214,ready214ReferenceName='local-reference-through214-ready.json';
export function assertReady214Reference(reference,manifest,proofText,source){
 assert.equal(reference.format,25);assert.equal(reference.migrationCeiling,214);assert.equal(manifest.length,176);assert.equal(manifest.at(-1).name,'214_handover_z_corrections.sql');
 assert.deepEqual(reference.manifest,manifest);assert.equal(reference.manifestDigest,manifestDigest(manifest));assert.deepEqual(reference.appliedVersions,manifest.map(m=>m.name.slice(0,3)));
 assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql));assert.equal(reference.catalogSha256,sha256(JSON.stringify(reference.catalog)));
 assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql));assert.equal(reference.realtimeSha256,sha256(JSON.stringify(reference.realtimePublication)));
 assert.deepEqual(reference.realtimePublication.tables.map(t=>t.schema+'.'+t.name).sort(),realtime151Tables.map(t=>'public.'+t).sort());assert.equal(reference.realtimePublication.publication.allTables,false);assert.equal(reference.realtimePublication.publication.owner,'postgres');
 assert.deepEqual(Object.keys(reference.prefixes),['212','213','214']);
 for(const version of ['212','213','214']){const p=reference.prefixes[version];assert.equal(p.catalogSha256,sha256(JSON.stringify(p.catalog)));assert.deepEqual(p.appliedVersions,manifest.filter(m=>Number(m.name.slice(0,3))<=Number(version)).map(m=>m.name.slice(0,3)));assert.deepEqual(p.realtimePublication,reference.realtimePublication);}
 assertReady212Catalog(reference.prefixes['212'].catalog);assert213Transition(reference.prefixes['212'].catalog,reference.prefixes['213'].catalog);assertReady213Catalog(reference.prefixes['213'].catalog);assert214Transition(reference.prefixes['213'].catalog,reference.catalog);assert.deepEqual(reference.prefixes['214'].catalog,reference.catalog);assert.equal(reference.freshIncrementalDifferenceCount,0);
 const proof=JSON.parse(proofText);assert.equal(proof.migrationCeiling,214);assert.equal(proof.managedAccess,false);assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.deepEqual(proof.sourceHashes,source.sources);assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results));assert.ok(proof.results.every(r=>r.sqlstate===null));assert.deepEqual(proof.manifest,manifest.map(m=>m.name));
 const compared=compareManagedCatalog(proof.catalog,reference.catalog,{beforeBuildDate:proof.startedAt.slice(0,10),afterBuildDate:reference.buildUtcDate});assert.deepEqual(compared.unexpected,[]);assert.deepEqual(compared.expected,[]);
 assert.deepEqual(reference.readiness,{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),coverage:proof.coverage,queries:proof.results.length,errors:0});assert.equal(reference.functions,556);assertReady214Catalog(reference.catalog);return reference;
}
export async function readReady214Reference(root,filename){return assertReady214Reference(JSON.parse(await readFile(filename,'utf8')),(await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=214),await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_214.json'),'utf8'),await inventory({projectSource:sourceBeforeOwnerTelegramFormat}));}
