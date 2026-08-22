import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/029_guest_promotions_and_gps.sql',
    import.meta.url
  ),
  'utf8'
);

const adminService = readFileSync(
  new URL(
    '../src/services/supabase/promotions.service.ts',
    import.meta.url
  ),
  'utf8'
);

const publicOffersMigration = readFileSync(
  new URL(
    '../supabase/migrations/048_public_storefront_promotion_offers.sql',
    import.meta.url
  ),
  'utf8'
);

const activeOffersMigration = readFileSync(
  new URL(
    '../supabase/migrations/049_active_promotions_are_storefront_offers.sql',
    import.meta.url
  ),
  'utf8'
);

test('promotion discount is calculated and locked by PostgreSQL', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.promotion_codes/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.promotion_redemptions/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\._calculate_guest_promotion/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /maximum_redemptions_per_phone/);
  assert.match(migration, /v_discount := FLOOR/);
  assert.match(migration, /v_result := public\.create_customer_order/);
});

test('guest cannot send a discount amount and admin writes use RPCs', () => {
  const guestSignature = migration.match(
    /CREATE OR REPLACE FUNCTION public\.submit_guest_customer_order\([\s\S]*?\)\nRETURNS JSONB/
  )?.[0];
  assert.ok(guestSignature);
  assert.doesNotMatch(guestSignature, /p_discount/);
  assert.match(guestSignature, /p_promotion_code TEXT/);
  assert.match(adminService, /rpc\('get_promotion_codes'/);
  assert.match(adminService, /rpc\('upsert_promotion_code'/);
  assert.match(adminService, /rpc\(\s*'set_promotion_code_active'/);
  assert.doesNotMatch(adminService, /\.from\(['"]promotion_codes/);
});

test('promotion administration is role checked and audited', () => {
  assert.match(migration, /PERFORM public\.assert_erp_role/);
  assert.match(
    migration,
    /ARRAY\['owner', 'admin', 'manager', 'sales'\]/
  );
  assert.match(migration, /CREATE_PROMOTION_CODE/);
  assert.match(migration, /UPDATE_PROMOTION_CODE/);
  assert.match(migration, /SET_PROMOTION_CODE_ACTIVE/);
  assert.match(migration, /ALTER TABLE public\.promotion_codes ENABLE ROW LEVEL SECURITY/);
});

test('publication migration exposes a safe public RPC without redemption details', () => {
  assert.match(publicOffersMigration, /is_public_offer BOOLEAN NOT NULL DEFAULT true/);
  assert.match(
    publicOffersMigration,
    /CREATE OR REPLACE FUNCTION public\.get_public_storefront_offers/
  );
  assert.match(publicOffersMigration, /pc\.is_public_offer = true/);
  assert.match(publicOffersMigration, /pc\.is_active = true/);
  assert.match(publicOffersMigration, /pc\.starts_at IS NULL OR pc\.starts_at <= NOW\(\)/);
  assert.match(publicOffersMigration, /pc\.expires_at IS NULL OR pc\.expires_at > NOW\(\)/);
  assert.match(
    publicOffersMigration,
    /GRANT EXECUTE ON FUNCTION public\.get_public_storefront_offers\(\)[\s\S]*TO anon, authenticated/
  );
  assert.doesNotMatch(
    publicOffersMigration.match(
      /CREATE OR REPLACE FUNCTION public\.get_public_storefront_offers\(\)[\s\S]*?\$\$;/
    )?.[0] || '',
    /customer_phone|redeemed_discount_in_minor_units/
  );
});

test('admin saves publication intent through the promotion RPC', () => {
  assert.match(adminService, /p_is_public_offer: input\.isPublicOffer/);
  assert.doesNotMatch(adminService, /\.from\(['"]promotion_codes/);
});

test('final storefront contract publishes only selected active current or scheduled promotions', () => {
  const publicFunction = activeOffersMigration.match(
    /CREATE OR REPLACE FUNCTION public\.get_public_storefront_offers\(\)[\s\S]*?\$\$;/
  )?.[0];
  assert.ok(publicFunction);
  assert.match(publicFunction, /pc\.is_active = true/);
  assert.match(publicFunction, /pc\.is_public_offer = true/);
  assert.doesNotMatch(
    publicFunction,
    /AND \(pc\.starts_at IS NULL OR pc\.starts_at <= NOW\(\)\)/
  );
  assert.match(publicFunction, /pc\.expires_at IS NULL OR pc\.expires_at > NOW\(\)/);
  assert.doesNotMatch(activeOffersMigration, /UPDATE public\.promotion_codes/);
  assert.match(adminService, /p_is_public_offer: input\.isPublicOffer/);
});
