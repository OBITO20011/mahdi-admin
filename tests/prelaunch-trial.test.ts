import {prelaunchTrialPins,sourceBeforePrelaunchTrial} from '../scripts/audit/source-before-prelaunch-trial.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolveBuildEnvironment,validatePublicBuildManifest} from '../scripts/environments/environment.mjs';
import {assertProductionContext,assertDeploymentTarget} from '../scripts/environments/deployment-context.mjs';
import {prelaunchUploadArguments} from '../scripts/deployment/deploy-prelaunch-trial.mjs';
test('prelaunch-trial is explicit,Frankfurt-only with preview origin and a nonproduction marker',()=>{
 const x=resolveBuildEnvironment({NAWASRAH_DEPLOYMENT_ENV:'prelaunch-trial'});assert.equal(x.url,'https://kzevmysfydaslxcerogt.supabase.co');
 assert.equal(x.storeOrigin,'https://staging-frankfurt.nawasrah-store.pages.dev');assert.equal(x.prelaunchTrial,true);assert.equal(x.productionDeployAllowed,false);
 assert.equal(validatePublicBuildManifest(x),x);assert.throws(()=>validatePublicBuildManifest({...x,productionDeployAllowed:true}));
 assert.throws(()=>resolveBuildEnvironment({NAWASRAH_DEPLOYMENT_ENV:'prelaunch-trial',VITE_BROWSER_QA_ISOLATED:'true',VITE_SUPABASE_URL:'http://127.0.0.1:4176',VITE_SUPABASE_ANON_KEY:'isolated-test-value'}),/ISOLATED_OVERRIDE_REFUSED/u);
 const staging=resolveBuildEnvironment({NAWASRAH_DEPLOYMENT_ENV:'staging'}),production=resolveBuildEnvironment({NAWASRAH_DEPLOYMENT_ENV:'production'});
 assert.equal(staging.url,'https://acjtabdqqnpwhdvbvnyw.supabase.co');assert.equal(production.url,x.url);assert.equal(production.storeOrigin,'https://alnawasreh.com');
});
test('only the fixed preview project/branch is admitted;production commands refuse trial before any network',()=>{
 for(const app of ['admin','customer']){
  const p=prelaunchUploadArguments([app,'--check']);assert.equal(p.branch,'staging-frankfurt');
  for(const branch of ['main','production','other-preview'])assert.throws(()=>assertDeploymentTarget({app,environment:'prelaunch-trial',branch,project:p.project}));
  for(const args of [[app,'--branch','main'],[app,'--project-name','other'],[app,'--dir','other']])assert.throws(()=>prelaunchUploadArguments(args));
 }
 assert.throws(()=>assertProductionContext({NAWASRAH_DEPLOYMENT_ENV:'prelaunch-trial'}),/PRODUCTION_DEPLOY_CONTEXT_REFUSED/u);
 assert.throws(()=>assertProductionContext({VITE_BROWSER_QA_ISOLATED:'true'}));assertProductionContext({NAWASRAH_DEPLOYMENT_ENV:'production'});
 const env={...process.env,NAWASRAH_DEPLOYMENT_ENV:'prelaunch-trial'};
 for(const file of ['scripts/deployment/deploy-admin.mjs','scripts/environments/assert-production-context.mjs'])assert.throws(()=>execFileSync(process.execPath,[file,'--check'],{env,encoding:'utf8',stdio:'pipe'}),(e:any)=>e.stderr.includes('PRODUCTION_DEPLOY_CONTEXT_REFUSED'));
 const store=JSON.parse(readFileSync('customer-web/package.json','utf8'));assert.ok(store.scripts['deploy:cloudflare'].startsWith('node ../scripts/environments/assert-production-context.mjs && '));
 const control=readFileSync('scripts/environments/prelaunch-trial-control.mjs','utf8');assert.match(control,/export const PRELAUNCH_TRIAL_OPEN=true;/u);assert.doesNotMatch(control,/process\.env/u);
});

test('temporary context inverse preserves every original source byte and rejects drift',()=>{
 for(const [file,pin]of Object.entries(prelaunchTrialPins) as [string,{beforeText:string}][]){
 const raw=readFileSync(file,'utf8');assert.equal(sourceBeforePrelaunchTrial(file,raw),pin.beforeText);assert.throws(()=>sourceBeforePrelaunchTrial(file,raw+'\n// unknown'));
 }
});
