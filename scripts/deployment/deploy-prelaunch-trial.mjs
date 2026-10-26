// Owner/authorized publisher only. --check is entirely local and never uploads.
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {assertDeploymentTarget} from '../environments/deployment-context.mjs';
import {verifyEnvironmentDist} from '../environments/verify-dist.mjs';
import {PRELAUNCH_TRIAL_BRANCH} from '../environments/prelaunch-trial-control.mjs';
const root=path.resolve(import.meta.dirname,'../..');
export function prelaunchUploadArguments(args){
 const [app,...rest]=args;assert.ok(['admin','customer'].includes(app),'Usage:deploy-prelaunch-trial.mjs admin|customer [--check]');
 assert.ok(rest.length===0||rest.length===1&&rest[0]==='--check','PRELAUNCH_TRIAL_NO_TARGET_OVERRIDE');
 const project=app==='admin'?'nawasrah-admin':'nawasrah-store';
 assertDeploymentTarget({app,environment:'prelaunch-trial',branch:PRELAUNCH_TRIAL_BRANCH,project});
 return {app,project,branch:PRELAUNCH_TRIAL_BRANCH,check:rest.includes('--check'),dir:path.join(root,app==='admin'?'dist':'customer-web/dist')};
}
export async function preparePrelaunchUpload(args){
 const selected=prelaunchUploadArguments(args);
 const evidence=await verifyEnvironmentDist({app:selected.app,environment:'prelaunch-trial',dir:selected.dir});
 return {...selected,evidence};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const plan=await preparePrelaunchUpload(process.argv.slice(2));
 if(plan.check){console.log(JSON.stringify({ok:true,upload:false,...plan}));}
 else{
  assert.ok(process.env.npm_execpath,'Run this deployment through npm run deploy:prelaunch-trial.');
  // No caller-supplied branch/project/output directory can reach Wrangler.
  const wrangler=path.join(root,'customer-web/node_modules/wrangler/bin/wrangler.js');
  const r=spawnSync(process.execPath,[wrangler,'pages','deploy',plan.dir,
   '--project-name='+plan.project,'--branch='+plan.branch],{cwd:root,stdio:'inherit'});
  if(r.error)throw r.error;if(r.status!==0)process.exit(r.status??1);
 }
}
