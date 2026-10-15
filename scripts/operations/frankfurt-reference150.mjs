// Local reference admission only;no network,SQL writes,credential or repair.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {canonicalLf,sha256,migrationManifest,manifestDigest} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {aclEntries} from './managed-catalog-policy.mjs';
import {readTables150,removed150} from '../testing/table-read-privileges150-contract.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';
import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
import {validateOriginalNotifications} from './frankfurt-notification-hold.mjs';
import {generateAclPlan} from './frankfurt-acl-plan.mjs';
export const readyReferenceName='local-reference-001-139-150-ready.json';
export function assertReference150(reference,manifest,proofText,source){
 assert.equal(reference.format,3,'READY150_REFERENCE_REQUIRED');
 assert.equal(reference.migrationCeiling,150,'READY150_REFERENCE_REQUIRED');
 assert.equal(manifest.at(-1)?.name,'150_explicit_application_table_read_privileges.sql','APPROVED150_MANIFEST_REQUIRED');
 assert.deepEqual(reference.manifest,manifest,'READY150_MANIFEST_MISMATCH');
 assert.equal(reference.manifestDigest,manifestDigest(manifest),'READY150_DIGEST_MISMATCH');
 assert.deepEqual(reference.appliedVersions,manifest.map(m=>m.name.slice(0,3)),'READY150_HISTORY_MISMATCH');
 assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql),'READY150_CATALOG_QUERY_MISMATCH');
 assert.equal(reference.catalogSha256,sha256(JSON.stringify(reference.catalog)),'READY150_CATALOG_DIGEST_MISMATCH');
 return assertReadiness150(reference,manifest,proofText,source);
}
// Reused by151: its unchanged table/RPC read evidence is pinned to the actual
// <=150 manifest,not relabelled as a151 runtime audit.
export function assertReadiness150(reference,manifest,proofText,source){
 const proof=JSON.parse(proofText);
 assert.equal(proof.migrationCeiling,150,'READY150_ACCESS_PROOF_REQUIRED');
 assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);
 assert.deepEqual(proof.manifest,manifest.map(m=>m.name));
 assert.deepEqual(proof.sourceHashes,source.sources,'READY150_ACCESS_SOURCE_STALE');
 assert.ok(proof.results.every(r=>r.sqlstate===null),'READY150_QUERY_ERROR');
 const coverage=verifyProbeCoverage(source,proof.results);
 assert.deepEqual(proof.coverage,coverage);assert.deepEqual(reference.readiness.coverage,coverage);
 assert.equal(reference.readiness.accessEvidenceSha256,sha256(canonicalLf(proofText)),'READY150_ACCESS_DIGEST_MISMATCH');
 assert.deepEqual(reference.readiness.sourceHashes,source.sources,'READY150_REFERENCE_SOURCE_STALE');
 assert.equal(reference.readiness.queries,proof.results.length);assert.equal(reference.readiness.errors,0);
 for(const name of readTables150){
  const row=reference.catalog.tables.find(t=>t.schema==='public'&&t.name===name);
  assert.ok(row,'READY150_TABLE_REQUIRED:'+name);assert.equal(row.owner,'postgres');assert.equal(row.rls,true,'READY150_RLS_REQUIRED:'+name);
  const acl=aclEntries(row.acl,row,'tables');
  assert.ok(acl.some(a=>a.grantee==='authenticated'&&a.privilege==='SELECT'),'READY150_SELECT_REQUIRED:'+name);
  assert.ok(!acl.some(a=>['anon','authenticated'].includes(a.grantee)&&[...removed150,'INSERT','UPDATE','DELETE'].includes(a.privilege)),'READY150_EXCESS_CLIENT_PRIVILEGE:'+name);
  assert.ok(!acl.some(a=>a.grantee==='anon'&&a.privilege==='SELECT'),'READY150_ANON_READ:'+name);
  if(name==='orders')assert.ok(acl.some(a=>a.grantee==='service_role'&&a.privilege==='SELECT'),'READY150_SERVICE_ORDER_READ_REQUIRED');
 }
 const defaults=reference.catalog.defaultPrivileges.find(d=>d.schema==='public'&&d.role==='postgres'&&d.type==='r');
 assert.ok(defaults,'READY150_DEFAULTS_REQUIRED');
 assert.ok(!aclEntries(defaults.acl,defaults,'defaultPrivileges').some(a=>['anon','authenticated'].includes(a.grantee)),'READY150_DEFAULT_CLIENT_PRIVILEGES');
 assert.equal(reference.cronAudit.requiresOwnerReview,false);validateOriginalNotifications(reference.notificationSnapshot);
 return reference;
}
export async function readReference150(root,filename){
 const reference=JSON.parse(await readFile(filename,'utf8'));
 return assertReference150(reference,await migrationManifest(root),await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_150.json'),'utf8'),await inventory());
}
// Public CLI planning must pass full reference admission first. The low-level
// catalog planner remains available to historical diagnostic/rollback tests only.
export async function ready150Plan(root,filename,observed){
 const reference=await readReference150(root,filename);
 return {reference,plan:generateAclPlan(reference.catalog,observed,{offlinePending139:true})};
}
