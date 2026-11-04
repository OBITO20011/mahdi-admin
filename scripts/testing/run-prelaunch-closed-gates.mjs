// Real cutover commands, not a mocked flag/resolver. No deployment or hosted read.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {PRELAUNCH_TRIAL_OPEN} from '../environments/prelaunch-trial-control.mjs';
import {publicEnvironments} from '../environments/environment.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile);
assert.equal(PRELAUNCH_TRIAL_OPEN,false,'CUTOVER_SOURCE_MUST_BE_CLOSED');
const env={...process.env};
for(const key of ['VITE_SUPABASE_URL','VITE_SUPABASE_PUBLISHABLE_KEY','VITE_SUPABASE_ANON_KEY','VITE_PUBLIC_SITE_ORIGIN','VITE_STOREFRONT_PUBLIC_URL','VITE_BROWSER_QA_ISOLATED'])delete env[key];
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-prelaunch-closed-proof-'));
const counts={actualBuildRefusals:0,existingArtifactRefusals:0,deployCheckRefusals:0,environmentOverrideRefusals:0};
const reject=async(args,extra={})=>assert.rejects(()=>exec(process.execPath,args,{cwd:root,env:{...env,...extra},windowsHide:true,maxBuffer:2*1024**2}),error=>error.stderr?.includes('PRELAUNCH_TRIAL_CLOSED'));
try{
 for(const app of ['admin','customer']){
  await reject(['scripts/environments/run-context.mjs','prelaunch-trial',app]);counts.actualBuildRefusals++;
  await reject(['scripts/environments/run-context.mjs','prelaunch-trial',app],{PRELAUNCH_TRIAL_OPEN:'true',VITE_BROWSER_QA_ISOLATED:'true',VITE_SUPABASE_URL:'http://127.0.0.1:4176',VITE_SUPABASE_ANON_KEY:'isolated-test-value'});counts.environmentOverrideRefusals++;
  // Model a pre-existing trial artifact explicitly. A closed source must refuse
  // even the old correct environment/branch markers, before any upload/network.
  const dir=path.join(output,app);await mkdir(dir);
  const selected=publicEnvironments['prelaunch-trial'];
  await writeFile(path.join(dir,'nawasrah-environment.json'),JSON.stringify({format:1,environment:'prelaunch-trial',isolated:false,prelaunchTrial:true,allowedPreviewBranch:'staging-frankfurt',productionDeployAllowed:false,...selected,url:`https://${selected.projectRef}.supabase.co`,monitoring:{dsn:'',ingestOrigin:'',release:''}}));
  await reject(['scripts/environments/verify-dist.mjs',app,'prelaunch-trial',dir]);counts.existingArtifactRefusals++;
  await reject(['scripts/deployment/deploy-prelaunch-trial.mjs',app,'--check']);counts.deployCheckRefusals++;
 }
 // Both real production/staging builds, CSP/dist/SEO and negative controls.
 // Customer SEO uses the existing loopback fixture; no external fetch occurs.
 const built=await exec(process.execPath,['scripts/testing/run-environment-builds.mjs'],{cwd:root,env,windowsHide:true,maxBuffer:12*1024**2});
 process.stdout.write(built.stdout);process.stderr.write(built.stderr);
 const read=await readFile(path.join(root,'scripts/environments/prelaunch-trial-control.mjs'),'utf8');assert.match(read,/PRELAUNCH_TRIAL_OPEN=false/u);
 console.log(JSON.stringify({ok:true,closedSource:true,...counts,productionStagingActualBuilds:4,hostedConnections:0,deployments:0}));
}finally{await rm(output,{recursive:true,force:true});}
