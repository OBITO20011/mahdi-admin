import {sourceBefore198Presentation} from '../scripts/audit/source-before198-presentation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {inventory} from '../scripts/audit/table-access-inventory.mjs';
import {verifyHistoricalWarehouseCoverage as verifyProbeCoverage} from '../scripts/audit/historical-warehouse-query-sites.mjs';
import {futureMigrationViolations} from '../scripts/testing/maintenance-db-contract.mjs';
const read=(name:string)=>readFileSync(name,'utf8').replaceAll('\r\n','\n');
const file='supabase/migrations/197_canonical_home_customer_receivables.sql';
const sql=read(file),factsName='CREATE OR REPLACE FUNCTION public.phase6_financial_facts_internal(',monitorName='CREATE OR REPLACE FUNCTION public.run_advanced_monitoring_checks(';
const facts=(source:string)=>source.slice(source.indexOf(factsName),source.indexOf('CREATE OR REPLACE FUNCTION public.',source.indexOf(factsName)+factsName.length)).trim();
test('197 changes ONLY the receivables CTE;all other195 facts,JSON equations,roles and grants remain byte-identical',()=>{
 const before=facts(read('supabase/migrations/195_deferred_cheque_readers_and_alerts.sql')),after=facts(sql);
 const startBefore=before.indexOf('  ), opening_due AS ('),endBefore=before.indexOf('  ), cohort AS (',startBefore);
 const startAfter=after.indexOf('  ), eligible AS MATERIALIZED ('),endAfter=after.indexOf('  ), cohort AS (',startAfter);
 assert.ok(startBefore>0&&endBefore>startBefore&&startAfter>0&&endAfter>startAfter);
 assert.equal(after.slice(0,startAfter)+before.slice(startBefore,endBefore)+after.slice(endAfter),before);
 const block=after.slice(startAfter,endAfter);
 assert.match(block,/SELECT id, customer_id, outstanding AS due FROM financial_positions/u);
 assert.match(block,/public\.go_live_customer_opening_positions_internal\(NULL\)/u);assert.match(block,/public\.cheque_customer_claim_positions_internal\(\)/u);
 assert.doesNotMatch(block,/first_completion|order_scope|is_active|is_deleted|outstanding>0/u);
 const legal=read('supabase/migrations/192_cheque_compensation_receivable_readers.sql');
 const ca=legal.indexOf('  WITH eligible AS MATERIALIZED ('),cb=legal.indexOf('  ), active_payments AS MATERIALIZED (',ca);
 assert.ok(ca>0&&cb>ca);
 const canonical=legal.slice(ca,cb).replace('  WITH eligible AS MATERIALIZED (','  ), eligible AS MATERIALIZED (')
  .replace('AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)','AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)');
 assert.equal(block.slice(0,block.indexOf('  ), canonical_order_due AS (')),canonical,'EXACT192_CANONICAL_SET_BASED_CTES_WITH_BRANCH_SCOPE_ONLY');
 for(const source of [block.replaceAll(/\bo\./gu,'customer_order.'),legal]){
  assert.match(source,/customer_order\.status IN \('completed', 'delivered'\)/u);
  assert.match(source,/COALESCE\(customer_order\.source, 'website'\) <> 'pos'/u);
  assert.match(source,/customer_order\.payment_method = 'debt'/u);
 }
 assert.match(block,/o\.customer_id IS NOT NULL/u);assert.match(block,/o\.branch_id = p_branch_id/u);
 assert.match(block,/p_branch_id = public\.go_live_main_branch_internal\(\)/u);
});
test('197 adds only one independent CRITICAL check;every existing194 monitoring call and body remains exact',()=>{
 const original=read('supabase/migrations/194_cheque_shift_and_integrity.sql');
 const before=original.slice(original.indexOf(monitorName),original.lastIndexOf('COMMIT;')).trim();
 const after=sql.slice(sql.indexOf(monitorName),sql.lastIndexOf('COMMIT;')).trim();
 const declarations='\n  v_customer_due BIGINT;\n  v_reported_customer_due BIGINT;';assert.equal(after.split(declarations).length,2);
 const start=after.indexOf('  -- Independent customer-by-customer legal oracle:'),end=after.indexOf('  -- Owner withdrawals:',start);
 assert.ok(start>0&&end>start);
 assert.equal((after.slice(0,start)+after.slice(end)).replace(declarations,''),before);
 const block=after.slice(start,end);
 assert.match(block,/SUM\(public\.phase42_customer_receivable_total_internal\(c\.id\)\)/u);
 assert.match(block,/IS NOT DISTINCT FROM v_customer_due/u);assert.match(block,/'healthy' ELSE 'critical' END,'critical'/u);
 assert.match(block,/v_total_integrity := v_total_integrity \+ v_count/u);
 assert.doesNotMatch(block,/is_active|is_deleted|LIMIT|OFFSET/u);
 assert.match(block,/p_observed_at,'Asia\/Amman',false/u);assert.doesNotMatch(block,/v_settings\.business_timezone/u);
});
test('197 is explicit,read-only readers only,historical196 pin frozen and runtime covers +1 defect and exact7000 regression',()=>{
 assert.deepEqual(futureMigrationViolations(sql),[]);assert.equal([...sql.matchAll(/CREATE OR REPLACE FUNCTION/gu)].length,2);
 assert.doesNotMatch(sql,/CREATE TABLE|CREATE INDEX|INSERT INTO|DELETE FROM|GRANT EXECUTE/u);
 const state=JSON.parse(read('docs/agent/project-state.json'));
 assert.equal(state.migrationCeiling,200);assert.equal(state.migration197CanonicalLfSha256,createHash('sha256').update(sql).digest('hex').toUpperCase());
 //Exactly one empty EOF line was removed after the full-scale proof;every SQL
 //byte,including function bodies,otherwise remains bound to that executed pin.
 assert.equal(createHash('sha256').update(sql+'\n').digest('hex').toUpperCase(),'91C5439275CE8F101D897213BA4C372697900EA5AF8F35BA04F305B05EBF9D48');
 assert.equal(state.migration196CanonicalLfSha256,'E80F31BE94B225C12FAF55BAED8FE5478D7D433B572954F7FB3066F2C5ED211D');
 const runtime=read('scripts/testing/run-canonical-receivables197-runtime.mjs');
 for(const expected of ['beforeHome.summary.customerReceivablesInMinorUnits,7000','afterHome.summary.customerReceivablesInMinorUnits,0',
  "injected.severity,'critical'",'injected.details.differenceInMinorUnits,1','readApplicationFingerprint','assertPackageDDbLint(lint)'])assert.ok(runtime.includes(expected),expected);
 const workflow=read('.github/workflows/quality.yml');assert.match(workflow,/run-canonical-receivables197-runtime\.mjs/u);
});
test('197 genuine current SDK evidence exactly covers all current source sites without new browser grants',async()=>{
 const source=await inventory(),proof=JSON.parse(read('docs/operations/TABLE_ACCESS_AFTER_197.json'));
 assert.equal(source.migrationCeiling,200);assert.equal(proof.migrationCeiling,197);assert.equal(proof.managedAccess,false);
 assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.deepEqual(proof.sourceHashes,await sourceBefore198Presentation(source.sources));
 assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results));assert.ok(proof.results.every((r:{sqlstate:string|null})=>r.sqlstate===null));
});
test('197 full-scale performance preserves existing3s home gate and separately measures actual196/197 balances',()=>{
 const runtime=read('scripts/testing/run-canonical-receivables197-scale.mjs');
 assert.match(runtime,/fullScale,assertCounts,timingSummary/u);assert.match(runtime,/assertCounts\(counts,fullScale\)/u);
 assert.match(runtime,/oracle\.customers,fullScale\.customers/u);assert.match(runtime,/oracle\.mismatches,0/u);
 assert.match(runtime,/phase42_customer_receivable_total_internal\(id\)/u);
 assert.match(runtime,/n<3;n\+\+/u);assert.match(runtime,/n<20;n\+\+/u);assert.match(runtime,/summary\.p95<3000/u);
 assert.match(read('scripts/testing/run-package-e-scale-runtime.mjs'),/name:'home',command:'get_home_dashboard\(\)',limitMs:3000,targetMs:1000/u);
 for(const name of ['before197-home','after197-home','before197-balances-only','after197-balances-only','standaloneBalancesP95DeltaMs','reviewThresholdMs:300'])assert.ok(runtime.includes(name),name);
 assert.match(runtime,/195_deferred_cheque_readers_and_alerts\.sql/u);
 assert.doesNotMatch(runtime,/lateral-baseline|CREATE INDEX|ALTER INDEX/u);
 assert.doesNotMatch(runtime,/smokeScale|process\.argv\.includes|waitForTimeout|retry/iu);
 assert.match(read('.github/workflows/quality.yml'),/run-canonical-receivables197-scale\.mjs/u);
});
