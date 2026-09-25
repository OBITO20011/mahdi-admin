import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrationsUrl = new URL('../supabase/migrations/', import.meta.url);
const migrationNames = readdirSync(migrationsUrl).sort();
const migration120 = readFileSync(
  new URL('../supabase/migrations/120_phase4_returns_refunds_foundation.sql', import.meta.url),
  'utf8',
);
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { scripts?: Record<string, string> };
const canonicalRuntimeSuite = readFileSync(
  new URL('./database-runtime-suite.ts', import.meta.url),
  'utf8',
);

test('migrations 001-119 retain the approved Phase-3 baseline', () => {
  const historical = migrationNames.filter((name) => {
    const sequence = Number.parseInt(name.slice(0, 3), 10);
    return sequence >= 1 && sequence <= 119;
  });
  assert.equal(historical.length, 119);
  const digest = createHash('sha256');
  for (const name of historical) {
    digest.update(`${name}\0`);
    digest.update(readFileSync(new URL(name, migrationsUrl)));
  }
  assert.equal(
    digest.digest('hex').toUpperCase(),
    '47F84EADCE87BAFF37D103C029FA27920A95E1BFD8EE247540BB9FC29A40A936',
  );
  assert.equal(migrationNames.some((name) => name.startsWith('121_')), false);
});

test('Migration 120 is bounded to Phase-4 foundation and lock compatibility', () => {
  assert.match(migration120, /^BEGIN;/u);
  assert.match(migration120, /COMMIT;\s*$/u);
  assert.doesNotMatch(migration120, /CREATE\s+FUNCTION\s+public\.(?:create|submit)_.*(?:return|refund|replacement)/iu);
  assert.doesNotMatch(migration120, /supplier_claim|supplier_credit|tax_refund/iu);
  assert.doesNotMatch(migration120, /GRANT\s+(?:INSERT|UPDATE|DELETE)/iu);
});

test('effective standalone price is historical, server-authoritative and side-effect free', () => {
  assert.match(migration120, /effective_standalone_unit_sale_price_snapshot_in_minor_units/u);
  assert.match(migration120, /phase4_effective_standalone_unit_price_internal/u);
  assert.match(migration120, /minimum_subtotal_in_minor_units/u);
  assert.match(migration120, /maximum_total_redemptions/u);
  assert.match(migration120, /maximum_redemptions_per_phone/u);
  assert.doesNotMatch(
    migration120.match(/CREATE FUNCTION public\.phase4_effective_standalone_unit_price_internal[\s\S]*?\$\$;/u)?.[0] ?? '',
    /INSERT INTO public\.promotion_redemptions|UPDATE public\.promotion_redemptions/iu,
  );
  assert.match(migration120, /Caller-supplied snapshots are forbidden/u);
  assert.match(
    migration120,
    /NEW\.effective_standalone_unit_sale_price_snapshot_in_minor_units[\s\S]*?OLD\.effective_standalone_unit_sale_price_snapshot_in_minor_units/u,
  );
});

test('customer-damage deduction never uses equal Parcel allocation, COGS or WAC', () => {
  const inspectionPreparation =
    migration120.match(
      /CREATE FUNCTION public\.phase4_prepare_component_inspection\([\s\S]*?\n\$\$;/u,
    )?.[0] ?? '';
  assert.match(
    migration120,
    /raw_customer_damage_deduction_in_minor_units[\s\S]*?rejected_quantity::BIGINT[\s\S]*?effective_standalone_unit_sale_price_snapshot_in_minor_units/u,
  );
  assert.match(migration120, /LEAST\(v_original_entitlement, v_raw_damage\)/u);
  assert.doesNotMatch(migration120, /net_refundable_amount_snapshot_in_minor_units\s*\//u);
  assert.match(inspectionPreparation, /rejected_quantity::BIGINT \* COALESCE\(v_component_price, 0\)/u);
  assert.doesNotMatch(inspectionPreparation, /wac_cost_in_minor_units_exact|cogs_snapshot_in_minor_units/iu);
});

test('draft inspection, whole Parcel settlement and logical consumption are distinct', () => {
  assert.match(migration120, /settlement_status IN \('draft', 'inspected', 'settled', 'cancelled'\)/u);
  assert.match(migration120, /PHASE4_PARCEL_RETURN_ALREADY_CONSUMED/u);
  assert.match(migration120, /PHASE4_PARCEL_INSPECTION_INCOMPLETE/u);
  assert.match(migration120, /PHASE4_PARCEL_CONSUMPTION_INCOMPLETE/u);
  assert.match(migration120, /sales_aftercare_consumptions/u);
  assert.match(migration120, /phase4_cancel_draft_aftercare_internal/u);
  assert.doesNotMatch(migration120, /CREATE\s+(?:UNIQUE\s+)?INDEX[^;]*parcel_instance_id[^;]*WHERE[^;]*draft/iu);
});

test('zero-money settlement and replacement contracts do not invent refunds', () => {
  assert.match(
    migration120,
    /ALTER COLUMN settlement_status SET DEFAULT 'settled'/u,
  );
  assert.match(
    migration120,
    /sales_return_events_money_method_shape_check[\s\S]*?contract_version IS NULL/u,
  );
  assert.match(
    migration120,
    /money_refund_amount_in_minor_units = 0[\s\S]*?refund_method IS NULL[\s\S]*?cash_shift_id IS NULL/u,
  );
  assert.match(migration120, /sales_replacement_events/u);
  assert.match(migration120, /sales_replacement_items/u);
  assert.match(migration120, /CHECK \(condition_code = 'supplier_defect'\)/u);
  assert.match(migration120, /PHASE4_REPLACEMENT_LINEAGE_INVALID/u);
  assert.doesNotMatch(migration120, /replacement[\s\S]{0,100}debt_reduction/iu);
});

test('cumulative finalization is protected by source locks and immutable bounds', () => {
  assert.match(migration120, /phase4_finalize_aftercare_operation_internal/u);
  assert.match(migration120, /pg_advisory_xact_lock/u);
  assert.match(migration120, /PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED/u);
  assert.match(migration120, /PHASE4_BASE_RETURN_CUMULATIVE_BOUND_INVALID/u);
  assert.match(migration120, /v_cumulative_quantity = v_total_units/u);
  assert.match(migration120, /PHASE4_RETURN_FINANCIAL_RECONCILIATION_FAILED/u);
  assert.match(migration120, /phase4_aftercare_source_root_internal/u);
  assert.match(
    migration120,
    /consumption\.operation_id = p_operation_id[\s\S]*?consumption\.consumption_state = 'draft'/u,
  );
  assert.match(migration120, /PHASE4_REPLACEMENT_ITEMS_REQUIRED/u);
  assert.match(migration120, /PHASE4_RETURN_EVIDENCE_CLOSED/u);
  assert.match(migration120, /PHASE4_REPLACEMENT_EVIDENCE_CLOSED/u);
  assert.match(migration120, /PHASE4_RETURN_CONSUMPTION_SCOPE_INVALID/u);
  assert.match(migration120, /PHASE4_REPLACEMENT_CONSUMPTION_SCOPE_INVALID/u);
  assert.match(migration120, /PHASE4_CONSUMPTION_INITIAL_STATE_INVALID/u);
  assert.match(migration120, /PHASE4_DRAFT_CONSUMPTION_STATE_INVALID/u);
});

test('the root Order gate precedes every versioned draft write and finalizer lock', () => {
  assert.match(migration120, /phase4_lock_aftercare_order_gate_internal/u);
  assert.match(migration120, /'phase4-order\|' \|\| v_order_id::TEXT/u);
  assert.match(
    migration120,
    /CREATE TRIGGER trg_phase4_guard_aftercare_operation_order_gate[\s\S]*?BEFORE INSERT ON public\.business_operations/u,
  );
  const operationGate = migration120.match(
    /CREATE FUNCTION public\.phase4_guard_aftercare_operation_order_gate\(\)[\s\S]*?\n\$\$;/u,
  )?.[0] ?? '';
  assert.match(operationGate, /phase4_lock_aftercare_order_gate_internal/u);
  const returnGuard = migration120.match(
    /CREATE FUNCTION public\.phase4_guard_return_event_insert_state\(\)[\s\S]*?\n\$\$;/u,
  )?.[0] ?? '';
  assert.match(
    returnGuard,
    /IF NEW\.contract_version IS NOT NULL THEN[\s\S]*?phase4_lock_aftercare_operation_order_internal/u,
  );
  assert.ok(
    returnGuard.indexOf('phase4_lock_aftercare_operation_order_internal')
      < returnGuard.indexOf('phase4_assert_aftercare_operation_binding_internal'),
  );
  const replacementGuard = migration120.match(
    /CREATE FUNCTION public\.phase4_guard_replacement_event_insert_state\(\)[\s\S]*?\n\$\$;/u,
  )?.[0] ?? '';
  assert.ok(
    replacementGuard.indexOf('phase4_lock_aftercare_operation_order_internal')
      < replacementGuard.indexOf('phase4_assert_aftercare_operation_binding_internal'),
  );
  const finalizer = migration120.match(
    /CREATE FUNCTION public\.phase4_finalize_aftercare_operation_internal[\s\S]*?\n\$\$;/u,
  )?.[0] ?? '';
  assert.ok(
    finalizer.indexOf('phase4_lock_aftercare_operation_order_internal')
      < finalizer.indexOf('WHERE operation.id = p_operation_id FOR UPDATE'),
  );
  assert.match(migration120, /PHASE4_OPERATION_ORDER_IDENTITY_INVALID/u);
});

test('versioned aftercare identity, result types and replay inputs are canonical and NULL-safe', () => {
  assert.match(
    migration120,
    /business_operations_phase4_shape_check[\s\S]*?idempotency_key IS NOT NULL[\s\S]*?request_identity_version IS NOT NULL[\s\S]*?request_identity_version IS NOT DISTINCT FROM 401/u,
  );
  assert.match(migration120, /PHASE4_OPERATION_INSERT_SHAPE_INVALID/u);
  assert.match(migration120, /actor_scope_type IS NOT DISTINCT FROM 'erp_user'/u);
  assert.match(migration120, /JSONB_TYPEOF\(result_snapshot\) IS NOT DISTINCT FROM 'object'/u);
  assert.match(migration120, /PHASE4_RETURN_ITEM_EVIDENCE_INCOMPLETE/u);
  assert.match(
    migration120,
    /sales_return_events_financial_source_snapshots_check[\s\S]*?outstanding_debt_before_snapshot_in_minor_units IS NOT NULL[\s\S]*?net_collected_before_snapshot_in_minor_units IS NOT NULL/u,
  );
  assert.match(
    migration120,
    /PHASE4_RETURN_FINANCIAL_EVIDENCE_INCOMPLETE/u,
  );
  assert.match(migration120, /phase4_resolve_operation_replay_internal/u);
  const keyCanonicalizer = migration120.match(
    /CREATE FUNCTION public\.phase4_canonicalize_idempotency_key_internal\([\s\S]*?\n\$\$;/u,
  )?.[0] ?? '';
  assert.match(keyCanonicalizer, /NULLIF\(BTRIM\(p_idempotency_key\), ''\)/u);
  assert.doesNotMatch(keyCanonicalizer, /LOWER\(/u);
  assert.match(
    migration120,
    /uq_business_operations_phase4_actor_idempotency[\s\S]*?phase4_canonicalize_idempotency_key_internal\(idempotency_key\)/u,
  );
  const operationInsertGuard = migration120.match(
    /CREATE FUNCTION public\.phase4_guard_aftercare_operation_order_gate\(\)[\s\S]*?\n\$\$;/u,
  )?.[0] ?? '';
  assert.ok(
    operationInsertGuard.indexOf('phase4_canonicalize_idempotency_key_internal')
      < operationInsertGuard.indexOf('phase4_lock_aftercare_order_gate_internal'),
  );
  const resultValidator = migration120.match(
    /CREATE FUNCTION public\.phase4_assert_success_result_internal\([\s\S]*?\n\$\$;/u,
  )?.[0] ?? '';
  assert.match(resultValidator, /JSONB_TYPEOF\(p_result_snapshot->'success'\) IS DISTINCT FROM 'boolean'/u);
  assert.match(resultValidator, /p_result_snapshot->'success' IS DISTINCT FROM 'true'::JSONB/u);
  assert.match(resultValidator, /PHASE4_OPERATION_RESULT_IDENTITY_INVALID/u);
  assert.doesNotMatch(migration120, /result_snapshot->>'success' IS DISTINCT FROM 'true'/u);
  const replayResolver = migration120.match(
    /CREATE FUNCTION public\.phase4_resolve_operation_replay_internal\([\s\S]*?\n\$\$;/u,
  )?.[0] ?? '';
  assert.match(replayResolver, /IF v_type IS NULL[\s\S]*?v_type NOT IN/u);
  assert.match(replayResolver, /phase4_canonicalize_idempotency_key_internal/u);
  assert.match(migration120, /PHASE4_IDEMPOTENCY_CONFLICT/u);
  assert.match(migration120, /PHASE4_OPERATION_NOT_SETTLED/u);
  assert.match(migration120, /PHASE4_OPERATION_RESULT_IDENTITY_INVALID/u);
  assert.match(migration120, /PHASE4_RETURN_INITIAL_STATE_INVALID/u);
  assert.match(migration120, /PHASE4_REPLACEMENT_INITIAL_STATE_INVALID/u);
  assert.match(migration120, /phase4_assert_aftercare_operation_binding_internal/u);
  assert.match(migration120, /PHASE4_OPERATION_ENTITY_CONTRACT_MISMATCH/u);
  assert.match(
    migration120,
    /p_contract_version IS DISTINCT FROM 401/u,
  );
  assert.match(migration120, /phase4_assert_success_result_internal/u);
  assert.match(
    migration120,
    /sales_return_component_inspections_accepted_shape_check[\s\S]*?accepted_quantity > 0[\s\S]*?accepted_condition IS NOT NULL[\s\S]*?accepted_stock_disposition IS NOT NULL/u,
  );
  assert.match(
    migration120,
    /sales_return_component_inspections_rejected_shape_check[\s\S]*?rejected_quantity > 0[\s\S]*?rejection_reason IS NOT NULL[\s\S]*?rejected_stock_disposition IS NOT NULL/u,
  );
});

test('eligibility uses a post-lock wall clock and committed completion replay is preflighted', () => {
  const finalizer = migration120.match(
    /CREATE FUNCTION public\.phase4_finalize_aftercare_operation_internal[\s\S]*?\n\$\$;/u,
  )?.[0] ?? '';
  assert.match(finalizer, /v_now := clock_timestamp\(\);/u);
  assert.doesNotMatch(finalizer, /v_now TIMESTAMPTZ := (?:NOW|statement_timestamp)\(\)/u);
  assert.ok(
    finalizer.indexOf('v_now := clock_timestamp();')
      > finalizer.indexOf('FOR v_source IN'),
  );
  const completionWrapper = migration120.match(
    /CREATE FUNCTION public\.complete_website_order_with_settlement_v2[\s\S]*?\n\$\$;/u,
  )?.[0] ?? '';
  assert.ok(
    completionWrapper.indexOf('phase4_customer_completion_replay_preflight_internal')
      < completionWrapper.indexOf('phase4_lock_customer_order_context_internal'),
  );
});

test('lock wrappers freeze and revalidate Customer, Supplier and full-Shift contexts', () => {
  for (const identity of [
    'phase4_lock_customer_order_context_internal',
    'phase4_supplier_context_snapshot_internal',
    'phase4_lock_supplier_context_internal',
    'phase4_full_shift_context_snapshot_internal',
    'phase4_lock_full_shift_context_internal',
  ]) assert.match(migration120, new RegExp(identity, 'u'));
  assert.match(migration120, /FOR UPDATE NOWAIT/u);
  assert.match(migration120, /PHASE4_LOCK_PLAN_CHANGED_RETRY/u);
  assert.match(migration120, /ERRCODE = '40001'/u);
  assert.match(migration120, /cash-shift-full-reversal:/u);
  const fullShiftLock = migration120.match(
    /CREATE FUNCTION public\.phase4_lock_full_shift_context_internal[\s\S]*?\n\$\$;/u,
  )?.[0] ?? '';
  assert.ok(
    fullShiftLock.indexOf("pg_advisory_xact_lock")
      < fullShiftLock.indexOf('FROM public.cash_shifts'),
  );
  const fullShiftWrapper = migration120.match(
    /CREATE FUNCTION public\.reverse_cash_shift_with_operations[\s\S]*?\n\$\$;/u,
  )?.[0] ?? '';
  assert.ok(
    fullShiftWrapper.indexOf('assert_reversal_owner')
      < fullShiftWrapper.indexOf('phase4_lock_full_shift_context_internal'),
  );
  const purchaseCancellationWrapper = migration120.match(
    /CREATE FUNCTION public\.cancel_purchase_receipt_v2[\s\S]*?\n\$\$;/u,
  )?.[0] ?? '';
  assert.ok(
    purchaseCancellationWrapper.indexOf('assert_erp_role')
      < purchaseCancellationWrapper.indexOf('phase4_lock_supplier_context_internal'),
  );
  assert.match(
    purchaseCancellationWrapper,
    /ARRAY\['owner', 'admin', 'manager', 'warehouse_keeper'\]/u,
  );
  const supplierPaymentReversalWrapper = migration120.match(
    /CREATE FUNCTION public\.reverse_supplier_payment[\s\S]*?\n\$\$;/u,
  )?.[0] ?? '';
  assert.ok(
    supplierPaymentReversalWrapper.indexOf('assert_reversal_owner')
      < supplierPaymentReversalWrapper.indexOf('phase4_lock_supplier_context_internal'),
  );
  assert.doesNotMatch(migration120, /SKIP LOCKED|\bsteal\b/iu);
});

test('new evidence tables and internal helpers remain RPC-only', () => {
  for (const table of [
    'sales_return_component_inspections',
    'sales_replacement_events',
    'sales_replacement_items',
    'sales_aftercare_consumptions',
  ]) {
    assert.match(
      migration120,
      new RegExp(`REVOKE ALL ON TABLE public\\.%I FROM PUBLIC, anon, authenticated, service_role`, 'u'),
    );
    assert.ok(migration120.includes(`'${table}'`));
  }
  assert.match(migration120, /REVOKE ALL ON FUNCTION public\.phase4_finalize_aftercare_operation_internal/u);
  assert.doesNotMatch(
    migration120,
    /GRANT EXECUTE ON FUNCTION public\.phase4_(?:finalize|cancel|lock|prepare|validate|effective|authoritative)/u,
  );
});

test('all Phase-4 child evidence and cancellation enter one root-first boundary', () => {
  assert.match(migration120, /phase4_lock_aftercare_parent_order_internal/u);
  for (const functionName of [
    'phase4_prepare_component_inspection',
    'phase4_validate_replacement_item',
    'phase4_validate_return_item_insert',
    'phase4_validate_aftercare_consumption_insert',
  ]) {
    const body = migration120.match(
      new RegExp(`CREATE FUNCTION public\\.${functionName}\\([\\s\\S]*?\\n\\$\\$;`, 'u'),
    )?.[0] ?? '';
    assert.match(body, /phase4_lock_aftercare_parent_order_internal/u);
    assert.ok(
      body.indexOf('phase4_lock_aftercare_parent_order_internal')
        < body.indexOf('FOR SHARE'),
      `${functionName} must acquire the root gate before row locks.`,
    );
  }
  const cancellation = migration120.match(
    /CREATE FUNCTION public\.phase4_cancel_draft_aftercare_internal[\s\S]*?\n\$\$;/u,
  )?.[0] ?? '';
  assert.ok(
    cancellation.indexOf('phase4_lock_aftercare_operation_order_internal')
      < cancellation.indexOf('FOR UPDATE'),
  );
});

test('Phase-4 runtime proof is wired into the canonical database suite', () => {
  assert.equal(
    packageJson.scripts?.['test:phase4-foundation:runtime'],
    'node scripts/testing/run-phase4-returns-foundation-runtime.mjs',
  );
  assert.match(canonicalRuntimeSuite, /run-phase4-returns-foundation-runtime\.mjs/u);
  assert.match(canonicalRuntimeSuite, /freshRebuild, '001-120'/u);
  assert.match(canonicalRuntimeSuite, /scenarioCount, 35/u);
  assert.match(canonicalRuntimeSuite, /oneSettlementWon/u);
  assert.match(canonicalRuntimeSuite, /bothStartOrders/u);
  assert.match(canonicalRuntimeSuite, /earlyGateBeforeDraftWrites/u);
  assert.match(canonicalRuntimeSuite, /remainingEntitlementCorrect/u);
  assert.match(canonicalRuntimeSuite, /loserRolledBack/u);
  assert.match(canonicalRuntimeSuite, /strictFailureIdentity/u);
  assert.match(canonicalRuntimeSuite, /deadlockDelta/u);
  assert.match(canonicalRuntimeSuite, /completionReplay/u);
  assert.match(canonicalRuntimeSuite, /unauthorizedBeforeLock/u);
  assert.match(canonicalRuntimeSuite, /deadlineAfterLockWait/u);
  assert.match(canonicalRuntimeSuite, /settledReplayAfterDeadline/u);
  assert.match(canonicalRuntimeSuite, /mixedReversalLockOrder/u);
  assert.match(canonicalRuntimeSuite, /idempotencyReplayContract/u);
  assert.match(canonicalRuntimeSuite, /equivalentRepresentationReplay/u);
  assert.match(canonicalRuntimeSuite, /nullOperationTypeRejected/u);
  assert.match(canonicalRuntimeSuite, /cron\.unschedule/u);
  assert.match(canonicalRuntimeSuite, /run_advanced_monitoring_checks\(clock_timestamp\(\)\)/u);
  assert.match(canonicalRuntimeSuite, /cron\.schedule/u);
  assert.match(canonicalRuntimeSuite, /schemaname IN \('public','auth'\)/u);
  assert.doesNotMatch(
    canonicalRuntimeSuite,
    /tablename\s+NOT\s+IN\s*\([^)]*advanced_monitoring_(?:checks|metrics)/u,
  );
});
