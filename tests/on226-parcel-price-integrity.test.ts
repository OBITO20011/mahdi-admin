import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const migration = read('supabase/migrations/226_parcel_price_integrity.sql');

test('parcel validation uses final ON product values after all price updates', () => {
  assert.match(migration, /AFTER UPDATE OF units_per_sale_unit ON public\.products\s+DEFERRABLE INITIALLY DEFERRED/);
  assert.match(migration, /WHEN \(OLD\.units_per_sale_unit IS DISTINCT FROM NEW\.units_per_sale_unit\)/);
  assert.match(migration, /IF sales_lite1\.enabled\(\) THEN\s+RETURN NULL;/);
  assert.match(migration, /FROM public\.products WHERE id = NEW\.id/);
  assert.match(migration, /state\.product_id = COALESCE\(product\.flavor_master_product_id, product\.id\)/);
  assert.match(migration, /public\.price225_assert_prices_internal\([\s\S]*product\.units_per_sale_unit,\s+product\.sale_price_in_minor_units,\s+product\.default_sale_price_in_minor_units,\s+COALESCE\(parcel_enabled, true\),\s+product\.parcel_only/);
});

test('the import finalizer requires ON, an owner, open setup and an exact revision', () => {
  assert.match(migration, /assert_erp_role\(ARRAY\['owner'\]/);
  assert.match(migration, /go_live_assert_setup_open_internal\(\)/);
  assert.match(migration, /sales_lite1\.lock_mode\(\);\s+IF sales_lite1\.enabled\(\) THEN/);
  assert.match(migration, /product_edit_assert_version_internal\(p_flavor_product_id, p_expected_updated_at\)/);
  assert.match(migration, /prior\.flavor_master_product_id IS NULL OR prior\.is_flavor_master/);
  const update = /UPDATE public\.products\s+SET ([^;]+?)\s+WHERE id = prior\.id/.exec(migration);
  assert.ok(update);
  assert.deepEqual(Array.from(update[1].matchAll(/\b(\w+)\s*=/g), match => match[1]), ['sku', 'barcode', 'updated_at']);
  assert.match(migration, /to_jsonb\(saved\) - ARRAY\['sku', 'barcode', 'updated_at'\][\s\S]*IS DISTINCT FROM \(to_jsonb\(prior\) - ARRAY\['sku', 'barcode', 'updated_at'\]\)/);
});

test('226 changes only the direct execution grants of legacy writers', () => {
  for (const version of [4, 5]) {
    const legacy = 'public\\.update_product_master_v' + version;
    assert.match(migration, new RegExp('REVOKE EXECUTE ON FUNCTION ' + legacy + '\\([^)]*\\) FROM PUBLIC, anon, authenticated;'));
    assert.doesNotMatch(migration, new RegExp('(?:CREATE|ALTER|DROP|GRANT)[^;]*FUNCTION ' + legacy));
  }
});

test('current product writes and flavor import are routed to their approved writers', () => {
  const workbook = read('src/services/supabase/productWorkbook.service.ts');
  const products = read('src/services/supabase/products.service.ts');
  for (const source of [workbook, products]) {
    assert.doesNotMatch(source, /update_product_master_v[45]\b/);
    assert.match(source, /update_product_master_v7/);
    assert.match(source, /update_product_master_v6/);
  }
  assert.match(workbook, /rpc\('finalize_import_flavor_identity226'/);
  assert.match(workbook, /else await finalizeOnFlavorIdentity\(c\.metadata!,f\.sku,f\.barcode\|\|null\)/);
});
