import assert from 'node:assert/strict';
import {resolveBuildEnvironment} from './environment.mjs';
import {PRELAUNCH_TRIAL_BRANCH} from './prelaunch-trial-control.mjs';
export function assertProductionContext(env=process.env){
 assert.ok(!env.NAWASRAH_DEPLOYMENT_ENV||env.NAWASRAH_DEPLOYMENT_ENV==='production','PRODUCTION_DEPLOY_CONTEXT_REFUSED');
 assert.notEqual(env.VITE_BROWSER_QA_ISOLATED,'true','PRODUCTION_DEPLOY_ISOLATED_REFUSED');
}
export function assertDeploymentTarget({app,environment,branch,project}){
 assert.ok(['admin','customer'].includes(app),'DEPLOY_APP_INVALID');
 assert.equal(project,app==='admin'?'nawasrah-admin':'nawasrah-store','DEPLOY_PROJECT_INVALID');
 if(environment==='prelaunch-trial'){
  resolveBuildEnvironment({NAWASRAH_DEPLOYMENT_ENV:environment}); // Also rejects an artifact after source closure.
  assert.equal(branch,PRELAUNCH_TRIAL_BRANCH,'PRELAUNCH_TRIAL_PREVIEW_BRANCH_ONLY');
 }else{
  assert.equal(environment,'production','DEPLOY_CONTEXT_REFUSED');assert.equal(branch,'main','PRODUCTION_DEPLOY_BRANCH_REQUIRED');
 }
 return true;
}
