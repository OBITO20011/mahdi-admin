// Explicit convenience commands;plain `build` also works with the context env.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const [environment,app='admin']=process.argv.slice(2),root=path.resolve(import.meta.dirname,'../..');
assert.ok(['production','staging'].includes(environment),'EXPLICIT_BUILD_ENVIRONMENT_REQUIRED');assert.ok(['admin','customer'].includes(app));
const cwd=app==='customer'?path.join(root,'customer-web'):root;
const env={...process.env,NAWASRAH_DEPLOYMENT_ENV:environment};
for(const args of [[path.join(root,'node_modules/vite/bin/vite.js'),'build'],...(app==='customer'?[
 ['scripts/generate-seo-pages.mjs'],['scripts/verify-seo-output.mjs'],
]:[])]){
 const result=spawnSync(process.execPath,args,{cwd,env,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1);
}
