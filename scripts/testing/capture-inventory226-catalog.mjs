import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {startInventory225Local} from './inventory225-local.mjs';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
import {canonicalDefinitionLf,sha256,manifestDigest,renderFunctionReference} from './maintenance-db-contract.mjs';
import {readRealtimePublication} from './realtime151-contract.mjs';
import {readNotificationSnapshot} from '../operations/frankfurt-notification-hold.mjs';
import {assessOwner217Cron,assertOwner217HeldSettings} from '../operations/owner-telegram217-notifications.mjs';
import {assertReady225Catalog} from '../operations/frankfurt-reference225.mjs';
import {assertParcel226CatalogDelta} from '../operations/parcel226-catalog.mjs';
import {parcel226Migration} from '../operations/frankfurt-reference226.mjs';
import {operationalManifest} from '../operations/operational-schema.mjs';
import {readVerificationSourceFreeze,assertVerificationSourceFreeze} from './verification-source-freeze.mjs';

assert.equal(process.argv.length,2,'PARCEL226_CAPTURE_NO_TARGET_ARGUMENTS');
const root=path.resolve(import.meta.dirname,'../..');
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-inventory226-catalog-'));
const save=(name,value)=>writeFile(path.join(output,name+'.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const report={ok:false,output,hostedAccess:false,ownerDemoAccess:false,cleanup:false};
let local;
const capture=async()=>({catalog:JSON.parse(await local.sql(schemaCatalogSql)),
 buildUtcDate:await local.sql("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;"),
 realtimePublication:await readRealtimePublication(local.executor)});
try{
 const freeze=await readVerificationSourceFreeze(root);
 const manifest=await operationalManifest();
 const migration=await readFile(path.join(root,'supabase/migrations',parcel226Migration));
 assert.equal(sha256(migration),manifest.at(-1).sha256);
 local=await startInventory225Local(225);
 const before=await capture();
 assertReady225Catalog(before.catalog);
 await save('catalog225',before);
 await local.sql(migration);
 await local.sql("INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('226','parcel_price_integrity','{}');");
 const incremental=await capture();
 assertParcel226CatalogDelta(before.catalog,incremental.catalog);
 assert.deepEqual(incremental.realtimePublication,before.realtimePublication);
 await save('catalog226-incremental',incremental);
 await local.stop();local=null;

 local=await startInventory225Local(226);
 const fresh=await capture();
 const differences=catalogDifference(incremental.catalog,fresh.catalog,{
  beforeBuildDate:incremental.buildUtcDate,afterBuildDate:fresh.buildUtcDate,
 });
 await save('fresh-incremental-differences',differences);
 assert.deepEqual(differences,[],'PARCEL226_FRESH_INCREMENTAL_DRIFT');
 assert.deepEqual(fresh.realtimePublication,before.realtimePublication);
 await assertOwner217HeldSettings(local.executor);
 report.notificationSnapshot=await readNotificationSnapshot(local.executor);
 const jobs=JSON.parse(await local.sql("SELECT jsonb_agg(jsonb_build_object('name',jobname,'command',command,'schedule',schedule,'active',active) ORDER BY jobname) FROM cron.job;"));
 report.cronAudit=assessOwner217Cron(jobs);
 const source=await readFile(path.join(root,'scripts/testing/generate-db-functions.mjs'),'utf8');
 const query=source.match(/const query = `(BEGIN READ ONLY;[\s\S]+?ROLLBACK;)`;/u)?.[1];
 assert.ok(query&&!query.includes('${'));
 const functions=JSON.parse(await local.sql(query)).map(row=>({...row,definition:canonicalDefinitionLf(row.definition)}));
 assert.equal(functions.length,707);
 await writeFile(path.join(output,'DB_FUNCTIONS226.md'),renderFunctionReference(manifest,functions),{flag:'wx'});
 assertVerificationSourceFreeze(freeze,await readVerificationSourceFreeze(root));
 Object.assign(report,{ok:true,manifestSha256:manifestDigest(manifest),postgresVersion:await local.sql('SHOW server_version;'),
  networkAttachments:local.networkAttachments,publicFunctions:functions.length});
}catch(error){report.error=String(error.message).slice(0,500);process.exitCode=1;}
finally{
 if(local)await local.stop();
 report.cleanup=true;
 await save('report',report);
 console.log(JSON.stringify(report));
}
