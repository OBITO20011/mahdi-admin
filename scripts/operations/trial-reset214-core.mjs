// RESET214 only. Snapshots containing settings/profile rows stay in memory.
// Reports contain counts and one-way fingerprints, never row values or MFA secrets.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {executeInput} from './build-empty-supabase.mjs';
import {schemaCatalogSql,catalogDifference} from '../testing/schema-catalog.mjs';
import {sha256} from '../testing/maintenance-db-contract.mjs';
import {heldJobNames,readNotificationSnapshot,expectedHeldNotifications} from './frankfurt-notification-hold.mjs';
import {assertManagedCatalog} from './managed-catalog-policy.mjs';
import {compareApplicationAcl} from './application-acl-verification.mjs';
import {assertReady214Catalog} from './frankfurt-reference214.mjs';
import {readRealtimePublication} from '../testing/realtime151-contract.mjs';
import {cleanSeedCounts,resetUnits,uuid,sqlLiteral,readRowCounts,resetComparisonDates,restoreResetAcl,
 canonicalResetAcl,externalDependentsSql,assertExternalDependents,ownerRecordSql,preservedStateSql,
 restoreMainWarehouseSql,dropPublicSql} from './trial-reset-core.mjs';

const q=sqlLiteral;
const retainedTables=['branches','warehouses','roles','profiles','user_roles','units','categories','storefront_settings'];
export const reset214RetentionSql=id=>{
 uuid(id);
 const filter={branches:`id=(SELECT branch_id FROM public.profiles WHERE id=${q(id)}::uuid)`,warehouses:"code='WH-MAIN'",
 roles:`id IN (SELECT role_id FROM public.user_roles WHERE user_id=${q(id)}::uuid)`,profiles:`id=${q(id)}::uuid`,user_roles:`user_id=${q(id)}::uuid`};
 return `SELECT jsonb_build_object(${retainedTables.map(t=>`${q(t)},(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM public.${t} t${filter[t]?' WHERE '+filter[t]:''})`).join(',')});`;
};
const fingerprints=s=>Object.fromEntries(Object.entries(s).map(([name,rows])=>[name,{rows:rows.length,sha256:sha256(JSON.stringify(rows))}]));
export async function captureReset214({executor,ownerId,reference}){
 assert.equal(reference.migrationCeiling,214,'RESET214_REFERENCE_REQUIRED');assert.equal(reference.manifest.length,176);
 const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,'RESET214_READ_FAILED');return r.stdout.trim();};
 const json=async input=>JSON.parse(await sql(input));
 const owner=await json(ownerRecordSql(ownerId));assert.ok(owner?.profile?.is_active,'RESET214_ACTIVE_OWNER_REQUIRED');assert.deepEqual(owner.roles,['owner']);
 const snapshot=await json(reset214RetentionSql(ownerId));
 for(const t of ['branches','warehouses','roles','profiles','user_roles','storefront_settings'])assert.equal(snapshot[t].length,1,'RESET214_RETAINED_SINGLETON:'+t);
 owner.warehouse=snapshot.warehouses[0];restoreMainWarehouseSql(owner);
 assert.equal(snapshot.branches[0].code,'BR-MAIN');
 assert.equal(snapshot.roles[0].code,'owner');
 // Preserving the row exactly and deleting its referenced editor are incompatible.
 // Reject before any API/database mutation; owner must save settings as themselves.
 assert.ok(snapshot.storefront_settings[0].updated_by===null||snapshot.storefront_settings[0].updated_by===ownerId,'RESET214_SETTINGS_EDITOR_NOT_SELECTED_OWNER');
 assert.equal(await sql(`SELECT EXISTS(SELECT 1 FROM auth.mfa_factors WHERE user_id=${q(uuid(ownerId))}::uuid AND status='verified');`),'t','RESET214_VERIFIED_MFA_REQUIRED');
 const preserved=await json(preservedStateSql(ownerId));assert.ok(preserved.ownerAuth,'RESET214_OWNER_AUTH_REQUIRED');
 assert.deepEqual(preserved.buckets.map(b=>b.id),['product-images'],'RESET214_UNREVIEWED_BUCKET');
 const before=await readRowCounts(executor),platform=await json(`SELECT jsonb_build_object('authUsers',(SELECT count(*) FROM auth.users),'storageObjects',(SELECT count(*) FROM storage.objects),'vaultSecrets',(SELECT count(*) FROM vault.secrets));`);
 const expected={...Object.fromEntries(Object.keys(before).map(t=>[t,cleanSeedCounts[t]??0])),...Object.fromEntries(retainedTables.map(t=>[t,snapshot[t].length]))};
 const plan={migrationCeiling:214,migrations:176,ownerId,
  publicTables:Object.keys(before).sort().map(table=>({table,before:before[table],retained:snapshot[table]?.length??0,deleted:before[table]-(snapshot[table]?.length??0),expectedAfter:expected[table]})),
  authUsers:{before:platform.authUsers,retained:1,deleted:platform.authUsers-1,expectedAfter:1},
  productImages:{before:platform.storageObjects,retained:0,deleted:platform.storageObjects,expectedAfter:0},
  vaultSecrets:{before:platform.vaultSecrets,retained:platform.vaultSecrets,deleted:0,expectedAfter:platform.vaultSecrets},
  untouched:['Auth/Edge configuration outside public','Vault','selected owner Auth/identities/MFA/sessions'],
  preserved:fingerprints(snapshot)};
 return {snapshot,plan,expected};
}

export function restoreReset214Sql(snapshot){
 for(const t of retainedTables)assert.ok(Array.isArray(snapshot[t]),'RESET214_SNAPSHOT_REQUIRED');
 // Seed-only dictionaries/settings can be replaced after all business tables
 // have been recreated empty. No protected ledger is deleted or truncated.
 const clear=['storefront_settings','categories','units'].map(t=>`DELETE FROM public.${t};`).join('\n');
 const inserts=retainedTables.map(t=>`INSERT INTO public.${t} SELECT * FROM jsonb_populate_recordset(NULL::public.${t},${q(JSON.stringify(snapshot[t]))}::jsonb);`).join('\n');
 return `BEGIN;${clear}\n${inserts}\nCOMMIT;`;
}

// Durable, sanitized journal: a failure/crash never leaves a successful report.
// A failed destructive attempt requires restoration of the pre-reset archive,
// not replay against a partial schema. This is NOT a cross-API transaction.
export async function reset214WithExecutor(options){
 const {executor,reference,ownerId,output}=options;
 const target=options.report??{};
 const persist=()=>writeFileSync(path.join(output,'reset214-progress.json'),JSON.stringify(target,null,2)+'\n');
 Object.assign(target,{ok:false,complete:false,recoveryRequired:false,destructiveStarted:false});persist();
 const report=new Proxy(target,{set(object,key,value){object[key]=value;if(key==='stage'||key==='destructiveStarted')persist();return true;}});
 try{
  report.stage='retention-preflight';
  const state=await captureReset214({executor,ownerId,reference});report.plan=state.plan;
  const r=await executeInput(executor,schemaCatalogSql);assert.equal(r.code,0,'RESET214_CATALOG_READ_FAILED');
  const catalog=JSON.parse(r.stdout.trim());assertReady214Catalog(catalog);
  assert.equal(compareApplicationAcl(reference.catalog,catalog).differenceCount,0,'RESET214_APPLICATION_ACL_MISMATCH');
  await rebuild214({...options,report,state});
  Object.assign(target,{ok:true,complete:true,recoveryRequired:false});
  return target;
 }catch(error){
  const code=/\b(?:RESET[A-Z0-9_]*|PRESERVED_AUTH_VAULT_BUCKET_STATE_CHANGED|TRIAL_RESET_SQL_FAILED|UNREVIEWED_STORAGE_BUCKET|NOTIFICATION_STATE_MISMATCH)\b/u.exec(error.message)?.[0]??'RESET214_FAILED';
  Object.assign(target,{ok:false,complete:false,failureStage:target.stage,comparisonCode:code,recoveryRequired:target.destructiveStarted===true,
   nextAction:target.destructiveStarted?'KEEP_WRITERS_STOPPED_RESTORE_PRE_RESET_ARCHIVE':'FIX_PREFLIGHT_AND_REVIEW_NEW_DRY_RUN'});
  throw new Error(code,{cause:error});
 }finally{persist();}
}

async function rebuild214({executor,root,reference,output,repair,clearHistory,emptyStorage,deleteOtherAuth,finalDryRun,ownerId,report={},state}){
 const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,'TRIAL_RESET_SQL_FAILED');return r.stdout.trim();};
 const json=async input=>JSON.parse(await sql(input));
 const units=await resetUnits(root,reference);uuid(ownerId);
 Object.assign(report,{stage:'catalog-preflight',applied:[],recorded:[],destructiveStarted:false});
 const before=await json(schemaCatalogSql),startDay=await sql("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;");
 const dates=resetComparisonDates(reference.buildUtcDate,startDay);
 // Local rehearsal uses full literal comparison. Managed owner admission does
 // its normalized,strict-application check before calling this executor.
 assertManagedCatalog(reference.catalog,before,dates.admission);
 restoreResetAcl(before,before); // Unsupported grantors must fail BEFORE deleting files/data.
 const dependents=await json(externalDependentsSql);assertExternalDependents(dependents,reference.migrationCeiling);report.externalDependents=dependents;
 assert.ok(before.tables.some(t=>t.schema==='public'&&t.name==='product_cost_corrections'),'RESET182_REQUIRED');
 const notifications=await readNotificationSnapshot(executor);
 assert.equal(notifications.trigger.enabled,'D','RESET_NOTIFICATION_HOLD_REQUIRED');
 assert.ok(notifications.jobs.filter(j=>heldJobNames.includes(j.name)).every(j=>j.active===false));
 assert.equal(notifications.jobs.length,5);
 const owner=await json(ownerRecordSql(ownerId));assert.deepEqual(owner.roles,['owner']);
 if(reference.migrationCeiling>=199){
  const main=await json("SELECT COALESCE(jsonb_agg(to_jsonb(w)),'[]'::jsonb) FROM public.warehouses w WHERE code='WH-MAIN';");
  assert.equal(main.length,1,'RESET_MAIN_WAREHOUSE_REQUIRED');owner.warehouse=main[0];
  restoreMainWarehouseSql(owner); // validate location before any destructive work
 }
 if(owner.branch)assert.equal(owner.branch.id,owner.profile.branch_id,'OWNER_BRANCH_ID_MISMATCH');
 assert.ok(owner.profile.is_active);report.beforeCounts=await readRowCounts(executor);
 const preserved=await json(preservedStateSql(ownerId));assert.ok(preserved.ownerAuth);
 assert.deepEqual(preserved.buckets.map(b=>b.id),['product-images'],'UNREVIEWED_STORAGE_BUCKET');
 report.destructiveStarted=true;report.stage='empty-storage-api';await emptyStorage();
 assert.equal(await sql('SELECT count(*) FROM storage.objects;'),'0','STORAGE_NOT_EMPTY');
 report.stage='drop-public';report.destructiveStarted=true;
 await sql('SELECT cron.alter_job(jobid,active:=false) FROM cron.job;');
 await sql(dropPublicSql);await clearHistory();
 report.stage='delete-trial-auth';await deleteOtherAuth(ownerId);
 assert.equal(await sql('SELECT count(*) FROM auth.users;'),'1','ONLY_OWNER_AUTH_MUST_REMAIN');
 for(const unit of units){
  const version=unit.name.slice(0,3);report.stage='rebuild-'+version;
  await sql(unit.input);report.applied.push(version);
  // Do not leave scheduled outbox producers active between migrations.
  if(Number(version)>=91)await sql(`SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname IN (${heldJobNames.map(sqlLiteral).join(',')});`);
  if(Number(version)>=33)await sql('ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;');
  await repair(version);report.recorded.push(version);
 }
 // An untouched clean build has original O/all-active metadata. Rebuild jobs
 // get NEW IDs;preserve command/schedule by name and record the fresh snapshot.
 report.stage='notification-hold';const current=await readNotificationSnapshot(executor);
 const original={...current,trigger:{...current.trigger,enabled:'O'},jobs:current.jobs.map(j=>({...j,active:true}))};
 assert.deepEqual(current,expectedHeldNotifications(original),'RESET_HOLD_CHANGED');
 for(const old of notifications.jobs){const fresh=current.jobs.find(j=>j.name===old.name);assert.ok(fresh);
  for(const key of ['name','schedule','command','host','port','database','username','active'])assert.deepEqual(fresh[key],old[key],'RESET_CRON_CHANGED:'+old.name+':'+key);}
 report.notificationOriginal=original;
 report.stage='restore-owner-and-settings';await sql(restoreReset214Sql(state.snapshot));
 const retained=await json(reset214RetentionSql(ownerId));assert.deepEqual(retained,state.snapshot,'RESET214_RETAINED_VALUES_CHANGED');
 report.preservation={before:state.plan.preserved,after:fingerprints(retained),matches:true};
 const afterPreserved=await json(preservedStateSql(ownerId));assert.deepEqual(afterPreserved,preserved,'PRESERVED_AUTH_VAULT_BUCKET_STATE_CHANGED');
 const counts=await readRowCounts(executor);report.afterCounts=counts;
 assert.deepEqual(counts,state.expected,'RESET214_CLEAN_COUNTS_DIFFER');
 report.authVaultMfaProof={before:preserved,after:afterPreserved,matches:true};
 if(owner.warehouse){
  assert.deepEqual(await json("SELECT to_jsonb(w) FROM public.warehouses w WHERE code='WH-MAIN';"),owner.warehouse,'RESET_MAIN_WAREHOUSE_CHANGED');
  report.mainWarehousePreserved=true;
 }
 assert.equal(await sql('SELECT count(*) FROM supabase_migrations.seed_files;'),'0','RESET_SEED_MUST_NOT_BE_RECORDED');
 assert.deepEqual(await readRealtimePublication(executor),reference.realtimePublication,'RESET_PUBLICATION_MISMATCH');
 report.stage='restore-exact-creation-acl';const rebuilt=await json(schemaCatalogSql);
 const finalDates=resetComparisonDates(reference.buildUtcDate,startDay,await sql("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;"));report.comparisonDates=finalDates;
 await writeFile(path.join(output,'reset-pre-alignment-differences.json'),JSON.stringify(catalogDifference(canonicalResetAcl(before),canonicalResetAcl(rebuilt),finalDates.rebuild),null,2)+'\n');
 const restoredAcl=restoreResetAcl(before,rebuilt);
 report.restoredAclCommands=restoredAcl.length;if(restoredAcl.length)await sql('BEGIN;'+restoredAcl.join('\n')+'COMMIT;');
 const after=await json(schemaCatalogSql);const differences=catalogDifference(canonicalResetAcl(before),canonicalResetAcl(after),finalDates.rebuild);
 await writeFile(path.join(output,'reset-catalog-differences.json'),JSON.stringify(differences,null,2)+'\n');
 assert.deepEqual(differences,[],'RESET_CATALOG_NOT_CLEAN_BUILD');
 assert.equal(compareApplicationAcl(reference.catalog,after).differenceCount,0,'RESET214_FINAL_ACL_MISMATCH');
 assertReady214Catalog(after);
 assert.deepEqual(await json('SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations;'),reference.appliedVersions,'RESET214_FINAL_HISTORY_MISMATCH');
 await finalDryRun();Object.assign(report,{stage:'complete',preserved:true,catalogDifferences:0,applicationAclDifferences:0});return report;
}
