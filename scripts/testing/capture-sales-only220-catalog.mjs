import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
import {migrationManifest,manifestDigest,canonicalLf,sha256} from './maintenance-db-contract.mjs';
import {readRealtimePublication} from './realtime151-contract.mjs';
import {functionCatalogSql} from './sales-only-phase1-runtime.mjs';
import {buildSalesOnly220,salesOnly220Name} from './sales-only220-compiler.mjs';
import {readVerificationSourceFreeze,assertVerificationSourceFreeze} from './verification-source-freeze.mjs';
assert.equal(process.argv.length,2,'NO_TARGET_ARGUMENTS');
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),project='nawasrah-sales-lite3-catalog-test',container='supabase_db_'+project,cli=path.join(root,'node_modules/supabase/dist/supabase.js'),output=path.join(root,'test-results/sales-only220-catalog');
await mkdir(output,{recursive:true});const report={ok:false,hostedAccess:false,networkAttachments:0};let local,ownedId;
const docker=(...a)=>exec('docker',a,{cwd:root,windowsHide:true,maxBuffer:32*1024**2});
async function owned(){const a=JSON.parse((await docker('inspect',container)).stdout)[0];assert.equal(a.Id,ownedId);assert.equal(a.Config.Labels['com.supabase.cli.project'],project);assert.deepEqual(Object.keys(a.NetworkSettings.Networks),[]);}
const executor=executorFor(['--container',container]);
const sql=async text=>{await owned();const r=await executeInput(executor,text);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
const json=async text=>JSON.parse((await sql(text)).split('\n').at(-1));
async function boot(ceiling){const r=await exec(process.execPath,['scripts/testing/bootstrap-isolated-supabase.mjs'],{cwd:root,windowsHide:true,maxBuffer:32*1024**2,env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:String(ceiling),NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});local=JSON.parse(r.stdout).isolatedProjectRoot;const a=JSON.parse((await docker('inspect',container)).stdout)[0];ownedId=a.Id;assert.equal(path.resolve(a.Config.Labels['com.supabase.cli.workdir']).toLowerCase(),path.resolve(local).toLowerCase());for(const n of Object.keys(a.NetworkSettings.Networks))await docker('network','disconnect',n,container);await owned();}
async function stop(){if(!local)return;await owned();await exec(process.execPath,[cli,'stop','--workdir',local,'--no-backup'],{cwd:root,windowsHide:true,maxBuffer:8*1024**2});local=null;ownedId=null;}
const capture=async()=>({catalog:await json(schemaCatalogSql),realtime:await readRealtimePublication(executor),appliedVersions:await json('SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations;'),buildUtcDate:await sql("SELECT(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;")});
try{
 const freeze=await readVerificationSourceFreeze(root),manifest=await migrationManifest(root),artifact=await readFile(path.join(root,'supabase/migrations',salesOnly220Name),'utf8');
 await boot(219);const original=await capture(),rows=await json(functionCatalogSql);assert.equal(buildSalesOnly220(rows),artifact);
 await sql(artifact);await sql("INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('220','sales_only_operating_mode','{}');");const incremental=await capture();await stop();
 await boot(220);const fresh=await capture(),difference=catalogDifference(incremental.catalog,fresh.catalog,{beforeBuildDate:incremental.buildUtcDate,afterBuildDate:fresh.buildUtcDate});
 await writeFile(path.join(output,'fresh-incremental-differences.json'),JSON.stringify(difference,null,2)+'\n');assert.deepEqual(difference,[],'FRESH220_INCREMENTAL_SCHEMA_DRIFT');assert.deepEqual(fresh.realtime,incremental.realtime);assert.deepEqual(fresh.appliedVersions,manifest.map(m=>m.name.slice(0,3)));
 const source=await readFile(path.join(root,'scripts/testing/generate-db-functions.mjs'),'utf8'),query=source.match(/const query = `(BEGIN READ ONLY;[\s\S]+?ROLLBACK;)`;/u)?.[1];assert.ok(query);const publicFunctions=await json(query);assert.equal(publicFunctions.length,680);
 await writeFile(path.join(output,'public220-functions.json'),JSON.stringify(publicFunctions,null,2)+'\n');
 await writeFile(path.join(output,'catalog220.json'),JSON.stringify(fresh.catalog,null,2)+'\n');await writeFile(path.join(output,'catalog219.json'),JSON.stringify(original.catalog,null,2)+'\n');
 Object.assign(report,{ok:true,migrationSha256:sha256(canonicalLf(artifact)),manifestSha256:manifestDigest(manifest),migrationFiles:181,publicFunctions:680,privateFunctions:fresh.catalog.functions.filter(f=>['sales_lite1','sales_lite2'].includes(f.schema)).length,freshIncrementalDifferences:0,realtimeMembers:fresh.realtime.tables.length,originalPublicFunctions:rows.length});
 assertVerificationSourceFreeze(freeze,await readVerificationSourceFreeze(root));
}catch(e){report.error=String(e.message).slice(0,6000);console.error(report.error);process.exitCode=1;}
finally{try{await stop();report.cleanup=true;}catch{report.cleanup=false;process.exitCode=1;}await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
