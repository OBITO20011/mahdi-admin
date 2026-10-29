// Owner-operated only. Default offline dry-run; no agent/implicit target mode.
import assert from 'node:assert/strict';
import {upgradePreparationCode} from './upgrade-preparation-errors.mjs';
import {verifiedSupabaseCa} from '../backup/supabase-ca.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,copyFile,readdir,realpath} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {TARGET,OLD_REF,DEFAULT_WORKDIR,assertOutsideRepository,connectionFromLink,ownerPassword,holdBuildGuard} from './frankfurt-owner-build.mjs';
import {readReference151,readyReference151Name} from './frankfurt-reference151.mjs';
import {generateAclPlan} from './frankfurt-acl-plan.mjs';
import {alignWithExecutor} from './frankfurt-align-acl.mjs';
import {executeInput} from './build-empty-supabase.mjs';
import {schemaCatalogSql,catalogDifference} from '../testing/schema-catalog.mjs';
import {canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {readRealtimePublication,verify151Publication,realtime151Tables} from '../testing/realtime151-contract.mjs';
import {verify150Catalog} from '../testing/table-read-privileges150-contract.mjs';
import {readNotificationSnapshot,expectedHeldNotifications} from './frankfurt-notification-hold.mjs';
import {compareManagedCatalog} from './managed-catalog-policy.mjs';
import {verifyCatalogReadOnly} from './frankfurt-catalog-verification.mjs';
import {run as offlinePlan} from './frankfurt-align-acl.mjs';
import {forecast150} from './forecast-grants150.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile);
export const upgradeVersions=Object.freeze(['139','150','151']);
// Separate connections cannot reacquire the same exclusive advisory key.
// The inner ACL transaction keeps its existing734034138 key unchanged.
export const upgradeLockKey=734151139;
export const holdUpgradeGuard=executor=>holdBuildGuard(executor,Buffer.from(`DO $$ BEGIN IF NOT pg_try_advisory_lock(${upgradeLockKey}) THEN RAISE EXCEPTION 'EMPTY_BUILD_ALREADY_RUNNING';END IF;END $$;\n`));
export const historySql='BEGIN READ ONLY;SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations;ROLLBACK;';
export function assertUpgradeHistory(history){
 const base=Array.from({length:138},(_,i)=>String(i+1).padStart(3,'0'));
 assert.ok(history.length>=138&&history.length<=141,'UPGRADE_REQUIRES138_THEN139_150_151');
 assert.deepEqual(history,[...base,...upgradeVersions.slice(0,history.length-138)],'UNREVIEWED_HISTORY_OR_STARTUP_BRANCH');
 return upgradeVersions.slice(history.length-138);
}
export async function upgradeInputs(reference){
 return Promise.all(upgradeVersions.map(async version=>{
  const entry=reference.manifest.find(m=>m.name.startsWith(version+'_'));assert.ok(entry,'UPGRADE_MANIFEST_MISSING');
  const input=await readFile(path.join(root,'supabase/migrations',entry.name));
  assert.equal(sha256(canonicalLf(input.toString('utf8'))),entry.sha256,'UPGRADE_PIN_MISMATCH');
  return {...entry,version,input};
 }));
}
// Explicit executor seam for isolated Docker rehearsal only; no CLI target or
// credentials can be supplied through command-line flags.
export async function upgradeWithExecutor({executor,reference,original,output,repair,finalDryRun,report={}}){
 const sql=async text=>{const r=await executeInput(executor,text);assert.equal(r.code,0,'UPGRADE_SQL_FAILED');return r.stdout.trim();};
 const catalog=async()=>JSON.parse(await sql(schemaCatalogSql));
 const history=async()=>JSON.parse(await sql(historySql));
 const dates={beforeBuildDate:reference.buildUtcDate,afterBuildDate:await sql("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;")};
 report.applied??=[];report.recorded??=[];report.remoteWriteAttempted=false;
 const initial=await history(),pending=assertUpgradeHistory(initial),inputs=await upgradeInputs(reference);
 const held=expectedHeldNotifications(original),checkHold=async()=>assert.deepEqual(await readNotificationSnapshot(executor),held,'UPGRADE_NOTIFICATION_HOLD_CHANGED');
 await checkHold();
 let before=await catalog(),pub=await readRealtimePublication(executor);
 // Reject structural/owner/RLS/definition drift before the first write. The
 // sole old139 body is a named,pinned prerequisite,never a generic exemption.
 await writeFile(path.join(output,'preflight-catalog.json'),JSON.stringify(before,null,2)+'\n');
 await writeFile(path.join(output,'preflight-comparison.json'),JSON.stringify(compareManagedCatalog(reference.catalog,before,dates),null,2)+'\n');
 await writeFile(path.join(output,'preflight-publication.json'),JSON.stringify(pub,null,2)+'\n');
 const preview=generateAclPlan(reference.catalog,before,{offlinePending139:true});
 report.preflight={commands:preview.commandCount,objects:preview.objectCount,pending139:preview.prerequisites};
 await writeFile(path.join(output,'preflight-plan.json'),JSON.stringify(preview,null,2)+'\n');
 assert.deepEqual(pub.publication,reference.realtimePublication.publication,'UPGRADE_PUBLICATION_OPTIONS_DRIFT');
 for(const table of pub.tables){
  assert.ok(realtime151Tables.includes(table.name)&&table.schema==='public','UNREVIEWED_PUBLICATION_MEMBER');
  assert.deepEqual(table,reference.realtimePublication.tables.find(t=>t.name===table.name),'UPGRADE_MEMBER_DEFINITION_DRIFT');
 }
 if(!pending.includes('139'))assert.equal(preview.prerequisites.length,0,'RECORDED139_BODY_DRIFT');
 if(!pending.includes('151'))assert.deepEqual(pub,reference.realtimePublication,'RECORDED151_MEMBERSHIP_DRIFT');
 for(const unit of inputs.filter(u=>pending.includes(u.version))){
  report.stage='apply-'+unit.version;
  report.remoteWriteAttempted=true;
  await sql(unit.input);report.applied.push(unit.version);
  const after=await catalog(),nextPub=await readRealtimePublication(executor);
  const changes=catalogDifference(before,after);
  await writeFile(path.join(output,'migration-'+unit.version+'-differences.json'),JSON.stringify(changes,null,2)+'\n');
  if(unit.version==='139'){
   assert.equal(changes.length,1,'139_EXPECTS_ONE_FUNCTION_DELTA');
   const d=changes[0];assert.equal(d.section,'functions');assert.equal(d.before.schema,'public');
   assert.equal(d.before.identity,'enqueue_order_push_webhook(p_payload jsonb)');
   assert.deepEqual({...d.before,definition:''},{...d.after,definition:''},'139_METADATA_DRIFT');
   const approved=reference.catalog.functions.find(f=>f.schema==='public'&&f.identity===d.after.identity);
   assert.equal(canonicalLf(d.after.definition),canonicalLf(approved.definition),'139_DEFINITION_DRIFT');
   assert.deepEqual(nextPub,pub);
  }else if(unit.version==='150'){
   verify150Catalog(before,after);
   assert.deepEqual(generateAclPlan(forecast150(before),after).commands,[],'150_FORECAST_NOT_EQUIVALENT');
   assert.deepEqual(nextPub,pub);
  }else{
   assert.deepEqual(changes,[],'151_NON_PUBLICATION_DRIFT');verify151Publication(pub,nextPub);
   assert.deepEqual(nextPub,reference.realtimePublication,'151_EXACT_REFERENCE_MEMBERSHIP');
  }
  await checkHold();
  // Official Supabase migration repair,only AFTER successful literal SQL and
  // postconditions. Failure stops;never silently marks a failed file applied.
  report.stage='repair-'+unit.version;await repair(unit.version);report.recorded.push(unit.version);
  assert.deepEqual(await history(),[...initial,...report.recorded],'UPGRADE_HISTORY_NOT_RECORDED');
  before=after;pub=nextPub;
 }
 report.stage='align-acl';
 const plan=generateAclPlan(reference.catalog,before);
 await writeFile(path.join(output,'alignment.sql'),plan.commands.join('\n')+'\n');
 report.alignmentCommands=plan.commandCount;report.alignmentObjects=plan.objectCount;
 if(plan.commandCount){report.remoteWriteAttempted=true;report.alignment={};await alignWithExecutor(executor,reference,before,original,dates,output,report.alignment);}
 else await verifyCatalogReadOnly(executor,output,reference,original,dates,report);
 const after=await catalog();
 assert.equal(generateAclPlan(reference.catalog,after).commandCount,0,'ACL_PLAN_NOT_EMPTY_AFTER_ALIGNMENT');
 assert.equal(compareManagedCatalog(reference.catalog,after,dates).unexpected.length,0);
 assert.deepEqual(await readRealtimePublication(executor),reference.realtimePublication);
 assert.deepEqual(await history(),reference.appliedVersions,'FINAL_HISTORY_MISMATCH');
 await checkHold();report.stage='official-cli-dry-run';await finalDryRun();
 report.ok=true;report.realtimeMembers=pub.tables.length;report.notificationHoldUnchanged=true;
 report.catalogUnexpectedDifferenceCount=0;return report;
}
// Internal configuration seam for the separately admitted164 CLI. It cannot
// be selected by a command-line target,URL,SQL or credential argument.
export async function run(args,configuration={}){
 const loadReference=configuration.loadReference??readReference151;
 const referenceName=configuration.referenceName??readyReference151Name;
 const pipeline=configuration.pipeline??upgradeWithExecutor;
 const inputsFor=configuration.inputsFor??upgradeInputs;
 const versions=configuration.versions??upgradeVersions;
 const label=configuration.label??'151';
 assert.ok(args.every((v,i)=>['--apply','--dry-run','--verify-only','--workdir'].includes(v)||args[i-1]==='--workdir'),'UNKNOWN_OPTION');
 assert.ok(['--apply','--dry-run','--verify-only'].filter(m=>args.includes(m)).length<=1,'ONE_MODE_REQUIRED');
 if(!args.includes('--apply')&&!args.includes('--verify-only'))return (configuration.offlinePlan??offlinePlan)(args);
 assert.ok(!process.env.SUPABASE_CLI_BINARY_OVERRIDE,'CLI_OVERRIDE_NOT_ALLOWED');
 const at=args.indexOf('--workdir'),workdir=path.resolve(at<0?DEFAULT_WORKDIR:args[at+1]);
 assertOutsideRepository(workdir);assertOutsideRepository(await realpath(workdir),await realpath(root));
 const old=await readFile(path.join(root,'supabase/.temp/project-ref'));assert.equal(old.toString().trim(),OLD_REF,'OLD_BACKUP_LINK_CHANGED');
 const reference=await loadReference(root,path.join(workdir,referenceName));
 assert.equal((await readFile(path.join(workdir,'supabase/.temp/project-ref'),'utf8')).trim(),TARGET.id,'LINK_TARGET_MISMATCH');
 const connection=connectionFromLink(await readFile(path.join(workdir,'supabase/.temp/pooler-url'),'utf8'));
 const output=path.join(workdir,'upgrade'+label+'-'+new Date().toISOString().replaceAll(/[:.]/gu,'-'));await mkdir(output);
 const original=JSON.parse(await readFile(path.join(workdir,'notification-before.json'),'utf8'));
 const report={mode:args.includes('--apply')?'owner-apply'+versions.join('-'):'verify-only',startedAt:new Date().toISOString(),output,projectRef:TARGET.id,remoteWriteAttempted:false};
 let env,guard;
 try{
  assert.ok(process.stdin.isTTY,'OWNER_INTERACTIVE_TERMINAL_REQUIRED');
  const ca=verifiedSupabaseCa();
  const terminal=createInterface({input:process.stdin,output:process.stdout});
  try{assert.equal(await terminal.question(versions.join('+')+' والمواءمة فقط؛ لا تفعيل إشعارات. اكتب '+TARGET.id+': '),TARGET.id,'OWNER_CONFIRMATION_REQUIRED');}finally{terminal.close();}
  env={...process.env,PGPASSWORD:await ownerPassword(),PGSSLMODE:'verify-full',PGSSLROOTCERT:ca.path,PGCONNECT_TIMEOUT:'10',PGPASSFILE:path.join(output,'NO_PASSWORD_FILE')};
  delete env.PGOPTIONS;delete env.SUPABASE_DB_PASSWORD;
  const psql=process.env.NAWASRAH_PG_BIN?path.join(process.env.NAWASRAH_PG_BIN,'psql.exe'):path.join(process.env.LOCALAPPDATA,'NawasrahBackup/postgresql-17.11/bin/psql.exe');
  const executor={command:psql,args:[...connection,'-X','-q','-At','-w','-v','ON_ERROR_STOP=1',...(report.mode==='verify-only'?['-c','SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;','-f','-']:[])],env};
  const version=await executeInput(executor,"SELECT current_setting('server_version_num')::integer/10000;");
  assert.equal(version.code,0,'CONNECTED_VERSION_READ_FAILED');assert.equal(version.stdout.trim(),'17','POSTGRES_MAJOR_MISMATCH');
  if(report.mode==='verify-only'){
   await (configuration.verifyReadOnly??verifyCatalogReadOnly)(executor,output,reference,original,{beforeBuildDate:reference.buildUtcDate,afterBuildDate:new Date().toISOString().slice(0,10)},report);
   const h=await executeInput(executor,historySql);assert.equal(h.code,0);assert.deepEqual(JSON.parse(h.stdout.trim()),reference.appliedVersions);
   report.ok=true;return report;
  }
  // Refuse unreviewed startup files or mismatched138 bytes in the EXTERNAL CLI
  // workspace. Never link/change the repository's backup target.
  const existing=(await readdir(path.join(workdir,'supabase/migrations'))).filter(f=>/^\d+_.+\.sql$/u.test(f)).sort();
  assert.ok(existing.every(name=>reference.manifest.some(m=>m.name===name)),'UNREVIEWED_WORKDIR_MIGRATION');
  for(const m of reference.manifest.filter(m=>Number(m.name.slice(0,3))<=138)){
   assert.equal(sha256(canonicalLf(await readFile(path.join(workdir,'supabase/migrations',m.name),'utf8'))),m.sha256,'WORKDIR138_BYTES_CHANGED');
  }
  for(const unit of await inputsFor(reference)){
   const filename=path.join(workdir,'supabase/migrations',unit.name);
   try{assert.equal(sha256(canonicalLf(await readFile(filename,'utf8'))),unit.sha256,'WORKDIR_UPGRADE_BYTES_CHANGED');}
   catch(error){if(error.code!=='ENOENT')throw error;await copyFile(path.join(root,'supabase/migrations',unit.name),filename);}
  }
  guard=await holdUpgradeGuard(executor);
  const cli=async flags=>{
   guard.assertHeld();const childEnv={...env,SUPABASE_DB_PASSWORD:env.PGPASSWORD};
   try{return await exec(process.execPath,[path.join(root,'node_modules/supabase/dist/supabase.js'),...flags,'--workdir',workdir,'--agent','no'],{cwd:workdir,env:childEnv,windowsHide:true,maxBuffer:8*1024**2});}
   catch{throw new Error('OFFICIAL_CLI_STEP_FAILED');}finally{delete childEnv.SUPABASE_DB_PASSWORD;delete childEnv.PGPASSWORD;}
  };
  await pipeline({executor,reference,original,output,report,
   repair:async v=>{await cli(['migration','repair','--linked','--status','applied',v]);},
   finalDryRun:async()=>{await cli(['migration','list','--linked']);const r=await cli(['db','push','--linked','--dry-run','--skip-vault']);assert.match(r.stdout+r.stderr,/up to date/iu,'PENDING_MIGRATIONS');}});
  return report;
 }catch(error){report.ok=false;report.error=error.code==='ERR_ASSERTION'?error.message.split('\n')[0]:upgradePreparationCode(error);return report;}
 finally{
  if(guard)try{await guard.close();}catch{report.ok=false;report.guardCloseError='UPGRADE_GUARD_CLOSE_FAILED';}
  if(env)delete env.PGPASSWORD;
  assert.equal(sha256(await readFile(path.join(root,'supabase/.temp/project-ref'))),sha256(old),'OLD_BACKUP_LINK_CHANGED');
  report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const r=await run(process.argv.slice(2));console.log(JSON.stringify({ok:r.ok,mode:r.mode,output:r.output,error:r.error,applied:r.applied,recorded:r.recorded,commands:r.alignmentCommands??r.commands,remoteWriteAttempted:r.remoteWriteAttempted}));if(!r.ok)process.exitCode=1;}
 catch(error){console.error(upgradePreparationCode(error));process.exitCode=1;}
}
