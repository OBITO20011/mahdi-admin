import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/022_operational_home_dashboard.sql',
    import.meta.url
  ),
  'utf8'
);

const service = readFileSync(
  new URL('../src/services/supabase/dashboard.service.ts', import.meta.url),
  'utf8'
);

const view = readFileSync(
  new URL('../src/features/dashboard/DashboardView.tsx', import.meta.url),
  'utf8'
);

test('home dashboard is exposed only through one authenticated RPC', () => {
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /PERFORM public\.assert_erp_role/);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.get_home_dashboard\(\)\s+TO authenticated/
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.get_home_dashboard\(\)\s+FROM PUBLIC, anon/
  );
  assert.match(service, /supabase\.rpc\('get_home_dashboard'\)/);
  assert.doesNotMatch(service, /\.from\(/);
});

test('realized dashboard sales and profit use completed orders and cost snapshots', () => {
  assert.match(migration, /o\.status = 'completed'/);
  assert.match(migration, /SUM\(oi\.profit_in_minor_units\)/);
  assert.doesNotMatch(service, /Math\.random/);
  assert.doesNotMatch(service, /source: 'mock'/);
});

test('stock alerts use configured wholesale sale packages', () => {
  assert.match(migration, /p\.units_per_sale_unit/);
  assert.match(migration, /p\.default_sale_price_in_minor_units/);
  assert.match(migration, /availableSalePackages/);
  assert.match(view, /الجاهزية محسوبة حسب طرد البيع/);
});

test('the operational home removes the legacy dashboard overload', () => {
  assert.doesNotMatch(view, /ChartsSection/);
  assert.doesNotMatch(view, /KpiCards/);
  assert.doesNotMatch(view, /WidgetsSection/);
  assert.doesNotMatch(view, /SmartLowStockAlertBar/);
});

test('the home is a focused daily work center, not a reports shortcut', () => {
  assert.match(view, /مركز اليوم/);
  assert.match(view, /طلبات جديدة/);
  assert.match(view, /قيد التجهيز/);
  assert.match(view, /بالتوصيل/);
  assert.match(view, /ذمم العملاء/);
  assert.match(view, /الإجراء التالي/);
  assert.doesNotMatch(view, /setActiveTab\('reports'\)/);
});
