// Owner-operated only. Default offline dry-run;never links a project or repairs migrations.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {TARGET,OLD_REF,DEFAULT_WORKDIR,assertOutsideRepository,connectionFromLink} from './frankfurt-owner-build.mjs';
import {executeInput} from './build-empty-supabase.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {generateAclPlan,alignmentTransaction,publicAclSnapshot} from './frankfurt-acl-plan.mjs';
import {compareManagedCatalog} from './managed-catalog-policy.mjs';
import {verifyCatalogReadOnly} from './frankfurt-catalog-verification.mjs';
import {readReference151,readyReference151Name} from './frankfurt-reference151.mjs';
import {forecast150} from './forecast-grants150.mjs';
const root=path.resolve(import.meta.dirname,'../..'),hash=b=>createHash('sha256').update(b).digest('hex');
export function serviceAclSnapshot(catalog){return Object.fromEntries(Object.entries(publicAclSnapshot(catalog)).map(([k,v])=>[k,v.acl.filter(e=>e.grantee==='service_role')]));}
export async function alignWithExecutor(executor,reference,observed,original,dates,output,report){
 const freshRead=await executeInput(executor,schemaCatalogSql);assert.equal(freshRead.code,0,'ACL_FRESH_CATALOG_READ_FAILED');
 const fresh=JSON.parse(freshRead.stdout.trim());
 assert.deepEqual(publicAclSnapshot(fresh),publicAclSnapshot(observed),'ACL_PREVIEW_STALE');
 const plan=generateAclPlan(reference.catalog,fresh);
 report.remoteWriteAttempted=true;
 const applied=await executeInput(executor,alignmentTransaction(plan));
 // A connection loss near COMMIT does not prove rollback;owner must read back.
 assert.equal(applied.code,0,'ACL_TRANSACTION_NOT_CONFIRMED');
 report.transactionCommitted=true;
 const reread=await executeInput(executor,schemaCatalogSql);assert.equal(reread.code,0,'ACL_POST_CATALOG_READ_FAILED');
 const after=JSON.parse(reread.stdout.trim());
 await writeFile(path.join(output,'post-alignment-catalog.json'),JSON.stringify(after,null,2)+'\n');
 assert.deepEqual(serviceAclSnapshot(after),serviceAclSnapshot(fresh),'SERVICE_ROLE_ACL_CHANGED');
 report.serviceRoleUnchanged=true;
 await verifyCatalogReadOnly(executor,output,reference,original,dates,report);
 report.ok=true;return report;
}
async function password(){
 assert.ok(process.stdin.isTTY,'OWNER_INTERACTIVE_TERMINAL_REQUIRED');
 process.stdout.write('أدخل كلمة سر قاعدة فرانكفورت الجديدة (مخفية، لا تُحفظ):\n');
 return new Promise((resolve,reject)=>{
  const command='[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false); $fraSecret=New-Object Security.SecureString; try { while($true) { $fraKey=[Console]::ReadKey($true); if($fraKey.Key -eq "Enter") { break }; if($fraKey.Key -eq "Backspace") { if($fraSecret.Length -gt 0) { $fraSecret.RemoveAt($fraSecret.Length-1) }; continue }; if([int]$fraKey.KeyChar -ge 32) { $fraSecret.AppendChar($fraKey.KeyChar) } }; $fraPtr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($fraSecret); try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($fraPtr)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($fraPtr) } } finally { $fraSecret.Dispose() }';
  const child=spawn('powershell.exe',['-NoProfile','-Command',command],{stdio:['inherit','pipe','inherit']});
  let value='';child.stdout.setEncoding('utf8');child.stdout.on('data',s=>value+=s);
  child.once('error',()=>reject(new Error('PASSWORD_PROMPT_FAILED')));
  child.once('close',code=>code===0&&value?resolve(value):reject(new Error('PASSWORD_PROMPT_FAILED')));
 });
}
// Historical preview seam is not a CLI flag. Current public preview164 uses
// the same fail-closed admission as the current owner upgrade command.
export async function run(args,{historical151=false}={}){
 assert.ok(!args.includes('--apply'),'OWNER_HOLD_ALIGN_ACL_APPLY');
 assert.ok(!(args.includes('--apply')&&args.includes('--dry-run')),'ONE_MODE_REQUIRED');
 assert.ok(args.every((v,i)=>['--apply','--dry-run','--workdir'].includes(v)||args[i-1]==='--workdir'),'UNKNOWN_OPTION');
 if(!historical151)return (await import('./frankfurt-owner-upgrade164.mjs')).offline164(args);
 const i=args.indexOf('--workdir'),workdir=path.resolve(i<0?DEFAULT_WORKDIR:args[i+1]);
 assertOutsideRepository(workdir);assertOutsideRepository(await realpath(workdir),await realpath(root));
 const old=await readFile(path.join(root,'supabase/.temp/project-ref'));assert.equal(old.toString().trim(),OLD_REF,'OLD_BACKUP_LINK_CHANGED');
 const observedBytes=await readFile(path.join(workdir,'catalog-observed.json'));
 const observed=JSON.parse(observedBytes),previous=JSON.parse(await readFile(path.join(workdir,'catalog-differences.json'),'utf8'));
 const original=JSON.parse(await readFile(path.join(workdir,'notification-before.json'),'utf8'));
 const reference=await readReference151(root,path.join(workdir,readyReference151Name));
 const dates={...previous.dates,beforeBuildDate:reference.buildUtcDate};
 const output=path.join(workdir,'acl-alignment-'+new Date().toISOString().replaceAll(/[:.]/gu,'-'));await mkdir(output);
 const report={mode:args.includes('--apply')?'owner-apply':'offline-dry-run',startedAt:new Date().toISOString(),remoteWriteAttempted:false,
  projectRef:TARGET.id,sourceCatalogSha256:hash(observedBytes),objects:0,commands:0,output,
  reference:readyReference151Name,referenceCeiling:151,applicationReady:false,ownerApplyHold:true,
  realtimeMembership:{certified:false,reason:'SAVED_OBSERVED_CATALOG_HAS_NO_PUBLICATION_SNAPSHOT'},
  pendingMigration139:[],requiresFreshObservedAfterOwnerMigrations:['139','150','151']};
 let env;
 try{
  // Persist the complete classified input comparison BEFORE a strict planner
  // assertion,so any future non-ACL failure still has all object/value details.
  await writeFile(path.join(output,'catalog-comparison-before.json'),JSON.stringify(compareManagedCatalog(reference.catalog,observed,dates),null,2)+'\n');
  const plan=generateAclPlan(reference.catalog,observed,{offlinePending139:true});
  report.objects=plan.objectCount;report.commands=plan.commandCount;report.pendingMigration139=plan.prerequisites;
  const forecast=generateAclPlan(reference.catalog,forecast150(observed),{offlinePending139:true});
  report.afterLiteral150Forecast={commands:forecast.commandCount,objects:forecast.objectCount,notApplied:true,
   note:'ACL-only forecast;139 still pending;publication unknown until owner live verification'};
  await writeFile(path.join(output,'after150-preview.sql'),forecast.commands.join('\n')+'\n');
  await writeFile(path.join(output,'preview.sql'),plan.commands.join('\n')+'\n');
  await writeFile(path.join(output,'source-catalog.json'),observedBytes);
  console.log('معاينة أوفلاين فقط؛التطبيق محظور. service_role ومخططات المنصة لا تتغير:\n'+plan.commands.join('\n'));
  const predicted=compareManagedCatalog(reference.catalog,plan.predicted,dates);
  const remaining=predicted.unexpected.filter(d=>!plan.prerequisites.some(p=>JSON.stringify(p)===JSON.stringify(d)));
  assert.equal(remaining.length,0,'PREDICTED_CATALOG_DRIFT');
  report.predictedUnexpectedDifferences=remaining.length;
  report.expectedHold=predicted.expected;report.platformInformation=predicted.platform;
  await writeFile(path.join(output,'pending-migrations.json'),JSON.stringify(plan.prerequisites,null,2)+'\n');
  if(!args.includes('--apply')){report.ok=true;return report;}
  assert.ok(process.stdin.isTTY,'OWNER_INTERACTIVE_TERMINAL_REQUIRED');
  assert.equal((await readFile(path.join(workdir,'supabase/.temp/project-ref'),'utf8')).trim(),TARGET.id,'LINK_TARGET_MISMATCH');
  const connection=connectionFromLink(await readFile(path.join(workdir,'supabase/.temp/pooler-url'),'utf8'));
  const terminal=createInterface({input:process.stdin,output:process.stdout});
  try{assert.equal(await terminal.question('لتطبيق قائمة ACL المعروضة في معاملة واحدة اكتب '+TARGET.id+': '),TARGET.id,'OWNER_CONFIRMATION_REQUIRED');}
  finally{terminal.close();}
  env={...process.env,PGPASSWORD:await password(),PGSSLMODE:'require',PGCONNECT_TIMEOUT:'10',PGPASSFILE:path.join(output,'NO_PASSWORD_FILE')};
  delete env.PGOPTIONS;delete env.SUPABASE_DB_PASSWORD;
  const psql=process.env.NAWASRAH_PG_BIN?path.join(process.env.NAWASRAH_PG_BIN,'psql.exe'):path.join(process.env.LOCALAPPDATA,'NawasrahBackup/postgresql-17.11/bin/psql.exe');
  const executor={command:psql,args:[...connection,'-X','-q','-At','-w','-v','ON_ERROR_STOP=1'],env};
  const version=await executeInput(executor,"SELECT current_setting('server_version_num')::integer/10000;");
  assert.equal(version.code,0,'SERVER_VERSION_READ_FAILED');assert.equal(version.stdout.trim(),'17','POSTGRES_MAJOR_MISMATCH');
  await alignWithExecutor(executor,reference,observed,original,dates,output,report);
  return report;
 }catch(error){report.ok=false;report.error=error.code==='ERR_ASSERTION'?error.message.split('\n')[0]:'ACL_ALIGNMENT_FAILED';return report;}
 finally{
  if(env)delete env.PGPASSWORD;
  assert.equal(hash(await readFile(path.join(root,'supabase/.temp/project-ref'))),hash(old),'OLD_BACKUP_LINK_CHANGED');
  report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 // Finish evaluating this module before the164 preview imports its shared ACL
 // executor back through the owner pipeline. A top-level await creates a cycle
 // that Node exits with13 before any offline preview can complete.
 run(process.argv.slice(2)).then(r=>{
  console.log(JSON.stringify({ok:r.ok,mode:r.mode,objects:r.objects,commands:r.commands,error:r.error,output:r.output,remoteWriteAttempted:r.remoteWriteAttempted,unexpected:r.catalogUnexpectedDifferenceCount??r.predictedUnexpectedDifferences}));if(!r.ok)process.exitCode=1;
 }).catch(error=>{console.error(error.code==='ERR_ASSERTION'?error.message.split('\n')[0]:'ACL_PREPARATION_FAILED');process.exitCode=1;});
}
