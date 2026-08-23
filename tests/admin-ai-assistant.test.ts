import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/066_secure_admin_ai_assistant.sql', import.meta.url),
  'utf8',
);
const inventoryMigration = readFileSync(
  new URL('../supabase/migrations/067_admin_ai_inventory_lookup.sql', import.meta.url),
  'utf8',
);
const edgeFunction = readFileSync(
  new URL('../supabase/functions/admin-ai-assistant/index.ts', import.meta.url),
  'utf8',
);
const service = readFileSync(
  new URL('../src/services/supabase/adminAssistant.service.ts', import.meta.url),
  'utf8',
);
const view = readFileSync(
  new URL('../src/features/assistant/AdminAssistantView.tsx', import.meta.url),
  'utf8',
);
const app = readFileSync(
  new URL('../src/App.tsx', import.meta.url),
  'utf8',
);
const functionConfig = readFileSync(
  new URL('../supabase/config.toml', import.meta.url),
  'utf8',
);

test('admin AI assistant is authenticated, role guarded, and rate limited', () => {
  assert.match(migration, /PERFORM public\.assert_erp_role/);
  assert.match(migration, /ARRAY\['owner', 'admin', 'manager', 'accountant'\]/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /INTERVAL '15 minutes'/);
  assert.match(migration, /v_requests_in_window >= 20/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.authorize_admin_ai_assistant_request\(\) TO authenticated/);
  assert.match(functionConfig, /\[functions\.admin-ai-assistant\]\s+verify_jwt = true/);
});

test('assistant reuses authenticated dashboard data and excludes personal order data', () => {
  assert.match(edgeFunction, /authorize_admin_ai_assistant_request/);
  assert.match(edgeFunction, /get_home_dashboard/);
  assert.match(edgeFunction, /buildSafeSnapshot/);
  assert.match(edgeFunction, /لا يحتوي بيانات شخصية/);
  assert.doesNotMatch(edgeFunction, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(edgeFunction, /latestOrders/);
});

test('assistant answers product availability from a guarded live inventory RPC', () => {
  assert.match(inventoryMigration, /get_admin_ai_inventory_snapshot/);
  assert.match(inventoryMigration, /PERFORM public\.assert_erp_role/);
  assert.match(inventoryMigration, /availableBaseUnits/);
  assert.match(inventoryMigration, /availableSalePackages/);
  assert.match(inventoryMigration, /REVOKE ALL ON FUNCTION public\.get_admin_ai_inventory_snapshot\(\) FROM PUBLIC, anon/);
  assert.match(edgeFunction, /get_admin_ai_inventory_snapshot/);
  assert.match(edgeFunction, /findInventoryMatches/);
  assert.match(edgeFunction, /levenshteinDistance/);
  assert.match(edgeFunction, /collapseRepeatedLatinLetters/);
  assert.match(edgeFunction, /watter.*water/);
  assert.ok(edgeFunction.includes(".replace(/[؟،؛]/g, ' ')"));
  assert.match(edgeFunction, /Array\.isArray\(payload\) \? payload\[0\] : payload/);
  assert.match(edgeFunction, /mapDashboardStockAlerts/);
  assert.match(edgeFunction, /buildDirectInventoryAnswer/);
  assert.match(edgeFunction, /alert\.nameAr/);
  assert.match(edgeFunction, /alert\.availableSalePackages/);
  assert.match(edgeFunction, /summary\.todaySalesInMinorUnits/);
  assert.match(edgeFunction, /day\.salesInMinorUnits/);
});

test('Gemini key remains server-side and the UI does not persist conversations', () => {
  assert.match(edgeFunction, /Deno\.env\.get\('GEMINI_API_KEY'\)/);
  assert.match(edgeFunction, /x-goog-api-key/);
  assert.match(service, /supabase\.functions\.invoke/);
  assert.doesNotMatch(service, /GEMINI_API_KEY/);
  assert.match(view, /useState<AdminAssistantMessage\[\]>\(\[\]\)/);
  assert.doesNotMatch(view, /localStorage/);
});

test('eligible staff can open the assistant from a fixed mobile launcher', () => {
  assert.match(app, /aria-label="فتح المساعد الإداري الذكي"/);
  assert.match(app, /bottom-20 left-3/);
  assert.match(app, /activeTab !== 'assistant'/);
  assert.match(app, /'owner', 'admin', 'manager', 'accountant'/);
});
