// Real local GoTrue,TOTP and PostgREST. No mocked Auth or hosted connections.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {bindFirstOwnerSql} from '../operations/first-owner-core.mjs';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
import {localTotp} from './local-totp.mjs';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..'),cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const project='nawasrah-first-owner-test',output=await mkdtemp(path.join(tmpdir(),'nawasrah-first-owner-'));
const report={output,managedAccess:false,startedAt:new Date().toISOString()};let local,stage='bootstrap';
const executor=executorFor(['--container','supabase_db_'+project]);
const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,r.stderr.match(/FIRST_OWNER_[A-Z_]+/u)?.[0]??'LOCAL_OWNER_SQL_FAILED');return r.stdout.trim();};
try{
 const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
 NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'182',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',TURNSTILE_SECRET:'isolated-owner-captcha-not-invoked',
 NAWASRAH_SUPABASE_EXCLUDE:'realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});local=JSON.parse(boot.stdout).isolatedProjectRoot;
 const before=JSON.parse(await sql(schemaCatalogSql));
 await sql('ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;');
 const held=JSON.parse(await sql(schemaCatalogSql));
 const status=JSON.parse((await exec(process.execPath,[cli,'status','-o','json','--workdir',local],{cwd:root,windowsHide:true})).stdout);
 const api=new URL(status.API_URL);assert.equal(api.hostname,'127.0.0.1');assert.equal(api.port,'25431');
 const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
 const admin=createClient(api.origin,status.SERVICE_ROLE_KEY,options),user=createClient(api.origin,status.ANON_KEY,options);
 const email='first-owner@example.test';const created=await admin.auth.admin.createUser({email,password:randomUUID()+'Aa1!',email_confirm:true});assert.equal(created.error,null);const ownerId=created.data.user.id;
 const branch={code:'BR-OWNER',name:'الفرع الرئيسي للمالك'};
 const input={ownerId,email,name:'مالك التشغيل',branchCode:branch.code,branchName:branch.name};
 const wrongBranch=await executeInput(executor,bindFirstOwnerSql(input));assert.notEqual(wrongBranch.code,0);assert.match(wrongBranch.stderr,/FIRST_OWNER_BRANCH_MISMATCH/u);
 // Discard CLI seed locations only. No business transaction exists;the real
 // literal-migration build has no seed.sql branch or warehouse in the first place.
 await sql('DELETE FROM public.warehouses;DELETE FROM public.branches;');
 stage='guarded-owner-binding';const denied=await executeInput(executor,bindFirstOwnerSql({...input,email:'wrong@example.test'}));assert.notEqual(denied.code,0);assert.match(denied.stderr,/FIRST_OWNER_AUTH_IDENTITY_NOT_CONFIRMED/u);
 const bound=JSON.parse(await sql(bindFirstOwnerSql(input)));assert.equal(bound.ok,true);assert.equal(bound.owners,1);
 const auditBefore=await sql("SELECT count(*) FROM public.audit_logs WHERE action='FIRST_OWNER_BOOTSTRAP';");assert.equal(auditBefore,'1');
 await sql(bindFirstOwnerSql(input));assert.equal(await sql("SELECT count(*) FROM public.audit_logs WHERE action='FIRST_OWNER_BOOTSTRAP';"),'1','BOOTSTRAP_REPLAY_MUST_NOT_DUPLICATE');
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
 assert.deepEqual(catalogDifference(held,JSON.parse(await sql(schemaCatalogSql))),[],'OWNER_SETUP_MUST_NOT_CHANGE_SCHEMA_OR_GRANTS');
 report.ok=true;report.proofs=['confirmed Auth identity','exact UUID/email binding','new branch created on empty reference data','mismatched existing branch rejected','single owner/profile/role/branch','wrong email rejected','second owner rejected','idempotent audit',
 'real Auth session','real TOTP verify AAL2','old AAL1 rejected','AAL2 owner accepted','anon/no-role rejected','zero schema/grant differences'];
 report.originalCatalogObjects=before.tables.length;
}catch(error){report.ok=false;report.stage=stage;report.error=error.message.split('\n')[0];process.exitCode=1;}
finally{if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true});report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
