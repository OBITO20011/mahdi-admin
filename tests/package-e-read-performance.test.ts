import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=(name:string)=>readFileSync(name,'utf8').replace(/\r\n?/gu,'\n');
const migration=read('supabase/migrations/134_package_e_read_performance.sql');

test('134 contains exactly the two approved non-unique operation indexes',()=>{
  const indexes=[...migration.matchAll(/CREATE INDEX (\w+)\s+ON public\.(\w+)\((\w+)\);/gu)];
  assert.deepEqual(indexes.map(m=>m.slice(1)),[
    ['idx_sales_return_items_operation_id','sales_return_items','operation_id'],
    ['idx_sales_replacement_items_operation_id','sales_replacement_items','operation_id'],
  ]);
  assert.equal((migration.match(/CREATE INDEX/gu)??[]).length,2);
  assert.doesNotMatch(migration.replace(/^\s*--.*$/gmu,''),/\bCONCURRENTLY\b|\bGRANT\b|\bREVOKE\b|CREATE TABLE|CREATE TRIGGER|pg_get_functiondef|\bEXECUTE\b/iu);
  assert.match(migration,/^BEGIN;$/mu);assert.match(migration,/COMMIT;\s*$/u);
});

test('explicit home preserves authority/nonfinancial cards and119 exact WAC; drops overwritten history reads',()=>{
  const old=read('supabase/migrations/022_operational_home_dashboard.sql');
  const block=(source:string,start:string,end:string)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
  assert.equal(block(migration,'  PERFORM public.assert_erp_role(','  v_today_start :='),
    block(old,'  PERFORM public.assert_erp_role(','  v_today_start :='));
  assert.equal(block(migration,'  WITH product_stock AS (','  SELECT COALESCE(jsonb_agg(day'),
    block(old,'  WITH product_stock AS (','  SELECT COALESCE(JSONB_AGG(day_row)'));
  assert.match(migration,/ROUND\(COALESCE\(SUM\([\s\S]*COALESCE\(p.wac_cost_in_minor_units_exact, p.cost_price_in_minor_units::NUMERIC\)/u);
  assert.doesNotMatch(migration,/order_status_history|oi\.profit_in_minor_units/u);
  assert.deepEqual([...migration.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/gu)].map(m=>m[1]),
    ['_get_home_dashboard_before133','_get_operational_business_report_before133',
      '_build_business_summary_before133','run_advanced_monitoring_checks']);
  assert.match(migration,/STABLE\nSECURITY DEFINER\nSET search_path = public, pg_temp/u);
});

test('reuse is conditional on a fully contained week; unavailable keeps the old full response',()=>{
  assert.match(migration,/IF v_today_start - INTERVAL '6 days' >= v_month_start THEN/u);
  assert.match(migration,/WHERE \(day->>'date'\)::DATE >= v_business_date - 6/u);
  assert.equal((migration.match(/'Asia\/Amman', false\);/gu)??[]).length,2);
  assert.match(migration,/EXCEPTION WHEN OTHERS THEN[\s\S]*RETURN public\._get_home_dashboard_before_phase6\(\)\s*\|\| jsonb_build_object\('financialFactsStatus', 'unavailable'\)/u);
  assert.ok(migration.indexOf('assert_erp_role')<migration.indexOf('phase6_financial_facts_internal'));
  const proof=read('scripts/testing/package-e-home-parity.mjs');
  assert.match(proof,/old_result::text IS DISTINCT FROM new_result::text/u);
  assert.match(proof,/excludedTimeFields','\[\]'::jsonb/u);
  assert.doesNotMatch(proof,/work_mem|pg_get_functiondef|ALTER SYSTEM/u);
});

test('parity uses equal approved indexes; only a timed-out strict baseline may receive15min',()=>{
  const proof=read('scripts/testing/package-e-home-parity.mjs');
  assert.ok(proof.indexOf('${indexSql}')<proof.indexOf("VALUES('before-available'"));
  assert.match(proof,/:'baseline_error'='57014' AS baseline_timeout/u);
  assert.match(proof,/if :baseline_timeout[\s\S]*SET LOCAL statement_timeout='15min';[\s\S]*capture\('before-available'\)[\s\S]*SET LOCAL statement_timeout='60s';/u);
  assert.equal((proof.match(/SET LOCAL statement_timeout='15min'/gu)??[]).length,1);
  assert.match(proof,/else\s+\\\\quit 3/u);
  assert.match(proof,/'performanceEvidence',false/u);
  assert.match(proof,/sameApprovedIndexes',true/u);
  assert.doesNotMatch(migration.split('CREATE OR REPLACE FUNCTION public.run_advanced_monitoring_checks')[0],
    /statement_timeout|work_mem/u);
  const runner=read('scripts/testing/run-package-e-scale-runtime.mjs');
  assert.match(runner,/q\(seed\?'0':'60s'\)/u);
  assert.doesNotMatch(runner,/15min/u);
});

test('133 supplier wrappers remain; approved134 reads false while historical131 stays strict',()=>{
  const reader=read('supabase/migrations/131_phase6_operational_report_readers.sql');
  const beforeHome=reader.split('CREATE FUNCTION public.get_home_dashboard()')[0];
  assert.match(beforeHome,/'Asia\/Amman',\s+true\s*\)/u);
  assert.match(beforeHome,/v_timezone,\s+true\s*\)/u);
  const outer=read('supabase/migrations/133_package_e_supplier_po_financial_consistency.sql');
  assert.ok(outer.includes('v_result:=public._get_home_dashboard_before133();v_balances:=public.phase133_supplier_balances_internal();'));
  assert.doesNotMatch(migration,/CREATE(?: OR REPLACE)? FUNCTION public\.(?:get_operational_business_report|build_business_summary|phase6_financial_facts_internal)\b/u);
  const reports=migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public._get_operational_business_report_before133'),
    migration.indexOf('CREATE OR REPLACE FUNCTION public.run_advanced_monitoring_checks'));
  assert.match(reports,/'Asia\/Amman',\s+false\s*\)/u);
  assert.match(reports,/v_timezone,\s+false\s*\)/u);
});

test('134 candidate has a fixed fail-closed continuity fingerprint',()=>{
  const expected='D82CF9B53C9B59300D085DEF941A74226090177237DE1E21A0CA7B4BFF84C7CD';
  assert.equal(createHash('sha256').update(migration).digest('hex').toUpperCase(),expected);
  const state=JSON.parse(read('docs/agent/project-state.json'));
  assert.equal(state.migration134CanonicalLfSha256,expected);
  assert.match(read('scripts/agent/preflight.mjs'),/Migration 134 hash missing or mismatch/u);
});
