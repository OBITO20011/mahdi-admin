import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/040_operational_expenses_and_cash_shifts.sql',
    import.meta.url
  ),
  'utf8'
);
const posShiftMigration = readFileSync(
  new URL(
    '../supabase/migrations/041_require_open_shift_for_pos_sales.sql',
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
const store = readFileSync(
  new URL('../src/stores/useAppStore.ts', import.meta.url),
  'utf8'
);
const shiftsView = readFileSync(
  new URL('../src/features/shifts/ShiftsView.tsx', import.meta.url),
  'utf8'
);
const expenseModal = readFileSync(
  new URL('../src/features/expenses/ExpenseFormModal.tsx', import.meta.url),
  'utf8'
);
const posService = readFileSync(
  new URL('../src/services/supabase/pos.service.ts', import.meta.url),
  'utf8'
);
const posView = readFileSync(
  new URL('../src/features/pos/PosView.tsx', import.meta.url),
  'utf8'
);

test('cash shifts and expenses are RPC-only audited records', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.cash_shifts/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.operational_expenses/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/g);
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.cash_shifts FROM PUBLIC, anon, authenticated/
  );
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.operational_expenses FROM PUBLIC, anon, authenticated/
  );
  assert.match(migration, /CREATE_OPERATIONAL_EXPENSE/);
  assert.match(migration, /OPEN_CASH_SHIFT/);
  assert.match(migration, /CLOSE_CASH_SHIFT/);
});

test('only one open shift is allowed for each branch', () => {
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_shifts_one_open_per_branch[\s\S]*WHERE status = 'open'/
  );
  assert.match(
    migration,
    /IF EXISTS \(SELECT 1 FROM public\.cash_shifts WHERE branch_id = p_branch_id AND status = 'open'\)/
  );
});

test('expected drawer cash uses canonical inflows and outflows only once', () => {
  assert.match(migration, /v_expected_cash := v_shift\.opening_cash_in_minor_units[\s\S]*\+ v_cash_sales[\s\S]*\+ v_cash_receipts[\s\S]*- v_cash_supplier_payments[\s\S]*- v_cash_expenses/);
  assert.match(migration, /AND o\.payment_method = 'debt'/);
  assert.match(migration, /LEFT JOIN public\.supplier_receipts sr/);
  assert.match(migration, /sp\.payment_date >= v_shift\.opened_at/);
  assert.doesNotMatch(
    migration,
    /v_expected_cash :=[\s\S]{0,250}v_cliq_sales/
  );
});

test('CliQ is tracked separately and requires a reference', () => {
  assert.match(migration, /payment_method IN \('cash', 'cliq'\)/);
  assert.match(migration, /p_payment_method = 'cliq'[\s\S]*p_reference_number/);
  assert.match(expenseModal, /رقم مرجع CliQ/);
  assert.match(expenseModal, /paymentMethod !== 'cliq' \|\| referenceNumber/);
});

test('closing discrepancy requires a documented reason', () => {
  assert.match(
    migration,
    /v_discrepancy <> 0 AND NULLIF\(TRIM\(p_discrepancy_reason\), ''\) IS NULL/
  );
  assert.match(shiftsView, /needsReason && discrepancyReason\.trim\(\)\.length < 2/);
});

test('frontend reads and mutates this module exclusively through RPC services', () => {
  assert.match(service, /\.rpc\(\s*'get_expense_shift_center'/);
  assert.match(service, /\.rpc\('open_cash_shift'/);
  assert.match(service, /\.rpc\(\s*'create_operational_expense'/);
  assert.match(service, /\.rpc\('close_cash_shift'/);
  assert.doesNotMatch(service, /\.from\(/);
  assert.match(store, /fetchExpenseShiftCenterFromSupabase/);
  assert.doesNotMatch(store, /EXP-2026-\$\{Math\.floor/);
  assert.doesNotMatch(store, /SHF-2026-\$\{Math\.floor/);
});

test('shift screen has no fake opening or actual cash defaults', () => {
  assert.doesNotMatch(shiftsView, /useState<number>\(250\)/);
  assert.doesNotMatch(shiftsView, /useState<number>\(1665\.5\)/);
  assert.match(shiftsView, /currentShift\.expectedCash\.toFixed\(3\)/);
});

test('every new direct POS sale is atomically attached to an open shift', () => {
  assert.match(posShiftMigration, /ADD COLUMN IF NOT EXISTS cash_shift_id UUID/);
  assert.match(posShiftMigration, /REFERENCES public\.cash_shifts\(id\) ON DELETE RESTRICT/);
  assert.match(posShiftMigration, /BEFORE INSERT ON public\.orders/);
  assert.match(posShiftMigration, /NEW\.source IS DISTINCT FROM 'pos'/);
  assert.match(posShiftMigration, /status = 'open'[\s\S]*FOR SHARE/);
  assert.match(posShiftMigration, /NEW\.cash_shift_id := v_shift_id/);
  assert.match(posShiftMigration, /افتح وردية الصندوق أولاً قبل إتمام البيع المباشر/);
});

test('POS shift status RPC exposes only the safe open-shift identity', () => {
  assert.match(posShiftMigration, /CREATE OR REPLACE FUNCTION public\.get_open_pos_shift/);
  assert.match(posShiftMigration, /ARRAY\['owner', 'admin', 'manager', 'sales'\]/);
  assert.match(posShiftMigration, /'hasOpenShift', FOUND/);
  assert.doesNotMatch(
    posShiftMigration.match(/CREATE OR REPLACE FUNCTION public\.get_open_pos_shift[\s\S]*?\$\$;/)?.[0] || '',
    /operational_expenses|expected_cash_in_minor_units|cash_expenses/
  );
  assert.match(posService, /\.rpc\('get_open_pos_shift'/);
});

test('shift totals use the explicit POS relation and keep website completion attribution', () => {
  assert.match(posShiftMigration, /source = 'pos'[\s\S]*cash_shift_id = v_shift\.id/);
  assert.match(posShiftMigration, /source IS DISTINCT FROM 'pos'[\s\S]*completed_at >= v_shift\.opened_at/);
});

test('POS UI blocks checkout and routes the operator to open a shift', () => {
  assert.match(posView, /fetchOpenPosShiftFromSupabase\(activeBranch\.id\)/);
  assert.match(posView, /البيع المباشر متوقف مؤقتًا/);
  assert.match(posView, /setActiveTab\('shifts'\)/);
  assert.match(posView, /if \(!openPosShift\)/);
  assert.match(posView, /isShiftStatusLoading/);
  assert.match(store, /branchId: this\.state\.activeBranch\?\.id \|\| undefined/);
});
