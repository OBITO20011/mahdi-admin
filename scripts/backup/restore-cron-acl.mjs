// Exact replay of captured final privileges,not a comparison normalization.
// Only the two pg_cron-owned sequences exist outside normal dump ACL replay.
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {aclEntries} from '../operations/managed-catalog-policy.mjs';
import {classifiedError} from './postgres-diagnostic.mjs';

const names=['jobid_seq','runid_seq'];
const qi=value=>'"'+value.replaceAll('"','""')+'"';
const grantee=value=>value==='PUBLIC'?'PUBLIC':qi(value);
const privileges=new Set(['SELECT','UPDATE','USAGE']);
export const cronSequenceAclSql=`SELECT coalesce(jsonb_agg(jsonb_build_object(
 'schema',n.nspname,'name',c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl,
 'extension',e.extname,'extensionVersion',e.extversion,'extensionOwner',pg_get_userbyid(e.extowner),
 'extensionSchema',en.nspname) ORDER BY c.relname),'[]')
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=c.oid AND d.objsubid=0
 AND d.refclassid='pg_extension'::regclass AND d.deptype='e'
 LEFT JOIN pg_extension e ON e.oid=d.refobjid LEFT JOIN pg_namespace en ON en.oid=e.extnamespace
 WHERE n.nspname='cron' AND c.relname IN ('jobid_seq','runid_seq');`;

export function planCronSequenceAcl(before,actual){
 const extension=before.catalog.extensions?.find(e=>e.name==='pg_cron');
 if(!extension){assert.deepEqual(actual,[],'RESTORE_CRON_UNEXPECTED_OBJECTS');return [];}
 assert.equal(actual.length,2,'RESTORE_CRON_MEMBERS_REQUIRED');
 const plan=[];
 for(const name of names){
  const captured=before.catalog.tables?.filter(r=>r.schema==='cron'&&r.name===name)??[];
  assert.equal(captured.length,1,'RESTORE_CRON_CAPTURE_REQUIRED');
  const source=captured[0],restored=actual.filter(r=>r.name===name);
  assert.equal(restored.length,1,'RESTORE_CRON_MEMBER_REQUIRED');
  const target=restored[0];
  assert.equal(source.kind,'S','RESTORE_CRON_SEQUENCE_REQUIRED');
  assert.equal(source.owner,extension.owner,'RESTORE_CRON_OWNER_REQUIRED');
  assert.equal(target.schema,'cron','RESTORE_CRON_SCHEMA_REQUIRED');
  assert.equal(target.kind,'S','RESTORE_CRON_SEQUENCE_REQUIRED');
  assert.equal(target.owner,source.owner,'RESTORE_CRON_OWNER_REQUIRED');
  assert.equal(target.extension,'pg_cron','RESTORE_CRON_EXTENSION_MEMBERSHIP_REQUIRED');
  assert.equal(target.extensionVersion,extension.version,'RESTORE_CRON_EXTENSION_VERSION_REQUIRED');
  assert.equal(target.extensionOwner,extension.owner,'RESTORE_CRON_EXTENSION_OWNER_REQUIRED');
  assert.equal(target.extensionSchema,extension.schema,'RESTORE_CRON_EXTENSION_SCHEMA_REQUIRED');
  const expected=aclEntries(source.acl,source,'tables'),current=aclEntries(target.acl,target,'tables');
  // No guessed grant chains:unsupported grantors fail closed before any REVOKE.
  for(const entry of [...expected,...current]){
   assert.equal(entry.grantor,source.owner,'RESTORE_CRON_ACL_GRANTOR_UNSUPPORTED');
   assert.ok(privileges.has(entry.privilege),'RESTORE_CRON_ACL_PRIVILEGE_UNSUPPORTED');
   assert.ok(entry.grantee==='PUBLIC'||before.roles.some(r=>r.name===entry.grantee),'RESTORE_CRON_ACL_ROLE_REQUIRED');
  }
  if(isDeepStrictEqual(expected,current))continue;
  const object=`cron.${qi(name)}`;
  const sql=[`SET LOCAL ROLE ${qi(source.owner)};`];
  for(const role of new Set([...current,...expected].map(e=>e.grantee)))sql.push(`REVOKE ALL PRIVILEGES ON SEQUENCE ${object} FROM ${grantee(role)};`);
  for(const entry of expected)sql.push(`GRANT ${entry.privilege} ON SEQUENCE ${object} TO ${grantee(entry.grantee)}${entry.grantable?' WITH GRANT OPTION':''};`);
  plan.push({name,sql:sql.join('\n')});
 }
 return plan;
}

export async function restoreCronSequenceAcl(session,before){
 let transaction=false;
 try{
  const read=async()=>JSON.parse((await session.query(cronSequenceAclSql)).trim());
  // Validate BOTH objects,extension identity,owners,roles and grantors first.
  const plan=planCronSequenceAcl(before,await read());
  if(plan.length){
   await session.query('BEGIN;');transaction=true;
   await session.query(plan.map(p=>p.sql).join('\n'));
   assert.deepEqual(planCronSequenceAcl(before,await read()),[],'RESTORE_CRON_ACL_POSTCONDITION');
   await session.query('COMMIT;');transaction=false;
  }
  return {checked:before.catalog.extensions?.some(e=>e.name==='pg_cron')?2:0,
   reconciled:plan.map(p=>({schema:'cron',name:p.name,field:'acl',extension:'pg_cron'})),
   exactCapturedAcl:true,exceptionsApplied:[]};
 }catch{
  if(transaction)await session.query('ROLLBACK;').catch(()=>{});
  throw classifiedError('RESTORE_CRON_SEQUENCE_ACL_UNSUPPORTED',{stage:'restore-cron-sequence-acl',tool:'internal'});
 }
}
