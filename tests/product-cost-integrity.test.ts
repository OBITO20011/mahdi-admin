import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { futureMigrationViolations } from '../scripts/testing/maintenance-db-contract.mjs';

const migration = readFileSync('supabase/migrations/171_product_cost_preserved_on_edit.sql', 'utf8').replaceAll('\r\n','\n');
const body = (name: string) => {
  const start = migration.search(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`, 'u'));
  assert.ok(start >= 0, `${name} is defined explicitly`);
  return migration.slice(start, migration.indexOf('\n$$;', start));
};

test('migration 171 is explicit, definer-safe and passes the future-migration guard', () => {
  assert.deepEqual(futureMigrationViolations(migration), []);
  for (const name of ['product_has_cost_history_internal', 'update_product_master_v4', 'get_product_cost_state_v1',
    'product_cost_corrections_reject_mutation', 'correct_product_cost_v1'])
    assert.match(body(name), /SECURITY DEFINER\nSET search_path = public, pg_temp/u, name);
  for (const name of ['product_has_cost_history_internal(UUID)', 'product_cost_corrections_reject_mutation()'])
    assert.ok(migration.includes(`REVOKE ALL ON FUNCTION public.${name} FROM authenticated;`), `${name} is internal`);
  assert.doesNotMatch(migration, /CREATE (?:OR REPLACE )?FUNCTION public\.(?:update_product_master(?:_v2|_v3)?|phase2_|create_pos_sale|populate_order_item_cost_snapshot)\b/u,
    'no pricing, receiving or sale body is redefined');
});

test('saving a product with stock history passes its current cost through and verifies both columns', () => {
  const v4 = body('update_product_master_v4');
  assert.match(v4, /product_edit_assert_version_internal\(p_product_id, p_expected_updated_at\)/u, 'still versioned and row-locked');
  assert.match(v4, /CASE WHEN v_has_history THEN v_cost ELSE p_cost_price_in_minor_units END/u);
  assert.match(v4, /v_after_cost IS DISTINCT FROM v_cost OR v_after_exact IS DISTINCT FROM v_exact/u);
  assert.doesNotMatch(v4, /UPDATE public\.products/u, 'v4 itself writes nothing');
  const history = body('product_has_cost_history_internal');
  assert.match(history, /product\.flavor_master_product_id = p_product_id/u, 'a family counts its flavors');
  assert.match(history, /wac_cost_in_minor_units_exact IS NOT NULL/u);
  assert.match(history, /FROM public\.inventory_movements movement/u);
});

test('cost correction is owner-only, reasoned, idempotent, audited and consistent with receiving', () => {
  const correction = body('correct_product_cost_v1');
  assert.match(correction, /assert_erp_role\(ARRAY\['owner'\], 'تصحيح تكلفة المنتج'\)/u);
  assert.match(correction, /char_length\(v_reason\) NOT BETWEEN 5 AND 500/u);
  assert.match(correction, /v_exact := ROUND\(p_unit_cost_in_minor_units, 6\);\n {2}v_legacy := ROUND\(v_exact\)::BIGINT;/u,
    'cost_price = ROUND(exact), the same rule receiving uses');
  assert.match(correction, /PRODUCT_COST_CORRECTION_KEY_CONFLICT/u);
  assert.match(correction, /'CORRECT_PRODUCT_COST'/u);
  assert.doesNotMatch(correction, /inventory_balances|inventory_movements|order_items/u, 'quantities and past sales untouched');
  assert.match(migration, /ALTER TABLE public\.product_cost_corrections ENABLE ROW LEVEL SECURITY;/u);
  for (const role of ['PUBLIC', 'anon', 'authenticated'])
    assert.ok(migration.includes(`REVOKE ALL ON TABLE public.product_cost_corrections FROM ${role};`), `corrections table closed to ${role}`);
});

test('the UI reads cost state and corrects through literal RPCs only', () => {
  const service = readFileSync('src/services/supabase/productCost.service.ts', 'utf8');
  assert.match(service, /rpc\('get_product_cost_state_v1'/u);
  assert.match(service, /rpc\('correct_product_cost_v1'/u);
  assert.doesNotMatch(service, /\.from\(/u, 'no direct table access');
  const detail = readFileSync('src/features/products/ProductDetailModal.tsx', 'utf8');
  assert.match(detail, /roleName === 'owner' && \(isFlavorFamily/u, 'the correction button is owner-only');
});
