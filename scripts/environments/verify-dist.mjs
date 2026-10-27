import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {resolveBuildEnvironment,publicEnvironments,renderEnvironmentHeaders} from './environment.mjs';
const root=path.resolve(import.meta.dirname,'../..');
async function files(dir){const result=[];for(const e of await readdir(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())result.push(...await files(f));else result.push(f);}return result;}
export async function verifyEnvironmentDist({app,environment,dir,allowFixture=false}){
 assert.ok(['admin','customer'].includes(app));const expected=resolveBuildEnvironment({NAWASRAH_DEPLOYMENT_ENV:environment});
 const manifest=JSON.parse(await readFile(path.join(dir,'nawasrah-environment.json'),'utf8'));
 for(const field of ['format','environment','isolated','projectRef','url','key','storeOrigin'])assert.ok(manifest[field]===expected[field],'DIST_ENVIRONMENT_MISMATCH:'+field);
 if(app==='customer')assert.ok(manifest.seoSource==='selected-project'||(allowFixture&&manifest.seoSource==='isolated-fixture'),'DIST_ISOLATED_SEO_NOT_DEPLOYABLE');
 if(environment==='prelaunch-trial')for(const field of ['prelaunchTrial','allowedPreviewBranch','productionDeployAllowed'])assert.ok(manifest[field]===expected[field],'DIST_ENVIRONMENT_MISMATCH:'+field);
 const opposite=publicEnvironments[environment==='staging'?'production':'staging'];let count=0,ownOrigin=false;
 for(const f of await files(dir)){
  const bytes=(await readFile(f)).toString('utf8');count++;assert.ok(!bytes.includes(opposite.projectRef),'DIST_OPPOSITE_PROJECT_ORIGIN:'+path.relative(dir,f));
  assert.ok(!bytes.includes(opposite.key),'DIST_OPPOSITE_PUBLIC_KEY:'+path.relative(dir,f));
  assert.ok(!bytes.includes('__NAWASRAH_SUPABASE_'),'DIST_UNRESOLVED_CSP');
  if(bytes.includes(expected.url)&&f.endsWith('.js'))ownOrigin=true;
 }
 assert.ok(ownOrigin,'DIST_SELECTED_RUNTIME_ORIGIN_REQUIRED');
 const template=await readFile(path.join(root,app==='customer'?'customer-web/public/_headers':'public/_headers'),'utf8');
 assert.equal((await readFile(path.join(dir,'_headers'),'utf8')).replaceAll('\r\n','\n'),renderEnvironmentHeaders(template,expected).replaceAll('\r\n','\n'),'DIST_CSP_CHANGED');
 return {ok:true,app,environment,files:count,oppositeOrigins:0,fixture:manifest.seoSource==='isolated-fixture'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===import.meta.filename){
 const [app,environment,dir]=process.argv.slice(2);console.log(JSON.stringify(await verifyEnvironmentDist({app,environment,dir:path.resolve(dir)})));
}
