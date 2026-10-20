// First-owner uses the delivered198 reference,plus the CURRENT real SDK proof.
// Historical150/164/171/182 reference chains must never gate this tool again.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {readReady198Reference,ready198ReferenceName} from './frankfurt-reference198.mjs';
import {inventoryBeforeSales204 as inventory} from '../audit/source-before-sales-history204.mjs';
import {restoreHomeDamage201SourceHashes} from '../audit/source-before-home-damage201.mjs';
import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
import {canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {compareManagedCatalog} from './managed-catalog-policy.mjs';
export const firstOwnerAccessProof='TABLE_ACCESS_STAGING_198.json';
export function assertFirstOwner198Access(reference,proofText,source){
 assert.equal(reference.migrationCeiling,198,'FIRST_OWNER198_REFERENCE_REQUIRED');
 const proof=JSON.parse(proofText);
 assert.equal(proof.migrationCeiling,198,'FIRST_OWNER198_ACCESS_REQUIRED');
 assert.equal(proof.managedAccess,false,'FIRST_OWNER198_LOCAL_PROOF_REQUIRED');
 assert.equal(proof.infrastructureOk,true,'FIRST_OWNER198_INFRASTRUCTURE_REQUIRED');
 assert.equal(proof.applicationReady,true,'FIRST_OWNER198_ACCESS_NOT_READY');
 const historicalSources=restoreHomeDamage201SourceHashes(source.sources);
 assert.deepEqual(proof.sourceHashes,historicalSources,'FIRST_OWNER198_CURRENT_SOURCE_MISMATCH');
 assert.deepEqual(proof.manifest,reference.manifest.map(m=>m.name),'FIRST_OWNER198_ACCESS_HISTORY_MISMATCH');
 assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results),'FIRST_OWNER198_ACCESS_COVERAGE_MISMATCH');
 assert.ok(proof.results.every(r=>r.sqlstate===null&&['success','zero_rows'].includes(r.outcome)),'FIRST_OWNER198_ACCESS_ERROR');
 const compared=compareManagedCatalog(reference.catalog,proof.catalog,{beforeBuildDate:reference.buildUtcDate,afterBuildDate:proof.startedAt.slice(0,10)});
 assert.deepEqual(compared.unexpected,[],'FIRST_OWNER198_ACCESS_CATALOG_MISMATCH');
 assert.deepEqual(compared.expected,[],'FIRST_OWNER198_PROOF_MUST_BE_UNHELD_BUILD');
 return {migrationCeiling:198,referenceFile:ready198ReferenceName,referenceManifestDigest:reference.manifestDigest,
  currentAccessFile:firstOwnerAccessProof,currentAccessSha256:sha256(canonicalLf(proofText)),
  sourceSha256:sha256(JSON.stringify(historicalSources)),coverage:proof.coverage,queries:proof.results.length};
}
export async function readFirstOwner198Reference(root,filename){
 const reference=await readReady198Reference(root,filename);
 const access=assertFirstOwner198Access(reference,await readFile(path.join(root,'docs/operations',firstOwnerAccessProof),'utf8'),await inventory());
 return {reference,access};
}
