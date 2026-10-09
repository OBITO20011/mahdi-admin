import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=(name:string)=>readFileSync(new URL(`../${name}`,import.meta.url),'utf8');
const sql=read('supabase/migrations/136_package_f_customer_debt_aging.sql');

test('136 is one explicit read-only reader with current receivables roles and authority',()=>{
  assert.equal((sql.match(/CREATE FUNCTION/gu)||[]).length,1);
  assert.match(sql,/get_customer_debt_aging\(p_customer_id UUID DEFAULT NULL\)/u);
  assert.match(sql,/STABLE\s+SECURITY DEFINER\s+SET search_path = public, pg_temp/u);
  assert.match(sql,/ARRAY\['owner', 'admin', 'manager', 'accountant', 'sales'\]/u);
  assert.match(sql,/ALTER FUNCTION public\.get_customer_debt_aging\(UUID\) OWNER TO postgres/u);
  assert.match(sql,/REVOKE ALL[^;]+FROM PUBLIC, anon/u);
  assert.match(sql,/GRANT EXECUTE[^;]+TO authenticated/u);
  const body=sql.match(/AS \$\$([\s\S]+?)\$\$;/u)?.[1];assert.ok(body);
  assert.doesNotMatch(body,/\b(?:INSERT INTO|UPDATE|DELETE FROM|pg_get_functiondef|EXECUTE|CREATE TABLE|CREATE INDEX)\b/u);
});

test('136 derives canonical outstanding,proved completion and unknown-first display FIFO',()=>{
  assert.match(sql,/FROM public\.sales_return_events e JOIN eligible o ON o\.id = e\.order_id/u);
  assert.match(sql,/SUM\(e\.debt_reduction_amount_in_minor_units\)::BIGINT/u);
  assert.match(sql,/e\.settlement_status = 'settled' AND e\.contract_version = 401/u);
  assert.match(sql,/GREATEST\(o\.total_in_minor_units - o\.amount_paid_in_minor_units\s+- COALESCE\(d\.amount, 0\), 0\)::BIGINT/u);
  assert.match(sql,/WHERE principal > 0/u);
  assert.doesNotMatch(sql,/FROM public\.phase42_order_financial_position_internal\(/u);
  assert.match(sql,/o\.status IN \('completed', 'delivered'\)/u);
  assert.match(sql,/COALESCE\(o\.source, 'website'\) <> 'pos' OR o\.payment_method = 'debt'/u);
  assert.match(sql,/h\.new_status = 'completed'/u);
  assert.match(sql,/request_identity_snapshot->>'order_id' = o\.id::TEXT/u);
  assert.match(sql,/creation\.result_snapshot->>'orderId' = o\.id::TEXT/u);
  assert.doesNotMatch(sql,/o\.created_at|creation\.created_at/u);
  assert.match(sql,/ORDER BY completed_at NULLS FIRST, id/u);
  assert.match(sql,/AT TIME ZONE 'Asia\/Amman'/u);
  for(const predicate of ['BETWEEN 0 AND 7','BETWEEN 8 AND 30','> 30','IS NULL'])assert.ok(sql.includes(`age_days ${predicate}`));
  assert.match(sql,/WHERE remaining > 0 AND age_days IS NULL/u);
  assert.match(sql,/WHERE days_over_30_in_minor_units > 0/u);
  assert.match(sql,/LIMIT 50/u);
});

test('set-based136 is checked against immutable original behavior and private canonical oracle for every fixture customer',()=>{
  const runtime=read('scripts/testing/run-package-f-debt-aging-runtime.mjs');
  assert.ok(runtime.includes('before-customers.json'));assert.ok(runtime.includes('after-customers.json'));
  assert.ok(runtime.includes('phase42_customer_receivable_total_internal(c.id)'));
  assert.match(runtime,/assert\.deepEqual\(after,before,/u);
  assert.match(runtime,/assert\.equal\(ids\.length,fullScale\.customers\)/u);
  assert.ok(runtime.includes('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)'));
  assert.ok(runtime.includes('7DF9954B678154D66231174AC5A79864E8B051D705D3D0A1E3A4B9E19A6A8083'));
});

test('136 permanent runtime proves real writers,content fingerprints,all roles and complete scale',()=>{
  const runtime=read('scripts/testing/run-package-f-debt-aging-runtime.mjs');
  for(const name of ['create_pos_sale_v2','record_customer_order_payment_once','settle_admin_sales_return_v1',
    'phase42_customer_receivable_total_internal','get_crm_customer_page','fingerprint','READ ONLY','aclexplode','fullScale','timingSummary'])assert.ok(runtime.includes(name),name);
  assert.match(runtime,/\[7,'00:00:00',0\].+\[31,'00:00:00',2\]/u);
  assert.ok(read('.github/workflows/quality.yml').includes('npm run test:package-f:aging'));
});
