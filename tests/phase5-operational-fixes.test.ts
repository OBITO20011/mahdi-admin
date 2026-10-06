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
  assert.equal(state.migrationCeiling, 129);
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
