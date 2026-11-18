// Actual retained RESET224 and resume, dedicated DB-only fixture. No owner
// account/server/files are used. Auth/MFA rows here are disposable test rows;
// actual GoTrue/TOTP transport remains covered by the unchanged220 gate.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,mkdtemp,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {operationalManifest,operationalSchema} from '../operations/operational-schema.mjs';
import {withLegacy224OwnerTools,legacy224HeldDdlFixture} from './legacy224-owner-tools.mjs';
import {startInventory224Local} from './inventory224-local.mjs';
import {proveReset224DdlCapability} from './reset224-ddl-capability-proof.mjs';
import {persistentLocalExecutor} from './reset214-persistent-local.mjs';
import {executeResetInput} from '../operations/reset214-io.mjs';
import {readReady224Reference} from '../operations/frankfurt-reference224.mjs';
import {hold217Notifications} from '../operations/owner-telegram217-notifications.mjs';
import {readNotificationSnapshot} from '../operations/frankfurt-notification-hold.mjs';
import {captureReset224,reset224WithExecutor,reset214RetentionRawSql} from '../operations/trial-reset224-core.mjs';
import {prepareResetSession,startResetAttempt,validateResetResume,finishResetSession} from '../operations/reset224-session.mjs';
import {assertNoForeignWrites,publicFingerprint} from '../operations/reset224-write-guard.mjs';
import {sha256} from './maintenance-db-contract.mjs';
import {schemaCatalogSql} from './schema-catalog.mjs';
import {frankfurt220TriggerAclFixtureSql,frankfurt220TriggerAclReadSql} from './frankfurt220-trigger-acl-fixture.mjs';
import {frozen220TriggerAclProfile} from '../operations/frozen220-trigger-acl.mjs';
import {functionReference224} from '../operations/function-reference224.mjs';
import {pgNetIdentitySql,provePgNetRunnable219} from './reset219-dependency-probe.mjs';
import {readVerificationSourceFreeze,assertVerificationSourceFreeze} from './verification-source-freeze.mjs';
const root=path.resolve(import.meta.dirname,'../..');
assert.equal(process.argv.length,3,'LOCAL224_REFERENCE_REQUIRED');
if(operationalSchema.ceiling===225){
 // RESET224 verifies its own complete 688-function document. Run the exact
 // 224 guard at its last shipped source. The only fixture adjustment holds
 // monitoring before the DDL fingerprint probe; all assertions stay literal.
 await operationalManifest();
 const frozen=await readVerificationSourceFreeze(root);
 await withLegacy224OwnerTools(root,async checkout=>{
  const runner=path.join(checkout,'scripts/testing/run-reset224-runtime.mjs');
  await writeFile(runner,legacy224HeldDdlFixture(await readFile(runner,'utf8')));
  const evidence='test-results/reset224/report.json';
  const exec=promisify(execFile);
  const result=await exec(process.execPath,['scripts/testing/run-reset224-runtime.mjs',path.resolve(process.argv[2])],
   {cwd:checkout,windowsHide:true,maxBuffer:16*1024**2}).catch(error=>error);
  process.stdout.write(result.stdout??'');
  process.stderr.write(result.stderr??'');
  await mkdir(path.join(root,path.dirname(evidence)),{recursive:true});
  const copyFailure=await copyFile(path.join(checkout,evidence),path.join(root,evidence)).then(()=>null,error=>error);
  if(result instanceof Error)throw Error('HISTORICAL_RESET224_RUNTIME_FAILED',{cause:result});
  if(copyFailure)throw Error('HISTORICAL_RESET224_EVIDENCE_MISSING',{cause:copyFailure});
 });
 assertVerificationSourceFreeze(frozen,await readVerificationSourceFreeze(root));
 process.exit(0);
}
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-reset224-proof-'));
const report={ok:false,hostedAccess:false,ownerDemoAccess:false,output,cases:[],timings:{}};let local,executor;
const save=(name,value)=>writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const id=n=>'92600000-0000-4000-8000-'+String(n).padStart(12,'0'),q=s=>"'"+String(s).replaceAll("'","''")+"'";
try{
 const frozen=await readVerificationSourceFreeze(root),reference=await readReady224Reference(root,process.argv[2]);
 local=await startInventory224Local(224,'reset');executor=persistentLocalExecutor(local.executor);
 report.ddlCapability=await proveReset224DdlCapability(local,output);
 const sql=async(text,ex=executor)=>{const r=await executeResetInput(ex,text);assert.equal(r.code,0,r.stderr);return r.stdout.trim();},json=async text=>JSON.parse(await sql(text));
 await hold217Notifications(executor,await readNotificationSnapshot(executor));
 const fixture=await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8');
 const unschedule="SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='run-advanced-monitoring';";assert.equal(fixture.split(unschedule).length,2);
 await sql(fixture.replace(unschedule,'-- Keep the six existing held job identities.'));
 const verifyFunctions=before=>functionReference224(local.executor,reference,before);
 const canonicalCatalog=await json(schemaCatalogSql);
 assert.equal(frozen220TriggerAclProfile(canonicalCatalog.functions),'local');
 assert.equal(await verifyFunctions(canonicalCatalog),688);
 report.cases.push('final function check accepts the original NULL profile');
 const unapproved='public.lite3_counter_context223(uuid)';
 const anonGrant="SELECT has_function_privilege('anon',"+q(unapproved)+",'EXECUTE');";
 assert.equal(await sql(anonGrant),'f');
 try{
  await sql('GRANT EXECUTE ON FUNCTION '+unapproved+' TO anon;');
  assert.equal(await sql(anonGrant),'t');
  const unapprovedCatalog=await json(schemaCatalogSql);
  await assert.rejects(()=>verifyFunctions(unapprovedCatalog),
   /RESET224_FINAL_FUNCTION_ACL_UNAPPROVED:lite3_counter_context223\(p_product_id uuid\)/);
 }finally{await sql('REVOKE EXECUTE ON FUNCTION '+unapproved+' FROM anon;');}
 assert.equal(await sql(anonGrant),'f');
 report.cases.push('final function check refuses an unapproved ACL identical to the saved snapshot');
 await sql(frankfurt220TriggerAclFixtureSql.split('\n')[0]);
 const mixedCatalog=await json(schemaCatalogSql);
 await assert.rejects(()=>verifyFunctions(mixedCatalog),/FROZEN220_TRIGGER_ACL_PROFILE_MISMATCH/);
 report.cases.push('final function check refuses a partial Frankfurt profile');
 await sql(frankfurt220TriggerAclFixtureSql);
 await assert.rejects(()=>verifyFunctions(canonicalCatalog),/RESET224_FINAL_FUNCTION_ACL_CHANGED/);
 report.cases.push('final function check refuses newly explicit ACL even with unchanged effective EXECUTE');
 const explicitCatalog=await json(schemaCatalogSql);
 assert.equal(frozen220TriggerAclProfile(explicitCatalog.functions),'frankfurt');
 assert.equal(await verifyFunctions(explicitCatalog),688);
 const signature='public.enforce_customer_for_debt_order()';
 try{
  await sql('GRANT EXECUTE ON FUNCTION '+signature+' TO anon;');
  await assert.rejects(()=>verifyFunctions(explicitCatalog),/RESET224_FINAL_FUNCTION_ACL_CHANGED:enforce_customer_for_debt_order/);
 }finally{await sql('REVOKE EXECUTE ON FUNCTION '+signature+' FROM anon;');}
 report.cases.push('final function check refuses a change to a preserved explicit ACL');
 const definition=await sql('SELECT pg_get_functiondef('+q(signature)+'::regprocedure);');
 const changed=definition.replace('AS $function$',()=> 'AS $function$ -- reset224 disposable definition drift');
 assert.notEqual(changed,definition);
 const explicitAcls=await json(frankfurt220TriggerAclReadSql);
 try{
  await sql(changed+';');
  assert.deepEqual(await json(frankfurt220TriggerAclReadSql),explicitAcls);
  await assert.rejects(()=>verifyFunctions(explicitCatalog),/CURRENT224_FUNCTION_REFERENCE_CHANGED/);
 }finally{await sql(definition+';');}
 assert.equal(await verifyFunctions(explicitCatalog),688);
 report.cases.push('final function check refuses definition drift with the saved ACL unchanged');
 const ownerId=id(1);
 await sql(`UPDATE public.branches SET code='BR-MAIN' WHERE id=${q(id(200))};UPDATE public.warehouses SET code='WH-MAIN' WHERE id=${q(id(201))};UPDATE public.profiles SET branch_id=${q(id(200))} WHERE id=${q(ownerId)};
 INSERT INTO auth.mfa_factors(id,user_id,status,factor_type,secret,friendly_name,created_at,updated_at)VALUES(${q(id(500))},${q(ownerId)},'verified','totp','local-fixture-only','Disposable224 proof',now(),now());
 INSERT INTO auth.users(id,aud,role,email)VALUES(${q(id(2))},'authenticated','authenticated','deleted-reset224@example.test');
 UPDATE public.storefront_settings SET orders_enabled=false,minimum_order_in_minor_units=9007199254740993,updated_by=${q(ownerId)};`);
 assert.equal(await sql('SELECT full_accounting FROM sales_lite1.mode;'),'t');
 const retained=await sql(reset214RetentionRawSql(ownerId)),platform=await sql("SELECT jsonb_build_object('auth',to_jsonb(u),'mfa',(SELECT jsonb_agg(to_jsonb(m)ORDER BY id)FROM auth.mfa_factors m WHERE user_id=u.id)) FROM auth.users u WHERE id="+q(ownerId)+';');
 const pgNetBefore=await json(pgNetIdentitySql),base={workdir:output,ownerId,projectRef:'kzevmysfydaslxcerogt',referenceSha256:sha256(await readFile(process.argv[2])),reference};
 const at=async name=>{const p=path.join(output,name);await mkdir(p);return p;};
 // Preserve the RED result as a negative gate: the official hold leaves only
 // gateway cleanup active. An all-six-disabled fixture must fail before delete.
 const officialHold=await readNotificationSnapshot(executor);
 await sql("SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='cleanup-guest-order-gateway-requests';");
 const badHoldRows=await publicFingerprint(executor),badHoldReport={};
 await mkdir(path.join(output,'wrong-hold'));
 await assert.rejects(()=>reset224WithExecutor({executor,root,reference,ownerId,output:path.join(output,'wrong-hold'),report:badHoldReport}),/RESET217_DISPATCH_MUST_REMAIN_HELD/);
 assert.equal(badHoldReport.destructiveStarted,false);assert.deepEqual(await publicFingerprint(executor),badHoldRows);
 await sql("SELECT cron.alter_job(jobid,active:=true) FROM cron.job WHERE jobname='cleanup-guest-order-gateway-requests';");
 assert.deepEqual(await readNotificationSnapshot(executor),officialHold);report.cases.push('wrong cron hold refuses before deletion;official217 hold restored');
 const run=async(session,boundary)=>{
  const begin=performance.now(),progress=await startResetAttempt(session,executor),writer=session.executor;
  await reset224WithExecutor({executor:writer,root,reference,output:session.output,ownerId,session,report:progress,
   emptyStorage:async()=>assert.equal(await sql('SELECT count(*) FROM storage.objects;'),'0'),
   deleteOtherAuth:async owner=>sql('DELETE FROM auth.users WHERE id<>'+q(owner)+'::uuid;',writer),
   clearHistory:()=>sql('DELETE FROM supabase_migrations.schema_migrations;DELETE FROM supabase_migrations.seed_files;',writer),
   repair:version=>sql('INSERT INTO supabase_migrations.schema_migrations(version)VALUES('+q(version)+');',writer),
   finalDryRun:async()=>assert.deepEqual(await json('SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations;'),reference.appliedVersions),
   boundary:async name=>{if(name===boundary)throw Error('RESET224_TEST_INTERRUPTION');}});
  assert.equal(progress.complete,true);assert.equal(progress.catalogDifferences,0);assert.equal(progress.applicationAclDifferences,0);assert.equal(progress.applied.length,184);assert.equal(progress.recorded.length,184);
  assert.equal(await sql(reset214RetentionRawSql(ownerId)),retained);assert.equal(await sql('SELECT minimum_order_in_minor_units::text FROM public.storefront_settings;'),'9007199254740993');
  assert.equal(await sql("SELECT jsonb_build_object('auth',to_jsonb(u),'mfa',(SELECT jsonb_agg(to_jsonb(m)ORDER BY id)FROM auth.mfa_factors m WHERE user_id=u.id)) FROM auth.users u WHERE id="+q(ownerId)+';'),platform);
  assert.equal(await sql('SELECT count(*) FROM public.products;'),'0');assert.equal(await sql('SELECT count(*) FROM auth.users;'),'1');assert.equal(await sql('SELECT full_accounting FROM sales_lite1.mode;'),'t');
  assert.equal(frozen220TriggerAclProfile(await json(frankfurt220TriggerAclReadSql)),'frankfurt');assert.deepEqual(await json(pgNetIdentitySql),pgNetBefore);await provePgNetRunnable219(executor);
  for(const table of ['quantity_counters','quantity_events','quantity_requests'])assert.equal(await sql('SELECT count(*) FROM sales_lite3.'+table+';'),'0');
  assert.equal(await verifyFunctions(session.saved.catalog),688);
  await finishResetSession(session);return Math.round(performance.now()-begin);
 };
 const initial=await captureReset224({executor,ownerId,reference});
 const denied=await prepareResetSession({...base,output:await at('write-failure'),state:initial}),before=await publicFingerprint(executor);denied.file=path.dirname(denied.file);
 await assert.rejects(()=>startResetAttempt(denied,executor));assert.deepEqual(await publicFingerprint(executor),before);report.cases.push('snapshot failure writes nothing');
 const ordinary=await prepareResetSession({...base,output:await at('ordinary'),state:initial});report.timings.ordinaryMs=await run(ordinary);const target=await json(schemaCatalogSql);
 for(const boundary of ['after-drop-public','migration-224','before-restore-owner-and-settings']){
  await sql("INSERT INTO public.products(sku,name_ar)VALUES("+q('TRIAL224-'+boundary)+",'Disposable224 trial');");
  const state=await captureReset224({executor,ownerId,reference}),interrupted=await prepareResetSession({...base,output:await at('interrupted-'+boundary),state});
  await assert.rejects(()=>run(interrupted,boundary),/RESET224_TEST_INTERRUPTION/);
  const resumed=await prepareResetSession({...base,output:await at('resumed-'+boundary),resume:true});await validateResetResume(resumed,executor);
  report.timings[boundary+'ResumeMs']=await run(resumed);assert.deepEqual(await json(schemaCatalogSql),target);report.cases.push('resume '+boundary+' exact catalog/Auth/MFA/raw money/history');
 }
 // The existing private write witness must still detect a foreign commit.
 const dirty=await prepareResetSession({...base,output:await at('foreign-write'),state:await captureReset224({executor,ownerId,reference})});await startResetAttempt(dirty,executor);
 await sql(`INSERT INTO sales_lite3.quantity_requests(key,actor_id,fingerprint,result)
 VALUES('${id(900)}','${ownerId}',repeat('a',64),'{}');`);
 await assert.rejects(()=>assertNoForeignWrites(executor,dirty.saved),/RESET214_REAL_WRITES_DETECTED/);
 const refused=await prepareResetSession({...base,output:await at('foreign-resume'),resume:true});await assert.rejects(()=>validateResetResume(refused,executor),/RESET214_REAL_WRITES_DETECTED/);report.cases.push('committed optional counter private write refuses resume');
 assertVerificationSourceFreeze(frozen,await readVerificationSourceFreeze(root));Object.assign(report,{ok:true,files:184,rawMfaAndOwnerUnchanged:true,rawLargeMoneyPreserved:true,frankfurtFourAclPreserved:true,pgNetUnchanged:true});
}catch(error){report.error=String(error.stack).slice(0,5000);report.cause=error.cause?.message;process.exitCode=1;}
finally{executor?.closeLocal();if(local)await local.stop();await save('report.json',report);await mkdir(path.join(root,'test-results/reset224'),{recursive:true});await writeFile(path.join(root,'test-results/reset224/report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
