// Strict215 readiness. Reference generation requires independent fresh and
// incremental catalogs and the complete current actual SDK-role evidence.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {assertReady214Catalog} from './frankfurt-reference214.mjs';
import {aclEntries} from './managed-catalog-policy.mjs';
import {migrationManifest,manifestDigest,canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql,realtime151Tables} from '../testing/realtime151-contract.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';
import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
import {compareManagedCatalog} from './managed-catalog-policy.mjs';
import {sourceBeforePartial216} from '../audit/source-before-partial216.mjs';
export const ready215Ceiling=215,ready215ReferenceName='local-reference-through215-ready.json';
export const private215Tables=Object.freeze(['aftercare215_inspections','aftercare215_inspection_items','aftercare215_return_contexts','aftercare215_return_results','supplier215_credits','aftercare215_exchanges','aftercare215_exchange_results']);
export const public215Functions=Object.freeze(['preview_inspected_sales_replacement_v2','settle_inspected_sales_replacement_v2','preview_admin_sales_return_v2','settle_admin_sales_return_v2','preview_sales_exchange_v1','settle_sales_exchange_v1','preview_supplier_replacement_credit_v1','settle_supplier_replacement_credit_v1','get_supplier_replacement_credits_v1','get_damage_ledger_page_v2','get_order_exchange_details_v1']);
export function assertReady215Catalog(catalog){
 assertReady214Catalog(catalog);
 for(const name of private215Tables){
  const rows=catalog.tables.filter(t=>t.schema==='public'&&t.name===name);assert.equal(rows.length,1,name);const t=rows[0];
  assert.equal(t.owner,'postgres',name);assert.equal(t.rls,true,name);assert.equal(t.kind,'r',name);
  assert.deepEqual(aclEntries(t.acl,t,'tables').filter(a=>a.grantee!=='postgres'),[],name);
  assert.ok(!catalog.policies.some(p=>p.schema==='public'&&p.table===name),name+':NO_POLICY');
  for(const suffix of ['_immutable','_no_truncate'])assert.ok(catalog.triggers.some(g=>g.schema==='public'&&g.table===name&&g.name===name+suffix&&g.enabled==='O'),name+suffix);
 }
 for(const name of public215Functions){
  const rows=catalog.functions.filter(f=>f.schema==='public'&&f.identity.startsWith(name+'('));assert.equal(rows.length,1,name);const f=rows[0];
  assert.equal(f.owner,'postgres',name);assert.deepEqual(f.configuration,['search_path=public, pg_temp'],name);
  assert.deepEqual(aclEntries(f.acl,f,'functions').filter(a=>a.grantee!=='postgres').map(a=>({grantee:a.grantee,privilege:a.privilege,grantable:a.grantable})),[{grantee:'authenticated',privilege:'EXECUTE',grantable:false}],name);
 }
 for(const f of catalog.functions.filter(f=>f.schema==='public'&&f.identity.startsWith('tb215_'))){
  assert.equal(f.owner,'postgres',f.identity);assert.deepEqual(aclEntries(f.acl,f,'functions').filter(a=>a.grantee!=='postgres'),[],f.identity);
  assert.deepEqual(f.configuration,['search_path=public, pg_temp'],f.identity);
 }
 assert.ok(catalog.triggers.some(g=>g.schema==='public'&&g.table==='pos_sale_reversals'&&g.name==='aftercare215_funded_pos_no_standalone_reversal'&&g.enabled==='O'),'215_FUNDED_REVERSAL_GUARD_REQUIRED');
 return catalog;
}
export function assertReady215Reference(reference,manifest,proofText,source){
 assert.equal(reference.format,26);assert.equal(reference.migrationCeiling,215);assert.equal(manifest.length,177);assert.equal(manifest.at(-1).name,'215_inspected_aftercare_and_supplier_credit.sql');
 assert.deepEqual(reference.manifest,manifest);assert.equal(reference.manifestDigest,manifestDigest(manifest));assert.deepEqual(reference.appliedVersions,manifest.map(m=>m.name.slice(0,3)));
 assert.deepEqual(Object.keys(reference.prefixes),['214','215']);
 assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql));assert.equal(reference.catalogSha256,sha256(JSON.stringify(reference.catalog)));
 assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql));assert.equal(reference.realtimeSha256,sha256(JSON.stringify(reference.realtimePublication)));
 assert.deepEqual(reference.realtimePublication.tables.map(t=>t.schema+'.'+t.name).sort(),realtime151Tables.map(t=>'public.'+t).sort());
 assert.equal(reference.realtimePublication.publication.owner,'postgres');assert.equal(reference.realtimePublication.publication.allTables,false);
 for(const version of ['214','215']){const p=reference.prefixes[version];assert.equal(p.catalogSha256,sha256(JSON.stringify(p.catalog)));assert.deepEqual(p.appliedVersions,manifest.filter(m=>Number(m.name.slice(0,3))<=Number(version)).map(m=>m.name.slice(0,3)));assert.deepEqual(p.realtimePublication,reference.realtimePublication);}
 assertReady214Catalog(reference.prefixes['214'].catalog);assertReady215Catalog(reference.catalog);assert.deepEqual(reference.prefixes['215'].catalog,reference.catalog);assert.equal(reference.freshIncrementalDifferenceCount,0);
 const proof=JSON.parse(proofText);assert.equal(proof.migrationCeiling,215);assert.equal(proof.managedAccess,false);assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);
 assert.deepEqual(proof.sourceHashes,source.sources);assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results));assert.ok(proof.results.every(r=>r.sqlstate===null));assert.deepEqual(proof.manifest,manifest.map(m=>m.name));
 const compared=compareManagedCatalog(proof.catalog,reference.catalog,{beforeBuildDate:proof.startedAt.slice(0,10),afterBuildDate:reference.buildUtcDate});assert.deepEqual(compared.unexpected,[]);assert.deepEqual(compared.expected,[]);
 assert.deepEqual(reference.readiness,{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),coverage:proof.coverage,queries:proof.results.length,errors:0});assert.equal(reference.functions,622);return reference;
}
export async function readReady215Reference(root,filename){return assertReady215Reference(JSON.parse(await readFile(filename,'utf8')),(await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=215),await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_215.json'),'utf8'),await inventory({projectSource:sourceBeforePartial216}));}
