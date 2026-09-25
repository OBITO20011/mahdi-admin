import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/117_customer_public_configurable_parcel_read_contract.sql',
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

test('Migration 117 is additive, bounded and exposes one narrow public read function', () => {
  assert.match(migration, /^BEGIN;/u);
  assert.match(migration, /COMMIT;\s*$/u);
  assert.match(
    migration,
    /CREATE FUNCTION public\.get_public_configurable_parcel_options\(\s*p_family_product_ids UUID\[\]/u,
  );
  assert.match(migration, /v_requested_count > 48/u);
  assert.doesNotMatch(migration, /\b(?:DROP|ALTER TABLE|UPDATE|DELETE|INSERT INTO)\b/iu);
  assert.doesNotMatch(migration, /EXECUTE format|EXECUTE \(/iu);
});

test('public Parcel options use the Customer V2 location and authoritative configuration facts', () => {
  assert.match(
    migration,
    /FROM public\.warehouses warehouse[\s\S]*JOIN public\.branches branch[\s\S]*ORDER BY warehouse\.created_at, warehouse\.id[\s\S]*LIMIT 1/u,
  );
  assert.match(migration, /configuration\.configuration_revision/u);
  assert.match(migration, /configuration\.composition_mode = 'configurable_mix'/u);
  assert.match(migration, /family\.units_per_sale_unit AS units_per_parcel/u);
  assert.match(
    migration,
    /family\.default_sale_price_in_minor_units AS parcel_price_in_minor_units/u,
  );
  assert.match(
    migration,
    /component\.flavor_master_product_id = configuration\.family_product_id/u,
  );
  assert.match(migration, /component\.wac_cost_in_minor_units_exact IS NOT NULL/u);
  assert.match(
    migration,
    /balance\.warehouse_id = warehouse\.id[\s\S]*balance\.product_id = component\.id/u,
  );
});

test('feature state is fail-closed for Customer guests outside ENABLED', () => {
  assert.match(migration, /v_feature_state IS DISTINCT FROM 'ENABLED'/u);
  assert.match(
    migration,
    /'guestCreationEnabled', false,[\s\S]*'options', '\[\]'::JSONB/u,
  );
  assert.doesNotMatch(migration, /has_erp_role|OWNER_PILOT'[\s\S]*RETURN v_options/iu);
});

test('the projection keeps protected tables private and leaks no financial internals', () => {
  assert.match(migration, /SECURITY DEFINER/u);
  assert.match(migration, /SET search_path = public, pg_temp/u);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.get_public_configurable_parcel_options\(UUID\[\]\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role/u,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.get_public_configurable_parcel_options\(UUID\[\]\)[\s\S]*TO anon, authenticated/u,
  );
  assert.doesNotMatch(
    migration,
    /GRANT\s+SELECT[\s\S]*product_parcel_configurations/iu,
  );

  const publicProjection = migration.match(
    /JSONB_BUILD_OBJECT\(\s*'familyProductId'[\s\S]*?'components', option_group\.components\s*\)/u,
  )?.[0] || '';
  assert.ok(publicProjection, 'Public option projection was not found.');
  assert.doesNotMatch(
    publicProjection,
    /wac|cost|supplier|invoice|margin|cogs|operation|reservation|actor/iu,
  );
});

test('Migration 117 contract checks remain wired through the existing Phase 3 runtime suite', () => {
  assert.match(runtimeHarness, /runPublicConfigurableParcelReadContractTests/u);
  assert.match(runtimeHarness, /publicReadContract/u);
  assert.match(runtimeHarness, /001-119/u);
  assert.match(canonicalSuite, /publicReadContract/u);
  assert.doesNotMatch(canonicalSuite, /run-phase3-customer-public-parcel-read/iu);
});
