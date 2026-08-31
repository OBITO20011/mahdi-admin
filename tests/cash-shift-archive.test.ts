import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('supabase/migrations/093_cash_shift_archive.sql', 'utf8');
const service = readFileSync('src/services/supabase/expenses-shifts.service.ts', 'utf8');
const archiveUi = readFileSync('src/features/shifts/ShiftArchiveSection.tsx', 'utf8');

test('shift archive is a protected, bounded read model with complete filters', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_cash_shift_archive_page/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /ARRAY\['owner', 'admin', 'manager', 'accountant'\]/);
  assert.match(migration, /p_branch_id UUID/);
  assert.match(migration, /p_cashier_id UUID/);
  assert.match(migration, /p_status TEXT/);
  assert.match(migration, /p_shift_number TEXT/);
  assert.match(migration, /p_date_from DATE/);
  assert.match(migration, /p_date_to DATE/);
  assert.match(migration, /OFFSET v_offset[\s\S]*LIMIT v_limit/);
  assert.match(migration, /v_limit NOT BETWEEN 1 AND 100/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_cash_shift_archive_page[\s\S]*FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_cash_shift_archive_page[\s\S]*TO authenticated/);
  assert.doesNotMatch(migration, /\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+)?public\.cash_shifts/i);
});

test('archive UI and service keep paging server-side and reuse the canonical report', () => {
  assert.match(service, /fetchCashShiftArchivePageFromSupabase/);
  assert.match(service, /rpc\('get_cash_shift_archive_page'/);
  assert.match(service, /p_limit: input\.limit/);
  assert.match(service, /p_offset: input\.offset/);
  assert.match(archiveUi, /const PAGE_SIZE = 25/);
  assert.match(archiveUi, /fetchCashShiftArchivePageFromSupabase\(applied\)/);
  assert.match(archiveUi, /onOpenReport\(shift\.id\)/);
  assert.match(archiveUi, /open: 'مفتوحة'/);
  assert.match(archiveUi, /closed: 'مغلقة'/);
  assert.match(archiveUi, /cancelled: 'ملغاة'/);
  assert.match(archiveUi, /reversed: 'معكوسة'/);
});
