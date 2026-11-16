import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {upgradeReferenceManifest,upgradeReferenceProof,upgradeReferenceSource} from './upgrade-versioned-reference.mjs';
import {assertReady222Catalog} from './independent-prices222-catalog.mjs';
import {assertReady223Catalog,quantity223Migration,assertQuantity223CatalogDelta} from './optional-quantity223-catalog.mjs';
import {manifestDigest,canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql,realtime151Tables} from '../testing/realtime151-contract.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';
import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
import {compareManagedCatalog} from './managed-catalog-policy.mjs';
import {frankfurt220TriggerAcl,frozen220TriggerAclProfile} from './frozen220-trigger-acl.mjs';

export {assertReady223Catalog};
export const ready223ReferenceName='local-reference-through223-ready.json';
export function assertReady223Reference(reference,manifest,proofText,source){
 assert.equal(reference.format,33);
 assert.equal(reference.migrationCeiling,223);
 assert.equal(manifest.length,183);
 assert.equal(manifest.at(-1).name,quantity223Migration);
 assert.ok(!manifest.some(m=>/^(?:218|221)_/u.test(m.name)),'QUANTITY223_RESERVED_HISTORY');
 assert.deepEqual(reference.manifest,manifest);
 assert.equal(reference.manifestDigest,manifestDigest(manifest));
 assert.deepEqual(reference.appliedVersions,manifest.map(m=>m.name.slice(0,3)));
 assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql));
 assert.equal(reference.catalogSha256,sha256(JSON.stringify(reference.catalog)));
 assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql));
 assert.equal(reference.realtimeSha256,sha256(JSON.stringify(reference.realtimePublication)));
 assert.deepEqual(reference.realtimePublication.tables.map(t=>t.schema+'.'+t.name).sort(),realtime151Tables.map(t=>'public.'+t).sort());
 assert.equal(reference.realtimePublication.publication.owner,'postgres');
 assert.equal(reference.realtimePublication.publication.allTables,false);
 assert.deepEqual(Object.keys(reference.prefixes),['222','223']);
 for(const version of ['222','223']){
  const prefix=reference.prefixes[version];
  assert.equal(prefix.catalogSha256,sha256(JSON.stringify(prefix.catalog)));
  assert.deepEqual(prefix.appliedVersions,manifest.filter(m=>Number(m.name.slice(0,3))<=Number(version)).map(m=>m.name.slice(0,3)));
  assert.deepEqual(prefix.realtimePublication,reference.realtimePublication);
  assert.equal(frozen220TriggerAclProfile(prefix.catalog.functions),'local');
 }
 assert.deepEqual(reference.frankfurtFrozenTriggerAcl,frankfurt220TriggerAcl);
 const before=reference.prefixes['222'],after=reference.prefixes['223'];
 assertReady222Catalog(before.catalog);
 assertReady223Catalog(after.catalog);
 assert.deepEqual(after.catalog,reference.catalog);
 assert.equal(reference.freshIncrementalDifferenceCount,0);
 const dates={beforeBuildDate:before.buildUtcDate,afterBuildDate:after.buildUtcDate};
 assertQuantity223CatalogDelta(before.catalog,after.catalog,dates);
 const proof=JSON.parse(proofText);
 assert.equal(proof.migrationCeiling,223);
 assert.equal(proof.managedAccess,false);
 assert.equal(proof.infrastructureOk,true);
 assert.equal(proof.applicationReady,true);
 assert.deepEqual(proof.sourceHashes,source.sources);
 assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results));
 assert.ok(proof.results.every(row=>row.sqlstate===null));
 assert.deepEqual(proof.manifest,manifest.map(m=>m.name));
 const compared=compareManagedCatalog(proof.catalog,reference.catalog,{
  beforeBuildDate:proof.startedAt.slice(0,10),afterBuildDate:reference.buildUtcDate,
 });
 assert.deepEqual(compared.unexpected,[]);
 assert.deepEqual(compared.expected,[]);
 assert.deepEqual(reference.readiness,{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),
  coverage:proof.coverage,queries:proof.results.length,errors:0});
 assert.equal(reference.functions,687);
 return reference;
}

export async function readReady223Reference(root,filename){
 return assertReady223Reference(JSON.parse(await readFile(filename,'utf8')),await upgradeReferenceManifest(root,223),
  await upgradeReferenceProof(root,223),await inventory({projectSource:(file,text)=>upgradeReferenceSource(223,file,text)}));
}
