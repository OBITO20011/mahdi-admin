import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/115_configurable_parcel_pos_sale_coordinator.sql',
    import.meta.url,
  ),
  'utf8',
);
const v1Migration = readFileSync(
  new URL(
    '../supabase/migrations/111_harden_pos_sale_idempotency_replays.sql',
    import.meta.url,
  ),
  'utf8',
);
const service = readFileSync(
  new URL('../src/services/supabase/posV2.service.ts', import.meta.url),
  'utf8',
);
const posView = readFileSync(
  new URL('../src/features/pos/PosView.tsx', import.meta.url),
  'utf8',
);
const appStore = readFileSync(
  new URL('../src/stores/useAppStore.ts', import.meta.url),
  'utf8',
);
const runtime = readFileSync(
  new URL(
    '../scripts/testing/run-phase3-configurable-parcel-contracts-runtime.mjs',
    import.meta.url,
  ),
  'utf8',
);

const createV2 = migration.match(
  /CREATE FUNCTION public\.create_pos_sale_v2[\s\S]*?\n\$\$;/u,
)?.[0] || '';
const reversePosSale = migration.match(
  /CREATE OR REPLACE FUNCTION public\.reverse_pos_sale[\s\S]*?\n\$\$;/u,
)?.[0] || '';

test('Migration 115 is transactional and preserves the public POS V1 contract', () => {
  assert.match(migration, /^BEGIN;/u);
  assert.match(migration, /COMMIT;\s*$/u);
  assert.match(migration, /CREATE FUNCTION public\.create_pos_sale_v2/u);
  assert.doesNotMatch(
    migration,
    /CREATE OR REPLACE FUNCTION public\.create_pos_sale\s*\(/u,
  );
  assert.match(
    migration,
    /ALTER FUNCTION public\.create_pos_sale_base_units_legacy[\s\S]*RENAME TO _create_pos_sale_base_units_before_phase3_lock/u,
  );
  assert.match(
    migration,
    /CREATE FUNCTION public\.create_pos_sale_base_units_legacy\([\s\S]*phase3_lock_open_pos_shift_internal/u,
  );
  assert.match(v1Migration, /pg_advisory_xact_lock\(hashtext\(v_key\)\)/u);
  assert.doesNotMatch(migration, /DROP (?:TABLE|COLUMN|TYPE|FUNCTION)/iu);
  assert.doesNotMatch(migration, /ALTER TABLE public\.(?:products|orders|order_items)/iu);
});

test('legacy V1 joins the reversal shift gate before its private inventory writer', () => {
  const locationResolver = migration.match(
    /CREATE FUNCTION public\.phase3_resolve_legacy_pos_location_internal[\s\S]*?\n\$\$;/u,
  )?.[0] || '';
  const shiftHelper = migration.match(
    /CREATE FUNCTION public\.phase3_lock_open_pos_shift_internal[\s\S]*?\n\$\$;/u,
  )?.[0] || '';
  const legacyWrapper = migration.match(
    /CREATE FUNCTION public\.create_pos_sale_base_units_legacy[\s\S]*?\n\$\$;/u,
  )?.[0] || '';
  assert.match(
    locationResolver,
    /IF v_warehouse_id IS NULL[\s\S]*ORDER BY warehouse\.created_at[\s\S]*COALESCE\(v_branch_id, warehouse\.branch_id\)/u,
  );
  assert.match(
    shiftHelper,
    /cash-shift-full-reversal:[\s\S]*FOR SHARE/u,
  );
  assert.match(
    legacyWrapper,
    /phase3_resolve_legacy_pos_location_internal[\s\S]*phase3_lock_open_pos_shift_internal\(v_location\.branch_id\)[\s\S]*_create_pos_sale_base_units_before_phase3_lock\([\s\S]*v_location\.warehouse_id[\s\S]*v_location\.branch_id/u,
  );
  assert.match(
    migration,
    /_create_pos_sale_base_units_before_phase3_lock[\s\S]*FROM PUBLIC, anon, authenticated, service_role/u,
  );
  assert.match(
    migration,
    /phase3_lock_open_pos_shift_internal\(UUID\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role/u,
  );
  assert.match(
    migration,
    /phase3_resolve_legacy_pos_location_internal\(UUID, UUID\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role/u,
  );
});

test('V2 serializes the raw key with V1 and resolves immutable replay first', () => {
  const rawLock = createV2.indexOf('pg_advisory_xact_lock(hashtext(v_key))');
  const resolver = createV2.indexOf('phase3_resolve_operation_replay_internal');
  const legacyCollision = createV2.indexOf('FROM public.orders existing_order');
  const currentWarehouse = createV2.indexOf('FROM public.warehouses warehouse');
  assert.ok(rawLock > 0);
  assert.ok(resolver > rawLock);
  assert.ok(legacyCollision > resolver);
  assert.ok(currentWarehouse > legacyCollision);
  assert.match(createV2, /RETURN v_replay->'result_snapshot'/u);
  assert.match(createV2, /PHASE3_IDEMPOTENCY_CONFLICT/u);
  assert.match(createV2, /idempotency_key, operation_id[\s\S]*v_key, v_operation_id/u);
});

test('completed operation is inserted once with immutable request and result snapshots', () => {
  assert.equal(
    (createV2.match(/INSERT INTO public\.business_operations/gu) || []).length,
    1,
  );
  assert.doesNotMatch(createV2, /UPDATE public\.business_operations/iu);
  assert.match(createV2, /result_snapshot, completed_at/u);
  assert.match(createV2, /request_identity_version/u);
  assert.match(createV2, /301, v_canonical_request/u);
  assert.match(createV2, /'phase3_pos_sale_v1'/u);
});

test('coordinator persists parent revenue and component-only stock/COGS lineage', () => {
  assert.match(createV2, /INSERT INTO public\.order_items/u);
  assert.match(createV2, /INSERT INTO public\.order_parcel_instances/u);
  assert.match(createV2, /INSERT INTO public\.order_parcel_components/u);
  assert.match(createV2, /finalize_order_parcel_instance_internal/u);
  assert.match(createV2, /parcel_component_id/u);
  assert.match(createV2, /phase3_allocate_parcel_cogs_internal/u);
  assert.match(createV2, /phase2_allocate_largest_remainder_internal/u);
  assert.match(createV2, /allocated_discount_snapshot_in_minor_units/u);
  assert.match(createV2, /net_refundable_amount_snapshot_in_minor_units/u);
  assert.doesNotMatch(createV2, /UPDATE public\.products[\s\S]*wac_cost/iu);
});

test('order-line and Parcel-instance discount allocation use isolated state', () => {
  assert.match(createV2, /v_line_weighted_keys JSONB/u);
  assert.match(createV2, /v_instance_weighted_keys JSONB/u);
  assert.doesNotMatch(createV2, /\bv_weighted_keys\b/u);
  assert.match(
    createV2,
    /p_discount_in_minor_units, 0\), v_line_weighted_keys/u,
  );
  assert.match(
    createV2,
    /v_line_discount, v_instance_weighted_keys/u,
  );
});

test('feature gate applies to new configurable sales without blocking Base Unit V2', () => {
  assert.match(
    createV2,
    /commercial_line_kind' = 'configurable_parcel'[\s\S]*phase3_assert_configurable_parcel_creation_allowed_internal/u,
  );
  const replayReturn = createV2.indexOf("RETURN v_replay->'result_snapshot'");
  const featureCheck = createV2.indexOf(
    'phase3_assert_configurable_parcel_creation_allowed_internal',
  );
  assert.ok(replayReturn > 0 && featureCheck > replayReturn);
});

test('reversal projects immutable components and preserves whole-sale semantics', () => {
  assert.match(
    migration,
    /phase3_pos_reversal_inventory_rows_internal[\s\S]*order_parcel_components/u,
  );
  assert.match(reversePosSale, /PHASE3_POS_REVERSAL_LATER_MOVEMENT/u);
  assert.match(reversePosSale, /phase3_lock_inventory_products_internal/u);
  assert.match(reversePosSale, /parcel_component_id/u);
  assert.match(reversePosSale, /operation_id/u);
  assert.doesNotMatch(reversePosSale, /get_configurable_parcel_feature_state/u);
  assert.doesNotMatch(reversePosSale, /wac_cost_in_minor_units_exact/u);
});

test('public surface is least privilege and internal reversal projection is private', () => {
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.create_pos_sale_v2[\s\S]*FROM PUBLIC, anon/u,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.create_pos_sale_v2[\s\S]*TO authenticated/u,
  );
  assert.match(
    migration,
    /phase3_pos_reversal_inventory_rows_internal\(UUID\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role/u,
  );
  assert.match(createV2, /SECURITY DEFINER[\s\S]*SET search_path = public, pg_temp/u);
});

test('Admin integration is an isolated adapter and does not move builder state into UI/store', () => {
  assert.match(service, /create_pos_sale_v2/u);
  assert.match(service, /automaticRetry: false/u);
  assert.match(service, /reuseOriginalIdempotencyKey: true/u);
  assert.match(service, /rotateIdempotencyKey: false/u);
  assert.doesNotMatch(posView, /posV2\.service|configurable_parcel|parcel_instances/u);
  assert.doesNotMatch(appStore, /posV2\.service|parcel_instances/u);
});

test('runtime uses independent connections and verifies cross-version and stock races', () => {
  assert.match(runtime, /phase3-cross-v1/u);
  assert.match(runtime, /phase3-cross-v2/u);
  assert.match(runtime, /phase3-parcel-sale-a/u);
  assert.match(runtime, /phase3-parcel-sale-b/u);
  assert.match(runtime, /phase3-sale-vs-receipt-sale/u);
  assert.match(runtime, /phase3-sale-vs-receipt-receipt/u);
  assert.match(runtime, /phase3-sale-vs-reversal-sale/u);
  assert.match(runtime, /phase3-sale-vs-reversal-reversal/u);
  assert.match(runtime, /phase3-v1-sale-first-holder/u);
  assert.match(runtime, /phase3-v1-reversal-first-holder/u);
  assert.match(runtime, /runDiscountAllocationMatrix/u);
  assert.match(runtime, /runLegacyLocationCompatibilityTests/u);
  assert.match(runtime, /nullWarehouseExplicitBranch/u);
  assert.match(runtime, /nullIdempotencyFallback/u);
  assert.match(runtime, /warehouse-with-null-branch/u);
  assert.match(runtime, /runCoordinatorZeroWriteTests/u);
  assert.match(runtime, /runConfigurableRollbackTest/u);
  assert.match(runtime, /runFinancialReadSideTests/u);
  assert.match(runtime, /pg_blocking_pids/u);
  assert.match(runtime, /deadlockDelta/u);
  assert.match(runtime, /migrationRebuild: '001-119'/u);
});
