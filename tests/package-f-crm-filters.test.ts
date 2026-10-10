import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {normalizeDebtCtes} from '../scripts/testing/crm-debt-cte-contract.mjs';
const read=(file:string)=>readFileSync(file,'utf8');
const sql=read('supabase/migrations/137_package_f_crm_financial_filters.sql');

test('137 explicitly replaces only the existing STABLE CRM reader with the existing roles and ACL',()=>{
  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION/gu)||[]).length,1);
  assert.match(sql,/STABLE\s+SECURITY DEFINER\s+SET search_path = public, pg_temp/u);
  const body=sql.match(/AS \$\$([\s\S]+?)\$\$;/u)?.[1];assert.ok(body);
  assert.doesNotMatch(body,/\b(?:INSERT INTO|UPDATE|DELETE FROM|EXECUTE|pg_get_functiondef|CREATE TABLE)\b/u);
  assert.doesNotMatch(sql,/_get_crm|RENAME TO|CREATE INDEX|MATERIALIZED VIEW/u);
  assert.match(sql,/ALTER FUNCTION public\.get_crm_customer_page\([^;]+OWNER TO postgres/u);
  assert.match(sql,/REVOKE ALL[^;]+FROM PUBLIC, anon/u);
  assert.match(sql,/GRANT EXECUTE[^;]+TO authenticated/u);
  const old=read('supabase/migrations/085_admin_customer_receivables_and_scalability.sql');
  const oldRoles=old.match(/ARRAY\[\s*'owner', 'admin', 'manager', 'accountant', 'cashier', 'sales',[\s\S]+?\]/u)?.[0];
  assert.ok(oldRoles);assert.ok(sql.includes(oldRoles));
});

test('137 financial filters precede paging and use the existing canonical balance/FIFO evidence',()=>{
  assert.match(sql,/c\.customer_type = 'wholesale'/u);
  assert.match(sql,/public\.phase42_customer_receivable_total_internal\(pc\.id\)/u);
  assert.match(sql,/e\.settlement_status = 'settled' AND e\.contract_version = 401/u);
  assert.match(sql,/ORDER BY completed_at NULLS FIRST, id/u);
  assert.match(sql,/CASE WHEN completed_at IS NOT NULL THEN GREATEST/u);
  assert.match(sql,/WHERE age_days > 30/u);
  assert.doesNotMatch(sql,/o\.created_at|creation\.created_at/u);
  assert.match(sql,/credit_limit_in_minor_units > 0/u);
  assert.match(sql,/OFFSET v_offset LIMIT v_page_size/u);
  assert.match(sql,/\(SELECT COUNT\(\*\)::INTEGER FROM customer_directory\)/u);
});

test('137 balance/FIFO/date CTE semantics exactly match the immutable136 contract',()=>{
  const canonical=normalizeDebtCtes(read('supabase/migrations/136_package_f_customer_debt_aging.sql'));
  assert.deepEqual(normalizeDebtCtes(sql,{directory:true}),canonical);
  const fingerprint=createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  assert.equal(fingerprint,'b10571bcb9f11ed66e1bd63e988f4be40be9a812e0984b56eec592d0263a2a72');
  for(const [original,mutation] of [['principal - outstanding','principal + outstanding'],
    ['NOT p.is_reversed','p.is_reversed'],["'orderId'","'order id'"],['NULLS FIRST','NULLS LAST']]){
    assert.ok(sql.includes(original));
    assert.notDeepEqual(normalizeDebtCtes(sql.replaceAll(original,mutation),{directory:true}),canonical);
  }
  assert.deepEqual(normalizeDebtCtes(sql.replace(/\n/gu,'\r\n'),{directory:true}),canonical);
});

test('137 permanent proofs retain literal old JSON,per-identity full paging,roles and full-size p95 gate',()=>{
  const runtime=read('scripts/testing/run-package-f-crm-filters-runtime.mjs');
  for(const name of ['literalParity','JSON.stringify(before[n])','membership','manualProof','completeFilterIds','fullScaleOracle','phase42_customer_receivable_total_internal',
    'get_customer_debt_aging','READ ONLY','fingerprint','fullScale','timingSummary','row.p95<1000'])assert.ok(runtime.includes(name),name);
  assert.match(runtime,/\[401,403,404,405,406\]/u);
  assert.match(runtime,/\[401,405\]/u);
  assert.match(runtime,/assert\.deepEqual\(actual,\[\.\.\.expected\[filter\]\]\.sort\(\)/u);
  assert.match(runtime,/public\.get_customer_debt_aging\(c\.id\)/u);
  assert.match(read('.github/workflows/quality.yml'),/run: npm run test:package-f:crm-filters/u);
});
