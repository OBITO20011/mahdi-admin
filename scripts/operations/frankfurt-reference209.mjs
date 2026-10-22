import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {migrationManifest,manifestDigest,canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql,realtime151Tables} from '../testing/realtime151-contract.mjs';
import {verifiedInventoryBeforeTrialD as inventory} from '../audit/source-before-trial-sale-receipts.mjs';
import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
import {assertReady208Catalog} from './frankfurt-reference208.mjs';
import {aclEntries} from './managed-catalog-policy.mjs';
import {compareManagedCatalog} from './managed-catalog-policy.mjs';
export const ready209Ceiling=209,ready209ReferenceName='local-reference-through209-ready.json';
// Existing ALL-COLUMNS publication gains this sole new products column.
// Membership,order,filters,owners/options and every other column stay exact.
export function assert209PublicationTransition(before,after){
 const expected=structuredClone(after),products=expected.tables.filter(t=>t.schema==='public'&&t.name==='products');
 assert.equal(products.length,1);assert.equal(products[0].columns.filter(c=>c==='parcel_only').length,1);
 products[0].columns=products[0].columns.filter(c=>c!=='parcel_only');
 assert.deepEqual(before,expected,'PARCEL209_ONLY_FLAG_PUBLICATION_DELTA');
}
export function assertReady209Catalog(catalog){
 assertReady208Catalog(catalog);
 const products=catalog.tables.find(t=>t.schema==='public'&&t.name==='products');
 const flag=products?.columns.filter(c=>c.name==='parcel_only');assert.equal(flag?.length,1,'PARCEL209_FLAG_REQUIRED');
 assert.equal(flag[0].notNull,true);assert.equal(flag[0].type,'boolean');assert.equal(flag[0].default,'false');
 const check=catalog.constraints.filter(c=>c.schema==='public'&&c.table==='products'&&c.name==='products_parcel_only_sale_size_check');assert.equal(check.length,1);assert.equal(check[0].validated,true);assert.match(check[0].definition,/parcel_only.*units_per_sale_unit > 1/su);
 for(const name of ['create_product_with_opening_stock_v5','create_product_family_with_flavors_v2','update_product_master_v5']){
  const rows=catalog.functions.filter(f=>f.schema==='public'&&f.identity.startsWith(name+'('));assert.equal(rows.length,1,'PARCEL209_ONE_WRITER:'+name);const f=rows[0];
  assert.equal(f.owner,'postgres');assert.deepEqual(f.configuration,['search_path=public, pg_temp']);assert.match(f.definition,/SECURITY DEFINER/u);
  assert.deepEqual(aclEntries(f.acl,f,'functions').filter(a=>a.grantee!=='postgres').map(a=>[a.grantee,a.privilege,a.grantable]),[['authenticated','EXECUTE',false]]);
 }
 const helpers=catalog.functions.filter(f=>f.schema==='public'&&f.identity.startsWith('parcel209_'));assert.equal(helpers.length,9);
 for(const f of helpers){assert.equal(f.owner,'postgres');assert.deepEqual(f.configuration,['search_path=public, pg_temp']);assert.match(f.definition,/SECURITY DEFINER/u);assert.ok(aclEntries(f.acl,f,'functions').every(a=>a.grantee==='postgres'),'PARCEL209_PRIVATE_HELPER:'+f.identity);}
}
export function assertReady209Reference(reference,manifest,proofText,source){
  assert.equal(reference.format,20,'READY209_REFERENCE_REQUIRED');assert.equal(reference.migrationCeiling,209,'READY209_REFERENCE_REQUIRED');
  assert.equal(manifest.length,171);assert.equal(manifest.at(-1)?.name,'209_product_sale_methods.sql');
  assert.deepEqual(reference.manifest,manifest);assert.equal(reference.manifestDigest,manifestDigest(manifest));
  assert.deepEqual(reference.appliedVersions,manifest.map(m=>m.name.slice(0,3)));
  assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql));assert.equal(reference.catalogSha256,sha256(JSON.stringify(reference.catalog)));
  assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql));assert.equal(reference.realtimeSha256,sha256(JSON.stringify(reference.realtimePublication)));
  assert.deepEqual(reference.realtimePublication.tables.map(t=>t.schema+'.'+t.name).sort(),realtime151Tables.map(t=>'public.'+t).sort());
  assert.equal(reference.realtimePublication.publication.allTables,false);assert.equal(reference.realtimePublication.publication.owner,'postgres');
  assert.deepEqual(Object.keys(reference.prefixes),['208','209']);
  for(const version of ['208','209']){
    const p=reference.prefixes[version];assert.equal(p.catalogSha256,sha256(JSON.stringify(p.catalog)));
    assert.deepEqual(p.appliedVersions,manifest.filter(m=>Number(m.name.slice(0,3))<=Number(version)).map(m=>m.name.slice(0,3)));
    if(version==='208')assert209PublicationTransition(p.realtimePublication,reference.realtimePublication);
    else assert.deepEqual(p.realtimePublication,reference.realtimePublication);
  }
  assert.deepEqual(reference.prefixes['209'].catalog,reference.catalog);assert.equal(reference.freshIncrementalDifferenceCount,0);
  const proof=JSON.parse(proofText);assert.equal(proof.migrationCeiling,209);assert.equal(proof.managedAccess,false);
  assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.deepEqual(proof.sourceHashes,source.sources);
  assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results));assert.ok(proof.results.every(r=>r.sqlstate===null));
  assert.deepEqual(proof.manifest,manifest.map(m=>m.name));
  const compared=compareManagedCatalog(proof.catalog,reference.catalog,{beforeBuildDate:proof.startedAt.slice(0,10),afterBuildDate:reference.buildUtcDate});
  assert.deepEqual(compared.unexpected,[]);assert.deepEqual(compared.expected,[]);
  assert.deepEqual(reference.readiness,{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),coverage:proof.coverage,queries:proof.results.length,errors:0});
  assert.equal(reference.functions,546);assertReady209Catalog(reference.catalog);return reference;
}
export async function readReady209Reference(root,filename){
  return assertReady209Reference(JSON.parse(await readFile(filename,'utf8')),
    (await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=209),
    await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_209.json'),'utf8'),await inventory());
}
