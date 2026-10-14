import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runEmptyProjectBuild,executeInput,executorFor,prepare034Sql,buildEmptyProjectInput,restore034Sql,recoverySql} from '../operations/build-empty-supabase.mjs';
import {withIsolatedSupabasePorts} from './isolated-supabase-ports.mjs';
import {waitForDatabasePorts,databasePortsFromConfig} from './isolated-db-port-guard.mjs';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile);
const project='nawasrah-empty-build-rehearsal-test',container='supabase_db_'+project;
const cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const evidence=await mkdtemp(path.join(tmpdir(),'nawasrah-empty-build-evidence-'));
const excluded='gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor';
const report={startedAt:new Date().toISOString(),evidence,productionAccess:false};
let ownedRoot,stage='fresh-base',literalCatalog;
const stop=async()=>{
 if(ownedRoot){await exec(process.execPath,[cli,'stop','--no-backup','--workdir',ownedRoot],{cwd:root,windowsHide:true,timeout:120000});ownedRoot=undefined;}
};
const startBase=async()=>{
 const {stdout:running}=await exec('docker',['ps','--format','{{.Names}}'],{windowsHide:true});
 assert.ok(!running.split(/\r?\n/u).some(n=>/^supabase_.+_nawasrah-.+-test$/u.test(n)),'ISOLATED_STACK_ACTIVE');
 const {stdout:volumes}=await exec('docker',['volume','ls','--format','{{.Name}}'],{windowsHide:true});
 assert.ok(!volumes.split(/\r?\n/u).includes('supabase_db_'+project),'FRESH_VOLUME_REQUIRED');
 ownedRoot=await mkdtemp(path.join(tmpdir(),'nawasrah-empty-build-'));
 await mkdir(path.join(ownedRoot,'supabase/migrations'),{recursive:true});
 const config=withIsolatedSupabasePorts((await readFile(path.join(root,'supabase/config.toml'),'utf8')).replace(/^project_id\s*=.*$/mu,`project_id = "${project}"`))+'\n[db.seed]\nenabled = false\n';
 await writeFile(path.join(ownedRoot,'supabase/config.toml'),config);
 report.portGuard=await waitForDatabasePorts(databasePortsFromConfig(config));
 await exec(process.execPath,[cli,'start','--workdir',ownedRoot,'--exclude',excluded],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,timeout:240000});
};
try{
 await startBase();
 const executor=executorFor(['--container',container]);
 stage='pre034-negative-fixtures';
 const {input}=await buildEmptyProjectInput(root);
 const boundary=input.indexOf(Buffer.from(prepare034Sql));assert.ok(boundary>0);
 const foundation=await executeInput(executor,input.subarray(0,boundary));assert.equal(foundation.code,0,'NEGATIVE_FOUNDATION_FAILED');
 const wrongSeed=await executeInput(executor,"BEGIN;UPDATE public.suppliers SET phone='wrong';\n"+prepare034Sql+'ROLLBACK;');
 assert.notEqual(wrongSeed.code,0);assert.match(wrongSeed.stderr,/ENV034_SEED_MISMATCH:suppliers/u);
 assert.equal(wrongSeed.stdout.includes('ENV034_SNAPSHOT:'),false);
 const extraRow=await executeInput(executor,"BEGIN;INSERT INTO public.audit_logs(action,entity_name) VALUES('UNEXPECTED','fixture');\n"+prepare034Sql+'ROLLBACK;');
 assert.notEqual(extraRow.code,0);assert.match(extraRow.stderr,/ENV034_NOT_EMPTY:audit_logs/u);
 assert.equal(extraRow.stdout.includes('ENV034_SNAPSHOT:'),false);
 const movement=await executeInput(executor,"BEGIN;WITH w AS(INSERT INTO public.warehouses(code,name_ar) VALUES('NEGATIVE-WH','fixture') RETURNING id) INSERT INTO public.stock_counts(count_number,warehouse_id) SELECT 'NEGATIVE-COUNT',id FROM w;\n"+prepare034Sql+'ROLLBACK;');
 assert.notEqual(movement.code,0);assert.match(movement.stderr,/ENV034_NOT_EMPTY:stock_counts/u);
 assert.equal(movement.stdout.includes('ENV034_SNAPSHOT:'),false);
 stage='post034-extra-audit-negative';
 const original034=await readFile(path.join(root,'supabase/migrations/034_prelaunch_test_data_cleanup.sql'));
 const corrupt=await executeInput(executor,Buffer.concat([Buffer.from(prepare034Sql),original034,
  Buffer.from("\nBEGIN;INSERT INTO public.audit_logs(action,entity_name) VALUES('UNEXPECTED','fixture');\n"+restore034Sql)]));
 assert.notEqual(corrupt.code,0);assert.match(corrupt.stderr,/ENV034_CLEANUP_AUDIT_MISMATCH:audit_logs/u);
 const saved=corrupt.stdout.split(/\r?\n/u).find(l=>l.startsWith('ENV034_SNAPSHOT:'));assert.ok(saved);
 const recovered=await executeInput(executor,recoverySql(JSON.parse(saved.slice('ENV034_SNAPSHOT:'.length))));
 assert.equal(recovered.code,0,'NEGATIVE_EXACT_RECOVERY_FAILED');
 report.negativeGuards={wrongSeed:true,extraPreRow:true,referencingMovement:true,extraPostAudit:true,exactRecovery:true};
 await stop();
 stage='fresh-positive-base';await startBase();
 await cp(path.join(root,'supabase/migrations'),path.join(ownedRoot,'supabase/migrations'),{recursive:true});
 stage='literal-build';
 report.build=await runEmptyProjectBuild(['--container',container,'--cli-workdir',ownedRoot]);
 assert.equal(report.build.ok,true,JSON.stringify({kind:report.build.kind,applied:report.build.applied.length,recovery:report.build.recovery,sqlError:report.build.sqlError}));
 stage='existing-project-negative';
 const used=await runEmptyProjectBuild(['--container',container,'--cli-workdir',ownedRoot]);
 assert.equal(used.kind,'EMPTY_PROJECT_REQUIRED');assert.equal(used.applied.length,0);
 assert.equal(used.recorded.length,0,'Failed SQL must not be recorded by repair');
 report.negativeGuards.existingProject=true;
 stage='CLI-history-list-and-dry-run';
 const versions=report.build.recorded;
 const {stdout:listOut}=await exec(process.execPath,[cli,'migration','list','--local','--workdir',ownedRoot,'--agent','no','--output-format','text'],{cwd:root,windowsHide:true,maxBuffer:1024**2,timeout:60000});
 await writeFile(path.join(evidence,'official-migration-list.txt'),listOut);
 // CLI human table format is not an authority/parser contract. Owner permits
 // the equivalent catalog read;prove the exact local-versus-recorded versions.
 const recordedList=await executeInput(executor,"SELECT COALESCE(jsonb_agg(version ORDER BY version),'[]'::jsonb) FROM supabase_migrations.schema_migrations;");
 assert.equal(recordedList.code,0,'CLI_HISTORY_READ_FAILED');
 const listed=JSON.parse(recordedList.stdout.trim()).map((version,index)=>[versions[index],version]);
 assert.deepEqual(listed,versions.map(v=>[v,v]),'CLI_LIST_NOT_FULLY_APPLIED');
 const {stdout:pushOut,stderr:pushErr}=await exec(process.execPath,[cli,'db','push','--local','--workdir',ownedRoot,'--dry-run','--skip-vault','--agent','no','--output-format','text'],{cwd:root,windowsHide:true,maxBuffer:1024**2,timeout:60000});
 assert.match(pushOut+pushErr,/up to date/iu,'DRY_RUN_WOULD_APPLY_MIGRATIONS');
 const seedCount=await executeInput(executor,'SELECT count(*) FROM supabase_migrations.seed_files;');
 assert.equal(seedCount.stdout.trim(),'0','UNEXECUTED_SEED_MUST_NOT_BE_REGISTERED');
 report.history={officialRepair:true,officialListSucceeded:true,equivalentCatalogExact:true,listApplied:listed.length,dryRunApplies:0,seedRegistered:false};
 stage='literal-catalog';
 const read=await executeInput(executor,schemaCatalogSql);assert.equal(read.code,0,'CATALOG_READ_FAILED');
 literalCatalog=JSON.parse(read.stdout.trim());
 await writeFile(path.join(evidence,'literal-catalog.json'),JSON.stringify(literalCatalog,null,2));
 await stop();
 stage='standard-bootstrap';
 const {stdout}=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,timeout:600000,env:{...process.env,
  NAWASRAH_ISOLATED_PROJECT_ID:'nawasrah-bootstrap-catalog-test',NAWASRAH_MAX_MIGRATION:'138',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',NAWASRAH_SUPABASE_EXCLUDE:excluded}});
 const boot=JSON.parse(stdout);ownedRoot=boot.isolatedProjectRoot;
 const baseline=await executeInput(executorFor(['--container','supabase_db_nawasrah-bootstrap-catalog-test']),schemaCatalogSql);
 assert.equal(baseline.code,0,'BOOTSTRAP_CATALOG_READ_FAILED');
 const standardCatalog=JSON.parse(baseline.stdout.trim());
 await writeFile(path.join(evidence,'bootstrap-catalog.json'),JSON.stringify(standardCatalog,null,2));
 stage='compare-catalog';
 const differences=catalogDifference(literalCatalog,standardCatalog);
 await writeFile(path.join(evidence,'differences.json'),JSON.stringify(differences,null,2));
 report.catalogCounts=Object.fromEntries(Object.entries(literalCatalog).map(([key,rows])=>[key,rows?.length??0]));
 report.differenceCount=differences.length;
 assert.equal(differences.length,0,'CATALOG_DIFFERENCE:'+JSON.stringify(differences.map(v=>({section:v.section,identity:v.identity}))));
 report.ok=true;
}catch(error){report.ok=false;report.failureStage=stage;report.failureKind=error.code||error.name;report.assertion=error.code==='ERR_ASSERTION'?error.message:undefined;process.exitCode=1;}
finally{
 try{await stop();report.cleanup='owned-stacks-stopped-no-backup';}catch(error){report.ok=false;report.cleanup='FAILED:'+error.code;process.exitCode=1;}
 report.endedAt=new Date().toISOString();await writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}
