// Local fresh182 versus literal incremental171->180->181->182,official CLI history.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp,mkdir,copyFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {executorFor,executeInput} from './build-empty-supabase.mjs';
import {schemaCatalogSql,catalogDifference} from '../testing/schema-catalog.mjs';
import {migrationManifest,manifestDigest,canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {readRealtimePublication,realtimePublicationSql} from '../testing/realtime151-contract.mjs';
import {functionReference,DEFAULT_WORKDIR,assertOutsideRepository} from './frankfurt-owner-build.mjs';
import {buildReference171} from './build-acl-reference171.mjs';
import {readyReference171Name,readReference171} from './frankfurt-reference171.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';
import {assertReference182,readyReference182Name,withdrawalVersions,assertWithdrawals182Catalog} from './frankfurt-reference182.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),cli=path.join(root,'node_modules/supabase/dist/supabase.js');
export async function buildReference182(args=[]){
 assert.ok(args.length===0||(args.length===2&&args[0]==='--output'),'ONLY_LOCAL_OUTPUT_OPTION_SUPPORTED');
 const target=path.resolve(args[1]??path.join(DEFAULT_WORKDIR,readyReference182Name));assert.equal(path.basename(target),readyReference182Name);
 assertOutsideRepository(target);await mkdir(path.dirname(target),{recursive:true});assertOutsideRepository(await realpath(path.dirname(target)),await realpath(root));
 await assert.rejects(()=>readFile(target),{code:'ENOENT'},'REFERENCE_ALREADY_EXISTS');
 const output=await mkdtemp(path.join(tmpdir(),'nawasrah-reference182-')),report={startedAt:new Date().toISOString(),managedAccess:false,output,target};
 const manifest=(await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=182),source=await inventory(),proofText=canonicalLf(await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_182.json'),'utf8')),
  proof=JSON.parse(proofText),proof171=await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_171.json'),'utf8'),proof164=await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_164.json'),'utf8'),proof150=await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_150.json'),'utf8');
 const project='nawasrah-reference182-test',executor=executorFor(['--container','supabase_db_'+project]);let local,stage='base171';
 const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,'REFERENCE182_SQL_FAILED');return r.stdout.trim();};
 const capture=async()=>{const catalog=JSON.parse(await sql(schemaCatalogSql));return {catalog,catalogSha256:sha256(JSON.stringify(catalog)),
  appliedVersions:JSON.parse(await sql('SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations;')),
  buildUtcDate:await sql("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;"),realtimePublication:await readRealtimePublication(executor)};};
 const stop=async()=>{if(local){await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true});local=null;}};
 const bootstrap=async ceiling=>{const b=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
  NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:String(ceiling),NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
  NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});local=JSON.parse(b.stdout).isolatedProjectRoot;};
 try{
  await buildReference171(['--output',path.join(output,readyReference171Name)]);const base171=await readReference171(root,path.join(output,readyReference171Name));
  stage='fresh182';await bootstrap(182);const fresh=await capture(),functions=await functionReference(executor,182),postgresVersion=await sql('SHOW server_version;');
  assertWithdrawals182Catalog(fresh.catalog);await stop();stage='incremental171';await bootstrap(171);const prefixes={'171':await capture()};
  assert.deepEqual(catalogDifference(base171.catalog,prefixes['171'].catalog,{beforeBuildDate:base171.buildUtcDate,afterBuildDate:prefixes['171'].buildUtcDate}),[]);
  const cliCall=flags=>exec(process.execPath,[cli,...flags,'--local','--workdir',local,'--agent','no','--output-format','text'],{cwd:root,windowsHide:true,maxBuffer:8*1024**2});
  for(const version of withdrawalVersions){
   stage='incremental-'+version;const unit=manifest.find(m=>m.name.startsWith(version+'_'));assert.ok(unit);
   const bytes=await readFile(path.join(root,'supabase/migrations',unit.name));assert.equal(sha256(canonicalLf(bytes.toString('utf8'))),unit.sha256);
   await copyFile(path.join(root,'supabase/migrations',unit.name),path.join(local,'supabase/migrations',unit.name));await sql(bytes);
   await cliCall(['migration','repair','--status','applied',version]);prefixes[version]=await capture();
  }
  const final=prefixes['182'],differences=catalogDifference(fresh.catalog,final.catalog,{beforeBuildDate:fresh.buildUtcDate,afterBuildDate:final.buildUtcDate});
  await writeFile(path.join(output,'fresh-incremental-differences.json'),JSON.stringify(differences,null,2)+'\n');assert.deepEqual(differences,[],'FULL_CATALOG_FRESH_INCREMENTAL_MISMATCH');
  assert.deepEqual(final.realtimePublication,fresh.realtimePublication);assertWithdrawals182Catalog(final.catalog);
  stage='official-dry-run';await cliCall(['migration','list']);const dry=await cliCall(['db','push','--dry-run','--skip-vault']);assert.match(dry.stdout+dry.stderr,/up to date/iu);
  const reference={format:7,migrationCeiling:182,manifest,manifestDigest:manifestDigest(manifest),...final,postgresVersion,
   catalogQuerySha256:sha256(schemaCatalogSql),functions,realtimeQuerySha256:sha256(realtimePublicationSql),realtimeSha256:sha256(JSON.stringify(final.realtimePublication)),
   base171,prefixes,freshIncrementalDifferenceCount:0,notificationSnapshot:base171.notificationSnapshot,cronAudit:base171.cronAudit,
   readiness:{sourceHashes:source.sources,accessEvidenceSha256:sha256(proofText),coverage:proof.coverage,queries:proof.results.length,errors:0}};
  assertReference182(reference,manifest,proofText,source,proof171,proof164,proof150);assert.deepEqual((await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=182),manifest);assert.deepEqual((await inventory()).sources,source.sources);
  await writeFile(target,JSON.stringify(reference,null,2)+'\n',{flag:'wx'});
  Object.assign(report,{ok:true,migrations:manifest.length,functions,manifestDigest:reference.manifestDigest,catalogSha256:reference.catalogSha256,realtimeMembers:13,freshIncrementalDifferenceCount:0});
 }catch(error){report.ok=false;report.stage=stage;report.error=error.message;throw error;}
 finally{await stop();report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{await buildReference182(process.argv.slice(2));}catch{process.exitCode=1;}}
