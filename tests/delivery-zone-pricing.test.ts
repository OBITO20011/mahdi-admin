import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/061_delivery_zone_pricing.sql', import.meta.url),
  'utf8'
);
const adminSettings = readFileSync(
  new URL('../src/features/more/StorefrontSettingsModal.tsx', import.meta.url),
  'utf8'
);
const checkout = readFileSync(
  new URL('../customer-web/src/components/CheckoutModal.tsx', import.meta.url),
  'utf8'
);
const orderService = readFileSync(
  new URL('../customer-web/src/services/orders.service.ts', import.meta.url),
  'utf8'
);
const guestOrderGateway = readFileSync(
  new URL(
    '../supabase/functions/submit-guest-order/index.ts',
    import.meta.url
  ),
  'utf8'
);

test('admin controls two persisted delivery fees', () => {
  assert.match(adminSettings, /insideRamthaDeliveryFee/);
  assert.match(adminSettings, /outsideRamthaDeliveryFee/);
  assert.match(migration, /inside_ramtha_delivery_fee_in_minor_units/);
  assert.match(migration, /outside_ramtha_delivery_fee_in_minor_units/);
});

test('customer selects a delivery zone and sees a delivery-inclusive total', () => {
  assert.match(checkout, /داخل الرمثا/);
  assert.match(checkout, /خارج الرمثا/);
  assert.match(checkout, /checkoutBeforeDelivery \+ selectedDeliveryFee/);
  assert.match(checkout, /الإجمالي شامل التوصيل/);
  assert.match(orderService, /deliveryZone: request\.deliveryZone/);
  assert.match(guestOrderGateway, /p_delivery_zone: text\(body\.deliveryZone/);
});

test('PostgreSQL owns fee selection and rejects mismatched inside-Ramtha addresses', () => {
  assert.match(migration, /CASE v_delivery_zone/);
  assert.match(migration, /WHEN 'inside_ramtha'/);
  assert.match(migration, /NOT ILIKE '%الرمثا%'/);
  assert.match(migration, /total_in_minor_units = v_total/);
  assert.doesNotMatch(orderService, /p_delivery_fee/);
});
