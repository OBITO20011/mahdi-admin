// Versioned retained resets214/215/216 share the same write fence and resume
// engine. Raw settings stay in protected external retention; Auth/MFA only hashes.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {executeResetInput as executeInput} from './reset214-io.mjs';
import {schemaCatalogSql,catalogDifference} from '../testing/schema-catalog.mjs';
import {sha256} from '../testing/maintenance-db-contract.mjs';
import {heldJobNames,readNotificationSnapshot,expectedHeldNotifications} from './frankfurt-notification-hold.mjs';
import {assertManagedCatalog} from './managed-catalog-policy.mjs';
import {compareApplicationAcl} from './application-acl-verification.mjs';
import {assertReady214Catalog} from './frankfurt-reference214.mjs';
import {assertReady215Catalog} from './frankfurt-reference215.mjs';
import {assertReady216Catalog} from './frankfurt-reference216.mjs';
import {assertReady217Catalog} from './frankfurt-reference217.mjs';
import {expectedHeld217Notifications,ownerTelegramJob} from './owner-telegram217-notifications.mjs';
import {assertCurrentResetReference,assertSupportedResetReference} from './operational-schema.mjs';
import {readRealtimePublication} from '../testing/realtime151-contract.mjs';
import {retainedSessionState,assertNoForeignWrites,withoutResetGuard,attachGuardSql,removeGuardSql,saveGuardRemovalProof} from './reset214-session.mjs';
import {lockAndCheckGuardSql,publicFingerprint} from './reset214-write-guard.mjs';
import {reset214SqlFailureCode} from './reset214-diagnostics.mjs';
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
// JSONB arrays travel inside JSON strings. Never parse/re-serialize their
// numbers for restoration or fingerprints: BIGINT/NUMERIC may exceed 2^53.
export const reset214RetentionRawSql=id=>`WITH retained(v) AS (${reset214RetentionSql(id).replace(/;$/u,'')})
 SELECT jsonb_object_agg(key,value::text) FROM retained,LATERAL jsonb_each(v);`;
const fingerprints=raw=>Object.fromEntries(Object.entries(raw).map(([name,text])=>[name,{rows:JSON.parse(text).length,sha256:sha256(text)}]));
const policy214={ceiling:214,files:176,assertCatalog:assertReady214Catalog};
const policy215={ceiling:215,files:177,assertCatalog:assertReady215Catalog};
const policy216={ceiling:216,files:178,assertCatalog:assertReady216Catalog};
const policy217={ceiling:217,files:179,assertCatalog:assertReady217Catalog};
export const captureReset214=options=>captureRetainedReset(options,policy214);
export const captureReset215=options=>{assertSupportedResetReference(options.reference);return captureRetainedReset(options,policy215);};
export const captureReset216=options=>{assertSupportedResetReference(options.reference);return captureRetainedReset(options,policy216);};
export const captureReset217=options=>{assertCurrentResetReference(options.reference);return captureRetainedReset(options,policy217);};
async function captureRetainedReset({executor,ownerId,reference},policy){
 assert.equal(reference.migrationCeiling,policy.ceiling,'RESET_REFERENCE_REQUIRED');assert.equal(reference.manifest.length,policy.files);
 const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,'RESET214_READ_FAILED');return r.stdout.trim();};
 const json=async input=>JSON.parse(await sql(input));
 const owner=await json(ownerRecordSql(ownerId));assert.ok(owner?.profile?.is_active,'RESET214_ACTIVE_OWNER_REQUIRED');assert.deepEqual(owner.roles,['owner']);
 const rawTables=await json(reset214RetentionRawSql(ownerId));
 // Parsed copies are ONLY for UUID/role/boolean/array-length admission.
 const snapshot=Object.fromEntries(Object.entries(rawTables).map(([name,text])=>[name,JSON.parse(text)]));
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
 const initialFingerprint=await publicFingerprint(executor);
 const plan={migrationCeiling:policy.ceiling,migrations:policy.files,ownerId,initialDataSha256:sha256(JSON.stringify(initialFingerprint)),
  publicTables:Object.keys(before).sort().map(table=>({table,before:before[table],retained:snapshot[table]?.length??0,deleted:before[table]-(snapshot[table]?.length??0),expectedAfter:expected[table]})),
  authUsers:{before:platform.authUsers,retained:1,deleted:platform.authUsers-1,expectedAfter:1},
  productImages:{before:platform.storageObjects,retained:0,deleted:platform.storageObjects,expectedAfter:0},
  vaultSecrets:{before:platform.vaultSecrets,retained:platform.vaultSecrets,deleted:0,expectedAfter:platform.vaultSecrets},
  untouched:['Auth/Edge configuration outside public','Vault','selected owner Auth/identities/MFA/sessions'],
  preserved:fingerprints(rawTables)};
 return {snapshot,rawTables,plan,expected,initialFingerprint};
}

export function restoreReset214Sql(rawTables){
 for(const t of retainedTables){assert.equal(typeof rawTables[t],'string','RESET214_RAW_SNAPSHOT_REQUIRED');assert.ok(Array.isArray(JSON.parse(rawTables[t])),'RESET214_SNAPSHOT_REQUIRED');}
 // Seed-only dictionaries/settings can be replaced after all business tables
 // have been recreated empty. No protected ledger is deleted or truncated.
 const clear=['storefront_settings','categories','units'].map(t=>`DELETE FROM public.${t};`).join('\n');
 const inserts=retainedTables.map(t=>`INSERT INTO public.${t} SELECT * FROM jsonb_populate_recordset(NULL::public.${t},${q(rawTables[t])}::jsonb);`).join('\n');
 return `BEGIN;${clear}\n${inserts}\nCOMMIT;`;
}

// Durable, sanitized journal: a failure/crash never leaves a successful report.
// A failed destructive attempt requires restoration of the pre-reset archive,
// not replay against a partial schema. This is NOT a cross-API transaction.
export const reset214WithExecutor=options=>runRetainedReset(options,policy214);
export const reset215WithExecutor=options=>{assertSupportedResetReference(options.reference);return runRetainedReset(options,policy215);};
export const reset216WithExecutor=options=>{assertSupportedResetReference(options.reference);return runRetainedReset(options,policy216);};
export const reset217WithExecutor=options=>{assertCurrentResetReference(options.reference);return runRetainedReset(options,policy217);};
async function runRetainedReset(options,policy){
 const {executor,reference,ownerId,output}=options;
 assert.equal(reference.migrationCeiling,policy.ceiling,'RESET_REFERENCE_REQUIRED');assert.equal(reference.manifest.length,policy.files);
 const target=options.report??{};
 const persist=()=>writeFileSync(path.join(output,`reset${policy.ceiling}-progress.json`),JSON.stringify(target,null,2)+'\n');
 const session=options.session;
 Object.assign(target,{ok:false,complete:false,recoveryRequired:false,destructiveStarted:false,
  ...(session?{originalAttemptId:session.saved.attemptId,resumedFrom:session.resume?session.previousOutput:null}: {})});persist();
 const report=new Proxy(target,{set(object,key,value){object[key]=value;if(key==='destructiveStarted'&&value===true)object.recoveryRequired=true;if(key==='stage'||key==='destructiveStarted')persist();return true;}});
 try{
  report.stage='retention-preflight';
  const state=session?retainedSessionState(session):await captureRetainedReset({executor,ownerId,reference},policy);report.plan=state.plan;
  if(options.expectedPlan)assert.deepEqual(state.plan,options.expectedPlan,'RESET214_PREVIEW_CHANGED');
  assert.equal(state.snapshot.storefront_settings[0].orders_enabled,false,'RESET214_STORE_ORDERS_MUST_BE_DISABLED');
  const r=await executeInput(executor,schemaCatalogSql);assert.equal(r.code,0,'RESET214_CATALOG_READ_FAILED');
  const catalog=session?.resume?session.saved.catalog:withoutResetGuard(JSON.parse(r.stdout.trim()));policy.assertCatalog(catalog);
  assert.equal(compareApplicationAcl(reference.catalog,catalog).differenceCount,0,'RESET214_APPLICATION_ACL_MISMATCH');
  if(session)await assertNoForeignWrites(executor,session.saved);
  if(session&&!session.resume)assert.deepEqual(await publicFingerprint(executor),session.saved.initialFingerprint,'RESET214_PREVIEW_CHANGED');
  await rebuild214({...options,report,state,policy});
  Object.assign(target,{ok:true,complete:true,recoveryRequired:false});
  return target;
 }catch(error){
  const code=/\b(?:RESET[A-Z0-9_]*|PRESERVED_AUTH_VAULT_BUCKET_STATE_CHANGED|TRIAL_RESET_SQL_FAILED|UNREVIEWED_STORAGE_BUCKET|NOTIFICATION_STATE_MISMATCH)\b/u.exec(error.message)?.[0]??'RESET214_FAILED';
  Object.assign(target,{ok:false,complete:false,failureStage:target.stage,comparisonCode:code,recoveryRequired:target.destructiveStarted===true,
   nextAction:target.destructiveStarted?(session?'KEEP_WRITERS_STOPPED_REVIEW_CAUSE_THEN_RESUME':'KEEP_WRITERS_STOPPED_RESTORE_PRE_RESET_ARCHIVE'):'FIX_PREFLIGHT_AND_REVIEW_NEW_DRY_RUN'});
  target.failureLocation=error.stack?.split('\n').slice(1).map(line=>/([a-z0-9_-]+\.mjs):(\d+):(\d+)/iu.exec(line)).filter(Boolean).map(m=>({file:m[1],line:Number(m[2])})).slice(0,3);
  throw new Error(code,{cause:error});
 }finally{persist();}
}

async function rebuild214({executor,root,reference,output,repair,clearHistory,emptyStorage,deleteOtherAuth,finalDryRun,ownerId,report={},state,session,policy,boundary=async()=>{}}){
 const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,reset214SqlFailureCode(r.stderr));return r.stdout.trim();};
 const json=async input=>JSON.parse(await sql(input));
 const units=await resetUnits(root,reference);uuid(ownerId);
 Object.assign(report,{stage:'catalog-preflight',applied:[],recorded:[],destructiveStarted:false});
 const before=session?session.saved.catalog:await json(schemaCatalogSql),startDay=session?session.saved.buildDay:await sql("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;");
 const dates=resetComparisonDates(reference.buildUtcDate,startDay);
 // Local rehearsal uses full literal comparison. Managed owner admission does
 // its normalized,strict-application check before calling this executor.
 report.stage='managed-catalog-preflight';assertManagedCatalog(reference.catalog,before,dates.admission);
 report.stage='acl-grantor-preflight';
 restoreResetAcl(before,before); // Unsupported grantors must fail BEFORE deleting files/data.
 report.stage='external-dependencies-preflight';const dependents=await json(externalDependentsSql);assertExternalDependents(dependents,reference.migrationCeiling);report.externalDependents=dependents;
 assert.ok(before.tables.some(t=>t.schema==='public'&&t.name==='product_cost_corrections'),'RESET182_REQUIRED');
 report.stage='notification-hold-preflight';const notifications=session?session.saved.notifications:await readNotificationSnapshot(executor);
 assert.equal(notifications.trigger.enabled,'D','RESET_NOTIFICATION_HOLD_REQUIRED');
 assert.ok(notifications.jobs.filter(j=>heldJobNames.includes(j.name)).every(j=>j.active===false));
 assert.equal(notifications.jobs.length,policy.ceiling===217?6:5);
 if(policy.ceiling===217){
  const original={...notifications,trigger:{...notifications.trigger,enabled:'O'},jobs:notifications.jobs.map(j=>({...j,active:j.name!==ownerTelegramJob.name}))};
  assert.deepEqual(notifications,expectedHeld217Notifications(original,notifications),'RESET217_DISPATCH_MUST_REMAIN_HELD');
  if(!session?.resume)assert.equal(await sql('SELECT NOT enabled AND (lease_expires_at IS NULL OR lease_expires_at<clock_timestamp()) FROM public.owner_telegram_dispatch_settings WHERE id;'),'t','RESET217_STOP_DISPATCH_BEFORE_RESET');
 }
 report.stage='owner-preservation-preflight';const owner=session?{profile:state.snapshot.profiles[0],branch:state.snapshot.branches[0],warehouse:state.snapshot.warehouses[0],roles:state.snapshot.roles.map(r=>r.code)}:await json(ownerRecordSql(ownerId));assert.deepEqual(owner.roles,['owner']);
 if(reference.migrationCeiling>=199&&!session){
  const main=await json("SELECT COALESCE(jsonb_agg(to_jsonb(w)),'[]'::jsonb) FROM public.warehouses w WHERE code='WH-MAIN';");
  assert.equal(main.length,1,'RESET_MAIN_WAREHOUSE_REQUIRED');owner.warehouse=main[0];
  restoreMainWarehouseSql(owner); // validate location before any destructive work
 }
 if(owner.branch)assert.equal(owner.branch.id,owner.profile.branch_id,'OWNER_BRANCH_ID_MISMATCH');
 assert.ok(owner.profile.is_active);report.beforeCounts=session?Object.fromEntries(Object.entries(await publicFingerprint(executor)).map(([k,v])=>[k,v.rows])):await readRowCounts(executor);
 const preserved=session?(session.platformBaseline??session.saved.preserved):await json(preservedStateSql(ownerId));assert.ok(preserved.ownerAuth);
 assert.deepEqual(preserved.buckets.map(b=>b.id),['product-images'],'UNREVIEWED_STORAGE_BUCKET');
 report.destructiveStarted=true;report.stage='empty-storage-api';await emptyStorage();
 assert.equal(await sql('SELECT count(*) FROM storage.objects;'),'0','STORAGE_NOT_EMPTY');
 await boundary('after-storage');
 report.stage='drop-public';report.destructiveStarted=true;
 await sql('SELECT cron.alter_job(jobid,active:=false) FROM cron.job;');
 // Exactly the validated217 held transport job is recreated by217. Remove
 // that row through the supported API;old five schedules keep their contracts.
 if(policy.ceiling===217)await sql("SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='owner-telegram-dispatch';");
 if(session)await assertNoForeignWrites(executor,session.saved);
 await sql(session?dropPublicSql.replace('SET LOCAL search_path=pg_catalog;','SET LOCAL search_path=pg_catalog;'+lockAndCheckGuardSql):dropPublicSql);await boundary('after-drop-public');await clearHistory();
 report.stage='delete-trial-auth';await deleteOtherAuth(ownerId);
 assert.equal(await sql('SELECT count(*) FROM auth.users;'),'1','ONLY_OWNER_AUTH_MUST_REMAIN');
 for(const unit of units){
  const version=unit.name.slice(0,3);report.stage='rebuild-'+version;
  await sql(unit.input);report.applied.push(version);
  if(session){
   // Detect any new business row before admitting newly created relations to
   // the write witness;the owner profile is absent throughout literal rebuild.
   await assertNoForeignWrites(executor,session.saved);await sql(attachGuardSql);
  }
  // Do not leave scheduled outbox producers active between migrations.
  if(Number(version)>=91)await sql(`SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname IN (${heldJobNames.map(sqlLiteral).join(',')});`);
  if(Number(version)>=33)await sql('ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;');
  await boundary('migration-'+version);await repair(version);report.recorded.push(version);
 }
 // An untouched clean build has original O/all-active metadata. Rebuild jobs
 // get NEW IDs;preserve command/schedule by name and record the fresh snapshot.
 report.stage='notification-hold';const current=await readNotificationSnapshot(executor);
 const original={...current,trigger:{...current.trigger,enabled:'O'},jobs:current.jobs.map(j=>({...j,active:policy.ceiling===217?j.name!==ownerTelegramJob.name:true}))};
 assert.deepEqual(current,policy.ceiling===217?expectedHeld217Notifications(original,current):expectedHeldNotifications(original),'RESET_HOLD_CHANGED');
 for(const old of notifications.jobs){const fresh=current.jobs.find(j=>j.name===old.name);assert.ok(fresh);
  for(const key of ['name','schedule','command','host','port','database','username','active'])assert.deepEqual(fresh[key],old[key],'RESET_CRON_CHANGED:'+old.name+':'+key);}
 report.notificationOriginal=original;
 await boundary('before-restore-owner-and-settings');
 report.stage='restore-owner-and-settings';await sql(restoreReset214Sql(state.rawTables));
 const retained=await json(reset214RetentionRawSql(ownerId));
 report.preservation={before:state.plan.preserved,after:fingerprints(retained),matches:JSON.stringify(retained)===JSON.stringify(state.rawTables)};
 assert.deepEqual(retained,state.rawTables,'RESET214_RETAINED_VALUES_CHANGED');
 const afterPreserved=await json(preservedStateSql(ownerId));
 report.authVaultMfaProof={before:preserved,after:afterPreserved,matches:JSON.stringify(afterPreserved)===JSON.stringify(preserved)};
 assert.deepEqual(afterPreserved,preserved,'PRESERVED_AUTH_VAULT_BUCKET_STATE_CHANGED');
 const counts=await readRowCounts(executor);report.afterCounts=counts;
 assert.deepEqual(counts,state.expected,'RESET214_CLEAN_COUNTS_DIFFER');
 if(owner.warehouse){
  assert.deepEqual(await json("SELECT to_jsonb(w) FROM public.warehouses w WHERE code='WH-MAIN';"),owner.warehouse,'RESET_MAIN_WAREHOUSE_CHANGED');
  report.mainWarehousePreserved=true;
 }
 assert.equal(await sql('SELECT count(*) FROM supabase_migrations.seed_files;'),'0','RESET_SEED_MUST_NOT_BE_RECORDED');
 assert.deepEqual(await readRealtimePublication(executor),reference.realtimePublication,'RESET_PUBLICATION_MISMATCH');
 report.stage='restore-exact-creation-acl';const rebuilt=await json(schemaCatalogSql);
 const finalDates=resetComparisonDates(reference.buildUtcDate,startDay,await sql("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;"));report.comparisonDates=finalDates;
 await writeFile(path.join(output,'reset-pre-alignment-differences.json'),JSON.stringify(catalogDifference(canonicalResetAcl(before),canonicalResetAcl(rebuilt),finalDates.rebuild),null,2)+'\n');
 if(session)await assertNoForeignWrites(executor,session.saved);
 const restoredAcl=restoreResetAcl(before,withoutResetGuard(rebuilt));
 report.restoredAclCommands=restoredAcl.length;if(restoredAcl.length)await sql('BEGIN;'+restoredAcl.join('\n')+'COMMIT;');
 if(session){await saveGuardRemovalProof(session,executor);await sql(removeGuardSql.replace('BEGIN;','BEGIN;'+lockAndCheckGuardSql));}
 const after=await json(schemaCatalogSql);const differences=catalogDifference(canonicalResetAcl(before),canonicalResetAcl(after),finalDates.rebuild);
 await writeFile(path.join(output,'reset-catalog-differences.json'),JSON.stringify(differences,null,2)+'\n');
 assert.deepEqual(differences,[],'RESET_CATALOG_NOT_CLEAN_BUILD');
 assert.equal(compareApplicationAcl(reference.catalog,after).differenceCount,0,'RESET214_FINAL_ACL_MISMATCH');
 policy.assertCatalog(after);
 assert.deepEqual(await json('SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations;'),reference.appliedVersions,'RESET214_FINAL_HISTORY_MISMATCH');
 await finalDryRun();Object.assign(report,{stage:'complete',preserved:true,catalogDifferences:0,applicationAclDifferences:0});return report;
}
