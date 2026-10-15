import assert from 'node:assert/strict';
import {aclEntries,compareManagedCatalog,normalizeManagedCatalog} from './managed-catalog-policy.mjs';
export const ident=s=>'"'+s.replaceAll('"','""')+'"';
export const literal=s=>"'"+s.replaceAll("'","''")+"'";
const role=s=>s==='PUBLIC'?'PUBLIC':ident(s);
const key=(section,row)=>JSON.stringify([section,row.identity??row.name??row.role,row.type]);
const entryKey=e=>JSON.stringify([e.grantee,e.grantor,e.privilege]);
export function publicAclSnapshot(catalog){
 /** @type {Record<string,{owner:string,acl:ReturnType<typeof aclEntries>}>} */
 const out={};
 for(const section of ['tables','functions','defaultPrivileges'])for(const row of catalog[section]??[]){
  if(row.schema!=='public')continue;
  if(section==='defaultPrivileges'&&row.role!=='postgres')continue;
  out[key(section,row)]={owner:row.owner??row.role,acl:aclEntries(row.acl,row,section)};
 }
 return out;
}
export function generateAclPlan(reference,observed){
 const expected=publicAclSnapshot(reference),actual=publicAclSnapshot(observed),commands=[],objects=[];
 const predicted=structuredClone(observed);
 for(const [id,wanted] of Object.entries(expected)){
  const current=actual[id];assert.ok(current,'ACL_OBJECT_MISSING:'+id);
  assert.equal(current.owner,wanted.owner,'ACL_OWNER_MISMATCH:'+id);
  const want=wanted.acl.filter(e=>e.grantee!=='service_role'),have=current.acl.filter(e=>e.grantee!=='service_role');
  if(JSON.stringify(want)===JSON.stringify(have))continue;
  const [section]=JSON.parse(id),row=reference[section].find(r=>r.schema==='public'&&key(section,r)===id);
  assert.ok(row);assert.equal(wanted.owner,'postgres','ONLY_POSTGRES_OWNED_ALIGNMENT');
  assert.ok([...want,...have].every(e=>e.grantor==='postgres'),'UNSUPPORTED_ACL_GRANTOR');
  let target,prefix='';
  if(section==='defaultPrivileges'){
   assert.ok(['r','S','f'].includes(row.type),'UNSUPPORTED_DEFAULT_PRIVILEGE_TYPE');
   prefix='ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" ';
   target=row.type==='r'?'TABLES':row.type==='S'?'SEQUENCES':'FUNCTIONS';
  }else if(section==='functions'){
   // Identity comes from PostgreSQL,never an arbitrary CLI argument.
   assert.match(row.identity,/^[a-z_][a-z0-9_]*\([^;]*\)$/u,'UNSAFE_FUNCTION_IDENTITY');
   target='FUNCTION "public".'+row.identity;
  }else{
   assert.ok(['r','p','S'].includes(row.kind),'UNSUPPORTED_RELATION_KIND');
   target=(row.kind==='S'?'SEQUENCE ':'TABLE ')+ident('public')+'.'+ident(row.name);
  }
  const add=new Map(want.map(e=>[entryKey(e),e])),old=new Map(have.map(e=>[entryKey(e),e]));
  for(const e of have){
   const desired=add.get(entryKey(e));
   if(!desired)commands.push(prefix+`REVOKE ${e.privilege} ON ${target} FROM ${role(e.grantee)};`);
   else if(e.grantable&&!desired.grantable)commands.push(prefix+`REVOKE GRANT OPTION FOR ${e.privilege} ON ${target} FROM ${role(e.grantee)};`);
  }
  for(const e of want){
   const prior=old.get(entryKey(e));
   if(!prior||(!prior.grantable&&e.grantable))commands.push(prefix+`GRANT ${e.privilege} ON ${target} TO ${role(e.grantee)}${e.grantable?' WITH GRANT OPTION':''};`);
  }
  const prediction=predicted[section].find(r=>r.schema==='public'&&key(section,r)===id);
  prediction.acl=toAcl([...want,...current.acl.filter(e=>e.grantee==='service_role')]);
  objects.push({id,section,row,before:current,after:{owner:current.owner,acl:aclEntries(prediction.acl,prediction,section)}});
 }
 // Reject missing/extra application objects or non-ACL changes,not just ACL drift.
 const aligned=compareManagedCatalog(reference,predicted);
 assert.equal(aligned.unexpected.length,0,'NON_ACL_APPLICATION_DRIFT');
 for(const o of objects)assert.deepEqual(o.before.acl.filter(e=>e.grantee==='service_role'),o.after.acl.filter(e=>e.grantee==='service_role'));
 assert.ok(commands.every(c=>!c.includes('"service_role"')),'SERVICE_ROLE_MUST_NOT_CHANGE');
 return {commands,objects,predicted,expected:normalizeManagedCatalog(reference),commandCount:commands.length,objectCount:objects.length};
}
function toAcl(entries){
 const codes={INSERT:'a',SELECT:'r',UPDATE:'w',DELETE:'d',TRUNCATE:'D',REFERENCES:'x',TRIGGER:'t',MAINTAIN:'m',USAGE:'U',EXECUTE:'X'};
 const groups=new Map();
 for(const e of entries){const k=JSON.stringify([e.grantee,e.grantor]);groups.set(k,(groups.get(k)??'')+codes[e.privilege]+(e.grantable?'*':''));}
 return [...groups].map(([k,privs])=>{const [grantee,grantor]=JSON.parse(k);return (grantee==='PUBLIC'?'':ident(grantee))+'='+privs+'/'+ident(grantor);});
}
// Actual ACL atoms,including service_role and owner,not nullable ACL storage.
function aclSql(expression){return `(SELECT COALESCE(jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY (CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) COLLATE "C",pg_get_userbyid(a.grantor) COLLATE "C",a.privilege_type COLLATE "C"),'[]'::jsonb) FROM aclexplode(${expression}) a)`;}
function snapshotSql(objects){
 return objects.length?`SELECT jsonb_object_agg(id,value) FROM (${objects.map(o=>{
  const id=literal(o.id),r=o.row;
  if(o.section==='defaultPrivileges')return `SELECT ${id} id,jsonb_build_object('owner','postgres','acl',${aclSql("COALESCE((SELECT defaclacl FROM pg_default_acl WHERE defaclrole='postgres'::regrole AND defaclnamespace='public'::regnamespace AND defaclobjtype="+literal(r.type)+"),'{}'::aclitem[])")}) value`;
  if(o.section==='functions')return `SELECT ${id} id,jsonb_build_object('owner',pg_get_userbyid(p.proowner),'acl',${aclSql("COALESCE(p.proacl,acldefault('f',p.proowner))")}) value FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'=${literal(r.identity)}`;
  return `SELECT ${id} id,jsonb_build_object('owner',pg_get_userbyid(c.relowner),'acl',${aclSql("COALESCE(c.relacl,acldefault("+literal(r.kind==='S'?'S':'r')+",c.relowner))")}) value FROM pg_class c WHERE c.oid=${literal('public.'+ident(r.name))}::regclass`;
 }).join(' UNION ALL ')}) acl_rows`:`SELECT '{}'::jsonb`;
}
export function alignmentTransaction(plan){
 const before=Object.fromEntries(plan.objects.map(o=>[o.id,o.before])),after=Object.fromEntries(plan.objects.map(o=>[o.id,o.after]));
 const check=(snapshot,code)=>`DO $guard$ BEGIN IF (${snapshotSql(plan.objects)}) IS DISTINCT FROM ${literal(JSON.stringify(snapshot))}::jsonb THEN RAISE EXCEPTION '${code}';END IF;END $guard$;`;
 return `BEGIN ISOLATION LEVEL SERIALIZABLE;
DO $guard$ BEGIN IF current_user<>'postgres' OR NOT pg_try_advisory_xact_lock(734034138) THEN RAISE EXCEPTION 'ACL_OWNER_OR_LOCK_REQUIRED';END IF;END $guard$;
${check(before,'ACL_SNAPSHOT_CHANGED')}
${plan.commands.join('\n')}
${check(after,'ACL_ALIGNMENT_POSTCONDITION_FAILED')}
COMMIT;`;
}
