import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {assertReady225Catalog} from './frankfurt-reference225.mjs';
import {assertParcel226CatalogDelta} from './parcel226-catalog.mjs';
import {operationalManifest,operationalSchema} from './operational-schema.mjs';
import {manifestDigest,canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql,realtime151Tables} from '../testing/realtime151-contract.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';
import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
import {assertManagedCatalog,compareManagedCatalog} from './managed-catalog-policy.mjs';
import {frankfurt220TriggerAcl,frozen220TriggerAclProfile} from './frozen220-trigger-acl.mjs';

export const ready226ReferenceName='local-reference-through226-ready.json';
export const parcel226Migration='226_parcel_price_integrity.sql';
export const parcel226ReadinessPath='docs/operations/TABLE_ACCESS_AFTER_226.json';

export function assertHeld226Catalog(catalog,reference){
 return assertManagedCatalog(reference.catalog,catalog,{
  beforeBuildDate:reference.buildUtcDate,afterBuildDate:new Date().toISOString().slice(0,10),
 });
}

export function assertReady226Reference(reference,manifest,proofText,source){
 assert.equal(reference.format,36,'PARCEL226_REFERENCE_FORMAT');
 assert.equal(reference.migrationCeiling,226);
 assert.equal(manifest.length,186);
 assert.equal(manifest.at(-1).name,parcel226Migration);
 assert.ok(!manifest.some(row=>/^(?:218|221)_/u.test(row.name)),'PARCEL226_RESERVED_HISTORY');
 assert.deepEqual(reference.manifest,manifest);
 assert.equal(reference.manifestDigest,manifestDigest(manifest));
 assert.deepEqual(reference.appliedVersions,manifest.map(row=>row.name.slice(0,3)));
 assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql));
 assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql));
 assert.equal(reference.realtimeSha256,sha256(JSON.stringify(reference.realtimePublication)));
 assert.deepEqual(reference.realtimePublication.tables.map(row=>row.schema+'.'+row.name).sort(),realtime151Tables.map(name=>'public.'+name).sort());
 assert.equal(reference.realtimePublication.publication.owner,'postgres');
 assert.equal(reference.realtimePublication.publication.allTables,false);
 assert.deepEqual(Object.keys(reference.prefixes),['225','226']);
 for(const version of [225,226]){
  const prefix=reference.prefixes[version];
  assert.equal(prefix.catalogSha256,sha256(JSON.stringify(prefix.catalog)));
  assert.deepEqual(prefix.appliedVersions,manifest.slice(0,version===225?-1:manifest.length).map(row=>row.name.slice(0,3)));
  assert.deepEqual(prefix.realtimePublication,reference.realtimePublication);
  assert.equal(frozen220TriggerAclProfile(prefix.catalog.functions),'local');
 }
 const before=reference.prefixes[225],after=reference.prefixes[226];
 assert.equal(reference.catalogSha256,after.catalogSha256);
 assert.deepEqual(reference.catalog,after.catalog);
 assertReady225Catalog(before.catalog);
 assertParcel226CatalogDelta(before.catalog,after.catalog);
 assert.deepEqual(reference.frankfurtFrozenTriggerAcl,frankfurt220TriggerAcl);
 assert.equal(reference.freshIncrementalDifferenceCount,0);
 const proof=JSON.parse(proofText);
 assert.equal(proof.migrationCeiling,226);
 assert.equal(proof.managedAccess,false);
 assert.equal(proof.infrastructureOk,true);
 assert.equal(proof.applicationReady,true);
 assert.deepEqual(proof.sourceHashes,source.sources);
 assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results));
 assert.ok(proof.results.every(row=>row.sqlstate===null));
 assert.deepEqual(proof.manifest,manifest.map(row=>row.name));
 const compared=compareManagedCatalog(proof.catalog,reference.catalog,{
  beforeBuildDate:proof.startedAt.slice(0,10),afterBuildDate:reference.buildUtcDate,
 });
 assert.deepEqual(compared.unexpected,[]);
 assert.deepEqual(compared.expected,[]);
 assert.deepEqual(reference.readiness,{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),
  coverage:proof.coverage,queries:proof.results.length,errors:0});
 assert.equal(reference.functions,707);
 return reference;
}

export async function readReady226Reference(root,filename){
 assert.equal(operationalSchema.ceiling,226,'PARCEL226_CEILING_REQUIRED');
 return assertReady226Reference(JSON.parse(await readFile(filename,'utf8')),await operationalManifest(),
  await readFile(path.join(root,parcel226ReadinessPath),'utf8'),await inventory());
}
