// Read-only snapshot of actual local212 grants and frozen source consumers.
import {assertLocal212,json,save,frozenSources} from './context.mjs';
import {serviceInventory} from '../../audit/service-access-inventory.mjs';
import {inventory} from '../../audit/table-access-inventory.mjs';
const state=await assertLocal212(),sources=await frozenSources();
const services=await serviceInventory(),tables=await inventory();
const functions=await json(`SELECT jsonb_agg(x ORDER BY signature) FROM (
 SELECT p.oid::regprocedure::text signature,p.proname name,pg_get_userbyid(p.proowner) owner,
 p.prosecdef security_definer,p.provolatile volatility,p.proconfig settings,
 md5(pg_get_functiondef(p.oid)) definition_md5,
 ARRAY(SELECT r FROM unnest(ARRAY['anon','authenticated','service_role']) r WHERE has_function_privilege(r,p.oid,'EXECUTE')) roles,
 (SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,'privilege',a.privilege_type,'grantable',a.is_grantable)) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a) acl
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f') x;`);
const relations=await json(`SELECT jsonb_agg(x ORDER BY name) FROM (
 SELECT c.relname name,c.relkind kind,c.relrowsecurity rls,c.relforcerowsecurity force_rls,pg_get_userbyid(c.relowner) owner,
 (SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,'privilege',a.privilege_type,'grantable',a.is_grantable)) FROM aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) a) acl,
 (SELECT jsonb_agg(jsonb_build_object('name',polname,'command',polcmd,'roles',polroles,'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid))) FROM pg_policy WHERE polrelid=c.oid) policies
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S')) x;`);
for(const f of functions){f.sourceConsumer=services.functionNames.includes(f.name);f.reviewRequired=f.roles.length>0&&!f.sourceConsumer;}
for(const r of relations){r.sourceConsumer=tables.totals.tableNames.includes(r.name);r.reviewRequired=!r.sourceConsumer&&(r.acl??[]).some(a=>['PUBLIC','anon','authenticated','service_role'].includes(a.grantee));}
const totals={functions:functions.length,exposed:functions.filter(f=>f.roles.length).length,noDirectRpcConsumer:functions.filter(f=>f.reviewRequired).length,relations:relations.length,noDirectTableConsumer:relations.filter(r=>r.reviewRequired).length};
await save('exposure',{state,sources,totals,functions,relations,services,tables,limitation:'No direct source consumer is not proof of dead code: triggers, policies and nested SQL calls need separate reachability review.'});
console.log(JSON.stringify(totals));

