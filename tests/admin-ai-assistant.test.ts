import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/066_secure_admin_ai_assistant.sql', import.meta.url),
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

test('Gemini key remains server-side and the UI does not persist conversations', () => {
  assert.match(edgeFunction, /Deno\.env\.get\('GEMINI_API_KEY'\)/);
  assert.match(edgeFunction, /x-goog-api-key/);
  assert.match(service, /supabase\.functions\.invoke/);
  assert.doesNotMatch(service, /GEMINI_API_KEY/);
  assert.match(view, /useState<AdminAssistantMessage\[\]>\(\[\]\)/);
  assert.doesNotMatch(view, /localStorage/);
});
