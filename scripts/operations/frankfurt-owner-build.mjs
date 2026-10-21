// Owner-operated preparation/build. Default is read-only against the managed project.
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,copyFile,realpath} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildEmptyProjectInput,executeInput,seedHistoryStructureSql} from './build-empty-supabase.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {migrationManifest,canonicalLf,canonicalDefinitionLf,renderFunctionReference} from '../testing/maintenance-db-contract.mjs';
import {cronInventorySql,assessBuildCron} from './build-cron-report.mjs';
import {readNotificationSnapshot,validateOriginalNotifications,transitionNotifications,notificationTransitionSql} from './frankfurt-notification-hold.mjs';
import {verifyCatalogReadOnly,readOnlyPsqlSessionArgs} from './frankfurt-catalog-verification.mjs';

export const TARGET=Object.freeze({id:'kzevmysfydaslxcerogt',name:'nawasrah-fra',region:'eu-central-1'});
export const OLD_REF='acjtabdqqnpwhdvbvnyw';
export const DEFAULT_WORKDIR='C:/Users/TOP/NawasrahFrankfurt/nawasrah-fra-001-138';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile);
const cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function assertOutsideRepository(workdir,repository=root){
 const relative=path.relative(repository,workdir);
 assert.ok(relative.startsWith('..'+path.sep)||path.isAbsolute(relative),'EXTERNAL_WORKDIR_REQUIRED');
}
export function checkProject(project,localMajor=17){
 assert.ok(project,'TARGET_PROJECT_NOT_VISIBLE');
 for(const key of ['id','name','region'])assert.equal(project[key],TARGET[key],'TARGET_METADATA_MISMATCH:'+key);
 assert.equal(project.status,'ACTIVE_HEALTHY','TARGET_NOT_HEALTHY');
 assert.equal(Number(project.database.postgres_engine),localMajor,'POSTGRES_MAJOR_MISMATCH');
 return {id:project.id,name:project.name,region:project.region,status:project.status,
  postgresVersion:project.database.version,postgresMajor:localMajor,createdAt:project.created_at};
}
export function connectionFromLink(text){
 const url=new URL(text.trim());
 assert.equal(url.password,'','LINK_MUST_NOT_PERSIST_PASSWORD');
 assert.equal(decodeURIComponent(url.username),'postgres.'+TARGET.id,'POOLER_TARGET_MISMATCH');
 assert.match(url.hostname,/^aws-[a-z0-9-]+-eu-central-1\.pooler\.supabase\.com$/u,'POOLER_REGION_MISMATCH');
 assert.equal(url.port,'5432','SESSION_POOLER_REQUIRED');
 assert.equal(url.pathname,'/postgres','EXPECTED_DATABASE_REQUIRED');
 return ['-h',url.hostname,'-p',url.port,'-U',decodeURIComponent(url.username),'-d','postgres'];
}
async function cliCall(args,workdir,env=process.env){
 try{return await exec(process.execPath,[cli,...args,'--workdir',workdir,'--agent','no'],
  {cwd:workdir,env,windowsHide:true,maxBuffer:32*1024**2});}
 catch{throw new Error('CLI_STEP_FAILED:'+args.slice(0,2).join('-'));} // Never emit captured CLI bodies.
}
export async function ownerPassword(){
 assert.ok(process.stdin.isTTY,'OWNER_INTERACTIVE_TERMINAL_REQUIRED');
 process.stdout.write('أدخل كلمة سر قاعدة فرانكفورت (مخفية، في الذاكرة فقط):\n');
 return await new Promise((resolve,reject)=>{
  const command='[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false); $fraSecret=New-Object Security.SecureString; try { while($true) { $fraKey=[Console]::ReadKey($true); if($fraKey.Key -eq "Enter") { break }; if($fraKey.Key -eq "Backspace") { if($fraSecret.Length -gt 0) { $fraSecret.RemoveAt($fraSecret.Length-1) }; continue }; if([int]$fraKey.KeyChar -ge 32) { $fraSecret.AppendChar($fraKey.KeyChar) } }; $fraPtr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($fraSecret); try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($fraPtr)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($fraPtr) } } finally { $fraSecret.Dispose() }';
  const child=spawn('powershell.exe',['-NoProfile','-Command',command],{stdio:['inherit','pipe','inherit']});
  let value='';child.stdout.setEncoding('utf8');child.stdout.on('data',s=>value+=s);
  child.on('error',()=>reject(new Error('PASSWORD_PROMPT_FAILED')));
  child.on('close',code=>code===0&&value?resolve(value):reject(new Error('PASSWORD_PROMPT_FAILED')));
 });
}
export async function holdBuildGuard(executor,input){
 const child=spawn(executor.command,executor.args,{env:executor.env,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let ready=false,output='',diagnostic='';
 const closed=new Promise(resolve=>child.once('close',resolve));
 const opened=new Promise((resolve,reject)=>{
  child.stdout.setEncoding('utf8');child.stdout.on('data',s=>{
   output+=s;if(!ready&&output.includes('FRA_GUARD_READY')){ready=true;resolve();}
  });
  child.stderr.setEncoding('utf8');child.stderr.on('data',s=>diagnostic+=s); // Memory only.
  child.once('error',()=>reject(new Error('EMPTY_GUARD_START_FAILED')));
  child.once('close',()=>{if(!ready)reject(new Error(diagnostic.includes('EMPTY_PROJECT_REQUIRED')?
   'EMPTY_PROJECT_REQUIRED':diagnostic.includes('EMPTY_BUILD_ALREADY_RUNNING')?'EMPTY_BUILD_ALREADY_RUNNING':'EMPTY_TARGET_GUARD_FAILED'));});
  child.stdin.on('error',()=>{});
  child.stdin.write(Buffer.concat([input,Buffer.from('\n\\echo FRA_GUARD_READY\n')]));
 });
 await opened;
 return {assertHeld:()=>{assert.equal(child.exitCode,null,'BUILD_GUARD_LOST');assert.equal(child.signalCode,null,'BUILD_GUARD_LOST');},close:async()=>{
  child.stdin.end();await closed;
 }};
}
// Exact read-only query used by the existing isolated DB_FUNCTIONS generator.
// Verify its source shape before extracting it; never execute a migration-derived body.
export async function functionReference(executor,ceiling=139){
 const source=await readFile(path.join(root,'scripts/testing/generate-db-functions.mjs'),'utf8');
 const query=source.match(/const query = `(BEGIN READ ONLY;[\s\S]+?ROLLBACK;)`;/u)?.[1];
 assert.ok(query&&query.includes("n.nspname='public'")&&!query.includes('${'),'FUNCTION_REFERENCE_QUERY_CHANGED');
 const read=await executeInput(executor,query);assert.equal(read.code,0,'FUNCTION_REFERENCE_READ_FAILED');
 const functions=JSON.parse(read.stdout.trim()).map(row=>({...row,definition:canonicalDefinitionLf(row.definition)}));
 if(ceiling===138){
  // Frozen pre139 reference: keep the owner's existing138 diagnostics usable.
  // This is the approved complete410-function hash,not a learned runtime hash.
  assert.equal(functions.length,410,'FROZEN138_FUNCTION_COUNT');
  const ordered=[...functions].sort((a,b)=>a.identity<b.identity?-1:a.identity>b.identity?1:0);
  assert.equal(digest(JSON.stringify(ordered)),'edc400709df70e238245eb5233042e236fb763e95290a1fc3643d61f7e59ac4b','FROZEN138_FUNCTIONS_CHANGED');
 }else if([139,150,151].includes(ceiling)){
  // Historical regression references remain pinned to their delivered public
  // definitions, rather than comparing them to164's newer generated manual.
  const ordered=[...functions].sort((a,b)=>a.identity<b.identity?-1:a.identity>b.identity?1:0);
  assert.equal(digest(JSON.stringify(ordered)),'585f25209c1d081a7c6f2434c4472d61c62bac491cae1fe4724cba92e83bee64','FROZEN151_FUNCTIONS_CHANGED');
 }else if(ceiling===164){
  const ordered=[...functions].sort((a,b)=>a.identity<b.identity?-1:a.identity>b.identity?1:0);
  assert.equal(functions.length,446,'FROZEN164_FUNCTION_COUNT');
  assert.equal(digest(JSON.stringify(ordered)),'663c5e60b93dde083dd9e9d8706df78c331f2d54b3713a468fc62bd71c9feafd','FROZEN164_FUNCTIONS_CHANGED');
 }else if(ceiling===171){
  const ordered=[...functions].sort((a,b)=>a.identity<b.identity?-1:a.identity>b.identity?1:0);
  assert.equal(functions.length,454,'FROZEN171_FUNCTION_COUNT');
  assert.equal(digest(JSON.stringify(ordered)),'83c73f285e3d15e8d8f842cc212a122927c5bc2ea787a37de4d716a0a8a9c09a','FROZEN171_FUNCTIONS_CHANGED');
 }else if(ceiling===182){
  const ordered=[...functions].sort((a,b)=>a.identity<b.identity?-1:a.identity>b.identity?1:0);
  assert.equal(functions.length,468,'FROZEN182_FUNCTION_COUNT');
  assert.equal(digest(JSON.stringify(ordered)),'41d567876dd14d6ed1a068590bcd24819113e341f73f39d95146e2914b212ea5','FROZEN182_FUNCTIONS_CHANGED');
 }else if(ceiling===195){
  const ordered=[...functions].sort((a,b)=>a.identity<b.identity?-1:a.identity>b.identity?1:0);
  assert.equal(functions.length,505,'FROZEN195_FUNCTION_COUNT');
  assert.equal(digest(JSON.stringify(ordered)),'823ce50eab9023c5af500e4c1e78aa7e1461a9aa8e235a9431d1a553ad9f9650','FROZEN195_FUNCTIONS_CHANGED');
 }else if(ceiling===196){
  const ordered=[...functions].sort((a,b)=>a.identity<b.identity?-1:a.identity>b.identity?1:0);
  assert.equal(functions.length,511,'FROZEN196_FUNCTION_COUNT');
  assert.equal(digest(JSON.stringify(ordered)),'034974701a0f4f518944f5e7ee0df1bb02074fd3e30aa2962ff9be24d2b7c01f','FROZEN196_FUNCTIONS_CHANGED');
 }else if(ceiling===197){
  const ordered=[...functions].sort((a,b)=>a.identity<b.identity?-1:a.identity>b.identity?1:0);
  assert.equal(functions.length,511,'FROZEN197_FUNCTION_COUNT');
  assert.equal(digest(JSON.stringify(ordered)),'93a2159a862ff78a5a841f7b7d5f328214e418bd4d069f708e7c24bb274e52b7','FROZEN197_FUNCTIONS_CHANGED');
 }else if(ceiling===198){
  const ordered=[...functions].sort((a,b)=>a.identity<b.identity?-1:a.identity>b.identity?1:0);
  assert.equal(functions.length,511,'FROZEN198_FUNCTION_COUNT');
  // DB_REFERENCE.definitionsDigest from accepted8118704, not learned at runtime.
  assert.equal(digest(JSON.stringify(ordered)),'279875bd84faef619e75cedcc84319ffb130d91715f828982f9d4e955cc2eb1e','FROZEN198_FUNCTIONS_CHANGED');
 }else if(ceiling===199){
  const ordered=[...functions].sort((a,b)=>a.identity<b.identity?-1:a.identity>b.identity?1:0);
  assert.equal(functions.length,513,'FROZEN199_FUNCTION_COUNT');
  assert.equal(digest(JSON.stringify(ordered)),'71a157fa3f09e3637c4c7c75e8c9618aff39d3046df6496e0ae4a403def3fac5','FROZEN199_FUNCTIONS_CHANGED');
 }else if(ceiling===200){
  const ordered=[...functions].sort((a,b)=>a.identity<b.identity?-1:a.identity>b.identity?1:0);
  assert.equal(functions.length,513,'FROZEN200_FUNCTION_COUNT');
  assert.equal(digest(JSON.stringify(ordered)),"fe42f63ed1ecf7582b1d9c7b15fa43266e2798fff25cb00ee607b1344b39628a",'FROZEN200_FUNCTIONS_CHANGED');
 }else if(ceiling===201){
  const ordered=[...functions].sort((a,b)=>a.identity<b.identity?-1:a.identity>b.identity?1:0);
  assert.equal(functions.length,516,'FROZEN201_FUNCTION_COUNT');
  assert.equal(digest(JSON.stringify(ordered)),'12e3a0712e9f0e1c7e944cd3e2627104a826f40a825f4be72efecfb1b6c73da5','FROZEN201_FUNCTIONS_CHANGED');
 }else if(ceiling===202){
  // Immutable5b1a97b manual;not a claim of completed202 FULLCI.
  const ordered=[...functions].sort((a,b)=>a.identity<b.identity?-1:a.identity>b.identity?1:0);
  assert.equal(functions.length,516,'FROZEN202_FUNCTION_COUNT');
  assert.equal(digest(JSON.stringify(ordered)),'b16f7cfd07d63b5b47dfed3a56721e45a0290ec5925cae5d79a2863c8bed5888','FROZEN202_FUNCTIONS_CHANGED');
 }else if(ceiling===203){
  const ordered=[...functions].sort((a,b)=>a.identity<b.identity?-1:a.identity>b.identity?1:0);assert.equal(functions.length,516,'FROZEN203_FUNCTION_COUNT');assert.equal(digest(JSON.stringify(ordered)),'f944d6efa506070206553723e6754672c17a95139d6c135c80f6bbd2197833a5','FROZEN203_FUNCTIONS_CHANGED');
 }else if(ceiling===204){
  const ordered=[...functions].sort((a,b)=>a.identity<b.identity?-1:a.identity>b.identity?1:0);assert.equal(functions.length,517,'FROZEN204_FUNCTION_COUNT');assert.equal(digest(JSON.stringify(ordered)),'d810bf28e7f6aa89b954430f11ab2194da0748e4b93ce58ffb0bfac0444d1d7d','FROZEN204_FUNCTIONS_CHANGED');
 }else if(ceiling===205){
  const ordered=[...functions].sort((a,b)=>a.identity<b.identity?-1:a.identity>b.identity?1:0);assert.equal(functions.length,519,'FROZEN205_FUNCTION_COUNT');assert.equal(digest(JSON.stringify(ordered)),'44d4912a69fc2cc45bd51ceb8238d9dd7311cf7b7ee54b0299457725aab26ef1','FROZEN205_FUNCTIONS_CHANGED');
 }else if(ceiling===206){
  // Frozen accepted C6/main413 manual; historical references never read the current207 manual.
  const ordered=[...functions].sort((a,b)=>a.identity<b.identity?-1:a.identity>b.identity?1:0);assert.equal(functions.length,520,'FROZEN206_FUNCTION_COUNT');assert.equal(digest(JSON.stringify(ordered)),'30add3d828c117a5d2b9cc400a6ba6a7537829097e78431a598ec63beb6e512a','FROZEN206_FUNCTIONS_CHANGED');
 }else if(ceiling===207){
  // Accepted a637/main207 manual, byte-identical at delivered C8/main7e325.
  const ordered=[...functions].sort((a,b)=>a.identity<b.identity?-1:a.identity>b.identity?1:0);assert.equal(functions.length,523,'FROZEN207_FUNCTION_COUNT');assert.equal(digest(JSON.stringify(ordered)),'8b763fc1e0348b012fbcfa0206c59b4e2f20b8a42adf45309f18444d97bd75cc','FROZEN207_FUNCTIONS_CHANGED');
 }else{
  assert.equal(ceiling,208,'UNAPPROVED_FUNCTION_REFERENCE');
  const rendered=renderFunctionReference(await migrationManifest(root),functions);
  assert.equal(rendered,canonicalLf(await readFile(path.join(root,'docs/generated/DB_FUNCTIONS.md'),'utf8')),'DB_FUNCTIONS_STALE');
 }
 return functions.length;
}
async function prepare(workdir){
 assertOutsideRepository(workdir);await mkdir(workdir,{recursive:true});
 assertOutsideRepository(await realpath(workdir),await realpath(root));
 const old=await readFile(path.join(root,'supabase/.temp/project-ref'));
 assert.equal(old.toString().trim(),OLD_REF,'OLD_BACKUP_LINK_CHANGED');
 const listing=await exec('git',['ls-files','-z','--','supabase'],{cwd:root,encoding:'utf8'});
 for(const file of listing.stdout.split('\0').filter(file=>file&&!file.startsWith('supabase/.temp/')&&
  !(file.startsWith('supabase/migrations/')&&Number(path.basename(file).slice(0,3))>138))){
  assert.ok(!/(?:^|\/)\.temp\/|(?:^|\/)\.env|secret/iu.test(file),'UNSAFE_COPY_PATH');
  const target=path.join(workdir,file);await mkdir(path.dirname(target),{recursive:true});
  assertOutsideRepository(await realpath(path.dirname(target)),await realpath(root));
  try{assert.equal(digest(await readFile(target)),digest(await readFile(path.join(root,file))),'WORKDIR_EXISTING_BYTES_MISMATCH');}
  catch(error){if(error.code!=='ENOENT')throw error;await copyFile(path.join(root,file),target);}
 }
 const original=await buildEmptyProjectInput(root),copy=await buildEmptyProjectInput(workdir);
 assert.deepEqual(copy.manifest,original.manifest,'WORKDIR_HISTORY_MISMATCH');
 const tempRoot=path.join(workdir,'supabase/.temp');
 const realTemp=await realpath(tempRoot).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
 if(realTemp){assertOutsideRepository(realTemp,await realpath(root));
  assert.ok(!path.relative(await realpath(workdir),realTemp).startsWith('..'),'EXTERNAL_TEMP_ESCAPE');}
 assert.equal((await readFile(path.join(workdir,'supabase/.temp/project-ref'),'utf8').catch(e=>{
  if(e.code==='ENOENT')return TARGET.id;throw e;})).trim(),TARGET.id,'EXTERNAL_LINK_TARGET_MISMATCH');
 return {old,build:copy};
}
async function localReference(workdir){
 const project='nawasrah-frankfurt-owner-reference-test',container='supabase_db_'+project;
 let local;
 try{
  const {stdout}=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],
   {cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,
    NAWASRAH_MAX_MIGRATION:'138',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
    NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
  local=JSON.parse(stdout).isolatedProjectRoot;
  const executor={command:'docker',args:['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1']};
  const read=await executeInput(executor,schemaCatalogSql);assert.equal(read.code,0,'LOCAL_CATALOG_FAILED');
  const version=await executeInput(executor,"SELECT current_setting('server_version');");
  assert.equal(version.code,0,'LOCAL_VERSION_FAILED');
  assert.equal(Number(version.stdout.trim().split('.')[0]),17,'LOCAL_POSTGRES_MAJOR_CHANGED');
  const functions=await functionReference(executor,138);
  const cron=await executeInput(executor,cronInventorySql);assert.equal(cron.code,0,'CRON_INVENTORY_FAILED');
  const buildDate=await executeInput(executor,"SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;");
  assert.equal(buildDate.code,0,'LOCAL_BUILD_DATE_FAILED');
  const reference={manifest:(await buildEmptyProjectInput(root)).manifest,postgresVersion:version.stdout.trim(),
   buildUtcDate:buildDate.stdout.trim(),catalogQuerySha256:digest(schemaCatalogSql),
   catalog:JSON.parse(read.stdout.trim()),functions,cronAudit:assessBuildCron(JSON.parse(cron.stdout.trim()))};
  reference.notificationSnapshot=validateOriginalNotifications(await readNotificationSnapshot(executor));
  await writeFile(path.join(workdir,'local-reference.json'),JSON.stringify(reference,null,2)+'\n');
  return reference;
 }catch(error){if(error.code&&error.code!=='ERR_ASSERTION')throw new Error('LOCAL_REFERENCE_FAILED',{cause:error});throw error;}
 finally{if(local)await cliCall(['stop','--no-backup'],local);}
}
/** Test I/O seams are programming-only;there is no CLI credential/target override.
 * @param {{readProjects?:()=>Promise<object[]>,confirmTarget?:()=>Promise<void>,readPassword?:()=>Promise<string>,executor?:(connection:string[],env:NodeJS.ProcessEnv)=>{command:string,args:string[],env?:NodeJS.ProcessEnv}} [io]
 */
export async function run(args,io={}){
 const modes=['--apply','--dry-run','--verify-only','--apply-139'].filter(m=>args.includes(m));
 assert.ok(modes.length<=1,'ONE_MODE_REQUIRED');
 const mode=args.includes('--verify-only')?'verify-only':args.includes('--apply-139')?'apply-139':args.includes('--apply')?'apply':'dry-run';
 assert.ok(Object.keys(io).length===0||mode==='verify-only','VERIFY_IO_ONLY');
 assert.ok(args.every((v,i)=>['--apply','--dry-run','--verify-only','--apply-139','--local-reference','--workdir'].includes(v)||args[i-1]==='--workdir'),'UNKNOWN_OPTION');
 assert.ok(!args.includes('--local-reference')||mode==='dry-run','LOCAL_REFERENCE_BEFORE_APPLY');
 const at=args.indexOf('--workdir'),workdir=path.resolve(at<0?DEFAULT_WORKDIR:args[at+1]);
 assert.ok(!process.env.SUPABASE_CLI_BINARY_OVERRIDE,'CLI_OVERRIDE_NOT_ALLOWED');
 const {old,build}=await prepare(workdir);
 const report={mode,startedAt:new Date().toISOString(),workdir,applied:[],recorded:[],remoteWrites:false};
 let stage='project-metadata',childEnv,guard;
 try{
  const projects=io.readProjects?await io.readProjects():JSON.parse((await cliCall(['projects','list','--output','json'],workdir)).stdout);
  report.project=checkProject(projects.find(p=>p.id===TARGET.id));
  report.history=build.manifest;
  if(args.includes('--local-reference')){assert.equal(mode,'dry-run','LOCAL_REFERENCE_BEFORE_APPLY');await localReference(workdir);}
  if(mode==='dry-run'){
   report.ok=true;report.linked=false;report.passwordRequested=false;
   report.historicalEffects={storageMigration:'020',cronMigrations:['091','092','097','098','099'],seedExecuted:false};
   return report;
  }
  stage='local-reference-check';
  const reference=JSON.parse(await readFile(path.join(workdir,'local-reference.json'),'utf8'));
  assert.equal(reference.catalogQuerySha256,digest(schemaCatalogSql),'REFERENCE_NEEDS_REBUILD');
  assert.match(reference.buildUtcDate,/^\d{4}-\d{2}-\d{2}$/u,'REFERENCE_BUILD_DATE_REQUIRED');
  assert.ok(report.project.createdAt,'MANAGED_PLATFORM_BUILD_DATE_REQUIRED');
  assert.deepEqual(reference.manifest,build.manifest,'REFERENCE_HISTORY_CHANGED');
  assert.equal(reference.cronAudit?.requiresOwnerReview,false,'EXTERNAL_EFFECT_REVIEW_REQUIRED');
  validateOriginalNotifications(reference.notificationSnapshot);
  checkProject(projects.find(p=>p.id===TARGET.id),Number(reference.postgresVersion.split('.')[0]));
  if(mode==='verify-only'||mode==='apply-139'){
   // Existing owner-created external link only. Never call CLI link/repair/push.
   stage='verify-existing-link';
   assert.equal((await readFile(path.join(workdir,'supabase/.temp/project-ref'),'utf8')).trim(),TARGET.id,'LINK_TARGET_MISMATCH');
   connectionFromLink(await readFile(path.join(workdir,'supabase/.temp/pooler-url'),'utf8'));
  }
  if(io.confirmTarget)await io.confirmTarget();
  else{
   assert.ok(process.stdin.isTTY,'OWNER_INTERACTIVE_TERMINAL_REQUIRED');
   const terminal=createInterface({input:process.stdin,output:process.stdout});
   try{assert.equal(await terminal.question((mode==='verify-only'?'تحقق قراءة فقط؛ لا إعادة تطبيق.':mode==='apply-139'?'تطبيق139 فقط بعد نجاح تحقق138؛ لا تفعيل إشعارات.':'الوضع الجاف ناجح. التطبيق ينشئ أيضاً cron/storage التاريخية.')+' للتأكيد اكتب '+TARGET.id+': '),TARGET.id,'OWNER_CONFIRMATION_REQUIRED');}
   finally{terminal.close();}
  }
  const password=io.readPassword?await io.readPassword():await ownerPassword();
  const env={...process.env,SUPABASE_PROJECT_ID:TARGET.id,SUPABASE_DB_PASSWORD:password,
   PGPASSWORD:password,PGSSLMODE:'require',PGCONNECT_TIMEOUT:'10',PGPASSFILE:path.join(workdir,'NO_PASSWORD_FILE')};
  childEnv=env;
  if(mode==='verify-only'){
   delete env.PGOPTIONS; // Do not rely on startup options crossing a pooler.
   report.readOnly=true;report.linkPerformed=false;report.passwordRequested=true;
  }else if(mode!=='apply-139'){stage='external-link';await cliCall(['link','--project-ref',TARGET.id],workdir,env);}
  assert.equal((await readFile(path.join(workdir,'supabase/.temp/project-ref'),'utf8')).trim(),TARGET.id,'LINK_TARGET_MISMATCH');
  const connection=connectionFromLink(await readFile(path.join(workdir,'supabase/.temp/pooler-url'),'utf8'));
  const psql=process.env.NAWASRAH_PG_BIN?path.join(process.env.NAWASRAH_PG_BIN,'psql.exe'):
   path.join(process.env.LOCALAPPDATA,'NawasrahBackup/postgresql-17.11/bin/psql.exe');
  const executor=io.executor?io.executor(connection,env):{command:psql,args:[...connection,'-X','-q','-At','-w','-v','ON_ERROR_STOP=1',...(mode==='verify-only'?readOnlyPsqlSessionArgs:[])],env};
  // Credentials go to the child in memory,never global env/argv/files.
  // No automatic SQL recovery or changes to the historical migration buffers.
  const sql=input=>new Promise((resolve,reject)=>{
   const child=spawn(executor.command,executor.args,{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
   let stdout='',stderr='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
   child.stdout.on('data',s=>stdout+=s);child.stderr.on('data',s=>stderr+=s);
   child.on('error',()=>reject(new Error('PSQL_START_FAILED')));child.stdin.on('error',()=>{});
   child.on('close',code=>resolve({code,stdout,stderr}));child.stdin.end(input);
  });
  stage='connected-version';const version=await sql("SELECT current_setting('server_version');");
  assert.equal(version.code,0,'SERVER_VERSION_READ_FAILED');
  report.connectedPostgresVersion=version.stdout.trim();
  assert.equal(Number(report.connectedPostgresVersion.split('.')[0]),17,'POSTGRES_MAJOR_MISMATCH');
  if(mode==='verify-only'){
   stage='full-catalog';
   const readOnly=await sql('SHOW transaction_read_only;');
   assert.equal(readOnly.code,0,'READ_ONLY_CHECK_FAILED');
   assert.equal(readOnly.stdout.trim(),'on','READ_ONLY_SESSION_REQUIRED');
   const original=JSON.parse(await readFile(path.join(workdir,'notification-before.json'),'utf8'));
   await verifyCatalogReadOnly(executor,workdir,reference,original,{
    beforeBuildDate:reference.buildUtcDate,afterBuildDate:new Date(report.project.createdAt).toISOString().slice(0,10)},report);
   report.ok=true;return report;
  }
  if(mode==='apply-139'){
   // Owner-only later command. Never re-run001-138 or configure/enable delivery.
   stage='139-prior-verification';
   const prior=JSON.parse(await readFile(path.join(workdir,'last-verify-report.json'),'utf8'));
   assert.equal(prior.ok,true,'VERIFY138_MUST_PASS_FIRST');
   assert.equal(prior.mode,'verify-only','VERIFY138_REQUIRED');
   const original=JSON.parse(await readFile(path.join(workdir,'notification-before.json'),'utf8'));
   guard=await holdBuildGuard(executor,Buffer.from("DO $$ BEGIN IF NOT pg_try_advisory_lock(734034138) THEN RAISE EXCEPTION 'EMPTY_BUILD_ALREADY_RUNNING';END IF;END $$;\n"));
   await verifyCatalogReadOnly(executor,workdir,reference,original,{
    beforeBuildDate:reference.buildUtcDate,afterBuildDate:new Date(report.project.createdAt).toISOString().slice(0,10)},report);
   const {apply139,read139Input}=await import('./frankfurt-migration139.mjs');
   const unit=await read139Input(root);
   // A new file is copied only for this explicit owner command,never verify-only.
   const target=path.join(workdir,'supabase/migrations',unit.name);
   try{assert.equal(digest(await readFile(target)),unit.rawSha256,'EXISTING139_BYTES_MISMATCH');}
   catch(error){if(error.code!=='ENOENT')throw error;await copyFile(path.join(root,'supabase/migrations',unit.name),target);}
   stage='139-apply';guard.assertHeld();
   report.migration139={};
   await apply139(executor,unit,async()=>{
    report.applied.push(unit.name);
    await cliCall(['migration','repair','--linked','--status','applied','139'],workdir,env);
    report.recorded.push('139');
   },report.migration139,()=>{report.remoteWrites=true;});
   stage='139-dry-run';const dry139=await cliCall(['db','push','--linked','--dry-run','--skip-vault'],workdir,env);
   assert.match(dry139.stdout+dry139.stderr,/up to date/iu,'PENDING_MIGRATIONS');
   stage='139-DB_FUNCTIONS';report.functions=await functionReference(executor,139);
   report.ok=true;return report;
  }
  stage='empty-target-guard';guard=await holdBuildGuard(executor,build.initial);
  for(const unit of build.units){
   guard.assertHeld();
   assert.equal(digest(await readFile(path.join(workdir,'supabase/migrations',unit.name))),
    build.manifest.find(m=>m.name===unit.name).sha256,'WORKDIR_HISTORY_CHANGED');
   stage='apply-'+unit.name.slice(0,3);report.remoteWrites=true;
   const result=await sql(Buffer.concat([Buffer.from('SET search_path=public,pg_temp;\n'),unit.input]));
   if(result.code!==0)report.sqlFailure=result.stderr.match(/ENV034_[A-Z_]+(?::[a-z_]+)?|EMPTY_PROJECT_REQUIRED/u)?.[0]??'MIGRATION_SQL_FAILURE';
   assert.equal(result.code,0,'MIGRATION_SQL_FAILURE:'+unit.name);report.applied.push(unit.name);
   stage='repair-'+unit.name.slice(0,3);
   await cliCall(['migration','repair','--linked','--status','applied',unit.name.slice(0,3)],workdir,env);
   report.recorded.push(unit.name.slice(0,3));
  }
  stage='post138-notification-hold';guard.assertHeld();
  const originalNotifications=validateOriginalNotifications(await readNotificationSnapshot(executor));
  // Save nonsecret exact scheduler/trigger metadata BEFORE disabling anything.
  await writeFile(path.join(workdir,'notification-before.json'),JSON.stringify(originalNotifications,null,2)+'\n');
  await writeFile(path.join(workdir,'restore-notifications.sql'),notificationTransitionSql(originalNotifications,true)+'\n');
  report.notificationHold={originalFile:'notification-before.json',restoreFile:'restore-notifications.sql',
   state:await transitionNotifications(executor,originalNotifications),implemented:true};
  stage='empty-seed-history';assert.equal((await sql(seedHistoryStructureSql)).code,0,'SEED_STRUCTURE_FAILED');
  stage='history-list';await cliCall(['migration','list','--linked'],workdir,env);
  const history=await sql("SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations;");
  assert.equal(history.code,0,'HISTORY_READ_FAILED');assert.deepEqual(JSON.parse(history.stdout.trim()),report.recorded);
  assert.equal((await sql('SELECT count(*) FROM supabase_migrations.seed_files;')).stdout.trim(),'0','SEED_NOT_ALLOWED');
  stage='dry-run';const dry=await cliCall(['db','push','--linked','--dry-run','--skip-vault'],workdir,env);
  assert.match(dry.stdout+dry.stderr,/up to date/iu,'PENDING_MIGRATIONS');
  stage='full-catalog';
  await verifyCatalogReadOnly(executor,workdir,reference,originalNotifications,{
   beforeBuildDate:reference.buildUtcDate,afterBuildDate:new Date(report.project.createdAt).toISOString().slice(0,10)},report);
  stage='cron-inventory';const cron=await sql(cronInventorySql);assert.equal(cron.code,0,'CRON_INVENTORY_FAILED');
  report.cronAudit=assessBuildCron(JSON.parse(cron.stdout.trim()));
  assert.equal(report.cronAudit.requiresOwnerReview,false,'EXTERNAL_EFFECT_REVIEW_REQUIRED');
  stage='DB_FUNCTIONS-check';report.functions=await functionReference({...executor,env},138);
  report.ok=true;return report;
 }catch(error){report.ok=false;report.stage=stage;report.error=error.code==='ERR_ASSERTION'?error.message.split('\n')[0]:error.message.startsWith('CLI_STEP_FAILED:')?error.message:'PREPARATION_OR_BUILD_FAILED';return report;}
 finally{
  if(guard)await guard.close(); // Releases only our read-only advisory-lock session.
  if(childEnv){delete childEnv.PGPASSWORD;delete childEnv.SUPABASE_DB_PASSWORD;}
  report.endedAt=new Date().toISOString();
  assert.equal(digest(await readFile(path.join(root,'supabase/.temp/project-ref'))),digest(old),'OLD_BACKUP_LINK_CHANGED');
  await writeFile(path.join(workdir,mode==='verify-only'?'last-verify-report.json':mode==='apply-139'?'last-139-report.json':'last-report.json'),JSON.stringify(report,null,2)+'\n');
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{
  const report=await run(process.argv.slice(2));
  // Full DDL evidence belongs in local files,not console logs/password captures.
  const output=report.catalogComparison?{mode:report.mode,ok:report.ok,stage:report.stage,error:report.error,
   readOnly:report.readOnly,remoteWrites:report.remoteWrites,applied:report.applied.length,recorded:report.recorded.length,
   rawDifferences:report.catalogComparison.rawDifferences.length,differences:report.catalogDifferences?.length,
   differencesFile:report.catalogDifferencesFile,reportFile:path.join(report.workdir,report.mode==='verify-only'?'last-verify-report.json':report.mode==='apply-139'?'last-139-report.json':'last-report.json')}:report;
  console.log(JSON.stringify(output));if(!report.ok)process.exitCode=1;
 }
 catch(error){console.error(error.code==='ERR_ASSERTION'?error.message.split('\n')[0]:'FRANKFURT_PREPARATION_FAILED');process.exitCode=1;}
}
