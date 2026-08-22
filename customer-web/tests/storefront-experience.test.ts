import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../../supabase/migrations/036_storefront_experience_and_payment.sql',
    import.meta.url
  ),
  'utf8'
);

test('guest payment wrapper reuses the guarded checkout core', () => {
  assert.match(migration, /RENAME TO submit_guest_customer_order_core/);
  assert.match(migration, /public\.submit_guest_customer_order_core\(/);
  assert.match(migration, /NOT IN \('cash_on_delivery', 'cliq'\)/);
  assert.match(migration, /payment_status = 'unpaid'/);
  assert.doesNotMatch(
    migration,
    /UPDATE public\.inventory_balances|INSERT INTO public\.order_items/
  );
});

test('public order tracking requires both exact order number and phone', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.track_guest_order/);
  assert.match(migration, /UPPER\(o\.order_number\) = UPPER\(TRIM\(p_order_number\)\)/);
  assert.match(migration, /normalize_customer_phone\(c\.phone\) = v_phone/);
  assert.match(migration, /No address,\n-- customer identity, product names or internal notes are exposed/);
});

test('storefront catalog uses real completed sales and keeps canonical catalog', () => {
  assert.match(migration, /public\.get_public_product_catalog\(/);
  assert.match(migration, /o\.status = 'completed'/);
  assert.match(migration, /soldPackagesLast90Days/);
  assert.match(migration, /without exposing purchase costs or suppliers/);
});
