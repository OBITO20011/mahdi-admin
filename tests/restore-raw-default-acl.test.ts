import test from 'node:test';
import assert from 'node:assert/strict';
import {captureTypeAcls,typeAclSql,planRawDefaultAcl,restoreRawDefaultAcl} from '../scripts/backup/restore-raw-default-acl.mjs';

const tableAcl=['postgres=arwdDxtm/postgres'];
const source=()=>({catalog:{
 tables:[{schema:'sample',name:'t',kind:'r',owner:'postgres',acl:[...tableAcl],columns:[]},
 {schema:'sample',name:'s',kind:'S',owner:'postgres',acl:['postgres=rwU/postgres'],columns:[]},
 {schema:'sample',name:'v',kind:'v',owner:'postgres',acl:[...tableAcl],columns:[]}],
 schemas:[{name:'sample',owner:'postgres',acl:['postgres=UC/postgres']}],
 functions:[{schema:'sample',identity:'f()',kind:'f',owner:'postgres',acl:['=X/postgres','postgres=X/postgres'],definition:'fixed',configuration:null}],
 defaultPrivileges:[],
},typeAcls:[{schema:'sample',name:'sample_type',kind:'e',owner:'postgres',acl:['=U/postgres','postgres=U/postgres']}]});
const defaults=()=>[
 ...source().catalog.tables.map(row=>({family:'relation',...row,target:(row.kind==='S'?'SEQUENCE ':'TABLE ')+'"sample"."'+row.name+'"'})),
 {family:'schema',schema:'',name:'sample',kind:'n',owner:'postgres',acl:['postgres=UC/postgres'],target:'SCHEMA "sample"'},
 {family:'function',schema:'sample',name:'f()',kind:'f',owner:'postgres',acl:['=X/postgres','postgres=X/postgres'],target:'FUNCTION "sample"."f"()'},
 {family:'type',schema:'sample',name:'sample_type',kind:'e',owner:'postgres',acl:['=U/postgres','postgres=U/postgres'],target:'TYPE "sample"."sample_type"'},
];
const nullTarget=()=>{const result=source();for(const row of [...result.catalog.tables,...result.catalog.schemas,...result.catalog.functions,...result.typeAcls])row.acl=null as unknown as string[];return result;};

test('only a captured explicit native default may replace NULL; all object kinds and legacy coverage are explicit',()=>{
 const plan=planRawDefaultAcl(source(),nullTarget(),defaults());assert.equal(plan.changes.length,6);assert.equal(plan.typeAclCoverage,'captured');
 const legacySource={catalog:source().catalog},legacyTarget={catalog:nullTarget().catalog};
 assert.equal(planRawDefaultAcl(legacySource,legacyTarget,defaults()).typeAclCoverage,'not-captured-in-legacy-archive');
 const nullSource=nullTarget();assert.equal(planRawDefaultAcl(nullSource,nullTarget(),defaults()).changes.length,0);
});

test('raw comparison ignores atom order only; grantor,grant option,duplicates,NULL,owner,kind and object set remain strict',()=>{
 const reordered=source();reordered.catalog.functions[0].acl.reverse();reordered.typeAcls[0].acl.reverse();
 assert.equal(planRawDefaultAcl(source(),reordered,defaults()).changes.length,0);
 for(const change of ['grant','grantor','option','duplicate','owner','kind','missing','extra','source-null']){
  const a=source(),b=source();
  if(change==='grant')b.catalog.functions[0].acl.push('anon=X/postgres');
  if(change==='grantor')b.catalog.functions[0].acl[0]='=X/other';
  if(change==='option')b.catalog.functions[0].acl[0]='=X*/postgres';
  if(change==='duplicate')b.catalog.functions[0].acl.push(b.catalog.functions[0].acl[0]);
  if(change==='owner')b.catalog.tables[0].owner='other';
  if(change==='kind')b.catalog.tables[0].kind='v';
  if(change==='missing')b.catalog.tables.pop();
  if(change==='extra')b.catalog.tables.push({...b.catalog.tables[0],name:'extra'});
  if(change==='source-null')a.catalog.tables[0].acl=null as unknown as string[];
  assert.throws(()=>planRawDefaultAcl(a,b,defaults()),/RESTORE_RAW_ACL_/u,change);
 }
 const custom=source();custom.catalog.tables[0].acl.push('anon=r/postgres');
 assert.throws(()=>planRawDefaultAcl(custom,nullTarget(),defaults()),/UNAPPROVED_DIFFERENCE/u);
});

function sessionFixture(repair=true){
 const actual=nullTarget(),queries:string[]=[];
 const session={query:async(sql:string)=>{
  queries.push(sql);
  if(sql==='SELECT current_user;')return 'supabase_admin';
  if(sql.includes('acldefault('))return JSON.stringify(defaults());
  if(sql===typeAclSql)return JSON.stringify(actual.typeAcls);
  if(sql.includes('WITH namespaces AS'))return JSON.stringify(actual.catalog);
  if(sql.includes('GRANT ALL PRIVILEGES ON')&&repair){
   const row=defaults().find(row=>sql.includes('ON '+row.target+' TO '));assert.ok(row);
   if(row.family==='relation')actual.catalog.tables.find(r=>r.name===row.name)!.acl=[...row.acl];
   if(row.family==='schema')actual.catalog.schemas[0].acl=[...row.acl];
   if(row.family==='function')actual.catalog.functions[0].acl=[...row.acl];
   if(row.family==='type')actual.typeAcls[0].acl=[...row.acl];
  }
  return '';
 }};
 return {actual,queries,session};
}

test('replay reports each repaired kind,checks the raw postcondition,and idempotency issues no grant',async()=>{
 const {session,queries,actual}=sessionFixture();const report=await restoreRawDefaultAcl(session,source());
 assert.equal(report.repaired,6);assert.deepEqual(report.repairedByKind,{table:1,sequence:1,view:1,schema:1,function:1,type:1});
 assert.deepEqual(actual,source());assert.equal(queries.at(-1),'COMMIT;');
 queries.length=0;const repeated=await restoreRawDefaultAcl(session,source());
 assert.equal(repeated.repaired,0);assert.equal(repeated.writeStatements,0);assert.ok(!queries.some(sql=>/(?:^|;)\s*(?:GRANT|REVOKE|ALTER|UPDATE|INSERT|DELETE)\b/iu.test(sql)));
 assert.equal(queries.at(-1),'ROLLBACK;');
});

test('extra source grant or wrong owner refuses before a grant,and failed postcondition rolls back',async()=>{
 for(const bad of ['sourceGrant','owner']){
  const {session,queries,actual}=sessionFixture(),s=source();
  if(bad==='sourceGrant')s.catalog.tables[0].acl.push('anon=r/postgres');else actual.catalog.tables[0].owner='other';
  await assert.rejects(restoreRawDefaultAcl(session,s),/RESTORE_RAW_ACL_/u);assert.ok(!queries.some(sql=>sql.includes('GRANT')));assert.equal(queries.at(-1),'ROLLBACK;');
 }
 const {session,queries}=sessionFixture(false);await assert.rejects(restoreRawDefaultAcl(session,source()),/EXACT_POSTCONDITION/u);
 assert.equal(queries.at(-1),'ROLLBACK;');assert.ok(!queries.includes('COMMIT;'));
});

test('new type evidence is read-only,records actual typacl,and invents no legacy values',async()=>{
 const queries:string[]=[];const types=source().typeAcls;
 assert.deepEqual(await captureTypeAcls({query:async(sql:string)=>{queries.push(sql);return JSON.stringify(types);}}),types);
 assert.deepEqual(queries,[typeAclSql]);assert.match(typeAclSql,/t\.typacl/u);
 assert.doesNotMatch(typeAclSql,/GRANT|REVOKE|ALTER|UPDATE|INSERT|DELETE|CREATE/iu);
});
