import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migration120Path = new URL(
  '../supabase/migrations/120_phase4_returns_refunds_foundation.sql',
  import.meta.url,
);
const migration121Path = new URL(
  '../supabase/migrations/121_phase42_atomic_return_coordinator.sql',
  import.meta.url,
);
const migration120Bytes = readFileSync(migration120Path);
const migration121 = readFileSync(migration121Path, 'utf8');
const migrationNames = readdirSync(
  new URL('../supabase/migrations/', import.meta.url),
).sort();

const functionBody = (name: string): string => migration121.match(
  new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'u'),
)?.[0] ?? '';

const canonicalizeTextBytes = (content: Uint8Array): Buffer => Buffer.from(
  Buffer.from(content).toString('utf8').replaceAll('\r\n', '\n'),
  'utf8',
);

const migrationContentHash = (filename: string, content: Uint8Array): string => createHash('sha256')
  .update(Buffer.from(filename, 'utf8'))
  .update(Buffer.from([0]))
  .update(canonicalizeTextBytes(content))
  .digest('hex')
  .toUpperCase();

test('Migration 121 preserves approved Migration 120 before Phase 4.3', () => {
  assert.equal(
    migrationContentHash('120_phase4_returns_refunds_foundation.sql', migration120Bytes),
    '58C5E40E8E65D67440ACFFD6D6F11616CC3CD3C9434FD59CD5C980395B70F7FA',
  );
  assert.equal(
    migrationNames.filter((name) => name.startsWith('121_')).length,
    1,
  );
  assert.equal(migrationNames.filter((name) => name.startsWith('122_')).length, 1);
  assert.equal(migrationNames.filter((name) => name.startsWith('123_')).length, 1);
  assert.match(migration121, /^BEGIN;/u);
  assert.match(migration121, /COMMIT;\s*$/u);
});

test('Migration 120 integrity hash is portable but remains content-sensitive', () => {
  const lf = Buffer.from('BEGIN;\nSELECT 120;\nCOMMIT;\n');
  const crlf = Buffer.from('BEGIN;\r\nSELECT 120;\r\nCOMMIT;\r\n');
  assert.equal(migrationContentHash('120_test.sql', lf), migrationContentHash('120_test.sql', crlf));
  assert.notEqual(
    migrationContentHash('120_test.sql', lf),
    migrationContentHash('120_test.sql', Buffer.from('BEGIN;\nSELECT 121;\nCOMMIT;\n')),
  );
  assert.notEqual(
    migrationContentHash('120_test.sql', lf),
    migrationContentHash('121_test.sql', lf),
  );
});

test('the atomic coordinator resolves replay before mutable eligibility and locks', () => {
  const coordinator = functionBody('settle_sales_return_v1');
  assert.ok(coordinator.length > 0);
  assert.ok(
    coordinator.indexOf('assert_erp_role')
      < coordinator.indexOf('phase4_resolve_operation_replay_internal'),
  );
  assert.ok(
    coordinator.indexOf('phase4_resolve_operation_replay_internal')
      < coordinator.indexOf('phase4_lock_customer_order_context_internal'),
  );
  assert.ok(
    coordinator.indexOf('phase4_lock_customer_order_context_internal')
      < coordinator.indexOf('phase2_lock_inventory_products_internal'),
  );
  assert.ok(
    coordinator.indexOf('phase2_lock_inventory_products_internal')
      < coordinator.indexOf('phase4_authoritative_completion_internal'),
  );
  assert.match(coordinator, /clock_timestamp\(\) > v_completion_at \+ INTERVAL '48 hours'/u);
  assert.doesNotMatch(coordinator, /NEXTVAL\(/iu);
});

test('financial settlement is debt-first and does not rewrite historical order totals', () => {
  const coordinator = functionBody('settle_sales_return_v1');
  const projection = functionBody('phase42_order_financial_position_internal');
  assert.match(projection, /total_amount - collected_amount - prior_debt/u);
  assert.match(projection, /LEAST\(delivery_amount, outstanding_amount\)/u);
  assert.match(
    projection,
    /collected_amount - prior_refunds[\s\S]*?delivery_amount - delivery_outstanding/u,
  );
  assert.match(
    coordinator,
    /v_debt_reduction := LEAST\([\s\S]*?v_financial\.merchandise_debt_in_minor_units/u,
  );
  assert.match(coordinator, /v_money_refund := v_total_entitlement - v_debt_reduction/u);
  assert.match(coordinator, /v_money_refund > v_financial\.refundable_collected_in_minor_units/u);
  assert.doesNotMatch(coordinator, /UPDATE public\.orders/iu);
  assert.doesNotMatch(coordinator, /UPDATE public\.customer_payments/iu);
});

test('cash and CliQ refund evidence is real while zero-money settlement stays empty', () => {
  const coordinator = functionBody('settle_sales_return_v1');
  assert.match(coordinator, /v_money_refund = 0 AND \(v_method IS NOT NULL OR v_reference IS NOT NULL\)/u);
  assert.match(coordinator, /v_money_refund > 0 AND \([\s\S]*?v_method IS NULL OR v_method NOT IN/u);
  assert.match(coordinator, /v_method = 'cliq' AND v_reference IS NULL/u);
  assert.match(coordinator, /cash_refunds_in_minor_units/u);
  assert.match(coordinator, /cliq_refunds_in_minor_units/u);
  assert.match(coordinator, /CASE WHEN v_money_refund > 0 THEN v_shift_id END/u);
  assert.match(coordinator, /CASE WHEN v_money_refund > 0 AND v_method = 'cliq'/u);
});

test('inventory restoration uses immutable historical value and exact WAC evidence', () => {
  const inventory = functionBody('phase42_apply_return_inventory_internal');
  assert.match(inventory, /phase2_lock_inventory_products_internal/u);
  assert.match(inventory, /historical_value_exact/u);
  assert.match(
    inventory,
    /v_opening_global::NUMERIC \* v_prior_exact \+ v_restock_value/u,
  );
  assert.match(inventory, /wac_cost_in_minor_units_exact = v_new_exact/u);
  assert.match(inventory, /reference_type, reference_id/u);
  assert.match(inventory, /'phase4_sales_return', p_return_event_id/u);
  assert.match(migration121, /phase42_return_inventory_effects/u);
  assert.match(migration121, /IMMUTABLE_BUSINESS_HISTORY: Return inventory effect evidence/u);
  assert.doesNotMatch(inventory, /sale_price_in_minor_units/iu);
});

test('partial allocations and Parcel customer damage use approved historical contracts', () => {
  const coordinator = functionBody('settle_sales_return_v1');
  assert.match(coordinator, /v_new_cumulative := v_prior_quantity \+ v_quantity/u);
  assert.match(coordinator, /FLOOR\([\s\S]*?v_new_cumulative[\s\S]*?v_order_item\.quantity/u);
  assert.match(coordinator, /THEN v_order_item\.net_refundable_amount_snapshot_in_minor_units/u);
  assert.match(
    coordinator,
    /effective_standalone_unit_sale_price_snapshot_in_minor_units/u,
  );
  assert.match(
    coordinator,
    /v_applied_damage := LEAST\([\s\S]*?net_refundable_amount_snapshot_in_minor_units, v_raw_damage/u,
  );
  assert.doesNotMatch(coordinator, /Parcel price|current WAC|current price/iu);
});

test('operational finalization requires coordinator-local effect completeness', () => {
  const finalizer = functionBody('phase4_finalize_aftercare_operation_internal');
  const evidenceAssertion = functionBody(
    'phase42_assert_operational_return_evidence_internal',
  );
  const expectedEffects = functionBody(
    'phase42_expected_return_inventory_effects_internal',
  );
  assert.match(finalizer, /settlement_coordinator_version/u);
  assert.match(
    finalizer,
    /phase42_assert_operational_return_evidence_internal\([\s\S]*?p_operation_id, false/u,
  );
  assert.match(finalizer, /phase42_return_settlement_guards/u);
  assert.match(finalizer, /PHASE42_COORDINATOR_REQUIRED/u);
  assert.doesNotMatch(finalizer, /v_actual_inventory IS DISTINCT FROM v_expected_inventory/u);
  assert.match(finalizer, /phase4_finalize_aftercare_operation_foundation_internal/u);
  assert.match(evidenceAssertion, /phase3_pos_sale_v1/u);
  assert.match(evidenceAssertion, /phase3_customer_reservation_v1/u);
  assert.match(evidenceAssertion, /settlement_coordinator_version IS DISTINCT FROM 402/u);
  assert.match(evidenceAssertion, /phase42_return_settlement_evidence/u);
  assert.match(evidenceAssertion, /result_snapshot IS DISTINCT FROM v_operation\.result_snapshot/u);
  assert.match(evidenceAssertion, /inventory_effects_snapshot IS DISTINCT FROM v_inventory/u);
  assert.match(expectedEffects, /accepted_base_quantity AS quantity/u);
  assert.match(expectedEffects, /accepted_stock_disposition = 'restock'/u);
  assert.match(expectedEffects, /source_kind', 'base_order_item'/u);
  assert.match(expectedEffects, /source_kind', 'parcel_component'/u);
  assert.match(evidenceAssertion, /v_actual_inventory IS DISTINCT FROM v_expected_inventory/u);
  assert.match(
    evidenceAssertion,
    /phase42_expected_return_inventory_effects_internal\(p_operation_id\)/u,
  );
  assert.match(evidenceAssertion, /movement\.reference_type IS DISTINCT FROM 'phase4_sales_return'/u);
  assert.match(evidenceAssertion, /movement\.reference_id IS DISTINCT FROM v_event\.id/u);
  assert.match(evidenceAssertion, /effect\.warehouse_id IS DISTINCT FROM v_order\.warehouse_id/u);
  assert.match(evidenceAssertion, /movement\.created_by IS DISTINCT FROM v_operation\.initiated_by/u);
  assert.match(evidenceAssertion, /PHASE42_OPERATIONAL_EFFECTS_INVALID/u);
  assert.match(evidenceAssertion, /PHASE42_OPERATIONAL_EFFECTS_INCOMPLETE/u);
});

test('durable operational settlement evidence is immutable and coordinator-bound', () => {
  const coordinator = functionBody('settle_sales_return_v1');
  const evidenceGuard = functionBody('phase42_guard_settlement_evidence');
  assert.match(migration121, /CREATE TABLE public\.phase42_return_settlement_evidence/u);
  assert.match(
    evidenceGuard,
    /transaction_id = pg_current_xact_id\(\)[\s\S]*?operation_id = NEW\.operation_id[\s\S]*?return_event_id = NEW\.return_event_id/u,
  );
  assert.match(evidenceGuard, /TG_OP <> 'INSERT'/u);
  assert.match(coordinator, /INSERT INTO public\.phase42_return_settlement_guards/u);
  assert.match(coordinator, /INSERT INTO public\.phase42_return_settlement_evidence/u);
  assert.ok(
    coordinator.indexOf('INSERT INTO public.phase42_return_settlement_guards')
      < coordinator.indexOf('INSERT INTO public.phase42_return_settlement_evidence'),
  );
  assert.ok(
    coordinator.indexOf('INSERT INTO public.phase42_return_settlement_evidence')
      < coordinator.indexOf('phase4_finalize_aftercare_operation_internal'),
  );
  assert.match(
    coordinator,
    /phase42_inventory_effects_snapshot_internal\(v_operation_id\)/u,
  );
  const transitionGuard = functionBody(
    'phase42_require_evidence_before_return_settlement',
  );
  assert.match(transitionGuard, /OLD\.settlement_status IS DISTINCT FROM 'settled'/u);
  assert.match(transitionGuard, /NEW\.settlement_status = 'settled'/u);
  assert.match(
    transitionGuard,
    /phase42_assert_operational_return_evidence_internal\([\s\S]*?NEW\.operation_id, false/u,
  );
  assert.match(
    migration121,
    /CREATE TRIGGER trg_phase42_require_evidence_before_return_settlement/u,
  );
});

test('modern Return replay validates the same durable operational evidence', () => {
  const replay = functionBody('phase4_resolve_operation_replay_internal');
  assert.match(replay, /phase4-operation\|/u);
  assert.match(replay, /v_settled_outcome_count/u);
  assert.match(replay, /phase42_assert_operational_return_evidence_internal/u);
  assert.match(replay, /v_operation\.id, true/u);
  assert.doesNotMatch(migration121, /phase4_resolve_operation_replay_foundation_internal/u);
});

test('modern V2 sales cannot use the legacy Return RPC', () => {
  const wrapper = functionBody('return_completed_website_order');
  assert.match(wrapper, /phase3_pos_sale_v1/u);
  assert.match(wrapper, /phase3_customer_reservation_v1/u);
  assert.match(wrapper, /PHASE42_COORDINATOR_REQUIRED/u);
  assert.match(wrapper, /_return_completed_website_order_before_phase42_coordinator/u);
});

test('payment, Shift reversal and receivable reads share Phase 4.2 truth', () => {
  const payment = functionBody('record_customer_order_payment');
  const shift = functionBody('reverse_cash_shift_with_operations');
  assert.match(payment, /phase4_lock_customer_order_context_internal/u);
  assert.match(payment, /phase42_order_financial_position_internal/u);
  assert.match(payment, /PHASE42_CUSTOMER_PAYMENT_EXCEEDS_EFFECTIVE_OUTSTANDING/u);
  assert.match(shift, /phase4_lock_full_shift_context_internal/u);
  assert.match(shift, /PHASE42_SETTLED_RETURN_REFUND_DEPENDENCY/u);
  assert.match(migration121, /CREATE OR REPLACE FUNCTION public\.get_customer_outstanding_orders_page/u);
  assert.match(migration121, /phase42_customer_receivable_total_internal/u);
});

test('only the coordinator is client-executable and internal helpers remain private', () => {
  assert.match(
    migration121,
    /GRANT EXECUTE ON FUNCTION public\.settle_sales_return_v1\([\s\S]*?TO authenticated/u,
  );
  for (const helper of [
    'phase42_guard_settlement_evidence',
    'phase42_inventory_effects_snapshot_internal',
    'phase42_expected_return_inventory_effects_internal',
    'phase42_assert_operational_return_evidence_internal',
    'phase42_require_evidence_before_return_settlement',
    'phase42_canonicalize_return_request_internal',
    'phase42_order_financial_position_internal',
    'phase42_apply_return_inventory_internal',
    'phase4_finalize_aftercare_operation_internal',
  ]) {
    assert.match(
      migration121,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${helper}`, 'u'),
    );
  }
  assert.doesNotMatch(
    migration121,
    /GRANT EXECUTE ON FUNCTION public\.phase42_(?:canonicalize|order_financial|apply_return)/u,
  );
});
