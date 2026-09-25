import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/116_configurable_parcel_customer_reservation_coordinator.sql', import.meta.url),
  'utf8',
);
const gateway = readFileSync(
  new URL('../supabase/functions/submit-guest-order/index.ts', import.meta.url),
  'utf8',
);
const runtime = readFileSync(
  new URL('../scripts/testing/run-phase3-configurable-parcel-contracts-runtime.mjs', import.meta.url),
  'utf8',
);

test('Migration 116 is transactional and preserves earlier migration files', () => {
  assert.match(migration, /^BEGIN;/u);
  assert.match(migration, /COMMIT;\s*$/u);
  assert.doesNotMatch(migration, /ALTER\s+TABLE[\s\S]*DROP\s+COLUMN/iu);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.(?:orders|order_items|inventory_balances)/iu);
});

test('Customer V2 is gateway-only and V1 remains a separately callable compatibility wrapper', () => {
  assert.match(migration, /CREATE FUNCTION public\.submit_guest_customer_order_v2\(/u);
  assert.match(migration, /auth\.role\(\) IS DISTINCT FROM 'service_role'/u);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.submit_guest_customer_order_v2[\s\S]*TO service_role/u);
  assert.match(migration, /CREATE FUNCTION public\.submit_guest_customer_order\([\s\S]*_submit_guest_customer_order_v1_before_phase3/u);
  assert.match(migration, /phase3_customer_reservation_v1[\s\S]*PHASE3_IDEMPOTENCY_CONFLICT/u);
  assert.match(gateway, /contractVersion === 'phase3-customer-reservation-v2'/u);
  assert.match(gateway, /submit_guest_customer_order_v2/u);
});

test('reservation creation has no final sale movement or cost finalization', () => {
  const creation = migration.match(
    /CREATE FUNCTION public\.submit_guest_customer_order_v2\([\s\S]*?REVOKE ALL ON FUNCTION public\.submit_guest_customer_order_v2/u,
  )?.[0] || '';
  assert.match(creation, /INSERT INTO public\.order_inventory_reservations/u);
  assert.match(creation, /reserved_quantity = reserved_quantity \+ v_demand\.quantity/u);
  assert.doesNotMatch(creation, /INSERT INTO public\.inventory_movements/u);
  assert.doesNotMatch(creation, /cost_finalized_at\s*=\s*/u);
});

test('completion is the single inventory and cost mutation owner', () => {
  const completion = migration.match(
    /CREATE FUNCTION public\.complete_website_order_with_settlement_v2\([\s\S]*?REVOKE ALL ON FUNCTION public\.complete_website_order_with_settlement_v2/u,
  )?.[0] || '';
  assert.match(completion, /reservation_state = 'consumed'/u);
  assert.match(completion, /on_hand_quantity = v_balance_after/u);
  assert.match(completion, /reserved_quantity = v_reserved_before - v_reservation\.reserved_quantity/u);
  assert.match(completion, /unit_cost_snapshot_in_minor_units_exact/u);
  assert.match(completion, /exact_cogs_snapshot_in_minor_units/u);
  assert.match(completion, /cost_finalized_at = v_now/u);
  assert.match(completion, /INSERT INTO public\.inventory_movements/u);
  assert.doesNotMatch(completion, /public\.complete_order\(/u);
});

test('one-time cost finalization requires transaction-local structural authorization', () => {
  assert.match(migration, /CREATE TABLE public\.phase3_customer_cost_finalization_guards/u);
  assert.match(migration, /transaction_id = pg_current_xact_id\(\)/u);
  assert.match(migration, /creation\.operation_type = 'phase3_customer_reservation_v1'/u);
  assert.match(migration, /OLD\.cost_finalized_at IS NULL[\s\S]*NEW\.cost_finalized_at IS NOT NULL/u);
  assert.match(migration, /CUSTOMER_ORDER_COST_FINALIZATION_IMMUTABLE/u);
  assert.match(migration, /DELETE FROM public\.phase3_customer_cost_finalization_guards/u);
});

test('cancel and expiry release exact reservations without on-hand writes', () => {
  const release = migration.match(
    /CREATE FUNCTION public\.phase3_release_customer_reservations_internal\([\s\S]*?CREATE FUNCTION public\.cancel_customer_order_v2/u,
  )?.[0] || '';
  assert.match(release, /reservation_state = v_target_reservation_state/u);
  assert.match(release, /reserved_quantity = balance\.reserved_quantity - v_demand\.quantity/u);
  assert.doesNotMatch(release, /on_hand_quantity\s*=/u);
  assert.doesNotMatch(release, /INSERT INTO public\.inventory_movements/u);
  assert.match(migration, /phase3_expire_customer_order_v2_internal/u);
  assert.match(migration, /v_failed_order_ids/u);
  assert.match(migration, /EXPIRE_STALE_WEBSITE_ORDER_FAILED/u);
  assert.match(migration, /'sqlstate', SQLSTATE/u);
  assert.match(migration, /v_candidate_limit := LEAST\(1000, GREATEST\(p_batch_size \* 10, p_batch_size \+ 25\)\)/u);
  assert.match(migration, /v_attempted_count := v_attempted_count \+ 1/u);
  assert.match(migration, /EXIT WHEN v_expired_count >= p_batch_size/u);
  assert.match(migration, /'attempted_count', v_attempted_count/u);
  assert.match(migration, /'scan_exhausted', v_scan_exhausted/u);
});

test('legacy terminal entrypoints reject Customer V2 before legacy inventory mutation', () => {
  assert.match(migration, /CREATE TABLE public\.phase3_customer_lifecycle_transition_guards/u);
  assert.match(migration, /CREATE FUNCTION public\.guard_phase3_customer_v2_terminal_status\(\)/u);
  assert.match(migration, /CREATE TRIGGER trg_guard_phase3_customer_v2_terminal_status/u);
  assert.match(migration, /CREATE FUNCTION public\.phase3_assert_legacy_customer_lifecycle_allowed_internal\(/u);
  const completeStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.complete_order(');
  const cancelStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.cancel_order(');
  const lifecycleEnd = migration.indexOf('CREATE OR REPLACE FUNCTION public.phase3_actor_scope_hash_internal(');
  const completeGuard = migration.indexOf(
    'phase3_assert_legacy_customer_lifecycle_allowed_internal(p_order_id)', completeStart,
  );
  const cancelGuard = migration.indexOf(
    'phase3_assert_legacy_customer_lifecycle_allowed_internal(p_order_id)', cancelStart,
  );
  assert.ok(completeStart >= 0 && completeGuard > completeStart && completeGuard < cancelStart);
  assert.ok(cancelStart > completeStart && cancelGuard > cancelStart && cancelGuard < lifecycleEnd);
  assert.match(migration, /PHASE3_CUSTOMER_V2_LIFECYCLE_COORDINATOR_REQUIRED/u);
});

test('Customer V2 follows Customer-before-Inventory lock order used by V1', () => {
  const coordinator = migration.match(
    /CREATE FUNCTION public\.submit_guest_customer_order_v2\([\s\S]*?REVOKE ALL ON FUNCTION public\.submit_guest_customer_order_v2/u,
  )?.[0] || '';
  const phoneLock = coordinator.indexOf('pg_advisory_xact_lock(hashtext(v_phone)::BIGINT)');
  const customerRowLock = coordinator.indexOf('LIMIT 1 FOR UPDATE');
  const inventoryLock = coordinator.indexOf('phase3_lock_inventory_products_internal');
  assert.ok(phoneLock >= 0);
  assert.ok(customerRowLock > phoneLock);
  assert.ok(inventoryLock > customerRowLock);
});

test('Phase 3 monitoring understands component reservations and provisional cost', () => {
  assert.match(migration, /FROM public\.order_inventory_reservations reservation[\s\S]*reservation\.reservation_state = 'active'/u);
  assert.match(migration, /SUM\(component\.base_quantity\)[\s\S]*JOIN public\.order_parcel_components component/u);
  assert.match(migration, /reference_type IN \('order','pos_sale','customer_order'\)/u);
  assert.match(migration, /operation\.operation_type = 'phase3_customer_reservation_v1'[\s\S]*customer_order\.status NOT IN \('completed','returned'\)[\s\S]*item\.cost_finalized_at IS NOT NULL/u);
  assert.match(migration, /item\.cogs_in_minor_units <> 0[\s\S]*item\.profit_in_minor_units <> 0/u);
  assert.match(migration, /SUM\(instance\.cogs_snapshot_in_minor_units\)/u);
  assert.match(migration, /ROUND\(instance\.exact_cogs_snapshot_in_minor_units, 0\)::BIGINT/u);
  assert.match(migration, /SUM\(component\.cogs_snapshot_in_minor_units\)/u);
});

test('permanent runtime suite covers corrective-pass lifecycle, concurrency, expiry and COGS evidence', () => {
  assert.match(runtime, /legacyV1CompletionCompatible: true/u);
  assert.match(runtime, /legacyV2CompletionRejectedZeroWrites: true/u);
  assert.match(runtime, /legacyV2CancellationRejectedZeroWrites: true/u);
  assert.match(runtime, /customerV1V2BothQueueDirections: true/u);
  assert.match(runtime, /customerV1V2TrueSimultaneous: true/u);
  assert.match(runtime, /customerV1V2ResourceMatrix: true/u);
  assert.match(runtime, /multiPoisonForwardProgress: true/u);
  assert.match(runtime, /poisonAfterValidBounded: true/u);
  assert.match(runtime, /parcelCogsPerInstanceBoundary: true/u);
  assert.match(runtime, /corruptedParcelCogsDetected: true/u);
  assert.match(runtime, /completionVsReversal: true/u);
  assert.match(runtime, /PHASE3_POS_REVERSAL_LATER_MOVEMENT/u);
});

test('new internal mutation surfaces are privilege restricted', () => {
  assert.match(migration, /REVOKE ALL ON TABLE public\.phase3_customer_cost_finalization_guards[\s\S]*service_role/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.phase3_release_customer_reservations_internal[\s\S]*service_role/u);
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path = public, pg_temp/u);
});
