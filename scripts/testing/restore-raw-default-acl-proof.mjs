import assert from 'node:assert/strict';
import {captureEvidence,assertRestoreEvidence,backupSourceEvidenceSha256} from '../backup/complete-backup.mjs';
import {restoreRawDefaultAcl} from '../backup/restore-raw-default-acl.mjs';

// Only the existing disposable CI database may call this proof. The fixed
// schema must not exist beforehand. No owner/rehearsal target is accepted.
export async function proveRawDefaultAclRestore(session){
 const schema='restore_raw_acl_test';
 assert.equal((await session.query("SELECT to_regnamespace('restore_raw_acl_test') IS NULL;")).trim(),'t','RAW_ACL_PROOF_SCHEMA_ALREADY_EXISTS');
 const read=async()=>{
  await session.query('BEGIN READ ONLY;');
  try{
   const evidence=await captureEvidence(session,{includeTypeAcls:true});
   const prior=await captureEvidence(session);
   assert.equal(Object.hasOwn(prior,'typeAcls'),false,'UPGRADE_EVIDENCE_SHAPE_CHANGED');
   assert.equal(backupSourceEvidenceSha256(evidence),backupSourceEvidenceSha256(prior),'UPGRADE_EVIDENCE_DIGEST_CHANGED');
   return evidence;
  }finally{await session.query('ROLLBACK;');}
 };
 const original=await read();let created=false,stage='create native fixture',primaryError;
 const create=`SET ROLE postgres;
 CREATE SCHEMA restore_raw_acl_test;
 CREATE TABLE restore_raw_acl_test.t(value INTEGER);
 CREATE SEQUENCE restore_raw_acl_test.s;
 CREATE VIEW restore_raw_acl_test.v AS SELECT value FROM restore_raw_acl_test.t;
 CREATE FUNCTION restore_raw_acl_test.f() RETURNS INTEGER LANGUAGE SQL STABLE AS 'SELECT 1';
 CREATE TYPE restore_raw_acl_test.flavor AS ENUM('test');RESET ROLE;`;
 try{
  await session.query(create);created=true;
  await session.query(`SET ROLE postgres;
   GRANT ALL PRIVILEGES ON SCHEMA restore_raw_acl_test TO postgres;
   GRANT ALL PRIVILEGES ON TABLE restore_raw_acl_test.t,restore_raw_acl_test.v TO postgres;
   GRANT ALL PRIVILEGES ON SEQUENCE restore_raw_acl_test.s TO postgres;
   GRANT ALL PRIVILEGES ON FUNCTION restore_raw_acl_test.f() TO postgres;
   GRANT ALL PRIVILEGES ON TYPE restore_raw_acl_test.flavor TO postgres;RESET ROLE;`);
  stage='capture explicit native defaults';const source=await read();
  assert.ok(source.typeAcls.some(row=>row.schema===schema&&row.name==='flavor'&&row.acl!==null),'NEW_TYPE_RAW_ACL_SNAPSHOT_REQUIRED');
  await session.query('DROP SCHEMA restore_raw_acl_test CASCADE;');created=false;
  await session.query(create);created=true;
  stage='capture recreated NULL defaults';const restored=await read();
  assert.equal(restored.catalog.tables.find(row=>row.schema===schema&&row.name==='t').acl,null,'RECREATED_TABLE_MUST_HAVE_NULL_RAW_ACL');
  for(const scenario of ['extra-grant','wrong-owner','missing-object']){
   stage='negative '+scenario;
   const bad=structuredClone(source),row=bad.catalog.tables.find(row=>row.schema===schema&&row.name==='t');
   if(scenario==='extra-grant')row.acl.push('anon=r/postgres');
   if(scenario==='wrong-owner')row.owner='supabase_admin';
   if(scenario==='missing-object')row.name='does_not_exist';
   await assert.rejects(restoreRawDefaultAcl(session,bad),/RESTORE_RAW_ACL_(?:UNAPPROVED_DIFFERENCE|OWNER_MISMATCH|OBJECT_MISSING)/u);
   assert.deepEqual(await read(),restored,'REJECTED_RAW_ACL_MUST_NOT_WRITE:'+scenario);
  }
  stage='replay six native defaults';const repaired=await restoreRawDefaultAcl(session,source);
  assert.equal(repaired.repaired,6,'SIX_NATIVE_DEFAULT_REPRESENTATIONS_REQUIRED');
  assert.deepEqual(repaired.repairedByKind,{table:1,sequence:1,view:1,schema:1,function:1,type:1},'SIX_NATIVE_DEFAULT_KINDS_REQUIRED');
  stage='strict Restore comparison';
  const after=await read();
  assertRestoreEvidence(source,after);
  stage='idempotent replay';assert.equal((await restoreRawDefaultAcl(session,source)).writeStatements,0,'REPEATED_RAW_ACL_REPAIR_MUST_NOT_WRITE');
  assert.deepEqual(await read(),after,'REPEATED_RAW_ACL_REPAIR_CHANGED_SOURCE');
  return {ok:true,repaired:repaired.repaired,repairedByKind:repaired.repairedByKind,
   typeSnapshot:true,threeNegativeCases:true,repeatedWriteStatements:0,strictRestoreComparison:true};
 }catch(error){primaryError=error;error.proofStage=stage;throw error;}
 finally{
  await session.query('RESET ROLE;ROLLBACK;');
  if(created)await session.query('DROP SCHEMA restore_raw_acl_test CASCADE;');
  const afterCleanup=await read();
  if(!primaryError)assert.deepEqual(afterCleanup,original,'RAW_ACL_PROOF_CHANGED_ORIGINAL_DATABASE');
 }
}
