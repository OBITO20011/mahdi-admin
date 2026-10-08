import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {fullScale,smokeScale,expectedCounts,assertCounts,expectedFinance,timingSummary} from '../scripts/testing/package-e-scale-contract.mjs';

test('Full scale is the approved two-year volume; smoke cannot stand in for it',()=>{
  assert.deepEqual(expectedCounts(fullScale),{skus:5000,families:200,customers:10000,suppliers:100,
    orders:150000,items:450000,receipts:20000,payments:200000,returns:15000,replacements:5000,shifts:1460,movements:1200000});
  assert.throws(()=>assertCounts(expectedCounts(smokeScale),fullScale));
});
test('p95 uses20 actual timings, not warmups or averages',()=>{
  assert.deepEqual(timingSummary(Array.from({length:20},(_,i)=>20-i)),{p50:10,p95:19,max:20,samples:20});
  assert.throws(()=>timingSummary([1,2,3]));assert.throws(()=>timingSummary(Array(20).fill(NaN)));
});
test('Scale financial expectations come from independent fixture inputs',()=>{
  const facts=expectedFinance(fullScale);
  assert.equal(facts.gross,495000000);assert.equal(facts.entitlement,35000000);assert.equal(facts.net,460000000);
  assert.equal(facts.due,50000000);assert.equal(facts.supplierDue,3000000000);
  assert.equal(facts.inventoryQuantity,6535000);assert.equal(facts.collected,445000000);
});
test('Manual scale preserves isolation, guardrails, real modern RPCs, and rollback-only close preparation',()=>{
  const source=readFileSync('scripts/testing/run-package-e-scale-runtime.mjs','utf8');
  const sql=readFileSync('scripts/testing/package-e-scale-fixture.sql','utf8');
  assert.doesNotMatch(sql,/DISABLE\s+TRIGGER|session_replication_role|DROP\s+INDEX/iu);
  for(const rpc of ['create_pos_sale_v2','settle_sales_replacement_v1','settle_admin_sales_return_v1'])assert.ok(sql.includes(`public.${rpc}`));
  assert.ok(source.includes('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)'));
  assert.ok(source.includes("NAWASRAH_MAX_MIGRATION:'133'"));
  assert.ok(source.includes('await homeParity({sql,root,owner'));
  assert.ok(source.includes("name:'daily-report'"));assert.ok(source.includes("name:'closing-report'"));
  assert.doesNotMatch(source,/process\.exitCode=1;break/u);
  assert.match(source,/result:'UNPROVEN',p50:null,p95:null,max:null/u);
  assert.match(source,/repetition<24/u);assert.match(source,/FOR i IN 1\.\.300/u);
  assert.match(source,/ROLLBACK;/u);assert.match(source,/performanceGate:smoke\?'NOT_APPLICABLE'/u);
  assert.doesNotMatch(readFileSync('.github/workflows/quality.yml','utf8'),/test:package-e:scale/u);
});

test('closing report resolves fixture ID outside authenticated scope without weakening table ACL',()=>{
  const source=readFileSync('scripts/testing/run-package-e-scale-runtime.mjs','utf8');
  assert.match(source,/const closingShift=await json\(`SELECT to_jsonb\(id\) FROM cash_shifts/u);
  assert.ok(source.indexOf('const closingShift=await json')<source.indexOf('const benches=['));
  assert.ok(source.includes('command:`get_cash_shift_closing_report(${q(closingShift)})`'));
  assert.doesNotMatch(source,/get_cash_shift_closing_report\(\(SELECT|GRANT SELECT ON.*cash_shifts/iu);
});
