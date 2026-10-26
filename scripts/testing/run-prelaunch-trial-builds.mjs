// Actual Vite/SEO builds through loopback only;never invoke a deployment.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp,mkdir,copyFile,readdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {verifyEnvironmentDist} from '../environments/verify-dist.mjs';
import {assertDeploymentTarget} from '../environments/deployment-context.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),proofs=[];
const env={...process.env,NAWASRAH_DEPLOYMENT_ENV:'prelaunch-trial'};
for(const key of ['VITE_SUPABASE_URL','VITE_SUPABASE_PUBLISHABLE_KEY','VITE_SUPABASE_ANON_KEY','VITE_PUBLIC_SITE_ORIGIN','VITE_STOREFRONT_PUBLIC_URL','VITE_BROWSER_QA_ISOLATED'])delete env[key];
for(const app of ['admin','customer']){
 const args=app==='customer'?['scripts/testing/run-customer-isolated-build.mjs']:['scripts/environments/run-context.mjs','prelaunch-trial','admin'];
 const r=await exec(process.execPath,args,{cwd:root,env,windowsHide:true,maxBuffer:8*1024**2});process.stdout.write(r.stdout);process.stderr.write(r.stderr);
 const dir=path.join(root,app==='customer'?'customer-web/dist':'dist');
 proofs.push(await verifyEnvironmentDist({app,environment:'prelaunch-trial',dir,allowFixture:app==='customer'}));
 const manifest=JSON.parse(await readFile(path.join(dir,'nawasrah-environment.json'),'utf8'));
 assert.equal(manifest.prelaunchTrial,true);assert.equal(manifest.allowedPreviewBranch,'staging-frankfurt');assert.equal(manifest.productionDeployAllowed,false);
 assert.equal(manifest.url,'https://kzevmysfydaslxcerogt.supabase.co');assert.equal(manifest.storeOrigin,'https://staging-frankfurt.nawasrah-store.pages.dev');
 await assert.rejects(()=>verifyEnvironmentDist({app,environment:'production',dir,allowFixture:true}),/DIST_ENVIRONMENT_MISMATCH/u);
 const project=app==='admin'?'nawasrah-admin':'nawasrah-store';
 assert.throws(()=>assertDeploymentTarget({app,environment:'prelaunch-trial',branch:'main',project}),/PREVIEW_BRANCH_ONLY/u);
 assertDeploymentTarget({app,environment:'prelaunch-trial',branch:'staging-frankfurt',project});
 // A trial artifact with a forged production name still fails its store-origin binding.
 const original=await readFile(path.join(dir,'nawasrah-environment.json'),'utf8');
 await writeFile(path.join(dir,'nawasrah-environment.json'),JSON.stringify({...manifest,environment:'production'}));
 try{await assert.rejects(()=>verifyEnvironmentDist({app,environment:'production',dir,allowFixture:true}),/DIST_ENVIRONMENT_MISMATCH/u);}finally{await writeFile(path.join(dir,'nawasrah-environment.json'),original);}
}
// Close a COPY of the real source switch. Run BOTH real build commands against
// the real Vite configs,not a mocked resolver. Never mutate the checkout's flag.
const closed=await mkdtemp(path.join(tmpdir(),'nawasrah-prelaunch-closed-'));
await mkdir(path.join(closed,'scripts/environments'),{recursive:true});await mkdir(path.join(closed,'customer-web'));
for(const file of await readdir(path.join(root,'scripts/environments')))await copyFile(path.join(root,'scripts/environments',file),path.join(closed,'scripts/environments',file));
for(const file of ['vite.config.ts','customer-web/vite.config.ts'])await copyFile(path.join(root,file),path.join(closed,file));
await symlink(path.join(root,'node_modules'),path.join(closed,'node_modules'),process.platform==='win32'?'junction':'dir');
await symlink(path.join(root,'customer-web/node_modules'),path.join(closed,'customer-web/node_modules'),process.platform==='win32'?'junction':'dir');
const control=path.join(closed,'scripts/environments/prelaunch-trial-control.mjs'),text=await readFile(control,'utf8');
assert.equal(text.split('PRELAUNCH_TRIAL_OPEN=true').length,2);await writeFile(control,text.replace('PRELAUNCH_TRIAL_OPEN=true','PRELAUNCH_TRIAL_OPEN=false'));
for(const app of ['admin','customer'])await assert.rejects(()=>exec(process.execPath,['scripts/environments/run-context.mjs','prelaunch-trial',app],{cwd:closed,env,windowsHide:true,maxBuffer:2*1024**2}),error=>error.stderr.includes('PRELAUNCH_TRIAL_CLOSED'));
// Neither process-env OPEN=true nor an isolated QA flag can reopen the source switch.
await assert.rejects(()=>exec(process.execPath,['scripts/environments/run-context.mjs','prelaunch-trial','admin'],{cwd:closed,env:{...env,PRELAUNCH_TRIAL_OPEN:'true',VITE_BROWSER_QA_ISOLATED:'true',VITE_SUPABASE_URL:'http://127.0.0.1:4176',VITE_SUPABASE_ANON_KEY:'isolated-test-value'},windowsHide:true}),error=>error.stderr.includes('PRELAUNCH_TRIAL_CLOSED'));
// Existing artifacts cannot pass verification after the source switch closes.
for(const app of ['admin','customer'])await assert.rejects(()=>exec(process.execPath,['scripts/environments/verify-dist.mjs',app,'prelaunch-trial',path.join(root,app==='admin'?'dist':'customer-web/dist')],{cwd:closed,env,windowsHide:true}),error=>error.stderr.includes('PRELAUNCH_TRIAL_CLOSED'));
console.log(JSON.stringify({ok:true,hostedAccess:false,deployments:0,builds:proofs,productionArtifactRefusals:2,forgedProductionRefusals:2,wrongBranchRefusals:2,closedActualBuildRefusals:2,closedExistingArtifactRefusals:2,closedEnvironmentOverrideRefused:true}));
