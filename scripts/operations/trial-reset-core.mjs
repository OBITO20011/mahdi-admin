// Owner2026-10-16: rebuild, never DELETE/TRUNCATE protected business data.
// No connection discovery here. Owner CLI and isolated rehearsal inject I/O.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {buildEmptyProjectInput,executeInput} from './build-empty-supabase.mjs';
import {migrationManifest,canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql,catalogDifference} from '../testing/schema-catalog.mjs';
import {heldJobNames,readNotificationSnapshot,expectedHeldNotifications} from './frankfurt-notification-hold.mjs';
import {assertManagedCatalog,aclEntries} from './managed-catalog-policy.mjs';
import {readRealtimePublication} from '../testing/realtime151-contract.mjs';

export const resetCeiling=182;
const resetFileCounts=Object.freeze({182:151,199:161,200:162,201:163,202:164,203:165,204:166});
export function assertResetCeiling(reference){
 assert.ok(Object.hasOwn(resetFileCounts,reference.migrationCeiling),'RESET_REFERENCE_CEILING');
 return resetFileCounts[reference.migrationCeiling];
}
export function resetComparisonDates(referenceDay,startDay,endDay=startDay){
 for(const day of [referenceDay,startDay,endDay])assert.match(day,/^\d{4}-\d{2}-\d{2}$/u,'RESET_UTC_DATE_REQUIRED');
 return {admission:{beforeBuildDate:referenceDay,afterBuildDate:startDay},rebuild:{beforeBuildDate:startDay,afterBuildDate:endDay}};
}
// Rows created by the migrations,not trial transactions. Every other public
// table MUST be empty;new tables cannot silently escape this assertion.
export const cleanSeedCounts=Object.freeze({advanced_monitoring_checks:22,advanced_monitoring_metrics:1,
 advanced_monitoring_settings:1,audit_logs:1,branches:0,brands:0,business_alert_settings:1,categories:12,
 configurable_parcel_feature_settings:1,go_live_setup_state:1,roles:0,storefront_settings:1,units:11,warehouses:0});
export function assertCleanCounts(counts,ownerPresent=true,ownerBranch=false,mainWarehouse=false){
 const allowed={...cleanSeedCounts,branches:ownerBranch?1:0,warehouses:mainWarehouse?1:0,roles:ownerPresent?1:0,profiles:ownerPresent?1:0,user_roles:ownerPresent?1:0};
 for(const [name,n] of Object.entries(counts))assert.equal(n,allowed[name]??0,'RESET_ROW_COUNT:'+name);
 for(const name of Object.keys(allowed))assert.ok(name in counts,'RESET_EXPECTED_TABLE_MISSING:'+name);
}
export const sqlLiteral=value=>"'"+String(value).replaceAll("'","''")+"'";
export const uuid=value=>{assert.match(value,/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu,'OWNER_UUID_REQUIRED');return value;};
export const rowCountsSql=`DO $counts$ DECLARE r record;n bigint;v jsonb='{}';BEGIN
 FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename LOOP
 EXECUTE format('SELECT count(*) FROM public.%I',r.tablename) INTO n;v=v||jsonb_build_object(r.tablename,n);END LOOP;
 RAISE NOTICE 'RESET_ROW_COUNTS:%',v;END $counts$;`;
export async function readRowCounts(executor){
 const r=await executeInput(executor,rowCountsSql);assert.equal(r.code,0,'COUNTS_READ_FAILED');
 const value=r.stderr.match(/RESET_ROW_COUNTS:(\{[^\r\n]+\})/u)?.[1];assert.ok(value,'COUNTS_MISSING');return JSON.parse(value);
}
export const preservedStateSql=owner=>`SELECT jsonb_build_object(
 'ownerAuth',(SELECT md5(row_to_json(u)::text) FROM auth.users u WHERE id=${sqlLiteral(uuid(owner))}::uuid),
 'ownerIdentities',(SELECT md5(COALESCE(jsonb_agg(to_jsonb(i) ORDER BY id)::text,'')) FROM auth.identities i WHERE user_id=${sqlLiteral(owner)}::uuid),
 'ownerMfa',(SELECT md5(COALESCE(jsonb_agg(to_jsonb(f) ORDER BY id)::text,'')) FROM auth.mfa_factors f WHERE user_id=${sqlLiteral(owner)}::uuid),
 'vault',(SELECT md5(COALESCE(jsonb_agg(to_jsonb(s) ORDER BY id)::text,'')) FROM vault.secrets s),
 'buckets',(SELECT jsonb_agg(to_jsonb(b)-'updated_at' ORDER BY id) FROM storage.buckets b));`;
export const ownerRecordSql=owner=>`SELECT jsonb_build_object('profile',to_jsonb(p),'branch',to_jsonb(b),
 'roles',(SELECT jsonb_agg(r.code ORDER BY r.code) FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.user_id=p.id))
 FROM public.profiles p LEFT JOIN public.branches b ON b.id=p.branch_id
 WHERE p.id=${sqlLiteral(uuid(owner))}::uuid AND p.is_active;`;
// Explicit public-only boundary. Platform schemas and Vault are NEVER dropped.
export const dropPublicSql=`BEGIN;SET LOCAL search_path=pg_catalog;
 DO $rebuild$ DECLARE r record;BEGIN
 FOR r IN SELECT relname,relkind FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN('r','p','v','m','f') LOOP
 IF to_regclass(format('public.%I',r.relname)) IS NOT NULL THEN
 EXECUTE format('DROP %s public.%I CASCADE',CASE r.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END,r.relname);END IF;END LOOP;
 FOR r IN SELECT oid,proname,prokind,pg_get_function_identity_arguments(oid) args FROM pg_proc WHERE pronamespace='public'::regnamespace LOOP
 IF EXISTS(SELECT 1 FROM pg_proc WHERE oid=r.oid) THEN EXECUTE format('DROP %s public.%I(%s) CASCADE',CASE WHEN r.prokind='p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,r.proname,r.args);END IF;END LOOP;
 FOR r IN SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='S' LOOP EXECUTE format('DROP SEQUENCE public.%I CASCADE',r.relname);END LOOP;
 FOR r IN SELECT oid,typname,typtype FROM pg_type WHERE typnamespace='public'::regnamespace AND typtype IN('e','d','c') AND typelem=0 LOOP
 IF EXISTS(SELECT 1 FROM pg_type WHERE oid=r.oid) THEN EXECUTE format('DROP %s public.%I CASCADE',CASE WHEN r.typtype='d' THEN 'DOMAIN' ELSE 'TYPE' END,r.typname);END IF;END LOOP;
 END $rebuild$;COMMIT;`;
const ident=v=>'"'+String(v).replaceAll('"','""')+'"';
export function restoreResetAcl(before,after){
 const commands=[];
 for(const section of ['tables','functions'])for(const row of before[section]??[]){
  if(row.schema!=='public')continue;
  const actual=after[section].find(r=>r.schema==='public'&&(section==='functions'?r.identity===row.identity:r.name===row.name));
  assert.ok(actual,'RESET_ACL_OBJECT_MISSING');assert.equal(row.owner,'postgres');assert.equal(actual.owner,'postgres');
  assert.deepEqual({...actual,acl:null},{...row,acl:null},'RESET_NON_ACL_OBJECT_DRIFT');
  const wanted=aclEntries(row.acl,row,section),have=aclEntries(actual.acl,actual,section);
  assert.ok([...wanted,...have].every(a=>a.grantor==='postgres'),'RESET_ACL_GRANTOR');
  const key=a=>JSON.stringify([a.grantee,a.privilege]);
  let target;
  if(section==='functions'){assert.match(row.identity,/^[a-z_][a-z0-9_]*\([^;]*\)$/u);target='FUNCTION public.'+row.identity;}
  else target=(row.kind==='S'?'SEQUENCE ':'TABLE ')+'public.'+ident(row.name);
  const role=a=>a.grantee==='PUBLIC'?'PUBLIC':ident(a.grantee);
  for(const a of have){const b=wanted.find(b=>key(a)===key(b));
   if(!b)commands.push(`REVOKE ${a.privilege} ON ${target} FROM ${role(a)};`);
   else if(a.grantable&&!b.grantable)commands.push(`REVOKE GRANT OPTION FOR ${a.privilege} ON ${target} FROM ${role(a)};`);}
  for(const a of wanted){const b=have.find(b=>key(a)===key(b));
   if(!b||(!b.grantable&&a.grantable))commands.push(`GRANT ${a.privilege} ON ${target} TO ${role(a)}${a.grantable?' WITH GRANT OPTION':''};`);}
 }
 return commands;
}
// Ordering of PostgreSQL aclitem[] is not a permission. All atoms,grantors and
// grant options INCLUDING service_role remain present in this strict proof.
export function canonicalResetAcl(catalog){const c=structuredClone(catalog);for(const rows of Object.values(c))for(const row of rows??[]){if(Array.isArray(row.acl))row.acl.sort();for(const column of row.columns??[])if(Array.isArray(column.acl))column.acl.sort();}return c;}
export const externalDependentsSql=`WITH RECURSIVE deps(classid,objid,objsubid) AS (
 SELECT 'pg_namespace'::regclass::oid,'public'::regnamespace::oid,0
 UNION
 SELECT d.classid,d.objid,d.objsubid FROM pg_depend d JOIN deps p
 ON d.refclassid=p.classid AND d.refobjid=p.objid AND (p.objsubid=0 OR d.refobjsubid=p.objsubid)
), objects AS (
 SELECT *,COALESCE((pg_identify_object(classid,objid,objsubid)).schema,
 (SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=CASE
 WHEN classid='pg_trigger'::regclass THEN (SELECT tgrelid FROM pg_trigger WHERE oid=objid)
 WHEN classid='pg_policy'::regclass THEN (SELECT polrelid FROM pg_policy WHERE oid=objid)
 WHEN classid='pg_rewrite'::regclass THEN (SELECT ev_class FROM pg_rewrite WHERE oid=objid)
 WHEN classid='pg_attrdef'::regclass THEN (SELECT adrelid FROM pg_attrdef WHERE oid=objid) END)) AS object_schema
 FROM deps)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('class',classid::regclass::text,'description',pg_describe_object(classid,objid,objsubid),
 'schema',object_schema,'policy',(SELECT polname FROM pg_policy WHERE classid='pg_policy'::regclass AND oid=objid),
 'relation',(SELECT polrelid::regclass::text FROM pg_policy WHERE classid='pg_policy'::regclass AND oid=objid),
 'internalFk',(SELECT t.tgisinternal AND c.contype='f' AND c.connamespace='public'::regnamespace AND c.confrelid='auth.users'::regclass
 FROM pg_trigger t JOIN pg_constraint c ON c.oid=t.tgconstraint WHERE classid='pg_trigger'::regclass AND t.oid=objid),
 'publication',(SELECT p.pubname FROM pg_publication_rel pr JOIN pg_publication p ON p.oid=pr.prpubid WHERE classid='pg_publication_rel'::regclass AND pr.oid=objid)) ORDER BY classid,objid,objsubid),'[]'::jsonb)
 FROM objects WHERE object_schema IS DISTINCT FROM 'public'
 AND NOT(classid='pg_namespace'::regclass AND objid='public'::regnamespace)
 AND NOT(classid='pg_default_acl'::regclass AND objid IN(SELECT oid FROM pg_default_acl WHERE defaclnamespace='public'::regnamespace));`;
export function assertExternalDependents(rows){
 const allowed=['ERP staff can upload own product images','ERP staff can update own product images','ERP staff can delete own product images'];
 for(const r of rows){if(r.schema==='pg_toast')continue;
  if(r.class==='pg_trigger'&&r.schema==='auth'&&r.internalFk===true)continue;
  if(r.class==='pg_publication_rel'&&r.publication==='supabase_realtime')continue;
  assert.ok(r.class==='pg_policy'&&r.schema==='storage'&&r.relation==='storage.objects'&&allowed.includes(r.policy),'UNREVIEWED_EXTERNAL_DROP_DEPENDENT:'+r.description);}
}
export async function resetUnits(root,reference){
 const manifest=await migrationManifest(root),fileCount=assertResetCeiling(reference);
 assert.deepEqual(manifest,reference.manifest,'RESET_MANIFEST_CHANGED');assert.equal(manifest.length,fileCount);
 const base=await buildEmptyProjectInput(root);const units=[...base.units];
 for(const m of manifest.filter(m=>Number(m.name.slice(0,3))>138))units.push({name:m.name,input:await readFile(path.join(root,'supabase/migrations',m.name))});
 for(const u of units.filter(u=>!u.name.startsWith('034_'))){
  const source=await readFile(path.join(root,'supabase/migrations',u.name));
  assert.equal(sha256(canonicalLf(source.toString('utf8'))),manifest.find(m=>m.name===u.name).sha256);
 }
 return units;
}
export const restoreOwnerSql=record=>{
 const p=record.profile;uuid(p.id);assert.deepEqual(record.roles,['owner'],'RESET_OWNER_ONLY_ROLE_REQUIRED');
 assert.equal(p.is_active,true);assert.ok(p.full_name?.trim(),'OWNER_NAME_REQUIRED');
 // Preserve only the owner's explicit reference location,not trial locations.
 // The literal migrations do not seed branches (CLI seed.sql is NOT a migration).
 return `BEGIN;DO $owner$ DECLARE b uuid;BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=${sqlLiteral(p.id)}::uuid) THEN RAISE EXCEPTION 'OWNER_AUTH_MISSING';END IF;
 ${record.branch?`INSERT INTO public.branches SELECT * FROM jsonb_populate_record(NULL::public.branches,${sqlLiteral(JSON.stringify(record.branch))}::jsonb);b:=${sqlLiteral(uuid(record.branch.id))};`:''}
 ${record.warehouse?restoreMainWarehouseSql(record):''}
 INSERT INTO public.roles(code,name_ar) VALUES('owner','المالك') ON CONFLICT(code) DO NOTHING;
 INSERT INTO public.profiles(id,full_name,phone,avatar_url,is_active,created_at,updated_at,job_title,branch_id)
 VALUES(${sqlLiteral(p.id)},${sqlLiteral(p.full_name)},${p.phone===null?'NULL':sqlLiteral(p.phone)},NULL,true,
 ${sqlLiteral(p.created_at)},${sqlLiteral(p.updated_at)},${p.job_title===null?'NULL':sqlLiteral(p.job_title)},b);
 INSERT INTO public.user_roles(user_id,role_id) SELECT ${sqlLiteral(p.id)},id FROM public.roles WHERE code='owner';
 IF NOT FOUND THEN RAISE EXCEPTION 'OWNER_ROLE_BINDING_MISSING';END IF;
 END $owner$;COMMIT;`;
};
export function restoreMainWarehouseSql(record){
 const w=record.warehouse,b=record.branch;
 assert.ok(b&&w,'RESET_MAIN_LOCATION_REQUIRED');uuid(w.id);uuid(b.id);
 assert.equal(b.code,'BR-MAIN');assert.ok(b.name_ar?.trim());assert.equal(b.is_active,true);
 assert.equal(w.code,'WH-MAIN');assert.ok(w.name_ar?.trim());assert.equal(w.branch_id,b.id);assert.equal(w.is_active,true);
 return `INSERT INTO public.warehouses SELECT * FROM jsonb_populate_record(NULL::public.warehouses,${sqlLiteral(JSON.stringify(w))}::jsonb);`;
}
export async function resetWithExecutor({executor,root,reference,output,repair,clearHistory,emptyStorage,deleteOtherAuth,finalDryRun,ownerId,report={}}){
 const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,'TRIAL_RESET_SQL_FAILED');return r.stdout.trim();};
 const json=async input=>JSON.parse(await sql(input));
 const units=await resetUnits(root,reference);uuid(ownerId);
 Object.assign(report,{stage:'preflight',applied:[],recorded:[],destructiveStarted:false});
 const before=await json(schemaCatalogSql),startDay=await sql("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;");
 const dates=resetComparisonDates(reference.buildUtcDate,startDay);
 // Local rehearsal uses full literal comparison. Managed owner admission does
 // its normalized,strict-application check before calling this executor.
 assertManagedCatalog(reference.catalog,before,dates.admission);
 restoreResetAcl(before,before); // Unsupported grantors must fail BEFORE deleting files/data.
 const dependents=await json(externalDependentsSql);assertExternalDependents(dependents);report.externalDependents=dependents;
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
 report.stage='empty-storage-api';await emptyStorage();
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
 report.stage='restore-owner';await sql(restoreOwnerSql(owner));
 const afterPreserved=await json(preservedStateSql(ownerId));assert.deepEqual(afterPreserved,preserved,'PRESERVED_AUTH_VAULT_BUCKET_STATE_CHANGED');
 const counts=await readRowCounts(executor);report.afterCounts=counts;
 assertCleanCounts(counts,true,Boolean(owner.branch),Boolean(owner.warehouse));
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
 await finalDryRun();Object.assign(report,{ok:true,stage:'complete',preserved:true,catalogDifferences:0});return report;
}
