import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations/056_inventory_movement_reports_and_public_pos_receipts.sql',
  'utf8'
);
const reportService = readFileSync(
  'src/services/supabase/reports.service.ts',
  'utf8'
);
const reportView = readFileSync(
  'src/features/reports/ReportsCenterView.tsx',
  'utf8'
);
const posService = readFileSync(
  'src/services/supabase/pos.service.ts',
  'utf8'
);

test('operational report adds audited inventory movement summaries by period', () => {
  assert.match(migration, /FROM public\.inventory_movements im/);
  assert.match(migration, /im\.created_at >= v_period_start/);
  assert.match(migration, /w\.branch_id = p_branch_id/);
  assert.match(migration, /'inventoryMovements'/);
  assert.match(migration, /'types'/);
  assert.match(migration, /'topProducts'/);
  assert.match(reportService, /inventoryMovements/);
  assert.match(reportView, /حركة المخزون خلال الفترة/);
  assert.match(reportView, /أكثر الأصناف حركة/);
});

test('public POS receipt links are random, staff-issued, and sanitized', () => {
  assert.match(migration, /public_receipt_token UUID/);
  assert.match(migration, /gen_random_uuid\(\)/);
  assert.match(migration, /FUNCTION public\.get_or_create_pos_receipt_token/);
  assert.match(migration, /public\.assert_erp_role/);
  assert.match(migration, /FUNCTION public\.get_public_pos_receipt/);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.get_public_pos_receipt\(UUID\)[\s\S]*TO anon, authenticated/
  );
  assert.match(migration, /o\.source = 'pos'/);
  assert.doesNotMatch(migration, /'customerPhone'|'customerAddress'|'costInMinorUnits'|'profitInMinorUnits'/);
  assert.match(posService, /get_or_create_pos_receipt_token/);
  assert.match(posService, /nawasrah-store\.pages\.dev/);
});
