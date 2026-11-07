// Independent220 readiness;no renaming or mutation of the owner's219 reference.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {assertReady217Catalog} from './frankfurt-reference217.mjs';
import {assertReady219Catalog,home219FunctionNames} from './frankfurt-reference219.mjs';
import {aclEntries,compareManagedCatalog} from './managed-catalog-policy.mjs';
import {compareApplicationAcl} from './application-acl-verification.mjs';
import {migrationManifest,manifestDigest,canonicalLf,canonicalDefinitionLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql,realtime151Tables} from '../testing/realtime151-contract.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';
import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
import {extractSqlFunction} from '../testing/build-home219-read-sql.mjs';
import {owner220MigrationName} from '../testing/build-owner220-migration.mjs';

export const ready220Ceiling=220,ready220ReferenceName='local-reference-through220-ready.json';
export const changed220FunctionNames=Object.freeze(['phase6_financial_facts_before208_internal','_get_operational_business_report_v1','get_supplier_replacements_page_v1','submit_guest_customer_order_v2','create_customer_order_base_units_legacy','package_d_create_customer_order_before_source_guard_internal']);
const body=definition=>definition.match(/AS (\$[a-zA-Z0-9_]*\$)([\s\S]*)\1/u)?.[2]??'';
const sql220=()=>canonicalLf(readFileSync(new URL('../../supabase/migrations/'+owner220MigrationName,import.meta.url),'utf8'));
const sql219=()=>canonicalLf(readFileSync(new URL('../../supabase/migrations/219_home_financial_facts_narrow_projection.sql',import.meta.url),'utf8'));
export function assertReady220Catalog(catalog){
 assertReady217Catalog(catalog);
 const source=sql220();
 for(const name of [...changed220FunctionNames,...home219FunctionNames.filter(n=>n!=='phase6_financial_facts_before208_internal')]){
  const rows=catalog.functions.filter(f=>f.schema==='public'&&f.identity.startsWith(name+'('));assert.equal(rows.length,1,'OWNER220_EXACT_FUNCTION_REQUIRED:'+name);
  const f=rows[0];assert.equal(f.owner,'postgres');assert.match(f.definition,/SECURITY DEFINER/u);assert.deepEqual(f.configuration,['search_path=public, pg_temp']);
  assert.equal(canonicalDefinitionLf(body(f.definition)),canonicalDefinitionLf(body(extractSqlFunction(changed220FunctionNames.includes(name)?source:sql219(),name))),'OWNER220_EXACT_REVIEWED_FUNCTION_BODY:'+name);
  if(home219FunctionNames.includes(name)||name.endsWith('_internal')||name==='create_customer_order_base_units_legacy')assert.deepEqual(aclEntries(f.acl,f,'functions').filter(a=>a.grantee!=='postgres'),[],'OWNER220_PRIVATE_FUNCTION_ACL');
 }
 const configured=catalog.functions.filter(f=>f.schema==='public'&&f.identity.startsWith('_get_operational_business_report_before_phase6('));assert.equal(configured.length,1);assert.equal(configured[0].owner,'postgres');assert.deepEqual(configured[0].configuration,['search_path=public, pg_temp','work_mem=8MB']);
 const indexes=catalog.indexes.filter(i=>i.schema==='public'&&i.name==='idx_supplier_receipt_items_receipt220');assert.equal(indexes.length,1);const index=indexes[0];assert.equal(index.owner,'postgres');assert.equal(index.table,'supplier_receipt_items');assert.equal(index.valid,true);assert.equal(index.ready,true);assert.equal(index.unique,false);assert.equal(index.definition,'CREATE INDEX idx_supplier_receipt_items_receipt220 ON public.supplier_receipt_items USING btree (supplier_receipt_id)');
 for(const table of ['supplier_receipts','supplier_receipt_items']){const rows=catalog.policies.filter(p=>p.schema==='public'&&p.table===table&&p.name==='Allow authenticated users to select '+table.replaceAll('_',' '));assert.equal(rows.length,1,'OWNER220_EXACT_EXISTING_POLICY_REQUIRED');assert.match(rows[0].using,/SELECT auth\.uid\(\) AS uid/u);}
 return catalog;
}
export function assertReady220Reference(reference,manifest,proofText,source){
 assert.equal(reference.format,30);assert.equal(reference.migrationCeiling,220);assert.equal(manifest.length,181);assert.equal(manifest.at(-1).name,owner220MigrationName);assert.ok(!manifest.some(m=>m.name.startsWith('218_')),'OWNER220_218_REMAINS_RESERVED');
 assert.deepEqual(reference.manifest,manifest);assert.equal(reference.manifestDigest,manifestDigest(manifest));assert.deepEqual(reference.appliedVersions,manifest.map(m=>m.name.slice(0,3)));
 assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql));assert.equal(reference.catalogSha256,sha256(JSON.stringify(reference.catalog)));assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql));assert.equal(reference.realtimeSha256,sha256(JSON.stringify(reference.realtimePublication)));
 assert.deepEqual(reference.realtimePublication.tables.map(t=>t.schema+'.'+t.name).sort(),realtime151Tables.map(t=>'public.'+t).sort());assert.equal(reference.realtimePublication.publication.owner,'postgres');assert.equal(reference.realtimePublication.publication.allTables,false);
 assert.deepEqual(Object.keys(reference.prefixes),['219','220']);for(const version of ['219','220']){const prefix=reference.prefixes[version];assert.equal(prefix.catalogSha256,sha256(JSON.stringify(prefix.catalog)));assert.deepEqual(prefix.appliedVersions,manifest.filter(m=>Number(m.name.slice(0,3))<=Number(version)).map(m=>m.name.slice(0,3)));assert.deepEqual(prefix.realtimePublication,reference.realtimePublication);}
 assertReady219Catalog(reference.prefixes['219'].catalog);assertReady220Catalog(reference.catalog);assert.deepEqual(reference.prefixes['220'].catalog,reference.catalog);assert.equal(compareApplicationAcl(reference.prefixes['219'].catalog,reference.catalog).ok,true,'OWNER220_APPLICATION_ACL_CHANGED');assert.equal(reference.freshIncrementalDifferenceCount,0);
 const proof=JSON.parse(proofText);assert.equal(proof.migrationCeiling,220);assert.equal(proof.managedAccess,false);assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.deepEqual(proof.sourceHashes,source.sources);assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results));assert.ok(proof.results.every(r=>r.sqlstate===null));assert.deepEqual(proof.manifest,manifest.map(m=>m.name));
 const compared=compareManagedCatalog(proof.catalog,reference.catalog,{beforeBuildDate:proof.startedAt.slice(0,10),afterBuildDate:reference.buildUtcDate});assert.deepEqual(compared.unexpected,[]);assert.deepEqual(compared.expected,[]);
 assert.deepEqual(reference.readiness,{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),coverage:proof.coverage,queries:proof.results.length,errors:0});assert.equal(reference.functions,636);return reference;
}
export async function readReady220Reference(root,filename){return assertReady220Reference(JSON.parse(await readFile(filename,'utf8')),await migrationManifest(root),await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_220.json'),'utf8'),await inventory());}
