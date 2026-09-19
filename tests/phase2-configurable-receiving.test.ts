import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildLegacyReceiptFailClosedResult,
  LEGACY_RECEIPT_RESOLVER_TIMEOUT_MS,
} from '../src/services/supabase/directReceiving.service';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/113_configurable_parcel_receiving_and_exact_wac.sql',
    import.meta.url,
  ),
  'utf8',
);
const runtimeSql = readFileSync(
  new URL('../scripts/testing/phase2-configurable-receiving-runtime.sql', import.meta.url),
  'utf8',
);
const runtimeHarness = readFileSync(
  new URL('../scripts/testing/run-phase2-configurable-receiving-runtime.mjs', import.meta.url),
  'utf8',
);
const packageManifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
const databaseSuite = readFileSync(
  new URL('./database-runtime-suite.ts', import.meta.url),
  'utf8',
);
const directReceivingService = readFileSync(
  new URL('../src/services/supabase/directReceiving.service.ts', import.meta.url),
  'utf8',
);
const directReceivingModal = readFileSync(
  new URL('../src/features/directReceiving/CreateDirectReceiptModal.tsx', import.meta.url),
  'utf8',
);
const qualityWorkflow = readFileSync(
  new URL('../.github/workflows/quality.yml', import.meta.url),
  'utf8',
);

test('Legacy receipt recovery enrichment preserves fail-closed state on success', async () => {
  const requestedKeys: string[] = [];
  const result = await buildLegacyReceiptFailClosedResult('legacy-key-success', {
    timeoutMs: 50,
    resolver: async (key) => {
      requestedKeys.push(key);
      return {
        found: true,
        receiptId: 'receipt-1',
        receiptNumber: 'REC-001',
        totalInMinorUnits: 1500,
      };
    },
  });

  assert.deepEqual(requestedKeys, ['legacy-key-success']);
  assert.equal(result.success, false);
  assert.equal(result.sqlState, 'P0001');
  assert.equal(result.errorCode, 'LEGACY_IDEMPOTENCY_IDENTITY_UNPROVEN');
  assert.equal(result.recovery.found, true);
  assert.match(result.error, /REC-001/u);
});

test('Legacy receipt recovery exception preserves the safe blocked response', async () => {
  const result = await buildLegacyReceiptFailClosedResult('legacy-key-exception', {
    timeoutMs: 50,
    resolver: async () => {
      throw new Error('sensitive transport detail');
    },
  });

  assert.equal(result.sqlState, 'P0001');
  assert.equal(result.errorCode, 'LEGACY_IDEMPOTENCY_IDENTITY_UNPROVEN');
  assert.deepEqual(result.recovery, { found: false });
  assert.doesNotMatch(result.error, /sensitive transport detail/u);
});

test('Legacy receipt resolver uses one bounded attempt and the modal keeps submission blocked', () => {
  assert.equal(LEGACY_RECEIPT_RESOLVER_TIMEOUT_MS, 4_000);
  assert.match(directReceivingService, /error\.code === 'P0001'/u);
  assert.match(directReceivingService, /return buildLegacyReceiptFailClosedResult/u);
  assert.doesNotMatch(directReceivingService,
    /LEGACY_IDEMPOTENCY_IDENTITY_UNPROVEN[\s\S]{0,800}crypto\.randomUUID/u);
  assert.equal(
    directReceivingModal.match(/idempotencyKeyRef\.current = crypto\.randomUUID\(\)/gu)?.length,
    1,
  );
  assert.match(directReceivingModal,
    /if \(res\.success && res\.data\)[\s\S]*idempotencyKeyRef\.current = crypto\.randomUUID\(\)/u);
  assert.match(directReceivingModal, /if \(!isMountedRef\.current\) return;/u);
  assert.match(directReceivingModal,
    /disabled=\{isSubmitting \|\| items\.length === 0 \|\| legacyReplayResolution !== null\}/u);
});

test('migration 113 is transactional, additive and keeps legacy history untouched', () => {
  assert.match(migration, /^BEGIN;/u);
  assert.match(migration, /COMMIT;\s*$/u);
  assert.doesNotMatch(migration, /DROP (TABLE|COLUMN|FUNCTION|TYPE)/iu);
  assert.doesNotMatch(migration, /UPDATE public\.supplier_receipts\s+SET\s+phase2_finalized_at/iu);
});

test('direct and purchase-order receiving use explicit versioned RPC contracts', () => {
  assert.match(migration, /CREATE FUNCTION public\.create_direct_supplier_receipt_v2/u);
  assert.match(migration, /CREATE FUNCTION public\.create_purchase_order_v2/u);
  assert.match(migration, /CREATE FUNCTION public\.receive_purchase_order_v2/u);
  assert.match(migration, /p_idempotency_key TEXT DEFAULT NULL/u);
  assert.match(migration, /p_lines JSONB DEFAULT '\[\]'::JSONB/u);
});

test('feature OFF blocks only configurable parcel creation and OWNER_PILOT stays role aware', () => {
  assert.match(migration, /PERFORM public\.assert_configurable_parcel_creation_allowed\(\)/u);
  assert.match(migration, /v_line_kind = 'configurable_parcel'/u);
  assert.match(runtimeHarness, /baseUnitWhileFeatureOff: true/u);
  assert.match(runtimeHarness, /CONFIGURABLE_PARCEL_DISABLED/u);
  assert.match(runtimeHarness, /userId: WAREHOUSE_KEEPER/u);
});

test('commercial parcel receipts decompose into stocked SKU components only', () => {
  assert.match(migration, /phase2_receipt_stocked_sku_check/u);
  assert.match(migration, /phase2_receipt_component_family_check/u);
  assert.match(migration, /phase2_receipt_parcel_configuration_check/u);
  assert.match(migration, /phase2_receipt_parcel_capacity_check/u);
  assert.match(migration, /v_component_quantity[\s\S]*v_commercial_quantity::NUMERIC \* v_units_per_parcel::NUMERIC/u);
  assert.doesNotMatch(migration, /parcel_(stock|inventory)_balance/iu);
});

test('receipt money follows two-stage deterministic allocation with exact reconciliation', () => {
  assert.match(migration, /CREATE FUNCTION public\.phase2_allocate_largest_remainder_internal/u);
  assert.match(migration, /v_line_acquisition := v_line_net - v_line_header_discount \+ v_line_freight/u);
  assert.match(migration, /v_component_merchandise_allocations/u);
  assert.match(migration, /v_component_final_allocations/u);
  assert.match(migration, /SUM\(line\.final_acquisition_amount_in_minor_units\)/u);
  assert.match(migration, /SUM\(item\.allocated_cost_in_minor_units\)/u);
  assert.match(runtimeHarness, /lineAllocation/u);
  assert.match(runtimeHarness, /componentAllocation/u);
});

test('payment is bounded by payable and no supplier credit is inferred', () => {
  assert.match(migration, /phase2_payment_upper_bound_check/u);
  assert.match(migration, /v_outstanding := v_invoice_payable - p_amount_paid_at_receipt_in_minor_units::NUMERIC/u);
  assert.doesNotMatch(migration, /supplier_(credit|advance)/iu);
  assert.match(runtimeHarness, /overpaymentZeroWrites: true/u);
  assert.match(runtimeHarness, /zeroCostAndZeroBasis: true/u);
  assert.match(runtimeHarness, /repeatedSkuLinesAggregated: true/u);
});

test('explicit component costing is complete, exact and never silently inferred', () => {
  assert.match(migration, /phase2_component_cost_completeness_check/u);
  assert.match(migration, /phase2_component_merchandise_cost_total_check/u);
  assert.match(migration, /PARTIAL_EXPLICIT_COMPONENT_COST/u);
  assert.match(migration, /EXPLICIT_COMPONENT_COST_MISMATCH/u);
  assert.doesNotMatch(migration, /explicit_merchandise_cost[\s\S]{0,400}(current_wac|sale_price|default_purchase)/iu);
});

test('global SKU WAC is exact, deterministic and projected to legacy compatibility', () => {
  assert.match(migration, /v_new_exact NUMERIC\(24, 6\)/u);
  assert.match(migration, /ROUND\([\s\S]*, 6\)/u);
  assert.match(migration, /v_new_legacy := ROUND\(v_new_exact\)::BIGINT/u);
  assert.match(migration, /cost_price_in_minor_units = v_new_legacy/u);
  assert.match(migration, /ORDER BY balance\.product_id, balance\.warehouse_id\s+FOR UPDATE/u);
  assert.match(migration, /phase2_lock_inventory_products_internal/u);
  assert.match(migration, /inventory-product:/u);
  assert.match(migration, /wac_cost_in_minor_units_exact = v_new_exact/u);
  assert.match(runtimeHarness, /legacyV2MixedWacCoherent: true/u);
  assert.match(runtimeHarness, /exactWacPrecision: true/u);
});

test('operation identity, request fingerprint and supplier invoice identity are separate', () => {
  assert.match(migration, /phase2_request_fingerprint_internal/u);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\([\s\S]*supplier_receipt:/u);
  assert.match(migration, /LEGACY_IDEMPOTENCY_IDENTITY_UNPROVEN/u);
  assert.match(migration, /IDEMPOTENCY_CONFLICT/u);
  assert.match(migration, /CREATE TABLE public\.supplier_financial_invoice_identities/u);
  assert.match(migration, /uq_supplier_financial_invoice_active/u);
  assert.match(runtimeHarness, /canonicalReplayZeroWrites: true/u);
});

test('purchase order quantities preserve parcel and base-unit semantics independently', () => {
  assert.match(migration, /received_parcel_quantity INTEGER NOT NULL DEFAULT 0/u);
  assert.match(migration, /ordered_quantity = parcel_quantity \* units_per_parcel_snapshot/u);
  assert.match(migration, /received_quantity = received_quantity \+ v_received_base_quantity/u);
  assert.match(migration, /received_parcel_quantity = received_parcel_quantity/u);
  assert.match(runtimeHarness, /commercialAndBaseQuantities: true/u);
  assert.match(runtimeHarness, /partialThenComplete: true/u);
});

test('finalized financial and inventory history is immutable and corrected by reversal', () => {
  assert.match(migration, /PHASE2_FINANCIAL_SNAPSHOT_IMMUTABLE/u);
  assert.match(migration, /PHASE2_RECEIPT_DETAIL_IMMUTABLE/u);
  assert.match(migration, /SUPPLIER_INVOICE_IDENTITY_IMMUTABLE/u);
  assert.match(migration, /CREATE FUNCTION public\.phase2_reverse_inventory_and_wac_internal/u);
  assert.match(migration, /reversed_movement_id/u);
  assert.match(runtimeHarness, /failedMutationPreservedTimestamp: true/u);
});

test('new Phase 2 tables and internal helpers preserve RPC-only write architecture', () => {
  assert.match(migration, /ALTER TABLE public\.%I ENABLE ROW LEVEL SECURITY/u);
  assert.match(migration, /REVOKE ALL ON TABLE public\.%I FROM PUBLIC, anon, authenticated/u);
  assert.match(migration, /GRANT SELECT ON TABLE public\.%I TO authenticated/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.phase2_apply_inventory_and_wac_internal/u);
  assert.match(runtimeSql, /'directClientWrites'/u);
});

test('runtime tests prove strict failures, zero-write cleanup, replay and concurrency', () => {
  assert.match(runtimeHarness, /assertSqlFailureIdentity/u);
  assert.match(runtimeHarness, /phase2_payment_upper_bound_check/u);
  assert.match(runtimeHarness, /phase2_receipt_parcel_capacity_check/u);
  assert.match(runtimeHarness, /phase2_component_cost_completeness_check/u);
  assert.match(runtimeHarness, /countBusinessState/u);
  assert.match(runtimeHarness, /waitForDatabaseWait/u);
  assert.match(runtimeHarness, /pg_stat_activity/u);
  assert.match(runtimeHarness, /deadlocksObserved: 0/u);
  assert.match(runtimeHarness, /concurrentDifferentPayloadConflict: true/u);
  assert.match(runtimeHarness, /sameSkuReceiptsSerialized: true/u);
  assert.match(runtimeHarness, /directAndPoCrossPathSerialized: true/u);
  assert.match(runtimeHarness, /receiptAndPosSerialized: true/u);
  assert.match(runtimeHarness, /receiptAndTransferSerialized: true/u);
  assert.match(runtimeHarness, /AMBIGUOUS_PREPAID_PO/u);
  assert.match(runtimeHarness, /uq_supplier_financial_invoice_active/u);
});

test('Phase 2 runtime is wired into the existing bounded canonical DB pipeline', () => {
  assert.match(packageManifest, /"test:phase2-receiving:runtime"/u);
  assert.match(databaseSuite, /run-phase2-configurable-receiving-runtime\.mjs/u);
  assert.match(databaseSuite, /migrationRebuild.*001-113/u);
  assert.match(qualityWorkflow, /database-runtime:[\s\S]*timeout-minutes: 35/u);
  assert.match(qualityWorkflow, /run: npm run test:db:runtime/u);
});

test('corrective zero-cost and internal lock regressions are permanent runtime gates', () => {
  assert.match(migration, /PHASE2_LEGACY_COST_REQUIRED/u);
  assert.match(migration, /PHASE2_LEGACY_COST_INVALID/u);
  assert.doesNotMatch(migration, /WHEN \(item->>'unit_cost_in_minor_units'\)::BIGINT > 0/u);
  assert.match(migration, /CREATE FUNCTION public\.phase2_lock_payment_shift_internal/u);
  assert.match(migration, /v_payment_method TEXT := COALESCE\(p_payment_method, 'cash'\)/u);
  assert.match(migration, /p_branch_id, v_payment_method, p_amount_paid_in_minor_units/u);
  assert.match(migration, /COALESCE\(p_payment_method, ''cash''\)/u);
  assert.doesNotMatch(migration,
    /phase2_lock_payment_shift_internal\([\s\S]{0,250}LOWER\(BTRIM\(p_payment_method\)\)/u);
  assert.match(runtimeHarness, /expectedSequentialWac/u);
  assert.match(runtimeHarness, /createGateConnection/u);
  assert.match(runtimeHarness, /exactMessage: 'لا يمكن عكس البيع بعد وجود حركة مخزون لاحقة على أحد أصنافه\.'/u);
  assert.match(runtimeHarness, /legacyZeroCostShapesVerified: true/u);
  assert.match(runtimeHarness, /paidReceiptAndPosReversalInternalSerialization: true/u);
  assert.match(runtimeHarness, /paidReplayAfterShiftClosedZeroWrites: true/u);
  assert.match(runtimeHarness, /receiptKind === 'legacy-null' \? 'NULL' : "'cliq'"/u);
  assert.match(runtimeHarness, /legacyNullReplayAfterShiftClosedZeroWrites: true/u);
  assert.match(runtimeHarness, /paidDeadlockDelta/u);
  assert.match(databaseSuite, /legacyZeroCostShapesVerified/u);
  assert.match(databaseSuite, /legacyPaymentInputShapesVerified/u);
  assert.match(databaseSuite, /paidReceiptAndPosReversalInternalSerialization/u);
  assert.match(databaseSuite, /paidReplayAfterShiftClosedZeroWrites/u);
  assert.match(databaseSuite, /legacyNullReplayAfterShiftClosedZeroWrites/u);
});

test('owner policy fails closed for pre-113 keys and preserves safe recovery', () => {
  assert.match(migration, /SUPPLIER_PAYMENT_METHOD_REQUIRED/u);
  assert.match(migration, /NEW\.payment_method IS NULL/u);
  assert.match(migration, /supplier_receipt_legacy_v113/u);
  assert.match(migration, /request_identity_version SMALLINT/u);
  assert.match(migration, /request_identity_snapshot JSONB/u);
  assert.match(migration, /phase2_canonicalize_legacy_receipt_items_internal/u);
  assert.match(migration, /ORDER BY item\.ordinality/u);
  assert.match(migration, /received_at_mode/u);
  assert.match(migration, /LEGACY_REQUEST_IDENTITY_PERSIST_FAILED/u);
  assert.match(migration, /Pre-113 receipts do not retain enough immutable request evidence/u);
  assert.match(migration, /LEGACY_IDEMPOTENCY_IDENTITY_UNPROVEN/u);
  assert.match(migration, /resolve_legacy_supplier_receipt_replay_v1/u);
  assert.match(migration,
    /resolve_legacy_supplier_receipt_replay_v1[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = public, pg_temp/u);
  assert.match(migration,
    /REVOKE ALL ON FUNCTION public\.resolve_legacy_supplier_receipt_replay_v1\(UUID\)[\s\S]*FROM PUBLIC, anon/u);
  assert.match(migration,
    /RETURN v_existing_operation\.result_snapshot[\s\S]*jsonb_build_object\('is_duplicate', true\)/u);
  assert.match(runtimeHarness, /expectFailureBeforeGateRelease/u);
  assert.match(runtimeHarness, /supplierPaymentContractResults/u);
  assert.match(runtimeHarness, /supplierPaymentNullLockSafetyVerified: true/u);
  assert.match(runtimeHarness, /supplierPaymentAndReversalInternalSerialization: true/u);
  assert.match(runtimeHarness, /supplierPaymentDeadlockDelta/u);
  assert.match(runtimeHarness, /legacyNewOperationIdentityAtomic: true/u);
  assert.match(runtimeHarness, /legacyConcurrentDifferentPayloadConflict: true/u);
  assert.match(runtimeHarness, /legacyReplayAfterLaterPaymentZeroWrites: true/u);
  assert.match(runtimeHarness, /pre113FailClosedExact: true/u);
  assert.match(runtimeHarness, /pre113FailClosedChanged: true/u);
  assert.match(runtimeHarness, /pre113MalformedPayloadSameIdentity: true/u);
  assert.match(runtimeHarness, /pre113CrossActorCollisionGeneric: true/u);
  assert.match(runtimeHarness, /pre113SafeResolverVerified: true/u);
  assert.match(runtimeHarness, /pre113ZeroWritesVerified: true/u);
  assert.match(runtimeHarness, /legacyReceiptItemsSnapshotVerified: true/u);
  assert.match(runtimeHarness, /post113LegacyReceiptItemCount/u);
  assert.match(runtimeHarness, /pre113LegacyReceiptItemCount/u);
  assert.match(runtimeHarness,
    /supplier_receipt_items i[\s\S]*i\.supplier_receipt_id IN \([\s\S]*supplier_receipts r/u);
  assert.match(runtimeHarness, /legacyReplayReturnsOriginalResultSnapshot: true/u);
  assert.match(runtimeHarness, /PHASE 2 = READY TO CLOSE/u);
  assert.match(databaseSuite, /supplierPaymentNullLockSafetyVerified/u);
  assert.match(databaseSuite, /legacyChangedQuantityConflict/u);
  assert.match(databaseSuite, /pre113FailClosedExact/u);
  assert.match(directReceivingService, /resolve_legacy_supplier_receipt_replay_v1/u);
  assert.match(directReceivingService, /errorCode: 'LEGACY_IDEMPOTENCY_IDENTITY_UNPROVEN'/u);
  assert.match(directReceivingService, /p_received_at: form\.receivedAt \|\| null/u);
  assert.doesNotMatch(directReceivingService,
    /p_received_at: form\.receivedAt \|\| new Date\(\)\.toISOString\(\)/u);
  assert.match(directReceivingModal, /legacyReplayResolution !== null/u);
  assert.match(directReceivingModal, /راجع السند الموجود أولًا/u);
  assert.match(directReceivingModal, /idempotencyKeyRef\.current = crypto\.randomUUID\(\)/u);
});
