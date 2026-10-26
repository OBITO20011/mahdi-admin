// Four real Vite builds and actual loopback SEO RPCs. No hosted reads.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {verifyEnvironmentDist} from '../environments/verify-dist.mjs';
import {publicEnvironments} from '../environments/environment.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),proofs=[];
for(const environment of ['staging','production'])for(const app of ['admin','customer']){
 const env={...process.env,NAWASRAH_DEPLOYMENT_ENV:environment};
 for(const key of ['VITE_SUPABASE_URL','VITE_SUPABASE_PUBLISHABLE_KEY','VITE_SUPABASE_ANON_KEY','VITE_PUBLIC_SITE_ORIGIN','VITE_STOREFRONT_PUBLIC_URL','VITE_BROWSER_QA_ISOLATED'])delete env[key];
 const args=app==='customer'?['scripts/testing/run-customer-isolated-build.mjs']:['scripts/environments/run-context.mjs',environment,'admin'];
 const r=await exec(process.execPath,args,{cwd:root,env,windowsHide:true,maxBuffer:8*1024**2});process.stdout.write(r.stdout);process.stderr.write(r.stderr);
 const dir=path.join(root,app==='customer'?'customer-web/dist':'dist');
 proofs.push(await verifyEnvironmentDist({app,environment,dir,allowFixture:app==='customer'}));
 const file=path.join(dir,'negative-control.txt'),opposite=publicEnvironments[environment==='staging'?'production':'staging'];
 await writeFile(file,opposite.projectRef);
 try{await assert.rejects(()=>verifyEnvironmentDist({app,environment,dir,allowFixture:true}),/DIST_OPPOSITE_PROJECT_ORIGIN/u);}finally{const {unlink}=await import('node:fs/promises');await unlink(file);}
 if(app==='customer')await assert.rejects(()=>verifyEnvironmentDist({app,environment,dir}),/DIST_ISOLATED_SEO_NOT_DEPLOYABLE/u);
 const headers=path.join(dir,'_headers'),original=await readFile(headers,'utf8');await writeFile(headers,original.replace("object-src 'none'","object-src *"));
 try{await assert.rejects(()=>verifyEnvironmentDist({app,environment,dir,allowFixture:true}),/DIST_CSP_CHANGED/u);}finally{await writeFile(headers,original);}
}
console.log(JSON.stringify({ok:true,hostedAccess:false,builds:proofs,negativeOppositeOrigins:4,negativeCspChanges:4,isolatedSeoDeployRejected:2}));
