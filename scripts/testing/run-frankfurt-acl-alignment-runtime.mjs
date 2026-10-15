// Real PostgreSQL proof on disposable138 only;no managed target/credential.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {readNotificationSnapshot,transitionNotifications} from '../operations/frankfurt-notification-hold.mjs';
import {generateAclPlan,alignmentTransaction} from '../operations/frankfurt-acl-plan.mjs';
import {alignWithExecutor} from '../operations/frankfurt-align-acl.mjs';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..');
const project='nawasrah-acl-'+randomBytes(5).toString('hex')+'-test',container='supabase_db_'+project;
const cli=path.join(root,'node_modules/supabase/dist/supabase.js'),output=await mkdtemp(path.join(tmpdir(),'nawasrah-acl-runtime-'));
const report={startedAt:new Date().toISOString(),output,managedAccess:false};
let local,stage='bootstrap138';
try{
 const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
  NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'138',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
  NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;const executor=executorFor(['--container',container]);
 const catalog=async()=>{const r=await executeInput(executor,schemaCatalogSql);assert.equal(r.code,0);return JSON.parse(r.stdout.trim());};
 const reference={catalog:await catalog()},original=await readNotificationSnapshot(executor);
 await transitionNotifications(executor,original);
 stage='fixture-extra-grants';
 const changed=await executeInput(executor,`GRANT SELECT,INSERT,UPDATE,DELETE ON public.audit_logs TO anon,authenticated,service_role;
 GRANT SELECT,USAGE ON SEQUENCE public.cash_shift_number_seq TO anon,authenticated,service_role;
 GRANT EXECUTE ON FUNCTION public.authorize_admin_ai_assistant_request() TO anon,service_role;
 GRANT EXECUTE ON FUNCTION public.enforce_customer_for_debt_order() TO anon,authenticated,service_role;
 ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
 ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon,authenticated,service_role;
 ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;`);
 assert.equal(changed.code,0,'FIXTURE_GRANTS_FAILED');
 const observed=await catalog(),dates={beforeBuildDate:new Date().toISOString().slice(0,10),afterBuildDate:new Date().toISOString().slice(0,10)};
 const plan=generateAclPlan(reference.catalog,observed);assert.equal(plan.objectCount,7);
 stage='real-alignment-transaction';report.alignment={};
 await alignWithExecutor(executor,reference,observed,original,dates,output,report.alignment);
 assert.equal(report.alignment.ok,true);assert.equal(report.alignment.serviceRoleUnchanged,true);
 assert.equal(report.alignment.catalogUnexpectedDifferenceCount,0);assert.equal(report.alignment.catalogExpectedHold.name,'trg_notify_new_website_order_push');
 assert.equal(generateAclPlan(reference.catalog,await catalog()).commands.length,0);
 report.idempotentPlan=true;
 stage='stale-preview';
 const oldObserved=await catalog();assert.equal((await executeInput(executor,'GRANT SELECT ON public.audit_logs TO anon;')).code,0);
 await assert.rejects(()=>alignWithExecutor(executor,reference,oldObserved,original,dates,output,{}),/ACL_PREVIEW_STALE/u);
 report.stalePreviewRejected=true;
 stage='rollback-postcondition';
 const before=await catalog(),negative=generateAclPlan(reference.catalog,before);
 negative.commands.push('GRANT INSERT ON public.audit_logs TO authenticated;');
 const denied=await executeInput(executor,alignmentTransaction(negative));
 assert.notEqual(denied.code,0);assert.match(denied.stderr,/ACL_ALIGNMENT_POSTCONDITION_FAILED/u);
 assert.deepEqual(catalogDifference(before,await catalog()),[]);report.atomicRollback=true;
 report.ok=true;
}catch(error){report.ok=false;report.stage=stage;report.error=error.code==='ERR_ASSERTION'?error.message:'ACL_RUNTIME_FAILED';process.exitCode=1;}
finally{
 if(local)try{await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true});report.cleanup='owned-stack-stopped';}
 catch{report.cleanup='FAILED';report.ok=false;process.exitCode=1;}
 report.endedAt=new Date().toISOString();await writeFile(path.join(output,'runtime-report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({ok:report.ok,stage:report.stage,error:report.error,output,stalePreviewRejected:report.stalePreviewRejected,atomicRollback:report.atomicRollback,unexpected:report.alignment?.catalogUnexpectedDifferenceCount}));
}
