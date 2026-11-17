// Restore-only representation repair. Never normalize NULL in a catalog guard.
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {classifiedError} from './postgres-diagnostic.mjs';

const qi=value=>'"'+String(value).replaceAll('"','""')+'"';
const key=row=>JSON.stringify([row.family,row.schema,row.name]);
const atoms=acl=>{
 assert.ok(acl===null||Array.isArray(acl)&&acl.every(value=>typeof value==='string'),'RESTORE_RAW_ACL_INVALID');
 return acl===null?null:[...acl].sort();
};
const equalAcl=(a,b)=>isDeepStrictEqual(atoms(a),atoms(b));
function fail(code,row){
 const name=row.family==='schema'?row.name:row.name.split('(')[0];
 const error=classifiedError(code,{
  tool:'internal',stage:'restore-raw-default-acl',
  toc:{type:row.family==='defaultPrivilege'?'DEFAULT ACL':'ACL',schema:row.schema||null,name},
 });
 throw Object.assign(error,{code});
}

// Additive evidence outside schemaCatalogSql: historical references/guards stay
// byte-identical. Old archives explicitly report that this field was not captured.
export const typeAclSql=`SELECT coalesce(jsonb_agg(jsonb_build_object(
 'schema',n.nspname,'name',t.typname,'kind',t.typtype,
 'owner',pg_get_userbyid(t.typowner),'acl',t.typacl)
 ORDER BY n.nspname,t.typname),'[]'::jsonb)
 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
 WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema';`;
export const captureTypeAcls=async session=>JSON.parse((await session.query(typeAclSql)).trim());

// Native acldefault, native owner and quoted SQL identities come from THIS
// isolated restored server. No archived string is executed as SQL.
export const defaultAclSql=`WITH namespaces AS (
 SELECT oid,nspname,nspowner FROM pg_namespace
 WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema'
), rows AS (
 SELECT 'relation'::text AS family,n.nspname::text AS schema,c.relname::text AS name,
 c.relkind::text AS kind,pg_get_userbyid(c.relowner) AS owner,
 acldefault(CASE WHEN c.relkind='S' THEN 's' ELSE 'r' END::"char",c.relowner) AS acl,
 CASE WHEN c.relkind='S' THEN 'SEQUENCE ' ELSE 'TABLE ' END||format('%I.%I',n.nspname,c.relname) AS target
 FROM pg_class c JOIN namespaces n ON n.oid=c.relnamespace WHERE c.relkind IN('r','p','v','m','f','S')
 UNION ALL SELECT 'schema','',n.nspname,'n',pg_get_userbyid(n.nspowner),acldefault('n',n.nspowner),'SCHEMA '||quote_ident(n.nspname) FROM namespaces n
 UNION ALL SELECT 'function',n.nspname,p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',p.prokind::text,
 pg_get_userbyid(p.proowner),acldefault('f',p.proowner),
 CASE WHEN p.prokind='p' THEN 'PROCEDURE ' ELSE 'FUNCTION ' END||format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))
 FROM pg_proc p JOIN namespaces n ON n.oid=p.pronamespace WHERE p.prokind IN('f','w','p')
 UNION ALL SELECT 'type',n.nspname,t.typname,t.typtype::text,pg_get_userbyid(t.typowner),acldefault('T',t.typowner),'TYPE '||format('%I.%I',n.nspname,t.typname)
 FROM pg_type t JOIN namespaces n ON n.oid=t.typnamespace
) SELECT coalesce(jsonb_agg(to_jsonb(rows) ORDER BY family,schema,name),'[]'::jsonb) FROM rows;`;

export function rawAclRows(evidence){
 const catalog=evidence.catalog;
 assert.ok(catalog&&Array.isArray(catalog.tables)&&Array.isArray(catalog.schemas)&&Array.isArray(catalog.functions),'RESTORE_RAW_ACL_CATALOG_REQUIRED');
 const rows=[];
 for(const row of catalog.tables){
  rows.push({family:'relation',schema:row.schema,name:row.name,kind:row.kind,owner:row.owner,acl:row.acl});
  for(const column of row.columns??[])rows.push({family:'column',schema:row.schema,name:JSON.stringify([row.name,column.name]),kind:'column',owner:row.owner,acl:column.acl});
 }
 for(const row of catalog.schemas)rows.push({family:'schema',schema:'',name:row.name,kind:'n',owner:row.owner,acl:row.acl});
 for(const row of catalog.functions)rows.push({family:'function',schema:row.schema,name:row.identity,kind:row.kind,owner:row.owner,acl:row.acl});
 for(const row of catalog.defaultPrivileges??[])rows.push({family:'defaultPrivilege',schema:row.schema,name:JSON.stringify([row.role,row.type]),kind:row.type,owner:row.role,acl:row.acl});
 if(Object.hasOwn(evidence,'typeAcls')){
  assert.ok(Array.isArray(evidence.typeAcls),'RESTORE_RAW_TYPE_ACL_INVALID');
  for(const row of evidence.typeAcls)rows.push({family:'type',schema:row.schema,name:row.name,kind:row.kind,owner:row.owner,acl:row.acl});
 }
 for(const row of rows){assert.equal(typeof row.owner,'string');atoms(row.acl);}
 assert.equal(new Set(rows.map(key)).size,rows.length,'RESTORE_RAW_ACL_DUPLICATE_OBJECT');
 return rows;
}

export function planRawDefaultAcl(source,observed,defaults){
 const expected=rawAclRows(source),actual=new Map(rawAclRows(observed).map(row=>[key(row),row]));
 const native=new Map(defaults.map(row=>[key(row),row])),changes=[];
 assert.equal(native.size,defaults.length,'RESTORE_RAW_ACL_DUPLICATE_NATIVE_OBJECT');
 for(const row of expected){
  const current=actual.get(key(row));
  if(!current)fail('RESTORE_RAW_ACL_OBJECT_MISSING',row);
  actual.delete(key(row));
  if(row.owner!==current.owner)fail('RESTORE_RAW_ACL_OWNER_MISMATCH',row);
  if(row.kind!==current.kind)fail('RESTORE_RAW_ACL_KIND_MISMATCH',row);
  if(equalAcl(row.acl,current.acl))continue;
  const fallback=native.get(key(row));
  if(!fallback||row.acl===null||current.acl!==null||fallback.owner!==row.owner||fallback.kind!==row.kind||!equalAcl(row.acl,fallback.acl)){
   fail('RESTORE_RAW_ACL_UNAPPROVED_DIFFERENCE',row);
  }
  assert.ok(['relation','schema','function','type'].includes(row.family),'RESTORE_RAW_ACL_UNSUPPORTED_OBJECT');
  assert.equal(typeof fallback.target,'string','RESTORE_RAW_ACL_NATIVE_IDENTITY_REQUIRED');
  changes.push({...row,target:fallback.target});
 }
 if(actual.size)fail('RESTORE_RAW_ACL_OBJECT_EXTRA',actual.values().next().value);
 return {checked:expected.length,typeAclCoverage:Object.hasOwn(source,'typeAcls')?'captured':'not-captured-in-legacy-archive',changes};
}

function withoutAcl(evidence){
 const copy=structuredClone(evidence);
 for(const rows of Object.values(copy.catalog))if(Array.isArray(rows))for(const row of rows){
  if(Object.hasOwn(row,'acl'))delete row.acl;
  for(const column of row.columns??[])delete column.acl;
 }
 for(const row of copy.typeAcls??[])delete row.acl;
 return copy;
}

export async function restoreRawDefaultAcl(session,source){
 const includeTypes=Object.hasOwn(source,'typeAcls');
 const read=async()=>({catalog:JSON.parse((await session.query(schemaCatalogSql.replace(/^BEGIN READ ONLY;/u,'').replace(/ROLLBACK;\s*$/u,''))).trim()),
  ...(includeTypes?{typeAcls:await captureTypeAcls(session)}:{})});
 let transaction=false;
 try{
  await session.query('BEGIN;SET LOCAL search_path=public,pg_temp;');transaction=true;
  const actor=(await session.query('SELECT current_user;')).trim();
  const before=await read(),defaults=JSON.parse((await session.query(defaultAclSql)).trim());
  const plan=planRawDefaultAcl(source,before,defaults);
  const repairedByKind={};
  for(const row of plan.changes){
   // Native default rights only; no REVOKE, owner change, membership change or
   // pg_catalog update. SET LOCAL ROLE preserves the original grantor exactly.
   await session.query('SET LOCAL ROLE '+qi(row.owner)+';GRANT ALL PRIVILEGES ON '+row.target+' TO '+qi(row.owner)+';SET LOCAL ROLE '+qi(actor)+';');
   const kind=row.family==='relation'?(row.kind==='S'?'sequence':['v','m'].includes(row.kind)?'view':'table'):row.family;
   repairedByKind[kind]=(repairedByKind[kind]??0)+1;
  }
  const after=await read();
  assert.equal(planRawDefaultAcl(source,after,defaults).changes.length,0,'RESTORE_RAW_ACL_EXACT_POSTCONDITION');
  assert.deepEqual(withoutAcl(after),withoutAcl(before),'RESTORE_RAW_ACL_NON_ACL_CHANGED');
  await session.query(plan.changes.length?'COMMIT;':'ROLLBACK;');transaction=false;
  return {checked:plan.checked,repaired:plan.changes.length,repairedByKind,typeAclCoverage:plan.typeAclCoverage,
   rawAclAtomsExact:true,arrayOrderIgnored:true,nullDistinctFromExplicit:true,writeStatements:plan.changes.length,
   repairedObjects:plan.changes.map(({family,schema,name,kind})=>({family,schema,name,kind}))};
 }catch(error){
  if(transaction)await session.query('ROLLBACK;').catch(()=>{});
  throw error;
 }
}
