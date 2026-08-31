import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations/058_secure_order_delivery_tracking.sql',
  'utf8'
);
const driverMigration = readFileSync(
  'supabase/migrations/059_delivery_driver_contact.sql',
  'utf8'
);
const orderService = readFileSync(
  'src/services/supabase/orders.service.ts',
  'utf8'
);
const orderModal = readFileSync(
  'src/features/orders/OrderDetailModal.tsx',
  'utf8'
);
const trackingReceiptMigration = readFileSync(
  'supabase/migrations/089_customer_order_tracking_receipt.sql',
  'utf8'
);

test('delivery tracking uses a per-order unguessable token and exposes no customer PII', () => {
  assert.match(migration, /tracking_token UUID/);
  assert.match(migration, /SET DEFAULT gen_random_uuid\(\)/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_tracking_token/);
  assert.match(migration, /track_guest_order_by_token/);
  assert.doesNotMatch(
    migration.match(/CREATE OR REPLACE FUNCTION public\.build_public_order_tracking_payload[\s\S]*?END;\n\$\$;/)?.[0] || '',
    /customer_phone|google_maps_url|address_notes|latitude|longitude/
  );
});

test('starting delivery is authenticated, audited and reuses canonical status RPC', () => {
  const deliveryRpc =
    migration.match(
      /CREATE OR REPLACE FUNCTION public\.start_or_update_order_delivery[\s\S]*?END;\n\$\$;/
    )?.[0] || '';
  assert.match(deliveryRpc, /assert_erp_role/);
  assert.match(deliveryRpc, /public\.update_order_status/);
  assert.match(deliveryRpc, /INSERT INTO public\.audit_logs/);
  assert.match(deliveryRpc, /p_eta_minutes NOT BETWEEN 5 AND 360/);
  assert.doesNotMatch(deliveryRpc, /inventory_balances|inventory_movements/);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.start_or_update_order_delivery\(UUID, INTEGER, TEXT\)\s+TO authenticated/
  );
  assert.doesNotMatch(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.start_or_update_order_delivery[\s\S]{0,80}TO anon/
  );
});

test('admin delivery UI requires ETA and creates the public tracking link', () => {
  assert.match(orderService, /rpc\(\s*'start_or_update_order_delivery'/);
  assert.match(orderService, /VITE_STOREFRONT_PUBLIC_URL/);
  assert.match(orderService, /#track=/);
  assert.match(orderModal, /15, 30, 45, 60/);
  assert.match(orderModal, /بدء التوصيل وتحديد وقت الوصول/);
  assert.match(orderModal, /نسخ رابط التتبع/);
});

test('driver contact is normalized, required, audited and shared through secure tracking', () => {
  assert.match(driverMigration, /delivery_driver_phone TEXT/);
  assert.match(driverMigration, /normalize_customer_phone\(p_driver_phone\)/);
  assert.match(driverMigration, /أدخل رقم السائق قبل بدء التوصيل/);
  assert.match(driverMigration, /'driver_phone', v_driver_phone/);
  assert.match(driverMigration, /INSERT INTO public\.audit_logs/);
  assert.match(
    driverMigration,
    /GRANT EXECUTE ON FUNCTION public\.start_or_update_order_delivery\([\s\S]*?\) TO authenticated/
  );
  assert.doesNotMatch(
    driverMigration,
    /GRANT EXECUTE ON FUNCTION public\.start_or_update_order_delivery[\s\S]{0,120}TO anon/
  );
  assert.match(orderService, /p_driver_phone: driverPhone\.trim\(\)/);
  assert.match(orderModal, /إرسال التتبع ورقم السائق للعميل/);
});

test('guest checkout returns only its opaque tracking token through the existing gateway-only contract', () => {
  assert.match(
    trackingReceiptMigration,
    /'tracking_token', v_tracking_token/
  );
  assert.match(
    trackingReceiptMigration,
    /'tracking_path', '\/#track=' \|\| v_tracking_token::TEXT/
  );
  assert.match(
    trackingReceiptMigration,
    /GRANT EXECUTE ON FUNCTION public\.submit_guest_customer_order[\s\S]*?TO service_role/
  );
  assert.doesNotMatch(
    trackingReceiptMigration,
    /GRANT EXECUTE ON FUNCTION public\.submit_guest_customer_order[\s\S]*?TO anon/
  );
});
