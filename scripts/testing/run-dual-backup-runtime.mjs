import {operationalSchema} from '../operations/operational-schema.mjs';
// Complete production archive+restore path, disposable literal214 database only.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SnapshotSession} from '../backup/snapshot-session.mjs';
import {createCompleteBackup,restoreCompleteBackup} from '../backup/complete-backup.mjs';
import {runOwnerMode,PREFIX} from '../operations/frankfurt-backup-runtime.mjs';
import {localR2Fixture} from './local-r2-fixture.mjs';
import {nativeBackupTlsProbe} from './native-backup-tls-probe.mjs';
import {proveComparisonRejectsSyntheticDifference} from './restore-comparison-negative.mjs';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..'),project='nawasrah-dual-backup-test',container='supabase_db_'+project;
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-dual-backup-proof-'));let local,report={ok:false,hostedConnectionsMade:false};
try{
  const boot=await exec(process.execPath,['scripts/testing/bootstrap-isolated-supabase.mjs'],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'214',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});local=JSON.parse(boot.stdout).isolatedProjectRoot;
  const args=['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-A','-t','-w','-v','ON_ERROR_STOP=1'];
  const s=new SnapshotSession('docker',args);
  try{
    await s.query('ALTER TABLE orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;');
    await s.query(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
    const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
    const auth=sql=>`BEGIN;SELECT set_config('request.jwt.claims','{"sub":"${id(1)}","role":"authenticated","aal":"aal2"}',true);SET LOCAL ROLE authenticated;${sql}COMMIT;`;
    await s.query(auth(`SELECT public.set_go_live_main_branch_v1('${id(200)}');SELECT public.open_cash_shift('${id(200)}',10000);`));
    await s.query(auth(`SELECT public.create_direct_supplier_receipt_v2(p_supplier_id:='${id(301)}',p_branch_id:='${id(200)}',p_warehouse_id:='${id(201)}',p_idempotency_key:='dual-backup-receiving-00001',p_payment_method:='deferred',p_lines:='[{"client_line_id":"${id(990)}","line_kind":"base_unit","commercial_quantity":20,"base_unit_name":"باكيت","gross_amount_in_minor_units":10000,"line_discount_in_minor_units":0,"components":[{"product_id":"${id(103)}","base_quantity":20}]}]'::jsonb);`));
    await s.query(auth(`SELECT public.create_pos_sale_v2('${id(201)}','${id(200)}',NULL,'زبون نقدي','cash','[{"commercial_line_kind":"base_unit","product_id":"${id(103)}","base_quantity":2,"price_authority":"server_catalog","line_discount_in_minor_units":0}]'::jsonb,0,2000,'dual-backup-sale-00001');`));
    await s.query("INSERT INTO storage.buckets(id,name,public) VALUES('product-images','product-images',true) ON CONFLICT(id) DO UPDATE SET public=true;INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('product-images','test/photo.png','{\"size\":8}'::jsonb);");
  }finally{await s.close();}
  const bytes=Buffer.from('image123');
  const source={session:()=>new SnapshotSession('docker',args),readObject:async name=>{assert.equal(name,'test/photo.png');return bytes;},
    roles:async destination=>{await exec('docker',['exec',container,'pg_dumpall','-U','supabase_admin','--roles-only','--no-role-passwords','--no-tablespaces','-f','/tmp/roles.sql'],{windowsHide:true});await exec('docker',['cp',container+':/tmp/roles.sql',destination],{windowsHide:true});},
    dump:async(snapshot,destination)=>{await exec('docker',['exec',container,'pg_dump','-U','postgres','-d','postgres','-Fc','--snapshot='+snapshot,'-f','/tmp/complete.dump'],{windowsHide:true,timeout:600_000});await exec('docker',['cp',container+':/tmp/complete.dump',destination],{windowsHide:true});}};
  const passphrase='local-disposable-backup-fixture-only';
  const backupRoot=path.join(output,'Frankfurt-kzevmysfydaslxcerogt');
  const backup=await createCompleteBackup({projectRef:'kzevmysfydaslxcerogt',outputRoot:backupRoot,passphrase,source});
  const restored=await restoreCompleteBackup({archivePath:backup.archivePath,passphrase,reportPath:path.join(output,'restore.json')});
  assert.equal(restored.ok,true);assert.equal(restored.storageObjectsCompared,1);assert.ok(restored.tablesCompared>50);
  const profile=JSON.parse(await readFile(path.join(root,'scripts/testing/fixtures/frankfurt214-restore-platform.json'),'utf8'));
  const adminArgs=[...args];adminArgs[adminArgs.indexOf('-U')+1]='supabase_admin';
  const managedSession=new SnapshotSession('docker',adminArgs);let managedPlatform;
  try{
    await managedSession.query("DO $roles$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_etl_admin') THEN CREATE ROLE supabase_etl_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOREPLICATION;END IF;END $roles$;ALTER ROLE supabase_etl_admin SET statement_timeout='1234ms';CREATE ROLE restore_comparison_role NOLOGIN NOSUPERUSER NOBYPASSRLS NOREPLICATION CONNECTION LIMIT 7;ALTER ROLE restore_comparison_role SET search_path=public;GRANT restore_comparison_role TO supabase_etl_admin WITH INHERIT FALSE,SET TRUE;ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO restore_comparison_role;CREATE SEQUENCE public.restore_comparison_unused START 19;CREATE SEQUENCE public.restore_comparison_called START 31;SELECT nextval('public.restore_comparison_called');");
    // Synthetic source ONLY:managed service post-init metadata differs from CLI.
    // PostgreSQL has no ALTER EXTENSION OWNER;this catalog alignment is confined
    // to this disposable test source. Production restore uses CREATE under the
    // captured owner,with no system-catalog UPDATE.
    await managedSession.query("UPDATE pg_extension SET extnamespace='public'::regnamespace WHERE extname='pg_net';UPDATE pg_extension SET extowner='postgres'::regrole WHERE extname IN('pg_stat_statements','pgcrypto','uuid-ossp');DO $fixture$ DECLARE r record;BEGIN FOR r IN SELECT p.oid::regprocedure AS identity FROM pg_proc p JOIN pg_depend d ON d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e' JOIN pg_extension e ON e.oid=d.refobjid WHERE e.extname IN('pg_stat_statements','pgcrypto','uuid-ossp') LOOP EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',r.identity);END LOOP;FOR r IN SELECT c.oid::regclass AS identity,c.relkind FROM pg_class c JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=c.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e' JOIN pg_extension e ON e.oid=d.refobjid WHERE e.extname IN('pg_stat_statements','pgcrypto','uuid-ossp') AND c.relkind IN('r','v','S') LOOP EXECUTE format('ALTER %s %s OWNER TO postgres',CASE r.relkind WHEN 'v' THEN 'VIEW' WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,r.identity);END LOOP;END $fixture$;");
    await managedSession.query('ALTER FUNCTION net.http_get(text,jsonb,jsonb,integer) SECURITY INVOKER;ALTER FUNCTION net.http_get(text,jsonb,jsonb,integer) RESET ALL;ALTER FUNCTION net.http_post(text,jsonb,jsonb,jsonb,integer) SECURITY INVOKER;ALTER FUNCTION net.http_post(text,jsonb,jsonb,jsonb,integer) RESET ALL;');
    managedPlatform=JSON.parse((await managedSession.query("SELECT jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname,'owner',pg_get_userbyid(e.extowner)) ORDER BY e.extname) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace;")).trim());
    assert.deepEqual(managedPlatform,profile.extensions,'SYNTHETIC_SOURCE_EXTENSIONS_MUST_MATCH_SAVED_FRANKFURT214');
  }finally{await managedSession.close();}
  const managedRoot=path.join(output,'managed-profile','Frankfurt-kzevmysfydaslxcerogt');
  const managedBackup=await createCompleteBackup({projectRef:'kzevmysfydaslxcerogt',outputRoot:managedRoot,passphrase,source});
  const managedRestore=await restoreCompleteBackup({archivePath:managedBackup.archivePath,passphrase,reportPath:path.join(output,'managed-restore.json')});
  assert.equal(managedRestore.ok,true);assert.equal(managedRestore.catalogAclOwnerSettingsMatch,true);assert.equal(managedRestore.allRowsAndHashesMatch,true);
  // A second restore of THE SAME archive proves no new Backup is needed.
  const managedReplay=await restoreCompleteBackup({archivePath:managedBackup.archivePath,passphrase,reportPath:path.join(output,'managed-restore-replay.json')});assert.equal(managedReplay.ok,true);
  const comparisonNegative=await proveComparisonRejectsSyntheticDifference({archivePath:managedBackup.archivePath,passphrase,output});
  if(process.platform!=='win32')for(const proof of [restored,managedRestore,managedReplay])assert.equal(proof.logs.saved,true,'PRIVATE_SANITIZED_LOG_PERSISTENCE_REQUIRED_ON_CI');
  const fixture=localR2Fixture(),config={formatVersion:1,projectRef:'kzevmysfydaslxcerogt',connection:'postgresql://postgres@db.kzevmysfydaslxcerogt.supabase.co/postgres',protectionScope:'LocalMachine',businessAlertsEnabled:false,backupRoot,stateRoot:path.join(output,'state'),retentionCount:30};
  const ownerMode=mode=>{assert.ok(['Upload','VerifyRemote','RestoreRemote'].includes(mode),'LOCAL_R2_MODES_ONLY_NO_NATIVE_DATABASE');return runOwnerMode({mode,config,force:true,env:{NAWASRAH_FF_PASSPHRASE:passphrase},dependencies:{r2Client:fixture.client}});};
  await ownerMode('Upload');const count=fixture.objects.size;await ownerMode('Upload');assert.equal(fixture.objects.size,count,'IMMUTABLE_REPLAY_MUST_NOT_DUPLICATE');
  await ownerMode('VerifyRemote');
  const key=[...fixture.objects.keys()].find(k=>k.includes('/daily/')&&k.endsWith('.nwb')),original=fixture.objects.get(key).bytes;
  fixture.objects.get(key).bytes=Buffer.from(original);fixture.objects.get(key).bytes[original.length-1]^=1;
  await assert.rejects(ownerMode('VerifyRemote'),'CORRUPTED_REMOTE_ARCHIVE_MUST_FAIL');fixture.objects.get(key).bytes=original;
  await ownerMode('RestoreRemote');
  assert.ok([...fixture.objects.keys()].every(k=>k.startsWith(PREFIX)),'LEGACY_PREFIX_MUST_NOT_CHANGE');
  assert.ok(fixture.calls.every(c=>!c.name.startsWith('Delete')));
  const nativeTls=await nativeBackupTlsProbe({container,output});
  // Upgrade THIS disposable source only. Preserve and restore the same214 v2
  // archive again AFTER215 support,then create a new215 archive with real new
  // immutable aftercare evidence,not merely empty215 tables.
  const update=new SnapshotSession('docker',args);let inspected215;
  try{
    await update.query(await readFile(path.join(root,'supabase/migrations/215_inspected_aftercare_and_supplier_credit.sql'),'utf8'));
    await update.query("INSERT INTO supabase_migrations.schema_migrations(version)VALUES('215');");
    const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
    const auth=sql=>`BEGIN;SELECT set_config('request.jwt.claims','{"sub":"${id(1)}","role":"authenticated","aal":"aal2"}',true);SET LOCAL ROLE authenticated;${sql}COMMIT;`;
    const pid=id(991),line=[{commercial_line_kind:'legacy_single_sku_parcel',product_id:pid,parcel_quantity:1,units_per_parcel:12,price_authority:'server_catalog',line_discount_in_minor_units:0}];
    await update.query(`INSERT INTO products(id,sku,name_ar,category_id,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,sale_price_in_minor_units,default_sale_price_in_minor_units,cost_price_in_minor_units,wac_cost_in_minor_units_exact,is_active,is_flavor_master)SELECT '${pid}','RESTORE215-PARCEL','طرد اختبار استرجاع215',category_id,unit_id,purchase_unit_id,sale_unit_id,12,12,1000,9000,0,0,true,false FROM products WHERE id='${id(103)}';`);
    const purchase=[{client_line_id:id(992),line_kind:'base_unit',commercial_quantity:112,base_unit_name:'باكيت',gross_amount_in_minor_units:56000,line_discount_in_minor_units:0,components:[{product_id:pid,base_quantity:112}]}];
    await update.query(auth(`SELECT create_direct_supplier_receipt_v2(p_supplier_id:='${id(301)}',p_branch_id:='${id(200)}',p_warehouse_id:='${id(201)}',p_idempotency_key:='complete-backup215-receipt',p_payment_method:='deferred',p_lines:='${JSON.stringify(purchase)}'::jsonb);`));
    const sale=JSON.parse((await update.query(auth(`SELECT create_pos_sale_v2('${id(201)}','${id(200)}',NULL,'زبون نقدي','cash','${JSON.stringify(line)}'::jsonb,0,9000,'complete-backup215-sale');`))).trim().split('\n').at(-1));
    const item=(await update.query(`SELECT id FROM order_items WHERE order_id='${sale.orderId}';`)).trim();
    const payload={orderId:sale.orderId,items:[{sourceKind:'base_order_item',sourceId:item,quantity:12,goodQuantity:11,supplierId:null}],reason:'فحص استبدال داخل النسخة المحلية',notes:null};
    const preview=JSON.parse((await update.query(auth(`SELECT preview_inspected_sales_replacement_v2('${JSON.stringify(payload)}'::jsonb);`))).trim().split('\n').at(-1));
    inspected215=JSON.parse((await update.query(auth(`SELECT settle_inspected_sales_replacement_v2('${JSON.stringify(payload)}'::jsonb,'complete-backup215-inspected','${preview.previewFingerprint}');`))).trim().split('\n').at(-1));
    assert.equal(inspected215.success,true);assert.equal(inspected215.restockedQuantity,11);
  }finally{await update.close();}
  const old214AfterUpdate=await restoreCompleteBackup({archivePath:managedBackup.archivePath,passphrase,reportPath:path.join(output,'old214-after215-support.json')});assert.equal(old214AfterUpdate.ok,true);assert.equal(old214AfterUpdate.historyCeiling,214);
  const backup215=await createCompleteBackup({projectRef:'kzevmysfydaslxcerogt',outputRoot:backupRoot,passphrase,source});assert.equal(backup215.historyCeiling,215);assert.equal(backup215.historyFiles,177);assert.equal(backup215.formatVersion,2);
  const restore215=await restoreCompleteBackup({archivePath:backup215.archivePath,passphrase,reportPath:path.join(output,'restore215.json')});assert.equal(restore215.ok,true);assert.equal(restore215.historyCeiling,215);assert.equal(restore215.historyFiles,177);assert.equal(restore215.catalogAclOwnerSettingsMatch,true);assert.equal(restore215.allRowsAndHashesMatch,true);assert.deepEqual(restore215.exceptionsApplied,[]);
  await ownerMode('Upload');await ownerMode('VerifyRemote');await ownerMode('RestoreRemote');
  const remote215=JSON.parse(await readFile(path.join(config.stateRoot,'restore-remote.json'),'utf8'));assert.equal(remote215.historyCeiling,215);assert.equal(remote215.ok,true);
  // Keep both earlier v2 archives.216 must prove a NONEMPTY initial-payment
  // envelope through the same encrypted/strict restore and local R2 paths.
  const next=new SnapshotSession('docker',args);let paid216;
  try{
    await next.query(await readFile(path.join(root,'supabase/migrations/216_pos_partial_payments.sql'),'utf8'));
    await next.query("INSERT INTO supabase_migrations.schema_migrations(version)VALUES('216');");
    const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
    const auth=sql=>`BEGIN;SELECT set_config('request.jwt.claims','{"sub":"${id(1)}","role":"authenticated","aal":"aal2"}',true);SET LOCAL ROLE authenticated;${sql}COMMIT;`;
    const line=[{commercial_line_kind:'base_unit',product_id:id(103),base_quantity:2,price_authority:'server_catalog',line_discount_in_minor_units:0}];
    paid216=JSON.parse((await next.query(auth(`SELECT create_pos_sale_with_initial_payment_v1('${id(201)}','${id(200)}','${id(401)}','اختبار النسخة216','${JSON.stringify(line)}'::jsonb,0,1000,'cash',NULL,'complete-backup216-partial');`))).trim().split('\n').at(-1));
    assert.equal(paid216.totalInMinorUnits,2000);assert.equal(paid216.amountPaidInMinorUnits,1000);assert.equal(paid216.remainingInMinorUnits,1000);
  }finally{await next.close();}
  const old215AfterUpdate=await restoreCompleteBackup({archivePath:backup215.archivePath,passphrase,reportPath:path.join(output,'old215-after216-support.json')});assert.equal(old215AfterUpdate.ok,true);assert.equal(old215AfterUpdate.historyCeiling,215);
  const backup216=await createCompleteBackup({projectRef:'kzevmysfydaslxcerogt',outputRoot:backupRoot,passphrase,source});assert.equal(backup216.historyCeiling,216);assert.equal(backup216.historyFiles,178);assert.equal(backup216.formatVersion,2);
  const restore216=await restoreCompleteBackup({archivePath:backup216.archivePath,passphrase,reportPath:path.join(output,'restore216.json')});assert.equal(restore216.ok,true);assert.equal(restore216.historyCeiling,216);assert.equal(restore216.historyFiles,178);assert.equal(restore216.catalogAclOwnerSettingsMatch,true);assert.equal(restore216.allRowsAndHashesMatch,true);assert.deepEqual(restore216.exceptionsApplied,[]);
  await ownerMode('Upload');await ownerMode('VerifyRemote');await ownerMode('RestoreRemote');
  const remote216=JSON.parse(await readFile(path.join(config.stateRoot,'restore-remote.json'),'utf8'));assert.equal(remote216.historyCeiling,216);assert.equal(remote216.ok,true);
  // ALL native database,keepalive and Telegram dependencies are local/injected.
  // Never call the fixture's R2-only helper with Watchdog and a hosted URL.
  let keepaliveCalls=0,telegramCalls=0;
  const watchdog216=await runOwnerMode({mode:'Watchdog',config:{...config,publishableKey:'local-fixture-only'},env:{},dependencies:{source,
    send:async()=>{telegramCalls++;return true;},fetchImpl:async(endpoint,request)=>{
      assert.equal(new URL(endpoint).pathname,'/rest/v1/rpc/get_public_storefront_settings');assert.equal(request.method,'POST');keepaliveCalls++;
      const db=new SnapshotSession('docker',args);try{const data=JSON.parse((await db.query('BEGIN READ ONLY;SET LOCAL ROLE anon;SELECT public.get_public_storefront_settings();ROLLBACK;')).trim().split('\n').at(-1));return new Response(JSON.stringify(data),{status:200});}finally{await db.close();}
    }}});
  assert.equal(watchdog216.ok,true);assert.equal(watchdog216.healthy,true);assert.equal(watchdog216.supportedSchemaCeiling,operationalSchema.ceiling);assert.equal(watchdog216.observedHistoryCeiling,216);assert.equal(watchdog216.internalScanHeld,true);assert.equal(watchdog216.businessAlertsEnabled,false);assert.equal(keepaliveCalls,1);assert.equal(telegramCalls,0);
  const newest=new SnapshotSession('docker',args);
  try{await newest.query(await readFile(path.join(root,'supabase/migrations/217_owner_telegram_dispatch.sql'),'utf8'));await newest.query("INSERT INTO supabase_migrations.schema_migrations(version)VALUES('217');");}finally{await newest.close();}
  const old216AfterUpdate=await restoreCompleteBackup({archivePath:backup216.archivePath,passphrase,reportPath:path.join(output,'old216-after217-support.json')});assert.equal(old216AfterUpdate.ok,true);assert.equal(old216AfterUpdate.historyCeiling,216);
  const backup217=await createCompleteBackup({projectRef:'kzevmysfydaslxcerogt',outputRoot:backupRoot,passphrase,source});assert.equal(backup217.historyCeiling,217);assert.equal(backup217.historyFiles,179);assert.equal(backup217.formatVersion,2);
  const restore217=await restoreCompleteBackup({archivePath:backup217.archivePath,passphrase,reportPath:path.join(output,'restore217.json')});assert.equal(restore217.ok,true);assert.equal(restore217.historyCeiling,217);assert.equal(restore217.historyFiles,179);assert.equal(restore217.catalogAclOwnerSettingsMatch,true);assert.equal(restore217.allRowsAndHashesMatch,true);assert.deepEqual(restore217.exceptionsApplied,[]);
  await ownerMode('Upload');await ownerMode('VerifyRemote');await ownerMode('RestoreRemote');const remote217=JSON.parse(await readFile(path.join(config.stateRoot,'restore-remote.json'),'utf8'));assert.equal(remote217.historyCeiling,217);assert.equal(remote217.ok,true);
  report={...restored,ok:true,current217:{backup:backup217,restore:restore217,remoteRestore:remote217,old216ArchiveStillRestores:true},current216:{backup:backup216,restore:restore216,remoteRestore:remote216,watchdog:watchdog216,keepaliveTransport:'injected local SQL;no network',telegramCalls,initialPayment:paid216,old215ArchiveStillRestores:true},current215:{backup:backup215,restore:restore215,remoteRestore:remote215,inspectedOperation:inspected215,old214ArchiveStillRestores:true},nativeTls,comparisonNegative,syntheticExtraRoleConfigMembershipDefaultsAndCalledUncalledSequences:true,managedProfile:{sourceSha256:profile.sourceSha256,extensions:managedPlatform,restore:managedRestore,replaySameArchive:true},fixtureOnly:true,archiveEncrypted:true,storageBytesRestored:true,r2Transport:'local-in-memory-S3',remoteDownloadRestorePassed:true,immutableReplayPassed:true,tamperedDownloadRejected:true,legacyOffsiteUntouched:true,nonzeroFinancialFixture:{receivedQuantity:20,soldQuantity:2,remainingQuantity:18,supplierDebt:10000,salesCash:2000,openingCash:10000}};
}catch(error){report.error=error.message;report.cause=error.cause?.message;process.exitCode=1;console.error(error);}
finally{
  if(local)await exec(process.execPath,['node_modules/supabase/dist/supabase.js','stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true});
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({ok:report.ok,output,...report}));
  // Local fixture archive only; never preserve an unencrypted extraction.
  for(const name of ['last-backup-status.json'])await rm(path.join(output,name),{force:true});
}
