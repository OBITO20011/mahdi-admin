import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const sql=readFileSync('supabase/migrations/133_package_e_supplier_po_financial_consistency.sql','utf8');

test('Supplier correction installs only explicit existing operational functions in one transaction',()=>{
  assert.match(sql,/^BEGIN;/mu);assert.match(sql,/COMMIT;\s*$/u);
  assert.doesNotMatch(sql,/pg_get_functiondef|\bEXECUTE\b|CREATE\s+(?:SCHEMA|TABLE)|CREATE\s+(?:UNIQUE\s+)?INDEX/iu);
  const functions=[...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)\(/gu)].map(match=>match[1]);
  assert.deepEqual(functions,['record_supplier_payment','receive_purchase_order_v2','reverse_supplier_payment',
    'cancel_purchase_receipt_v2','run_advanced_monitoring_checks','_record_supplier_receipt_payment_impl','receive_purchase_order',
    '_get_cash_shift_closing_report_before_snapshot']);
  // There must be no migration-time update/backfill of historical rows.
  const outside=sql.replace(/CREATE OR REPLACE FUNCTION[\s\S]*?\n\$\$;/gu,'');
  assert.doesNotMatch(outside,/\b(?:UPDATE|INSERT|DELETE)\b/iu);
});

test('New SECURITY DEFINER bodies retain pinned owners and the existing internal helper boundary',()=>{
  for(const name of ['record_supplier_payment','receive_purchase_order_v2','reverse_supplier_payment',
    'cancel_purchase_receipt_v2','run_advanced_monitoring_checks','_record_supplier_receipt_payment_impl','receive_purchase_order',
    '_get_cash_shift_closing_report_before_snapshot']) {
    assert.match(sql,new RegExp(`ALTER FUNCTION public\\.${name}\\([^;]+\\) OWNER TO postgres;`,'u'));
  }
  assert.match(sql,/REVOKE ALL ON FUNCTION public\._record_supplier_receipt_payment_impl\([^;]+FROM PUBLIC,anon,authenticated,service_role;/u);
  assert.doesNotMatch(sql,/GRANT\s+(?:ALL|EXECUTE)/iu);
});
