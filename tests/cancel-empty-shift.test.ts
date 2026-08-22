import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/046_cancel_empty_cash_shift.sql',
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

test('empty shift cancellation is an audited lifecycle state, never a deletion', () => {
  assert.match(migration, /status IN \('open', 'closed', 'cancelled'\)/);
  assert.match(migration, /cancellation_reason TEXT/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.cancel_empty_cash_shift/);
  assert.match(migration, /'CANCEL_EMPTY_CASH_SHIFT'/);
  assert.match(migration, /'verified_empty', true/);
  assert.doesNotMatch(migration, /DELETE FROM public\.cash_shifts/i);
});

test('only privileged staff can cancel and the shift is locked before validation', () => {
  assert.match(
    migration,
    /ARRAY\['owner', 'admin', 'manager'\][\s\S]*إلغاء وردية فُتحت بالخطأ/
  );
  assert.match(migration, /WHERE id = p_shift_id[\s\S]*FOR UPDATE/);
  assert.match(migration, /IF v_shift\.status <> 'open'/);
  assert.match(migration, /CHAR_LENGTH\(v_reason\) < 2/);
});

test('cancellation is rejected when any linked business activity exists', () => {
  for (const relation of [
    'public.orders',
    'public.customer_payments',
    'public.supplier_payments',
    'public.operational_expenses',
    'public.sales_returns',
  ]) {
    assert.match(migration, new RegExp(relation.replace('.', '\\.')));
  }
  assert.match(migration, /لا يمكن إلغاء الوردية لأنها تحتوي حركة مالية/);
});

test('cancelled shifts stay visible but expose zero financial movement', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_cash_shift_display_summary/);
  assert.match(migration, /'cashSalesInMinorUnits', 0/);
  assert.match(migration, /'cashExpensesInMinorUnits', 0/);
  assert.match(migration, /status IN \('closed', 'cancelled'\)/);
});

test('frontend cancellation uses the RPC and requires an explicit reason', () => {
  assert.match(service, /\.rpc\('cancel_empty_cash_shift'/);
  assert.doesNotMatch(service, /\.from\(/);
  assert.match(store, /cancelEmptyCashShiftInSupabase/);
  assert.match(shiftsView, /cancelReason\.trim\(\)\.length < 2/);
  assert.match(shiftsView, /لن تُحذف الوردية وستبقى في سجل التدقيق/);
  assert.match(shiftsView, /shift\.status === 'cancelled'/);
  assert.match(shiftsView, /shift\.status === 'closed'/);
});
