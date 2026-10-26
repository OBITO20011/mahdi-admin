import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {loadEnv} from 'vite';
import {resolveBuildEnvironment,renderEnvironmentHeaders} from './environment.mjs';
export function selectedViteEnvironment(mode,root){
 // Process values win,as in Vite. A stale local .env cannot select another DB.
 return resolveBuildEnvironment({...loadEnv(process.env.NAWASRAH_DEPLOYMENT_ENV||mode,root,''),...process.env});
}
export function environmentDefines(selected){return {
 __NAWASRAH_PUBLIC_CONFIG__:JSON.stringify({SUPABASE_URL:selected.url,SUPABASE_PUBLISHABLE_KEY:selected.key,TURNSTILE_SITE_KEY:selected.turnstile}),
 'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(selected.url),
 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify(selected.key),
 'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify(selected.key),
 'import.meta.env.VITE_PUBLIC_SITE_ORIGIN':JSON.stringify(selected.storeOrigin),
 'import.meta.env.VITE_STOREFRONT_PUBLIC_URL':JSON.stringify(selected.storeOrigin),
};}
export function environmentAssets(selected,root){return {
 name:'nawasrah-selected-environment',
 async generateBundle(){
  const headers=await readFile(path.join(root,'public/_headers'),'utf8');
  this.emitFile({type:'asset',fileName:'_headers',source:renderEnvironmentHeaders(headers,selected)});
  this.emitFile({type:'asset',fileName:'nawasrah-environment.json',source:JSON.stringify(selected,null,2)+'\n'});
 },
};}
