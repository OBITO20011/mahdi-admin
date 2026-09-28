import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migration121Path = new URL(
  '../supabase/migrations/121_phase42_atomic_return_coordinator.sql', import.meta.url,
);
const migration122Path = new URL(
  '../supabase/migrations/122_phase43_admin_aftercare_integration.sql', import.meta.url,
);
const migration121 = readFileSync(migration121Path);
const migration122 = readFileSync(migration122Path, 'utf8');
const aftercareService = readFileSync(new URL(
  '../src/services/supabase/salesAftercare.service.ts', import.meta.url,
), 'utf8');
const aftercareRecovery = readFileSync(new URL(
  '../src/services/supabase/adminAftercareRecovery.ts', import.meta.url,
), 'utf8');
const aftercarePanel = readFileSync(new URL(
  '../src/features/orders/AdminAftercarePanel.tsx', import.meta.url,
), 'utf8');
const orderModal = readFileSync(new URL(
  '../src/features/orders/OrderDetailModal.tsx', import.meta.url,
), 'utf8');
const canonicalRuntime = readFileSync(new URL(
  './database-runtime-suite.ts', import.meta.url,
), 'utf8');
const qualityWorkflow = readFileSync(new URL(
  '../.github/workflows/quality.yml', import.meta.url,
), 'utf8');
const migrations = readdirSync(new URL('../supabase/migrations/', import.meta.url)).sort();

const canonicalHash = (name: string, bytes: Uint8Array) => createHash('sha256')
  .update(Buffer.from(name))
  .update(Buffer.from([0]))
  .update(Buffer.from(bytes).toString('utf8').replaceAll('\r\n', '\n'))
  .digest('hex').toUpperCase();

const body = (name: string) => migration122.match(
  new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'u'),
)?.[0] ?? '';

test('Migration 122 is bounded and preserves the approved Phase 4.2 migration', () => {
  assert.equal(
    canonicalHash('121_phase42_atomic_return_coordinator.sql', migration121),
    '56366C43C264D8203B5C26F09F42C699E7602000F359EE2CCDBF0D001362D302',
  );
  assert.equal(migrations.filter((name) => name.startsWith('122_')).length, 1);
  assert.equal(migrations.some((name) => name.startsWith('123_')), false);
  assert.match(migration122, /^BEGIN;/u);
  assert.match(migration122, /COMMIT;\s*$/u);
  assert.match(canonicalRuntime, /run-phase42-atomic-return-runtime\.mjs/u);
  assert.match(qualityWorkflow, /Run Phase 4\.3 Admin aftercare runtime contract[\s\S]*?npm run test:phase43-aftercare:runtime/u);
});

test('operational issuance is distinct from foundation settlement', () => {
  assert.match(migration122, /issuance_coordinator_version SMALLINT/u);
  assert.match(migration122, /issuance_status TEXT NOT NULL DEFAULT 'not_issued'/u);
  assert.match(migration122, /issuance_status = 'issued'[\s\S]*?issuance_coordinator_version IS NOT DISTINCT FROM 403/u);
  assert.match(migration122, /PHASE43_REPLACEMENT_NOT_ISSUED/u);
  assert.match(migration122, /foundation_only/u);
});

test('replacement coordinator is replay-first and root/product serialized', () => {
  const coordinator = body('settle_sales_replacement_v1');
  assert.ok(coordinator.length > 0);
  assert.ok(coordinator.indexOf('assert_erp_role') < coordinator.indexOf('phase43_resolve_replacement_replay_internal'));
  assert.ok(coordinator.indexOf('phase43_resolve_replacement_replay_internal') < coordinator.indexOf('phase4_lock_customer_order_context_internal'));
  assert.ok(coordinator.indexOf('phase4_lock_customer_order_context_internal') < coordinator.indexOf('phase2_lock_inventory_products_internal'));
  assert.ok(coordinator.indexOf('phase2_lock_inventory_products_internal') < coordinator.indexOf('phase4_authoritative_completion_internal'));
  assert.match(coordinator, /clock_timestamp\(\) > v_completion_at \+ INTERVAL '48 hours'/u);
});

test('same SKU and quantity come from authoritative immutable sources', () => {
  const coordinator = body('settle_sales_replacement_v1');
  assert.match(coordinator, /item\.product_id, item\.quantity/u);
  assert.match(coordinator, /component\.product_id, component\.base_quantity/u);
  assert.match(coordinator, /item\.product_id, item\.quantity, item\.id/u);
  assert.match(coordinator, /v_quantity > v_capacity/u);
  assert.doesNotMatch(body('phase43_canonicalize_replacement_request_internal'), /productId|price|refund|debt/iu);
});

test('replacement inventory outflow snapshots exact issuance-time WAC without repricing the sale', () => {
  const coordinator = body('settle_sales_replacement_v1');
  assert.match(coordinator, /product\.wac_cost_in_minor_units_exact/u);
  assert.match(coordinator, /available_quantity/u);
  assert.match(coordinator, /'sales_deduction'/u);
  assert.match(coordinator, /'phase4_replacement_item'/u);
  assert.doesNotMatch(coordinator, /SET wac_cost_in_minor_units_exact/u);
  assert.doesNotMatch(coordinator, /UPDATE public\.orders|UPDATE public\.customer_payments/iu);
  assert.match(migration122, /phase43_replacement_inventory_effects/u);
  assert.match(migration122, /phase43_replacement_settlement_evidence/u);
});

test('durable evidence is independently required by finalization and replay', () => {
  const assertion = body('phase43_assert_operational_replacement_evidence_internal');
  const finalizer = body('phase4_finalize_aftercare_operation_internal');
  const replay = body('phase43_resolve_replacement_replay_internal');
  assert.match(assertion, /phase43_replacement_settlement_evidence/u);
  assert.match(assertion, /phase43_replacement_inventory_effects/u);
  assert.match(assertion, /inventory_movements/u);
  assert.match(assertion, /replacement_unit_cost_snapshot_in_minor_units_exact/u);
  assert.match(assertion, /consumption\.source_kind = effect\.source_kind/u);
  assert.match(assertion, /request_item->>'source_id'.*effect\.source_id/su);
  assert.match(assertion, /effect\.warehouse_id = v_event\.warehouse_id/u);
  assert.match(assertion, /v_event\.warehouse_id IS DISTINCT FROM v_order\.warehouse_id/u);
  assert.match(assertion, /ROUND\(item\.replacement_unit_cost_snapshot_in_minor_units_exact \* item\.quantity\)::BIGINT/u);
  assert.match(assertion, /consumption\.consumption_state = CASE[\s\S]*?'settled'[\s\S]*?'draft'/u);
  assert.match(assertion, /item\.root_order_item_id = root_item\.id/u);
  assert.match(assertion, /item\.root_parcel_component_id = root_component\.id/u);
  assert.match(assertion, /source_event\.root_order_id = v_event\.root_order_id/u);
  assert.match(assertion, /item\.parent_replacement_item_id = source_replacement\.id/u);
  assert.match(assertion, /result_snapshot->>'issuedQuantity'[\s\S]*?v_issued_quantity/u);
  assert.match(assertion, /result_snapshot->>'replacementCogsInMinorUnits'[\s\S]*?v_replacement_cogs/u);
  assert.match(assertion, /v_consumption_count IS DISTINCT FROM v_expected_count/u);
  assert.match(assertion, /v_effect_count IS DISTINCT FROM v_expected_count/u);
  assert.match(assertion, /v_movement_count IS DISTINCT FROM v_expected_count/u);
  assert.match(assertion, /v_operation_consumption_count IS DISTINCT FROM v_expected_count/u);
  assert.match(assertion, /COUNT\(DISTINCT item\.id\)/u);
  assert.match(assertion, /v_covered_item_count IS DISTINCT FROM v_expected_count/u);
  assert.match(assertion, /consumption\.replacement_item_id = item\.id\) <> 1/u);
  assert.match(assertion, /NOT EXISTS \([\s\S]*?item\.id = consumption\.replacement_item_id/u);
  assert.match(assertion, /inventory_movements movement[\s\S]*?movement\.operation_id = p_operation_id/u);
  assert.match(finalizer, /phase43_replacement_issuance_guards/u);
  assert.match(finalizer, /phase43_assert_operational_replacement_evidence_internal/u);
  assert.match(replay, /phase43_assert_operational_replacement_evidence_internal/u);
  assert.match(replay, /true/u);
});

test('only public Admin contracts are granted and internal evidence stays private', () => {
  assert.match(migration122, /GRANT EXECUTE ON FUNCTION public\.settle_sales_replacement_v1[\s\S]*?TO authenticated/u);
  assert.match(migration122, /GRANT EXECUTE ON FUNCTION public\.get_admin_sales_aftercare_context_v1[\s\S]*?TO authenticated/u);
  assert.match(migration122, /REVOKE ALL ON TABLE public\.phase43_replacement_inventory_effects[\s\S]*?authenticated/u);
  assert.match(migration122, /'public\.phase42_assert_operational_return_evidence_internal\(uuid,boolean\)'::REGPROCEDURE/u);
  assert.doesNotMatch(migration122, /GRANT (?:INSERT|UPDATE|DELETE).*phase43_/iu);
});

test('later Return follows the current physical leaf while preserving original-sale refund truth', () => {
  const adapter = body('settle_admin_sales_return_v1');
  const rebind = body('phase43_rebind_return_consumption_to_leaf');
  const values = body('phase43_return_inventory_sources_internal');
  assert.match(adapter, /phase43_return_physical_sources/u);
  assert.match(adapter, /settle_sales_return_v1/u);
  assert.match(rebind, /phase4_aftercare_source_root_internal|phase43_assert_return_physical_source_internal/u);
  assert.match(rebind, /pg_trigger_depth\(\) > 1/u);
  assert.doesNotMatch(rebind, /phase43_lineage_split_operation_id/u);
  assert.match(rebind, /RETURN NULL/u);
  assert.match(values, /replacement_unit_cost_snapshot_in_minor_units_exact/u);
  assert.doesNotMatch(values, /wac_cost_in_minor_units_exact/u);
  assert.match(migration122, /PHASE43_RETURN_PHYSICAL_LINEAGE_REQUIRED/u);
  assert.match(migration122, /sellable_restock_quantity/u);
  assert.match(migration122, /defect_non_sellable_quantity/u);
  assert.match(migration122, /customer_damage_quantity/u);
  assert.match(migration122, /phase43_assert_return_physical_evidence_set_internal/u);
});

test('Admin read model exposes current physical representatives and public mutation contracts', () => {
  const readModel = body('get_admin_sales_aftercare_context_v1');
  const legacyBranch = readModel.indexOf("'legacy_website_return_v1'");
  const modernCompletion = readModel.indexOf('phase4_authoritative_completion_internal');
  assert.ok(legacyBranch >= 0 && legacyBranch < modernCompletion);
  assert.match(readModel, /v_order\.operation_id IS NULL AND v_order\.source = 'website'[\s\S]*?'legacy_website_return_v1'/u);
  assert.match(readModel, /v_order\.operation_id IS NULL AND v_order\.source = 'pos'[\s\S]*?'legacy_pos_v1_unsupported'/u);
  assert.match(readModel, /ELSE 'unsupported_contract'/u);
  assert.match(readModel, /'financial', NULL/u);
  assert.match(readModel, /phase43_current_physical_representatives_internal/u);
  assert.match(readModel, /'supported'/u);
  assert.match(readModel, /'capability', 'phase43_modern'/u);
  assert.match(aftercareService, /get_admin_sales_aftercare_context_v1/u);
  assert.match(aftercareService, /supportBindingValid/u);
  assert.match(aftercareService, /settle_admin_sales_return_v1/u);
  assert.match(aftercareService, /settle_sales_replacement_v1/u);
  assert.doesNotMatch(aftercareService, /from\(['"](?:inventory|sales_return|sales_replacement)/u);
});

test('Admin recovery persists stable identity and retries ambiguous outcomes through the same key', () => {
  assert.match(aftercareRecovery, /OUTCOME_UNKNOWN/u);
  assert.match(aftercareRecovery, /hadUnknownOutcome/u);
  assert.match(aftercareRecovery, /idempotencyKey/u);
  assert.match(aftercareRecovery, /intentId/u);
  assert.match(aftercareRecovery, /requestFingerprint/u);
  assert.match(aftercareRecovery, /START_NEW/u);
  assert.match(aftercareRecovery, /RECOVER_EXISTING/u);
  assert.match(aftercareRecovery, /sameAttemptIdentity/u);
  assert.match(aftercareRecovery, /const capturedRequest = submittedRequest === null/u);
  assert.match(aftercareRecovery, /value\.issuedQuantity === expectedQuantity/u);
  assert.match(aftercareRecovery, /moneyRefund !== entitlement - debtReduction/u);
  assert.match(aftercareRecovery, /requestedMethod === null && requestedReference === null/u);
  assert.match(aftercareRecovery, /attempt\.status === 'IN_FLIGHT'/u);
  assert.match(aftercareRecovery, /withAdminActionLock/u);
  assert.match(aftercareRecovery, /definitiveRejectionSqlStates/u);
  assert.match(aftercareRecovery, /'P0001', '22023', '23503', '23514'/u);
  assert.match(aftercareRecovery, /PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED/u);
  assert.match(aftercareRecovery, /PHASE4_RETURN_WINDOW_EXPIRED/u);
  assert.match(aftercareRecovery, /PHASE4_REPLACEMENT_WINDOW_INVALID/u);
  assert.match(aftercareRecovery, /!fresh\.hadUnknownOutcome/u);
  assert.match(aftercareRecovery, /definitiveRejections\[action\]\.has\(identity\)/u);
  assert.match(aftercareRecovery, /status: 'OUTCOME_UNKNOWN', hadUnknownOutcome: true/u);
  assert.match(aftercareRecovery, /attempt\.idempotencyKey/u);
  assert.doesNotMatch(aftercareRecovery, /localStorage\.removeItem/u);
});

test('modern Admin UI uses Phase 4.3 contracts while Legacy capabilities remain explicitly separated', () => {
  assert.match(aftercarePanel, /phase43-admin-aftercare/u);
  assert.match(aftercarePanel, /settleAdminReplacement/u);
  assert.match(aftercarePanel, /settleAdminReturn/u);
  assert.match(aftercarePanel, /خفض ذمة فقط/u);
  assert.match(aftercarePanel, /allocations: Record<string, LeafAllocation>/u);
  assert.match(aftercarePanel, /sellableRestock/u);
  assert.match(aftercarePanel, /defectNonSellable/u);
  assert.match(aftercarePanel, /customerDamage/u);
  assert.match(aftercarePanel, /recoverAdminAftercare/u);
  assert.match(aftercarePanel, /result\.data\.capability/u);
  assert.match(orderModal, /<AdminAftercarePanel/u);
  assert.match(orderModal, /aftercareCapability === 'legacy_website_return_v1'/u);
  assert.match(orderModal, /aftercareCapability === 'legacy_pos_v1_unsupported'/u);
  assert.match(orderModal, /aftercareCapability === 'unsupported_contract'/u);
  assert.doesNotMatch(orderModal, /aftercareSupported === false/u);
});
