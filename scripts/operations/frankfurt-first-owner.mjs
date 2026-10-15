// Owner-run only. The Auth user is created via Dashboard/Admin API first.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile,realpath} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {TARGET,OLD_REF,DEFAULT_WORKDIR,assertOutsideRepository,connectionFromLink,ownerPassword} from './frankfurt-owner-build.mjs';
import {readReference171,readyReference171Name} from './frankfurt-reference171.mjs';
import {executeInput} from './build-empty-supabase.mjs';
import {verifyCatalogReadOnly} from './frankfurt-catalog-verification.mjs';
import {schemaCatalogSql,catalogDifference} from '../testing/schema-catalog.mjs';
import {historySql,holdUpgradeGuard} from './frankfurt-owner-upgrade.mjs';
import {bindFirstOwnerSql,validateFirstOwner} from './first-owner-core.mjs';
const root=path.resolve(import.meta.dirname,'../..');
export function firstOwnerArguments(args){
 const keys=['--dry-run','--apply','--workdir','--owner-id','--email','--name','--branch-code','--branch-name'];
 assert.ok(!(args.includes('--apply')&&args.includes('--dry-run')),'ONE_OWNER_MODE');
 for(const key of keys)assert.ok(args.filter(v=>v===key).length<=1,'DUPLICATE_OWNER_OPTION');
 const values={};for(let n=0;n<args.length;n++){const key=args[n];assert.ok(keys.includes(key),'UNKNOWN_OWNER_OPTION');if(!['--dry-run','--apply'].includes(key)){assert.ok(args[n+1]&&!args[n+1].startsWith('--'),'OWNER_OPTION_VALUE');values[key]=args[++n];}}
 const p={ownerId:values['--owner-id'],email:values['--email'],name:values['--name'],branchCode:values['--branch-code'],branchName:values['--branch-name']};
 const apply=args.includes('--apply');if(apply||p.ownerId)validateFirstOwner(p);
 return {apply,workdir:path.resolve(values['--workdir']??DEFAULT_WORKDIR),input:p};
}
export async function runFirstOwner(args){
 const options=firstOwnerArguments(args),{workdir}=options;assertOutsideRepository(workdir);assertOutsideRepository(await realpath(workdir),await realpath(root));
 const old=await readFile(path.join(root,'supabase/.temp/project-ref'),'utf8');assert.equal(old.trim(),OLD_REF);
 const reference=await readReference171(root,path.join(workdir,readyReference171Name));
 const output=path.join(workdir,'first-owner-'+new Date().toISOString().replaceAll(/[:.]/gu,'-'));await mkdir(output);
 const report={mode:options.apply?'owner-bootstrap':'offline-dry-run',output,remoteWriteAttempted:false,startedAt:new Date().toISOString()};let env,guard;
 try{
  if(!options.apply){Object.assign(report,{ok:true,networkAccess:false,plan:['create confirmed Auth user via Dashboard','explicit UUID+email binding to owner+branch in one guarded transaction','profile UI TOTP enroll+verify,then AAL2 authorization'],publicRpcAdded:false});return report;}
  assert.equal((await readFile(path.join(workdir,'supabase/.temp/project-ref'),'utf8')).trim(),TARGET.id);
  const connection=connectionFromLink(await readFile(path.join(workdir,'supabase/.temp/pooler-url'),'utf8'));
  assert.ok(process.stdin.isTTY,'OWNER_INTERACTIVE_TERMINAL_REQUIRED');
  const terminal=createInterface({input:process.stdin,output:process.stdout});try{assert.equal(await terminal.question('تأسيس أول مالك فقط،اكتب '+TARGET.id+': '),TARGET.id);}finally{terminal.close();}
  env={...process.env,PGPASSWORD:await ownerPassword(),PGSSLMODE:'require',PGCONNECT_TIMEOUT:'10',PGPASSFILE:path.join(output,'NO_PASSWORD_FILE')};delete env.PGOPTIONS;delete env.SUPABASE_DB_PASSWORD;
  const psql=process.env.NAWASRAH_PG_BIN?path.join(process.env.NAWASRAH_PG_BIN,'psql.exe'):path.join(process.env.LOCALAPPDATA,'NawasrahBackup/postgresql-17.11/bin/psql.exe');
  const executor={command:psql,args:[...connection,'-X','-q','-At','-w','-v','ON_ERROR_STOP=1'],env};
  const sql=async text=>{const r=await executeInput(executor,text);assert.equal(r.code,0,r.stderr.match(/FIRST_OWNER_[A-Z_]+/u)?.[0]??'FIRST_OWNER_SQL_FAILED');return r.stdout.trim();};
  assert.equal(await sql("SELECT current_setting('server_version_num')::integer/10000;"),'17');
  guard=await holdUpgradeGuard(executor);
  assert.deepEqual(JSON.parse(await sql(historySql)),reference.appliedVersions);
  const original=JSON.parse(await readFile(path.join(workdir,'notification-before.json'),'utf8'));
  await verifyCatalogReadOnly(executor,output,reference,original,{beforeBuildDate:reference.buildUtcDate,afterBuildDate:new Date().toISOString().slice(0,10)},report);
  const before=JSON.parse(await sql(schemaCatalogSql));report.remoteWriteAttempted=true;
  const result=JSON.parse(await sql(bindFirstOwnerSql(options.input)));assert.equal(result.ok,true);assert.equal(result.owners,1);
  const changes=catalogDifference(before,JSON.parse(await sql(schemaCatalogSql)));assert.deepEqual(changes,[],'FIRST_OWNER_SCHEMA_OR_PERMISSION_CHANGED');
  report.ok=true;report.ownerBound=true;report.totp='Owner must enroll+verify via profile;not yet claimed';return report;
 }catch(error){report.ok=false;report.error=error.message.split('\n')[0];return report;}
 finally{if(guard)try{await guard.close();}catch{report.ok=false;report.guardCloseError='OWNER_GUARD_CLOSE_FAILED';}if(env)delete env.PGPASSWORD;assert.equal(await readFile(path.join(root,'supabase/.temp/project-ref'),'utf8'),old);report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{const r=await runFirstOwner(process.argv.slice(2));console.log(JSON.stringify({ok:r.ok,output:r.output,error:r.error,remoteWriteAttempted:r.remoteWriteAttempted}));if(!r.ok)process.exitCode=1;}catch(error){console.error(error.message.split('\n')[0]);process.exitCode=1;}}
