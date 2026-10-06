import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations/128_phase5_operational_payment_and_shift_refund_fixes.sql',
  'utf8',
).replace(/\r\n?/gu, '\n');
const state = JSON.parse(readFileSync('docs/agent/project-state.json', 'utf8')) as {
  migrationCeiling: number;
  migration128CanonicalLfSha256: string;
};

test('Migration 128 is one transaction pinned by the continuity state', () => {
  assert.match(migration, /^BEGIN;/u);
  assert.match(migration, /COMMIT;\s*$/u);
  assert.equal(state.migrationCeiling, 130);
  assert.equal(
    state.migration128CanonicalLfSha256,
    createHash('sha256').update(migration).digest('hex').toUpperCase(),
  );
});

test('C: shift summary and closing report read settled Phase 4.2 refunds', () => {
  assert.match(migration, /RENAME TO _get_cash_shift_summary_before_return_events/u);
  assert.match(migration, /RENAME TO _get_cash_shift_closing_report_before_return_events/u);
  const settledFilters = migration.match(
    /cash_shift_id = p_shift_id\s+AND (?:return_event\.)?settlement_status = 'settled'/gu,
  ) ?? [];
  assert.ok(settledFilters.length >= 2);
  assert.match(migration, /'\{expectedCashInMinorUnits\}'[\s\S]*?- v_cash_refunds/u);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_cash_shift_summary\(UUID\) TO authenticated;/u);
});

test('B: the non-idempotent payment writer is internal only', () => {
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.record_customer_order_payment\(UUID, BIGINT, TEXT, TEXT, TEXT\)\s+FROM PUBLIC, anon, authenticated, service_role;/u,
  );
  assert.doesNotMatch(migration, /GRANT [^;]*record_customer_order_payment\(/u);
});

test('A: same-key payment replay rejects a different request', () => {
  assert.match(migration, /v_existing\.order_id IS DISTINCT FROM p_order_id/u);
  assert.match(migration, /v_existing\.amount_in_minor_units IS DISTINCT FROM p_amount_in_minor_units/u);
  assert.match(migration, /v_existing\.payment_method IS DISTINCT FROM p_payment_method/u);
  assert.match(migration, /PAYMENT_IDEMPOTENCY_CONFLICT/u);
});

const migration129 = readFileSync(
  'supabase/migrations/129_phase5_block_paid_order_receipt_reversal.sql',
  'utf8',
).replace(/\r\n?/gu, '\n');
const state129 = JSON.parse(readFileSync('docs/agent/project-state.json', 'utf8')) as {
  migration129CanonicalLfSha256: string;
};

test('A+: Migration 129 is one transaction pinned by the continuity state', () => {
  assert.match(migration129, /^BEGIN;/u);
  assert.match(migration129, /COMMIT;\s*$/u);
  assert.equal(
    state129.migration129CanonicalLfSha256,
    createHash('sha256').update(migration129).digest('hex').toUpperCase(),
  );
});

test('A+: receipt reversal of a completed non-debt order is rejected at the table', () => {
  assert.match(migration129, /BEFORE UPDATE OF is_reversed ON public\.customer_payments/u);
  assert.match(migration129, /v_status = 'completed'\s+AND COALESCE\(v_payment_method, 'cash_on_delivery'\) <> 'debt'/u);
  assert.match(migration129, /PAYMENT_REVERSAL_PAID_ORDER_UNSUPPORTED/u);
});

test('A+: full-shift preview blocks the same receipts and never suggests a Return', () => {
  assert.match(migration129, /RENAME TO _preview_cash_shift_full_reversal_before_paid_order_guard/u);
  assert.match(migration129, /'canExecute', false/u);
  const messages = migration129.match(/MESSAGE = '[^']*'|'reason', '[^']*'/gu) ?? [];
  assert.ok(messages.length >= 2);
  for (const message of messages) assert.doesNotMatch(message, /مرتجع|Return/u);
});

const migration130 = readFileSync(
  'supabase/migrations/130_phase5_review_followup_shift_refund_guards.sql',
  'utf8',
).replace(/\r\n?/gu, '\n');
const state130 = JSON.parse(readFileSync('docs/agent/project-state.json', 'utf8')) as {
  migration130CanonicalLfSha256: string;
};

test('Migration 130 is one transaction pinned by the continuity state', () => {
  assert.match(migration130, /^BEGIN;/u);
  assert.match(migration130, /COMMIT;\s*$/u);
  assert.equal(
    state130.migration130CanonicalLfSha256,
    createHash('sha256').update(migration130).digest('hex').toUpperCase(),
  );
});

test('H1: cancelling an empty shift also checks Phase 4.2 refund events under the shift lock', () => {
  assert.match(migration130, /RENAME TO _cancel_empty_cash_shift_before_return_events/u);
  assert.match(
    migration130,
    /FROM public\.cash_shifts WHERE id = p_shift_id FOR UPDATE;\s+IF EXISTS \(\s+SELECT 1 FROM public\.sales_return_events\s+WHERE cash_shift_id = p_shift_id\s+AND settlement_status <> 'cancelled'/u,
  );
  assert.match(migration130, /GRANT EXECUTE ON FUNCTION public\.cancel_empty_cash_shift\(UUID, TEXT\) TO authenticated;/u);
});

test('M2: the monitoring function is the 116 body with only the open-shift formula change', () => {
  const source116 = readFileSync(
    'supabase/migrations/116_configurable_parcel_customer_reservation_coordinator.sql',
    'utf8',
  ).replace(/\r\n?/gu, '\n');
  const extract = (sql: string) => {
    const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.run_advanced_monitoring_checks(');
    assert.ok(start >= 0);
    const end = sql.indexOf('\n$$;', start);
    return sql.slice(start, end + 4);
  };
  const original = extract(source116);
  const copied = extract(migration130);
  const before = '  WHERE expected_cash_in_minor_units<>(opening_cash_in_minor_units+cash_sales_in_minor_units+\n'
    + '    cash_receipts_in_minor_units-cash_supplier_payments_in_minor_units-\n'
    + '    cash_expenses_in_minor_units-cash_refunds_in_minor_units)\n';
  const after = "  WHERE (status<>'open' AND expected_cash_in_minor_units<>(opening_cash_in_minor_units+cash_sales_in_minor_units+\n"
    + '    cash_receipts_in_minor_units-cash_supplier_payments_in_minor_units-\n'
    + '    cash_expenses_in_minor_units-cash_refunds_in_minor_units))\n';
  assert.equal(original.split(before).length, 2);
  assert.equal(copied, original.replace(before, after));
});

test('L8: full-shift preview lists settled Phase 4.2 refunds as BLOCKED, without suggesting a Return', () => {
  assert.match(migration130, /'operationType', 'phase42_sales_return'/u);
  assert.match(migration130, /return_event\.settlement_status = 'settled'/u);
  assert.match(migration130, /'canExecute', false/u);
  const reasons = migration130.match(/'reason', '[^']*'/gu) ?? [];
  assert.ok(reasons.length >= 2);
});

test('L7: same-key CliQ replay compares the reference number', () => {
  assert.match(
    migration130,
    /p_payment_method = 'cliq'\s+AND NULLIF\(TRIM\(v_existing\.reference_number\), ''\)\s+IS DISTINCT FROM NULLIF\(TRIM\(p_reference_number\), ''\)/u,
  );
});
