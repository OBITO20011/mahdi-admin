// Explicit convenience commands;plain `build` also works with the context env.
import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {resolveBuildEnvironment} from './environment.mjs';
import path from 'node:path';
const [environment,app='admin']=process.argv.slice(2),root=path.resolve(import.meta.dirname,'../..');
assert.ok(['production','staging','prelaunch-trial'].includes(environment),'EXPLICIT_BUILD_ENVIRONMENT_REQUIRED');assert.ok(['admin','customer'].includes(app));
const cwd=app==='customer'?path.join(root,'customer-web'):root;
const env={...process.env,NAWASRAH_DEPLOYMENT_ENV:environment};
resolveBuildEnvironment(env); // Reject closed/invalid contexts before ANY Git operation.
const release=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
if(app==='customer'&&!env.NAWASRAH_STORE_RELEASE_ID)env.NAWASRAH_STORE_RELEASE_ID=release;
if(app==='admin'&&!env.NAWASRAH_ADMIN_RELEASE_ID)env.NAWASRAH_ADMIN_RELEASE_ID=release;
if(environment==='prelaunch-trial'){
 if(app==='admin'){
  const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  assert.match(sha,/^[0-9a-f]{40}$/u,'PRELAUNCH_RELEASE_SHA_REQUIRED');
  if(env.NAWASRAH_ADMIN_RELEASE_ID)assert.equal(env.NAWASRAH_ADMIN_RELEASE_ID,sha,'PRELAUNCH_RELEASE_SHA_MISMATCH');
  env.NAWASRAH_ADMIN_RELEASE_ID=sha;
 }
}
for(const args of [[path.join(root,'node_modules/vite/bin/vite.js'),'build'],...(app==='customer'?[
 ['scripts/generate-seo-pages.mjs'],['scripts/verify-seo-output.mjs'],
]:[])]){
 const result=spawnSync(process.execPath,args,{cwd,env,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1);
}
