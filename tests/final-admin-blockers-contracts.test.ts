import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations/085_admin_customer_receivables_and_scalability.sql',
  'utf8'
);
const crmService = readFileSync(
  'src/services/supabase/crm.service.ts',
  'utf8'
);
const posService = readFileSync(
  'src/services/supabase/pos.service.ts',
  'utf8'
);
const posView = readFileSync('src/features/pos/PosView.tsx', 'utf8');

test('POS debt is included without treating POS cash or CliQ as receivable', () => {
  assert.match(migration, /OR o\.payment_method = 'debt'/);
  assert.match(migration, /o\.status IN \('completed', 'delivered'\)/);
  assert.match(
    migration,
    /o\.amount_paid_in_minor_units < o\.total_in_minor_units/
  );
  assert.match(migration, /ORDER BY created_at DESC, id DESC/);
});

test('customer details use a bounded server history read model', () => {
  const detailStart = crmService.indexOf(
    'export async function fetchCustomerDetailsCrmFromSupabase'
  );
  const detailSource = crmService.slice(detailStart);
  assert.match(detailSource, /rpc\(\s*'get_crm_customer_detail_page'/);
  assert.doesNotMatch(detailSource, /from\('orders'\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_crm_customer_detail_page/);
  assert.match(migration, /OFFSET v_offset\s+LIMIT v_page_size/);
  assert.doesNotMatch(migration, /SELECT \* FROM public\.orders/);
});

test('POS customer selection searches and pages the complete server directory', () => {
  assert.match(posService, /rpc\('get_pos_customer_page'/);
  assert.doesNotMatch(posService, /\.limit\(250\)/);
  assert.doesNotMatch(posService, /from\('customers'\)/);
  assert.match(posView, /customerSearch/);
  assert.match(posView, /loadMorePosCustomers/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_pos_customer_page/);
  assert.match(migration, /idx_customers_pos_name_search/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_pos_customer_page/);
});
