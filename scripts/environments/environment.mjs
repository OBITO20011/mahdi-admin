import {PRELAUNCH_TRIAL_OPEN,PRELAUNCH_TRIAL_BRANCH} from './prelaunch-trial-control.mjs';
// Build-only public allowlist. Never import this two-project map in browser code.
import assert from 'node:assert/strict';
export const publicEnvironments=Object.freeze({
 production:{projectRef:'kzevmysfydaslxcerogt',key:'sb_publishable_d4TElxRQFkC-AZko3_ASeg_YotqxGjV',storeOrigin:'https://alnawasreh.com'},
 'prelaunch-trial':{projectRef:'kzevmysfydaslxcerogt',key:'sb_publishable_d4TElxRQFkC-AZko3_ASeg_YotqxGjV',storeOrigin:'https://staging-frankfurt.nawasrah-store.pages.dev'},
 staging:{projectRef:'acjtabdqqnpwhdvbvnyw',key:'sb_publishable_XYq8HBYT6Pxa2VdRdi69CA_012vvfp5',storeOrigin:'https://staging-frankfurt.nawasrah-store.pages.dev'},
});
export function plainLoopback(value){
 try{const u=new URL(value);return u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash;}catch{return false;}
}
export function resolveBuildEnvironment(env){
 if(env.NAWASRAH_DEPLOYMENT_ENV==='prelaunch-trial'){
  assert.equal(PRELAUNCH_TRIAL_OPEN,true,'PRELAUNCH_TRIAL_CLOSED');
  assert.notEqual(env.VITE_BROWSER_QA_ISOLATED,'true','PRELAUNCH_TRIAL_ISOLATED_OVERRIDE_REFUSED');
 }
 const isolated=env.VITE_BROWSER_QA_ISOLATED==='true';
 if(isolated){
  assert.ok(plainLoopback(env.VITE_SUPABASE_URL),'BUILD_ISOLATION_REQUIRES_LOOPBACK');
  const key=env.VITE_SUPABASE_PUBLISHABLE_KEY||env.VITE_SUPABASE_ANON_KEY;assert.ok(key?.length>10,'BUILD_ISOLATION_KEY_REQUIRED');
  return {format:1,environment:'isolated',isolated:true,projectRef:null,url:new URL(env.VITE_SUPABASE_URL).origin,key,
   storeOrigin:'http://127.0.0.1:4174',turnstile:env.VITE_TURNSTILE_SITE_KEY||'1x00000000000000000000AA'};
 }
 const environment=env.NAWASRAH_DEPLOYMENT_ENV;assert.ok(Object.hasOwn(publicEnvironments,environment??''),'EXPLICIT_BUILD_ENVIRONMENT_REQUIRED');
 const selected=publicEnvironments[environment],url=`https://${selected.projectRef}.supabase.co`;
 if(env.VITE_SUPABASE_URL)assert.ok(env.VITE_SUPABASE_URL.replace(/\/+$/u,'')===url,'BUILD_SUPABASE_ENVIRONMENT_MISMATCH');
 for(const name of ['VITE_SUPABASE_PUBLISHABLE_KEY','VITE_SUPABASE_ANON_KEY'])if(env[name])assert.ok(env[name]===selected.key,'BUILD_PUBLIC_KEY_ENVIRONMENT_MISMATCH');
 if(env.VITE_PUBLIC_SITE_ORIGIN)assert.ok(env.VITE_PUBLIC_SITE_ORIGIN.replace(/\/+$/u,'')===selected.storeOrigin,'BUILD_SITE_ENVIRONMENT_MISMATCH');
 if(env.VITE_STOREFRONT_PUBLIC_URL)assert.ok(env.VITE_STOREFRONT_PUBLIC_URL.replace(/\/+$/u,'')===selected.storeOrigin,'BUILD_STORE_LINK_ENVIRONMENT_MISMATCH');
 return {format:1,environment,isolated:false,...(environment==='prelaunch-trial'?{prelaunchTrial:true,allowedPreviewBranch:PRELAUNCH_TRIAL_BRANCH,productionDeployAllowed:false}:{}),projectRef:selected.projectRef,url,key:selected.key,storeOrigin:selected.storeOrigin,
  turnstile:env.VITE_TURNSTILE_SITE_KEY||'0x4AAAAAAEPJTplD4PVe_Cgk'};
}
export function renderEnvironmentHeaders(template,selected){
 assert.equal(template.split('__NAWASRAH_SUPABASE_HTTPS__').length,2,'CSP_HTTPS_PLACEHOLDER_REQUIRED');
 assert.equal(template.split('__NAWASRAH_SUPABASE_WSS__').length,2,'CSP_WSS_PLACEHOLDER_REQUIRED');
 return template.replace('__NAWASRAH_SUPABASE_HTTPS__',selected.url)
  .replace('__NAWASRAH_SUPABASE_WSS__',selected.url.replace(/^http/u,'ws'));
}

export function validatePublicBuildManifest(manifest){
 const expected=resolveBuildEnvironment({NAWASRAH_DEPLOYMENT_ENV:manifest.environment});
 for(const field of ['format','environment','isolated','projectRef','url','key','storeOrigin'])assert.ok(manifest[field]===expected[field],'BUILD_MANIFEST_MISMATCH:'+field);
 if(manifest.environment==='prelaunch-trial')for(const field of ['prelaunchTrial','allowedPreviewBranch','productionDeployAllowed'])assert.ok(manifest[field]===expected[field],'BUILD_MANIFEST_MISMATCH:'+field);
 return manifest;
}
