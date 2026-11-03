// Owner2Nov exception: representation only,exactly these two local sequences.
// Never imported by default Restore,owner tools or the reset engine.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assertActiveRehearsal219,rolesSql,membershipSql} from '../backup/complete-backup.mjs';
import {rehearsal219Executor} from './rehearsal219-local.mjs';
import {schemaCatalogSql} from './schema-catalog.mjs';
import {aclEntries} from '../operations/managed-catalog-policy.mjs';
import {publicFingerprint} from '../operations/reset214-write-guard.mjs';
export const sequenceOwnerNames219=Object.freeze(['deferred_cheque_number_seq','inventory_movement_mutation_seq']);
const ownerAcl=['postgres=rwU/postgres'];
export function sequenceOwnerRepresentationPlan219(source,observed){
 const changes=[];
 for(const name of sequenceOwnerNames219){
  const select=c=>(c.tables??[]).filter(r=>r.schema==='public'&&r.name===name);
  const expected=select(source),actual=select(observed);
  assert.equal(expected.length,1,'REHEARSAL_SEQUENCE_SOURCE_REQUIRED');assert.equal(actual.length,1,'REHEARSAL_SEQUENCE_LOCAL_REQUIRED');
  const a=expected[0],b=actual[0];assert.equal(a.kind,'S');assert.equal(a.owner,'postgres');
  assert.deepEqual(a.acl,ownerAcl,'REHEARSAL_SEQUENCE_SOURCE_NOT_OWNER_ONLY');
  assert.deepEqual({...a,acl:null},{...b,acl:null},'REHEARSAL_SEQUENCE_NON_ACL_DRIFT');
  assert.ok(b.acl===null||JSON.stringify(b.acl)===JSON.stringify(ownerAcl),'REHEARSAL_SEQUENCE_LOCAL_ACL_UNEXPECTED');
  assert.deepEqual(aclEntries(a.acl,a,'tables'),aclEntries(b.acl,b,'tables'),'REHEARSAL_SEQUENCE_EFFECTIVE_RIGHTS_DIFFER');
  if(b.acl===null)changes.push(name);
 }
 return changes;
}
export async function matchRehearsalSequenceOwnerAcl219(context){
 assertActiveRehearsal219(context); // Reject arbitrary/expired targets before I/O.
 const executor=await rehearsal219Executor(context);
 const query=async input=>{const r=await executor.localExecute(input);assert.equal(r.code,0,'REHEARSAL_SEQUENCE_ACL_SQL_FAILED');return r.stdout.trim();};
 const capture=async()=>({catalog:JSON.parse(await query(schemaCatalogSql)),roles:JSON.parse(await query(rolesSql)),memberships:JSON.parse(await query(membershipSql)),data:await publicFingerprint(executor)});
 try{
  const sourceBytes=await readFile(path.resolve(context.storageDirectory,'../../database/source-evidence.json'));
  const source=JSON.parse(sourceBytes),before=await capture();
  assert.equal(await query("SELECT current_user='postgres' AND session_user='postgres' AND NOT rolsuper FROM pg_roles WHERE rolname=current_user;"),'t','REHEARSAL_SEQUENCE_POSTGRES_NOSUPERUSER_REQUIRED');
  const changes=sequenceOwnerRepresentationPlan219(source.catalog,before.catalog);
  // Names originate exclusively from the frozen two-name allowlist above.
  if(changes.length)await query('BEGIN;GRANT SELECT, UPDATE, USAGE ON SEQUENCE '+changes.map(n=>'public."'+n+'"').join(',')+' TO postgres;COMMIT;');
  const after=await capture(),expected=structuredClone(before);
  for(const name of sequenceOwnerNames219){
   const old=before.catalog.tables.find(r=>r.schema==='public'&&r.name===name),now=after.catalog.tables.find(r=>r.schema==='public'&&r.name===name);
   assert.deepEqual(aclEntries(old.acl,old,'tables'),aclEntries(now.acl,now,'tables'),'REHEARSAL_SEQUENCE_PRIVILEGES_INCREASED');
   assert.deepEqual(now.acl,ownerAcl,'REHEARSAL_SEQUENCE_EXPLICIT_SOURCE_NOT_MATCHED');
   expected.catalog.tables.find(r=>r.schema==='public'&&r.name===name).acl=[...ownerAcl];
  }
  assert.deepEqual(after,expected,'REHEARSAL_SEQUENCE_CHANGED_OTHER_CATALOG_ROLES_OR_DATA');
  return {sourceEvidenceSha256:createHash('sha256').update(sourceBytes).digest('hex'),archiveSha256:context.archiveSha256,
   objects:[...sequenceOwnerNames219],changedRepresentations:changes,owner:'postgres',sourceAcl:ownerAcl,effectiveRightsUnchanged:true,
   otherCatalogUnchanged:true,rolesMembershipsOwnersUnchanged:true,applicationDataUnchanged:true,network:'none',ownerApprovedException:'local-two-sequence-owner-representation-only'};
 }finally{await executor.closeLocal();}
}
