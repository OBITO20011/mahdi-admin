// Actual isolated PostgreSQL+GoTrue+Storage. No hosted target or credentials.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {readReady216Reference} from '../operations/frankfurt-reference216.mjs';
import {executorFor} from '../operations/build-empty-supabase.mjs';
import {executeResetInput as executeInput} from '../operations/reset214-io.mjs';
import {persistentLocalExecutor} from './reset214-persistent-local.mjs';
import {captureReset216,reset216WithExecutor,reset214RetentionRawSql} from '../operations/trial-reset214-core.mjs';
import {prepareResetSession,startResetAttempt,validateResetResume,finishResetSession} from '../operations/reset214-session.mjs';
import {publicFingerprint,assertNoForeignWrites,lockAndCheckGuardSql} from '../operations/reset214-write-guard.mjs';
import {schemaCatalogSql} from './schema-catalog.mjs';
import {readNotificationSnapshot,transitionNotifications} from '../operations/frankfurt-notification-hold.mjs';
import {sqlLiteral as q} from '../operations/trial-reset-core.mjs';
import {sha256} from './maintenance-db-contract.mjs';
import {localTotp} from './local-totp.mjs';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..'),cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-reset216-resume-')),project='nawasrah-reset216-resume-test',executor=persistentLocalExecutor(executorFor(['--container','supabase_db_'+project]));
const report={output,managedAccess:false,startedAt:new Date().toISOString(),cases:[]};let local,stage='bootstrap';
const sql=async(input,ex=executor)=>{const r=await executeInput(ex,input);assert.equal(r.code,0,'LOCAL_RESET216B_SQL_FAILED:'+r.stderr.slice(-350));return r.stdout.trim();};
const json=async s=>JSON.parse(await sql(s));
try{
 const referenceFile=process.argv[2];assert.ok(referenceFile,'LOCAL216_REFERENCE_REQUIRED');
 const reference=await readReady216Reference(root,referenceFile),referenceSha256=sha256(await readFile(referenceFile));
 const sourceRoot=root;
 report.historicalSource={ceiling:216,files:178,root:sourceRoot};
 const boot=await exec(process.execPath,['scripts/testing/bootstrap-isolated-supabase.mjs'],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
  NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'216',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
  NAWASRAH_SUPABASE_EXCLUDE:'realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;
 const cliCall=flags=>exec(process.execPath,[cli,...flags,'--local','--workdir',local,'--agent','no'],{cwd:root,windowsHide:true,maxBuffer:8*1024**2});
 const status=JSON.parse((await exec(process.execPath,[cli,'status','-o','json','--workdir',local],{cwd:root,windowsHide:true})).stdout),api=new URL(status.API_URL);
 assert.ok(['localhost','127.0.0.1'].includes(api.hostname));assert.equal(api.port,'25431');
 const settings={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}},admin=createClient(api.origin,status.SERVICE_ROLE_KEY,settings),owner=createClient(api.origin,status.ANON_KEY,settings);
 const created=await admin.auth.admin.createUser({email:'resume-owner@example.test',password:randomUUID()+'aA1!',email_confirm:true});assert.equal(created.error,null);const ownerId=created.data.user.id;
 const other=await admin.auth.admin.createUser({email:'resume-trial@example.test',password:randomUUID()+'aA1!',email_confirm:true});assert.equal(other.error,null);
 const link=await admin.auth.admin.generateLink({type:'magiclink',email:'resume-owner@example.test'});assert.equal(link.error,null);
 assert.equal((await owner.auth.verifyOtp({token_hash:link.data.properties.hashed_token,type:'email'})).error,null);
 const factor=await owner.auth.mfa.enroll({factorType:'totp',friendlyName:'Local resume proof',issuer:'Nawasrah local'});assert.equal(factor.error,null);
 assert.equal((await owner.auth.mfa.challengeAndVerify({factorId:factor.data.id,code:localTotp(factor.data.totp.secret)})).error,null);
 await sql(`UPDATE branches SET code='BR-MAIN' WHERE code='BR-AMMAN-01';UPDATE warehouses SET code='WH-MAIN' WHERE code='WH-MAIN-01';
 INSERT INTO profiles(id,full_name,is_active,branch_id) SELECT ${q(ownerId)},'مالك اختبار الاستئناف',true,id FROM branches WHERE code='BR-MAIN';
 INSERT INTO roles(code,name_ar) VALUES('owner','المالك') ON CONFLICT(code) DO NOTHING;
 INSERT INTO user_roles(user_id,role_id) SELECT ${q(ownerId)},id FROM roles WHERE code='owner';
 UPDATE storefront_settings SET orders_enabled=false,store_name_ar='اسم محفوظ مع الاستئناف',minimum_order_in_minor_units=9007199254740993,updated_by=${q(ownerId)};
 INSERT INTO units(code,name_ar) VALUES('RESUME-CUSTOM','وحدة مخصصة');INSERT INTO categories(code,name_ar) VALUES('RESUME-CUSTOM','قسم مخصص');`);
 await transitionNotifications(executor,await readNotificationSnapshot(executor));
 // Nonempty216 evidence must be erased with all trial business rows, while
 // exact retained settings and real Auth/MFA survive the same rebuild.
 const trialProduct=randomUUID(),trialSupplier=randomUUID(),trialCustomer=randomUUID(),trialLine=randomUUID();
 const branch=await json("SELECT to_jsonb(id) FROM branches WHERE code='BR-MAIN';"),warehouse=await json("SELECT to_jsonb(id) FROM warehouses WHERE code='WH-MAIN';");
 await sql(`INSERT INTO suppliers(id,company_name,is_active)VALUES(${q(trialSupplier)},'مورد تصفير وهمي216',true);
 INSERT INTO customers(id,full_name,phone)VALUES(${q(trialCustomer)},'زبون تصفير وهمي216','0790000001');
 INSERT INTO products(id,sku,name_ar,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,sale_price_in_minor_units,default_sale_price_in_minor_units)
 SELECT ${q(trialProduct)},'RESET216-PARTIAL','صنف تصفير وهمي216',id,id,id,1,1,1000,1000 FROM units ORDER BY code LIMIT 1;`);
 const ownerCall=call=>sql(`BEGIN;SELECT set_config('request.jwt.claims',${q(JSON.stringify({sub:ownerId,role:'authenticated',aal:'aal2'}))},true);SET LOCAL ROLE authenticated;SELECT public.${call};COMMIT;`);
 await ownerCall(`open_cash_shift(${q(branch)},0)`);
 await ownerCall(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(trialSupplier)},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q('reset216-receive-'+randomUUID())},p_payment_method:='deferred',p_lines:=${q(JSON.stringify([{client_line_id:trialLine,line_kind:'base_unit',commercial_quantity:2,base_unit_name:'باكيت',gross_amount_in_minor_units:1000,line_discount_in_minor_units:0,components:[{product_id:trialProduct,base_quantity:2}]}]))}::jsonb)`);
 await ownerCall(`create_pos_sale_with_initial_payment_v1(${q(warehouse)},${q(branch)},${q(trialCustomer)},'زبون تصفير وهمي216',${q(JSON.stringify([{commercial_line_kind:'base_unit',product_id:trialProduct,base_quantity:1,price_authority:'server_catalog',line_discount_in_minor_units:0}]))}::jsonb,0,400,'cash',NULL,'reset216-trial-partial-00001')`);
 assert.equal(await sql('SELECT count(*) FROM pos216_initial_payments;'),'1');report.nonemptyPartial216BeforeReset=true;
 const retained=await sql(reset214RetentionRawSql(ownerId));
 const base={workdir:output,ownerId,projectRef:'kzevmysfydaslxcerogt',referenceSha256,reference};
 const nextOutput=async name=>{const p=path.join(output,name);await mkdir(p);return p;};
 const sessionOptions=async name=>({...base,output:await nextOutput(name)});
 const run=async(session,stop)=>{
  const progress=await startResetAttempt(session,executor);
  const r=progress,ex=session.executor;
  await reset216WithExecutor({executor:ex,root:sourceRoot,reference,output:session.output,ownerId,session,report:r,
   emptyStorage:async()=>{const files=await json("SELECT COALESCE(jsonb_agg(name ORDER BY name),'[]') FROM storage.objects WHERE bucket_id='product-images';");
    if(files.length)assert.equal((await admin.storage.from('product-images').remove(stop==='after-storage'?files.slice(0,1):files)).error,null);
    if(stop==='after-storage')throw new Error('RESET216_SIMULATED_INTERRUPTION');},
   deleteOtherAuth:async id=>sql(`DELETE FROM auth.users WHERE id<>${q(id)}::uuid;`,ex),
   // Real local history rows,not a mocked response. Existing216 gate separately
   // proves official per-file CLI repair;here final official CLI dry-run verifies
   // all178 after each resumed literal rebuild without 1000+ CLI startups.
   clearHistory:async()=>sql('DELETE FROM supabase_migrations.schema_migrations;DELETE FROM supabase_migrations.seed_files;',ex),
   repair:async version=>sql(`INSERT INTO supabase_migrations.schema_migrations(version) VALUES(${q(version)});`,ex),
   finalDryRun:async()=>{const d=await cliCall(['db','push','--dry-run','--skip-vault']);assert.match(d.stdout+d.stderr,/up to date/iu);},
   boundary:async name=>{if(name===stop)throw new Error('RESET216_SIMULATED_INTERRUPTION');}});
  await finishResetSession(session);return r;
 };
 stage='snapshot-write-failure';
 const denied=await prepareResetSession({...await sessionOptions('write-failure'),state:await captureReset216({executor,ownerId,reference})});
 denied.file=path.dirname(denied.file);const before=await publicFingerprint(executor);
 await assert.rejects(()=>startResetAttempt(denied,executor));assert.deepEqual(await publicFingerprint(executor),before);
 await assert.rejects(()=>readFile(path.join(output,'RESET216_IN_PROGRESS.json')),{code:'ENOENT'});report.saveFailureBeforeDelete=true;
 stage='uninterrupted';
 const ordinary=await prepareResetSession({...await sessionOptions('ordinary'),state:await captureReset216({executor,ownerId,reference})});
 const good=await run(ordinary);assert.equal(good.ok,true);report.uninterrupted={applied:good.applied.length,recorded:good.recorded.length,catalog:good.catalogDifferences,acl:good.applicationAclDifferences};
 assert.equal(await sql('SELECT count(*) FROM pos216_initial_payments;'),'0');report.partial216TrialEvidenceRemoved=true;
 const targetCatalog=await json(schemaCatalogSql);
 for(const stop of ['after-storage','after-drop-public','migration-088','before-restore-owner-and-settings']){
  stage=stop;
  const file=ownerId+'/'+randomUUID()+'.png',bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC4sAAAAASUVORK5CYII=','base64');
  assert.equal((await admin.storage.from('product-images').upload(file,bytes,{contentType:'image/png'})).error,null);
  if(stop==='after-storage')assert.equal((await admin.storage.from('product-images').upload(file+'.remaining',bytes,{contentType:'image/png'})).error,null);
  // Real trial business row exists before Storage. It must not be mistaken for
  // a new post-cutover row on the first interruption boundary.
  await sql(`INSERT INTO products(sku,name_ar) VALUES(${q('TRIAL-'+stop)},'صنف تجربة مقصود مسحه');`);
  const interrupted=await prepareResetSession({...await sessionOptions('interrupted-'+stop),state:await captureReset216({executor,ownerId,reference})});
  await assert.rejects(()=>run(interrupted,stop),/RESET216_SIMULATED_INTERRUPTION/u);
  const stored=JSON.parse(await readFile(path.join(interrupted.output,'reset216-progress.json'),'utf8'));assert.equal(stored.ok,false);assert.equal(stored.recoveryRequired,true);
  const storageRemaining=await sql('SELECT count(*) FROM storage.objects;');assert.equal(storageRemaining,stop==='after-storage'?'1':'0');
  if(stop==='after-storage'){
   await sql(`UPDATE auth.users SET last_sign_in_at=now(),updated_at=now() WHERE id=${q(ownerId)};
    UPDATE auth.identities SET last_sign_in_at=now(),updated_at=now() WHERE user_id=${q(ownerId)};`);
   report.ownerSigninTimestampsAllowed=true;
  }
  if(stop==='migration-088'){
   stage='negative-snapshot-identity';
   for(const changes of [{ownerId:randomUUID()},{projectRef:'other'},{referenceSha256:'0'.repeat(64)}])await assert.rejects(()=>prepareResetSession({...base,...changes,output:interrupted.output,resume:true}));
   const raw=await readFile(interrupted.file,'utf8');await writeFile(interrupted.file,raw+' ');
   await assert.rejects(()=>prepareResetSession({...base,output:interrupted.output,resume:true}),/RESET214_RETENTION_HASH_MISMATCH/u);await writeFile(interrupted.file,raw);
   await rename(interrupted.file,interrupted.file+'.held');await assert.rejects(()=>prepareResetSession({...base,output:interrupted.output,resume:true}),/RESET214_RETENTION_SNAPSHOT_REQUIRED/u);await rename(interrupted.file+'.held',interrupted.file);
   const marker=path.join(output,'RESET216_IN_PROGRESS.json');await rename(marker,marker+'.held');await assert.rejects(()=>prepareResetSession({...base,output:interrupted.output,resume:true}),/RESET214_RESUME_MARKER_REQUIRED/u);await rename(marker+'.held',marker);
   await sql(`UPDATE auth.mfa_factors SET status='unverified' WHERE id=${q(factor.data.id)};`);
   const missingMfa=await prepareResetSession({...base,output:interrupted.output,resume:true});await assert.rejects(()=>validateResetResume(missingMfa,executor),/RESET214_OWNER_MFA_MISSING/u);
   await sql(`UPDATE auth.mfa_factors SET status='verified' WHERE id=${q(factor.data.id)};`);
   report.negativeSnapshots={missing:true,tampered:true,differentOwner:true,differentProject:true,differentReference:true,noMarker:true,missingMfa:true};
  }
  stage='resume-'+stop;
  const resumed=await prepareResetSession({...await sessionOptions('resumed-'+stop),resume:true});
  await validateResetResume(resumed,executor);const done=await run(resumed);
  assert.equal(done.ok,true);assert.equal(done.applied.length,178);assert.equal(done.recorded.length,178);assert.equal(done.catalogDifferences,0);assert.equal(done.applicationAclDifferences,0);
  assert.equal(await sql(reset214RetentionRawSql(ownerId)),retained,'RESUME_RAW_RETENTION_DIFFERS');
  assert.equal(await sql('SELECT minimum_order_in_minor_units::text FROM storefront_settings;'),'9007199254740993');
  assert.deepEqual(await json(schemaCatalogSql),targetCatalog,'RESUME_CATALOG_DIFFERS_FROM_UNINTERRUPTED');
  assert.equal((await owner.auth.mfa.listFactors()).data.totp.some(f=>f.id===factor.data.id&&f.status==='verified'),true);
  assert.equal(await sql('SELECT count(*) FROM auth.users;'),'1');assert.equal(await sql('SELECT count(*) FROM products;'),'0');
  assert.equal(await sql('SELECT count(*) FROM storage.objects;'),'0');
  const missing=await fetch(admin.storage.from('product-images').getPublicUrl(file).data.publicUrl+'?resume-proof='+randomUUID(),{cache:'no-store'});
  assert.equal(String((await missing.json()).statusCode),'404','RESET214_PHYSICAL_BYTES_MUST_BE_REMOVED');
  assert.equal(done.resumedFrom,interrupted.output);await assert.rejects(()=>readFile(path.join(output,'RESET216_IN_PROGRESS.json')),{code:'ENOENT'});
  report.cases.push({stop,previousApplied:stored.applied.length,previousRecorded:stored.recorded.length,storageRemainingAtInterruption:Number(storageRemaining),physicalBytesRemoved:true,restartedAll178:true,retentionMatches:true,catalogDifferences:0,aclDifferences:0,verifiedMfa:true,archiveProtected:true});
  console.log(JSON.stringify({stage:'resume-case-complete',stop,ok:true}));
 }
 stage='foreign-write-negative';
 const dirty=await prepareResetSession({...await sessionOptions('dirty-write'),state:await captureReset216({executor,ownerId,reference})});
 await assert.rejects(()=>run(dirty,'migration-088'),/RESET216_SIMULATED_INTERRUPTION/u);
 // Two real sessions:the reset fence starts while a foreign INSERT+DELETE is
 // uncommitted,waits for the relation lock,then must see its committed witness.
 await sql("BEGIN;INSERT INTO customers(full_name,phone) VALUES('دخل بعد القطع','0790000001');DELETE FROM customers WHERE phone='0790000001';");
 const resetPid=await sql('SELECT pg_backend_pid();',dirty.executor);assert.match(resetPid,/^\d+$/u);
 const fence=executeInput(dirty.executor,'BEGIN;'+lockAndCheckGuardSql+'ROLLBACK;');
 // Keep the foreign transaction open until pg_locks proves the reset is
 // actually waiting. No timing sleep,no retry of a failed business statement.
 let waiting=false;
 for(let i=0;i<100;i++){
  const lock=await executor.continueLocal(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=${resetPid} AND mode='AccessExclusiveLock' AND NOT granted);`);
  assert.equal(lock.code,0);waiting=lock.stdout.trim()==='t';if(waiting)break;
 }
 assert.equal(waiting,true,'RESET_FENCE_MUST_BE_WAITING_BEFORE_THE_FOREIGN_COMMIT');
 assert.equal((await executor.continueLocal('COMMIT;')).code,0);
 const raced=await fence;
 assert.notEqual(raced.code,0,'FENCE_MUST_NOT_ADMIT_A_COMMITTED_FOREIGN_WRITE');assert.match(raced.stderr,/RESET214_REAL_WRITES_DETECTED/u);report.twoSessionDropFenceRejected=true;
 report.twoSessionRaceCoordination='open transaction and observed lock wait;no timing sleeps';
 await assert.rejects(()=>assertNoForeignWrites(executor,dirty.saved),/RESET214_REAL_WRITES_DETECTED/u);
 const unsafe=await prepareResetSession({...base,output:dirty.output,resume:true});await assert.rejects(()=>validateResetResume(unsafe,executor),/RESET214_REAL_WRITES_DETECTED/u);
 const unchanged=await publicFingerprint(executor);await assert.rejects(()=>startResetAttempt(unsafe,executor),/RESET214_REAL_WRITES_DETECTED/u);assert.deepEqual(await publicFingerprint(executor),unchanged);
 report.realCommittedWritesRejected=true;
 await sql(`DELETE FROM auth.users WHERE id=${q(ownerId)};`);await assert.rejects(()=>validateResetResume(unsafe,executor),/RESET214_OWNER_AUTH_MISSING/u);report.ownerMissingRejected=true;
 report.ok=true;
}catch(error){report.ok=false;report.stage=stage;report.error=error.message.split('\n')[0];process.exitCode=1;}
finally{executor.closeLocal();if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true});report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
