import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const inventoryService = readFileSync(
  'src/services/supabase/inventory.service.ts',
  'utf8',
);
const crmService = readFileSync('src/services/supabase/crm.service.ts', 'utf8');
const purchasesService = readFileSync(
  'src/services/supabase/purchases.service.ts',
  'utf8',
);
const directReceivingService = readFileSync(
  'src/services/supabase/directReceiving.service.ts',
  'utf8',
);
const ordersService = readFileSync(
  'src/services/supabase/orders.service.ts',
  'utf8',
);
const migration = readFileSync(
  'supabase/migrations/077_paginated_inventory_and_crm_read_models.sql',
  'utf8',
);

test('inventory movement history is a guarded server-paged read model', () => {
  assert.match(inventoryService, /rpc\('get_inventory_movement_page'/);
  assert.match(inventoryService, /p_page_size: pageSize/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_inventory_movement_page/);
  assert.match(migration, /PERFORM public\.assert_erp_role/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_inventory_movement_page/);
});

test('CRM directory aggregates and pages in PostgreSQL rather than React', () => {
  const listStart = crmService.indexOf('export async function fetchCustomersCrmFromSupabase');
  const detailStart = crmService.indexOf('export async function fetchCustomerDetailsCrmFromSupabase');
  const directorySource = crmService.slice(listStart, detailStart);

  assert.match(directorySource, /readOperatingReceivablesWithRpc\(\(name,args\)=>supabase!\.rpc\(name,args\),\s*'crm',/u);
  const dispatcher = readFileSync('src/services/supabase/operatingReceivables.ts', 'utf8');
  assert.match(dispatcher, /kind==='aging'\?'lite1_debt_aging2':'lite1_crm_page2'/u);
  assert.match(dispatcher, /kind==='aging'\?'get_customer_debt_aging':'get_crm_customer_page'/u);
  assert.match(dispatcher, /if\(reply\.status===404&&reply\.data==null&&reply\.error\?\.code==='PGRST202'&&reply\.error\.message\?\.includes\(name\)\)return execute\(legacy,args\);/u);
  assert.equal((dispatcher.match(/execute\(legacy,args\)/gu)??[]).length, 1);
  const liteMigration = readFileSync('supabase/migrations/220_sales_only_operating_mode.sql', 'utf8');
  const liteCrm = liteMigration.match(/CREATE FUNCTION public\.lite1_crm_page2\([^\n]*\)[\s\S]*?\$function\$;/u)?.[0];
  assert.ok(liteCrm);
  assert.match(liteCrm, /OFFSET v_offset LIMIT v_page_size/u);
  assert.doesNotMatch(directorySource, /from\('customers'\)/);
  assert.doesNotMatch(directorySource, /customers\.slice\(/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_crm_customer_page/);
  assert.match(migration, /OFFSET v_offset/);
});

test('CRM and supplier realtime listeners coalesce writes before refreshing views', () => {
  for (const source of [crmService, purchasesService, directReceivingService]) {
    assert.match(source, /let refreshTimer: ReturnType<typeof setTimeout>/);
    assert.match(source, /setTimeout\(\(\) => \{/);
    assert.match(source, /\}, 350\)/);
  }
  assert.match(crmService, /customerIds: string\[\]/);
  assert.match(crmService, /affectedCustomerIds/);
});

test('orders realtime no longer prints production change payloads', () => {
  assert.doesNotMatch(ordersService, /console\.log\(\s*['"][^'"]*Realtime/);
  assert.match(ordersService, /scheduleRefresh/);
});
