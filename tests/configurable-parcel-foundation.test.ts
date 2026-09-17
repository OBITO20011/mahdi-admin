import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/112_configurable_parcel_foundation.sql',
    import.meta.url,
  ),
  'utf8',
);
const runtime = readFileSync(
  new URL(
    '../scripts/testing/configurable-parcel-foundation-runtime.sql',
    import.meta.url,
  ),
  'utf8',
);
const runtimeHarness = readFileSync(
  new URL(
    '../scripts/testing/run-configurable-parcel-foundation-runtime.mjs',
    import.meta.url,
  ),
  'utf8',
);
const packageManifest = readFileSync(
  new URL('../package.json', import.meta.url),
  'utf8',
);
const qualityWorkflow = readFileSync(
  new URL('../.github/workflows/quality.yml', import.meta.url),
  'utf8',
);

test('parcel foundation is additive and defaults server state to OFF', () => {
  assert.match(migration, /^BEGIN;/u);
  assert.match(migration, /feature_state IN \('OFF', 'OWNER_PILOT', 'ENABLED'\)/u);
  assert.match(migration, /'configurable_parcels',\s*'OFF'/u);
  assert.match(migration, /ON CONFLICT \(feature_key\) DO NOTHING/u);
  assert.doesNotMatch(migration, /DROP (TABLE|COLUMN|FUNCTION|TYPE)/iu);
  assert.doesNotMatch(migration, /UPDATE public\.order_items/u);
  assert.doesNotMatch(migration, /UPDATE public\.products\s+SET\s+wac_cost/iu);
});

test('parcel inventory remains component SKU inventory with stable references', () => {
  assert.match(migration, /CREATE TABLE public\.order_parcel_instances/u);
  assert.match(migration, /CREATE TABLE public\.order_parcel_components/u);
  assert.match(migration, /product_id UUID NOT NULL[\s\S]*REFERENCES public\.products\(id\) ON DELETE RESTRICT/u);
  assert.match(migration, /CREATE TABLE public\.order_inventory_reservations/u);
  assert.doesNotMatch(migration, /parcel_(stock|inventory)_balance/iu);
  assert.match(migration, /operation_id UUID NOT NULL[\s\S]*REFERENCES public\.business_operations/u);
});

test('historical commercial and financial rows are nullable and not synthesized', () => {
  assert.match(migration, /ADD COLUMN commercial_line_kind TEXT/u);
  assert.match(migration, /NULL identifies untouched historical rows/u);
  assert.match(migration, /CREATE TABLE public\.sales_return_events/u);
  assert.match(migration, /CREATE TABLE public\.sales_return_items/u);
  assert.match(migration, /Merchandise-only refund\. Delivery and tax allocation are outside this model/u);
  assert.doesNotMatch(migration, /INSERT INTO public\.order_parcel_(instances|components)/u);
});

test('feature guard fails closed and does not block managing existing rows', () => {
  assert.match(migration, /ELSE 'OFF'/u);
  assert.match(migration, /CONFIGURABLE_PARCEL_DISABLED/u);
  assert.match(migration, /TG_OP = 'INSERT' OR v_old_kind IS DISTINCT FROM v_new_kind/u);
  assert.match(migration, /BEFORE INSERT ON public\.order_parcel_instances/u);
  assert.match(runtime, /Feature OFF did not reject a configurable parcel line/u);
  assert.match(runtime, /featureState/u);
});

test('foundation enforces family, composition, return and accounting snapshots', () => {
  assert.match(migration, /Configurable mixed parcels require a flavor family master/u);
  assert.match(migration, /Parcel component must be a stocked SKU from the configured family/u);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/u);
  assert.match(migration, /uq_sales_return_items_parcel_instance/u);
  assert.match(migration, /net_refundable_amount_snapshot_in_minor_units/u);
  assert.match(migration, /wac_cost_in_minor_units_exact NUMERIC\(24, 6\)/u);
  assert.match(migration, /Reserved high-precision WAC foundation\. Phase 1 does not populate or use this field/u);
});

test('new transactional tables are read-only to clients and mutations remain RPC-only', () => {
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/u);
  assert.match(migration, /REVOKE ALL ON TABLE public\.%I FROM PUBLIC, anon, authenticated/u);
  assert.match(migration, /GRANT SELECT ON TABLE public\.%I TO authenticated/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.assert_configurable_parcel_creation_allowed/u);
  assert.doesNotMatch(migration, /GRANT (INSERT|UPDATE|DELETE|ALL) ON TABLE/iu);
});

test('transaction-local construction cannot leave persistent drafts', () => {
  assert.match(migration, /finalized_at TIMESTAMPTZ/u);
  assert.match(migration, /OLD\.finalized_at IS NOT NULL/u);
  assert.match(migration, /FINALIZED_PARCEL_IMMUTABLE/u);
  assert.match(migration, /PARCEL_IDENTITY_IMMUTABLE/u);
  assert.match(migration, /PARCEL_FINALIZATION_REQUIRES_INTERNAL_PROTOCOL/u);
  assert.match(migration, /FINALIZED_PARCEL_COMPONENT_IMMUTABLE/u);
  assert.match(migration, /finalize_order_parcel_instance_internal/u);
  assert.match(migration, /order_parcel_instance_finalized_at_check/u);
  assert.match(migration, /AFTER INSERT OR UPDATE OF base_quantity, parcel_instance_id OR DELETE/u);
  assert.match(migration, /ARRAY_REMOVE\(ARRAY\[v_old_instance_id, v_new_instance_id\], NULL\)/u);
  assert.match(migration, /ORDER BY instance\.id[\s\S]*FOR UPDATE/u);
  assert.match(migration, /UPDATE OF units_per_parcel_snapshot, finalized_at/u);
  assert.match(runtime, /A finalized component was reparented without changing quantity/u);
  assert.match(runtime, /A finalized component was reparented while changing quantity/u);
  assert.match(runtime, /Transaction-local composition can be rebuilt before the one-way boundary/u);
  assert.match(runtime, /Incomplete parcel composition was accepted/u);
  assert.match(runtime, /Overfilled parcel composition was accepted/u);
  assert.match(runtimeHarness, /assertNoPartialParcelState/u);
  assert.match(runtimeHarness, /finish: 'ROLLBACK'/u);
  assert.match(runtimeHarness, /order_parcel_instance_finalized_at_check/u);
});

test('historical snapshots and original relationships are database immutable', () => {
  assert.match(migration, /guard_order_parcel_instance_history/u);
  assert.match(migration, /guard_order_parcel_component_history/u);
  assert.match(migration, /guard_finalized_order_parcel_item_history/u);
  assert.match(migration, /guard_immutable_parcel_foundation_row/u);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON public\.business_operations/u);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON public\.supplier_receipt_commercial_lines/u);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON public\.sales_return_events/u);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON public\.sales_return_items/u);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON public\.order_inventory_reservations/u);
  assert.match(runtime, /Not every finalized commercial snapshot was immutable/u);
  assert.match(runtime, /Append-only foundation history was mutable/u);
});

test('new-model shape constraints require every conditional field explicitly', () => {
  assert.match(migration, /commercial_line_kind <> 'configurable_parcel'[\s\S]*parcel_configuration_revision IS NOT NULL/u);
  assert.match(migration, /commercial_line_kind <> 'configurable_parcel'[\s\S]*NULLIF\(BTRIM\(base_unit_name_snapshot\), ''\) IS NOT NULL/u);
  assert.match(migration, /line_kind <> 'configurable_parcel'[\s\S]*configuration_revision IS NOT NULL[\s\S]*units_per_parcel_snapshot IS NOT NULL/u);
  assert.match(migration, /purchase_order_items_configurable_shape_check[\s\S]*commercial_line_kind <> 'configurable_parcel'[\s\S]*configuration_revision IS NOT NULL[\s\S]*parcel_quantity IS NOT NULL/u);
  assert.match(runtime, /Conditional required fields accepted NULL values/u);
});

test('historical revision lifecycle and relational ownership chains are preserved', () => {
  assert.match(migration, /BEFORE INSERT OR UPDATE OF[\s\S]*parcel_configuration_id,[\s\S]*family_product_id,[\s\S]*configuration_revision/u);
  assert.match(migration, /FOREIGN KEY \(order_item_id, order_id\)/u);
  assert.match(migration, /FOREIGN KEY \(parcel_instance_id, order_item_id\)/u);
  assert.match(migration, /FOREIGN KEY \(sales_return_event_id, order_id, operation_id\)/u);
  assert.match(migration, /FOREIGN KEY \(order_item_id, product_id\)/u);
  assert.match(migration, /FOREIGN KEY \(parcel_instance_id, product_id, operation_id\)/u);
  assert.match(migration, /FOREIGN KEY \(parcel_component_id, product_id, operation_id\)/u);
  assert.match(migration, /inventory_movements_parcel_identity_shape_check/u);
  assert.match(migration, /validate_order_inventory_reservation_chain/u);
  assert.match(migration, /order_inventory_reservations_base_product_check/u);
  assert.match(migration, /order_inventory_reservations_parcel_required_check/u);
  assert.match(migration, /RESERVED_ORDER_ITEM_IMMUTABLE/u);
  assert.match(migration, /validate_inventory_movement_source_chain/u);
  assert.match(migration, /inventory_movements_source_chain_check/u);
  assert.match(migration, /inventory_movements_reservation_warehouse_check/u);
  assert.match(migration, /validate_supplier_receipt_item_commercial_family/u);
  assert.match(migration, /validate_sales_return_item_line_kind/u);
  assert.match(migration, /order_parcel_instances_order_item_kind_check/u);
  assert.match(migration, /sales_return_items_base_line_kind_check/u);
  assert.match(migration, /sales_return_items_parcel_line_kind_check/u);
  assert.match(migration, /sales_return_items_original_parcel_check/u);
  assert.match(migration, /sales_return_items_supported_line_kind_check/u);
  assert.match(migration, /RETURNED_ORDER_ITEM_IMMUTABLE/u);
  assert.match(migration, /FOREIGN KEY \(\s*commercial_line_id,\s*supplier_receipt_id,\s*operation_id\s*\)/u);
  assert.match(runtime, /Historical revision snapshot changed with current configuration/u);
  assert.match(runtime, /Cross-chain relationships were not rejected consistently/u);
});

test('runtime coverage proves commit cleanup, ownership failures and observed locks', () => {
  assert.match(runtimeHarness, /const assertSqlFailureIdentity/u);
  assert.match(runtimeHarness, /Expected PostgreSQL SQLSTATE/u);
  assert.match(runtimeHarness, /CONSTRAINT NAME/u);
  assert.doesNotMatch(runtimeHarness, /pattern:/u);
  assert.match(runtimeHarness, /base reservation product mismatch/u);
  assert.match(runtimeHarness, /parcel reservation missing Parcel identity/u);
  assert.match(runtimeHarness, /reservation product mismatch/u);
  assert.match(runtimeHarness, /movement NULL operation bypass/u);
  assert.match(runtimeHarness, /movement component product mismatch/u);
  assert.match(runtimeHarness, /movement cross-Parcel source mismatch/u);
  assert.match(runtimeHarness, /movement reservation warehouse mismatch/u);
  assert.match(runtimeHarness, /base return wrong SKU/u);
  assert.match(runtimeHarness, /supplier Family configuration mismatch/u);
  assert.match(runtimeHarness, /supplier component product mismatch/u);
  assert.match(runtimeHarness, /movement operation chain mismatch/u);
  assert.match(runtimeHarness, /baseParcelAttempt/u);
  assert.match(runtimeHarness, /finalizedBaseParcelAttempt/u);
  assert.match(runtimeHarness, /finalizedParcelKindMutation/u);
  assert.match(runtimeHarness, /Base Unit return from configurable Parcel line/u);
  assert.match(runtimeHarness, /Parcel return from Base Unit line/u);
  assert.match(runtimeHarness, /Parcel return with wrong Parcel Instance/u);
  assert.match(runtimeHarness, /legacyNullParcelAttempt/u);
  assert.match(runtimeHarness, /legacySingleSkuParcelAttempt/u);
  assert.match(runtimeHarness, /legacy NULL line new Return Item/u);
  assert.match(runtimeHarness, /legacy single-SKU line new Return Item/u);
  assert.match(runtimeHarness, /return_item_builder_lock_test/u);
  assert.match(runtimeHarness, /return_item_mutator_lock_test/u);
  assert.match(runtimeHarness, /returnedProductFixture/u);
  assert.match(runtimeHarness, /RETURNED_ORDER_ITEM_IMMUTABLE/u);
  assert.match(runtimeHarness, /strictErrorIdentity: true/u);
  assert.match(runtimeHarness, /rejectedCasesPreservedHistory: true/u);
  assert.match(runtimeHarness, /returnRaceSerialized: true/u);
  assert.match(runtimeHarness, /positiveControlsPassed: true/u);
  assert.match(runtimeHarness, /concurrentConflictsRejected: true/u);
  assert.match(runtimeHarness, /baseReservationRaceSerialized: true/u);
  assert.match(runtimeHarness, /base_reservation_item_mutator_test/u);
  assert.match(runtimeHarness, /concurrentRelationshipState/u);
  assert.match(runtimeHarness, /wait_event_type = 'Lock'/u);
  assert.match(runtimeHarness, /mutatorWaiting/u);
  assert.doesNotMatch(runtimeHarness, /setTimeout\(resolve, 300\)/u);
});

test('feature states and role-aware RLS are exercised behaviorally', () => {
  assert.match(runtime, /OWNER_PILOT allowed a cashier/u);
  assert.match(runtime, /OFF allowed new configurable parcel creation/u);
  assert.match(runtime, /SET LOCAL ROLE authenticated/u);
  assert.match(runtime, /Active owner could not read parcel foundation through RLS/u);
  assert.match(runtime, /Inactive staff bypassed parcel foundation RLS/u);
  assert.match(runtime, /Authenticated client obtained a direct business write/u);
});

test('the parcel runtime suite is mandatory in a bounded canonical CI job', () => {
  assert.match(packageManifest, /"test:db:runtime": "tsx --test tests\/database-runtime-suite\.ts"/u);
  assert.match(packageManifest, /"test:parcel-foundation:runtime": "node scripts\/testing\/run-configurable-parcel-foundation-runtime\.mjs"/u);
  assert.match(qualityWorkflow, /database-runtime:[\s\S]*timeout-minutes: 35/u);
  assert.match(qualityWorkflow, /run: npm run test:db:runtime/u);
});
