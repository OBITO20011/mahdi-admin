// 222 is additive to the exact reviewed220 catalog;221 is not applied.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {operationalManifest} from './operational-schema.mjs';
import {assertReady222Catalog,assertPrice222Additive,independentPrices222Name} from './independent-prices222-catalog.mjs';
import {manifestDigest,canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql,realtime151Tables} from '../testing/realtime151-contract.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';
import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
import {compareManagedCatalog} from './managed-catalog-policy.mjs';
import {frankfurt220TriggerAcl,frozen220TriggerAclProfile} from './frozen220-trigger-acl.mjs';
export {assertReady222Catalog};
export const ready222Ceiling=222,ready222ReferenceName='local-reference-through222-ready.json';
export function assertReady222Reference(reference,manifest,proofText,source){
 assert.equal(reference.format,32);assert.equal(reference.migrationCeiling,222);assert.equal(manifest.length,182);assert.equal(manifest.at(-1).name,independentPrices222Name);
 assert.ok(!manifest.some(m=>/^21[18]_/u.test(m.name)),'PRICES222_RESERVED_HISTORY_REQUIRED');
 assert.deepEqual(reference.manifest,manifest);assert.equal(reference.manifestDigest,manifestDigest(manifest));assert.deepEqual(reference.appliedVersions,manifest.map(m=>m.name.slice(0,3)));
 assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql));assert.equal(reference.catalogSha256,sha256(JSON.stringify(reference.catalog)));
 assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql));assert.equal(reference.realtimeSha256,sha256(JSON.stringify(reference.realtimePublication)));
 assert.deepEqual(reference.realtimePublication.tables.map(t=>t.schema+'.'+t.name).sort(),realtime151Tables.map(t=>'public.'+t).sort());assert.equal(reference.realtimePublication.publication.owner,'postgres');assert.equal(reference.realtimePublication.publication.allTables,false);
 assert.deepEqual(Object.keys(reference.prefixes),['220','222']);
 for(const version of ['220','222']){const prefix=reference.prefixes[version];assert.equal(prefix.catalogSha256,sha256(JSON.stringify(prefix.catalog)));assert.deepEqual(prefix.appliedVersions,manifest.filter(m=>Number(m.name.slice(0,3))<=Number(version)).map(m=>m.name.slice(0,3)));assert.deepEqual(prefix.realtimePublication,reference.realtimePublication);assert.equal(frozen220TriggerAclProfile(prefix.catalog.functions),'local');}
 assert.deepEqual(reference.frankfurtFrozenTriggerAcl,frankfurt220TriggerAcl);
 assertReady222Catalog(reference.catalog);assert.deepEqual(reference.prefixes['222'].catalog,reference.catalog);assertPrice222Additive(reference.prefixes['220'].catalog,reference.catalog);assert.equal(reference.freshIncrementalDifferenceCount,0);
 const proof=JSON.parse(proofText);assert.equal(proof.migrationCeiling,222);assert.equal(proof.managedAccess,false);assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);
 assert.deepEqual(proof.sourceHashes,source.sources);assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results));assert.ok(proof.results.every(r=>r.sqlstate===null));assert.deepEqual(proof.manifest,manifest.map(m=>m.name));
 const comparison=compareManagedCatalog(proof.catalog,reference.catalog,{beforeBuildDate:proof.startedAt.slice(0,10),afterBuildDate:reference.buildUtcDate});assert.deepEqual(comparison.unexpected,[]);assert.deepEqual(comparison.expected,[]);
 assert.deepEqual(reference.readiness,{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),coverage:proof.coverage,queries:proof.results.length,errors:0});assert.equal(reference.functions,683);return reference;
}
export async function readReady222Reference(root,filename){return assertReady222Reference(JSON.parse(await readFile(filename,'utf8')),await operationalManifest(),await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_222.json'),'utf8'),await inventory());}
