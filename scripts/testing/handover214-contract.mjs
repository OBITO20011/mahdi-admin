import assert from 'node:assert/strict';
import {catalogDifference} from './schema-catalog.mjs';
import {assertReady213Catalog} from './handover213-contract.mjs';

export const changed214Functions = Object.freeze([
  'parcel209_pos_sale_internal',
  'package_d_settle_sales_return_before_guard_internal',
  'phase42_expected_return_effects_pre43_internal',
  'validate_customer_address_map_url',
  'get_cash_shift_display_summary',
  'reverse_customer_collection_v1',
]);
export function assertReady214Catalog(catalog) {
  assertReady213Catalog(catalog);
  const definition = name => {
    const matches = catalog.functions.filter(f => f.schema === 'public' && f.identity.startsWith(name + '('));
    assert.equal(matches.length, 1, name);
    assert.equal(matches[0].owner, 'postgres', name);
    assert.deepEqual(matches[0].configuration, ['search_path=public, pg_temp'], name);
    return matches[0].definition;
  };
  const sale = definition(changed214Functions[0]);
  assert.match(sale, /v_unit_cost_exact NUMERIC\(24,6\)/);
  assert.match(sale, /unit_cost_snapshot_in_minor_units_exact/);
  assert.match(sale, /exact_cogs_snapshot_in_minor_units/);
  for (const name of changed214Functions.slice(1, 3)) assert.match(definition(name), /COALESCE\([^;]*unit_cost_snapshot_in_minor_units_exact/s);
  const maps = definition('validate_customer_address_map_url');
  assert.ok(maps.includes('maps\\.app\\.goo\\.gl|maps\\.google\\.com'));
  assert.ok(maps.includes('(?:www\\.)?google\\.com/maps'));
  const shift = definition('get_cash_shift_display_summary');
  const guard = shift.indexOf('PERFORM public.assert_erp_role(');
  assert.ok(guard >= 0 && guard < shift.indexOf('SELECT * INTO v_shift'), 'PRE_READ_SHIFT_GUARD');
  const reversal = definition('reverse_customer_collection_v1');
  const customer = reversal.indexOf("'go-live-collection-customer:'");
  const order = reversal.indexOf("'phase4-order|'");
  const rows = reversal.indexOf('FROM public.cash_shifts WHERE id=v_id FOR UPDATE');
  assert.ok(customer >= 0 && customer < order && order < rows, 'CANONICAL_REVERSAL_LOCK_HIERARCHY');
  assert.match(reversal, /v_locked_plan IS DISTINCT FROM v_plan/);
}
export function assert214Transition(before, after) {
  assertReady214Catalog(after);
  const differences = catalogDifference(before, after), seen = new Set();
  for (const difference of differences) {
    assert.equal(difference.section, 'functions', '214_ONLY_FUNCTION_DEFINITIONS');
    assert.ok(difference.before && difference.after, '214_NO_NEW_OR_DROPPED_FUNCTIONS');
    const name = difference.after.identity.split('(')[0];
    assert.ok(changed214Functions.includes(name), '214_UNAPPROVED_FUNCTION_' + name);
    assert.equal(difference.after.schema, 'public');
    assert.deepEqual({...difference.before, definition: null}, {...difference.after, definition: null},
      '214_OWNER_ACL_CONFIG_OR_OTHER_METADATA_CHANGED_' + name);
    seen.add(name);
  }
  assert.deepEqual([...seen].sort(), [...changed214Functions].sort());
  return differences;
}
