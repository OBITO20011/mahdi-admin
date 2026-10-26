import {sourceBeforePrelaunchTrial} from '../scripts/audit/source-before-prelaunch-trial.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {resolveBuildEnvironment,publicEnvironments,renderEnvironmentHeaders,validatePublicBuildManifest} from '../scripts/environments/environment.mjs';
import {environmentPins,sourceBeforeEnvironments} from '../scripts/audit/source-before-environments.mjs';
test('an explicit environment is mandatory and mismatched public inputs fail without echoing values',()=>{
 for(const env of [{},{NAWASRAH_DEPLOYMENT_ENV:'preview'},{NAWASRAH_DEPLOYMENT_ENV:'staging',VITE_SUPABASE_URL:'https://kzevmysfydaslxcerogt.supabase.co'},
  {NAWASRAH_DEPLOYMENT_ENV:'production',VITE_SUPABASE_ANON_KEY:'unknown-private-value'},
  {VITE_BROWSER_QA_ISOLATED:'true',VITE_SUPABASE_URL:'https://example.invalid',VITE_SUPABASE_ANON_KEY:'isolated-test-value'}]){
  assert.throws(()=>resolveBuildEnvironment(env),(e:Error)=>!e.message.includes('unknown-private-value')&&!e.message.includes('https://example.invalid'));
 }
 for(const environment of ['production','staging'] as const){
  const selected=resolveBuildEnvironment({NAWASRAH_DEPLOYMENT_ENV:environment});assert.equal(selected.projectRef,publicEnvironments[environment].projectRef);
  assert.equal(validatePublicBuildManifest(selected),selected);
  assert.throws(()=>validatePublicBuildManifest({...selected,url:'https://evil.invalid'}));
 }
 assert.equal(resolveBuildEnvironment({VITE_BROWSER_QA_ISOLATED:'true',VITE_SUPABASE_URL:'http://127.0.0.1:4196',VITE_SUPABASE_ANON_KEY:'isolated-test-value'}).environment,'isolated');
});
test('both runtime fallbacks are empty without a compiled context and receive only selected values',()=>{
 for(const file of ['src/config/supabase-public-config.ts','customer-web/src/config/supabase-public-config.ts']){
  const source=readFileSync(file,'utf8');assert.doesNotMatch(source,/supabase\.co|sb_publishable_/u);
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const empty={exports:{}};runInNewContext(code,empty);assert.equal((empty.exports as any).SUPABASE_PUBLIC_CONFIG.SUPABASE_URL,'');
  for(const environment of ['production','staging'] as const){
   const selected=resolveBuildEnvironment({NAWASRAH_DEPLOYMENT_ENV:environment}),context={exports:{},__NAWASRAH_PUBLIC_CONFIG__:{SUPABASE_URL:selected.url,SUPABASE_PUBLISHABLE_KEY:selected.key,TURNSTILE_SITE_KEY:selected.turnstile}};
   runInNewContext(code,context);assert.equal((context.exports as any).SUPABASE_PUBLIC_CONFIG.SUPABASE_URL,selected.url);
  }
 }
});
test('CSP changes only its two explicit selected origins;all directives retain original bytes',()=>{
 for(const file of ['public/_headers','customer-web/public/_headers'])for(const environment of ['production','staging'] as const){
  const template=readFileSync(file,'utf8'),selected=resolveBuildEnvironment({NAWASRAH_DEPLOYMENT_ENV:environment}),headers=renderEnvironmentHeaders(template,selected);
  assert.equal(headers.replace(selected.url,'__NAWASRAH_SUPABASE_HTTPS__').replace(selected.url.replace('https:','wss:'),'__NAWASRAH_SUPABASE_WSS__'),template);
  assert.equal(renderEnvironmentHeaders(template,resolveBuildEnvironment({NAWASRAH_DEPLOYMENT_ENV:'production'})).replaceAll('\r\n','\n'),environmentPins[file].beforeText);
 }
});
test('exact build inverse preserves historical files and still rejects any extra byte',()=>{
 for(const [file,pin] of Object.entries(environmentPins as Record<string,{beforeText:string}>)){
  const source=sourceBeforePrelaunchTrial(file,readFileSync(file,'utf8'))!;assert.equal(sourceBeforeEnvironments(file,source),pin.beforeText);
  assert.throws(()=>sourceBeforeEnvironments(file,source+'\n// unapproved drift'));
 }
});
