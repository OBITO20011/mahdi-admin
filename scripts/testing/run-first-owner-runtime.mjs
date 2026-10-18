// Real local GoTrue,TOTP and PostgREST. No mocked Auth or hosted connections.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {bindFirstOwnerSql} from '../operations/first-owner-core.mjs';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
import {localTotp} from './local-totp.mjs';
import {readFirstOwner198Reference} from '../operations/first-owner-reference198.mjs';
import {ready198ReferenceName} from '../operations/frankfurt-reference198.mjs';
import {buildReady198Reference} from '../operations/build-acl-reference198.mjs';
import {firstOwnerWithExecutor} from '../operations/frankfurt-first-owner.mjs';
import {mainWarehouseSql} from '../operations/main-warehouse-core.mjs';
import {mainWarehouseWithExecutor} from '../operations/frankfurt-main-warehouse.mjs';
import {readNotificationSnapshot,transitionNotifications,expectedHeldNotifications} from '../operations/frankfurt-notification-hold.mjs';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..'),cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const project='nawasrah-first-owner-test',output=await mkdtemp(path.join(tmpdir(),'nawasrah-first-owner-'));
const report={output,managedAccess:false,migrationCeiling:198,startedAt:new Date().toISOString()};let local,stage='reference198';
const executor=executorFor(['--container','supabase_db_'+project]);
const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,r.stderr.match(/FIRST_OWNER_[A-Z_]+/u)?.[0]??'LOCAL_OWNER_SQL_FAILED');return r.stdout.trim();};
try{
 const args=process.argv.slice(2);assert.ok(args.length===0||(args.length===2&&args[0]==='--reference'),'ONLY_LOCAL_REFERENCE_OPTION');
 const referenceFile=args[1]??path.join(output,ready198ReferenceName);
 if(!args.length)await buildReady198Reference(['--output',referenceFile]);
 const {reference,access}=await readFirstOwner198Reference(root,referenceFile);report.accessEvidence=access;
 stage='bootstrap198';
 const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
 NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'198',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',TURNSTILE_SECRET:'isolated-owner-captcha-not-invoked',
 NAWASRAH_SUPABASE_EXCLUDE:'realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});local=JSON.parse(boot.stdout).isolatedProjectRoot;
 const before=JSON.parse(await sql(schemaCatalogSql));
 const original=await readNotificationSnapshot(executor);await transitionNotifications(executor,original);
 const held=JSON.parse(await sql(schemaCatalogSql));
 const status=JSON.parse((await exec(process.execPath,[cli,'status','-o','json','--workdir',local],{cwd:root,windowsHide:true})).stdout);
 const api=new URL(status.API_URL);assert.equal(api.hostname,'127.0.0.1');assert.equal(api.port,'25431');
 const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
 const admin=createClient(api.origin,status.SERVICE_ROLE_KEY,options),user=createClient(api.origin,status.ANON_KEY,options);
 const email='first-owner@example.test';const created=await admin.auth.admin.createUser({email,password:randomUUID()+'Aa1!',email_confirm:true});assert.equal(created.error,null);const ownerId=created.data.user.id;
 const branch={code:'BR-MAIN',name:'الفرع الرئيسي'};
 const input={ownerId,email,name:'مالك التشغيل',branchCode:branch.code,branchName:branch.name};
 const wrongBranch=await executeInput(executor,bindFirstOwnerSql(input));assert.notEqual(wrongBranch.code,0);assert.match(wrongBranch.stderr,/FIRST_OWNER_BRANCH_MISMATCH/u);
 // Discard CLI seed locations only. No business transaction exists;the real
 // literal-migration build has no seed.sql branch or warehouse in the first place.
 await sql('DELETE FROM public.warehouses;DELETE FROM public.branches;');
 stage='guarded-owner-binding';const denied=await executeInput(executor,bindFirstOwnerSql({...input,email:'wrong@example.test'}));assert.notEqual(denied.code,0);assert.match(denied.stderr,/FIRST_OWNER_AUTH_IDENTITY_NOT_CONFIRMED/u);
 const stale={...reference,appliedVersions:reference.appliedVersions.slice(0,-1)},staleReport={remoteWriteAttempted:false};
 const staleOutput=path.join(output,'stale-history');await mkdir(staleOutput);
 await assert.rejects(()=>firstOwnerWithExecutor({executor,reference:stale,original,output:staleOutput,input,report:staleReport}));
 assert.equal(staleReport.remoteWriteAttempted,false);assert.equal(await sql('SELECT count(*) FROM public.profiles;'),'0');
 const pipelineOutput=path.join(output,'pipeline');await mkdir(pipelineOutput);report.pipeline={remoteWriteAttempted:false};
 const bound=await firstOwnerWithExecutor({executor,reference,original,output:pipelineOutput,input,report:report.pipeline});assert.equal(bound.ok,true);assert.equal(bound.ownerBound,true);
 assert.equal(report.pipeline.catalogUnexpectedDifferenceCount,0);assert.deepEqual(report.pipeline.realtimeComparison.differences,[]);
 const auditBefore=await sql("SELECT count(*) FROM public.audit_logs WHERE action='FIRST_OWNER_BOOTSTRAP';");assert.equal(auditBefore,'1');
 const replayOutput=path.join(output,'replay');await mkdir(replayOutput);
 report.replay={};await firstOwnerWithExecutor({executor,reference,original,output:replayOutput,input,report:report.replay});
 assert.equal(await sql("SELECT count(*) FROM public.audit_logs WHERE action='FIRST_OWNER_BOOTSTRAP';"),'1','BOOTSTRAP_REPLAY_MUST_NOT_DUPLICATE');
 const other=await admin.auth.admin.createUser({email:'not-owner@example.test',password:randomUUID()+'Aa1!',email_confirm:true});assert.equal(other.error,null);
 const second=await executeInput(executor,bindFirstOwnerSql({...input,ownerId:other.data.user.id,email:'not-owner@example.test'}));assert.notEqual(second.code,0);assert.match(second.stderr,/FIRST_OWNER_ALREADY_INITIALIZED/u);
 assert.equal(await sql('SELECT count(*) FROM public.profiles;'),'1');assert.equal(await sql('SELECT count(*) FROM public.user_roles;'),'1');
 stage='real-auth-session';const link=await admin.auth.admin.generateLink({type:'magiclink',email});assert.equal(link.error,null);
 // Local Admin-issued login link avoids calling external Turnstile or SMTP.
 // This does NOT claim to test hosted CAPTCHA/password or email delivery.
 const login=await user.auth.verifyOtp({token_hash:link.data.properties.hashed_token,type:'email'});assert.equal(login.error,null);assert.ok(login.data.session);
 const aal1=login.data.session.access_token;
 assert.equal((await user.rpc('get_erp_staff_accounts')).error,null,'OWNER_MUST_BE_AUTHORIZED');
 stage='real-totp';const enrolled=await user.auth.mfa.enroll({factorType:'totp',friendlyName:'تأسيس المالك المحلي',issuer:'Nawasrah local test'});assert.equal(enrolled.error,null);
 const verified=await user.auth.mfa.challengeAndVerify({factorId:enrolled.data.id,code:localTotp(enrolled.data.totp.secret)});assert.equal(verified.error,null,'REAL_TOTP_MUST_VERIFY');
 const aal=await user.auth.mfa.getAuthenticatorAssuranceLevel();assert.equal(aal.error,null);assert.equal(aal.data.currentLevel,'aal2');
 const old=createClient(api.origin,status.ANON_KEY,{...options,global:{headers:{Authorization:'Bearer '+aal1}}});
 const refused=await old.rpc('get_erp_staff_accounts');assert.ok(refused.error,'VERIFIED_FACTOR_REQUIRES_AAL2');
 assert.equal((await user.rpc('get_erp_staff_accounts')).error,null,'AAL2_OWNER_MUST_WORK');
 const anon=createClient(api.origin,status.ANON_KEY,options);assert.ok((await anon.rpc('get_erp_staff_accounts')).error,'ANON_MUST_NOT_READ_STAFF');
 const noRoleLink=await admin.auth.admin.generateLink({type:'magiclink',email:'not-owner@example.test'});assert.equal(noRoleLink.error,null);
 const noRole=createClient(api.origin,status.ANON_KEY,options);assert.equal((await noRole.auth.verifyOtp({token_hash:noRoleLink.data.properties.hashed_token,type:'email'})).error,null);
 assert.ok((await noRole.rpc('get_erp_staff_accounts')).error,'NO_ERP_ROLE_MUST_BE_REJECTED');
 stage='main-warehouse-owner-tool';
 const warehouseBefore=await sql("SELECT jsonb_build_object('warehouses',count(*),'audits',(SELECT count(*) FROM audit_logs WHERE action='MAIN_WAREHOUSE_BOOTSTRAP')) FROM warehouses;");
 const noWarehouseRole=await executeInput(executor,mainWarehouseSql(other.data.user.id));
 assert.notEqual(noWarehouseRole.code,0);assert.match(noWarehouseRole.stderr,/MAIN_WAREHOUSE_OWNER_REQUIRED/u);
 assert.equal(await sql("SELECT jsonb_build_object('warehouses',count(*),'audits',(SELECT count(*) FROM audit_logs WHERE action='MAIN_WAREHOUSE_BOOTSTRAP')) FROM warehouses;"),warehouseBefore,'UNAUTHORIZED_TOOL_IS_ZERO_WRITE');
 const warehouseOutput=path.join(output,'main-warehouse');await mkdir(warehouseOutput);report.mainWarehouse={remoteWriteAttempted:false};
 const ready=await mainWarehouseWithExecutor({executor,reference,original,output:warehouseOutput,ownerId,report:report.mainWarehouse});
 assert.equal(ready.ok,true);assert.equal(ready.warehouseReady,true);assert.equal(ready.catalogUnexpectedDifferenceCount,0);
 const warehouseRow=await sql("SELECT row_to_json(w) FROM warehouses w WHERE code='WH-MAIN';");
 assert.equal(JSON.parse(warehouseRow).branch_id,await sql("SELECT id FROM branches WHERE code='BR-MAIN';"));
 assert.equal(await sql("SELECT count(*) FROM audit_logs WHERE action='MAIN_WAREHOUSE_BOOTSTRAP';"),'1');
 const warehouseReplay=path.join(output,'main-warehouse-replay');await mkdir(warehouseReplay);
 await mainWarehouseWithExecutor({executor,reference,original,output:warehouseReplay,ownerId,report:{}});
 assert.equal(await sql("SELECT row_to_json(w) FROM warehouses w WHERE code='WH-MAIN';"),warehouseRow,'EXACT_WAREHOUSE_REPLAY');
 assert.equal(await sql("SELECT count(*) FROM audit_logs WHERE action='MAIN_WAREHOUSE_BOOTSTRAP';"),'1','NO_DUPLICATE_WAREHOUSE_AUDIT');
 for(const mutation of ["UPDATE warehouses SET name_ar='مختلف' WHERE code='WH-MAIN';","UPDATE warehouses SET is_active=false WHERE code='WH-MAIN';","INSERT INTO warehouses(code,name_ar) VALUES('WH-OTHER','مستودع آخر');"]){
  const refused=await executeInput(executor,`BEGIN;${mutation}\n${mainWarehouseSql(ownerId).replace(/^BEGIN ISOLATION LEVEL SERIALIZABLE;/u,'').replace(/COMMIT;$/u,'')}`);
  assert.notEqual(refused.code,0);assert.match(refused.stderr,/MAIN_WAREHOUSE_DIFFERENT_WAREHOUSE/u);
  assert.equal(await sql("SELECT row_to_json(w) FROM warehouses w WHERE code='WH-MAIN';"),warehouseRow,'CONFLICT_MUST_ROLL_BACK');
  assert.equal(await sql('SELECT count(*) FROM warehouses;'),'1');
 }
 const wrongWarehouseBranch=await executeInput(executor,`BEGIN;UPDATE branches SET is_active=false WHERE code='BR-MAIN';${mainWarehouseSql(ownerId).replace(/^BEGIN ISOLATION LEVEL SERIALIZABLE;/u,'').replace(/COMMIT;$/u,'')}`);
 assert.notEqual(wrongWarehouseBranch.code,0);assert.match(wrongWarehouseBranch.stderr,/MAIN_WAREHOUSE_BRANCH_MISMATCH/u);
 assert.equal(await sql("SELECT count(*) FROM audit_logs WHERE action='MAIN_WAREHOUSE_BOOTSTRAP';"),'1');
 const staleWarehouseOutput=path.join(output,'main-warehouse-stale');await mkdir(staleWarehouseOutput);const staleWarehouseReport={remoteWriteAttempted:false};
 await assert.rejects(()=>mainWarehouseWithExecutor({executor,reference:stale,original,output:staleWarehouseOutput,ownerId,report:staleWarehouseReport}),/MAIN_WAREHOUSE_HISTORY_MISMATCH/u);
 assert.equal(staleWarehouseReport.remoteWriteAttempted,false);
 assert.deepEqual(catalogDifference(held,JSON.parse(await sql(schemaCatalogSql))),[],'OWNER_SETUP_MUST_NOT_CHANGE_SCHEMA_OR_GRANTS');
 assert.deepEqual(await readNotificationSnapshot(executor),expectedHeldNotifications(original),'OWNER_SETUP_MUST_PRESERVE_EXACT_HOLD');
 report.ok=true;report.proofs=['confirmed Auth identity','exact UUID/email binding','new branch created on empty reference data','mismatched existing branch rejected','single owner/profile/role/branch','wrong email rejected','second owner rejected','idempotent audit',
 'real Auth session','real TOTP verify AAL2','old AAL1 rejected','AAL2 owner accepted','anon/no-role rejected','zero schema/grant differences',
 'strict reference198 and current real SDK proof','same owner CLI executor pipeline','stale history rejected before binding','exact notification hold and Realtime13 unchanged',
 'main warehouse same guarded owner pipeline on198','WH-MAIN linked to BR-MAIN','exact zero-write warehouse replay and single audit',
 'no-role/different-name/inactive/multiple warehouses/inactive-branch rejected atomically','stale warehouse history rejected before write'];
 report.originalCatalogObjects=before.tables.length;
}catch(error){report.ok=false;report.stage=stage;report.error=error.message.split('\n')[0];process.exitCode=1;}
finally{if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true});report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
