// Feasibility proof only: disposable Supabase217,never a hosted connection.
// A passing experiment does NOT certify that the proposed backup role is safe.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';

const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..');
const project='nawasrah-gha-custom-reader-test',container='supabase_db_'+project;
const role='nawasrah_backup_reader_probe';
const output=path.join(tmpdir(),'nawasrah-gha-custom-role-feasibility');
const report={experimentCompleted:false,productionRoleAccepted:false,hostedAccess:false,
  credentialsCreated:false,migrationCreated:false,ceiling:217,requiredSchemas:['public','auth','storage','supabase_migrations']};
const executor=executorFor(['--container',container]);let local;
const readerArgs=[...executor.args];readerArgs[readerArgs.indexOf('-U')+1]=role;
const readerExecutor={...executor,args:readerArgs};
const raw=(text,target=executor)=>executeInput(target,'\\set VERBOSITY verbose\n'+text);
const sql=async(text,target=executor)=>{const r=await raw(text,target);if(r.code!==0)report.sqlFailure={sqlstate:r.stderr.match(/ERROR:\s+([A-Z0-9]{5}):/u)?.[1]??null,
  permissionObject:r.stderr.match(/permission denied for (?:schema|table|relation|sequence|function) [a-zA-Z0-9_]+/u)?.[0]??null,
  roleSwitchDenied:/permission denied to set role/iu.test(r.stderr)};
  assert.equal(r.code,0,'LOCAL_PROBE_SQL_FAILED');return r.stdout.trim();};
const json=async(text,target=executor)=>JSON.parse((await sql(text,target)).split(/\r?\n/u).filter(Boolean).at(-1));
const attempt=async text=>{const r=await raw('BEGIN;SET LOCAL default_transaction_read_only=off;'+text+';ROLLBACK;',readerExecutor);
  return {accepted:r.code===0,sqlstate:r.stderr.match(/ERROR:\s+([A-Z0-9]{5}):/u)?.[1]??null};};
const dump=async name=>{try{await exec('docker',['exec',container,'pg_dump','-U',role,
  '--no-password','-Fc','--file=/tmp/'+name+'.dump','postgres'],{windowsHide:true,maxBuffer:1024**2});return {accepted:true};}
  catch(e){return {accepted:false,exitCode:Number.isInteger(e.code)?e.code:null,
    permissionObject:String(e.stderr??'').match(/permission denied for (?:schema|table|sequence) [a-zA-Z0-9_]+/u)?.[0]??null};}};
try{
  await mkdir(output,{recursive:true});
  const boot=await exec(process.execPath,[root+'/scripts/testing/bootstrap-isolated-supabase.mjs'],{
    cwd:root,windowsHide:true,maxBuffer:16*1024**2,env:{...process.env,
      NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'217',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
      NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
  local=JSON.parse(boot.stdout).isolatedProjectRoot;
  report.creator=await json("SELECT jsonb_build_object('role',current_user,'super',rolsuper,'bypassRls',rolbypassrls,'createRole',rolcreaterole) FROM pg_roles WHERE rolname=current_user;");
  const created=await raw('CREATE ROLE '+role+' LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;');
  report.bypassRoleCreation={accepted:created.code===0,sqlstate:created.stderr.match(/ERROR:\s+([A-Z0-9]{5}):/u)?.[1]??null};
  assert.equal(created.code,0,'LOCAL_POSTGRES_CANNOT_CREATE_BYPASS_ROLE');
  for(const schema of report.requiredSchemas){
    report.stage='grant-'+schema;
    await sql('GRANT USAGE ON SCHEMA '+schema+' TO '+role+';GRANT SELECT ON ALL TABLES IN SCHEMA '+schema+' TO '+role+';GRANT SELECT ON ALL SEQUENCES IN SCHEMA '+schema+' TO '+role+';');
  }
  const tables=await json("SELECT coalesce(jsonb_agg(format('%I.%I',schemaname,tablename) ORDER BY schemaname,tablename),'[]') FROM pg_tables WHERE schemaname IN ('public','auth','storage','supabase_migrations');");
  report.requiredTablesRead=0;
  try{for(const table of tables){report.stage='read-'+table;await sql('BEGIN READ ONLY;SET LOCAL row_security=off;SELECT count(*) FROM '+table+';ROLLBACK;',readerExecutor);report.requiredTablesRead++;}}
  catch{report.narrowReadFailure={stage:report.stage,...report.sqlFailure};}
  report.narrowRole={
    insert:await attempt('INSERT INTO public.units DEFAULT VALUES'),
    update:await attempt('UPDATE public.units SET id=id WHERE false'),
    delete:await attempt('DELETE FROM public.units WHERE false'),
    truncate:await attempt('TRUNCATE public.units'),
    persistentDdl:await attempt('CREATE TABLE public.gha_reader_ddl_probe(id integer)'),
    temporaryDdl:await attempt('CREATE TEMP TABLE gha_reader_temp_probe(id integer)'),
    createRole:await attempt('CREATE ROLE gha_reader_forbidden_probe'),
    writerRpc:await attempt('SELECT public.run_advanced_monitoring_checks()')};
  report.narrowFullDump=await dump('gha-reader-narrow');
  report.stage='predefined-reader-grant';const membership=await raw('GRANT pg_read_all_data TO '+role+';');
  report.predefinedReaderGrant={accepted:membership.code===0,sqlstate:membership.stderr.match(/ERROR:\s+([A-Z0-9]{5}):/u)?.[1]??null};
  assert.equal(membership.code,0,'LOCAL_POSTGRES_CANNOT_GRANT_READ_ALL');
  report.broadPrivileges=await json(`BEGIN READ ONLY;SELECT jsonb_build_object(
    'cronUsage',has_schema_privilege(current_user,'cron','USAGE'),
    'cronRunHistoryDelete',has_table_privilege(current_user,'cron.job_run_details','DELETE'),
    'cronScheduleExecute',has_function_privilege(current_user,'cron.schedule(text,text,text)','EXECUTE'),
    'vaultUsage',has_schema_privilege(current_user,'vault','USAGE'));ROLLBACK;`,readerExecutor);
  report.broadFullDump=await dump('gha-reader-broad');
  report.broadDelete=await attempt('DELETE FROM cron.job_run_details WHERE false');
  report.broadSchedule=await attempt("SELECT cron.schedule('gha-reader-rolled-back','0 0 1 1 *','SELECT 1')");
  // Reproduce the captured Frankfurt PUBLIC grants under their actual owner.
  // This is only the disposable test DB,not a proposal to change Frankfurt ACL.
  const platformArgs=[...executor.args];platformArgs[platformArgs.indexOf('-U')+1]='supabase_admin';
  const asPlatform={...executor,args:platformArgs};
  const grants=await executeInput(asPlatform,'GRANT SELECT,DELETE ON cron.job_run_details TO PUBLIC;GRANT EXECUTE ON FUNCTION cron.schedule(text,text,text) TO PUBLIC;');
  assert.equal(grants.code,0,'LOCAL_SUPABASE_PUBLIC_GRANT_REPRODUCTION_FAILED');
  report.frankfurtPublicDelete=await attempt('DELETE FROM cron.job_run_details WHERE false');
  report.frankfurtPublicSchedule=await attempt("SELECT cron.schedule('gha-reader-frankfurt-rolled-back','0 0 1 1 *','SELECT 1')");
  assert.equal(report.frankfurtPublicDelete.accepted,true,'EXPECTED_PUBLIC_DELETE_EXPOSURE_NOT_REPRODUCED');
  report.blockers=['FULL_DATABASE_READER_INHERITS_PUBLIC_CRON_WRITES'];
  if(report.narrowRole.temporaryDdl.accepted)report.blockers.push('DATABASE_PUBLIC_TEMP_PRIVILEGE');
  report.experimentCompleted=true;
}catch(e){report.error=e.code==='ERR_ASSERTION'?String(e.message).split('\n')[0]:'LOCAL_CUSTOM_READER_PROBE_FAILED';process.exitCode=1;}
finally{
  if(local)try{await exec(process.execPath,[root+'/node_modules/supabase/dist/supabase.js','stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:8*1024**2});}
    catch{report.cleanupFailed=true;process.exitCode=1;}
  report.checkedAt=new Date().toISOString();await mkdir(output,{recursive:true});
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
