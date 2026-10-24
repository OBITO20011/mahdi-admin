import {sourceBefore198Presentation} from '../scripts/audit/source-before198-presentation.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {allUpgrade182Versions,assert182History,inputs182} from '../scripts/operations/frankfurt-owner-upgrade182.mjs';
import {assertReference182,assertWithdrawals182Catalog} from '../scripts/operations/frankfurt-reference182.mjs';
import {inventory} from '../scripts/audit/table-access-inventory.mjs';
import {verifyHistoricalWarehouseCoverage as verifyProbeCoverage} from '../scripts/audit/historical-warehouse-query-sites.mjs';

test('182 history accepts only the exact ordered approved prefix,not gap backfills or unknown versions',async()=>{
 const base=Array.from({length:138},(_,n)=>String(n+1).padStart(3,'0'));
 for(let n=0;n<=allUpgrade182Versions.length;n++)assert.deepEqual(assert182History([...base,...allUpgrade182Versions.slice(0,n)]),allUpgrade182Versions.slice(n));
 for(const extra of ['140','152','165','172','179','183','190'])assert.throws(()=>assert182History([...base,...allUpgrade182Versions,extra]));
 assert.throws(()=>assert182History([...base,...allUpgrade182Versions.slice(0,-2),'182']));
 assert.throws(()=>assertReference182({format:6,migrationCeiling:171},[],null,null,null,null,null),/READY182_REFERENCE_REQUIRED/u);
 await assert.rejects(()=>inputs182({base171:{manifest:[]},manifest:[]}),/UPGRADE_MANIFEST_MISSING/u);
});
test('182 current real table and service dispatch evidence is complete,and every withdrawal table/sequence is RPC-only',async()=>{
 const source=await inventory(),proof=JSON.parse(await readFile('docs/operations/TABLE_ACCESS_AFTER_182.json','utf8'));
 assert.equal(source.migrationCeiling,213);assert.equal(proof.migrationCeiling,182);assert.equal(proof.managedAccess,false);
 assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.deepEqual(proof.sourceHashes,await sourceBefore198Presentation(source.sources));
 assert.deepEqual(verifyProbeCoverage(source,proof.results),proof.coverage);assert.ok(proof.results.every((r:{sqlstate:string|null})=>r.sqlstate===null));
 assertWithdrawals182Catalog(proof.catalog);
 for(const grant of ['anon=r/postgres','authenticated=r/postgres','=r/postgres']){
  const changed=structuredClone(proof.catalog),table=changed.tables.find((r:{name:string})=>r.name==='owner_cash_withdrawals');
  table.acl=[...(table.acl??[]),grant];assert.throws(()=>assertWithdrawals182Catalog(changed));
 }
 const disabled=structuredClone(proof.catalog);disabled.tables.find((r:{name:string})=>r.name==='owner_cash_withdrawals').rls=false;
 assert.throws(()=>assertWithdrawals182Catalog(disabled));
 const services=JSON.parse(await readFile('docs/operations/SERVICE_ACCESS_DIAGNOSTIC.json','utf8'));
 assert.equal(services.migrationCeiling,213);assert.equal(services.ok,true);
 assert.deepEqual(services.results.filter((r:{sqlstate:string|null})=>r.sqlstate==='42501').map((r:{name:string;appRole:string})=>[r.name,r.appRole]).sort(),['get_supplier_replacements_page_v1','execute_aftercare_supplier_v1','preview_aftercare_supplier_v1','get_aftercare_damage_candidates_v1','get_damage_history_page_v1'].flatMap(name=>['admin','cashier'].map(role=>[name,role])).sort());
});
test('full CI requires the independent withdrawal,whole-day,restore and fresh/incremental upgrade probes',async()=>{
 const source=await readFile('.github/workflows/quality.yml','utf8');
 assert.match(source,/suite: \[[^\]]*owner-withdrawals[^\]]*\]/u);
 for(const runner of ['run-owner-withdrawals-runtime.mjs','run-withdrawals-integration182-runtime.mjs','run-frankfurt-upgrade182-runtime.mjs'])assert.ok(source.includes(runner),runner);
});
