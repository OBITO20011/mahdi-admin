// Owned disposable CLI stack only; never called by owner/Restore tools.
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {verifyReset224DdlCapability} from '../operations/reset224-ddl-capability.mjs';
import {startResetAttempt} from '../operations/reset224-session.mjs';
import {publicFingerprint} from '../operations/reset224-write-guard.mjs';
import {schemaCatalogSql} from './schema-catalog.mjs';
import {executeInput} from '../operations/build-empty-supabase.mjs';
const exec=promisify(execFile);
export async function proveReset224DdlCapability(local,output){
 assert.ok(['supabase_db_nawasrah-reset224-resume-test','supabase_db_nawasrah-inv224-reference-test'].includes(local.container),'DDL_PROOF_FIXED_DISPOSABLE_ONLY');
 const inspected=JSON.parse((await exec('docker',['inspect',local.container],{windowsHide:true})).stdout)[0];
 assert.equal(path.resolve(inspected.Config.Labels['com.supabase.cli.workdir']),path.resolve(local.local));
 assert.deepEqual(Object.keys(inspected.NetworkSettings.Networks),[],'DDL_PROOF_NETWORK_DETACHED');
 const sql=local.sql,executor=local.executor;
 const authoritySql="SELECT jsonb_build_object('actor',current_user,'super',(SELECT rolsuper FROM pg_roles WHERE rolname=current_user),'owner',(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='storage.objects'::regclass),'inherits',pg_has_role(current_user,(SELECT relowner FROM pg_class WHERE oid='storage.objects'::regclass),'USAGE'));";
 const before={authority:JSON.parse(await sql(authoritySql)),catalog:JSON.parse(await sql(schemaCatalogSql)),data:await publicFingerprint(executor)};
 assert.equal(before.authority.super,false);assert.equal(before.authority.inherits,false);assert.equal(before.authority.owner,'supabase_storage_admin');
 const original=await sql('SHOW supautils.policy_grants;');assert.ok(JSON.parse(original).postgres.includes('storage.objects'));
 const autoconfig=JSON.parse((await exec('docker',['exec',local.container,'psql','-U','supabase_admin','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1','-c',"SELECT coalesce(jsonb_agg(setting),'[]') FROM pg_file_settings WHERE name='supautils.policy_grants' AND sourcefile LIKE '%/postgresql.auto.conf';"],{windowsHide:true})).stdout.trim());
 assert.deepEqual(autoconfig,[],'DDL_PROOF_WILL_NOT_OVERWRITE_EXISTING_OVERRIDE');
 const fixture=async input=>exec('docker',['exec','-i',local.container,'psql','-U','supabase_admin','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1','-c',input],{windowsHide:true});
 const policy='BEGIN;CREATE POLICY reset224_disposable_probe ON storage.objects FOR SELECT TO authenticated USING(false);DROP POLICY reset224_disposable_probe ON storage.objects;ROLLBACK;';
 await verifyReset224DdlCapability(executor);
 assert.equal((await executeInput(executor,policy)).code,0,'DDL_PROOF_POSITIVE_POLICY_CREATE_DROP');
 try{
  // Change only the synthetic fixture's policy capability, not its roles/owners.
  await fixture("ALTER SYSTEM SET supautils.policy_grants = '{}';");await fixture('SELECT pg_reload_conf();');
  assert.equal(await sql('SHOW supautils.policy_grants;'),'{}');
  await assert.rejects(()=>verifyReset224DdlCapability(executor),/RESET224_DDL_CAPABILITY_REQUIRED/);
  const marker=path.join(output,'must-not-exist','RESET224_IN_PROGRESS.json');
  await assert.rejects(()=>startResetAttempt({reference:{migrationCeiling:224},markerPath:marker},executor),/RESET224_DDL_CAPABILITY_REQUIRED/);
  await assert.rejects(()=>access(marker));
  const denied=await executeInput(executor,policy);assert.notEqual(denied.code,0);assert.match(denied.stderr,/must be owner of table objects/u);
  assert.deepEqual({authority:JSON.parse(await sql(authoritySql)),catalog:JSON.parse(await sql(schemaCatalogSql)),data:await publicFingerprint(executor)},before,'DDL_PROOF_DENIAL_CHANGED_SOURCE');
 }finally{
  await fixture('ALTER SYSTEM RESET supautils.policy_grants;');await fixture('SELECT pg_reload_conf();');
 }
 assert.equal(await sql('SHOW supautils.policy_grants;'),original);
 await verifyReset224DdlCapability(executor);
 assert.deepEqual({authority:JSON.parse(await sql(authoritySql)),catalog:JSON.parse(await sql(schemaCatalogSql)),data:await publicFingerprint(executor)},before,'DDL_PROOF_POSITIVE_CHANGED_SOURCE');
 return {capablePassed:true,incapableRejected:true,policyCreateDropRolledBack:true,markerNotWritten:true,sourceFingerprintUnchanged:true,rolesAndOwnersUnchanged:true,configurationRestored:true};
}
