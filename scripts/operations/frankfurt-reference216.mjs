// Current216 reference: independent fresh/incremental catalogs and actual SDK
// evidence. Historical215 is a separate prefix, never a renamed216 reference.
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import path from 'node:path';
import {assertReady215Catalog} from './frankfurt-reference215.mjs';import {aclEntries,compareManagedCatalog} from './managed-catalog-policy.mjs';
import {migrationManifest,manifestDigest,canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';import {realtimePublicationSql,realtime151Tables} from '../testing/realtime151-contract.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
export const ready216Ceiling=216,ready216ReferenceName='local-reference-through216-ready.json';
export function assertReady216Catalog(catalog){
 assertReady215Catalog(catalog);
 const name='pos216_initial_payments',tables=catalog.tables.filter(t=>t.schema==='public'&&t.name===name);assert.equal(tables.length,1,name);
 const table=tables[0];assert.equal(table.owner,'postgres');assert.equal(table.rls,true);assert.equal(table.kind,'r');
 assert.deepEqual(aclEntries(table.acl,table,'tables').filter(a=>a.grantee!=='postgres'),[]);assert.ok(!catalog.policies.some(p=>p.schema==='public'&&p.table===name));
 for(const suffix of ['_immutable','_no_truncate'])assert.ok(catalog.triggers.some(t=>t.schema==='public'&&t.table===name&&t.name===name+suffix&&t.enabled==='O'),name+suffix);
 const exposed=catalog.functions.filter(f=>f.schema==='public'&&f.identity.startsWith('create_pos_sale_with_initial_payment_v1('));assert.equal(exposed.length,1);
 const f=exposed[0];assert.equal(f.owner,'postgres');assert.deepEqual(f.configuration,['search_path=public, pg_temp']);
 assert.deepEqual(aclEntries(f.acl,f,'functions').filter(a=>a.grantee!=='postgres').map(a=>({grantee:a.grantee,privilege:a.privilege,grantable:a.grantable})),[{grantee:'authenticated',privilege:'EXECUTE',grantable:false}]);
 const privateFunctions=catalog.functions.filter(f=>f.schema==='public'&&f.identity.startsWith('tc216_'));assert.equal(privateFunctions.length,3,'216_PRIVATE_HELPERS_COMPLETE');
 for(const p of privateFunctions){assert.equal(p.owner,'postgres');assert.deepEqual(p.configuration,['search_path=public, pg_temp']);assert.deepEqual(aclEntries(p.acl,p,'functions').filter(a=>a.grantee!=='postgres'),[],p.identity);}
 return catalog;
}
export function assertReady216Reference(reference,manifest,proofText,source){
 assert.equal(reference.format,27);assert.equal(reference.migrationCeiling,216);assert.equal(manifest.length,178);assert.equal(manifest.at(-1).name,'216_pos_partial_payments.sql');
 assert.deepEqual(reference.manifest,manifest);assert.equal(reference.manifestDigest,manifestDigest(manifest));assert.deepEqual(reference.appliedVersions,manifest.map(m=>m.name.slice(0,3)));
 assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql));assert.equal(reference.catalogSha256,sha256(JSON.stringify(reference.catalog)));
 assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql));assert.equal(reference.realtimeSha256,sha256(JSON.stringify(reference.realtimePublication)));
 assert.deepEqual(reference.realtimePublication.tables.map(t=>t.schema+'.'+t.name).sort(),realtime151Tables.map(t=>'public.'+t).sort());assert.equal(reference.realtimePublication.publication.owner,'postgres');assert.equal(reference.realtimePublication.publication.allTables,false);
 assert.deepEqual(Object.keys(reference.prefixes),['215','216']);
 for(const version of ['215','216']){const p=reference.prefixes[version];assert.equal(p.catalogSha256,sha256(JSON.stringify(p.catalog)));assert.deepEqual(p.appliedVersions,manifest.filter(m=>Number(m.name.slice(0,3))<=Number(version)).map(m=>m.name.slice(0,3)));assert.deepEqual(p.realtimePublication,reference.realtimePublication);}
 assertReady215Catalog(reference.prefixes['215'].catalog);assertReady216Catalog(reference.catalog);assert.deepEqual(reference.prefixes['216'].catalog,reference.catalog);assert.equal(reference.freshIncrementalDifferenceCount,0);
 const proof=JSON.parse(proofText);assert.equal(proof.migrationCeiling,216);assert.equal(proof.managedAccess,false);assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);
 assert.deepEqual(proof.sourceHashes,source.sources);assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results));assert.ok(proof.results.every(r=>r.sqlstate===null));assert.deepEqual(proof.manifest,manifest.map(m=>m.name));
 const compared=compareManagedCatalog(proof.catalog,reference.catalog,{beforeBuildDate:proof.startedAt.slice(0,10),afterBuildDate:reference.buildUtcDate});assert.deepEqual(compared.unexpected,[]);assert.deepEqual(compared.expected,[]);
 assert.deepEqual(reference.readiness,{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),coverage:proof.coverage,queries:proof.results.length,errors:0});assert.equal(reference.functions,626);return reference;
}
export async function readReady216Reference(root,filename){return assertReady216Reference(JSON.parse(await readFile(filename,'utf8')),(await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=216),await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_216.json'),'utf8'),await inventory());}
