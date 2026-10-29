// Current217 reference: independent fresh/incremental catalogs and actual SDK
// evidence. Historical216 is a separate prefix, never a renamed217 reference.
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import path from 'node:path';
import {assertReady216Catalog} from './frankfurt-reference216.mjs';import {aclEntries,compareManagedCatalog} from './managed-catalog-policy.mjs';
import {migrationManifest,manifestDigest,canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';import {realtimePublicationSql,realtime151Tables} from '../testing/realtime151-contract.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
export const ready217Ceiling=217,ready217ReferenceName='local-reference-through217-ready.json';
export function assertReady217Catalog(catalog){
 assertReady216Catalog(catalog);
 const table=catalog.tables.filter(t=>t.schema==='public'&&t.name==='owner_telegram_dispatch_settings');assert.equal(table.length,1);assert.equal(table[0].owner,'postgres');assert.equal(table[0].rls,true);assert.deepEqual(aclEntries(table[0].acl,table[0],'tables').filter(a=>a.grantee!=='postgres'),[]);assert.ok(!catalog.policies.some(p=>p.schema==='public'&&p.table===table[0].name));
 const service=['claim_automation_deliveries(','complete_automation_delivery(','claim_owner_telegram_deliveries_v1(','owner_telegram_dispatch_lease_valid_v1(','complete_owner_telegram_delivery_v1(','release_owner_telegram_dispatch_v1('];
 const privateNames=['owner217_claim_deliveries_internal(','owner217_complete_delivery_internal(','enqueue_owner_telegram_dispatch_v1('];
 for(const name of [...service,...privateNames]){const rows=catalog.functions.filter(f=>f.schema==='public'&&f.identity.startsWith(name));assert.equal(rows.length,1,name);const f=rows[0];assert.equal(f.owner,'postgres');assert.equal(f.securityDefiner,true);assert.deepEqual(f.configuration,[name.startsWith('enqueue_')?'search_path=public, vault, net, pg_temp':'search_path=public, pg_temp']);assert.deepEqual(aclEntries(f.acl,f,'functions').filter(a=>a.grantee!=='postgres').map(a=>({grantee:a.grantee,privilege:a.privilege,grantable:a.grantable})),service.includes(name)?[{grantee:'service_role',privilege:'EXECUTE',grantable:false}]:[],name);}
 return catalog;
}
export function assertReady217Reference(reference,manifest,proofText,source){
 assert.equal(reference.format,28);assert.equal(reference.migrationCeiling,217);assert.equal(manifest.length,179);assert.equal(manifest.at(-1).name,'217_owner_telegram_dispatch.sql');
 assert.deepEqual(reference.manifest,manifest);assert.equal(reference.manifestDigest,manifestDigest(manifest));assert.deepEqual(reference.appliedVersions,manifest.map(m=>m.name.slice(0,3)));
 assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql));assert.equal(reference.catalogSha256,sha256(JSON.stringify(reference.catalog)));
 assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql));assert.equal(reference.realtimeSha256,sha256(JSON.stringify(reference.realtimePublication)));
 assert.deepEqual(reference.realtimePublication.tables.map(t=>t.schema+'.'+t.name).sort(),realtime151Tables.map(t=>'public.'+t).sort());assert.equal(reference.realtimePublication.publication.owner,'postgres');assert.equal(reference.realtimePublication.publication.allTables,false);
 assert.deepEqual(Object.keys(reference.prefixes),['216','217']);
 for(const version of ['216','217']){const p=reference.prefixes[version];assert.equal(p.catalogSha256,sha256(JSON.stringify(p.catalog)));assert.deepEqual(p.appliedVersions,manifest.filter(m=>Number(m.name.slice(0,3))<=Number(version)).map(m=>m.name.slice(0,3)));assert.deepEqual(p.realtimePublication,reference.realtimePublication);}
 assertReady216Catalog(reference.prefixes['216'].catalog);assertReady217Catalog(reference.catalog);assert.deepEqual(reference.prefixes['217'].catalog,reference.catalog);assert.equal(reference.freshIncrementalDifferenceCount,0);
 const proof=JSON.parse(proofText);assert.equal(proof.migrationCeiling,217);assert.equal(proof.managedAccess,false);assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);
 assert.deepEqual(proof.sourceHashes,source.sources);assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results));assert.ok(proof.results.every(r=>r.sqlstate===null));assert.deepEqual(proof.manifest,manifest.map(m=>m.name));
 const compared=compareManagedCatalog(proof.catalog,reference.catalog,{beforeBuildDate:proof.startedAt.slice(0,10),afterBuildDate:reference.buildUtcDate});assert.deepEqual(compared.unexpected,[]);assert.deepEqual(compared.expected,[]);
 assert.deepEqual(reference.readiness,{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),coverage:proof.coverage,queries:proof.results.length,errors:0});assert.equal(reference.functions,633);return reference;
}
export async function readReady217Reference(root,filename){return assertReady217Reference(JSON.parse(await readFile(filename,'utf8')),(await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=217),await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_217.json'),'utf8'),await inventory());}
