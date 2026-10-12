import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const sql=readFileSync('supabase/migrations/138_package_f_customer_statement.sql','utf8');
test('statement138 is explicit read-only existing-evidence authority with canonical equality',()=>{
  assert.match(sql,/CREATE FUNCTION public\.get_customer_statement\(/u);
  assert.match(sql,/STABLE\s+SECURITY DEFINER\s+SET search_path = public, pg_temp/u);
  assert.match(sql,/ARRAY\['owner', 'admin', 'manager', 'accountant', 'sales'\]/u);
  assert.match(sql,/ALTER FUNCTION public\.get_customer_statement\(UUID, INTEGER, INTEGER\) OWNER TO postgres/u);
  assert.match(sql,/FROM PUBLIC, anon/u);assert.match(sql,/TO authenticated/u);
  assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE TABLE|CREATE INDEX|pg_get_functiondef|EXECUTE)\b(?! ON)/u);
  assert.match(sql,/phase42_customer_receivable_total_internal\(p_customer_id\)/u);
  assert.match(sql,/IF v_evidence_total IS DISTINCT FROM v_canonical/u);
  assert.match(sql,/CUSTOMER_STATEMENT_EVIDENCE_MISMATCH/u);
  for(const type of ['sale_debt','payment','payment_reversal','return_debt_reduction','sale_reversal'])assert.ok(sql.includes(`'${type}'`));
});
test('statement exposes stable chronology,undated marker,page opening balance and bounded newest-first pages',()=>{
  assert.match(sql,/occurred_at NULLS FIRST, movement_id COLLATE "C"/u);
  assert.match(sql,/ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW/u);
  assert.match(sql,/LEAST\(COALESCE\(p_page_size, 25\), 100\)/u);
  assert.match(sql,/ORDER BY sequence DESC/u);
  assert.match(sql,/balance_in_minor_units - debit_in_minor_units \+ credit_in_minor_units/u);
  assert.match(sql,/تاريخ غير متاح/u);assert.match(sql,/Asia\/Amman/u);
  assert.doesNotMatch(sql,/COALESCE\([^\n]*created_at/u);
});
test('statement runtime includes real sale/payment/Return/reversal and every full fixture customer',()=>{
  const runner=readFileSync('scripts/testing/run-customer-statement-runtime.mjs','utf8');
  for(const name of ['create_pos_sale_v2','record_customer_order_payment_once','settle_admin_sales_return_v1',
    'reverse_customer_order_payment','phase42_customer_receivable_total_internal'])assert.ok(runner.includes(name));
  assert.match(runner,/ids\.length,10000/u);assert.match(runner,/timing\.p95<1000/u);
  assert.match(runner,/assert\.deepEqual\(await fingerprint\(\),before/u);
  assert.match(runner,/page_opening_balance_in_minor_units,pages\[1\]\.page_closing_balance_in_minor_units/u);
  assert.match(readFileSync('.github/workflows/quality.yml','utf8'),/npm run test:package-f:statement/u);
});
