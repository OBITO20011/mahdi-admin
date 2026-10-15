import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
import {readTables150,removed150,verify150Catalog} from './table-read-privileges150-contract.mjs';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..');
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-grants150-'));
const report={startedAt:new Date().toISOString(),managedAccess:false,output,cases:[]};
const unit=await readFile(path.join(root,'supabase/migrations/150_explicit_application_table_read_privileges.sql'),'utf8');
const cli=path.join(root,'node_modules/supabase/dist/supabase.js');
// Separate fresh builds prove both dependency paths. No140-149 placeholders.
for(const ceiling of [138,139]){
 let workdir,stage='bootstrap';const row={base:ceiling};
 try{
  const project='nawasrah-grants150-'+ceiling+'-test',executor=executorFor(['--container','supabase_db_'+project]);
  const sql=async text=>{const r=await executeInput(executor,text);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
  const json=async text=>JSON.parse(await sql(text));
  const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
   NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:String(ceiling),NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
   NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
  workdir=JSON.parse(boot.stdout).isolatedProjectRoot;
  // Pure catalog/privilege probes;no fixture orders or external notifications.
  const before=await json(schemaCatalogSql);stage='apply150';await sql(unit);
  const after=await json(schemaCatalogSql);row.exact=verify150Catalog(before,after);
  stage='idempotency';await sql(unit);assert.deepEqual(catalogDifference(after,await json(schemaCatalogSql)),[]);row.idempotent=true;
  stage='effective-access';
  for(const table of readTables150){
   assert.equal(await sql(`SELECT has_table_privilege('authenticated','public.${table}','SELECT');`),'t');
   for(const role of ['anon','authenticated'])for(const privilege of [...removed150,'INSERT','UPDATE','DELETE'])
    assert.equal(await sql(`SELECT has_table_privilege('${role}','public.${table}','${privilege}');`),'f',table+':'+role+':'+privilege);
   assert.equal(await sql(`SELECT has_table_privilege('anon','public.${table}','SELECT');`),'f');
  }
  assert.equal(await sql("SELECT has_table_privilege('service_role','public.orders','SELECT');"),'t');
  stage='future-defaults';
  const future=await json(`BEGIN;CREATE TABLE public.nw150_default_probe(id integer);SELECT jsonb_build_object(
   'clientPrivileges',(SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles r ON r.oid=a.grantee WHERE c.oid='public.nw150_default_probe'::regclass AND r.rolname IN('anon','authenticated')),
   'anon',has_any_column_privilege('anon','public.nw150_default_probe','SELECT'),
   'authenticated',has_any_column_privilege('authenticated','public.nw150_default_probe','SELECT'));ROLLBACK;`);
  assert.deepEqual(future,{clientPrivileges:0,anon:false,authenticated:false});row.futureDefaults=future;
  assert.deepEqual(catalogDifference(after,await json(schemaCatalogSql)),[]);row.ok=true;
 }catch(error){row.ok=false;row.stage=stage;row.error=error.message;process.exitCode=1;}
 finally{
  if(workdir)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',workdir],{cwd:root,windowsHide:true});
  report.cases.push(row);console.log(JSON.stringify(row));
 }
 if(process.exitCode)break;
}
report.ok=!process.exitCode;report.endedAt=new Date().toISOString();
await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
