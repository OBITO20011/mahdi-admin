import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/078_operational_accounting_integrity.sql',
    import.meta.url
  ),
  'utf8'
);
const customerAccountsService = readFileSync(
  new URL('../src/services/supabase/customerAccounts.service.ts', import.meta.url),
  'utf8'
);
const customerPaymentModal = readFileSync(
  new URL('../src/features/accounts/RecordCustomerPaymentModal.tsx', import.meta.url),
  'utf8'
);
const expensesService = readFileSync(
  new URL('../src/services/supabase/expenses-shifts.service.ts', import.meta.url),
  'utf8'
);
const expensesView = readFileSync(
  new URL('../src/features/expenses/ExpensesView.tsx', import.meta.url),
  'utf8'
);

test('order discounts are allocated deterministically and reduce product profitability', () => {
  assert.match(migration, /ROW_NUMBER\(\) OVER \([\s\S]*allocation_rank/);
  assert.match(migration, /order_discount - SUM\(base_discount\) OVER/);
  assert.match(migration, /line_total - allocated_discount - cogs/);
  assert.match(migration, /allocated_discounts/);
  assert.match(migration, /تعذر توزيع خصومات التقرير بدقة/);
  assert.match(migration, /\{sales,grossProfitInMinorUnits\}/);
  assert.match(migration, /\{sales,netProfitInMinorUnits\}/);
  assert.match(migration, /\{topProducts\}/);
});

test('supplier receipt cancellation is conservative when WAC cannot be safely reversed', () => {
  assert.match(migration, /v_total_on_hand <> v_item\.total_base_units/);
  assert.match(migration, /inventory_movements im/);
  assert.match(migration, /استخدم مرتجع المورد للحفاظ على متوسط التكلفة/);
  assert.match(migration, /RETURN public\._cancel_supplier_receipt_impl/);
});

test('customer payments have a database idempotency boundary and audited reversal', () => {
  assert.match(migration, /idempotency_key TEXT/);
  assert.match(migration, /idx_customer_payments_created_by_idempotency/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /record_customer_order_payment_once/);
  assert.match(migration, /reverse_customer_order_payment/);
  assert.match(migration, /REVERSE_CUSTOMER_PAYMENT/);
  assert.match(migration, /وردية مغلقة/);
  assert.match(customerAccountsService, /record_customer_order_payment_once/);
  assert.match(customerAccountsService, /p_idempotency_key/);
  assert.match(customerPaymentModal, /paymentIdempotencyKey/);
  assert.match(customerPaymentModal, /crypto\.randomUUID/);
});

test('expense reversals preserve audit history and are excluded from live accounting totals', () => {
  assert.match(migration, /is_reversed BOOLEAN NOT NULL DEFAULT false/);
  assert.match(migration, /reverse_operational_expense/);
  assert.match(migration, /REVERSE_OPERATIONAL_EXPENSE/);
  assert.match(migration, /COALESCE\(is_reversed, false\) = false/);
  assert.match(migration, /v_reversed_cash_expenses/);
  assert.match(migration, /_get_cash_shift_closing_report_v1/);
  assert.match(expensesService, /reverseOperationalExpenseInSupabase/);
  assert.match(expensesView, /عكس المصروف مع حفظ السجل/);
  assert.match(expensesView, /expense\.isReversed/);
});

test('cash and CliQ stay separate after an open-shift reversal', () => {
  const summary = migration.match(
    /CREATE OR REPLACE FUNCTION public\.get_cash_shift_summary\(p_shift_id UUID\)[\s\S]*?\$\$;/
  )?.[0] || '';
  assert.match(summary, /v_reversed_cash_receipts/);
  assert.match(summary, /v_reversed_cliq_receipts/);
  assert.match(summary, /v_reversed_cash_expenses/);
  assert.match(summary, /v_reversed_cliq_expenses/);
  assert.match(summary, /\+ v_reversed_cash_expenses\s*- v_reversed_cash_receipts/);
  assert.doesNotMatch(summary, /v_reversed_cliq_receipts\s*\+ v_reversed_cash_expenses/);
});
