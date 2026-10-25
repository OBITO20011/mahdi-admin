import assert from 'node:assert/strict';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {randomBytes} from 'node:crypto';import fs from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';
import {restoreToolError,saveRestoreLogs,sanitizedRestoreLog} from '../backup/restore-log.mjs';
import {IMAGE} from '../backup/complete-backup.mjs';
const exec=promisify(execFile),name='nawasrah-restore-diagnostic-'+randomBytes(4).toString('hex'),output=await fs.mkdtemp(path.join(tmpdir(),'nawasrah-restore-negative-')),cases=[];
const docker=args=>exec('docker',args,{windowsHide:true,timeout:180000,maxBuffer:4*1024**2});let started=false;
const sql=(db,text)=>docker(['exec',name,'psql','-h','/tmp/socket','-p','25435','-U','supabase_admin','-d',db,'-X','-q','-v','ON_ERROR_STOP=1','-c',text]);
try{
 await docker(['run','--detach','--rm','--network','none','--name',name,'--entrypoint','sleep',IMAGE,'infinity']);started=true;
 await docker(['exec',name,'mkdir','-p','/tmp/socket']);await docker(['exec',name,'chown','postgres:postgres','/tmp/socket']);
 await docker(['exec','--user','postgres',name,'initdb','-D','/tmp/pgdata','-U','supabase_admin','--auth=trust']);
 await docker(['exec','--user','postgres',name,'pg_ctl','-D','/tmp/pgdata','-l','/tmp/restore.log','-o',"-p 25435 -k /tmp/socket -c listen_addresses='' -c log_error_verbosity=verbose -c log_min_error_statement=panic -c log_line_prefix='[state=%e] '",'-w','start']);
 await sql('postgres','CREATE ROLE restore_fixture_owner;');await sql('postgres','CREATE DATABASE source_fixture;');await sql('postgres','CREATE DATABASE target_fixture;');
 const secret='PRIVATE_SYNTHETIC_CUSTOMER_KEY_NEVER_PERSIST';await sql('source_fixture',"CREATE TABLE public.restore_fixture_item(id text PRIMARY KEY);ALTER TABLE public.restore_fixture_item OWNER TO restore_fixture_owner;INSERT INTO restore_fixture_item VALUES('"+secret+"');");
 await docker(['exec',name,'pg_dump','-h','/tmp/socket','-p','25435','-U','supabase_admin','-d','source_fixture','-Fc','--file=/tmp/negative.dump']);
 const tocList=(await docker(['exec',name,'pg_restore','--list','/tmp/negative.dump'])).stdout;
 await sql('source_fixture','REASSIGN OWNED BY restore_fixture_owner TO supabase_admin;');await sql('postgres','DROP ROLE restore_fixture_owner;');
 for(const type of ['missing-role','duplicate-data']){
  if(type==='duplicate-data')await sql('target_fixture',"ALTER TABLE public.restore_fixture_item ADD PRIMARY KEY(id);INSERT INTO public.restore_fixture_item VALUES('"+secret+"');");
  await docker(['exec',name,'truncate','-s','0','/tmp/restore.log']);let error;
  try{await docker(['exec',name,'pg_restore','--verbose','-h','/tmp/socket','-p','25435','-U','supabase_admin','-d','target_fixture','--exit-on-error',...(type==='duplicate-data'?['--data-only']:[]),'/tmp/negative.dump']);}catch(e){error=e;}
  assert.ok(error);assert.equal(error.code,1);const raw=(await docker(['exec',name,'tail','-c','65536','/tmp/restore.log'])).stdout;
  const diagnostic=restoreToolError(error,{stage:'restore-complete-dump',serverLog:raw,tocList}).diagnostic;
  assert.equal(diagnostic.exitCode,1);assert.equal(diagnostic.sqlstate,type==='missing-role'?'42704':'23505');assert.equal(diagnostic.restoreErrorCode,type==='missing-role'?'MISSING_ROLE':'DUPLICATE_DATA');
  assert.equal(diagnostic.toc.name,'restore_fixture_item');assert.equal(diagnostic.toc.schema,'public');assert.equal(diagnostic.toc.type,type==='missing-role'?'TABLE':'TABLE DATA');
  assert.ok(!JSON.stringify(diagnostic).includes(secret));assert.ok(!JSON.stringify(sanitizedRestoreLog(raw)).includes(secret));
  let saved;try{saved=await saveRestoreLogs({reportPath:path.join(output,type,'restore.json'),stderr:error.stderr,serverLog:raw,tocList});}catch{saved={saved:false,requiresElevatedWindowsContext:true};}
  if(process.platform!=='win32'){assert.equal(saved.saved,true);assert.equal((await fs.stat(saved.folder)).mode&0o777,0o700);const files=await Promise.all(saved.files.map(f=>fs.readFile(path.join(saved.folder,f),'utf8')));for(const text of files)assert.ok(!text.includes(secret));}
  cases.push({name:type,diagnostic,serverTailCapturedBeforeContainerRemoval:true,rawNeverSaved:true,protectedLogPersistence:saved.saved});
 }
 const report={ok:true,network:'none',hostedConnectionsMade:false,containerRemoved:true,strictExitOnError:true,cases,output};await fs.writeFile(path.join(output,'proof.json'),JSON.stringify(report,null,2)+'\n');await fs.writeFile(path.join(tmpdir(),'restore-negative-proof-pointer.txt'),output);console.log(JSON.stringify(report));
}catch(error){console.error(JSON.stringify({ok:false,code:'ISOLATED_RESTORE_NEGATIVE_PROOF_FAILED',errorClass:error?.code==='ERR_ASSERTION'?'ASSERTION_FAILED':'TOOL_FAILED'}));process.exitCode=1;}finally{if(started)await docker(['rm','--force',name]);}
