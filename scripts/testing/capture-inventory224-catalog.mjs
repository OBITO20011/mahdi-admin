import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {startInventory224Local} from './inventory224-local.mjs';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
import {canonicalLf,sha256,manifestDigest,canonicalDefinitionLf,renderFunctionReference} from './maintenance-db-contract.mjs';
import {readRealtimePublication} from './realtime151-contract.mjs';
import {readNotificationSnapshot} from '../operations/frankfurt-notification-hold.mjs';
import {assessOwner217Cron,assertOwner217HeldSettings} from '../operations/owner-telegram217-notifications.mjs';
import {assertReady223Catalog} from '../operations/optional-quantity223-catalog.mjs';
import {assertInventory224CatalogDelta,migration224Sha256,inventory224Migration,assertReady224Catalog} from '../operations/inventory224-catalog.mjs';
import {readVerificationSourceFreeze,assertVerificationSourceFreeze} from './verification-source-freeze.mjs';

assert.equal(process.argv.length,2,'INVENTORY224_NO_TARGET_ARGUMENTS');
const root=path.resolve(import.meta.dirname,'../..'),output=await mkdtemp(path.join(tmpdir(),'nawasrah-inventory224-catalog-'));
const report={ok:false,output,hostedAccess:false,ownerDemoAccess:false};
const save=(name,value)=>writeFile(path.join(output,name+'.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
let local;
const capture=async()=>({catalog:JSON.parse(await local.sql(schemaCatalogSql)),
 buildUtcDate:await local.sql("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;"),realtimePublication:await readRealtimePublication(local.executor)});
try{
 const frozen=await readVerificationSourceFreeze(root);
 local=await startInventory224Local(223);
 const before=await capture();assertReady223Catalog(before.catalog);await save('catalog223',before);
 const migration=canonicalLf(await readFile(path.join(root,'supabase/migrations',inventory224Migration),'utf8'));
 assert.equal(sha256(migration),migration224Sha256());report.migrationSha256=sha256(migration);
 await local.sql(migration);
 await local.sql("INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('224','optional_quantity_inventory_reader','{}');");
 const incremental=await capture();assertInventory224CatalogDelta(before.catalog,incremental.catalog);
 assert.deepEqual(incremental.realtimePublication,before.realtimePublication);assertReady224Catalog(incremental.catalog);
 await save('catalog224-incremental',incremental);
 await local.stop();local=null;
 local=await startInventory224Local(224);
 const fresh=await capture();assertReady224Catalog(fresh.catalog);
 const differences=catalogDifference(incremental.catalog,fresh.catalog,{beforeBuildDate:incremental.buildUtcDate,afterBuildDate:fresh.buildUtcDate});
 await save('fresh-incremental-differences',differences);assert.deepEqual(differences,[],'INVENTORY224_FRESH_INCREMENTAL_DRIFT');
 assert.deepEqual(fresh.realtimePublication,before.realtimePublication);await assertOwner217HeldSettings(local.executor);
 report.notificationSnapshot=await readNotificationSnapshot(local.executor);
 const jobs=JSON.parse(await local.sql("SELECT jsonb_agg(jsonb_build_object('name',jobname,'command',command,'schedule',schedule,'active',active) ORDER BY jobname) FROM cron.job;"));
 report.cronAudit=assessOwner217Cron(jobs);
 await save('catalog224-fresh',fresh);
 const source=await readFile(path.join(root,'scripts/testing/generate-db-functions.mjs'),'utf8');
 const query=source.match(/const query = `(BEGIN READ ONLY;[\s\S]+?ROLLBACK;)`;/u)?.[1];assert.ok(query&&!query.includes('${'));
 const functions=JSON.parse(await local.sql(query));assert.equal(functions.length,688);
 const privateFunctions=fresh.catalog.functions.filter(f=>['sales_lite1','sales_lite2','sales_lite3'].includes(f.schema)).length;
 assert.equal(privateFunctions,51,'INVENTORY224_PRIVATE_FUNCTIONS_CHANGED');
 await save('public224-functions',functions);
 const rendered=renderFunctionReference(local.manifest,functions.map(f=>({...f,definition:canonicalDefinitionLf(f.definition)})));
 await writeFile(path.join(output,'DB_FUNCTIONS224.md'),rendered,{flag:'wx'});
 assertVerificationSourceFreeze(frozen,await readVerificationSourceFreeze(root));
 Object.assign(report,{ok:true,postgresVersion:await local.sql('SHOW server_version;'),publicFunctions:688,privateFunctions,
  manifestSha256:manifestDigest(local.manifest),historyFiles:184,networkAttachments:local.networkAttachments,freshIncrementalDifferences:0});
}catch(error){report.error=String(error.stack).slice(0,6000);process.exitCode=1;}
finally{
 if(local)await local.stop();report.cleanup=true;
 await save('report',report);await mkdir(path.join(root,'test-results/inventory224-catalog'),{recursive:true});
 await writeFile(path.join(root,'test-results/inventory224-catalog/report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}
