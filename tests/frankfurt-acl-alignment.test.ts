import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {generateAclPlan,alignmentTransaction,publicAclSnapshot} from '../scripts/operations/frankfurt-acl-plan.mjs';
import {compareManagedCatalog,assertManagedCatalog} from '../scripts/operations/managed-catalog-policy.mjs';
import {heldTrigger} from '../scripts/operations/frankfurt-notification-hold.mjs';
const sample=JSON.parse(readFileSync(new URL('./fixtures/frankfurt-acl-samples.json',import.meta.url),'utf8'));
const table=(remote=false)=>({name:sample.table.name,schema:'public',kind:'r',owner:'postgres',acl:remote?sample.table.remoteAcl:sample.table.localAcl});
const fn=(remote=false)=>({schema:'public',identity:sample.function.identity,kind:'f',owner:'postgres',configuration:sample.function.configuration,
 acl:remote?sample.function.remoteAcl:sample.function.localAcl,definition:remote?sample.function.remoteDefinition:sample.function.localDefinition});
const defaults=(remote=false)=>({schema:'public',role:'postgres',type:'f',acl:remote?sample.default.remoteAcl:sample.default.localAcl});

test('real saved CRLF and service_role samples normalize only the approved differences',()=>{
 const local={functions:[fn()]},remote={functions:[fn(true)]};
 assert.equal(compareManagedCatalog(local,remote).unexpected.length,0);
 for(const changed of [ {...fn(true),acl:[...fn(true).acl,'anon=X/postgres']},
  {...fn(true),owner:'anon'}, {...fn(true),configuration:['search_path=public']},
  {...fn(true),definition:fn(true).definition.replace('LANGUAGE plpgsql','LANGUAGE plpgsql\n SECURITY DEFINER')},
  {...fn(true),acl:[...fn(true).acl,'=X/postgres']},
  {...fn(true),acl:[...fn(true).acl,'other_role=X/postgres']}])
  assert.equal(compareManagedCatalog(local,{functions:[changed]}).unexpected.length,1);
});

test('real table/default ACL samples generate exact revokes,never service_role or a broad ALL command',()=>{
 const local={tables:[table()],defaultPrivileges:[defaults()]},remote={tables:[table(true)],defaultPrivileges:[defaults(true)]};
 const p=generateAclPlan(local,remote);
 assert.equal(p.objectCount,2);assert.equal(p.commandCount,10);
 assert.ok(p.commands.includes('REVOKE SELECT ON TABLE "public"."audit_logs" FROM "anon";'));
 assert.ok(p.commands.includes('ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE EXECUTE ON FUNCTIONS FROM "anon";'));
 assert.ok(p.commands.every(c=>!c.includes('service_role')&&!c.includes('ALL')&&!c.includes('CASCADE')));
 assert.equal(compareManagedCatalog(local,p.predicted).unexpected.length,0);
 assert.deepEqual(publicAclSnapshot(remote)[p.objects[0].id].acl.filter(e=>e.grantee==='service_role'),publicAclSnapshot(p.predicted)[p.objects[0].id].acl.filter(e=>e.grantee==='service_role'));
 const sql=alignmentTransaction(p);
 assert.ok(sql.startsWith('BEGIN ISOLATION LEVEL SERIALIZABLE;'));
 assert.match(sql,/ACL_SNAPSHOT_CHANGED/u);assert.match(sql,/ACL_ALIGNMENT_POSTCONDITION_FAILED/u);
 assert.ok(sql.indexOf('ACL_SNAPSHOT_CHANGED')<sql.indexOf(p.commands[0]));assert.ok(sql.endsWith('COMMIT;'));
});

test('function execute drift is revoked;NULL ACL expands PostgreSQL defaults without retaining explicit anon',()=>{
 const f={...fn(),acl:null},remote={...fn(true),acl:['=X/postgres','postgres=X/postgres','anon=X/postgres','authenticated=X/postgres','service_role=X/postgres']};
 const p=generateAclPlan({functions:[f]},{functions:[remote]});
 assert.deepEqual(p.commands,['REVOKE EXECUTE ON FUNCTION "public".is_authenticated() FROM "anon";','REVOKE EXECUTE ON FUNCTION "public".is_authenticated() FROM "authenticated";']);
 assert.equal(compareManagedCatalog({functions:[f]},p.predicted).unexpected.length,0);
});

test('missing grants and grant-option differences generate narrow GRANT and downgrade commands',()=>{
 const local={tables:[{...table(),acl:['postgres=arwdDxtm/postgres','anon=r/postgres']}]};
 const p=generateAclPlan(local,{tables:[{...table(),acl:['postgres=arwdDxtm/postgres']}]});
 assert.deepEqual(p.commands,['GRANT SELECT ON TABLE "public"."audit_logs" TO "anon";']);
 const down=generateAclPlan(local,{tables:[{...table(),acl:['postgres=arwdDxtm/postgres','anon=r*/postgres']}]});
 assert.deepEqual(down.commands,['REVOKE GRANT OPTION FOR SELECT ON TABLE "public"."audit_logs" FROM "anon";']);
});

test('owner,body,extra application objects and unsupported grantors fail rather than being aligned',()=>{
 const local={functions:[fn()]};
 for(const changed of [{...fn(true),owner:'supabase_admin'}, {...fn(true),definition:'SELECT 42'},
  {...fn(true),acl:['postgres=X/postgres','authenticated=X/other_grantor']}])assert.throws(()=>generateAclPlan(local,{functions:[changed]}));
 assert.throws(()=>generateAclPlan(local,{functions:[fn(true)],tables:[table()]}),/NON_ACL_APPLICATION_DRIFT/u);
});

test('platform information is explicit;unknown/migration schemas and every RLS policy stay strict',()=>{
 assert.equal(compareManagedCatalog({tables:[]},{tables:[{schema:'auth',name:'platform_extra'}]}).platform.length,1);
 assert.equal(compareManagedCatalog({tables:[]},{tables:[{schema:'phase5_private',name:'unexpected'}]}).unexpected.length,1);
 assert.equal(compareManagedCatalog({policies:[]},{policies:[{schema:'storage',table:'objects',name:'unexpected',using:'true'}]}).unexpected.length,1);
 assert.equal(compareManagedCatalog({tables:[{schema:'storage',name:'objects',rls:true}]},{tables:[{schema:'storage',name:'objects',rls:false}]}).unexpected.length,1);
});

test('hold acceptance names the exact disabled trigger and requires the pg_net signature',()=>{
 const api={schema:'net',identity:'http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer)',definition:'RETURNS bigint'};
 const trigger={schema:'public',table:'orders',name:heldTrigger,enabled:'O',definition:'original'};
 const local={triggers:[trigger],functions:[api]},remote={triggers:[{...trigger,enabled:'D'}],functions:[api]};
 assert.equal(assertManagedCatalog(local,remote).name,heldTrigger);
 assert.throws(()=>assertManagedCatalog(local,{...remote,functions:[]}),/NET_HTTP_POST_SIGNATURE_REQUIRED/u);
 assert.throws(()=>assertManagedCatalog(local,{...remote,triggers:[{...trigger,enabled:'O'}]}),/NAMED_NOTIFICATION_TRIGGER_HOLD_REQUIRED/u);
 assert.throws(()=>assertManagedCatalog(local,{...remote,triggers:[{...trigger,enabled:'D',definition:'changed'}]}));
});

test('owner-only alignment defaults to offline preview,confirms fixed target before hidden password and has no link/repair',()=>{
 const source=readFileSync(new URL('../scripts/operations/frankfurt-align-acl.mjs',import.meta.url),'utf8');
 assert.ok(source.indexOf("if(!args.includes('--apply'))")<source.indexOf('PGPASSWORD:await password()'));
 assert.ok(source.indexOf('OWNER_CONFIRMATION_REQUIRED')<source.indexOf('PGPASSWORD:await password()'));
 assert.match(source,/SecureString/u);assert.match(source,/ReadKey\(\$true\)/u);assert.match(source,/ZeroFreeBSTR/u);
 assert.match(source,/delete env.PGPASSWORD/u);assert.match(source,/ACL_PREVIEW_STALE/u);assert.match(source,/SERVICE_ROLE_ACL_CHANGED/u);
 assert.match(source,/ACL_TRANSACTION_NOT_CONFIRMED/u);assert.doesNotMatch(source,/ACL_TRANSACTION_ROLLED_BACK/u);
 assert.doesNotMatch(source,/migration.*repair|cliCall\(|--db-url|--password|supabase.*link/u);
});
