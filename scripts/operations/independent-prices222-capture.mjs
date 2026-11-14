// No target input: two new, owned, network-detached Docker test databases.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {startPrices222Local} from '../testing/independent-prices222-local.mjs';
import {schemaCatalogSql,catalogDifference} from '../testing/schema-catalog.mjs';
import {sha256,canonicalLf,manifestDigest} from '../testing/maintenance-db-contract.mjs';
import {readRealtimePublication} from '../testing/realtime151-contract.mjs';
import {readNotificationSnapshot} from './frankfurt-notification-hold.mjs';
import {assessOwner217Cron,assertOwner217HeldSettings} from './owner-telegram217-notifications.mjs';
import {assertReady220Catalog} from './frankfurt-reference220.mjs';
import {assertReady222Catalog,assertPrice222Additive,independentPrices222Name} from './independent-prices222-catalog.mjs';
import {functionReference222} from './function-reference222.mjs';
const root=path.resolve(import.meta.dirname,'../..');
export async function capturePrices222Reference(output){
 await mkdir(output,{recursive:true});let local;
 try{
  local=await startPrices222Local(220);
  const capture=async()=>{const catalog=JSON.parse(await local.sql(schemaCatalogSql));return{catalog,catalogSha256:sha256(JSON.stringify(catalog)),appliedVersions:JSON.parse(await local.sql('SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations;')),buildUtcDate:await local.sql("SELECT(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;"),realtimePublication:await readRealtimePublication(local.executor)};};
  const prefixes={'220':await capture()};assertReady220Catalog(prefixes['220'].catalog);
  const migration=canonicalLf(await readFile(path.join(root,'supabase/migrations',independentPrices222Name),'utf8'));
  await local.sql(migration);
  // Same history row as repair; a local SQL transport is used after network
  // detachment. No --linked path or remote discovery is available here.
  await local.sql("INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('222','independent_lite_parcel_prices','{}');");
  prefixes['222']=await capture();assertPrice222Additive(prefixes['220'].catalog,prefixes['222'].catalog);assertReady222Catalog(prefixes['222'].catalog);
  await assertOwner217HeldSettings(local.executor);
  const notificationSnapshot=await readNotificationSnapshot(local.executor);
  const jobs=JSON.parse(await local.sql("SELECT jsonb_agg(jsonb_build_object('name',jobname,'command',command,'schedule',schedule,'active',active)ORDER BY jobname)FROM cron.job;"));
  const cronAudit=assessOwner217Cron(jobs);await local.stop();local=null;
  local=await startPrices222Local(222);const fresh=await capture();assertReady222Catalog(fresh.catalog);await assertOwner217HeldSettings(local.executor);
  const differences=catalogDifference(prefixes['222'].catalog,fresh.catalog,{beforeBuildDate:prefixes['222'].buildUtcDate,afterBuildDate:fresh.buildUtcDate});
  await writeFile(path.join(output,'fresh-incremental-differences.json'),JSON.stringify(differences,null,2)+'\n');assert.deepEqual(differences,[],'PRICES222_FRESH_INCREMENTAL_DIFFERENCES');assert.deepEqual(fresh.realtimePublication,prefixes['222'].realtimePublication);
  const functions=await functionReference222(local.executor),postgresVersion=await local.sql('SHOW server_version;');
  return {prefixes,functions,postgresVersion,notificationSnapshot,cronAudit,manifestSha256:manifestDigest(local.manifest),networkAttachments:0};
 }finally{if(local)await local.stop();}
}
