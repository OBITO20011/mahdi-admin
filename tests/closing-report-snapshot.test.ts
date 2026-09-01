import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/094_immutable_cash_shift_closing_report_snapshot.sql',
    import.meta.url
  ),
  'utf8'
);
const service = readFileSync(
  new URL('../src/services/supabase/expenses-shifts.service.ts', import.meta.url),
  'utf8'
);
const modal = readFileSync(
  new URL('../src/features/shifts/ShiftClosingReportModal.tsx', import.meta.url),
  'utf8'
);

test('migration captures the report only during a new close and makes it immutable', () => {
  assert.match(migration, /closing_report_snapshot JSONB/);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER trg_closed_cash_shift_requires_snapshot/);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(migration, /لقطة تقرير الإغلاق محفوظة ولا يمكن تعديلها أو حذفها/);
  assert.match(migration, /لا يمكن إضافة لقطة تقرير إلى وردية تاريخية مغلقة/);
  assert.match(migration, /_close_cash_shift_before_closing_report_snapshot/);
  assert.match(migration, /closingReportSnapshotCaptured/);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+public\.(?:orders|order_items|inventory_movements)/i);
});

test('new reports expose immutable status while legacy reports stay explicit', () => {
  assert.match(migration, /'snapshotStatus', 'immutable'/);
  assert.match(migration, /'legacy_recalculated'/);
  assert.match(service, /snapshotStatus:/);
  assert.match(modal, /لقطة الإغلاق محفوظة وثابتة للتدقيق والطباعة/);
  assert.match(modal, /تقرير تاريخي محسوب/);
});
