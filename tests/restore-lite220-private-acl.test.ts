import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {private220AclTables,capturedLite220PrivateAcl,restoreLite220PrivateAcl} from '../scripts/backup/restore-lite220-private-acl.mjs';
import {postgresDiagnostic} from '../scripts/backup/postgres-diagnostic.mjs';
import {canonicalLf} from '../scripts/testing/maintenance-db-contract.mjs';
import {sourceBeforeRestorePrivate220,restorePrivate220Pins} from '../scripts/audit/source-before-restore-private220.mjs';

const source=()=>({history:['220'],catalog:{
 tables:Object.entries(private220AclTables).flatMap(([schema,names])=>names.map(name=>({schema,name,kind:'r',owner:'postgres',acl:['postgres=arwdDxtm/postgres'] as string[]|null}))),
 schemas:Object.keys(private220AclTables).map(name=>({name,owner:'postgres',acl:['postgres=UC/postgres'] as string[]|null})),
 functions:[{schema:'public',identity:'enforce_customer_for_debt_order()',acl:['=X/postgres','postgres=X/postgres']}],
}});
const unsupported=(error:unknown)=>postgresDiagnostic(error).category==='RESTORE_LITE220_PRIVATE_ACL_UNSUPPORTED';
test('captured13object ACLs are exact and pre220 archives have no private replay',()=>{
 assert.equal(capturedLite220PrivateAcl(source()),true);
 assert.equal(capturedLite220PrivateAcl({history:['219'],catalog:{tables:[],schemas:[]}}),false);
 for(const mutate of [
  (s:ReturnType<typeof source>)=>{s.catalog.tables.pop();},
  (s:ReturnType<typeof source>)=>{s.catalog.tables.push({...s.catalog.tables[0],name:'extra'});},
  (s:ReturnType<typeof source>)=>{s.catalog.schemas.pop();},
  (s:ReturnType<typeof source>)=>{s.catalog.tables[0].acl=null;},
  (s:ReturnType<typeof source>)=>{s.catalog.tables[0].acl=['anon=r/postgres'];},
  (s:ReturnType<typeof source>)=>{s.catalog.schemas[0].acl=['postgres=UC/postgres','anon=U/postgres'];},
  (s:ReturnType<typeof source>)=>{s.catalog.tables[0].owner='other';},
  (s:ReturnType<typeof source>)=>{s.catalog.schemas[0].owner='other';},
  (s:ReturnType<typeof source>)=>{s.catalog.tables[0].kind='v';},
 ]){const s=source();mutate(s);assert.throws(()=>capturedLite220PrivateAcl(s),unsupported);}
});
test('raw replay touches exactly13 ACLs, leaves four-trigger ACLs unchanged and repetition writes nothing',async()=>{
 const before=source(),actual=structuredClone(before.catalog),queries:string[]=[];
 for(const row of [...actual.tables,...actual.schemas])row.acl=null;
 const session={query:async(sql:string)=>{
  queries.push(sql);
  if(sql.includes('WITH namespaces AS'))return JSON.stringify(actual);
  const table=/^GRANT ALL PRIVILEGES ON TABLE (\w+)\.(\w+) TO postgres;$/u.exec(sql);
  const schema=/^GRANT ALL PRIVILEGES ON SCHEMA (\w+) TO postgres;$/u.exec(sql);
  if(table)actual.tables.find(r=>r.schema===table[1]&&r.name===table[2])!.acl=['postgres=arwdDxtm/postgres'];
  if(schema)actual.schemas.find(r=>r.name===schema[1])!.acl=['postgres=UC/postgres'];
  return '';
 }};
 const proof={applicable:true,checked:13,exactRawAcl:true,exceptionsApplied:[]};
 assert.deepEqual(await restoreLite220PrivateAcl(session,before),proof);
 assert.deepEqual(actual,before.catalog);
 assert.equal(queries.filter(q=>q.startsWith('GRANT')).length,13);
 assert.equal(queries.at(-1),'COMMIT;');
 queries.length=0;assert.deepEqual(await restoreLite220PrivateAcl(session,before),proof);
 assert.equal(queries.length,1);assert.ok(queries[0].includes('WITH namespaces AS'));
});
test('invalid source is refused before queries; unknown target grants/owner/objects refuse before writes',async()=>{
 const malformed=source();malformed.catalog.tables[0].acl=['anon=r/postgres'];
 let queries=0;await assert.rejects(restoreLite220PrivateAcl({query:async()=>{queries++;return '';}},malformed),unsupported);assert.equal(queries,0);
 for(const change of ['acl','owner','missing','extra']){
  const actual=source().catalog;
  if(change==='acl')actual.tables[0].acl=['anon=r/postgres'];
  if(change==='owner')actual.schemas[0].owner='other';
  if(change==='missing')actual.tables.pop();
  if(change==='extra')actual.tables.push({...actual.tables[0],name:'extra'});
  const calls:string[]=[];await assert.rejects(restoreLite220PrivateAcl({query:async(sql:string)=>{calls.push(sql);return JSON.stringify(actual);}},source()),unsupported);assert.equal(calls.length,1);
 }
});
test('postcondition mismatch rolls back; no migration,guard,reference or four-trigger implementation changes',async()=>{
 const actual=source().catalog;for(const row of actual.tables)row.acl=null;
 const calls:string[]=[];await assert.rejects(restoreLite220PrivateAcl({query:async(sql:string)=>{calls.push(sql);return JSON.stringify(actual);}},source()),unsupported);
 assert.equal(calls.at(-1),'ROLLBACK;');assert.ok(!calls.includes('COMMIT;'));
 for(const file of ['scripts/backup/restore-frozen220-trigger-acl.mjs','scripts/operations/sales-only220-catalog.mjs','scripts/operations/frankfurt-owner-upgrade222.mjs','scripts/operations/frankfurt-owner-upgrade223.mjs','scripts/operations/frankfurt-owner-upgrade224.mjs','scripts/operations/frankfurt-owner-reset224.mjs','docs/design/sales-only-phase3/catalog220-pins.json']){
  assert.equal(canonicalLf(readFileSync(file,'utf8')),canonicalLf(execFileSync('git',['show','98470d376894623247b7079426a9c29d1bf43f51:'+file],{encoding:'utf8'})),file);
 }
});
test('exact inverse retains beforeText and rejects an unknown byte for every pin',()=>{
 for(const [file,pin] of Object.entries(restorePrivate220Pins)){
  const current=canonicalLf(readFileSync(file,'utf8'));
  assert.equal(sourceBeforeRestorePrivate220(file,current),pin.beforeText,file);
  assert.equal(sourceBeforeRestorePrivate220(file,current+'\nunknown-byte'),current+'\nunknown-byte',file);
 }
});
