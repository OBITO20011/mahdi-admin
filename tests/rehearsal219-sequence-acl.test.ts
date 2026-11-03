import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sequenceOwnerRepresentationPlan219,sequenceOwnerNames219,matchRehearsalSequenceOwnerAcl219} from '../scripts/testing/rehearsal219-sequence-acl.mjs';
import {compareApplicationAcl} from '../scripts/operations/application-acl-verification.mjs';
import {compareResetCatalog} from '../scripts/operations/reset-catalog-comparison.mjs';
import {restoreResetAcl} from '../scripts/operations/trial-reset-core.mjs';
const catalog=()=>({tables:sequenceOwnerNames219.map(name=>({schema:'public',name,kind:'S',owner:'postgres',acl:['postgres=rwU/postgres']})),functions:[]});
const read=(file:string)=>readFileSync(file,'utf8');
test('only two exact source-owner sequence representations may change;effective ACLs must already match',()=>{
 const source=catalog(),local=structuredClone(source);local.tables.forEach((r:any)=>r.acl=null);
 assert.deepEqual(sequenceOwnerRepresentationPlan219(source,local),sequenceOwnerNames219);
 assert.deepEqual(sequenceOwnerRepresentationPlan219(source,source),[]);
 for(const mutate of [(c:any)=>{c.tables[0].acl.push('anon=r/postgres');},(c:any)=>{c.tables[0].acl=['postgres=r*wU/postgres'];},(c:any)=>{c.tables[0].owner='service_role';},(c:any)=>{c.tables[0].kind='r';},(c:any)=>{c.tables.pop();},(c:any)=>{c.tables.push(c.tables[0]);}]){
  const bad=catalog();mutate(bad);assert.throws(()=>sequenceOwnerRepresentationPlan219(bad,local));assert.throws(()=>sequenceOwnerRepresentationPlan219(source,bad));
 }
});
test('owner final reset comparison stays literal;verify-only equivalence alone does not prove reset readiness',()=>{
 const source=catalog(),nullVariant=structuredClone(source);nullVariant.tables.forEach((r:any)=>r.acl=null);
 assert.equal(compareApplicationAcl(source,nullVariant).differenceCount,0);
 assert.equal(compareResetCatalog(source,nullVariant).length,2);
 assert.deepEqual(restoreResetAcl(source,nullVariant),[]);
 assert.deepEqual(compareResetCatalog(source,structuredClone(source)),[]);
 const altered=catalog();altered.tables[0].acl.push('authenticated=U/postgres');assert.equal(compareResetCatalog(source,altered).length,1);
 const ownerCli=read('scripts/operations/frankfurt-owner-reset219.mjs'),core=read('scripts/operations/trial-reset214-core.mjs');
 assert.match(ownerCli,/await reset219WithExecutor/u);assert.match(core,/writeResetCatalogEvidence\(output,before,after/u);assert.match(core,/RESET_CATALOG_NOT_CLEAN_BUILD/u);
 for(const [file,name]of [['113_configurable_parcel_receiving_and_exact_wac.sql','inventory_movement_mutation_seq'],['190_deferred_cheques_evidence.sql','deferred_cheque_number_seq']]){
  const sql=read('supabase/migrations/'+file);assert.ok(sql.includes('CREATE SEQUENCE public.'+name));assert.ok(sql.includes('ALTER SEQUENCE public.'+name+' OWNER TO postgres;'));assert.ok(sql.includes('REVOKE ALL ON SEQUENCE public.'+name));
 }
});
test('local representation hook rejects arbitrary context and is wired before actual reset baseline only',async()=>{
 await assert.rejects(()=>matchRehearsalSequenceOwnerAcl219({}),/REHEARSAL_VERIFIED_CONTEXT_REQUIRED/u);
 const entry=read('scripts/testing/run-connected-rehearsal219.mjs');assert.ok(entry.indexOf('await step(\'1a.2\'')<entry.indexOf('await step(3,'));
 const source=read('scripts/testing/rehearsal219-sequence-acl.mjs');assert.doesNotMatch(source,/ALTER ROLE|SET ROLE|OWNER TO|REVOKE /u);assert.match(source,/REHEARSAL_SEQUENCE_CHANGED_OTHER_CATALOG_ROLES_OR_DATA/u);
 for(const file of ['scripts/backup/complete-backup.mjs','scripts/operations/frankfurt-owner-reset219.mjs','scripts/operations/trial-reset214-core.mjs'])assert.ok(!read(file).includes('rehearsal219-sequence-acl'));
});
