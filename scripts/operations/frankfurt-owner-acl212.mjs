// Owner-operated only. dry-run uses local files; apply requires explicit typed
// target and hidden password. No CLI target/password/SQL override is supported.
import assert from 'node:assert/strict';
import {mkdir,readFile,realpath,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {TARGET,OLD_REF,DEFAULT_WORKDIR,assertOutsideRepository,connectionFromLink,ownerPassword} from './frankfurt-owner-build.mjs';
import {executeInput} from './build-empty-supabase.mjs';
import {readOwnerAcl212Bundle,parseOwnerAcl212Result} from './owner-acl212-bundle.mjs';

const root=path.resolve(import.meta.dirname,'../..');
export async function applyAcl212WithExecutor(executor,bundle,report={}){
 report.stage='guarded-transaction';report.remoteWriteAttempted=true;report.commitConfirmed=false;
 const result=await executeInput(executor,bundle.executionSql);
 if(result.code!==0){
  report.failedMetadataSection=result.stderr.match(/OWNER_ACL212_RELATED_METADATA_MISMATCH:\s*(constraints|indexes|policies|triggers|sequences|defaultPrivileges|schemas)\b/u)?.[1];
  throw new Error((result.stderr.match(/OWNER_ACL212_[A-Z0-9_]+/u)?.[0]??'OWNER_ACL212_EXECUTION_FAILED')+(report.failedMetadataSection?':'+report.failedMetadataSection:''));
 }
 const parsed=parseOwnerAcl212Result(result.stdout,bundle.manifest);
 report.commitConfirmed=true;report.stage='complete';
 Object.assign(report,{rows:parsed.rows,matches_reference_true:parsed.matches_reference_true,
  matches_reference_false:parsed.matches_reference_false,removed_privileges:parsed.removed_privileges});
 return parsed;
}
async function confirmTarget(){
 const terminal=createInterface({input:process.stdin,output:process.stdout});
 try{return await terminal.question('لسحب الزيادات المراجعة فقط، اكتب مرجع فرانكفورت '+TARGET.id+': ');}
 finally{terminal.close();}
}
// Internal test I/O seam; never selected by a command-line flag.
export async function runAcl212(args,io={}){
 assert.ok(args.every((v,i)=>['--dry-run','--apply','--workdir'].includes(v)||args[i-1]==='--workdir'),'OWNER_ACL212_UNKNOWN_OPTION');
 assert.ok(['--dry-run','--apply'].filter(v=>args.includes(v)).length<=1,'OWNER_ACL212_ONE_MODE_REQUIRED');
 for(const flag of ['--dry-run','--apply','--workdir'])assert.ok(args.filter(v=>v===flag).length<=1,'OWNER_ACL212_DUPLICATE_OPTION');
 const at=args.indexOf('--workdir');assert.ok(at<0||Boolean(args[at+1]),'OWNER_ACL212_WORKDIR_REQUIRED');
 const workdir=path.resolve(at<0?DEFAULT_WORKDIR:args[at+1]);assertOutsideRepository(workdir);
 await mkdir(workdir,{recursive:true});assertOutsideRepository(await realpath(workdir),await realpath(root));
 const output=path.join(workdir,'acl212-'+new Date().toISOString().replaceAll(/[:.]/gu,'-'));await mkdir(output);
 /** @type {Record<string,unknown> & {mode:string,output:string,stage:string,remoteWriteAttempted:boolean,connectionAttempted:boolean,commitConfirmed:boolean}} */
 const report={mode:args.includes('--apply')?'owner-acl212-apply':'owner-acl212-dry-run',output,startedAt:new Date().toISOString(),
  projectRef:TARGET.id,stage:'local-preflight',remoteWriteAttempted:false,connectionAttempted:false,commitConfirmed:false};let env;
 try{
  const bundle=await readOwnerAcl212Bundle(root);
  Object.assign(report,{sqlSha256:bundle.sqlSha256,executionSha256:bundle.executionSha256,
   expectedRows:675,reviewedRevokeStatements:264,reviewedExtraPrivileges:432});
  if(!args.includes('--apply'))return Object.assign(report,{ok:true,stage:'local-preview-complete',localFilesOnly:true});
  assert.ok((io.interactive??process.stdin.isTTY)===true,'OWNER_ACL212_INTERACTIVE_TERMINAL_REQUIRED');
  assert.ok(!process.env.SUPABASE_CLI_BINARY_OVERRIDE,'OWNER_ACL212_OVERRIDE_NOT_ALLOWED');
  report.stage='validate-owner-link';
  const readBackupLink=io.readBackupLink??(()=>readFile(path.join(root,'supabase/.temp/project-ref'),'utf8'));
  const backup=await readBackupLink();
  assert.equal(backup.trim(),OLD_REF,'OWNER_ACL212_BACKUP_LINK_CHANGED');
  assert.equal((await readFile(path.join(workdir,'supabase/.temp/project-ref'),'utf8')).trim(),TARGET.id,'OWNER_ACL212_LINK_TARGET_MISMATCH');
  const connection=connectionFromLink(await readFile(path.join(workdir,'supabase/.temp/pooler-url'),'utf8'));
  report.stage='confirm-owner';
  assert.equal(await (io.confirmTarget??confirmTarget)(),TARGET.id,'OWNER_ACL212_CONFIRMATION_REQUIRED');
  report.stage='hidden-password';
  const secret=await (io.readPassword??ownerPassword)();assert.ok(typeof secret==='string'&&secret.length>0,'OWNER_ACL212_PASSWORD_REQUIRED');
  env={...process.env,PGPASSWORD:secret,PGSSLMODE:'require',PGCONNECT_TIMEOUT:'10',PGPASSFILE:path.join(output,'NO_PASSWORD_FILE')};
  delete env.PGOPTIONS;delete env.SUPABASE_DB_PASSWORD;delete env.PGSERVICE;delete env.PGSERVICEFILE;
  const executor=io.executor?io.executor(connection,env):{command:process.env.NAWASRAH_PG_BIN?path.join(process.env.NAWASRAH_PG_BIN,'psql.exe'):path.join(process.env.LOCALAPPDATA,'NawasrahBackup/postgresql-17.11/bin/psql.exe'),
   args:[...connection,'-X','-q','-At','-w','-v','ON_ERROR_STOP=1'],env};
  report.connectionAttempted=true;
  const result=await applyAcl212WithExecutor(executor,bundle,report);
  await writeFile(path.join(output,'rows.json'),JSON.stringify(result.results,null,2)+'\n');
  assert.equal(await readBackupLink(),backup,'OWNER_ACL212_BACKUP_LINK_CHANGED');
  return Object.assign(report,{ok:true,resultsFile:path.join(output,'rows.json')});
 }catch(error){
  report.ok=false;report.error=error.message?.match(/OWNER_ACL212_[A-Z0-9_]+/u)?.[0]??'OWNER_ACL212_PREPARATION_FAILED';return report;
 }finally{
  if(env)delete env.PGPASSWORD;
  report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const r=await runAcl212(process.argv.slice(2));console.log(JSON.stringify({ok:r.ok,mode:r.mode,output:r.output,error:r.error,
  expectedRows:r.expectedRows,rows:r.rows,matches_reference_true:r.matches_reference_true,matches_reference_false:r.matches_reference_false,
  removed_privileges:r.removed_privileges,remoteWriteAttempted:r.remoteWriteAttempted,commitConfirmed:r.commitConfirmed}));if(!r.ok)process.exitCode=1;}
 catch(error){console.error(error.message?.match(/OWNER_ACL212_[A-Z0-9_]+/u)?.[0]??'OWNER_ACL212_PREPARATION_FAILED');process.exitCode=1;}
}
