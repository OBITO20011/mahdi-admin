// Admission of an actually rebuilt151 reference. No managed/network I/O.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {canonicalLf,sha256,migrationManifest,manifestDigest} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql,realtime151Tables,verify151Publication} from '../testing/realtime151-contract.mjs';
import {assertReadiness150} from './frankfurt-reference150.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';
export const readyReference151Name='local-reference-001-139-150-151-ready.json';
export function assertReference151(reference,manifest,proofText,source){
 assert.equal(reference.format,4,'READY151_REFERENCE_REQUIRED');
 assert.equal(reference.migrationCeiling,151,'READY151_REFERENCE_REQUIRED');
 assert.equal(manifest.at(-1)?.name,'151_explicit_application_realtime_publication.sql','APPROVED151_MANIFEST_REQUIRED');
 assert.deepEqual(reference.manifest,manifest,'READY151_MANIFEST_MISMATCH');
 assert.equal(reference.manifestDigest,manifestDigest(manifest),'READY151_DIGEST_MISMATCH');
 assert.deepEqual(reference.appliedVersions,manifest.map(m=>m.name.slice(0,3)),'READY151_HISTORY_MISMATCH');
 assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql),'READY151_CATALOG_QUERY_MISMATCH');
 assert.equal(reference.catalogSha256,sha256(JSON.stringify(reference.catalog)),'READY151_CATALOG_DIGEST_MISMATCH');
 assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql),'READY151_REALTIME_QUERY_MISMATCH');
 assert.equal(reference.realtimeSha256,sha256(JSON.stringify(reference.realtimePublication)),'READY151_REALTIME_DIGEST_MISMATCH');
 const publication=reference.realtimePublication;
 assert.equal(publication.publication?.owner,'postgres','READY151_PUBLICATION_OWNER');
 assert.deepEqual(publication.tables.map(t=>t.schema+'.'+t.name),realtime151Tables.map(t=>'public.'+t),'READY151_EXACT_MEMBERSHIP');
 verify151Publication({...publication,tables:[]},publication);
 for(const member of publication.tables){
  const table=reference.catalog.tables.find(t=>t.schema===member.schema&&t.name===member.name);
  assert.ok(table,'READY151_PUBLICATION_TABLE_REQUIRED');
  assert.deepEqual(member.columns,table.columns.map(c=>c.name),'READY151_ALL_COLUMNS_REQUIRED');
 }
 assertReadiness150(reference,manifest.filter(m=>Number(m.name.slice(0,3))<=150),proofText,source);
 return reference;
}
export async function readReference151(root,filename){
 return assertReference151(JSON.parse(await readFile(filename,'utf8')),await migrationManifest(root),
  canonicalLf(await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_150.json'),'utf8')),await inventory());
}
