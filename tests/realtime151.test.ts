import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {realtime151Tables,verify151Publication,classify151Frame} from '../scripts/testing/realtime151-contract.mjs';
import {inventory} from '../scripts/audit/table-access-inventory.mjs';

test('151 names exactly the thirteen actual subscribed tables,without grant/RLS/all-tables changes',async()=>{
 const sql=(await readFile('supabase/migrations/151_explicit_application_realtime_publication.sql','utf8')).replace(/--[^\n]*/gu,'');
 const array=sql.match(/FOREACH v_table IN ARRAY ARRAY\[([\s\S]*?)\]/u)?.[1];assert.ok(array);
 assert.deepEqual([...array.matchAll(/'([a-z_]+)'/gu)].map(m=>m[1]),realtime151Tables);
 assert.deepEqual([...new Set((await inventory()).subscriptions.map(s=>s.table))].sort(),[...realtime151Tables].sort());
 assert.match(sql,/pg_catalog\.pg_publication_tables/u);assert.match(sql,/IF NOT EXISTS/u);
 assert.doesNotMatch(sql,/\b(?:GRANT|REVOKE|POLICY|ENABLE ROW|DISABLE ROW|FOR ALL TABLES)\b/iu);
 assert.match(sql,/ALTER PUBLICATION supabase_realtime ADD TABLE public\.%I/u);
 const workflow=await readFile('.github/workflows/quality.yml','utf8');
 assert.match(workflow,/name: Prove151 real Realtime channel delivery and role isolation\r?\n\s+if: matrix.suite == 'package-f-reads'\r?\n\s+run: npm run test:realtime151:runtime/u);
});

test('exact401empty authorization denial is not a row;any data,error drift or unauthorized row still fails',()=>{
 const denied={schema:'public',table:'orders',eventType:'INSERT',errors:['Error 401: Unauthorized'],new:{},old:{}};
 assert.equal(classify151Frame('anon',denied),'denied');
 for(const change of [{...denied,new:{id:'secret'}},{...denied,new:{customer_name_snapshot:'secret'}},
  {...denied,old:{id:'secret'}},{...denied,errors:['Error 403: Forbidden']},{...denied,table:'customers'}])
  assert.throws(()=>classify151Frame('anon',change));
 assert.throws(()=>classify151Frame('noRole',denied));
 const record={...denied,errors:[],new:{id:'92600000-0000-4000-8000-000000000001'}};
 assert.equal(classify151Frame('staff',record),'insert');
 for(const actor of ['noRole','anon'])assert.throws(()=>classify151Frame(actor,record));
 assert.throws(()=>classify151Frame('staff',denied));
});

test('membership contract preserves existing members/options and rejects missing/extra tables',()=>{
 const before={publication:{name:'supabase_realtime',owner:'postgres',allTables:false},tables:[]};
 const after={publication:before.publication,tables:realtime151Tables.map(name=>({schema:'public',name,filter:null}))};
 assert.equal(verify151Publication(before,after).added,13);
 assert.equal(verify151Publication(after,after).added,0);
 assert.throws(()=>verify151Publication(before,{...after,tables:after.tables.slice(1)}));
 assert.throws(()=>verify151Publication(before,{...after,tables:[...after.tables,{schema:'public',name:'audit_logs',filter:null}]}));
 assert.throws(()=>verify151Publication(before,{...after,publication:{...after.publication,owner:'anon'}}));
 assert.throws(()=>verify151Publication({...before,publication:{...before.publication,allTables:true}},after));
});
