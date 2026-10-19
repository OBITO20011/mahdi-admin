// Local-only RPC EXECUTE diagnostics;each invocation rolls back even on success.
// Does not promise valid business payloads:validation failures are distinct from42501.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {serviceInventory} from './service-access-inventory.mjs';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {fixtureId as id} from './table-access-probes.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),
 project='nawasrah-service-audit-'+randomBytes(4).toString('hex')+'-test',container='supabase_db_'+project;
const {migrationCeiling}=JSON.parse(await readFile(path.join(root,'docs/agent/project-state.json'),'utf8'));
assert.ok([198,199,200].includes(migrationCeiling),'APPROVED_SERVICE_AUDIT_CEILING_REQUIRED');
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-service-access-')),
 report={schemaVersion:1,startedAt:new Date().toISOString(),migrationCeiling,managedAccess:false,output};
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const sql=async text=>{const r=await executeInput(executorFor(['--container',container]),text);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
const json=async text=>JSON.parse(await sql(text));let workdir;
// Typed neutral probes test EXECUTE dispatch,not full financial workflows.
export function probeValue(name,type){
 if(/\[\]$/u.test(type))return `ARRAY[]::${type}`;
 if(type==='uuid')return name.includes('customer')?q(id(401))+'::uuid':name.includes('user')?q(id(1))+'::uuid':name.includes('warehouse')?q(id(201))+'::uuid':name.includes('branch')?q(id(200))+'::uuid':'NULL::uuid';
 if(type==='jsonb'||type==='json')return q(/lines|items|components/u.test(name)?'[]':'{}')+'::'+type;
 if(['integer','smallint','bigint','numeric','double precision'].includes(type))return `${/page_size|limit/u.test(name)?25:/page|quantity/u.test(name)?1:0}::${type}`;
 if(type==='boolean')return 'false';
 if(type==='date')return 'CURRENT_DATE';
 if(type==='timestamp with time zone')return 'CURRENT_TIMESTAMP';
 if(type==='text')return /search/u.test(name)?'NULL::text':/idempotency|fingerprint/u.test(name)?q('isolated-service-audit-0000000000000000000001'):'NULL::text';
 return `NULL::${type}`;
}
try{
 const source=await serviceInventory();report.sourceHashes=source.sourceHashes;
 const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
  NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:String(migrationCeiling),NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
  NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 workdir=JSON.parse(boot.stdout).isolatedProjectRoot;
 await sql(`ALTER TABLE orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;`);
 await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
 for(const [n,role] of [[2,'admin'],[3,'cashier']])await sql(`INSERT INTO auth.users(id,aud,role,email) VALUES(${q(id(n))},'authenticated','authenticated',${q(role+'@audit.example.test')});
 INSERT INTO profiles(id,full_name,is_active) VALUES(${q(id(n))},${q(role)},true);INSERT INTO roles(code,name_ar) VALUES(${q(role)},${q(role)}) ON CONFLICT(code) DO NOTHING;
 INSERT INTO user_roles(user_id,role_id) SELECT ${q(id(n))},r.id FROM roles r WHERE r.code=${q(role)};`);
 const functions=await json(`SELECT jsonb_agg(jsonb_build_object('name',p.proname,'identity',p.oid::regprocedure::text,'oid',p.oid,'returnType',format_type(p.prorettype,NULL),
 'names',COALESCE(p.proargnames,'{}'::text[]),'types',ARRAY(SELECT format_type(t,NULL) FROM unnest(p.proargtypes::oid[]) t),
 'owner',pg_get_userbyid(p.proowner),'acl',p.proacl,'securityDefiner',p.prosecdef,'configuration',p.proconfig,'definition',pg_get_functiondef(p.oid)) ORDER BY p.proname,p.oid)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f';`);
 report.functions=functions.map(({definition:_definition,oid:_oid,...f})=>f);
 // Expand every dynamic sink and every gateway callsite;retain overloads explicitly.
 const sites=[...source.rpc,...source.gatewayRpc.map(c=>({...c,id:c.file+':'+c.line,resolutions:c.resolutions}))];
 const probes=[];
 for(const site of sites)for(const name of site.name?[site.name]:site.resolutions.map(r=>r.name)){
  const matches=functions.filter(f=>f.name===name);assert.ok(matches.length,'MISSING_RPC:'+name);
  for(const f of matches)for(const [actor,appRole] of site.role==='authenticated'?[[id(1),'owner'],[id(2),'admin'],[id(3),'cashier']]:[[site.role==='anon'?null:id(1),site.role]]){
   const args=f.types.map((type,i)=>probeValue(f.names[i]||'',type));
   probes.push({site:site.id,name,role:site.role,actor,appRole,identity:f.identity,args,command:`SELECT public."${name}"(${args.join(',')})`});
  }
 }
 report.probes=probes;console.log(JSON.stringify({stage:'real-role-rpc-dispatch',sites:sites.length,probes:probes.length}));
 const commands=probes.map((p,index)=>`DO $audit$DECLARE state text;message text;BEGIN
  BEGIN
   PERFORM set_config('request.jwt.claims',${q(JSON.stringify({sub:p.actor,role:p.role,aal:'aal2'}))},true);
   EXECUTE 'SET LOCAL ROLE ${p.role}';
   EXECUTE ${q(p.command)};
   RAISE EXCEPTION USING ERRCODE='Z0001',MESSAGE='PROBE_SUCCEEDED_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE,message=MESSAGE_TEXT;
   RESET ROLE;
   INSERT INTO audit_rpc_results VALUES(${index},state,CASE WHEN state='Z0001' THEN 'success rolled back'
    WHEN message~*'secret|token|password|vault' THEN 'redacted validation message' ELSE left(message,600) END);
  END;
 END $audit$;`).join('\n');
 const results=await json(`BEGIN;SET LOCAL statement_timeout='60s';CREATE TEMP TABLE audit_rpc_results(i int,state text,message text);
 ${commands}
 SELECT jsonb_agg(jsonb_build_object('probe',i,'sqlstate',CASE WHEN state='Z0001' THEN NULL ELSE state END,'outcome',CASE WHEN state='Z0001' THEN 'success_rolled_back' WHEN state='42501' THEN 'permission_denied' ELSE 'body_validation_or_error' END,'message',message) ORDER BY i) FROM audit_rpc_results;ROLLBACK;`);
 report.results=results.map(r=>({...probes[r.probe],...r}));
 report.execute=await json(`SELECT jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,'role',r,'allowed',has_function_privilege(r,p.oid,'EXECUTE')) ORDER BY p.proname,p.oid,r)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) r
 WHERE n.nspname='public' AND p.prokind='f';`);
 report.storageBuckets=await json(`SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types)),'[]') FROM storage.buckets;`);
 report.publication=await json(`SELECT jsonb_build_object('exists',EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime'),'allTables',(SELECT puballtables FROM pg_publication WHERE pubname='supabase_realtime'),
 'tables',COALESCE((SELECT jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename) ORDER BY schemaname,tablename) FROM pg_publication_tables WHERE pubname='supabase_realtime'),'[]'));`);
 report.cron=await json(`SELECT jsonb_agg(jsonb_build_object('name',jobname,'schedule',schedule,'command',command,'active',active) ORDER BY jobname) FROM cron.job;`);
 report.currentOldRefFunctions=functions.filter(f=>f.definition.includes('acjtabdqqnpwhdvbvnyw')).map(f=>f.identity);
 assert.deepEqual((await serviceInventory()).sourceHashes,source.sourceHashes,'SOURCE_CHANGED_DURING_SERVICE_DIAGNOSTIC');
 report.ok=true;
}catch(error){report.ok=false;report.error=error.message;process.exitCode=1;}
finally{
 if(workdir)await exec(process.execPath,[path.join(root,'node_modules/supabase/dist/supabase.js'),'stop','--no-backup','--workdir',workdir],{cwd:root,windowsHide:true});
 report.endedAt=new Date().toISOString();await writeFile(path.join(output,'diagnostic.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({ok:report.ok,error:report.error,output,count:report.results?.length,denied:report.results?.filter(r=>r.sqlstate==='42501').length}));
}
