import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CartItem, ConfigurableParcelCartItem } from '../src/types/catalog';
import { requiredBaseUnitsByProductId } from '../src/utils/cart';
import { buildGuestOrderV2Lines } from '../src/utils/checkout';
import { readCartEnvelope } from '../src/services/commerceStorage';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const base: CartItem = {
  schemaVersion: 2,
  localLineId: 'line-base',
  localRevision: 1,
  commercialLineKind: 'base_unit',
  productId: '11111111-1111-4111-8111-111111111111',
  sku: 'HOT',
  nameAr: 'ليز حار',
  imageUrl: '',
  saleUnitNameAr: 'باكيت',
  unitsPerSalePackage: 1,
  unitPriceInMinorUnits: 250,
  quantity: 2,
  maxAvailablePackages: 20,
};

const legacy: CartItem = {
  ...base,
  localLineId: 'line-legacy',
  commercialLineKind: 'legacy_single_sku_parcel',
  saleUnitNameAr: 'طرد',
  unitsPerSalePackage: 5,
  unitPriceInMinorUnits: 1000,
  quantity: 1,
};

const configurable: ConfigurableParcelCartItem = {
  ...legacy,
  localLineId: 'line-config',
  commercialLineKind: 'configurable_parcel',
  productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  familyProductId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  parcelConfigurationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  configurationRevision: 3,
  compositionMode: 'configurable_mix',
  capacity: 5,
  quantity: 2,
  parcelInstances: [
    {
      localInstanceId: 'parcel-a',
      localRevision: 1,
      components: [{
        productId: base.productId,
        sku: 'HOT',
        nameAr: 'ليز',
        flavorNameAr: 'حار',
        unitNameAr: 'باكيت',
        imageUrl: '',
        baseQuantity: 5,
      }],
    },
    {
      localInstanceId: 'parcel-b',
      localRevision: 1,
      components: [{
        productId: '22222222-2222-4222-8222-222222222222',
        sku: 'CHEESE',
        nameAr: 'ليز',
        flavorNameAr: 'جبنة',
        unitNameAr: 'باكيت',
        imageUrl: '',
        baseQuantity: 5,
      }],
    },
  ],
};

test('legacy local carts migrate explicitly without becoming configurable parcels', () => {
  const storage = new MemoryStorage();
  storage.setItem('nawasrah-wholesale-cart-v1', JSON.stringify([{
    ...legacy,
    schemaVersion: undefined,
    localLineId: undefined,
    commercialLineKind: undefined,
  }]));
  const state = readCartEnvelope(storage as unknown as Storage);
  assert.equal(state.status, 'VALID');
  assert.equal(state.envelope?.items[0].commercialLineKind, 'legacy_single_sku_parcel');
  assert.notEqual(state.envelope?.items[0].localLineId, '');
});

test('V2 mapper preserves all three commercial line kinds and independent parcel instances', () => {
  assert.deepEqual(buildGuestOrderV2Lines([base, legacy, configurable]), [
    { commercial_line_kind: 'base_unit', product_id: base.productId, base_quantity: 2, expected_unit_price_in_minor_units: 250 },
    { commercial_line_kind: 'legacy_single_sku_parcel', product_id: legacy.productId, parcel_quantity: 1, units_per_parcel: 5, expected_unit_price_in_minor_units: 1000 },
    {
      commercial_line_kind: 'configurable_parcel',
      family_product_id: configurable.familyProductId,
      parcel_configuration_id: configurable.parcelConfigurationId,
      configuration_revision: 3,
      expected_unit_price_in_minor_units: 1000,
      parcel_instances: [
        { components: [{ product_id: base.productId, base_quantity: 5 }] },
        { components: [{ product_id: '22222222-2222-4222-8222-222222222222', base_quantity: 5 }] },
      ],
    },
  ]);
});

test('whole-cart inventory demand aggregates base, legacy and configurable components', () => {
  const required = requiredBaseUnitsByProductId([base, legacy, configurable]);
  assert.equal(required.get(base.productId), 12);
  assert.equal(required.get('22222222-2222-4222-8222-222222222222'), 5);
});

test('customer UI is wired to centralized commerce storage and V2 gateway', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const checkout = readFileSync(new URL('../src/components/CheckoutModal.tsx', import.meta.url), 'utf8');
  const builder = readFileSync(new URL('../src/components/ParcelBuilderModal.tsx', import.meta.url), 'utf8');
  assert.match(app, /useCustomerCommerce/);
  assert.match(app, /fetchPublicConfigurableParcelOptions/);
  assert.match(app, /<ParcelBuilderModal/);
  assert.match(checkout, /phase3-customer-reservation-v2/);
  assert.match(checkout, /previewGuestPromotionV2/);
  assert.match(checkout, /coordinator\.submit/);
  assert.doesNotMatch(checkout, /localStorage\.setItem/);
  assert.doesNotMatch(app, /localStorage\.setItem\(CART_STORAGE_KEY/);
  assert.doesNotMatch(app, /const handleOrderCreated[\s\S]{0,300}setCartItems\(\[\]\)/);
  assert.match(builder, /تم اختيار/);
});
