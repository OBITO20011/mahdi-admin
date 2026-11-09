// Quarantined phase2 commercial parity on an owned local219 DB.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {verifyGuestLifecycle} from './sales-only-phase2-lifecycle-runtime.mjs';
import {readVerificationSourceFreeze,assertVerificationSourceFreeze} from './verification-source-freeze.mjs';

assert.equal(process.argv.length,2,'NO_TARGET_ARGUMENTS');
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile);
const project='nawasrah-sales-lite2-lifecycle-test',container='supabase_db_'+project;
const output=path.join(root,'test-results/sales-only-phase2-lifecycle');await mkdir(output,{recursive:true});
const report={ok:false,probe:'guest-lifecycle-parity',hostedAccess:false,changesToApprovedBridges:false,cases:[]};
let local,ownedId;
const docker=(...args)=>exec('docker',args,{cwd:root,windowsHide:true,maxBuffer:32*1024**2});
try{
 const freeze=await readVerificationSourceFreeze(root);
 const boot=await exec(process.execPath,['scripts/testing/bootstrap-isolated-supabase.mjs'],{cwd:root,windowsHide:true,maxBuffer:32*1024**2,env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'219',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 const info=JSON.parse(boot.stdout);assert.equal(info.isolatedProjectId,project);local=info.isolatedProjectRoot;
 const first=JSON.parse((await docker('inspect',container)).stdout)[0];ownedId=first.Id;
 const canonical=p=>path.resolve(p).replaceAll('\\','/');assert.equal(canonical(first.Config.Labels['com.supabase.cli.workdir']),canonical(local));
 for(const network of Object.keys(first.NetworkSettings.Networks))await docker('network','disconnect',network,container);
 const owned=async()=>{const d=JSON.parse((await docker('inspect',container)).stdout)[0];assert.equal(d.Id,ownedId);assert.equal(d.Config.Labels['com.supabase.cli.project'],project);assert.deepEqual(Object.keys(d.NetworkSettings.Networks),[]);};
 const executor=executorFor(['--container',container]);
 const sql=async text=>{await owned();const r=await executeInput(executor,text);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
 const json=async text=>JSON.parse((await sql(text)).split('\n').at(-1));
 const q=v=>v==null?'NULL':"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb';
 const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const rpc=(call,uid=id(1),role='authenticated')=>json(`BEGIN;SELECT set_config('request.jwt.claims',${j({sub:uid,role,aal:'aal2'})}::text,true);SET LOCAL ROLE ${role};SELECT public.${call};COMMIT;`);
 await sql('SELECT cron.alter_job(jobid,active:=false) FROM cron.job;ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;');
 await sql(await readFile(new URL('./package-e-golden-day-fixture.sql',import.meta.url),'utf8'));
 await rpc(`set_go_live_main_branch_v1(${q(id(200))})`);
 await verifyGuestLifecycle({sql,json,rpc,id,q,j,executor},report);
 assertVerificationSourceFreeze(freeze,await readVerificationSourceFreeze(root));
 report.ok=true;report.networkAttachments=0;
}catch(e){report.error=String(e.message).slice(0,5000);console.error(report.error);process.exitCode=1;}
finally{
 if(local&&ownedId){try{await docker('version','--format','{{.Server.Version}}');const current=JSON.parse((await docker('inspect',container)).stdout)[0];assert.equal(current.Id,ownedId);await exec(process.execPath,[path.join(root,'node_modules/supabase/dist/supabase.js'),'stop','--workdir',local,'--no-backup'],{cwd:root,windowsHide:true,maxBuffer:8*1024**2});report.cleanup=true;}catch{report.cleanup=false;process.exitCode=1;}}
 await mkdir(output,{recursive:true});
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
