// OWNER-RUN only. Offline dry-run is default;never discover/link another project.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile,realpath} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {TARGET,OLD_REF,DEFAULT_WORKDIR,assertOutsideRepository,connectionFromLink,ownerPassword} from './frankfurt-owner-build.mjs';
import {ready198ReferenceName} from './frankfurt-reference198.mjs';
import {readFirstOwner198Reference} from './first-owner-reference198.mjs';
import {executeInput} from './build-empty-supabase.mjs';
import {verifyCatalogReadOnly} from './frankfurt-catalog-verification.mjs';
import {schemaCatalogSql,catalogDifference} from '../testing/schema-catalog.mjs';
import {historySql,holdUpgradeGuard} from './frankfurt-owner-upgrade.mjs';
import {readNotificationSnapshot} from './frankfurt-notification-hold.mjs';
import {uuid} from './trial-reset-core.mjs';
import {mainWarehouse,mainWarehouseSql} from './main-warehouse-core.mjs';
const root=path.resolve(import.meta.dirname,'../..');
export function mainWarehouseArguments(args){
 const values={};let mode=null;
 for(let i=0;i<args.length;i++){
  const key=args[i];assert.ok(['--dry-run','--apply','--workdir','--owner-id'].includes(key),'UNKNOWN_MAIN_WAREHOUSE_OPTION');
  assert.ok(!Object.hasOwn(values,key),'DUPLICATE_MAIN_WAREHOUSE_OPTION');
  if(['--apply','--dry-run'].includes(key)){assert.equal(mode,null,'ONE_MAIN_WAREHOUSE_MODE');mode=key;values[key]=true;}
  else{assert.ok(args[i+1]&&!args[i+1].startsWith('--'),'MAIN_WAREHOUSE_OPTION_VALUE');values[key]=args[++i];}
 }
 uuid(values['--owner-id']);
 return {apply:mode==='--apply',ownerId:values['--owner-id'],workdir:path.resolve(values['--workdir']??DEFAULT_WORKDIR)};
}
export async function mainWarehouseWithExecutor({executor,reference,original,output,ownerId,report={}}){
 uuid(ownerId);
 const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,r.stderr.match(/MAIN_WAREHOUSE_[A-Z_]+/u)?.[0]??'MAIN_WAREHOUSE_SQL_FAILED');return r.stdout.trim();};
 assert.equal(await sql("SELECT current_setting('server_version_num')::integer/10000;"),'17');
 const guard=await holdUpgradeGuard(executor);
 try{
  assert.deepEqual(JSON.parse(await sql(historySql)),reference.appliedVersions,'MAIN_WAREHOUSE_HISTORY_MISMATCH');
  await verifyCatalogReadOnly(executor,output,reference,original,{beforeBuildDate:reference.buildUtcDate,afterBuildDate:new Date().toISOString().slice(0,10)},report);
  const before=JSON.parse(await sql(schemaCatalogSql)),notifications=await readNotificationSnapshot(executor);
  report.remoteWriteAttempted=true;
  const result=JSON.parse(await sql(mainWarehouseSql(ownerId)));assert.equal(result.ok,true);
  assert.equal(result.warehouse.code,mainWarehouse.code);assert.equal(result.warehouse.name_ar,mainWarehouse.name);
  assert.deepEqual(catalogDifference(before,JSON.parse(await sql(schemaCatalogSql))),[],'MAIN_WAREHOUSE_SCHEMA_OR_PERMISSION_CHANGED');
  assert.deepEqual(await readNotificationSnapshot(executor),notifications,'MAIN_WAREHOUSE_NOTIFICATION_HOLD_CHANGED');
  Object.assign(report,{ok:true,warehouseReady:true,warehouse:result.warehouse});return report;
 }finally{try{await guard.close();}catch{report.ok=false;report.guardCloseError='OWNER_GUARD_CLOSE_FAILED';}}
}
export async function runMainWarehouse(args){
 const options=mainWarehouseArguments(args),{workdir}=options;
 assertOutsideRepository(workdir);assertOutsideRepository(await realpath(workdir),await realpath(root));
 const old=await readFile(path.join(root,'supabase/.temp/project-ref'),'utf8');assert.equal(old.trim(),OLD_REF);
 const {reference,access}=await readFirstOwner198Reference(root,path.join(workdir,ready198ReferenceName));
 const output=path.join(workdir,'main-warehouse-'+new Date().toISOString().replaceAll(/[:.]/gu,'-'));await mkdir(output);
 const report={mode:options.apply?'main-warehouse-bootstrap':'offline-dry-run',output,accessEvidence:access,
  remoteWriteAttempted:false,startedAt:new Date().toISOString()};let env;
 try{
  if(!options.apply){Object.assign(report,{ok:true,networkAccess:false,plan:mainWarehouse,sql:mainWarehouseSql(options.ownerId),
   behavior:'Create only when no warehouses exist;exact active replay only;any different warehouse is rejected',migrationAdded:false});return report;}
  assert.equal((await readFile(path.join(workdir,'supabase/.temp/project-ref'),'utf8')).trim(),TARGET.id);
  const connection=connectionFromLink(await readFile(path.join(workdir,'supabase/.temp/pooler-url'),'utf8'));
  assert.ok(process.stdin.isTTY,'OWNER_INTERACTIVE_TERMINAL_REQUIRED');
  const terminal=createInterface({input:process.stdin,output:process.stdout});
  try{assert.equal(await terminal.question('إنشاء المستودع الرئيسي فقط،اكتب '+TARGET.id+': '),TARGET.id);}finally{terminal.close();}
  env={...process.env,PGPASSWORD:await ownerPassword(),PGSSLMODE:'require',PGCONNECT_TIMEOUT:'10',PGPASSFILE:path.join(output,'NO_PASSWORD_FILE')};
  delete env.PGOPTIONS;delete env.SUPABASE_DB_PASSWORD;
  const psql=process.env.NAWASRAH_PG_BIN?path.join(process.env.NAWASRAH_PG_BIN,'psql.exe'):path.join(process.env.LOCALAPPDATA,'NawasrahBackup/postgresql-17.11/bin/psql.exe');
  const executor={command:psql,args:[...connection,'-X','-q','-At','-w','-v','ON_ERROR_STOP=1'],env};
  const original=JSON.parse(await readFile(path.join(workdir,'notification-before.json'),'utf8'));
  return await mainWarehouseWithExecutor({executor,reference,original,output,ownerId:options.ownerId,report});
 }catch(error){report.ok=false;report.error=error.message.split('\n')[0];return report;}
 finally{if(env)delete env.PGPASSWORD;assert.equal(await readFile(path.join(root,'supabase/.temp/project-ref'),'utf8'),old);
  report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const r=await runMainWarehouse(process.argv.slice(2));console.log(JSON.stringify({ok:r.ok,output:r.output,error:r.error,warehouseReady:r.warehouseReady,remoteWriteAttempted:r.remoteWriteAttempted}));if(!r.ok)process.exitCode=1;}
 catch(error){console.error(error.message.split('\n')[0]);process.exitCode=1;}
}
