import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/060_simplified_order_settlement_and_receivables.sql',
    import.meta.url
  ),
  'utf8'
);
const orderService = readFileSync(
  new URL('../src/services/supabase/orders.service.ts', import.meta.url),
  'utf8'
);
const orderModal = readFileSync(
  new URL('../src/features/orders/OrderDetailModal.tsx', import.meta.url),
  'utf8'
);

test('one-click order acceptance preserves canonical reservation and history', () => {
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.accept_order_for_preparation/
  );
  assert.match(migration, /PERFORM public\.confirm_order\(/);
  assert.match(migration, /public\.update_order_status\([\s\S]*'preparing'/);
  assert.match(orderService, /\.rpc\('accept_order_for_preparation'/);
  assert.match(orderModal, /قبول الطلب وبدء التجهيز/);
});

test('delivery can start from preparation while audited ready stage is retained', () => {
  assert.match(migration, /IF v_status = 'preparing' THEN/);
  assert.match(migration, /public\.update_order_status\([\s\S]*'ready'/);
  assert.match(migration, /public\.update_order_status\([\s\S]*'out_for_delivery'/);
});

test('website settlement owns delivery fee, partial payment and receivable atomically', () => {
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.complete_website_order_with_settlement/
  );
  assert.match(migration, /p_amount_collected_in_minor_units BIGINT/);
  assert.match(migration, /p_delivery_fee_in_minor_units BIGINT/);
  assert.match(migration, /WHEN v_remaining > 0 THEN 'debt'/);
  assert.match(migration, /public\.record_customer_order_payment\(/);
  assert.match(migration, /v_result := public\.complete_order\(/);
  assert.match(
    orderService,
    /\.rpc\([\s\S]*'complete_website_order_with_settlement'/
  );
});

test('admin settlement UI exposes full, partial and account payment clearly', () => {
  assert.match(orderModal, /أجرة التوصيل/);
  assert.match(orderModal, /دفع كامل/);
  assert.match(orderModal, /دفع جزئي/);
  assert.match(orderModal, /على الحساب/);
  assert.match(orderModal, /ذمة العميل/);
  assert.match(orderModal, /يمكن تسديده لاحقًا بسند قبض/);
});

test('settlement RPC remains authenticated-only', () => {
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.complete_website_order_with_settlement\([\s\S]*FROM PUBLIC, anon;/
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.complete_website_order_with_settlement\([\s\S]*TO authenticated;/
  );
});
