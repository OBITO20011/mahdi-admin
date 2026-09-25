import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/114_configurable_parcel_sales_contracts_and_safety_primitives.sql',
    import.meta.url,
  ),
  'utf8',
);
const customerCoordinatorMigration = readFileSync(
  new URL(
    '../supabase/migrations/116_configurable_parcel_customer_reservation_coordinator.sql',
    import.meta.url,
  ),
  'utf8',
);
const runtimeHarness = readFileSync(
  new URL(
    '../scripts/testing/run-phase3-configurable-parcel-contracts-runtime.mjs',
    import.meta.url,
  ),
  'utf8',
);
const packageManifest = readFileSync(
  new URL('../package.json', import.meta.url),
  'utf8',
);
const canonicalSuite = readFileSync(
  new URL('./database-runtime-suite.ts', import.meta.url),
  'utf8',
);

test('Phase 3.1 is additive, transactional and does not create a sale coordinator', () => {
  assert.match(migration, /^BEGIN;/u);
  assert.match(migration, /COMMIT;\s*$/u);
  assert.doesNotMatch(migration, /DROP (TABLE|COLUMN|TYPE|FUNCTION)/iu);
  assert.doesNotMatch(migration, /CREATE (?:OR REPLACE )?FUNCTION public\.(?:create|submit)_.*(?:sale|order|reservation)/iu);
  assert.doesNotMatch(migration, /INSERT INTO public\.business_operations/iu);
  assert.doesNotMatch(migration, /UPDATE public\.(?:orders|order_items|products|inventory_balances|inventory_movements)/iu);
});

test('Phase 3 actor identity is privacy-safe and globally serializes each operation key', () => {
  assert.match(migration, /ADD COLUMN actor_scope_type TEXT/u);
  assert.match(migration, /ADD COLUMN actor_scope_hash TEXT/u);
  assert.match(migration, /actor_scope_hash ~ '\^\[0-9a-f\]\{64\}\$'/u);
  assert.match(migration, /CREATE UNIQUE INDEX uq_business_operations_phase3_idempotency[\s\S]*operation_type, idempotency_key/u);
  assert.match(migration, /phase3:guest_gateway:v1\|/u);
  assert.match(migration, /IP is intentionally excluded/u);
  assert.doesNotMatch(migration, /actor_scope_(?:hash|type)[\s\S]{0,300}GRANT SELECT \(/u);
});

test('canonical identity is versioned, bounded and preserves independent instances', () => {
  assert.match(migration, /phase3_canonicalize_sale_request_internal/u);
  assert.match(migration, /'phase3-sale-v1'/u);
  assert.match(migration, /commercial_line_kind[\s\S]*base_unit[\s\S]*legacy_single_sku_parcel[\s\S]*configurable_parcel/u);
  assert.match(migration, /JSONB_ARRAY_LENGTH\(v_lines\) > 50/u);
  assert.match(migration, /v_total_instances \+ JSONB_ARRAY_LENGTH\(v_instances\) > 200/u);
  assert.match(migration, /ROW_NUMBER\(\) OVER \([\s\S]*composition_fingerprint/u);
  assert.match(migration, /GROUP BY \(component->>'product_id'\)::UUID/u);
  assert.doesNotMatch(migration, /current_(?:price|wac)|NOW\(\).*request_fingerprint/iu);
});

test('replay resolution is read-only and precedes current feature/config validation', () => {
  const resolver = migration.match(
    /CREATE FUNCTION public\.phase3_resolve_operation_replay_internal[\s\S]*?\n\$\$;/u,
  )?.[0] || '';
  assert.match(resolver, /pg_advisory_xact_lock/u);
  assert.match(resolver, /FROM public\.business_operations/u);
  assert.match(resolver, /'decision', 'REPLAY'/u);
  assert.match(resolver, /PHASE3_IDEMPOTENCY_CONFLICT/u);
  assert.doesNotMatch(resolver, /\b(?:INSERT|UPDATE|DELETE)\b/iu);
  assert.doesNotMatch(resolver, /assert_configurable_parcel|feature_state/u);
});

test('feature, validation and locking helpers remain internal and reuse Phase 2 order', () => {
  assert.match(migration, /phase3_assert_configurable_parcel_creation_allowed_internal/u);
  assert.match(migration, /v_state = 'OWNER_PILOT'[\s\S]*v_scope_type = 'erp_user'[\s\S]*has_erp_role/u);
  assert.match(migration, /guest_gateway'[\s\S]*auth\.role\(\) IS DISTINCT FROM 'service_role'/u);
  assert.match(migration, /phase3_lock_inventory_products_internal[\s\S]*phase2_lock_inventory_products_internal/u);
  assert.match(migration, /PARCEL_CAPACITY_MISMATCH/u);
  assert.match(migration, /PARCEL_COMPONENT_FAMILY_MISMATCH/u);
  assert.match(migration, /PHASE3_EXACT_WAC_UNAVAILABLE/u);
});

test('COGS is projected per instance with deterministic largest remainder allocation', () => {
  const allocator = migration.match(
    /CREATE FUNCTION public\.phase3_allocate_parcel_cogs_internal[\s\S]*?\n\$\$;/u,
  )?.[0] || '';
  assert.match(allocator, /'rounding_boundary', 'parcel_instance'/u);
  assert.match(allocator, /ROUND\(SUM\(exact_cost\), 0\)::BIGINT/u);
  assert.match(allocator, /exact_cost - FLOOR\(exact_cost\) DESC, product_id/u);
  assert.match(allocator, /allocated_cogs_in_minor_units/u);
  assert.doesNotMatch(allocator, /UPDATE public\.products|wac_cost_in_minor_units_exact\s*=/iu);
});

test('reservation foundation prevents duplicate active holds and validates exact components', () => {
  assert.match(migration, /CREATE UNIQUE INDEX uq_order_inventory_reservations_active_identity/u);
  assert.match(migration, /WHERE reservation_state = 'active'/u);
  assert.match(migration, /order_inventory_reservations_component_quantity_check/u);
  assert.match(migration, /instance\.finalized_at/u);
  assert.match(migration, /NEW\.reserved_quantity > v_component_quantity/u);
});

test('internal primitives expose no direct client mutation surface', () => {
  const normalizedMigration = migration.replace(/\s+/gu, ' ');
  for (const signature of [
    'phase3_canonicalize_sale_request_internal(JSONB)',
    'phase3_resolve_operation_replay_internal( TEXT, TEXT, TEXT, TEXT, TEXT )',
    'phase3_validate_configurable_parcel_internal( TEXT, UUID, UUID, UUID, INTEGER, JSONB )',
    'phase3_allocate_parcel_cogs_internal(JSONB)',
    'phase3_lock_inventory_products_internal(UUID[])',
  ]) {
    assert.ok(
      normalizedMigration.includes(
        `REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated, service_role;`,
      ),
      `missing client revoke for ${signature}`,
    );
  }
  assert.match(migration, /REVOKE SELECT ON TABLE public\.business_operations FROM authenticated/u);
  assert.match(migration, /GRANT SELECT \([\s\S]*completed_at[\s\S]*\) ON public\.business_operations TO authenticated/u);
});

test('Phase 3.1 runtime is isolated and wired into the existing canonical DB suite', () => {
  assert.match(runtimeHarness, /bootstrap-isolated-supabase\.mjs/u);
  assert.match(runtimeHarness, /pg_blocking_pids/u);
  assert.match(runtimeHarness, /deadlocks/u);
  assert.match(runtimeHarness, /001-119/u);
  assert.match(packageManifest, /"test:phase3-contracts:runtime": "node scripts\/testing\/run-phase3-configurable-parcel-contracts-runtime\.mjs"/u);
  assert.match(canonicalSuite, /run-phase3-configurable-parcel-contracts-runtime\.mjs/u);
});

test('POS V2 authorizes before registered-Customer access while preserving serialization', () => {
  const wrapper = customerCoordinatorMigration.match(
    /CREATE FUNCTION public\.create_pos_sale_v2\([\s\S]*?\n\$\$;/u,
  )?.[0] || '';
  const authorizationIndex = wrapper.indexOf('PERFORM public.assert_erp_role(');
  const customerLookupIndex = wrapper.indexOf('FROM public.customers customer');
  const privateCallIndex = wrapper.indexOf(
    'RETURN public._create_pos_sale_v2_before_registered_customer_lock(',
  );
  assert.ok(authorizationIndex >= 0, 'POS V2 wrapper lacks the centralized authorization guard.');
  assert.ok(customerLookupIndex > authorizationIndex, 'Customer lookup occurs before authorization.');
  assert.ok(privateCallIndex > customerLookupIndex, 'Private POS V2 runs before Customer serialization.');
  assert.match(wrapper, /ARRAY\['owner', 'admin', 'manager', 'sales'\]/u);
  assert.match(wrapper, /FOR KEY SHARE/u);
});

test('mixed Customer V1/V2 committed-state oracle is fixture-defined and anti-self-referential', () => {
  assert.match(runtimeHarness, /assertMixedCommittedStateSnapshot/u);
  assert.match(runtimeHarness, /inventoryReservedEffect/u);
  assert.match(runtimeHarness, /detailedReservationQuantity/u);
  assert.match(runtimeHarness, /syntheticGoodState/u);
  assert.match(runtimeHarness, /Persisted line quantity mismatch/u);
  assert.match(runtimeHarness, /Customer linkage mismatch/u);
  assert.match(runtimeHarness, /Product linkage mismatch/u);
  assert.match(runtimeHarness, /Aggregate reserved quantity mismatch/u);
  assert.doesNotMatch(runtimeHarness, /expectedReservedByProduct/u);
});
