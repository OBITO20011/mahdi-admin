import {sourceBeforeIndependentPrices222} from '../audit/source-before-independent-prices222.mjs';
import {operationalManifest} from './operational-schema.mjs';
// Lite-only220 readiness. PR79 is deferred221;219 admission stays independent.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {assertReady217Catalog} from './frankfurt-reference217.mjs';
import {assertReady219Catalog} from './frankfurt-reference219.mjs';
import {compareManagedCatalog} from './managed-catalog-policy.mjs';
import {compareApplicationAcl} from './application-acl-verification.mjs';
import {assertSalesOnly220Catalog} from './sales-only220-catalog.mjs';
import {frankfurt220TriggerAcl,frozen220TriggerAclProfile} from './frozen220-trigger-acl.mjs';
import {manifestDigest,canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql,realtime151Tables} from '../testing/realtime151-contract.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';
import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
import {salesOnly220Name} from '../testing/sales-only220-compiler.mjs';
export const ready220Ceiling=220,ready220ReferenceName='local-reference-through220-ready.json';
export function assertReady220Catalog(catalog,options){assertReady217Catalog(catalog);return assertSalesOnly220Catalog(catalog,options);}
export function assertExisting219AclPreserved(before,after){
 const original=new Set(before.functions.filter(f=>f.schema==='public').map(f=>f.identity));assert.equal(original.size,636);
 const existing={...after,functions:after.functions.filter(f=>f.schema!=='public'||original.has(f.identity))};
 assert.equal(compareApplicationAcl(before,existing).ok,true,'LITE220_ORIGINAL636_ACL_CHANGED');
}
export function assertReady220Reference(reference,manifest,proofText,source){
 assert.equal(reference.format,31);assert.equal(reference.migrationCeiling,220);assert.equal(manifest.length,181);assert.equal(manifest.at(-1).name,salesOnly220Name);assert.ok(!manifest.some(m=>m.name.startsWith('218_')),'OWNER220_218_REMAINS_RESERVED');
 assert.deepEqual(reference.manifest,manifest);assert.equal(reference.manifestDigest,manifestDigest(manifest));assert.deepEqual(reference.appliedVersions,manifest.map(m=>m.name.slice(0,3)));
 assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql));assert.equal(reference.catalogSha256,sha256(JSON.stringify(reference.catalog)));
 assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql));assert.equal(reference.realtimeSha256,sha256(JSON.stringify(reference.realtimePublication)));
 assert.deepEqual(reference.realtimePublication.tables.map(t=>t.schema+'.'+t.name).sort(),realtime151Tables.map(t=>'public.'+t).sort());assert.equal(reference.realtimePublication.publication.owner,'postgres');assert.equal(reference.realtimePublication.publication.allTables,false);
 assert.deepEqual(Object.keys(reference.prefixes),['219','220']);
 for(const version of ['219','220']){const prefix=reference.prefixes[version];assert.equal(prefix.catalogSha256,sha256(JSON.stringify(prefix.catalog)));assert.deepEqual(prefix.appliedVersions,manifest.filter(m=>Number(m.name.slice(0,3))<=Number(version)).map(m=>m.name.slice(0,3)));assert.deepEqual(prefix.realtimePublication,reference.realtimePublication);}
 assert.deepEqual(reference.frankfurtFrozenTriggerAcl,frankfurt220TriggerAcl,'OWNER220_FRANKFURT_ACL_REFERENCE_DRIFT');
 for(const prefix of Object.values(reference.prefixes))assert.equal(frozen220TriggerAclProfile(prefix.catalog.functions),'local','OWNER220_LOCAL_REFERENCE_PROFILE_REQUIRED');
 assertReady219Catalog(reference.prefixes['219'].catalog);assertReady220Catalog(reference.catalog);assert.deepEqual(reference.prefixes['220'].catalog,reference.catalog);assertExisting219AclPreserved(reference.prefixes['219'].catalog,reference.catalog);assert.equal(reference.freshIncrementalDifferenceCount,0);
 const proof=JSON.parse(proofText);assert.equal(proof.migrationCeiling,220);assert.equal(proof.managedAccess,false);assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);
 assert.deepEqual(proof.sourceHashes,source.sources);assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results));assert.ok(proof.results.every(r=>r.sqlstate===null));assert.deepEqual(proof.manifest,manifest.map(m=>m.name));
 const compared=compareManagedCatalog(proof.catalog,reference.catalog,{beforeBuildDate:proof.startedAt.slice(0,10),afterBuildDate:reference.buildUtcDate});assert.deepEqual(compared.unexpected,[]);assert.deepEqual(compared.expected,[]);
 assert.deepEqual(reference.readiness,{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),coverage:proof.coverage,queries:proof.results.length,errors:0});assert.equal(reference.functions,680);return reference;
}
export async function readReady220Reference(root,filename){return assertReady220Reference(JSON.parse(await readFile(filename,'utf8')),(await operationalManifest()).filter(m=>Number(m.name.slice(0,3))<=220),await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_220.json'),'utf8'),await inventory({projectSource:sourceBeforeIndependentPrices222}));}
