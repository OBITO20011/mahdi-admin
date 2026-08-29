import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const purchasesService = readFileSync('src/services/supabase/purchases.service.ts', 'utf8');
const directReceivingService = readFileSync(
  'src/services/supabase/directReceiving.service.ts',
  'utf8',
);
const customerAccountsService = readFileSync(
  'src/services/supabase/customerAccounts.service.ts',
  'utf8',
);
const migration = readFileSync(
  'supabase/migrations/082_admin_historical_read_models.sql',
  'utf8',
);

test('admin historical purchase reads use guarded server-paged contracts', () => {
  assert.match(purchasesService, /rpc\('get_purchase_orders_page'/);
  assert.match(purchasesService, /rpc\('get_supplier_payments_page'/);
  assert.match(directReceivingService, /rpc\('get_supplier_receipts_page'/);
  assert.match(purchasesService, /p_page_size: pageSize/);
  assert.match(directReceivingService, /p_page_size: pageSize/);

  for (const functionName of [
    'get_purchase_orders_page',
    'get_supplier_receipts_page',
    'get_supplier_payments_page',
  ]) {
    assert.match(migration, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}`));
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${functionName}`));
    assert.match(migration, /PERFORM public\.assert_erp_role/);
  }
});

test('customer outstanding balances are calculated and paged in PostgreSQL', () => {
  const functionStart = customerAccountsService.indexOf(
    'export async function fetchCustomerOutstandingOrders',
  );
  const functionEnd = customerAccountsService.indexOf(
    'export interface RecordCustomerPaymentInput',
  );
  const source = customerAccountsService.slice(functionStart, functionEnd);

  assert.match(source, /rpc\('get_customer_outstanding_orders_page'/);
  assert.doesNotMatch(source, /from\('orders'\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_customer_outstanding_orders_page/);
  assert.match(migration, /amount_due_in_minor_units/);
  assert.match(migration, /OFFSET v_offset LIMIT v_page_size/);
});
