import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ownerTableNames219,tableOwnerRepresentationPlan219,matchRehearsalTableOwnerAcl219} from '../scripts/testing/rehearsal219-table-acl.mjs';
const fixture=()=>({tables:ownerTableNames219.map(name=>({schema:'public',name,kind:'r',owner:'postgres',acl:['postgres=arwdDxtm/postgres']}))});
test('only the approved30 owner-only representations may change;extra rights or any other shape fail',()=>{
 assert.equal(new Set(ownerTableNames219).size,30);const source=fixture(),local=fixture();local.tables.forEach((r:any)=>r.acl=null);
 assert.deepEqual(tableOwnerRepresentationPlan219(source,local),ownerTableNames219);assert.deepEqual(tableOwnerRepresentationPlan219(source,source),[]);
 for(const mutate of [(x:any)=>x.tables.pop(),(x:any)=>x.tables.push(x.tables[0]),(x:any)=>{x.tables[0].owner='service_role';},(x:any)=>{x.tables[0].acl.push('anon=r/postgres');},(x:any)=>{x.tables[0].acl=['postgres=arwdDxtm*/postgres'];},(x:any)=>{x.tables[0].schema='cron';}]){const bad=fixture();mutate(bad);assert.throws(()=>tableOwnerRepresentationPlan219(bad,local));assert.throws(()=>tableOwnerRepresentationPlan219(source,bad));}
});
test('table representation hook rejects arbitrary target and never enters production/defaultRestore/core',async()=>{
 await assert.rejects(()=>matchRehearsalTableOwnerAcl219({}),/REHEARSAL_VERIFIED_CONTEXT_REQUIRED/u);
 for(const f of ['scripts/backup/complete-backup.mjs','scripts/operations/trial-reset214-core.mjs','scripts/operations/frankfurt-owner-reset219.mjs'])assert.ok(!readFileSync(f,'utf8').includes('rehearsal219-table-acl'));
 const text=readFileSync('scripts/testing/rehearsal219-table-acl.mjs','utf8');assert.match(text,/has_table_privilege/u);assert.match(text,/REHEARSAL_TABLE_SQL_PRIVILEGES_CHANGED/u);assert.doesNotMatch(text,/ALTER ROLE|OWNER TO|REVOKE /u);
});
