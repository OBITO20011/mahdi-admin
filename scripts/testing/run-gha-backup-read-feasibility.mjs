import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..');
const cli=root+'/node_modules/supabase/dist/supabase.js',project='nawasrah-gha-read-role-test',container='supabase_db_'+project;
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-gha-read-feasibility-'));
const report={ok:false,output,hostedAccess:false,customRoleCreated:false,grantsChanged:false,ceiling:217};let local;
try{
 const b=await exec(process.execPath,[root+'/scripts/testing/bootstrap-isolated-supabase.mjs'],{cwd:root,windowsHide:true,maxBuffer:16*1024**2,env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'217',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(b.stdout).isolatedProjectRoot;const ex=executorFor(['--container',container]);
 const read=await executeInput(ex,`BEGIN READ ONLY;SET LOCAL ROLE pg_read_all_data;
 SELECT jsonb_build_object('role',current_user,'bypassRls',(SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user),
 'productSelect',has_table_privilege(current_user,'public.products','SELECT'),
 'authSelect',has_table_privilege(current_user,'auth.users','SELECT'),
 'storageSelect',has_table_privilege(current_user,'storage.objects','SELECT'),
 'historySelect',has_table_privilege(current_user,'supabase_migrations.schema_migrations','SELECT'),
 'cronSchemaUsage',has_schema_privilege(current_user,'cron','USAGE'),
 'cronScheduleExecute',has_function_privilege(current_user,'cron.schedule(text,text,text)','EXECUTE'),
 'netHttpExecute',has_function_privilege(current_user,'net.http_post(text,jsonb,jsonb,jsonb,integer)','EXECUTE'));
 ROLLBACK;`);assert.equal(read.code,0,'LOCAL_READER_PROBE_FAILED');report.reader=JSON.parse(read.stdout.trim());
 assert.equal(report.reader.bypassRls,false);assert.equal(report.reader.productSelect,true);
 const denied=await executeInput(ex,'BEGIN READ ONLY;SET LOCAL ROLE pg_read_all_data;SET LOCAL row_security=off;SELECT count(*) FROM public.products;ROLLBACK;');
 assert.notEqual(denied.code,0);assert.match(denied.stderr,/row.level security/iu);report.wholeTableReadRejectedByRls=true;
 await exec('docker',['exec',container,'pg_dumpall','-U','postgres','--role=pg_read_all_data','--roles-only','--no-role-passwords','--no-tablespaces','--file=/tmp/gha-roles-no-passwords.sql'],{windowsHide:true,maxBuffer:1024**2});report.roleCatalogCanBeDumpedWithoutRolePasswords=true;
 try{await exec('docker',['exec',container,'pg_dump','-U','postgres','--role=pg_read_all_data','--no-password','-Fc','--file=/tmp/gha-read-role-probe.dump','postgres'],{windowsHide:true,maxBuffer:1024**2});assert.fail('FULL_DUMP_SHOULD_REFUSE_RLS');}catch(e){assert.ok(e.code!==undefined);assert.match(e.stderr??'',/row.level security/iu);report.completeDumpRejectedByRls=true;}
 report.ok=true;
}catch(e){report.error=e.code==='ERR_ASSERTION'?String(e.message).split('\n')[0]:'LOCAL_FEASIBILITY_TOOL_FAILED';process.exitCode=1;}
finally{if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:8*1024**2});report.checkedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
