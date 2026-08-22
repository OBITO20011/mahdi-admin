import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/044_daily_shift_closing_report.sql',
    import.meta.url
  ),
  'utf8'
);
const service = readFileSync(
  new URL(
    '../src/services/supabase/expenses-shifts.service.ts',
    import.meta.url
  ),
  'utf8'
);
const view = readFileSync(
  new URL('../src/features/shifts/ShiftsView.tsx', import.meta.url),
  'utf8'
);
const reportModal = readFileSync(
  new URL(
    '../src/features/shifts/ShiftClosingReportModal.tsx',
    import.meta.url
  ),
  'utf8'
);

test('cash and CliQ customer and supplier payments are attached to the open shift', () => {
  assert.match(
    migration,
    /ALTER TABLE public\.customer_payments[\s\S]*cash_shift_id UUID/
  );
  assert.match(
    migration,
    /ALTER TABLE public\.supplier_payments[\s\S]*cash_shift_id UUID/
  );
  assert.match(migration, /trg_customer_payment_open_shift/);
  assert.match(migration, /trg_supplier_payment_open_shift/);
  assert.match(migration, /NEW\.payment_method NOT IN \('cash', 'cliq'\)/g);
  assert.match(migration, /status = 'open'[\s\S]*FOR SHARE/g);
});

test('shift summary tracks CliQ supplier payments separately from drawer cash', () => {
  assert.match(migration, /cliq_supplier_payments_in_minor_units BIGINT/);
  assert.match(
    migration,
    /'cliqSupplierPaymentsInMinorUnits', v_cliq_supplier_payments/
  );
  assert.match(
    migration,
    /cliq_supplier_payments_in_minor_units =[\s\S]*cliqSupplierPaymentsInMinorUnits/
  );
  const expectedCashFormula = migration.match(
    /v_expected_cash := v_shift\.opening_cash_in_minor_units[\s\S]*?v_cash_refunds;/
  )?.[0] || '';
  assert.doesNotMatch(expectedCashFormula, /v_cliq_supplier_payments/);
});

test('closing report is one canonical authenticated RPC with complete reconciliation', () => {
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.get_cash_shift_closing_report/
  );
  assert.match(
    migration,
    /ARRAY\['owner', 'admin', 'manager', 'accountant'\]/
  );
  assert.match(migration, /'grossSalesInMinorUnits'/);
  assert.match(migration, /'netSalesInMinorUnits'/);
  assert.match(migration, /'totalInflowsInMinorUnits'/);
  assert.match(migration, /'totalOutflowsInMinorUnits'/);
  assert.match(migration, /'netCliqMovementInMinorUnits'/);
  assert.match(migration, /'expenseBreakdown'/);
  assert.match(migration, /'returnBreakdown'/);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.get_cash_shift_closing_report\(UUID\)[\s\S]*TO authenticated/
  );
});

test('frontend loads the report through RPC and never queries accounting tables directly', () => {
  assert.match(service, /\.rpc\(\s*'get_cash_shift_closing_report'/);
  assert.doesNotMatch(service, /\.from\(/);
  assert.match(view, /fetchCashShiftClosingReportFromSupabase/);
  assert.match(view, /currentShift\.cliqSupplierPayments/);
});

test('daily closing UI exposes live and closed reports with print support', () => {
  assert.match(view, /عرض التقرير المالي الحي/);
  assert.match(view, /عرض تقرير الإغلاق الكامل/);
  assert.match(reportModal, /تقرير الإغلاق اليومي/);
  assert.match(reportModal, /إجمالي المبيعات/);
  assert.match(reportModal, /مطابقة درج الكاش/);
  assert.match(reportModal, /صافي CliQ/);
  assert.match(reportModal, /window\.print\(\)/);
});
