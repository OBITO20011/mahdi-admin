// Explicit owned-rehearsal callback only. Never imported by owner/Restore tools.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assertActiveRehearsal219,rolesSql,membershipSql} from '../backup/complete-backup.mjs';
import {rehearsal219Executor} from './rehearsal219-local.mjs';
import {schemaCatalogSql} from './schema-catalog.mjs';
import {publicFingerprint} from '../operations/reset214-write-guard.mjs';
const exec=promisify(execFile),hash=b=>createHash('sha256').update(b).digest('hex');
export const supautilsNames219=Object.freeze(['constrained_extensions','disable_program','drop_trigger_grants','extension_custom_scripts_path',
 'extensions_parameter_overrides','hint_roles','log_skipped_evtrigs','placeholders','placeholders_disallowed_values','policy_grants',
 'privileged_extensions','privileged_extensions_custom_scripts_path','privileged_extensions_superuser','privileged_role',
 'privileged_role_allowed_configs','reserved_memberships','reserved_roles','restrict_extension_versions','superuser'].map(n=>'supautils.'+n));
export const supautilsSettingsSql219="SELECT jsonb_object_agg(name,setting ORDER BY name) FROM pg_settings WHERE name LIKE 'supautils.%' OR name IN('session_preload_libraries','shared_preload_libraries','local_preload_libraries');";
export function validateSupautilsSource219(evidence){
 assert.equal(evidence.complete,true,'REHEARSAL_COMPLETE_SUPAUTILS_SOURCE_REQUIRED');
 const settings=evidence.settings;assert.ok(settings&&typeof settings==='object');
 assert.deepEqual(Object.keys(settings).sort(),[...supautilsNames219,'session_preload_libraries','shared_preload_libraries','local_preload_libraries'].sort(),'REHEARSAL_SUPAUTILS_SOURCE_NAMES_DIFFER');
 for(const value of Object.values(settings))assert.ok(typeof value==='string'&&!/[\r\n\0]/u.test(value),'REHEARSAL_SUPAUTILS_SOURCE_STRING_REQUIRED');
 assert.equal(settings.session_preload_libraries,'supautils');assert.equal(settings.local_preload_libraries,'');
 assert.equal(settings['supautils.privileged_role'],'supabase_privileged_role');
 assert.equal(settings['supautils.superuser'],'supabase_admin');assert.equal(settings['supautils.privileged_extensions_superuser'],'supabase_admin');
 for(const name of ['policy_grants','drop_trigger_grants']){
  const grants=JSON.parse(settings['supautils.'+name]);assert.ok(Array.isArray(grants.postgres));assert.ok(grants.postgres.includes('storage.objects'));assert.ok(grants.postgres.includes('storage.buckets'));
 }
 return structuredClone(settings);
}
export function supautilsConf219(settings){
 // PostgreSQL config single-quoted strings,not shell or SQL interpolation.
 const quote=s=>"'"+s.replaceAll('\\','\\\\').replaceAll("'","''")+"'";
 // These unset library defaults appear as empty pg_settings strings but their
 // check hooks reject an explicit ''. Keep them unset;the full exact comparison
 // below MUST still observe the source empty value,no wildcard/default masking.
 return Object.entries(settings).filter(([n,v])=>n!=='shared_preload_libraries'&&!(n.startsWith('supautils.')&&v==='')).sort(([a],[b])=>a.localeCompare(b,'en')).map(([n,v])=>n+' = '+quote(v)).join('\n')+'\n';
}
export async function configureRehearsalSupautils219({context,evidenceFile,output}){
 assertActiveRehearsal219(context); // Before any disk/process action.
 const bytes=await readFile(evidenceFile),evidence=JSON.parse(bytes),settings=validateSupautilsSource219(evidence);
 const docker=async args=>{assertActiveRehearsal219(context);return exec('docker',args,{windowsHide:true,maxBuffer:8*1024**2});};
 let executor=await rehearsal219Executor(context);
 const query=async sql=>{const r=await executor.localExecute(sql);if(r.code!==0)throw new Error('REHEARSAL_SUPAUTILS_READ_FAILED',{cause:{exitCode:r.code,stderr:r.stderr}});return r.stdout.trim();};
 const capture=async()=>({catalog:JSON.parse(await query(schemaCatalogSql)),roles:JSON.parse(await query(rolesSql)),memberships:JSON.parse(await query(membershipSql)),data:await publicFingerprint(executor)});
 const before=await capture();
 const authoritySql="SELECT jsonb_build_object('user',current_user,'sessionUser',session_user,'superuser',(SELECT rolsuper FROM pg_roles WHERE rolname=current_user),'storageOwner',pg_get_userbyid(relowner),'inheritsStorageOwner',pg_has_role(current_user,relowner,'USAGE')) FROM pg_class WHERE oid='storage.objects'::regclass;";
 const authority=JSON.parse(await query(authoritySql));assert.equal(authority.user,'postgres');assert.equal(authority.sessionUser,'postgres');assert.equal(authority.superuser,false);assert.equal(authority.inheritsStorageOwner,false);
 assert.equal(await query("SHOW shared_preload_libraries;"),settings.shared_preload_libraries,'REHEARSAL_SOURCE_SHARED_PRELOAD_DIFFERS');
 const paths=[...new Set([settings['supautils.extension_custom_scripts_path'],settings['supautils.privileged_extensions_custom_scripts_path']])];
 const pathProof=[];
 for(const directory of paths){assert.equal(directory,'/etc/postgresql-custom/extension-custom-scripts','REHEARSAL_UNREVIEWED_SCRIPT_PATH');
  let exists=true;try{await docker(['exec',context.containerId,'test','-d',directory]);}catch{exists=false;}
  pathProof.push({path:directory,exists,contentCreated:false});assert.ok(exists,'REHEARSAL_SOURCE_CUSTOM_SCRIPT_PATH_MISSING');
 }
 const configPath=path.join(output,'rehearsal-supautils.conf'),containerPath='/tmp/pgdata/rehearsal-supautils.conf';
 const install=async values=>{
  await executor.closeLocal();
  await writeFile(configPath,supautilsConf219(values),{mode:0o600,flag:'wx'});
  try{await docker(['cp',configPath,context.containerId+':'+containerPath]);}
  finally{await unlink(configPath);}
  await docker(['exec',context.containerId,'chown','postgres:postgres',containerPath]);
  await docker(['exec','--user','postgres',context.containerId,'pg_ctl','-D','/tmp/pgdata','-m','fast','-w','restart']);
  executor=await rehearsal219Executor(context);
  assert.deepEqual(JSON.parse(await query(supautilsSettingsSql219)),values,'REHEARSAL_SUPAUTILS_SETTINGS_NOT_EXACT');
  assert.equal(await query('SHOW cron.launch_active_jobs;'),'off');
  assert.deepEqual(JSON.parse(await query(authoritySql)),authority,'REHEARSAL_ROLE_AUTHORITY_CHANGED');
 };
 try{
  // Constant include;only the private owned-container file changes thereafter.
  await docker(['exec','--user','postgres',context.containerId,'sh','-c',"printf \"%s\\n\" \"include = '/tmp/pgdata/rehearsal-supautils.conf'\" >> /tmp/pgdata/postgresql.conf"]);
  await install(settings);
  const policy="BEGIN;CREATE POLICY rehearsal_supautils_policy_probe ON storage.objects FOR SELECT TO authenticated USING(false);DROP POLICY rehearsal_supautils_policy_probe ON storage.objects;ROLLBACK;";
  assert.equal((await executor.localExecute(policy)).code,0,'REHEARSAL_SOURCE_POLICY_CAPABILITY_FAILED');
  const reduced={...settings,'supautils.policy_grants':'{}'};await install(reduced);
  const denied=await executor.localExecute(policy);assert.notEqual(denied.code,0,'REHEARSAL_POLICY_GRANTS_NEGATIVE_MUST_FAIL');
  assert.match(denied.stderr,/must be owner of table objects/u,'REHEARSAL_POLICY_GRANTS_NEGATIVE_REASON');
  await install(settings);
  assert.equal((await executor.localExecute(policy)).code,0,'REHEARSAL_SOURCE_POLICY_CAPABILITY_NOT_RESTORED');
  const after=await capture();assert.deepEqual(after,before,'REHEARSAL_SUPAUTILS_CHANGED_CATALOG_ROLES_OR_DATA');
  return {evidenceSha256:hash(bytes),capturedAt:evidence.capturedAt,settingsCount:Object.keys(settings).length,settingsExactlyMatched:true,
   settingsSha256:hash(JSON.stringify(settings)),emptySourceValuesVerified:supautilsNames219.filter(n=>settings[n]===''),authority,paths:pathProof,policyCreateDrop:true,negativePolicyGrantsOnlyRejected:true,negativeRolledBack:true,sourceSettingsRestored:true,
   rolesUnchanged:true,membershipsUnchanged:true,catalogAclOwnerUnchanged:true,applicationDataUnchanged:true,roleElevation:false,grantsApplied:0,ownershipChanges:0,network:'none'};
 }finally{await executor.closeLocal();}
}
