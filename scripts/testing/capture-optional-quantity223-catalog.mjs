import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {startPrices222Local} from './independent-prices222-local.mjs';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
import {canonicalLf,sha256,manifestDigest} from './maintenance-db-contract.mjs';
import {readRealtimePublication} from './realtime151-contract.mjs';
import {readNotificationSnapshot} from '../operations/frankfurt-notification-hold.mjs';
import {assessOwner217Cron,assertOwner217HeldSettings} from '../operations/owner-telegram217-notifications.mjs';
import {assertReady222Catalog} from '../operations/independent-prices222-catalog.mjs';
import {migration223Sha256,quantity223Migration,quantity223CatalogDelta} from '../operations/optional-quantity223-catalog.mjs';
import {readVerificationSourceFreeze,assertVerificationSourceFreeze} from './verification-source-freeze.mjs';

assert.equal(process.argv.length,2,'QUANTITY223_NO_TARGET_ARGUMENTS');
const root=path.resolve(import.meta.dirname,'../..');
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-quantity223-catalog-'));
const report={ok:false,output,hostedAccess:false,ownerDemoAccess:false};
const save=(name,value)=>writeFile(path.join(output,name+'.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
let local;
const capture=async()=>({
 catalog:JSON.parse(await local.sql(schemaCatalogSql)),
 buildUtcDate:await local.sql("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;"),
 realtimePublication:await readRealtimePublication(local.executor),
});
try{
 const frozen=await readVerificationSourceFreeze(root);
 local=await startPrices222Local(222);
 const before=await capture();
 assertReady222Catalog(before.catalog);
 await save('catalog222',before);
 const migration=canonicalLf(await readFile(path.join(root,'supabase/migrations',quantity223Migration),'utf8'));
 report.migrationSha256=sha256(migration);
 assert.equal(report.migrationSha256,migration223Sha256());
 await local.sql(migration);
 await local.sql("INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('223','optional_sales_quantity','{}');");
 const incremental=await capture();
 const changes=quantity223CatalogDelta(before.catalog,incremental.catalog);
 if(process.env.NAWASRAH_CHECK_CATALOG223_PINS==='1'){
  const {assertQuantity223CatalogDelta}=await import('../operations/optional-quantity223-catalog.mjs');
  assertQuantity223CatalogDelta(before.catalog,incremental.catalog);
 }
 assert.deepEqual(incremental.realtimePublication,before.realtimePublication);
 await assertOwner217HeldSettings(local.executor);
 report.notificationSnapshot=await readNotificationSnapshot(local.executor);
 const jobs=JSON.parse(await local.sql("SELECT jsonb_agg(jsonb_build_object('name',jobname,'command',command,'schedule',schedule,'active',active) ORDER BY jobname) FROM cron.job;"));
 report.cronAudit=assessOwner217Cron(jobs);
 await save('catalog223-incremental',incremental);
 await local.stop();local=null;
 local=await startPrices222Local(223);
 const fresh=await capture();
 const differences=catalogDifference(incremental.catalog,fresh.catalog,{
  beforeBuildDate:incremental.buildUtcDate,afterBuildDate:fresh.buildUtcDate,
 });
 await save('fresh-incremental-differences',differences);
 assert.deepEqual(differences,[],'QUANTITY223_FRESH_INCREMENTAL_DRIFT');
 assert.deepEqual(fresh.realtimePublication,before.realtimePublication);
 const generate=await readFile(path.join(root,'scripts/testing/generate-db-functions.mjs'),'utf8');
 const query=generate.match(/const query = `(BEGIN READ ONLY;[\s\S]+?ROLLBACK;)`;/u)?.[1];
 assert.ok(query&&!query.includes('${'));
 const functions=JSON.parse(await local.sql(query));
 assert.equal(functions.length,687);
 await save('public223-functions',functions);
 await save('catalog223-fresh',fresh);
 report.postgresVersion=await local.sql('SHOW server_version;');
 await save('proposed-catalog223-pins',{
  format:1,migrationSha256:report.migrationSha256,
  base222PinSha256:sha256(canonicalLf(await readFile(path.join(root,'docs/design/independent-parcel-prices222/catalog222-pins.json'),'utf8'))),
  changes,
 });
 assertVerificationSourceFreeze(frozen,await readVerificationSourceFreeze(root));
 Object.assign(report,{ok:true,publicFunctions:687,privateFunctions:51,catalogChanges:changes.length,
  manifestSha256:manifestDigest(local.manifest),networkAttachments:local.networkAttachments,freshIncrementalDifferences:0});
}catch(error){report.error=String(error.stack).slice(0,6000);process.exitCode=1;}
finally{
 if(local)await local.stop();
 report.cleanup=true;
 await save('report',report);
 console.log(JSON.stringify(report));
}
