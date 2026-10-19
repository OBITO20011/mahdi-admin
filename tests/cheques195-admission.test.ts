import {sourceBefore198Presentation} from '../scripts/audit/source-before198-presentation.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {assertChequesCatalog,assertChequesReference} from '../scripts/operations/frankfurt-reference-cheques.mjs';
import {inventory} from '../scripts/audit/table-access-inventory.mjs';
import {verifyHistoricalWarehouseCoverage as verifyProbeCoverage} from '../scripts/audit/historical-warehouse-query-sites.mjs';

test('195 reference rejects obsolete ceilings;actual SDK evidence exactly covers current source and no cheque table leaks',async()=>{
  assert.throws(()=>assertChequesReference({format:7,migrationCeiling:182},[],null,null),/READY_CHEQUES_REFERENCE_REQUIRED/u);
  const source=await inventory(),proof=JSON.parse(await readFile('docs/operations/TABLE_ACCESS_AFTER_195.json','utf8'));
  assert.equal(source.migrationCeiling,202);assert.equal(proof.migrationCeiling,195);assert.equal(proof.managedAccess,false);
  assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.deepEqual(proof.sourceHashes,await sourceBefore198Presentation(source.sources));
  assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results));
  assert.ok(proof.results.every((r:{sqlstate:string|null})=>r.sqlstate===null));
  assertChequesCatalog(proof.catalog);
  for(const grant of ['anon=r/postgres','authenticated=r/postgres','=r/postgres']){
    const changed=structuredClone(proof.catalog),table=changed.tables.find((r:{name:string})=>r.name==='deferred_cheques');
    table.acl=[...(table.acl??[]),grant];assert.throws(()=>assertChequesCatalog(changed));
  }
  const disabled=structuredClone(proof.catalog);disabled.tables.find((r:{name:string})=>r.name==='deferred_cheques').rls=false;
  assert.throws(()=>assertChequesCatalog(disabled));
  const exposed=structuredClone(proof.catalog),helper=exposed.functions.find((r:{identity:string})=>r.identity.startsWith('cheque_guard_customer_deletion_internal('));
  assert.ok(helper);helper.acl=[...(helper.acl??[]),'authenticated=X/postgres'];assert.throws(()=>assertChequesCatalog(exposed));
  const workflow=await readFile('.github/workflows/quality.yml','utf8');
  assert.match(workflow,/suite: \[[^\]]*deferred-cheques/u);
  assert.match(workflow,/run-deferred-cheques-runtime\.mjs/u);
  assert.match(workflow,/build-acl-reference-cheques\.mjs/u);
});
