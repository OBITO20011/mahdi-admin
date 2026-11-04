import{historicalProductWorkbookSource}from'../scripts/audit/source-before-product-workbook.mjs';
import {PRELAUNCH_TRIAL_OPEN} from '../scripts/environments/prelaunch-trial-control.mjs';
import {prelaunchTrialPins,sourceBeforePrelaunchTrial} from '../scripts/audit/source-before-prelaunch-trial.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolveBuildEnvironment,validatePublicBuildManifest} from '../scripts/environments/environment.mjs';
import {assertProductionContext,assertDeploymentTarget} from '../scripts/environments/deployment-context.mjs';
import {prelaunchUploadArguments} from '../scripts/deployment/deploy-prelaunch-trial.mjs';
test('cutover source switch rejects trial build manifest and every upload target before network',()=>{
 assert.equal(PRELAUNCH_TRIAL_OPEN,false);
 for(const app of ['admin','customer']){
  for(const env of [{NAWASRAH_DEPLOYMENT_ENV:'prelaunch-trial'},{NAWASRAH_DEPLOYMENT_ENV:'prelaunch-trial',PRELAUNCH_TRIAL_OPEN:'true'},{NAWASRAH_DEPLOYMENT_ENV:'prelaunch-trial',VITE_BROWSER_QA_ISOLATED:'true',VITE_SUPABASE_URL:'http://127.0.0.1:4176',VITE_SUPABASE_ANON_KEY:'isolated-test-value'}])assert.throws(()=>resolveBuildEnvironment(env),/PRELAUNCH_TRIAL_CLOSED/u);
  for(const branch of ['main','production','staging-frankfurt'])assert.throws(()=>assertDeploymentTarget({app,environment:'prelaunch-trial',branch,project:app==='admin'?'nawasrah-admin':'nawasrah-store'}),/PRELAUNCH_TRIAL_CLOSED/u);
  assert.throws(()=>prelaunchUploadArguments([app,'--check']),/PRELAUNCH_TRIAL_CLOSED/u);
 }
 assert.throws(()=>validatePublicBuildManifest({environment:'prelaunch-trial'}),/PRELAUNCH_TRIAL_CLOSED/u);
 const staging=resolveBuildEnvironment({NAWASRAH_DEPLOYMENT_ENV:'staging'}),production=resolveBuildEnvironment({NAWASRAH_DEPLOYMENT_ENV:'production'});
 assert.equal(staging.url,'https://acjtabdqqnpwhdvbvnyw.supabase.co');assert.equal(production.url,'https://kzevmysfydaslxcerogt.supabase.co');assert.equal(production.storeOrigin,'https://alnawasreh.com');
 for(const app of ['admin','customer'])assertDeploymentTarget({app,environment:'production',branch:'main',project:app==='admin'?'nawasrah-admin':'nawasrah-store'});
 assert.throws(()=>assertProductionContext({NAWASRAH_DEPLOYMENT_ENV:'prelaunch-trial'}),/PRODUCTION_DEPLOY_CONTEXT_REFUSED/u);assert.throws(()=>assertProductionContext({VITE_BROWSER_QA_ISOLATED:'true'}));assertProductionContext({NAWASRAH_DEPLOYMENT_ENV:'production'});
 const env={...process.env,NAWASRAH_DEPLOYMENT_ENV:'prelaunch-trial'};
 for(const file of ['scripts/deployment/deploy-admin.mjs','scripts/environments/assert-production-context.mjs'])assert.throws(()=>execFileSync(process.execPath,[file,'--check'],{env,encoding:'utf8',stdio:'pipe'}),(e:any)=>e.stderr.includes('PRODUCTION_DEPLOY_CONTEXT_REFUSED'));
 const store=JSON.parse(readFileSync('customer-web/package.json','utf8'));assert.ok(store.scripts['deploy:cloudflare'].startsWith('node ../scripts/environments/assert-production-context.mjs && '));
 const control=readFileSync('scripts/environments/prelaunch-trial-control.mjs','utf8');assert.match(control,/export const PRELAUNCH_TRIAL_OPEN=false;/u);assert.doesNotMatch(control,/process\.env/u);
});

test('temporary context inverse preserves every original source byte and rejects drift',()=>{
 for(const [file,pin]of Object.entries(prelaunchTrialPins) as [string,{beforeText:string}][]){
 const raw=readFileSync(file,'utf8');assert.equal(historicalProductWorkbookSource(sourceBeforePrelaunchTrial,file,raw),pin.beforeText);assert.throws(()=>historicalProductWorkbookSource(sourceBeforePrelaunchTrial,file,raw+'\n// unknown'));
 }
});
