// Independent fresh217 versus complete216 plus literal217 and official repair.
// Local Docker only; never invokes --linked or loads hosted credentials.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp,mkdir,realpath,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {executorFor,executeInput} from './build-empty-supabase.mjs';
import {schemaCatalogSql,catalogDifference} from '../testing/schema-catalog.mjs';
import {migrationManifest,manifestDigest,canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {readRealtimePublication,realtimePublicationSql} from '../testing/realtime151-contract.mjs';
import {functionReference,DEFAULT_WORKDIR,assertOutsideRepository} from './frankfurt-owner-build.mjs';
import {readNotificationSnapshot} from './frankfurt-notification-hold.mjs';
import {assessOwner217Cron} from './owner-telegram217-notifications.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';
import {assertReady216Catalog} from './frankfurt-reference216.mjs';
import {assertReady217Reference,ready217ReferenceName,assertReady217Catalog} from './frankfurt-reference217.mjs';
import {readVerificationSourceFreeze,assertVerificationSourceFreeze} from '../testing/verification-source-freeze.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),cli=path.join(root,'node_modules/supabase/dist/supabase.js');
export async function buildReady217Reference(args=[]){
 assert.ok(!args.length||args.length===2&&args[0]==='--output','ONLY_LOCAL_OUTPUT_OPTION_SUPPORTED');
 const target=path.resolve(args[1]??path.join(DEFAULT_WORKDIR,ready217ReferenceName));assert.equal(path.basename(target),ready217ReferenceName);assertOutsideRepository(target);await mkdir(path.dirname(target),{recursive:true});assertOutsideRepository(await realpath(path.dirname(target)),await realpath(root));await assert.rejects(()=>readFile(target),{code:'ENOENT'},'REFERENCE_ALREADY_EXISTS');
 const output=await mkdtemp(path.join(tmpdir(),'nawasrah-reference217-')),report={startedAt:new Date().toISOString(),managedAccess:false,output,target,ok:false};
 const manifest=(await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=217),source=await inventory(),proofText=canonicalLf(await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_217.json'),'utf8')),proof=JSON.parse(proofText);
 const frozen=await readVerificationSourceFreeze(root),project='nawasrah-reference217-test',executor=executorFor(['--container','supabase_db_'+project]);let local,stage='base216';
 const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
 const capture=async()=>{const catalog=JSON.parse(await sql(schemaCatalogSql));return{catalog,catalogSha256:sha256(JSON.stringify(catalog)),appliedVersions:JSON.parse(await sql('SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations;')),buildUtcDate:await sql("SELECT(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;"),realtimePublication:await readRealtimePublication(executor)};};
 const stop=async()=>{if(local){await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true});local=null;}};
 const bootstrap=async ceiling=>{const b=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:String(ceiling),NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});local=JSON.parse(b.stdout).isolatedProjectRoot;};
 try{
  await bootstrap(216);const prefixes={'216':await capture()};assertReady216Catalog(prefixes['216'].catalog);await functionReference(executor,216);
  const cliCall=flags=>exec(process.execPath,[cli,...flags,'--local','--workdir',local,'--agent','no','--output-format','text'],{cwd:root,windowsHide:true,maxBuffer:8*1024**2});
  stage='incremental217';const unit=manifest.find(m=>m.name.startsWith('217_'));assert.ok(unit);const bytes=await readFile(path.join(root,'supabase/migrations',unit.name));assert.equal(sha256(canonicalLf(bytes.toString('utf8'))),unit.sha256);
  await copyFile(path.join(root,'supabase/migrations',unit.name),path.join(local,'supabase/migrations',unit.name));await sql(bytes);await cliCall(['migration','repair','--status','applied','217']);prefixes['217']=await capture();assertReady217Catalog(prefixes['217'].catalog);
  stage='official-dry-run';await cliCall(['migration','list']);const dry=await cliCall(['db','push','--dry-run','--skip-vault']);assert.match(dry.stdout+dry.stderr,/up to date/iu);
  const final=prefixes['217'],notificationSnapshot=await readNotificationSnapshot(executor),jobs=JSON.parse(await sql("SELECT jsonb_agg(jsonb_build_object('name',jobname,'command',command,'schedule',schedule,'active',active)ORDER BY jobname)FROM cron.job;")),cronAudit=assessOwner217Cron(jobs);await stop();
  stage='fresh217';await bootstrap(217);const fresh=await capture(),functions=await functionReference(executor,217),postgresVersion=await sql('SHOW server_version;');
  const differences=catalogDifference(fresh.catalog,final.catalog,{beforeBuildDate:fresh.buildUtcDate,afterBuildDate:final.buildUtcDate});await writeFile(path.join(output,'fresh-incremental-differences.json'),JSON.stringify(differences,null,2)+'\n');assert.deepEqual(differences,[],'FULL_CATALOG_FRESH_INCREMENTAL_MISMATCH');assert.deepEqual(final.realtimePublication,fresh.realtimePublication);
  const reference={format:28,migrationCeiling:217,manifest,manifestDigest:manifestDigest(manifest),...final,postgresVersion,catalogQuerySha256:sha256(schemaCatalogSql),functions,realtimeQuerySha256:sha256(realtimePublicationSql),realtimeSha256:sha256(JSON.stringify(final.realtimePublication)),prefixes,freshIncrementalDifferenceCount:0,notificationSnapshot,cronAudit,readiness:{sourceHashes:source.sources,accessEvidenceSha256:sha256(proofText),coverage:proof.coverage,queries:proof.results.length,errors:0}};
  assertReady217Reference(reference,manifest,proofText,source);assert.deepEqual((await inventory()).sources,source.sources);assertVerificationSourceFreeze(frozen,await readVerificationSourceFreeze(root));await writeFile(target,JSON.stringify(reference,null,2)+'\n',{flag:'wx'});Object.assign(report,{ok:true,migrations:179,functions,realtimeMembers:13,freshIncrementalDifferenceCount:0,repositoryStayedFrozen:true});
 }catch(error){Object.assign(report,{ok:false,stage,error:error.message});throw error;}finally{await stop();report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{await buildReady217Reference(process.argv.slice(2));}catch{process.exitCode=1;}}
