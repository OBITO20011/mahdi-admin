import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {compareResetCatalog,writeResetCatalogEvidence,resetCatalogDiagnostic} from '../scripts/operations/reset-catalog-comparison.mjs';
import {catalogDifference} from '../scripts/testing/schema-catalog.mjs';
const fixture=()=>({tables:[{schema:'realtime',name:'messages_2026_10_31',kind:'r',
  partition:"FOR VALUES FROM ('2026-10-31 00:00:00') TO ('2026-11-01 00:00:00')",
  parents:[{schema:'realtime',name:'messages'}],owner:'supabase_admin',acl:['authenticated=r/supabase_admin'],rls:true,
  columns:[{name:'payload',type:'jsonb',notNull:false,acl:null}]},
  {schema:'public',name:'products',kind:'r',partition:null,parents:[],owner:'postgres',
    acl:['postgres=arwdDxt/postgres'],rls:true,columns:[{name:'id',type:'uuid',acl:null}]}],
  indexes:[{schema:'realtime',table:'messages_2026_10_31',name:'messages_2026_10_31_pkey',definition:'CREATE UNIQUE INDEX messages_2026_10_31_pkey ON realtime.messages_2026_10_31 USING btree (id)'}],
  functions:[{schema:'public',identity:'f()',owner:'postgres',acl:null,definition:'SELECT 1'}],
  schemas:[{name:'public',owner:'postgres',acl:['postgres=UC/postgres']}],extensions:[]});
test('retained SAME database catalog across midnight compares literally without shifting its existing partitions',()=>{
  const a=fixture(),b=structuredClone(a);
  assert.ok(catalogDifference(a,b,{beforeBuildDate:'2026-10-31',afterBuildDate:'2026-11-01'}).length>0,'Reproduce old false positive');
  assert.deepEqual(compareResetCatalog(a,b),[]);
  assert.deepEqual(a,b,'Comparator must not mutate captures');
});
test('midnight correction still rejects every real platform/public ACL,partition,owner,column,function,index change',()=>{
  const a=fixture();
  const mutate=[(b:typeof a)=>{b.tables[0].acl=[];},(b:typeof a)=>{b.tables[1].acl.push('anon=r/postgres');},
    (b:typeof a)=>{b.tables[0].owner='postgres';},(b:typeof a)=>{b.tables[0].columns[0].type='text';},
    (b:typeof a)=>{b.tables[0].partition='FOR VALUES FROM (MINVALUE) TO (MAXVALUE)';},
    (b:typeof a)=>{b.tables[0].name='messages_2026_11_01';},(b:typeof a)=>{b.tables.pop();},
    (b:typeof a)=>{b.functions[0].definition='SELECT 2';},(b:typeof a)=>{b.indexes[0].definition+=' WHERE true';}];
  for(const change of mutate){const b=fixture();change(b);assert.ok(compareResetCatalog(a,b).length>0);}
});
test('real owner reset217 and resumed rebuild use the same literal comparator as historical CI reset',async()=>{
  const read=(p:string)=>readFile(new URL('../'+p,import.meta.url),'utf8');
  const owner=await read('scripts/operations/frankfurt-owner-reset217.mjs');
  assert.match(owner,/mode==='resume'/u);assert.match(owner,/await reset217WithExecutor\(/u);
  for(const name of ['scripts/operations/trial-reset-core.mjs','scripts/operations/trial-reset214-core.mjs']){
    const source=await read(name);assert.match(source,/writeResetCatalogEvidence\(output,before,after/u);
    assert.match(source,/captureResetFailureEvidence/u);
    assert.doesNotMatch(source,/catalogDifference\(canonicalResetAcl\(before\)/u);
  }
  const session=await read('scripts/operations/reset214-session.mjs');
  assert.match(session,/compareResetCatalog\(saved\.catalog,catalog\)/u);
});
test('diagnostic captures retain every object and difference while secrets are redacted only in output',async()=>{
  const output=await mkdtemp(path.join(tmpdir(),'nawasrah-reset-midnight-unit-')),a=fixture(),b=fixture();
  b.tables[1].acl.push('anon=r/postgres');
  const differences=await writeResetCatalogEvidence(output,a,b,{stage:'synthetic-failure'});
  assert.equal(differences.length,1);
  assert.deepEqual(JSON.parse(await readFile(path.join(output,'reset-catalog-differences.json'),'utf8')),differences);
  assert.deepEqual(JSON.parse(await readFile(path.join(output,'reset-catalog-before.json'),'utf8')),a);
  const token='123456789:'+ 'x'.repeat(35),jwt='eyJ'+ 'a'.repeat(30)+'.'+'b'.repeat(30)+'.'+'c'.repeat(30);
  const safe=resetCatalogDiagnostic({definition:`SELECT '${token}', '${jwt}'`});
  assert.ok(!JSON.stringify(safe.catalog).includes(token));assert.ok(!JSON.stringify(safe.catalog).includes(jwt));
  assert.equal(safe.redactedFields.length,1);assert.match(safe.redactedFields[0].sha256,/^[a-f0-9]{64}$/u);
});
