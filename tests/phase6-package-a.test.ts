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
  assert.equal(state.migration131CanonicalLfSha256, '94F7702C89586E65C6BD855D9CA1B8365B7443D520CB3E698CEC346743CB3BD0');
  assert.equal(digest, state.migration131CanonicalLfSha256);
  assert.equal(createHash('sha256').update(canonical.replaceAll('\n', '\r\n').replace(/\r\n?/gu, '\n')).digest('hex').toUpperCase(), digest);
});

test('Phase6 A adds only Migration131 reader patches, not new authority/writers/grants', () => {
  assert.match(migration, /^BEGIN;/u);
  assert.match(migration, /COMMIT;\s*$/u);
  assert.doesNotMatch(migration, /^\s*(?:CREATE|ALTER|DROP|GRANT|REVOKE|UPDATE|INSERT|DELETE)\s/imu);
  const targets = [...migration.matchAll(/pg_get_functiondef\('public\.([^']+)'::REGPROCEDURE\)/gu)].map(m => m[1]);
  assert.deepEqual(targets, ['get_operational_business_report(uuid,date,date)',
    'build_business_summary(text,date,date,timestamptz)', 'get_home_dashboard()',
    '_get_cash_shift_closing_report_before_snapshot(uuid)']);
  assert.match(migration, /source contract changed/u);
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
