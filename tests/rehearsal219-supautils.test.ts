import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateSupautilsSource219,supautilsConf219,supautilsNames219,configureRehearsalSupautils219} from '../scripts/testing/rehearsal219-supautils.mjs';
const read=(f:string)=>readFileSync(f,'utf8');
const fixture=()=>JSON.parse(read('scripts/testing/fixtures/rehearsal219-supautils.json'));
test('complete literal Supautils evidence requires every string key and refuses missing/extra/incomplete values',()=>{
 const e=fixture(),s=validateSupautilsSource219(e);assert.equal(supautilsNames219.length,19);assert.deepEqual(s,e.settings);
 for(const change of [(x:any)=>{x.complete=false;},(x:any)=>{delete x.settings['supautils.reserved_roles'];},(x:any)=>{x.settings['supautils.extra']='unknown';},(x:any)=>{x.settings['supautils.policy_grants']={postgres:['storage.objects']};},(x:any)=>{x.settings['supautils.hint_roles']='bad\nvalue';},(x:any)=>{x.settings.session_preload_libraries='unsafe';}]){
  const bad=fixture();change(bad);assert.throws(()=>validateSupautilsSource219(bad));
 }
});
test('private config quotes values as data;empty library defaults are omitted and exact runtime comparison remains mandatory',()=>{
 const s=validateSupautilsSource219(fixture()),text=supautilsConf219(s);
 assert.match(text,/session_preload_libraries = 'supautils'/u);assert.doesNotMatch(text,/^shared_preload_libraries =/mu);
 for(const name of ['constrained_extensions','placeholders','placeholders_disallowed_values'])assert.doesNotMatch(text,new RegExp('^supautils\\.'+name+' =','mu'));
 assert.match(supautilsConf219({...s,'supautils.hint_roles':"a'b\\c"}),/hint_roles = 'a''b\\\\c'/u);
 const source=read('scripts/testing/rehearsal219-supautils.mjs');assert.match(source,/deepEqual\(JSON\.parse\(await query\(supautilsSettingsSql219\)\),values/u);
});
test('setup rejects forged context before process/disk access;only test runner owns the hook',async()=>{
 await assert.rejects(()=>configureRehearsalSupautils219({context:{},evidenceFile:'unread',output:'unwritten'}),/REHEARSAL_VERIFIED_CONTEXT_REQUIRED/u);
 const source=read('scripts/testing/rehearsal219-supautils.mjs');
 assert.doesNotMatch(source,/ALTER ROLE|ALTER USER|GRANT |SET ROLE|SET SESSION AUTHORIZATION/u);
 for(const s of ["authority.superuser,false","'supautils.policy_grants':'{}'",'REHEARSAL_POLICY_GRANTS_NEGATIVE_MUST_FAIL','REHEARSAL_SUPAUTILS_CHANGED_CATALOG_ROLES_OR_DATA',"'pg_ctl','-D','/tmp/pgdata'",'REHEARSAL_SOURCE_CUSTOM_SCRIPT_PATH_MISSING'])assert.ok(source.includes(s),s);
 const entry=read('scripts/testing/run-connected-rehearsal219.mjs');assert.ok(entry.indexOf("'source-exact-local-supautils'")<entry.indexOf("'cutover-owner-settings-and-orders-freeze'"));
 assert.match(read('scripts/testing/rehearsal219-lifecycle.mjs'),/await configureRehearsalSupautils219/u);
});
