import assert from 'node:assert/strict';
import test, {type TestContext} from 'node:test';

Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {getItem: () => null, setItem: () => {}}});
process.env.VITE_SUPABASE_URL = 'http://127.0.0.1:4176';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_visibility_fixture';
const {supabase} = await import('../src/lib/supabase');
const {storeEngine} = await import('../src/stores/useAppStore');
const {mapAdminProductRecord} = await import('../src/services/supabase/products.service');
assert.ok(supabase);
const client = supabase;

const productId = 'bb260000-0000-4000-8000-000000000001';
const unitId = 'bb260000-0000-4000-8000-000000000002';
const parcelId = 'bb260000-0000-4000-8000-000000000003';
const familyId = 'bb260000-0000-4000-8000-000000000004';
const updatedAt = '2026-11-25T12:00:00.123456Z';
const unit = {id: unitId, name_ar: 'باكيت', code: 'PKT'};
const parcel = {id: parcelId, name_ar: 'صندوق', code: 'BOX'};

function fixture(t: TestContext, options: {full: boolean; flavor?: boolean; wrongPriceContext?: boolean}) {
  const row = {
    id: productId, name_ar: options.flavor ? 'عائلة - بندق' : 'صنف اختبار',
    sku: 'QA-226', barcode: '001226', is_active: true, updated_at: updatedAt,
    base_unit: unit, purchase_unit: parcel, sale_unit: parcel,
    units_per_purchase_unit: 12, units_per_sale_unit: 12,
    default_purchase_price_in_minor_units: 7008, cost_price_in_minor_units: 584,
    sale_price_in_minor_units: 1001, wholesale_price_in_minor_units: 1001,
    default_sale_price_in_minor_units: 11001,
    ...(options.flavor ? {flavor_master_product_id: familyId, flavor_name_ar: 'بندق'} : {}),
  };
  const calls: {name: string; args: Record<string, unknown>}[] = [];
  const state = storeEngine.getState();
  const originalProducts = state.products;
  state.products = [mapAdminProductRecord(row)];
  t.after(() => { state.products = originalProducts; });
  t.mock.method(storeEngine, 'refreshProductsFromSupabase', async () => {
    state.products = [mapAdminProductRecord(row)];
  });
  t.mock.method(storeEngine, 'refreshInventoryMovementsFromSupabase', async () => []);
  t.mock.method(storeEngine, 'refreshStockNotificationsFromSupabase', async () => []);
  t.mock.method(storeEngine, 'setToast', () => {});
  t.mock.method(client, 'from', (name: string) => {
    assert.equal(name, 'units');
    return {select: () => ({eq: (_key: string, label: string) => ({
      limit: async () => ({data: [label === unit.name_ar ? unit : parcel], error: null}),
    })})};
  });
  t.mock.method(client, 'rpc', async (name: string, args: Record<string, unknown>) => {
    calls.push({name, args});
    if (name === 'lite1_operating_mode') {
      return {data: {contractVersion: 'sales-only-phase2-v1', fullAccounting: options.full}, error: null};
    }
    if (name === 'get_product_pricing_context225') {
      return {data: {contractVersion: 'on-independent-prices225-v1', mode: 'full',
        productId: options.wrongPriceContext || options.flavor ? familyId : productId,
        requestedProductId: productId, updatedAt, parcelEnabled: false,
        originalUnitPrice: null, originalParcelPrice: null, currentWacInMinorUnitsExact: '584'}, error: null};
    }
    assert.ok(['update_product_master_v6', 'update_product_master_v7', 'update_product_flavor_v2'].includes(name), name);
    row.is_active = args.p_is_active === true;
    return {data: {success: true, productId, updatedAt}, error: null};
  });
  return calls;
}

test('OFF hides and shows with v6 and both saved prices in exact fils', async t => {
  const calls = fixture(t, {full: false});
  for (const active of [false, true]) {
    assert.equal((await storeEngine.hideProduct(productId)).success, true);
    const write = calls.at(-1);
    assert.equal(write?.name, 'update_product_master_v6');
    assert.equal(write?.args.p_is_active, active);
    assert.equal(write?.args.p_expected_updated_at, updatedAt);
    assert.equal(write?.args.p_sale_price_in_minor_units, 1001);
    assert.equal(write?.args.p_default_sale_price_in_minor_units, 11001);
  }
  assert.ok(calls.every(call => call.name !== 'get_product_pricing_context225'));
});

test('ON preserves both prices and the saved parcel pause with v7', async t => {
  const calls = fixture(t, {full: true});
  assert.equal((await storeEngine.hideProduct(productId)).success, true);
  const write = calls.at(-1);
  assert.equal(write?.name, 'update_product_master_v7');
  assert.equal(write?.args.p_is_active, false);
  assert.equal(write?.args.p_parcel_enabled, false);
  assert.equal(write?.args.p_sale_price_in_minor_units, 1001);
  assert.equal(write?.args.p_default_sale_price_in_minor_units, 11001);
});

test('ON changes flavor visibility through v2 without sending price or family updates', async t => {
  const calls = fixture(t, {full: true, flavor: true});
  for (const active of [false, true]) {
    assert.equal((await storeEngine.hideProduct(productId)).success, true);
    assert.deepEqual(calls.at(-1), {name: 'update_product_flavor_v2', args: {
      p_flavor_product_id: productId, p_expected_updated_at: updatedAt,
      p_flavor_name_ar: 'بندق', p_barcode: '001226', p_image_url: null, p_is_active: active,
    }});
  }
  assert.ok(calls.every(call => !call.name.startsWith('update_product_master')));
});

test('a mismatched ON price context cannot write a different product', async t => {
  const calls = fixture(t, {full: true, wrongPriceContext: true});
  assert.equal((await storeEngine.hideProduct(productId)).success, false);
  assert.deepEqual(calls.map(call => call.name), ['lite1_operating_mode', 'get_product_pricing_context225']);
});
