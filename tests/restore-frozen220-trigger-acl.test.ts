import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {capturedFrozen220TriggerAcl,restoreFrozen220TriggerAcl} from '../scripts/backup/restore-frozen220-trigger-acl.mjs';
import {frankfurt220TriggerAcl,frankfurt220RawTriggerAcl} from '../scripts/operations/frozen220-trigger-acl.mjs';
import {postgresDiagnostic} from '../scripts/backup/postgres-diagnostic.mjs';
import {sourceBeforeRestoreFrozen220,restoreFrozen220Pins} from '../scripts/audit/source-before-restore-frozen220.mjs';
import {canonicalLf,sha256} from '../scripts/testing/maintenance-db-contract.mjs';

const rows=()=>frankfurt220TriggerAcl.signatures.map(identity=>({
 schema:'public',identity,owner:'postgres',acl:null as string[]|null,
 definition:'trigger definition '+identity,configuration:['search_path=public, pg_temp'],
}));
const source=(profile:'local'|'frankfurt')=>{
 const functions=rows();
 if(profile==='frankfurt')functions.forEach(row=>{row.acl=[...frankfurt220TriggerAcl.grants];});
 return {catalog:{functions}};
};

test('captured profile accepts exactly four defaults or four literal Frankfurt ACLs and rejects partial/foreign/missing/owner drift',()=>{
 assert.equal(capturedFrozen220TriggerAcl(source('local')),'local');
 assert.equal(capturedFrozen220TriggerAcl(source('frankfurt')),'frankfurt');
 for(const changed of [
  ()=>{const s=source('local');s.catalog.functions[0].acl=[...frankfurt220TriggerAcl.grants];return s;},
  ()=>{const s=source('frankfurt');s.catalog.functions[0].acl=['anon=X/postgres'];return s;},
  ()=>{const s=source('frankfurt');s.catalog.functions[0].acl=[...frankfurt220TriggerAcl.grants].reverse();return s;},
  ()=>{const s=source('local');s.catalog.functions.pop();return s;},
  ()=>{const s=source('frankfurt');s.catalog.functions[0].owner='other';return s;},
 ]){
  assert.throws(()=>capturedFrozen220TriggerAcl(changed()),error=>postgresDiagnostic(error).category==='RESTORE_FROZEN220_TRIGGER_ACL_UNSUPPORTED');
 }
});

test('only four exact GRANTs materialize Frankfurt raw ACLs and local archives perform no writes',async()=>{
 for(const profile of ['local','frankfurt'] as const){
  const before=source(profile),actual=source('local').catalog,queries:string[]=[];
  const session={query:async(sql:string)=>{
   queries.push(sql);
   if(sql.includes('WITH namespaces AS'))return JSON.stringify(actual);
   if(sql.includes('jsonb_agg(p.proacl::text'))return JSON.stringify(Array(4).fill(frankfurt220RawTriggerAcl));
   const match=/^GRANT EXECUTE ON FUNCTION public\.(.+) TO PUBLIC;$/u.exec(sql);
   if(match){const row=actual.functions.find(row=>row.identity===match[1]);assert.ok(row);row.acl=[...frankfurt220TriggerAcl.grants];}
   return '';
  }};
  assert.deepEqual(await restoreFrozen220TriggerAcl(session,before),{profile,checked:4,exactRawAcl:true,exceptionsApplied:[]});
  assert.equal(queries.filter(q=>q.startsWith('GRANT')).length,profile==='local'?0:4);
  assert.equal(queries.includes('COMMIT;'),profile==='frankfurt');
  assert.ok(queries.every(q=>!q.includes('REVOKE')&&!q.includes('UPDATE pg_')));
 }
});

test('invalid source stops before any query and changed restored definitions or partial ACLs stop before writes',async()=>{
 const partial=source('frankfurt');partial.catalog.functions[0].acl=null;
 let calls=0;
 await assert.rejects(restoreFrozen220TriggerAcl({query:async()=>{calls++;return '';}},partial));
 assert.equal(calls,0);
 for(const actual of [
  (()=>{const a=source('local').catalog;a.functions[0].definition+=' changed';return a;})(),
  (()=>{const a=source('local').catalog;a.functions[0].acl=['anon=X/postgres'];return a;})(),
 ]){
  const queries:string[]=[];
  await assert.rejects(restoreFrozen220TriggerAcl({query:async(sql:string)=>{queries.push(sql);return JSON.stringify(actual);}},source('frankfurt')));
  assert.equal(queries.length,1);
 }
});

test('replay refuses a failed postcondition and rolls back without changing comparison or upgrade/reset guards',async()=>{
 const before=source('frankfurt'),queries:string[]=[];
 await assert.rejects(restoreFrozen220TriggerAcl({query:async(sql:string)=>{queries.push(sql);return JSON.stringify(source('local').catalog);}},before));
 assert.equal(queries.at(-1),'ROLLBACK;');
 assert.ok(!queries.includes('COMMIT;'));
 const baseline='43fe6a6f1cd2bd0ff1c9c8f1b0017794d3aa2e57';
 for(const file of ['scripts/testing/backup-restore-contract.mjs','scripts/backup/restore-comparison.mjs',
  'scripts/operations/frankfurt-owner-upgrade222.mjs','scripts/operations/frankfurt-owner-upgrade223.mjs',
  'scripts/operations/frankfurt-owner-upgrade224.mjs','scripts/operations/frozen220-trigger-acl.mjs']){
  assert.equal(canonicalLf(readFileSync(file,'utf8')),canonicalLf(execFileSync('git',['show',baseline+':'+file],{encoding:'utf8'})),file);
 }
 assert.equal(execFileSync('git',['diff','--name-only',baseline,'--','supabase','scripts/operations'],{encoding:'utf8'}).trim(),'');
});

test('historical inverse preserves beforeText and rejects unknown physical bytes',()=>{
 for(const [file,pin] of Object.entries(restoreFrozen220Pins)){
  const text=canonicalLf(readFileSync(file,'utf8'));
  assert.equal(sha256(text),pin.after,file);
  assert.equal(sourceBeforeRestoreFrozen220(file,text),pin.beforeText,file);
  assert.equal(sourceBeforeRestoreFrozen220(file,text+'\nunknown'),text+'\nunknown',file);
 }
 assert.equal(sourceBeforeRestoreFrozen220('unknown',null),null);
});
