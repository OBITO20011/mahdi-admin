import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';

const read = (p: string) => readFileSync(p, 'utf8');
const migration = read('supabase/migrations/131_phase6_operational_report_readers.sql');

test('Migration131 current contract is pinned and LF/CRLF portable', () => {
  const state = JSON.parse(read('docs/agent/project-state.json'));
  const canonical = migration.replace(/\r\n?/gu, '\n');
  const digest = createHash('sha256').update(canonical).digest('hex').toUpperCase();
  assert.equal(digest, state.migration131CanonicalLfSha256);
  assert.equal(createHash('sha256').update(canonical.replaceAll('\n', '\r\n').replace(/\r\n?/gu, '\n')).digest('hex').toUpperCase(), digest);
});

test('Phase6 A readers are explicit wrappers, never runtime text patches', () => {
  assert.match(migration, /^BEGIN;/u);
  assert.match(migration, /COMMIT;\s*$/u);
  assert.doesNotMatch(migration, /pg_get_functiondef|\bEXECUTE\s+(?:REPLACE|v_)/u);
  for (const [name, renamed] of [
    ['get_operational_business_report(UUID, DATE, DATE)', '_get_operational_business_report_before_phase6'],
    ['build_business_summary(TEXT, DATE, DATE, TIMESTAMPTZ)', '_build_business_summary_before_phase6'],
    ['get_home_dashboard()', '_get_home_dashboard_before_phase6'],
  ]) {
    assert.ok(migration.includes(`ALTER FUNCTION public.${name}`) && migration.includes(`RENAME TO ${renamed}`), name);
  }
  assert.match(migration, /CREATE FUNCTION public\.phase6_financial_facts_internal\(/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.phase6_financial_facts_internal\([^)]*\)\s+FROM PUBLIC, anon, authenticated, service_role;/u);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_operational_business_report\(UUID, DATE, DATE\) TO authenticated;/u);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_home_dashboard\(\) TO authenticated;/u);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.build_business_summary\(TEXT, DATE, DATE, TIMESTAMPTZ\) TO service_role;/u);
  assert.doesNotMatch(migration, /^\s*(?:DROP|UPDATE|INSERT|DELETE)\s/imu);
  for (const target of ['v_report', 'v_result']) for (const field of ['sales', 'expenses', 'balances']) {
    assert.ok(migration.includes(`(${target}->'${field}') || (v_facts->'${field}')`),
      'Parenthesize JSON operands: PostgreSQL operator precedence must not discard historical fields');
  }
});

test('Review remediation: V2-only modern returns, clamped dues, scoped evidence, degraded home', () => {
  assert.match(migration, /modern_returns AS MATERIALIZED \([\s\S]*?o\.operation_type IN \('phase3_pos_sale_v1', 'phase3_customer_reservation_v1'\)/u);
  assert.match(migration, /GREATEST\(o\.total_in_minor_units - COALESCE\(c\.coverage, 0\) - COALESCE\(d\.debt_reduction, 0\), 0\)/u);
  assert.match(migration, /e\.settled_at >= p_period_start AND e\.settled_at < p_period_end/u);
  assert.match(migration, /e\.issued_at >= p_period_start AND e\.issued_at < p_period_end;/u);
  assert.match(migration, /EXCEPTION WHEN OTHERS THEN\s+RETURN v_home \|\| jsonb_build_object\('financialFactsStatus', 'unavailable'\)/u);
  assert.match(migration, /'completedOrderCount', count/u);
  assert.doesNotMatch(migration, /LEFT JOIN LATERAL \(\s*SELECT b\.result_snapshot/u, 'Completion lookup is one grouped pass');
});

test('Report facts distinguish entitlement, debt, tender flow and immutable cost dimensions', () => {
  for (const name of ['returnEntitlementInMinorUnits', 'debtReductionInMinorUnits',
    'replacementCostInMinorUnits', 'restockRecoveryInMinorUnits', 'aftercareAdjustedMarginInMinorUnits',
    'cashNetFlowInMinorUnits', 'cliqNetFlowInMinorUnits']) assert.ok(migration.includes(name));
  assert.match(migration, /historical_restock_value_in_minor_units_exact/u);
  assert.match(migration, /replacement_cogs_snapshot_in_minor_units/u);
  assert.match(migration, /customer_payment_number[\s\S]*THEN 0/u);
  assert.match(migration, /phase42_assert_operational_return_evidence_internal/u);
  assert.match(migration, /phase43_assert_operational_replacement_evidence_internal/u);
  assert.match(migration, /defect_non_sellable_quantity/u);
  assert.match(migration, /NOT \(op\.request_identity_snapshot \? 'physical_sources'\)/u);
});

test('Package A precision changes preserve signs and do not round Jordanian money to cents', () => {
  for (const p of ['src/features/purchases/PurchasesView.tsx', 'src/features/purchases/PurchaseOrderCard.tsx',
    'src/features/purchases/PurchaseOrderDetailView.tsx', 'src/features/purchases/SupplierPaymentModal.tsx',
    'src/features/dashboard/WidgetsSection.tsx', 'src/features/pos/BarcodeScannerModal.tsx']) {
    assert.doesNotMatch(read(p), /toFixed\(2\)/u);
    assert.match(read(p), /toFixed\(3\)/u);
  }
  assert.match(read('src/features/dashboard/KpiCards.tsx'), /minimumFractionDigits: 3/u);
  assert.match(read('src/services/supabase/reports.service.ts'), /Number\.isSafeInteger/u);
  assert.match(read('src/features/reports/ReportsCenterView.tsx'), /<details[\s\S]*تفاصيل/u);
});
