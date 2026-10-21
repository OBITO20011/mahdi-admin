// PREPARATION only. Import/default dry-run never connects. The owner must run
// the destructive mode explicitly in their terminal AFTER the trial day.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,realpath,copyFile} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {TARGET,OLD_REF,DEFAULT_WORKDIR,assertOutsideRepository,connectionFromLink,ownerPassword,functionReference} from './frankfurt-owner-build.mjs';
import {readReady208Reference,ready208ReferenceName} from './frankfurt-reference208.mjs';
import {holdUpgradeGuard,historySql} from './frankfurt-owner-upgrade.mjs';
import {executeInput} from './build-empty-supabase.mjs';
import {resetWithExecutor,resetUnits,uuid,sqlLiteral} from './trial-reset-core.mjs';
import {verifyCatalogReadOnly} from './frankfurt-catalog-verification.mjs';
import {sha256} from '../testing/maintenance-db-contract.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),cli=path.join(root,'node_modules/supabase/dist/supabase.js');
export function resetArguments(args){
 assert.ok(!args.includes('--apply')||!args.includes('--dry-run'),'ONE_RESET_MODE_REQUIRED');
 const allowed=new Set(['--apply','--dry-run','--workdir','--owner-id']);
 for(const key of allowed)assert.ok(args.filter(v=>v===key).length<=1,'DUPLICATE_RESET_OPTION');
 for(let n=0;n<args.length;n++){assert.ok(allowed.has(args[n]),'UNKNOWN_RESET_OPTION');if(['--workdir','--owner-id'].includes(args[n])){assert.ok(args[n+1]&&!args[n+1].startsWith('--'),'RESET_OPTION_VALUE');n++;}}
 const at=key=>args.includes(key)?args[args.indexOf(key)+1]:undefined;
 const ownerId=at('--owner-id');if(ownerId)uuid(ownerId);
 if(args.includes('--apply'))assert.ok(ownerId,'OWNER_UUID_REQUIRED');
 return {apply:args.includes('--apply'),workdir:path.resolve(at('--workdir')??DEFAULT_WORKDIR),ownerId};
}
export async function runReset(args){
 const options=resetArguments(args),{workdir,ownerId}=options;assertOutsideRepository(workdir);assertOutsideRepository(await realpath(workdir),await realpath(root));
 const old=await readFile(path.join(root,'supabase/.temp/project-ref'));assert.equal(old.toString().trim(),OLD_REF,'OLD_BACKUP_LINK_CHANGED');
 const reference=await readReady208Reference(root,path.join(workdir,ready208ReferenceName));await resetUnits(root,reference);
 const output=path.join(workdir,'trial-reset-'+new Date().toISOString().replaceAll(/[:.]/gu,'-'));await mkdir(output);
 const report={mode:options.apply?'owner-trial-reset':'offline-dry-run',projectRef:TARGET.id,output,startedAt:new Date().toISOString(),remoteWriteAttempted:false};
 let env,guard;
 try{
  if(!options.apply){Object.assign(report,{ok:true,networkAccess:false,migrationCeiling:208,migrations:170,
   plan:['verify current208/history/hold and exact BR-MAIN/WH-MAIN','empty product-images via Storage API using official CLI','disable five jobs;drop/recreate public only',
    'delete non-owner Auth users','replay literal170 SQL files+034 environment guards+official history','restore owner profile/role/branch and exact main warehouse UUID',
    'verify every public count,Auth/Vault/bucket preservation,full catalog,publication,DB_FUNCTIONS,CLI dry-run'],
   warning:'DESTRUCTIVE owner-only preparation;no database or Storage access in this mode'});return report;}
  assert.equal((await readFile(path.join(workdir,'supabase/.temp/project-ref'),'utf8')).trim(),TARGET.id,'WRONG_EXTERNAL_PROJECT');
  const connection=connectionFromLink(await readFile(path.join(workdir,'supabase/.temp/pooler-url'),'utf8'));
  assert.ok(process.stdin.isTTY,'OWNER_INTERACTIVE_TERMINAL_REQUIRED');
  const terminal=createInterface({input:process.stdin,output:process.stdout});
  try{assert.equal(await terminal.question('ستُحذف كل بيانات التجربة وملفات الصور والموظفين عدا UUID المحدد. أوقف الواجهتين والمستهلكات أولاً. اكتب RESET '+TARGET.id+': '),'RESET '+TARGET.id,'OWNER_RESET_CONFIRMATION_REQUIRED');}finally{terminal.close();}
  env={...process.env,PGPASSWORD:await ownerPassword(),PGSSLMODE:'require',PGCONNECT_TIMEOUT:'10',PGPASSFILE:path.join(output,'NO_PASSWORD_FILE')};delete env.PGOPTIONS;delete env.SUPABASE_DB_PASSWORD;
  const psql=process.env.NAWASRAH_PG_BIN?path.join(process.env.NAWASRAH_PG_BIN,'psql.exe'):path.join(process.env.LOCALAPPDATA,'NawasrahBackup/postgresql-17.11/bin/psql.exe');
  const executor={command:psql,args:[...connection,'-X','-q','-At','-w','-v','ON_ERROR_STOP=1'],env};
  const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,'RESET_PREFLIGHT_SQL_FAILED');return r.stdout.trim();};
  assert.equal(await sql("SELECT current_setting('server_version_num')::integer/10000;"),'17');
  assert.deepEqual(JSON.parse(await sql(historySql)),reference.appliedVersions,'RESET_REQUIRES_COMPLETE208_HISTORY');
  const original=JSON.parse(await readFile(path.join(workdir,'notification-before.json'),'utf8'));
  await verifyCatalogReadOnly(executor,output,reference,original,{beforeBuildDate:reference.buildUtcDate,afterBuildDate:new Date().toISOString().slice(0,10)},report);
  guard=await holdUpgradeGuard(executor);
  const cliCall=async flags=>{guard.assertHeld();const childEnv={...env,SUPABASE_DB_PASSWORD:env.PGPASSWORD};
   try{return await exec(process.execPath,[cli,...flags,'--workdir',workdir,'--agent','no'],{cwd:workdir,env:childEnv,windowsHide:true,maxBuffer:8*1024**2});}
   catch{throw new Error('RESET_OFFICIAL_CLI_FAILED:'+flags.slice(0,2).join('-'));}finally{delete childEnv.PGPASSWORD;delete childEnv.SUPABASE_DB_PASSWORD;}};
  // Validate all EXTERNAL copies before any destructive API call.
  for(const m of reference.manifest){const source=await readFile(path.join(root,'supabase/migrations',m.name));
   const external=path.join(workdir,'supabase/migrations',m.name);assert.equal(sha256(await readFile(external)),sha256(source),'RESET_EXTERNAL_SQL_BYTES_CHANGED');}
  report.remoteWriteAttempted=true;report.reset={};
  await resetWithExecutor({executor,root,reference,output,ownerId,report:report.reset,
   emptyStorage:async()=>{const rows=JSON.parse(await sql("SELECT COALESCE(jsonb_agg(name ORDER BY name),'[]'::jsonb) FROM storage.objects WHERE bucket_id='product-images';"));
    for(let n=0;n<rows.length;n+=100)await cliCall(['storage','rm',...rows.slice(n,n+100).map(name=>'ss:///product-images/'+name),'--experimental','--linked','--yes']);},
   deleteOtherAuth:async id=>{await sql(`DELETE FROM auth.users WHERE id<>${sqlLiteral(uuid(id))}::uuid;`);},
   clearHistory:async()=>{await cliCall(['migration','repair','--linked','--status','reverted',...reference.appliedVersions]);await sql('DELETE FROM supabase_migrations.seed_files;');},
   repair:async version=>{await cliCall(['migration','repair','--linked','--status','applied',version]);},
   finalDryRun:async()=>{await cliCall(['migration','list','--linked']);const r=await cliCall(['db','push','--linked','--dry-run','--skip-vault']);assert.match(r.stdout+r.stderr,/up to date/iu);}});
  report.functions=await functionReference(executor,208);
  // Recreated cron IDs differ;subsequent owner verify must use their exact NEW
  // definitions. No secrets or owner profile contents are stored in these files.
  await copyFile(path.join(workdir,'notification-before.json'),path.join(output,'previous-notification-before.json'));
  await writeFile(path.join(workdir,'notification-before.json'),JSON.stringify(report.reset.notificationOriginal,null,2)+'\n');
  report.ok=true;return report;
 }catch(error){report.ok=false;report.error=error.message.split('\n')[0];return report;}
 finally{if(guard)try{await guard.close();}catch{report.ok=false;report.guardCloseError='RESET_GUARD_CLOSE_FAILED';}if(env)delete env.PGPASSWORD;assert.equal(sha256(await readFile(path.join(root,'supabase/.temp/project-ref'))),sha256(old),'OLD_BACKUP_LINK_CHANGED');report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{const r=await runReset(process.argv.slice(2));console.log(JSON.stringify({ok:r.ok,mode:r.mode,output:r.output,error:r.error,remoteWriteAttempted:r.remoteWriteAttempted}));if(!r.ok)process.exitCode=1;}catch(error){console.error(error.message.split('\n')[0]);process.exitCode=1;}}
