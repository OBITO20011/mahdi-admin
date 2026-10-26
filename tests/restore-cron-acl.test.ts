import test from 'node:test';
import assert from 'node:assert/strict';
import {planCronSequenceAcl,restoreCronSequenceAcl} from '../scripts/backup/restore-cron-acl.mjs';
import {buildRestoreComparison} from '../scripts/backup/restore-comparison.mjs';
import {postgresDiagnostic} from '../scripts/backup/postgres-diagnostic.mjs';

const extension={name:'pg_cron',version:'1.6.4',owner:'supabase_admin',schema:'pg_catalog'};
const rows=()=>['jobid_seq','runid_seq'].map(name=>({schema:'cron',name,kind:'S',owner:'supabase_admin',acl:['supabase_admin=rwU/supabase_admin','postgres=rwU*/supabase_admin','service_role=rw/supabase_admin']}));
const source=()=>({catalog:{extensions:[extension],tables:rows()},roles:[{name:'supabase_admin'},{name:'postgres'},{name:'service_role'}]});
const actual=()=>rows().map(r=>({...r,acl:null as string[]|null,extension:'pg_cron',extensionVersion:'1.6.4',extensionOwner:'supabase_admin',extensionSchema:'pg_catalog'}));
test('plan replays exact captured sequence privileges,including grant option;no initpriv or catalog UPDATE',()=>{
 const plan=planCronSequenceAcl(source(),actual());assert.equal(plan.length,2);
 for(const entry of plan){assert.match(entry.sql,/SET LOCAL ROLE "supabase_admin"/u);assert.match(entry.sql,/GRANT USAGE .* TO "postgres" WITH GRANT OPTION/u);assert.doesNotMatch(entry.sql,/UPDATE pg_|pg_init_privs|public\./u);}
 const matched=actual();matched.forEach((r,i)=>{r.acl=source().catalog.tables[i].acl;});assert.deepEqual(planCronSequenceAcl(source(),matched),[]);
});
test('both objects must be real pg_cron sequence members with exact owners/version before first write',async()=>{
 for(const mutate of [
  (r:any)=>{r[1].extension=null;},(r:any)=>{r[1].extension='pg_net';},
  (r:any)=>{r[1].extensionVersion='1.5.2';},(r:any)=>{r[1].owner='postgres';},
  (r:any)=>{r[1].extensionOwner='postgres';},(r:any)=>{r[1].extensionSchema='public';},
  (r:any)=>{r[1].kind='r';},(r:any)=>{r[1].schema='public';},
  (r:any)=>{r[1].acl=['service_role=r/postgres'];},(r:any)=>{r.pop();},
 ]){const rows=actual();mutate(rows);const queries:string[]=[];await assert.rejects(restoreCronSequenceAcl({query:async(text:string)=>{queries.push(text);return JSON.stringify(rows);}},source()),e=>postgresDiagnostic(e).category==='RESTORE_CRON_SEQUENCE_ACL_UNSUPPORTED');assert.equal(queries.length,1,'must validate second object before BEGIN or REVOKE');}
});
test('transaction postcondition is strict and rollback occurs on a failed exact replay',async()=>{
 const queries:string[]=[];await assert.rejects(restoreCronSequenceAcl({query:async(text:string)=>{queries.push(text);return text.includes('jsonb_agg')?JSON.stringify(actual()):'';}},source()),e=>postgresDiagnostic(e).stage==='restore-cron-sequence-acl');
 assert.equal(queries[1],'BEGIN;');assert.equal(queries.at(-1),'ROLLBACK;');assert.ok(!queries.includes('COMMIT;'));
});
test('null default ACL,explicit empty ACL and PUBLIC grants are replayed without widening',()=>{
 const b=source();b.catalog.tables[0].acl=[];b.catalog.tables[1].acl=['=r/supabase_admin'];const p=planCronSequenceAcl(b,actual());assert.equal(p.length,2);assert.doesNotMatch(p[0].sql,/GRANT /u);assert.match(p[1].sql,/GRANT SELECT .* TO PUBLIC/u);
 assert.deepEqual(planCronSequenceAcl({catalog:{extensions:[]},roles:[]},[]),[]);
 assert.throws(()=>planCronSequenceAcl({catalog:{extensions:[]},roles:[]},actual()),/UNEXPECTED_OBJECTS/u);
});
test('comparison does not ignore ACL drift in cron,public tables or any other sequence',()=>{
 const before={...source(),tables:{},memberships:[],history:['214'],sequences:[],storage:[]};
 before.catalog.tables.push({...rows()[0],schema:'public',name:'test_table',kind:'r'}, {...rows()[0],name:'other_seq'});
 for(const index of [0,1,2,3]){const after=structuredClone(before);after.catalog.tables[index].acl=['=r/supabase_admin'];const result=buildRestoreComparison(before,after);assert.equal(result.ok,false);assert.deepEqual(result.failedComparisons,['RESTORE_CATALOG_ACL_OWNER_SETTINGS_DIFFER']);assert.deepEqual(result.catalog[0].fields,['acl']);}
});
