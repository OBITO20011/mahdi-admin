import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migration118Url = new URL(
  '../supabase/migrations/118_customer_guest_promotion_preview_v2.sql',
  import.meta.url,
);
const migration119Url = new URL(
  '../supabase/migrations/119_exact_wac_and_commercial_quantity_reporting.sql',
  import.meta.url,
);
const migration = readFileSync(migration119Url, 'utf8');
const runtimeHarness = readFileSync(
  new URL('../scripts/testing/run-phase3-configurable-parcel-contracts-runtime.mjs', import.meta.url),
  'utf8',
);
const canonicalSuite = readFileSync(
  new URL('./database-runtime-suite.ts', import.meta.url),
  'utf8',
);
const migrationNames = readdirSync(
  new URL('../supabase/migrations/', import.meta.url),
);

test('Migration 119 is a focused transactional read-side correction', () => {
  assert.match(migration, /^--[\s\S]*?\nBEGIN;/u);
  assert.match(migration, /COMMIT;\s*$/u);
  assert.doesNotMatch(
    migration,
    /\b(?:INSERT INTO|UPDATE\s+public\.|DELETE FROM|ALTER TABLE|CREATE TABLE|DROP TABLE)\b/iu,
  );
  assert.doesNotMatch(migration, /create_pos_sale|submit_guest_customer_order|receive_/iu);
});

test('exact WAC valuation rounds the aggregate once and keeps NULL-only fallback', () => {
  assert.match(migration, /wac_cost_in_minor_units_exact/u);
  assert.match(
    migration,
    /ROUND\(COALESCE\(SUM\([\s\S]*?COALESCE\([\s\S]*?wac_cost_in_minor_units_exact,[\s\S]*?cost_price_in_minor_units::NUMERIC[\s\S]*?\), 0\), 0\)::BIGINT/u,
  );
  assert.match(migration, /family\.inventory_value_in_minor_units_exact/u);
  assert.match(migration, /child\.wac_cost_in_minor_units_exact/u);
  assert.doesNotMatch(
    migration,
    /product\.is_flavor_master[\s\S]{0,240}product\.cost_price_in_minor_units\s*\*[\s\S]{0,80}effective_on_hand_quantity/iu,
  );
});

test('commercial quantity helpers preserve explicit and historical semantics', () => {
  assert.match(
    migration,
    /p_commercial_line_kind = 'base_unit' THEN 0::BIGINT/u,
  );
  assert.match(
    migration,
    /p_commercial_line_kind = 'configurable_parcel'[\s\S]*?order_parcel_instances/u,
  );
  assert.match(
    migration,
    /SUM\(component\.base_quantity\)::BIGINT[\s\S]*?order_parcel_components/u,
  );
  assert.match(
    migration,
    /p_commercial_line_kind IS NULL[\s\S]*?p_sale_package_quantity IS NOT NULL[\s\S]*?p_units_per_sale_package IS NOT NULL[\s\S]*?p_units_per_sale_package > 0/u,
  );
  assert.doesNotMatch(migration, /p_units_per_sale_package[^\n]*> 1/u);
  assert.match(migration, /_get_cash_shift_closing_report_v1/u);
  assert.match(migration, /get_operational_business_report/u);
});

test('internal projections stay private and public financial contracts stay unchanged', () => {
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.phase35_report_base_unit_count_internal[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/u,
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.phase35_report_package_count_internal[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/u,
  );
  assert.doesNotMatch(migration, /GRANT EXECUTE/u);
  assert.doesNotMatch(migration, /cogs_in_minor_units\s*=|profit_in_minor_units\s*=/iu);
});

test('Migration 118 remains byte-identical and the Phase 3 sequence ends at Migration 119', () => {
  const migration118 = readFileSync(migration118Url);
  assert.equal(
    createHash('sha256').update(migration118).digest('hex').toUpperCase(),
    '3D0DDF0A2A0D8A184BC62BB0A001D8564399CDA54D8B6F8CCEF0ADBD2FD881B5',
  );
  assert.equal(
    migrationNames.filter((name) => {
      const sequence = Number.parseInt(name.slice(0, 3), 10);
      return sequence >= 1 && sequence <= 119;
    }).length,
    119,
  );
});

test('behavioral proof is permanently wired into the existing canonical suite', () => {
  assert.match(runtimeHarness, /runPhase35bReportingTests/u);
  assert.match(runtimeHarness, /exactWacRoundingBoundary/u);
  assert.match(runtimeHarness, /explicitBaseUnitNeverCountsAsPackage/u);
  assert.match(runtimeHarness, /legacySingleUnitPackagePreserved/u);
  assert.match(runtimeHarness, /reportReadsZeroWrite/u);
  assert.match(runtimeHarness, /topProductsCommercialQuantityNoFanOut/u);
  assert.match(runtimeHarness, /migrationRebuild: '001-119'/u);
  assert.match(canonicalSuite, /phase35bReporting/u);
  assert.match(canonicalSuite, /baseUnits: 24/u);
  assert.match(canonicalSuite, /packages: 6/u);
});
