import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const sql=readFileSync('supabase/migrations/133_package_e_supplier_po_financial_consistency.sql','utf8');

test('Owner133 correction uses explicit functions and audited one-time balance repair in one transaction',()=>{
  assert.match(sql,/^BEGIN;/mu);assert.match(sql,/COMMIT;\s*$/u);
  assert.doesNotMatch(sql,/pg_get_functiondef|^\s*EXECUTE\b|CREATE\s+(?:SCHEMA|TABLE)|CREATE\s+(?:UNIQUE\s+)?INDEX/imu);
  const functions=[...sql.matchAll(/CREATE(?: OR REPLACE)? FUNCTION public\.([a-z0-9_]+)\(/gu)].map(match=>match[1]);
  assert.deepEqual(functions,['_record_supplier_payment_impl','record_supplier_payment','receive_purchase_order_v2',
    '_reverse_supplier_payment_before_phase4_lock','_cancel_purchase_receipt_v2_before_phase4_lock',
    'phase133_legacy_po_payables_internal','phase133_supplier_balance_evidence_internal','run_advanced_monitoring_checks','_record_supplier_receipt_payment_impl',
    '_get_cash_shift_closing_report_before_snapshot','reverse_supplier_payment','cancel_purchase_receipt_v2',
    '_cancel_supplier_receipt_before_phase4_lock','_cancel_supplier_receipt_impl','receive_purchase_order',
    'create_direct_supplier_receipt','phase133_supplier_balances_internal','get_operational_business_report',
    'build_business_summary','get_home_dashboard','_preview_cash_shift_full_reversal','preview_supplier_receipt_cancellation']);
  const outside=sql.replace(/CREATE(?: OR REPLACE)? FUNCTION[\s\S]*?AS\s+\$\$[\s\S]*?\$\$;/gu,'');
  assert.doesNotMatch(outside,/\b(?:UPDATE|DELETE)\s+(?:public\.)?(?:products|supplier_receipts|purchase_receipts|business_operations|supplier_payments)\b/iu);
  assert.match(outside,/UPDATE public\.suppliers SET current_balance_in_minor_units=v\.new_balance/u);
  assert.match(outside,/RECALCULATE_SUPPLIER_BALANCE_133/u);
  assert.match(outside,/'old_balance_in_minor_units',v\.old_balance,'new_balance_in_minor_units',v\.new_balance/u);
});

test('Historical PO exception requires exact per-item coverage; partial/mismatched receipts retain recorded cost and review evidence',()=>{
  assert.match(sql,/actual\.purchase_order_item_id=expected\.id\)<>1/u);
  for(const column of ['product_id','received_quantity','unit_cost_in_minor_units']) assert.match(sql,new RegExp(`actual\\.${column} IS DISTINCT FROM expected\\.`,'u'));
  assert.match(sql,/CASE WHEN exact_full THEN total_in_minor_units ELSE recorded END/u);
  assert.match(sql,/adjusted AND NOT exact_full/u);
  assert.match(sql,/'legacy_po_manual_review'/u);
  assert.doesNotMatch(sql,/LEGACY_PO_INVOICE_ALLOCATION_UNPROVEN/u);
  const query=readFileSync('scripts/sql/package-e-legacy-po-review.sql','utf8');
  assert.match(query,/BEGIN READ ONLY/u);assert.doesNotMatch(query,/\b(?:UPDATE|INSERT|DELETE|ALTER|CREATE)\b/iu);
});

test('New SECURITY DEFINER bodies retain pinned owners and the existing internal helper boundary',()=>{
  for(const name of [...sql.matchAll(/CREATE(?: OR REPLACE)? FUNCTION public\.([a-z0-9_]+)\(/gu)].map(match=>match[1])) {
    assert.match(sql,new RegExp(`ALTER FUNCTION public\\.${name}\\([^;]*\\) OWNER TO postgres;`,'u'));
  }
  assert.match(sql,/REVOKE ALL ON FUNCTION public\._record_supplier_receipt_payment_impl\([^;]+FROM PUBLIC,anon,authenticated,service_role;/u);
  const grants=[...sql.matchAll(/GRANT EXECUTE ON FUNCTION public\.([a-z0-9_]+)\(/gu)].map(match=>match[1]);
  assert.deepEqual(grants,['get_operational_business_report','build_business_summary','get_home_dashboard','preview_supplier_receipt_cancellation']);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\._record_supplier_payment_impl\([^;]+FROM PUBLIC,anon,authenticated,service_role;/u);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\._record_supplier_payment_idempotency_legacy\([^;]+FROM PUBLIC,anon,authenticated,service_role;/u);
});

test('PO payment caps share locked PO evidence and supplier advances are not clamped or netted',()=>{
  assert.match(sql,/v_active_paid\+p_amount_in_minor_units > v_actual_payable/u);
  assert.match(sql,/GREATEST\(v_po\.total_in_minor_units::NUMERIC,/u);
  assert.match(sql,/SUM\(r\.supplier_invoice_payable_total_snapshot_in_minor_units::NUMERIC\)/u);
  assert.match(sql,/RECALCULATE_PO_PAYMENTS_133/u);
  assert.equal([...sql.matchAll(/SUPPLIER_PO_PAYMENT_EXCEEDS_PAYABLE:/gu)].length,2);
  assert.match(sql,/FILTER\(WHERE current_balance_in_minor_units>0\)/u);
  assert.match(sql,/FILTER\(WHERE current_balance_in_minor_units<0\)/u);
  const legacy=sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public._cancel_supplier_receipt_impl('),sql.indexOf('-- Explicit V1 creation guards.'));
  assert.doesNotMatch(legacy,/GREATEST/iu);
  assert.match(legacy,/current_balance_in_minor_units\s*-\s*\(\s*v_receipt\.total_in_minor_units\s*-\s*v_payments_amount_reversed\s*\)/u);
  assert.match(sql,/public\.phase4_lock_supplier_context_internal\(NULL,NULL,p_supplier_payment_id\)/u);
  assert.match(sql,/WHEN query_canceled/u);assert.match(sql,/'salesDetailStatus','unavailable'/u);
  assert.match(sql,/SELECT order_id,MAX\(created_at\)/u);
});
