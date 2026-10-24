import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {handover213Pins,sourceBeforeHandover213,pathsBeforeHandover213} from '../scripts/audit/source-before-handover213.mjs';
import {sourceBeforeOwnerAcl212} from '../scripts/audit/source-before-owner-acl212.mjs';
import {assert213History} from '../scripts/operations/frankfurt-owner-upgrade213.mjs';
const read=(f:string)=>readFileSync(f,'utf8').replaceAll('\r\n','\n'),hash=(s:string)=>createHash('sha256').update(s).digest('hex');
test('Y exact inverse preserves every historical byte and the existing rejection of unknown package mutations',()=>{
 for(const [file,pin]of Object.entries(handover213Pins) as [string,{before:string;after:string;beforeText:string;added?:boolean}][]){const current=read(file);assert.equal(hash(current),pin.after,file);assert.equal(hash(pin.beforeText),pin.before,file);assert.equal(sourceBeforeHandover213(file,current),pin.beforeText,file);if(!pin.added)assert.equal(pin.beforeText,execFileSync('git',['show','703fc51abb6b65ce2df2edcf14c6ecb235b74ddf:'+file],{encoding:'utf8',maxBuffer:8*1024**2}).replaceAll('\r\n','\n'));}
 assert.throws(()=>sourceBeforeOwnerAcl212('package.json',read('package.json')+'\nvoid unreviewed;\n'));
 assert.deepEqual(pathsBeforeHandover213(['supabase/unapproved.sql']),['supabase/unapproved.sql']);
});
test('213 owner upgrade admits only the complete212 or213 prefix,never gaps or backfill',()=>{
 const base=JSON.parse(read('docs/operations/TABLE_ACCESS_AFTER_212.json')).manifest.map((f:string)=>f.slice(0,3)),reference={prefixes:{'212':{appliedVersions:base}},appliedVersions:[...base,'213']};
 assert.deepEqual(assert213History(base,reference),['213']);assert.deepEqual(assert213History(reference.appliedVersions,reference),[]);
 for(const invalid of [base.slice(1),base.slice(0,-1),[...base,'214'],[...base,'213','214'],[...base.slice(0,-1),'213']])assert.throws(()=>assert213History(invalid,reference));
});
test('both application dev entrypoints are loopback by default and LAN is explicit;production excludes tooling',()=>{
 for(const f of ['package.json','customer-web/package.json']){const p=JSON.parse(read(f));assert.match(p.scripts.dev,/127\.0\.0\.1/);assert.match(p.scripts['dev:lan'],/0\.0\.0\.0/);assert.equal(p.devDependencies.vite,'6.4.4');assert.equal(p.dependencies.vite,undefined);assert.equal(p.dependencies.express,undefined);}
 const p=JSON.parse(read('package.json'));for(const name of ['@aws-sdk/client-s3','@google/genai','dotenv','@tailwindcss/vite','@vitejs/plugin-react']){assert.equal(p.dependencies[name],undefined);assert.ok(p.devDependencies[name]);}
});
test('Edge source imports and handler code remain exactly at the merged audit baseline',()=>{
 for(const name of ['manage-staff-users','n8n-alert-feed','send-order-push','admin-ai-assistant','submit-guest-order']){const file='supabase/functions/'+name+'/index.ts';assert.equal(read(file),execFileSync('git',['show','703fc51abb6b65ce2df2edcf14c6ecb235b74ddf:'+file],{encoding:'utf8'}).replaceAll('\r\n','\n'));const config=JSON.parse(read('supabase/functions/'+name+'/deno.json'));assert.equal(config.lock.frozen,true);}
});
