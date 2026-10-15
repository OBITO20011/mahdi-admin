import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { futureMigrationViolations } from '../scripts/testing/maintenance-db-contract.mjs';

const read = (file: string) => readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
const m180 = read('supabase/migrations/180_owner_cash_withdrawals.sql');
const m181 = read('supabase/migrations/181_owner_withdrawal_readers.sql');
const m182 = read('supabase/migrations/182_owner_withdrawal_monitoring.sql');
const all = [m180, m181, m182];
const body = (sql: string, name: string) => {
  const start = sql.search(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`, 'u'));
  assert.ok(start >= 0, `${name} is defined explicitly`);
  return sql.slice(start, sql.indexOf('\n$$;', start));
};

test('migrations 180-182 pass the future-migration contract: no _before_ layers, no dynamic redefinition', () => {
  for (const sql of all) assert.deepEqual(futureMigrationViolations(sql), []);
  for (const sql of all) {
    assert.doesNotMatch(sql, /pg_get_functiondef|RENAME TO/u);
    assert.match(sql.trim(), /^[\s\S]*\nBEGIN;[\s\S]*\nCOMMIT;$/u, 'each migration is one transaction');
  }
});

test('every new function is SECURITY DEFINER with a fixed search_path and explicit grants', () => {
  for (const sql of all) {
    for (const match of sql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.([a-z0-9_]+)\(/gu)) {
      const fn = body(sql, match[1]!);
      assert.match(fn, /SECURITY DEFINER\n\s*SET search_path (?:= public, pg_temp\n|TO 'public',[^\n]*'pg_temp'\n)/u, `${match[1]} definer + search_path`);
      assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${match[1]}\\(`, 'u'), `${match[1]} has an explicit REVOKE`);
    }
  }
  for (const rpc of ['create_owner_cash_withdrawal_v1', 'reverse_owner_cash_withdrawal_v1'])
    assert.match(m180, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${rpc}\\([^)]*\\) TO authenticated;`, 'u'));
  for (const rpc of ['get_owner_withdrawals_report', 'get_shift_owner_withdrawals_v1'])
    assert.match(m181, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${rpc}\\([^)]*\\) TO authenticated;`, 'u'));
  for (const internal of ['owner_withdrawal_shift_effect_internal', 'owner_withdrawal_shift_reversal_plan_internal'])
    assert.match(m180, new RegExp(`REVOKE ALL ON FUNCTION public\\.${internal}\\(UUID\\) FROM PUBLIC, anon, authenticated;`, 'u'));
  assert.match(m182, /REVOKE ALL ON FUNCTION public\.run_advanced_monitoring_checks\([^)]*\) FROM PUBLIC, anon, authenticated;/u);
});

test('new tables are RPC-only and immutable: RLS on, client grants revoked, mutation triggers', () => {
  for (const table of ['owner_cash_withdrawals', 'owner_cash_withdrawal_reversals']) {
    assert.match(m180, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`, 'u'));
    assert.match(m180, new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM PUBLIC, anon, authenticated`, 'u'));
    assert.match(m180, new RegExp(`BEFORE UPDATE OR DELETE ON public\\.${table}\\n`, 'u'));
    assert.match(m180, new RegExp(`BEFORE TRUNCATE ON public\\.${table}\\n`, 'u'));
  }
  assert.doesNotMatch(m180, /GRANT (?:SELECT|INSERT|UPDATE|DELETE|ALL)[^;]*ON (?:TABLE )?public\.owner_cash_withdrawal/u);
  assert.match(m180, /CHECK \(amount_in_minor_units > 0\)/u);
});

test('decision 2: a withdrawal larger than the expected drawer cash is refused with «بالدرج X فقط»', () => {
  const create = body(m180, 'create_owner_cash_withdrawal_v1');
  assert.match(create, /assert_erp_role\(ARRAY\['owner'\]/u, 'owner only');
  assert.match(create, /OWNER_WITHDRAWAL_EXCEEDS_DRAWER: بالدرج % فقط\./u);
  assert.match(create, /FOR UPDATE/u, 'the shift row is locked so two tabs cannot both pass the cap');
  assert.match(create, /OWNER_WITHDRAWAL_KEY_CONFLICT/u, 'a reused key with another payload is refused');
});

test('decision 1: reversal is owner-only with a reason and lands in an open shift of the same branch', () => {
  const reverse = body(m180, 'reverse_owner_cash_withdrawal_v1');
  assert.match(reverse, /assert_reversal_owner\(/u);
  assert.match(reverse, /char_length\(v_reason\) NOT BETWEEN 5 AND 500/u);
  assert.match(reverse, /OWNER_WITHDRAWAL_REVERSAL_NEEDS_OPEN_SHIFT/u);
  assert.match(reverse, /OWNER_WITHDRAWAL_ALREADY_REVERSED/u);
  assert.match(reverse, /shift\.branch_id = v_withdrawal\.branch_id AND shift\.status = 'open'/u);
  assert.doesNotMatch(reverse, /UPDATE public\.cash_shifts/u, 'the original shift snapshot is never rewritten');
});

test('decision 3: full shift reversal plans first, refuses before any write, then reverses atomically', () => {
  const full = body(m180, 'reverse_cash_shift_with_operations');
  const plan = full.indexOf("IF NOT (v_plan->>'canExecute')::BOOLEAN THEN");
  const inner = full.indexOf('_reverse_cash_shift_with_operations_before_phase42_refund_guard(');
  const insert = full.indexOf('INSERT INTO public.owner_cash_withdrawal_reversals');
  assert.ok(plan > 0 && inner > plan && insert > inner, 'plan check, then the core reversal, then withdrawal reversals');
  assert.match(full, /via_shift_reversal_id/u);
  assert.match(full, /nawasrah\.owner_withdrawal_void/u, 'foreign returns are voided in the same transaction');
  assert.match(body(m180, 'preview_cash_shift_full_reversal'), /'ownerWithdrawals', v_plan/u);
  assert.match(body(m180, 'cancel_empty_cash_shift'), /حركة مالية/u, 'a shift with withdrawals is not empty');
});

test('the drawer summary and the closing snapshot carry withdrawals; snapshot version stays 1', () => {
  const summary = body(m180, 'get_cash_shift_summary');
  assert.match(summary, /ownerWithdrawalsInMinorUnits/u);
  assert.match(summary, /ownerWithdrawalReturnsInMinorUnits/u);
  const close = body(m181, 'close_cash_shift');
  assert.match(close, /'ownerWithdrawals', v_section/u);
  assert.doesNotMatch(close, /closing_report_snapshot_version\s*=\s*2|'snapshotVersion', 2/u);
  assert.match(body(m181, 'owner_withdrawal_closing_section_internal'), /'sectionVersion', 1/u);
});

test('reports: withdrawals are owner-only and never change profit', () => {
  const report = body(m181, 'get_operational_business_report');
  assert.match(report, /IF public\.has_erp_role\(ARRAY\['owner'\]\) THEN/u);
  assert.match(report, /'remainingAfterWithdrawalsInMinorUnits', v_profit - /u);
  assert.doesNotMatch(report, /jsonb_set\(v_result, '\{sales/u, 'sales/profit fields are not rewritten');
  const dashboard = body(m181, 'get_home_dashboard');
  assert.match(dashboard, /IF public\.has_erp_role\(ARRAY\['owner'\]\) THEN/u);
  assert.match(dashboard, /v_profit := \(v_result #>> '\{summary,monthProfitInMinorUnits\}'\)::BIGINT;/u,
    'an unavailable month profit stays unavailable');
  assert.match(body(m181, 'get_owner_withdrawals_report'), /assert_erp_role\(ARRAY\['owner'\]/u);
});

test('monitoring: closing formula subtracts the frozen withdrawal effect and a critical integrity check exists', () => {
  const monitor = body(m182, 'run_advanced_monitoring_checks');
  assert.match(monitor, /- *\n?\s*public\.owner_withdrawal_frozen_shift_effect_internal\(id\)/u);
  assert.match(monitor, /'integrity:accounting:owner-withdrawals'/u);
  assert.match(body(m182, 'owner_withdrawal_frozen_shift_effect_internal'), /= 'reversed'/u,
    'a fully reversed shift is neutral on the withdrawal side too');
});

test('frontend: literal RPC names, owner-only panel, decision-4 warning never blocks', () => {
  const service = read('src/services/supabase/ownerWithdrawals.service.ts');
  for (const rpc of ['create_owner_cash_withdrawal_v1', 'reverse_owner_cash_withdrawal_v1', 'get_shift_owner_withdrawals_v1', 'get_owner_withdrawals_report'])
    assert.match(service, new RegExp(`rpc\\('${rpc}'`, 'u'));
  assert.doesNotMatch(service, /\.from\(/u, 'no direct table access');
  const shifts = read('src/features/shifts/ShiftsView.tsx');
  assert.match(shifts, /\{isOwner && <OwnerWithdrawalsPanel /u);
  const hook = read('src/hooks/useDrawerShortfallConfirm.tsx');
  assert.match(hook, /بالدرج \$\{[^}]+\} دينار فقط، متأكد؟/u);
  for (const file of ['src/features/expenses/ExpenseFormModal.tsx', 'src/features/purchases/SupplierPaymentModal.tsx',
    'src/features/directReceiving/RecordSupplierPaymentModal.tsx', 'src/features/directReceiving/CreateDirectReceiptModal.tsx',
    'src/features/goLive/GoLiveSetupView.tsx'])
    assert.match(read(file), /drawer\.confirmCash\(/u, `${file} warns before a cash payment above the drawer`);
});
