// Owner3Nov: local representation only,exactly30 source-owned public tables.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assertActiveRehearsal219,rolesSql,membershipSql} from '../backup/complete-backup.mjs';
import {rehearsal219Executor} from './rehearsal219-local.mjs';
import {schemaCatalogSql} from './schema-catalog.mjs';
import {aclEntries} from '../operations/managed-catalog-policy.mjs';
import {publicFingerprint} from '../operations/reset214-write-guard.mjs';
export const ownerTableNames219=Object.freeze([
 'aftercare215_exchange_results','aftercare215_exchanges','aftercare215_inspection_items','aftercare215_inspections','aftercare215_return_contexts','aftercare215_return_results',
 'aftercare_supplier_links','cheque_compensation_claims','cheque_party_keys','customer_collection_cheque_allocations','deferred_cheque_allocations','deferred_cheque_events','deferred_cheques',
 'guest_order_tracking_limits','owner_telegram_dispatch_settings','phase3_customer_cost_finalization_guards','phase3_customer_lifecycle_transition_guards',
 'phase42_return_settlement_evidence','phase42_return_settlement_guards','phase43_replacement_inventory_effects','phase43_replacement_issuance_guards','phase43_replacement_settlement_evidence',
 'pos216_initial_payments','pos_uncommitted_attempt_cancellations','supplier215_credits','supplier_cheque_claim_payments','supplier_cheque_claim_reversals',
 'supplier_replacement_cases','supplier_replacement_events','supplier_replacement_inventory_effects',
]);
const ownerAcl=['postgres=arwdDxtm/postgres'];
export function tableOwnerRepresentationPlan219(source,observed){
 const changes=[];
 for(const name of ownerTableNames219){
  const select=c=>(c.tables??[]).filter(r=>r.schema==='public'&&r.name===name),a=select(source),b=select(observed);
  assert.equal(a.length,1,'REHEARSAL_TABLE_SOURCE_REQUIRED');assert.equal(b.length,1,'REHEARSAL_TABLE_LOCAL_REQUIRED');
  assert.equal(a[0].kind,'r');assert.equal(a[0].owner,'postgres');assert.deepEqual(a[0].acl,ownerAcl,'REHEARSAL_TABLE_SOURCE_NOT_OWNER_ONLY');
  assert.deepEqual({...a[0],acl:null},{...b[0],acl:null},'REHEARSAL_TABLE_NON_ACL_DRIFT');
  assert.ok(b[0].acl===null||JSON.stringify(b[0].acl)===JSON.stringify(ownerAcl),'REHEARSAL_TABLE_LOCAL_ACL_UNEXPECTED');
  assert.deepEqual(aclEntries(a[0].acl,a[0],'tables'),aclEntries(b[0].acl,b[0],'tables'),'REHEARSAL_TABLE_EFFECTIVE_RIGHTS_DIFFER');
  if(b[0].acl===null)changes.push(name);
 }
 return changes;
}
export const ownerTablePrivilegesSql219="SELECT jsonb_agg(jsonb_build_array(r.rolname,c.relname,p.privilege,has_table_privilege(r.rolname::text,c.oid,p.privilege)) ORDER BY r.rolname,c.relname,p.privilege) FROM pg_roles r CROSS JOIN pg_class c CROSS JOIN (VALUES('INSERT'),('SELECT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(privilege) WHERE c.relnamespace='public'::regnamespace AND c.relname IN("+ownerTableNames219.map(n=>"'"+n+"'").join(',')+") AND c.relkind='r';";
export async function matchRehearsalTableOwnerAcl219(context){
 assertActiveRehearsal219(context);
 const executor=await rehearsal219Executor(context);
 const query=async input=>{const r=await executor.localExecute(input);assert.equal(r.code,0,'REHEARSAL_TABLE_ACL_SQL_FAILED');return r.stdout.trim();};
 const capture=async()=>({catalog:JSON.parse(await query(schemaCatalogSql)),roles:JSON.parse(await query(rolesSql)),memberships:JSON.parse(await query(membershipSql)),data:await publicFingerprint(executor)});
 try{
  const sourceBytes=await readFile(path.resolve(context.storageDirectory,'../../database/source-evidence.json')),source=JSON.parse(sourceBytes),before=await capture();
  assert.equal(await query("SELECT current_user='postgres' AND session_user='postgres' AND NOT rolsuper FROM pg_roles WHERE rolname=current_user;"),'t','REHEARSAL_TABLE_POSTGRES_NOSUPERUSER_REQUIRED');
  const changes=tableOwnerRepresentationPlan219(source.catalog,before.catalog),effectiveBefore=JSON.parse(await query(ownerTablePrivilegesSql219));
  if(changes.length)await query('BEGIN;GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE '+changes.map(n=>'public."'+n+'"').join(',')+' TO postgres;COMMIT;');
  const after=await capture(),expected=structuredClone(before),effectiveAfter=JSON.parse(await query(ownerTablePrivilegesSql219));
  assert.deepEqual(effectiveAfter,effectiveBefore,'REHEARSAL_TABLE_SQL_PRIVILEGES_CHANGED');
  for(const name of ownerTableNames219){
   const old=before.catalog.tables.find(r=>r.schema==='public'&&r.name===name),now=after.catalog.tables.find(r=>r.schema==='public'&&r.name===name);
   assert.deepEqual(aclEntries(old.acl,old,'tables'),aclEntries(now.acl,now,'tables'),'REHEARSAL_TABLE_PRIVILEGES_INCREASED');assert.deepEqual(now.acl,ownerAcl);
   expected.catalog.tables.find(r=>r.schema==='public'&&r.name===name).acl=[...ownerAcl];
  }
  assert.deepEqual(after,expected,'REHEARSAL_TABLE_CHANGED_OTHER_CATALOG_ROLES_OR_DATA');
  return {sourceEvidenceSha256:createHash('sha256').update(sourceBytes).digest('hex'),archiveSha256:context.archiveSha256,objects:[...ownerTableNames219],changedRepresentations:changes,
   owner:'postgres',sourceAcl:ownerAcl,effectiveRightsUnchanged:true,sqlPrivilegeChecks:effectiveBefore.length,allRolesAllEightPrivilegesUnchanged:true,
   otherCatalogUnchanged:true,rolesMembershipsOwnersUnchanged:true,applicationDataUnchanged:true,network:'none',ownerApprovedException:'local-thirty-table-owner-representation-only'};
 }finally{await executor.closeLocal();}
}
