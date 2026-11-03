// Real PostgreSQL dependency tests;DDL is rolled back on the owned test clone.
// No mocked pg_depend rows,no extension/schema allowlist or relaxed assertion.
import assert from 'node:assert/strict';
import {externalDependentsSql,assertExternalDependents} from '../operations/trial-reset-core.mjs';
export const pgNetIdentitySql=`SELECT jsonb_build_object('name',e.extname,'version',e.extversion,
 'schema',n.nspname,'owner',pg_get_userbyid(e.extowner),'netSchema',to_regnamespace('net')::text,
 'httpFunctions',(SELECT jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner)) ORDER BY p.oid::regprocedure::text)
 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='net' AND p.proname IN('http_get','http_post','http_delete')))
 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_net';`;
export async function provePgNetRunnable219(executor){
 assert.equal(executor.localOnly,true,'PG_NET_PROBE_OWNED_LOCAL_ONLY');
 // pg_net consumes committed requests only. Rollback prevents even a local
 // worker request escaping this probe;the URL is loopback as a second guard.
 const r=await executor.localExecute("BEGIN;WITH request AS (SELECT net.http_post(url:='http://127.0.0.1:9/rehearsal-only',body:='{}'::jsonb,timeout_milliseconds:=1) AS id) SELECT (id>0)::text FROM request;ROLLBACK;",'');
 assert.equal(r.code,0,'PG_NET_HTTP_POST_NOT_EXECUTABLE');assert.equal(r.stdout.trim(),'true');
 return {httpPostExecutable:true,requestRolledBack:true,externalRequestsSent:0};
}
export async function proveReset219DependencyGuard(executor){
 assert.equal(executor.localOnly,true,'DEPENDENCY_PROBE_OWNED_LOCAL_CLONE_ONLY');
 const query=async sql=>{const r=await executor.localExecute(sql,'');assert.equal(r.code,0,'DEPENDENCY_PROBE_SQL_FAILED');return r.stdout.trim();};
 const json=async sql=>JSON.parse(await query(sql));
 const before=await json(pgNetIdentitySql);
 assert.equal(before.name,'pg_net');assert.equal(before.schema,'public');assert.equal(before.version,'0.20.4');assert.equal(before.owner,'supabase_admin');
 assert.equal(before.netSchema,'net');assert.equal(before.httpFunctions.length,3);
 const runnable=await provePgNetRunnable219(executor);
 const base=await json(externalDependentsSql);assertExternalDependents(base,219);
 assert.ok(!base.some(r=>r.class==='pg_extension'),'UNRELATED_EXTENSION_MUST_NOT_BE_DROP_DEPENDENT');
 const cases=[];
 const denied=async(name,fixture,expected)=>{
  const rows=await json('BEGIN;CREATE SCHEMA rehearsal_dependency_external;'+fixture+'\n'+externalDependentsSql+'\nROLLBACK;');
  assert.ok(expected(rows),'REAL_DEPENDENCY_MISSING:'+name);
  let dropReached=false;
  assert.throws(()=>{assertExternalDependents(rows,219);dropReached=true;},/UNREVIEWED_EXTERNAL_DROP_DEPENDENT/u);
  assert.equal(dropReached,false,'FORBIDDEN_DROP_MUST_NOT_START');cases.push({name,rejected:true,dropReached:false});
 };
 await denied('external-view-on-dropped-table',
  'CREATE TABLE public.rehearsal_dependency_root(id integer);CREATE VIEW rehearsal_dependency_external.rehearsal_external_view AS SELECT id FROM public.rehearsal_dependency_root;',
  rows=>rows.some(r=>r.schema==='rehearsal_dependency_external'&&r.description.includes('rehearsal_external_view')));
 await denied('external-function-on-dropped-function',
  'CREATE FUNCTION public.rehearsal_dependency_function() RETURNS integer LANGUAGE sql RETURN 1;CREATE FUNCTION rehearsal_dependency_external.rehearsal_external_function() RETURNS integer LANGUAGE sql BEGIN ATOMIC SELECT public.rehearsal_dependency_function();END;',
  rows=>rows.some(r=>r.schema==='rehearsal_dependency_external'&&r.description.includes('rehearsal_external_function')));
 await denied('external-extension-member-depends-on-drop-target',
  'CREATE TABLE public.rehearsal_dependency_root(id integer);CREATE EXTENSION hstore WITH SCHEMA rehearsal_dependency_external;CREATE VIEW rehearsal_dependency_external.rehearsal_extension_view AS SELECT id FROM public.rehearsal_dependency_root;ALTER EXTENSION hstore ADD VIEW rehearsal_dependency_external.rehearsal_extension_view;',
  rows=>rows.some(r=>r.class==='pg_extension'&&r.description==='extension hstore'));
 await denied('plan-targets-public-extension-members-refuses-extension-drop',
  'CREATE EXTENSION hstore WITH SCHEMA public;',
  rows=>rows.some(r=>r.class==='pg_extension'&&r.description==='extension hstore'));
 const direct=await json("SELECT jsonb_build_array(jsonb_build_object('class','pg_extension','description','extension '||extname,'schema',NULL)) FROM pg_extension WHERE extname='pg_net';");
 assert.throws(()=>assertExternalDependents(direct,219),/UNREVIEWED_EXTERNAL_DROP_DEPENDENT:extension pg_net/u);
 cases.push({name:'direct-extension-drop-refused',rejected:true,dropReached:false});
 const after=await json(pgNetIdentitySql);assert.deepEqual(after,before,'PG_NET_CHANGED_BY_DEPENDENCY_PROBES');
 return {baselineAllowed:true,pgNetBefore:before,pgNetAfter:after,pgNetUnchanged:true,runnable,negativeCases:cases};
}
