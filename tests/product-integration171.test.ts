import {sourceBefore198Presentation} from '../scripts/audit/source-before198-presentation.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {approvedProductEditConflictSource} from './strict-product-legacy-source';
import {assert171History,allUpgrade171Versions} from '../scripts/operations/frankfurt-owner-upgrade171.mjs';
import {assertProduct171Catalog,assertReference171} from '../scripts/operations/frankfurt-reference171.mjs';
import {startupTables} from '../scripts/operations/frankfurt-reference164.mjs';
import {serviceInventory} from '../scripts/audit/service-access-inventory.mjs';
import {inventory} from '../scripts/audit/table-access-inventory.mjs';
import {verifyHistoricalWarehouseCoverage as verifyProbeCoverage} from '../scripts/audit/historical-warehouse-query-sites.mjs';

for(const file of ['src/features/products/ProductFormModal.tsx','src/features/products/ProductDetailModal.tsx','src/stores/useAppStore.ts'])
 test('171 independently pins the ENTIRE pre-change file outside approved hunks: '+file,()=>{
  const before=execFileSync('git',['show','f54af537222e4646fde3727db83bc63c68164586:'+file],{encoding:'utf8'}).replaceAll('\r\n','\n');
  const source=readFileSync(file,'utf8');
  const check=(value:string)=>assert.equal(approvedProductEditConflictSource(file,value),before);
  check(source);
  assert.throws(()=>check(source+'\nvoid 170;\n'),'an extra call/statement OUTSIDE approved hunks cannot be normalized away');
  assert.throws(()=>check(source.replace('expectedUpdatedAt','unexpectedUpdatedAt')),'a changed approved hunk must fail exact occurrence checks');
 });

test('171 history is exactly the approved ordered prefix,no lower-number backfill or unknown/cloud reservations',()=>{
 const base=Array.from({length:138},(_,i)=>String(i+1).padStart(3,'0'));
 for(let n=0;n<=allUpgrade171Versions.length;n++)assert.deepEqual(assert171History([...base,...allUpgrade171Versions.slice(0,n)]),allUpgrade171Versions.slice(n));
 for(const bad of [[...base,'170'],[...base,...allUpgrade171Versions,'172'],[...base,...allUpgrade171Versions.slice(0,-2),'165'],[...base,...allUpgrade171Versions,'180']])
  assert.throws(()=>assert171History(bad));
 assert.throws(()=>assertReference171({format:5,migrationCeiling:164},[],null,null,null,null),/READY171_REFERENCE_REQUIRED/u);
});

test('171 admission rejects client/PUBLIC correction grants,legacy EXECUTE bypass and disabled RLS',()=>{
 const names=['update_product_master_v3','update_product_flavor_v1','product_edit_snapshot_internal','product_edit_assert_version_internal','product_has_cost_history_internal','product_cost_corrections_reject_mutation'];
 const catalog={tables:[...startupTables,'product_cost_corrections'].map(name=>({schema:'public',name,owner:'postgres',rls:true,acl:['postgres=arwdDxtm/postgres'],columns:[{name:'id',acl:[] as string[]}]})),
  functions:names.map(name=>({schema:'public',identity:name+'()',acl:['postgres=X/postgres']}))};
 assertProduct171Catalog(catalog);
 for(const grant of ['anon=r/postgres','authenticated=r/postgres','=r/postgres']){
  const changed=structuredClone(catalog);changed.tables.at(-1)!.acl.push(grant);assert.throws(()=>assertProduct171Catalog(changed));
  const column=structuredClone(catalog);column.tables.at(-1)!.columns[0]!.acl.push(grant);assert.throws(()=>assertProduct171Catalog(column));
 }
 for(const grant of ['authenticated=X/postgres','=X/postgres','anon=X/postgres'])for(let i=0;i<2;i++){
  const changed=structuredClone(catalog);changed.functions[i]!.acl.push(grant);assert.throws(()=>assertProduct171Catalog(changed));
 }
 const changed=structuredClone(catalog);changed.tables.at(-1)!.rls=false;assert.throws(()=>assertProduct171Catalog(changed));
});

test('historical171 real evidence has exact current-source query coverage,no errors,and closed RPC-only correction/legacy writers',async()=>{
 const source=await inventory(),proof=JSON.parse(readFileSync('docs/operations/TABLE_ACCESS_AFTER_171.json','utf8'));
 assert.equal(source.migrationCeiling,208);assert.equal(proof.migrationCeiling,171);assert.equal(proof.managedAccess,false);
 assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.deepEqual(proof.sourceHashes,await sourceBefore198Presentation(source.sources));
 assert.deepEqual(verifyProbeCoverage(source,proof.results),proof.coverage);assert.ok(proof.results.every((r:{sqlstate:string|null})=>r.sqlstate===null));
 assertProduct171Catalog(proof.catalog);
 const services=JSON.parse(readFileSync('docs/operations/SERVICE_ACCESS_DIAGNOSTIC.json','utf8'));
 assert.equal(services.migrationCeiling,208);assert.equal(services.ok,true);
 assert.deepEqual(services.results.filter((r:{sqlstate:string|null})=>r.sqlstate==='42501').map((r:{name:string;appRole:string})=>[r.name,r.appRole]).sort(),[['get_supplier_replacements_page_v1','admin'],['get_supplier_replacements_page_v1','cashier']]);
});

test('all frontend RPC callsites exclude unversioned product writers,not only products.service',async()=>{
 const source=await serviceInventory();
 for(const name of ['update_product_master_v3','update_product_flavor_v1'])assert.ok(!source.functionNames.includes(name),name);
 for(const name of ['update_product_master_v4','update_product_flavor_v2','get_product_cost_state_v1','correct_product_cost_v1'])assert.ok(source.functionNames.includes(name),name);
 const workflow=readFileSync('.github/workflows/quality.yml','utf8');
 assert.match(workflow,/run-frankfurt-upgrade171-runtime.mjs/u);assert.match(workflow,/Require real application table access through198/u);
});

test('both concurrency probes observe the real blocker before allowing A to commit,not a startup-dependent duration',()=>{
 const source=readFileSync('scripts/testing/run-product-edit-conflict-runtime.mjs','utf8');
 assert.equal((source.match(/a\.pid=ANY\(pg_blocking_pids\(b\.pid\)\)/gu)??[]).length,2);
 assert.match(source,/assert.equal\(waiting,1,[\s\S]*?heldA.release\(\)/u);
 assert.match(source,/assert.equal\(flavorWaiting,1,[\s\S]*?flavorA.release\(\)/u);
 assert.doesNotMatch(source,/SELECT pg_sleep\(|fb\.ms>=/u);
});
