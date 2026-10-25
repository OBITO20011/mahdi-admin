// Logical pg_dump/pg_restore contract ONLY. Never changes migration/managed
// catalog comparison. No object/schema/role is omitted;raw differences persist.
import assert from 'node:assert/strict';
import {aclEntries} from '../operations/managed-catalog-policy.mjs';
import {catalogDifference} from './schema-catalog.mjs';
import {executeInput} from '../operations/build-empty-supabase.mjs';
const qi=value=>'"'+value.replaceAll('"','""')+'"';

export function logicalRestoreCatalog(catalog){
 const copy=structuredClone(catalog);
 for(const [section,rows] of Object.entries(copy))for(const row of rows??[]){
  // NULL aclitem[] denotes the built-in default,not an omitted security check.
  // Expand EVERY grantee/grantor/option,including service_role and PUBLIC.
  if('acl' in row)row.acl=aclEntries(row.acl,row,section);
  let previous=0;
  for(const [index,column] of (row.columns??[]).entries()){
   assert.ok(Number.isInteger(column.number)&&column.number>previous,'RESTORE_COLUMN_ORDER');previous=column.number;
   column.number=index+1; // pg_dump compacts holes left by dropped columns.
   if('acl' in column)column.acl=aclEntries(column.acl??[],row,'columns');
  }
 }
 for(const constraint of copy.constraints??[]){
  const table=copy.tables?.find(t=>t.schema===constraint.schema&&t.name===constraint.table);
  // pg_dump reconstructs an inherited leaf PK/UNIQUE with connoinherit=true.
  // Its parent link,inheritanceCount,definition,index and validity stay strict.
  // CHECK/foreign keys and partitioned parents NEVER take this normalization.
  if(['p','u'].includes(constraint.type)&&constraint.local===false&&constraint.inheritanceCount>0
    &&table?.kind==='r'&&table.partition&&table.parents?.length)constraint.noInherit=null;
 }
 return copy;
}
export const logicalRestoreDifferences=(before,after)=>catalogDifference(logicalRestoreCatalog(before),logicalRestoreCatalog(after));

// pg_dump omits these platform post-init defaults/extension-member ALTERs.
// Restore exactly the captured source settings;do not ignore their differences.
export function platformPostInitSql(catalog){
 const sql=[];
 for(const name of ['graphql','graphql_public']){
  const schema=catalog.schemas.find(s=>s.name===name);assert.equal(schema?.owner,'supabase_admin','RESTORE_PLATFORM_SCHEMA_OWNER');
  for(const entry of aclEntries(schema.acl,schema,'schemas')){
   assert.equal(entry.grantor,'supabase_admin','RESTORE_PLATFORM_SCHEMA_GRANTOR');
   assert.ok(['USAGE','CREATE'].includes(entry.privilege),'RESTORE_SCHEMA_PRIVILEGE');
   const grantee=entry.grantee==='PUBLIC'?'PUBLIC':qi(entry.grantee);
   sql.push(`GRANT ${entry.privilege} ON SCHEMA ${qi(name)} TO ${grantee}${entry.grantable?' WITH GRANT OPTION':''};`);
  }
 }
 for(const [name,signature] of [['http_get','text,jsonb,jsonb,integer'],['http_post','text,jsonb,jsonb,jsonb,integer']]){
  const routines=catalog.functions.filter(f=>f.schema==='net'&&f.identity.startsWith(name+'('));assert.equal(routines.length,1);
  const routine=routines[0];assert.equal(routine.owner,'supabase_admin');
  // Managed Frankfurt and the CLI image have different post-init ALTERs.
  // Reproduce the captured setting exactly,never normalize the comparison away.
  assert.ok(routine.configuration===null||JSON.stringify(routine.configuration)===JSON.stringify(['search_path=net']),'RESTORE_NET_SOURCE_PATH_UNSUPPORTED');
  const security=/\n SECURITY DEFINER\n/u.test(routine.definition)?'DEFINER':'INVOKER';
  sql.push(`ALTER FUNCTION net.${name}(${signature}) SECURITY ${security};`);
  sql.push(`ALTER FUNCTION net.${name}(${signature}) RESET ALL;`);
  if(routine.configuration)sql.push(`ALTER FUNCTION net.${name}(${signature}) SET search_path TO net;`);
 }
 return sql.join('\n');
}

// Read-only data oracle:all public rows in canonical order plus all sequence
// positions,not just row counts. Never returns row contents or credentials.
export const applicationFingerprintSql=`BEGIN READ ONLY;
DO $fingerprint$ DECLARE r record;h text;tables jsonb='{}';sequences jsonb;BEGIN
 FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename LOOP
  EXECUTE format('SELECT md5(COALESCE(string_agg(to_jsonb(t)::text,E''\\n'' ORDER BY to_jsonb(t)::text COLLATE "C"),'''')) FROM public.%I t',r.tablename) INTO h;
  tables=tables||jsonb_build_object(r.tablename,h);
 END LOOP;
 SELECT COALESCE(jsonb_object_agg(sequencename,last_value ORDER BY sequencename),'{}') INTO sequences FROM pg_sequences WHERE schemaname='public';
 RAISE NOTICE 'APP_FINGERPRINT:%',jsonb_build_object('tables',tables,'sequences',sequences);
END $fingerprint$;ROLLBACK;`;
export async function readApplicationFingerprint(executor){
 const result=await executeInput(executor,applicationFingerprintSql);assert.equal(result.code,0,'RESTORE_FINGERPRINT_FAILED');
 const match=result.stderr.match(/APP_FINGERPRINT:(\{[^\r\n]+\})/u);assert.ok(match,'RESTORE_FINGERPRINT_MISSING');return JSON.parse(match[1]);
}
