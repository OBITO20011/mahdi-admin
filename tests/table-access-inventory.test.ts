import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inventory,parseSource,embeddedTables} from '../scripts/audit/table-access-inventory.mjs';
import {evaluateArgument,verifyProbeCoverage} from '../scripts/audit/table-access-probes.mjs';
import {proposedAccess} from '../scripts/audit/table-access-report.mjs';

test('table inventory follows actual AST chains,extensions and every write operation',()=>{
 const value=parseSource('src/example.ts',`const SELECT='id,roles(id)';
 async function load(){let query=client.from('user_roles').select(SELECT);if(active)query=query.eq('user_id',userId);await query.range(0,24);}
 client.from('orders').insert({id});client.from('orders').upsert({id});client.from('orders').update({id}).eq('id',id);client.from('orders').delete().eq('id',id);
 Array.from({length:2});supabase.storage.from('images').upload('x',file);`);
 assert.deepEqual(value.entries.map(e=>e.operation),['select','insert','upsert','update','delete']);
 assert.deepEqual(value.entries[0].extensions.map((e:{method:string})=>e.method),['eq','range']);
 assert.equal(value.entries[0].constants.SELECT,'id,roles(id)');
 assert.equal(value.excluded.length,2);
 assert.deepEqual(embeddedTables('*,user:profiles!fk(id),roles(id),order_items(count),base:units!products_unit_id_fkey(name_ar)'),['order_items','profiles','roles','units']);
 assert.throws(()=>parseSource('src/bad.ts',"client.from(table).select('*')"),/UNRESOLVED_TABLE/u);
 assert.throws(()=>parseSource('src/bad.ts',"client.from('orders').unknown()"),/UNRESOLVED_OPERATION/u);
 assert.deepEqual(parseSource('src/x.ts',"client\r\n.from('orders').select('id')"),parseSource('src/x.ts',"client\n.from('orders').select('id')"));
 assert.throws(()=>parseSource('supabase/functions/unknown/index.ts',"client.from('orders').select('*')"),/UNRESOLVED_EDGE_ROLE/u);
});

test('table inventory retains realtime prerequisites without mistaking RPC or storage for tables',()=>{
 const value=parseSource('src/example.ts',"client.rpc('read_orders');client.on('postgres_changes',{schema:'public',table:'orders',event:'*'},f)");
 assert.equal(value.entries.length,0);assert.equal(value.subscriptions[0].table,'orders');
 assert.equal(value.subscriptions[0].role,'authenticated');
 assert.deepEqual(Array.from(evaluateArgument('instances.map(instance=>instance.id)',{instances:[{id:'synthetic'}]})),['synthetic']);
});

test('real-query coverage rejects missing/duplicate/substituted role and variant probes',()=>{
 const source={entries:[{id:'one',role:'authenticated',extensions:[{}]},{id:'two',role:'service_role',extensions:[]}]};
 const results=[...['owner','admin','cashier'].flatMap(appRole=>['original-chain','with-query-extensions'].map(variant=>({id:'one',appRole,variant}))),
  {id:'two',appRole:'service_role',variant:'original-chain'}];
 assert.equal(verifyProbeCoverage(source,results).actual,7);
 assert.throws(()=>verifyProbeCoverage(source,results.slice(1)),/INCOMPLETE_QUERY_PROBE_COVERAGE/u);
 assert.throws(()=>verifyProbeCoverage(source,[...results,results[0]]),/DUPLICATE_QUERY_PROBE/u);
 assert.throws(()=>verifyProbeCoverage(source,[{...results[0],id:'unknown'},...results.slice(1)]),/INCOMPLETE_QUERY_PROBE_COVERAGE/u);
 assert.throws(()=>verifyProbeCoverage({entries:[]},[]),/EMPTY_QUERY_INVENTORY/u);
});

test('checked-in access inventory exactly covers current production-source queries (not a fixed count)',async()=>{
 const actual=await inventory(),stored=JSON.parse(await readFile('docs/operations/TABLE_ACCESS_INVENTORY.json','utf8'));
 assert.deepEqual(stored,actual,'Rerun the inventory and real-role diagnostic when source changes;do not silently omit a query');
 const evidence=JSON.parse(await readFile('docs/operations/TABLE_ACCESS_DIAGNOSTIC.json','utf8'));
 assert.equal(evidence.managedAccess,false);assert.equal(evidence.migrationCeiling,138);assert.equal(evidence.infrastructureOk,true);
 assert.deepEqual(evidence.sourceHashes,actual.sources);
 for(const e of actual.entries){const rows=evidence.results.filter((r:{id:string})=>r.id===e.id);
  assert.ok(rows.length>0,`NO_REAL_QUERY_EVIDENCE:${e.id}`);
  assert.deepEqual([...new Set(rows.map((r:{appRole:string})=>r.appRole))].sort(),e.role==='service_role'?['service_role']:['admin','cashier','owner']);
  assert.ok(rows.every((r:{sqlstate:string|null})=>r.sqlstate!=='PGRST125'),'Invalid local gateway routing is NOT ACL evidence');
 }
 const proposal=proposedAccess(actual,evidence);
 assert.equal(proposal.filter(p=>p.role==='anon').length,0);
 assert.equal(proposal.find(p=>p.table==='business_operations')?.action,'KEEP_EXISTING_COLUMN_GRANTS');
 assert.ok(evidence.results.some((r:{sqlstate:string|null})=>r.sqlstate==='42501'),'Current reference is NOT application-ready;do not mislabel the diagnostic as readiness');
});

test('diagnostic uses real HTTP/local roles,no temporary grants or managed credentials',async()=>{
 const runner=await readFile('scripts/audit/run-table-access-diagnostic.mjs','utf8'),probes=await readFile('scripts/audit/table-access-probes.mjs','utf8');
 assert.match(runner,/NAWASRAH_MAX_MIGRATION:String\(ceiling\)/u);
 assert.match(runner,/process\.argv\.includes\('--require-access'\)\?182/u);
 assert.match(runner,/Number\(option\('--migration-ceiling'\)\|\|/u,'Explicit historical proofs must retain their own labelled ceiling');
 assert.match(runner,/ONLY_APPROVED_AUDIT_CEILINGS/u);assert.match(runner,/EXACT_APPROVED_HISTORY_REQUIRED/u);
 assert.match(runner,/SET LOCAL ROLE/u);assert.match(runner,/request\.jwt\.claims/u);
 assert.match(runner,/--require-access/u);assert.match(runner,/FAILED_DIRECT_TABLE_ACCESS/u);
 assert.doesNotMatch(runner,/\bGRANT\s+(?:SELECT|ALL)|supabase\.co|readFile\([^\n]*\.env/u);
 assert.match(probes,/builder\.retry\(false\)/u);assert.match(probes,/return fetch\(target,init\)/u);
 assert.match(probes,/LOCAL_ONLY/u);
});

test('post150 evidence covers every current query,role and variant and accepts no database/gateway errors',async()=>{
 const source=await inventory(),evidence=JSON.parse(await readFile('docs/operations/TABLE_ACCESS_AFTER_150.json','utf8'));
 assert.equal(evidence.migrationCeiling,150);assert.equal(evidence.managedAccess,false);
 assert.equal(evidence.infrastructureOk,true);assert.equal(evidence.applicationReady,true);
 assert.deepEqual(evidence.sourceHashes,source.sources);
 assert.deepEqual(verifyProbeCoverage(source,evidence.results),evidence.coverage);
 assert.ok(evidence.results.every((r:{sqlstate:string|null})=>r.sqlstate===null));
 assert.deepEqual(evidence.manifest.filter((n:string)=>Number(n.slice(0,3))>=139),['139_project_order_push_webhook_url.sql','150_explicit_application_table_read_privileges.sql']);
});
