import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/042_website_order_payment_settlement.sql',
    import.meta.url
  ),
  'utf8'
);
const service = readFileSync(
  new URL('../src/services/supabase/orders.service.ts', import.meta.url),
  'utf8'
);
const store = readFileSync(
  new URL('../src/stores/useAppStore.ts', import.meta.url),
  'utf8'
);
const orderDetail = readFileSync(
  new URL('../src/features/orders/OrderDetailModal.tsx', import.meta.url),
  'utf8'
);

test('website collection is an authenticated atomic RPC', () => {
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.complete_website_order_with_payment/
  );
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(
    migration,
    /ARRAY\['owner', 'admin', 'manager', 'sales'\]/
  );
  assert.match(migration, /public\.complete_order\(/);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.complete_website_order_with_payment[\s\S]*TO authenticated/
  );
  assert.doesNotMatch(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.complete_website_order_with_payment[\s\S]*TO anon/
  );
});

test('collection requires an open shift and CliQ reference', () => {
  assert.match(migration, /status = 'open'[\s\S]*FOR SHARE/);
  assert.match(migration, /cash_shift_id = v_shift_id/);
  assert.match(
    migration,
    /v_payment_method = 'cliq'[\s\S]*p_reference_number/
  );
  assert.match(migration, /CONFIRM_WEBSITE_ORDER_PAYMENT/);
});

test('generic completion cannot bypass explicit collection', () => {
  assert.match(
    migration,
    /CREATE TRIGGER trg_require_order_collection_before_completion/
  );
  assert.match(
    migration,
    /NEW\.status = 'completed'[\s\S]*NEW\.payment_confirmed_at IS NULL/
  );
});

test('admin completes delivery only through the settlement RPC', () => {
  assert.match(service, /\.rpc\(\s*'complete_website_order_with_payment'/);
  assert.match(store, /completeWebsiteOrderWithPaymentInSupabase/);
  assert.match(orderDetail, /اعتماد التسليم والحساب/);
  assert.match(orderDetail, /رقم مرجع CliQ/);
  assert.match(orderDetail, />\s*كاش\s*</);
  assert.match(orderDetail, />\s*CliQ\s*</);
});
