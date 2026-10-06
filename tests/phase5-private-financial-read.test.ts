import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import test from 'node:test';

const read = (name: string) => readFileSync(name, 'utf8').replace(/\r\n?/gu, '\n');
const file = 'supabase/migrations/127_phase5_private_financial_read_model.sql';
const migration = read(file);
const state = JSON.parse(read('docs/agent/project-state.json')) as {
  migrationCeiling: number; migration127CanonicalLfSha256: string;
  phase5Slice4Started: boolean; phase5PublicActivationAllowed: boolean;
};

test('Slice4 authorization and hash are explicit and fail closed', () => {
  assert.equal(state.migrationCeiling,130);
  assert.equal(state.phase5Slice4Started,true);
  assert.equal(state.phase5PublicActivationAllowed,false);
  assert.equal(state.migration127CanonicalLfSha256,createHash('sha256').update(migration).digest('hex').toUpperCase());
  assert.equal(readdirSync('supabase/migrations').filter((name) => name.startsWith('128_')).join(','),
    '128_phase5_operational_payment_and_shift_refund_fixes.sql');
  assert.equal(readdirSync('supabase/migrations').some((name) => name.startsWith('131_')),false);
  assert.equal(execFileSync('git',['diff','HEAD','--name-only','--','supabase/migrations/0*',
    'supabase/migrations/1[01]*','supabase/migrations/12[0-6]*'],{encoding:'utf8'}).trim(),'');
});

test('private additive read roots have no cutover, business writes, or locks', () => {
  assert.match(migration,/^BEGIN;/u); assert.match(migration,/COMMIT;\s*$/u);
  assert.equal((migration.match(/CREATE FUNCTION/gu) ?? []).length,10);
  assert.equal((migration.match(/SECURITY INVOKER/gu) ?? []).length,10);
  assert.equal((migration.match(/ALTER FUNCTION.*OWNER TO postgres/gu) ?? []).length,10);
  assert.doesNotMatch(migration,/CREATE TABLE|CREATE OR REPLACE|SECURITY DEFINER|\bGRANT\b|FOR UPDATE|FOR SHARE|pg_advisory|nextval|clock_timestamp|statement_timestamp|transaction_timestamp/u);
  assert.doesNotMatch(migration,/\b(?:INSERT INTO|DELETE FROM|UPDATE) (?:public|phase5_private)\./u);
  assert.match(migration,/FROM PUBLIC, anon, authenticated, service_role/u);
  for (const name of ['read_order_financial_facts_v1','read_order_financial_position_v1','reconcile_order_financial_position_v1']) {
    assert.match(migration,new RegExp(`CREATE FUNCTION phase5_private\\.${name}\\(p_order_id UUID\\)[\\s\\S]*?STABLE SECURITY INVOKER`, 'u'));
  }
});

test('total bidirectional graph includes orphans and never filters by success/settled child', () => {
  for (const table of ['financial_operation_events','collection_events','payment_reversal_events',
    'reversal_tender_movements','reversal_coordinator_completions','business_operations',
    'sales_return_events','sales_return_items','sales_return_component_inspections','sales_aftercare_consumptions',
    'phase42_return_settlement_evidence','phase42_return_inventory_effects','inventory_movements']) {
    assert.match(migration,new RegExp(`FROM (?:public|phase5_private)\\.${table} t`, 'u'));
  }
  assert.match(migration,/SELECT a,b FROM raw_edges UNION SELECT b,a FROM raw_edges/u);
  assert.match(migration,/WITH RECURSIVE nodes AS MATERIALIZED/u);
  assert.match(migration,/PHASE5_READ_UNASSIGNABLE_EVIDENCE/u);
  assert.match(migration,/PHASE5_READ_INCONSISTENT_ORDER_OWNERSHIP/u);
  assert.match(migration,/request_identity_snapshot'->'order_id'/u);
  assert.match(migration,/request_identity_snapshot'->'orderId'/u);
});

test('historical allocation is validated before aggregate derivation without delivery double subtraction', () => {
  assert.match(migration,/v_debt <> LEAST\(v_entitlement, v_before_debt\)/u);
  assert.match(migration,/v_refund > v_before_refundable/u);
  assert.match(migration,/v_entitlement <> v_debt::NUMERIC \+ v_refund/u);
  assert.match(migration,/outstanding_debt_before_snapshot_in_minor_units/u);
  assert.match(migration,/net_collected_before_snapshot_in_minor_units/u);
  assert.match(migration,/x < 0 OR d\+r > t-l OR x\+d > t/u);
  assert.match(migration,/r > x-collected_delivery/u);
  assert.doesNotMatch(migration,/c > t|GREATEST\(/u);
  assert.match(migration,/JSONB_TYPEOF\(p_value\) IS DISTINCT FROM 'number'/u);
  assert.match(migration,/v_amount <> TRUNC\(v_amount\)/u);
  assert.match(migration,/PHASE5_READ_MONEY_OVERFLOW/u);
  const pureDeriver = migration.split('CREATE FUNCTION phase5_private.derive_financial_position_v1')[1]
    .split('CREATE FUNCTION phase5_private.read_order_financial_position_v1')[0];
  assert.match(pureDeriver,/IMMUTABLE SECURITY INVOKER/u);
  assert.doesNotMatch(pureDeriver,/RETURN JSONB_BUILD_OBJECT/u);
  assert.match(pureDeriver,/cash_flow::BIGINT::TEXT/u);
  for (const field of ['amountPaidInMinorUnits','amount_paid_in_minor_units','remaining_in_minor_units',
    'merchandiseEntitlementInMinorUnits','debtReductionInMinorUnits','moneyRefundInMinorUnits',
    'deliveryRefundInMinorUnits','taxRefundInMinorUnits']) {
    assert.match(migration,new RegExp(`money_v1\\([^\\n]*result_snapshot->'${field}'`, 'u'));
  }
  assert.match(migration,/phase4_assert_success_result_internal\(/u);
});

test('read runtime uses actual sources/coordinators, corruption rollback, observed snapshot and strict lint', () => {
  const runner = read('scripts/testing/run-phase5-private-financial-read-runtime.mjs');
  for (const rpc of ['create_pos_sale_v2','submit_guest_customer_order_v2','complete_website_order_with_settlement_v2',
    'record_customer_order_payment','anchor_existing_collection_v1','coordinate_payment_reversal_v1','settle_sales_return_v1']) {
    assert.match(runner,new RegExp(rpc,'u'));
  }
  assert.match(runner,/NAWASRAH_MAX_MIGRATION: '127'/u);
  assert.match(runner,/REPEATABLE READ READ ONLY/u);
  assert.match(runner,/wait_event='PgSleep'/u);
  assert.match(runner,/no read business gates/u);
  assert.match(runner,/l\.type === 'relation' && l\.mode !== 'AccessShareLock'/u);
  assert.match(runner,/phase4_cancel_draft_aftercare_internal/u);
  assert.match(runner,/whole Parcel damage cap and mixed sellable\/damage Return/u);
  assert.match(runner,/historical debt-first Return allocation survives later collection/u);
  assert.match(runner,/assertPhase5DbLint/u);
  assert.match(runner,/ROLLBACK/u);
  assert.match(runner,/stop','--no-backup'/u);
  assert.doesNotMatch(runner,/ISOLATED_ROOT|--retries|Canonical/u);
});
