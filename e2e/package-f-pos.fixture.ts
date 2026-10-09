export const posFixtureIds = {
  actor: '11111111-1111-4111-8111-111111111111',
  warehouse: '22222222-2222-4222-8222-222222222222',
  branch: '33333333-3333-4333-8333-333333333333',
  configuration: '99999999-9999-4999-8999-999999999999',
};
const items = [
  ['عصير برتقال 250مل', 900, 21600, 24, 412],
  ['مياه 600مل', 250, 5000, 20, 960],
  ['شيبس عينة 30غ', 350, 9000, 30, 48],
  ['شيبس شطة 30غ', 350, 9000, 30, 210],
  ['شوكولاتة حليب', 500, 11500, 24, 300],
  ['عصير مانجا 1لتر', 1250, 14500, 12, 96],
  ['بسكويت بالتمر', 300, 7000, 24, 36],
  ['مشروب غازي 330مل', 450, 10200, 24, 540],
  ['سائل جلي 1لتر', 1100, 12600, 12, 120],
  ['مياه 1.5لتر', 400, 2300, 6, 600],
  ['ويفر شوكولاتة', 250, 6000, 24, 720],
  ['عصير تفاح 250مل', 900, 21600, 24, 264],
] as const;
export const posFixtureProducts = items.map(([name, packet, carton, units, available], index) => ({
  id: `44444444-4444-4444-8444-${String(index + 1).padStart(12, '0')}`, sku: `POS-${index + 1}`,
  barcode: `625100000${String(index + 1).padStart(4, '0')}`, name_ar: name, is_active: true,
  category_id: index < 2 ? 'drinks' : 'food', warehouse_id: posFixtureIds.warehouse,
  available_quantity: available, on_hand_quantity: available, reserved_quantity: 0,
  units_per_sale_unit: units, sale_price_in_minor_units: packet,
  default_sale_price_in_minor_units: carton, min_stock_level: 60,
  cost_price_in_minor_units: 100, sale_unit: { code: 'CARTON', name_ar: 'كرتونة' },
  base_unit: { code: 'PACK', name_ar: 'باكيت' }, image_url: '',
}));
export const posFixtureParcel = {
  familyProductId: posFixtureProducts[2].id, nameAr: 'طرد شيبس مشكّل',
  parcelConfigurationId: posFixtureIds.configuration, configurationRevision: 3,
  unitsPerParcel: 30, parcelPriceInMinorUnits: 9000,
  components: posFixtureProducts.slice(2, 4).map((product, index) => ({
    productId: product.id, nameAr: product.name_ar, flavorNameAr: index === 0 ? 'عينة' : 'شطة',
    sku: product.sku, availableQuantity: product.available_quantity,
  })),
};
