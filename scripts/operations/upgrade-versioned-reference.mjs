// Exact, reviewed historical source views. Unknown bytes are never normalized.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {operationalManifest} from './operational-schema.mjs';
import {sourceBeforeOptionalQuantity223} from '../audit/source-before-optional-quantity223.mjs';
import {sourceBeforePriceVisibility} from '../audit/source-before-price-visibility.mjs';
import {sourceBeforeLatinDigits} from '../audit/source-before-latin-digits.mjs';
import {canonicalLf,sha256,manifestDigest} from '../testing/maintenance-db-contract.mjs';

export const upgradeReferenceOrigins=Object.freeze({
 222:Object.freeze({commit:'0bd3b5b0fd149c9e92d802c6dabb55b236c127cc',files:182,
  manifest:'cb1d0e10edaa6886620d290b3a6f45181fe52c6802298c3bae631c6a8bfc7fd8',
  migration:'222_independent_lite_parcel_prices.sql',migrationSha256:'bcf55b1f43714e27d525dedac51cc7c3f85d0e1f2be422bbc422cafc6ff84a68',
  proofSha256:'5bee24d5568ebf41489dcdf8a51b9cf02f4e8167eeb99d76b6a7b183bf5b43f6'}),
 223:Object.freeze({commit:'99eb18465d828b404764a18f1ff212f793e3fcc3',files:183,
  manifest:'da7be0d23ca1a005629f6cc7f8f0a583c6aaf77571c3e0f394414b1867b141f5',
  migration:'223_optional_sales_quantity.sql',migrationSha256:'d5d6397bd5d676f766493b7a85b1f47ad6f1b6f6c465e7b4a32219ee49abc0af',
  proofSha256:'874b531c44809c01b9363034500071110aebc2ba2f985d5634bdc3cd89d5fe7d'}),
});
export function upgradeReferenceSource(version,file,text){
 assert.ok(Object.hasOwn(upgradeReferenceOrigins,version),'UPGRADE_REFERENCE_VERSION_UNSUPPORTED');
 return version===222?sourceBeforePriceVisibility(file,sourceBeforeOptionalQuantity223(file,text)):sourceBeforeLatinDigits(file,text);
}
export async function upgradeReferenceManifest(root,version){
 const pin=upgradeReferenceOrigins[version];
 assert.ok(pin,'UPGRADE_REFERENCE_VERSION_UNSUPPORTED');
 const manifest=(await operationalManifest()).filter(m=>Number(m.name.slice(0,3))<=version);
 assert.equal(manifest.length,pin.files,'UPGRADE_REFERENCE_HISTORY_PIN_MISMATCH');
 assert.equal(manifestDigest(manifest),pin.manifest,'UPGRADE_REFERENCE_MANIFEST_PIN_MISMATCH');
 assert.equal(sha256(await readFile(path.join(root,'supabase/migrations',pin.migration))),pin.migrationSha256,'UPGRADE_REFERENCE_MIGRATION_RAW_PIN_MISMATCH');
 return manifest;
}
export async function upgradeReferenceProof(root,version){
 const file=`docs/operations/TABLE_ACCESS_AFTER_${version}.json`;
 const projected=upgradeReferenceSource(version,file,canonicalLf(await readFile(path.join(root,file),'utf8')));
 assert.ok(projected!==null,'UPGRADE_REFERENCE_PROOF_REQUIRED');
 assert.equal(sha256(projected),upgradeReferenceOrigins[version].proofSha256,'UPGRADE_REFERENCE_PROOF_PIN_MISMATCH');
 return projected;
}
