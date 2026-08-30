import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations/055_operational_business_reports.sql',
  'utf8'
);
const service = readFileSync(
  'src/services/supabase/reports.service.ts',
  'utf8'
);
const view = readFileSync(
  'src/features/reports/ReportsCenterView.tsx',
  'utf8'
);
const moreMenu = readFileSync(
  'src/features/more/MoreMenuView.tsx',
  'utf8'
);
const navigationConfig = readFileSync(
  'src/features/more/adminNavigation.config.ts',
  'utf8'
);

test('business reports are calculated by one authenticated role-checked RPC', () => {
  assert.match(
    migration,
    /FUNCTION public\.get_operational_business_report\(/
  );
  assert.match(migration, /public\.assert_erp_role/);
  assert.match(migration, /order_status_history/);
  assert.match(migration, /operational_expenses/);
  assert.match(migration, /supplier_receipts/);
  assert.match(migration, /inventory_balances/);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.get_operational_business_report[\s\S]*FROM PUBLIC, anon/
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.get_operational_business_report[\s\S]*TO authenticated/
  );
});

test('report UI uses the RPC service and offers real browser print to Arabic PDF', () => {
  assert.match(service, /rpc\(\s*'get_operational_business_report'/);
  assert.match(view, /fetchOperationalBusinessReportFromSupabase/);
  assert.match(view, /window\.print\(\)/);
  assert.match(view, /@page \{ size: A4 portrait/);
  assert.match(view, /direction: rtl/);
  assert.doesNotMatch(view, /alert\(/);
  assert.match(moreMenu, /handleNavigationAction\(item\.action\)/);
  assert.match(navigationConfig, /destination: 'reports'/);
  assert.match(navigationConfig, /التقارير والحسابات/);
});
