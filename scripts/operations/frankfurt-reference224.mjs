import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {operationalManifest,operationalSchema} from './operational-schema.mjs';
import {assertSupportedUpgrade225} from './supported-upgrades225.mjs';
import {sourceBeforeOnPrices225} from '../audit/source-before-on-prices225.mjs';
import {assertReady223Catalog} from './optional-quantity223-catalog.mjs';
import {assertReady224Catalog,inventory224Migration,assertInventory224CatalogDelta} from './inventory224-catalog.mjs';
import {manifestDigest,canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql,realtime151Tables} from '../testing/realtime151-contract.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';
import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
import {compareManagedCatalog} from './managed-catalog-policy.mjs';
import {frankfurt220TriggerAcl,frozen220TriggerAclProfile} from './frozen220-trigger-acl.mjs';

export {assertReady224Catalog};
export const ready224ReferenceName='local-reference-through224-ready.json';
export function assertReady224Reference(reference,manifest,proofText,source){
 assert.equal(reference.format,34);
 assert.equal(reference.migrationCeiling,224);
 assert.equal(manifest.length,184);
 assert.equal(manifest.at(-1).name,inventory224Migration);
 assert.ok(!manifest.some(m=>/^(?:218|221)_/u.test(m.name)),'QUANTITY224_RESERVED_HISTORY');
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
 assert.deepEqual(Object.keys(reference.prefixes),['223','224']);
 for(const version of ['223','224']){
  const prefix=reference.prefixes[version];
  assert.equal(prefix.catalogSha256,sha256(JSON.stringify(prefix.catalog)));
  assert.deepEqual(prefix.appliedVersions,manifest.filter(m=>Number(m.name.slice(0,3))<=Number(version)).map(m=>m.name.slice(0,3)));
  assert.deepEqual(prefix.realtimePublication,reference.realtimePublication);
  assert.equal(frozen220TriggerAclProfile(prefix.catalog.functions),'local');
 }
 assert.deepEqual(reference.frankfurtFrozenTriggerAcl,frankfurt220TriggerAcl);
 const before=reference.prefixes['223'],after=reference.prefixes['224'];
 assertReady223Catalog(before.catalog);
 assertReady224Catalog(after.catalog);
 assert.deepEqual(after.catalog,reference.catalog);
 assert.equal(reference.freshIncrementalDifferenceCount,0);
 const dates={beforeBuildDate:before.buildUtcDate,afterBuildDate:after.buildUtcDate};
 assertInventory224CatalogDelta(before.catalog,after.catalog,dates);
 const proof=JSON.parse(proofText);
 assert.equal(proof.migrationCeiling,224);
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
 assert.equal(reference.functions,688);
 return reference;
}

export async function readReady224Reference(root,filename){
 let manifest=await operationalManifest();
 if([225,226].includes(operationalSchema.ceiling)){assertSupportedUpgrade225(224);manifest=manifest.filter(unit=>Number(unit.name.slice(0,3))<=224);}
 return assertReady224Reference(JSON.parse(await readFile(filename,'utf8')),manifest,
  await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_224.json'),'utf8'),await inventory({projectSource:sourceBeforeOnPrices225}));
}
