// Always a disposable LOCAL rebuild. No CLI login,link,managed SQL or credentials.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp,mkdir,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {executorFor,executeInput} from './build-empty-supabase.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {migrationManifest,manifestDigest,canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {functionReference,DEFAULT_WORKDIR,assertOutsideRepository} from './frankfurt-owner-build.mjs';
import {readNotificationSnapshot,validateOriginalNotifications} from './frankfurt-notification-hold.mjs';
import {cronInventorySql,assessBuildCron} from './build-cron-report.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';
import {assertReference150,readyReferenceName} from './frankfurt-reference150.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile);
export async function buildReference150(args=[]){
 assert.ok(args.length===0||(args.length===2&&args[0]==='--output'),'ONLY_LOCAL_OUTPUT_OPTION_SUPPORTED');
 const target=path.resolve(args[1]??path.join(DEFAULT_WORKDIR,readyReferenceName));
 assert.equal(path.basename(target),readyReferenceName,'READY_REFERENCE_FILENAME_REQUIRED');assertOutsideRepository(target);
 await mkdir(path.dirname(target),{recursive:true});assertOutsideRepository(await realpath(path.dirname(target)),await realpath(root));
 // Never overwrite the owner's frozen138 reference,observed snapshot or an
 // existing150 reference. A rebuild must use a new external directory.
 await assert.rejects(()=>readFile(target),{code:'ENOENT'},'REFERENCE_ALREADY_EXISTS');
 const proofText=await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_150.json'),'utf8'),proof=JSON.parse(proofText);
 const source=await inventory(),manifest=await migrationManifest(root);
 const report={startedAt:new Date().toISOString(),managedAccess:false,target};
 const output=await mkdtemp(path.join(tmpdir(),'nawasrah-reference150-ready-'));
 const project='nawasrah-reference150-ready-test';let local;
 try{
  const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
   NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'150',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
   NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
  local=JSON.parse(boot.stdout).isolatedProjectRoot;const executor=executorFor(['--container','supabase_db_'+project]);
  const sql=async text=>{const r=await executeInput(executor,text);assert.equal(r.code,0,'LOCAL_REFERENCE_SQL_FAILED');return r.stdout.trim();};
  const catalog=JSON.parse(await sql(schemaCatalogSql));
  const reference={format:3,migrationCeiling:150,manifest,manifestDigest:manifestDigest(manifest),
   appliedVersions:JSON.parse(await sql('SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations;')),
   postgresVersion:await sql('SHOW server_version;'),buildUtcDate:await sql("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;"),
   catalogQuerySha256:sha256(schemaCatalogSql),catalogSha256:sha256(JSON.stringify(catalog)),catalog,functions:await functionReference(executor,150),
   cronAudit:assessBuildCron(JSON.parse(await sql(cronInventorySql)),{migrationCeiling:150}),
   notificationSnapshot:validateOriginalNotifications(await readNotificationSnapshot(executor)),
   readiness:{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),coverage:proof.coverage,queries:proof.results.length,errors:0}};
  assertReference150(reference,manifest,proofText,source);
  assert.deepEqual(await migrationManifest(root),manifest,'SOURCE_HISTORY_CHANGED_DURING_REBUILD');
  assert.deepEqual((await inventory()).sources,source.sources,'SOURCE_CHANGED_DURING_REBUILD');
  await writeFile(target,JSON.stringify(reference,null,2)+'\n',{flag:'wx'});
  report.ok=true;report.migrations=manifest.length;report.manifestDigest=reference.manifestDigest;
  report.catalogSha256=reference.catalogSha256;report.functions=reference.functions;report.queries=reference.readiness.queries;
 }catch(error){report.ok=false;report.error=error.code==='ERR_ASSERTION'?error.message.split('\n')[0]:'LOCAL_REFERENCE_FAILED';throw error;}
 finally{
  if(local)await exec(process.execPath,[path.join(root,'node_modules/supabase/dist/supabase.js'),'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true});
  report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({...report,output}));
 }
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{await buildReference150(process.argv.slice(2));}catch(error){console.error(error.code==='ERR_ASSERTION'?error.message.split('\n')[0]:'LOCAL_REFERENCE_FAILED');process.exitCode=1;}
}
