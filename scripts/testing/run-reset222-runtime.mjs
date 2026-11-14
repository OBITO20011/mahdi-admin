// Actual retained RESET222 and resume, dedicated DB-only fixture. No owner
// account/server/files are used. Auth/MFA rows here are disposable test rows;
// actual GoTrue/TOTP transport remains covered by the unchanged220 gate.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startPrices222Local} from './independent-prices222-local.mjs';
import {persistentLocalExecutor} from './reset214-persistent-local.mjs';
import {executeResetInput} from '../operations/reset214-io.mjs';
import {readReady222Reference} from '../operations/frankfurt-reference222.mjs';
import {hold217Notifications} from '../operations/owner-telegram217-notifications.mjs';
import {readNotificationSnapshot} from '../operations/frankfurt-notification-hold.mjs';
import {captureReset222,reset222WithExecutor,reset214RetentionRawSql} from '../operations/trial-reset222-core.mjs';
import {prepareResetSession,startResetAttempt,validateResetResume,finishResetSession} from '../operations/reset222-session.mjs';
import {assertNoForeignWrites,publicFingerprint} from '../operations/reset222-write-guard.mjs';
import {sha256} from './maintenance-db-contract.mjs';
import {schemaCatalogSql} from './schema-catalog.mjs';
import {frankfurt220TriggerAclFixtureSql,frankfurt220TriggerAclReadSql} from './frankfurt220-trigger-acl-fixture.mjs';
import {frozen220TriggerAclProfile} from '../operations/frozen220-trigger-acl.mjs';
import {pgNetIdentitySql,provePgNetRunnable219} from './reset219-dependency-probe.mjs';
import {readVerificationSourceFreeze,assertVerificationSourceFreeze} from './verification-source-freeze.mjs';
const root=path.resolve(import.meta.dirname,'../..'),output=await mkdtemp(path.join(tmpdir(),'nawasrah-reset222-proof-'));
assert.equal(process.argv.length,3,'LOCAL222_REFERENCE_REQUIRED');
const report={ok:false,hostedAccess:false,ownerDemoAccess:false,output,cases:[],timings:{}};let local,executor;
const save=(name,value)=>writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const id=n=>'92600000-0000-4000-8000-'+String(n).padStart(12,'0'),q=s=>"'"+String(s).replaceAll("'","''")+"'";
try{
 const frozen=await readVerificationSourceFreeze(root),reference=await readReady222Reference(root,process.argv[2]);
 local=await startPrices222Local(222,'reset');executor=persistentLocalExecutor(local.executor);
 const sql=async(text,ex=executor)=>{const r=await executeResetInput(ex,text);assert.equal(r.code,0,r.stderr);return r.stdout.trim();},json=async text=>JSON.parse(await sql(text));
 await hold217Notifications(executor,await readNotificationSnapshot(executor));
 const fixture=await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8');
 const unschedule="SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='run-advanced-monitoring';";assert.equal(fixture.split(unschedule).length,2);
 await sql(fixture.replace(unschedule,'-- Keep the six existing held job identities.'));
 await sql(frankfurt220TriggerAclFixtureSql);
 const ownerId=id(1);
 await sql(`UPDATE public.branches SET code='BR-MAIN' WHERE id=${q(id(200))};UPDATE public.warehouses SET code='WH-MAIN' WHERE id=${q(id(201))};UPDATE public.profiles SET branch_id=${q(id(200))} WHERE id=${q(ownerId)};
 INSERT INTO auth.mfa_factors(id,user_id,status,factor_type,secret,friendly_name,created_at,updated_at)VALUES(${q(id(500))},${q(ownerId)},'verified','totp','local-fixture-only','Disposable222 proof',now(),now());
 INSERT INTO auth.users(id,aud,role,email)VALUES(${q(id(2))},'authenticated','authenticated','deleted-reset222@example.test');
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
 await assert.rejects(()=>reset222WithExecutor({executor,root,reference,ownerId,output:path.join(output,'wrong-hold'),report:badHoldReport}),/RESET217_DISPATCH_MUST_REMAIN_HELD/);
 assert.equal(badHoldReport.destructiveStarted,false);assert.deepEqual(await publicFingerprint(executor),badHoldRows);
 await sql("SELECT cron.alter_job(jobid,active:=true) FROM cron.job WHERE jobname='cleanup-guest-order-gateway-requests';");
 assert.deepEqual(await readNotificationSnapshot(executor),officialHold);report.cases.push('wrong cron hold refuses before deletion;official217 hold restored');
 const run=async(session,boundary)=>{
  const begin=performance.now(),progress=await startResetAttempt(session,executor),writer=session.executor;
  await reset222WithExecutor({executor:writer,root,reference,output:session.output,ownerId,session,report:progress,
   emptyStorage:async()=>assert.equal(await sql('SELECT count(*) FROM storage.objects;'),'0'),
   deleteOtherAuth:async owner=>sql('DELETE FROM auth.users WHERE id<>'+q(owner)+'::uuid;',writer),
   clearHistory:()=>sql('DELETE FROM supabase_migrations.schema_migrations;DELETE FROM supabase_migrations.seed_files;',writer),
   repair:version=>sql('INSERT INTO supabase_migrations.schema_migrations(version)VALUES('+q(version)+');',writer),
   finalDryRun:async()=>assert.deepEqual(await json('SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations;'),reference.appliedVersions),
   boundary:async name=>{if(name===boundary)throw Error('RESET222_TEST_INTERRUPTION');}});
  assert.equal(progress.complete,true);assert.equal(progress.catalogDifferences,0);assert.equal(progress.applicationAclDifferences,0);assert.equal(progress.applied.length,182);assert.equal(progress.recorded.length,182);
  assert.equal(await sql(reset214RetentionRawSql(ownerId)),retained);assert.equal(await sql('SELECT minimum_order_in_minor_units::text FROM public.storefront_settings;'),'9007199254740993');
  assert.equal(await sql("SELECT jsonb_build_object('auth',to_jsonb(u),'mfa',(SELECT jsonb_agg(to_jsonb(m)ORDER BY id)FROM auth.mfa_factors m WHERE user_id=u.id)) FROM auth.users u WHERE id="+q(ownerId)+';'),platform);
  assert.equal(await sql('SELECT count(*) FROM public.products;'),'0');assert.equal(await sql('SELECT count(*) FROM auth.users;'),'1');assert.equal(await sql('SELECT full_accounting FROM sales_lite1.mode;'),'t');
  assert.equal(frozen220TriggerAclProfile(await json(frankfurt220TriggerAclReadSql)),'frankfurt');assert.deepEqual(await json(pgNetIdentitySql),pgNetBefore);await provePgNetRunnable219(executor);
  await finishResetSession(session);return Math.round(performance.now()-begin);
 };
 const initial=await captureReset222({executor,ownerId,reference});
 const denied=await prepareResetSession({...base,output:await at('write-failure'),state:initial}),before=await publicFingerprint(executor);denied.file=path.dirname(denied.file);
 await assert.rejects(()=>startResetAttempt(denied,executor));assert.deepEqual(await publicFingerprint(executor),before);report.cases.push('snapshot failure writes nothing');
 const ordinary=await prepareResetSession({...base,output:await at('ordinary'),state:initial});report.timings.ordinaryMs=await run(ordinary);const target=await json(schemaCatalogSql);
 for(const boundary of ['after-drop-public','migration-220','before-restore-owner-and-settings']){
  await sql("INSERT INTO public.products(sku,name_ar)VALUES("+q('TRIAL222-'+boundary)+",'Disposable222 trial');");
  const state=await captureReset222({executor,ownerId,reference}),interrupted=await prepareResetSession({...base,output:await at('interrupted-'+boundary),state});
  await assert.rejects(()=>run(interrupted,boundary),/RESET222_TEST_INTERRUPTION/);
  const resumed=await prepareResetSession({...base,output:await at('resumed-'+boundary),resume:true});await validateResetResume(resumed,executor);
  report.timings[boundary+'ResumeMs']=await run(resumed);assert.deepEqual(await json(schemaCatalogSql),target);report.cases.push('resume '+boundary+' exact catalog/Auth/MFA/raw money/history');
 }
 // The existing private write witness must still detect a foreign commit.
 const dirty=await prepareResetSession({...base,output:await at('foreign-write'),state:await captureReset222({executor,ownerId,reference})});await startResetAttempt(dirty,executor);
 await sql('UPDATE sales_lite1.mode SET full_accounting=false WHERE id;');
 await assert.rejects(()=>assertNoForeignWrites(executor,dirty.saved),/RESET214_REAL_WRITES_DETECTED/);
 const refused=await prepareResetSession({...base,output:await at('foreign-resume'),resume:true});await assert.rejects(()=>validateResetResume(refused,executor),/RESET214_REAL_WRITES_DETECTED/);report.cases.push('committed private-mode drift refuses resume');
 assertVerificationSourceFreeze(frozen,await readVerificationSourceFreeze(root));Object.assign(report,{ok:true,files:182,rawMfaAndOwnerUnchanged:true,rawLargeMoneyPreserved:true,frankfurtFourAclPreserved:true,pgNetUnchanged:true});
}catch(error){report.error=String(error.stack).slice(0,5000);report.cause=error.cause?.message;process.exitCode=1;}
finally{executor?.closeLocal();if(local)await local.stop();await save('report.json',report);await mkdir(path.join(root,'test-results/reset222'),{recursive:true});await writeFile(path.join(root,'test-results/reset222/report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
