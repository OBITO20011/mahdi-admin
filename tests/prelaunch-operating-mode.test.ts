import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {tmpdir} from 'node:os';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createElement,type ComponentType} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import {resolveBuildEnvironment,renderEnvironmentHeaders} from '../scripts/environments/environment.mjs';
import {PRELAUNCH_TRIAL_OPEN} from '../scripts/environments/prelaunch-trial-control.mjs';
import {environmentDefines} from '../scripts/environments/vite-environment.mjs';
import {assertPrelaunchOperatingMode,verifyEnvironmentDist,loadVerificationEnvironment} from '../scripts/environments/verify-dist.mjs';

const root=path.resolve(import.meta.dirname,'..');
const baseline='967036ee26a48e3f3a2439e1d78f3c559fa1617f';
interface Mode {mode:'full'|'sales-only'|'unknown';installed:boolean;verified:boolean;status:string;refresh:()=>Promise<void>}
interface Exports {OperatingModePanel:ComponentType;disableFullAccountingWithClient:(client:object,actor:string)=>Promise<void>;disableFullAccounting:(actor:string)=>Promise<void>}
const full=():Mode=>({mode:'full',installed:true,verified:true,status:'ready',refresh:async()=>{}});
async function compile(environment:'production'|'prelaunch-trial',before=false){
 let reads=0,writes=0;
 const client={auth:{getUser:async()=>{reads++;return{data:{user:{id:'owner'}},error:null};},mfa:{getAuthenticatorAssuranceLevel:async()=>{reads++;return{data:{currentLevel:'aal2'},error:null};}}},rpc:async(name:string,args:unknown)=>{writes++;assert.equal(name,'lite1_set_mode2');assert.deepEqual(JSON.parse(JSON.stringify(args)),{p_full:false});return{data:{fullAccounting:false},error:null};}};
 const context={module:{exports:{}},require:createRequire(import.meta.url),__client:client,__auth:{isAuthenticated:true,user:{id:'owner'},roleName:'owner',roles:['owner']},__mode:full(),
  // Browser/runtime attempts cannot change the selected compile-time environment.
  location:{hostname:'admin.alnawasreh.com',search:'?environment=production'},localStorage:{getItem:()=> 'production'},process:{env:{NAWASRAH_DEPLOYMENT_ENV:'production',VITE_MONITORING_ENV:'production'}}};
 // Closed previews remain unbuildable after #58; only the pure compiler tag is exercised in that case.
 let selected=resolveBuildEnvironment({NAWASRAH_DEPLOYMENT_ENV:'production'});
 if(environment==='prelaunch-trial'){
  if(PRELAUNCH_TRIAL_OPEN)selected=resolveBuildEnvironment({NAWASRAH_DEPLOYMENT_ENV:environment});
  else {assert.throws(()=>resolveBuildEnvironment({NAWASRAH_DEPLOYMENT_ENV:environment}),/PRELAUNCH_TRIAL_CLOSED/u);selected={...selected,environment};}
 }
 const result=await build({stdin:{contents:"export {OperatingModePanel} from './src/features/operatingMode/OperatingModePanel';export {disableFullAccounting,disableFullAccountingWithClient} from './src/services/supabase/operatingModeCommand';",resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',minify:true,logLevel:'silent',external:['react','react/jsx-runtime'],define:environmentDefines(selected),plugins:[{name:'isolated-panel-dependencies',setup(b){
  b.onResolve({filter:/stores\/useAuthStore$/},()=>({path:'auth',namespace:'fixture'}));
  b.onResolve({filter:/operatingModeContext$/},()=>({path:'mode',namespace:'fixture'}));
  b.onResolve({filter:/components\/ui$/},()=>({path:'ui',namespace:'fixture'}));
  b.onResolve({filter:/OpeningEpochPanel$/},()=>({path:'epoch',namespace:'fixture'}));
  b.onResolve({filter:/lib\/supabase$/},()=>({path:'client',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},({path:p})=>({contents:p==='auth'?'export const useAuthStore=()=>globalThis.__auth;':p==='mode'?'export const useOperatingMode=()=>globalThis.__mode;':p==='client'?'export const isSupabaseConfigured=true;export const supabase=globalThis.__client;':p==='ui'?"import {createElement} from 'react';export const UiButton=props=>createElement('button',props);":"import {createElement} from 'react';export const OpeningEpochPanel=()=>createElement('div',{'data-opening-epoch':true});"}));
  if(before)b.onLoad({filter:/(?:OperatingModePanel\.tsx|operatingModeCommand\.ts)$/},({path:p})=>({contents:execFileSync('git',['show',baseline+':'+path.relative(root,p).replaceAll('\\','/')],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}),loader:p.endsWith('.tsx')?'tsx':'ts'}));
 }}]});
 const code=result.outputFiles[0].text;
 vm.runInNewContext(code,context);
 const api=context.module.exports as Exports;
 return {code,api,client,context,counts:()=>({reads,writes}),render:(mode:Mode=full())=>{context.__mode=mode;return renderToStaticMarkup(createElement(api.OperatingModePanel));}};
}

test('prelaunch build shows current mode and reread, with no confirmation, OFF button or opening-epoch controls',async()=>{
 const fixture=await compile('prelaunch-trial');
 for(const mode of [full(),{...full(),mode:'sales-only' as const},{...full(),mode:'unknown' as const,verified:false,status:'loading'}]){
  const html=fixture.render(mode);
  assert.match(html,/وضع التشغيل/u);assert.match(html,/إعادة قراءة وضع التشغيل/u);assert.match(html,/يوم التشغيل فقط/u);assert.match(html,/RESET220/u);
  assert.doesNotMatch(html,/type="checkbox"|إطفاء المحاسبة والمخزون|data-opening-epoch/u);
 }
 assert.doesNotMatch(fixture.code,/lite1_set_mode2/u,'The preview bundle must not retain the mutation RPC');
});

test('prelaunch command refuses direct UI service calls before identity reads or RPCs, regardless of browser values',async()=>{
 const fixture=await compile('prelaunch-trial');
 await assert.rejects(fixture.api.disableFullAccountingWithClient(fixture.client,'owner'),/MODE-01/u);
 await assert.rejects(fixture.api.disableFullAccounting('owner'),/MODE-01/u);
 assert.deepEqual(fixture.counts(),{reads:0,writes:0});
});

test('production after RESET220 keeps the existing full/installed controls and exactly the same markup',async()=>{
 const current=await compile('production'),before=await compile('production',true);
 const html=current.render();assert.match(html,/type="checkbox"/u);assert.match(html,/إطفاء المحاسبة والمخزون/u);assert.doesNotMatch(html,/المعاينة لقراءة/u);
 for(const mode of [full(),{...full(),verified:false},{...full(),installed:false},{...full(),mode:'sales-only' as const},{...full(),mode:'unknown' as const,verified:false}])assert.equal(current.render(mode),before.render(mode));
 assert.match(current.code,/lite1_set_mode2/u);
 await current.api.disableFullAccountingWithClient(current.client,'owner');assert.deepEqual(current.counts(),{reads:3,writes:1});
});

test('dist check rejects the OFF RPC in admin preview artifacts only, without changing production/customer admission',()=>{
 assert.doesNotThrow(()=>assertPrelaunchOperatingMode('admin','prelaunch-trial','read-only status'));
 assert.throws(()=>assertPrelaunchOperatingMode('admin','prelaunch-trial','rpc("lite1_set_mode2")'),/DIST_PRELAUNCH_MODE_MUTATION_FORBIDDEN/u);
 assert.doesNotThrow(()=>assertPrelaunchOperatingMode('admin','production','rpc("lite1_set_mode2")'));
 assert.doesNotThrow(()=>assertPrelaunchOperatingMode('customer','prelaunch-trial','unchanged customer fixture'));
});

test('real verify-dist rejects an injected preview mutation and still accepts production controls',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'nawasrah-preview-mode-dist-'));
 try{
  for(const environment of ['prelaunch-trial','production'] as const){
   if(environment==='prelaunch-trial'&&!PRELAUNCH_TRIAL_OPEN){
    await assert.rejects(verifyEnvironmentDist({app:'admin',environment,dir}),/PRELAUNCH_TRIAL_CLOSED/u);
   }else{
   const selected=loadVerificationEnvironment(environment,root);
   await writeFile(path.join(dir,'nawasrah-environment.json'),JSON.stringify(selected));
   await writeFile(path.join(dir,'_headers'),renderEnvironmentHeaders(readFileSync(path.join(root,'public/_headers'),'utf8'),selected));
   await writeFile(path.join(dir,'app.js'),'const origin='+JSON.stringify(selected.url)+';'+(environment==='production'?'const writer="lite1_set_mode2";':''));
   assert.equal((await verifyEnvironmentDist({app:'admin',environment,dir})).ok,true);
   if(environment==='prelaunch-trial'){
    await writeFile(path.join(dir,'injected.js'),'const writer="lite1_set_mode2";');
    await assert.rejects(verifyEnvironmentDist({app:'admin',environment,dir}),/DIST_PRELAUNCH_MODE_MUTATION_FORBIDDEN/u);
    await rm(path.join(dir,'injected.js'));
   }
   }
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
