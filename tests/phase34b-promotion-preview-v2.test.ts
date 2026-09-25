import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/118_customer_guest_promotion_preview_v2.sql',
    import.meta.url,
  ),
  'utf8',
);
const runtimeHarness = readFileSync(
  new URL(
    '../scripts/testing/run-phase3-configurable-parcel-contracts-runtime.mjs',
    import.meta.url,
  ),
  'utf8',
);
const canonicalSuite = readFileSync(
  new URL('./database-runtime-suite.ts', import.meta.url),
  'utf8',
);

test('Migration 118 adds one bounded Customer V2 promotion preview contract', () => {
  assert.match(migration, /^BEGIN;/u);
  assert.match(migration, /COMMIT;\s*$/u);
  assert.match(
    migration,
    /CREATE FUNCTION public\.preview_guest_promotion_v2\(\s*p_lines JSONB,\s*p_promotion_code TEXT DEFAULT NULL,\s*p_customer_phone TEXT DEFAULT NULL/u,
  );
  assert.doesNotMatch(migration, /\b(?:DROP|ALTER TABLE|CREATE TABLE|DELETE|INSERT INTO)\b/iu);
  assert.doesNotMatch(migration, /\bUPDATE\s+public\./iu);
  assert.doesNotMatch(migration, /EXECUTE format|EXECUTE \(/iu);
  assert.doesNotMatch(migration, /CREATE FUNCTION public\.preview_guest_promotion\(/u);
});

test('preview preserves Phase-3 line semantics and authoritative server prices', () => {
  assert.match(migration, /phase3_canonicalize_sale_request_internal/u);
  assert.match(migration, /v_line_kind = 'base_unit'[\s\S]*sale_price_in_minor_units/u);
  assert.match(
    migration,
    /v_line_kind = 'legacy_single_sku_parcel'[\s\S]*default_sale_price_in_minor_units/u,
  );
  assert.match(
    migration,
    /ELSE[\s\S]*v_product\.default_sale_price_in_minor_units/u,
  );
  assert.match(migration, /PARCEL_CAPACITY_MISMATCH/u);
  assert.match(migration, /PARCEL_COMPONENT_FAMILY_MISMATCH/u);
  assert.match(migration, /PHASE3_CUSTOMER_QUOTE_STALE/u);
  assert.doesNotMatch(migration, /SUM\([^)]*(?:sale_price|default_sale_price)/iu);
});

test('preview is advisory and contains no business write or locking path', () => {
  assert.doesNotMatch(
    migration,
    /\b(?:INSERT INTO|UPDATE\s+public\.|DELETE FROM|pg_advisory_xact_lock)\b/iu,
  );
  assert.doesNotMatch(migration, /SELECT[\s\S]{0,500}\bFOR (?:UPDATE|SHARE)\b/iu);
  assert.doesNotMatch(migration, /phase3_lock_inventory_products_internal/u);
  assert.doesNotMatch(migration, /phase3_validate_configurable_parcel_internal/u);
  assert.match(migration, /Final V2 checkout owns authoritative locking/u);
});

test('public security boundary is narrow and exposes no financial internals', () => {
  assert.match(migration, /SECURITY DEFINER/u);
  assert.match(migration, /SET search_path = public, pg_temp/u);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.preview_guest_promotion_v2\(JSONB, TEXT, TEXT\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role/u,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.preview_guest_promotion_v2\(JSONB, TEXT, TEXT\)[\s\S]*TO anon, authenticated/u,
  );
  const response = migration.match(
    /RETURN JSONB_BUILD_OBJECT\([\s\S]*?'promotion',[\s\S]*?\n {2}\);/u,
  )?.[0] ?? '';
  assert.ok(response, 'Public preview response projection was not found.');
  assert.doesNotMatch(
    response,
    /wac|cost|supplier|invoice|margin|cogs|actor|reservation|warehouse|promotion\.id/iu,
  );
});

test('permanent parity coverage remains wired through the canonical DB runtime suite', () => {
  assert.match(runtimeHarness, /runPromotionPreviewV2Tests/u);
  assert.match(runtimeHarness, /promotionPreviewV2/u);
  assert.match(runtimeHarness, /001-119/u);
  assert.match(canonicalSuite, /promotionPreviewV2/u);
  // Wiring guards only: behavioral proof lives in the real isolated DB suite.
  // Keep each M1 dimension independently required by the canonical caller.
  for (const label of [
    'capped-percentage', 'fixed-subtotal-bound', 'threshold-below',
    'threshold-exact', 'threshold-above', 'multiple-no-promo', 'multiple-promo',
  ]) {
    assert.ok(runtimeHarness.includes(label), `Runtime missing ${label}`);
    assert.ok(canonicalSuite.includes(label), `Canonical missing ${label}`);
  }
  for (const field of [
    'preExistingCustomerAddressProtected', 'allThreeSkusIncludingOther',
    'populatedRepeatedPreviewZeroWrites', 'rejectedPreviewZeroWrites',
    'exactCheckoutPositiveControls', 'realSqlFieldSensitivity',
    'newRowsDiscovered', 'cleanupVerified',
  ]) {
    assert.ok(runtimeHarness.includes(field), `Runtime missing ${field}`);
    assert.ok(canonicalSuite.includes(field), `Canonical missing ${field}`);
  }
});
