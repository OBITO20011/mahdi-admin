import type {CreatePosSaleV2Input, PosV2SaleResult} from './posV2.service';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const money = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(v);
const composition = (components: unknown, snapshot = false): string | null => {
  if (!Array.isArray(components) || !components.length) return null;
  const ids = new Set<string>();
  const tuples: Array<[string, number]> = [];
  for (const c of components) {
    if (!object(c) || !uuid(c.product_id) || !positive(c.base_quantity) || ids.has(String(c.product_id))) return null;
    if (snapshot && !uuid(c.component_id)) return null;
    ids.add(String(c.product_id)); tuples.push([String(c.product_id).toLowerCase(), c.base_quantity]);
  }
  return JSON.stringify(tuples.sort(([a], [b]) => a.localeCompare(b)));
};

// Validate each commercial line/parcel identity, not aggregate quantities alone.
export function posV2RequestValid(value: unknown): value is CreatePosSaleV2Input {
  if (!object(value) || !uuid(value.warehouseId) || !uuid(value.branchId)
    || (value.customerId !== undefined && !uuid(value.customerId))
    || !['cash', 'cliq', 'debt'].includes(String(value.paymentMethod))
    || (value.paymentMethod === 'debt' && !uuid(value.customerId))
    || !money(value.discountInMinorUnits) || !money(value.amountReceivedInMinorUnits)
    || typeof value.idempotencyKey !== 'string' || !value.idempotencyKey.trim()
    || !Array.isArray(value.lines) || !value.lines.length) return false;
  return value.lines.every(line => {
    if (!object(line) || (line.price_authority !== undefined && line.price_authority !== 'server_catalog')
      || (line.line_discount_in_minor_units !== undefined && line.line_discount_in_minor_units !== 0)) return false;
    if (line.commercial_line_kind === 'base_unit') return uuid(line.product_id) && positive(line.base_quantity);
    if (line.commercial_line_kind === 'legacy_single_sku_parcel') return uuid(line.product_id)
      && positive(line.parcel_quantity) && positive(line.units_per_parcel)
      && Number.isSafeInteger(line.parcel_quantity * line.units_per_parcel);
    return line.commercial_line_kind === 'configurable_parcel' && uuid(line.family_product_id)
      && uuid(line.parcel_configuration_id) && positive(line.configuration_revision)
      && Array.isArray(line.parcel_instances) && line.parcel_instances.length > 0
      && line.parcel_instances.every(p => object(p) && composition(p.components) !== null);
  });
}

export function posV2ResultMatches(input: CreatePosSaleV2Input, value: unknown): value is PosV2SaleResult {
  if (!posV2RequestValid(input) || !object(value) || value.success !== true || !uuid(value.operationId) || !uuid(value.orderId)
    || typeof value.orderNumber !== 'string' || !value.orderNumber
    || typeof value.customerName !== 'string' || !value.customerName
    || value.warehouseId !== input.warehouseId || value.branchId !== input.branchId
    || value.paymentMethod !== input.paymentMethod || typeof value.idempotentReplay !== 'boolean'
    || !Array.isArray(value.items) || value.items.length !== input.lines.length
    || !money(value.subtotalInMinorUnits) || !money(value.discountInMinorUnits)
    || !money(value.totalInMinorUnits) || !money(value.amountPaidInMinorUnits) || !money(value.changeDueInMinorUnits)
    || value.discountInMinorUnits !== input.discountInMinorUnits
    || value.totalInMinorUnits !== value.subtotalInMinorUnits - value.discountInMinorUnits
    || value.amountPaidInMinorUnits !== (input.paymentMethod === 'debt' ? 0 : value.totalInMinorUnits)
    || value.paymentStatus !== (input.paymentMethod === 'debt' ? 'unpaid' : 'paid')
    || value.changeDueInMinorUnits !== (input.paymentMethod === 'cash'
      ? Math.max(input.amountReceivedInMinorUnits - value.totalInMinorUnits, 0) : 0)) return false;
  let gross = 0, discount = 0, net = 0;
  const remaining = [...input.lines];
  const itemIds = new Set<string>(), instanceIds = new Set<string>(), componentIds = new Set<string>();
  for (const item of value.items) {
    if (!object(item) || !uuid(item.id) || itemIds.has(String(item.id)) || !uuid(item.productId)
      || typeof item.productName !== 'string' || typeof item.sku !== 'string'
      || typeof item.salePackage !== 'string' || !positive(item.quantity) || !positive(item.baseQuantity)
      || !positive(item.unitsPerSalePackage) || !money(item.unitPriceInMinorUnits)
      || !money(item.lineTotalInMinorUnits) || !money(item.allocatedDiscountInMinorUnits)
      || !money(item.netRefundableAmountInMinorUnits) || !money(item.cogsInMinorUnits)
      || !Number.isSafeInteger(item.profitInMinorUnits)
      || item.lineTotalInMinorUnits !== item.unitPriceInMinorUnits * item.quantity
      || item.netRefundableAmountInMinorUnits !== item.lineTotalInMinorUnits - item.allocatedDiscountInMinorUnits
      || item.profitInMinorUnits !== item.netRefundableAmountInMinorUnits - item.cogsInMinorUnits
      || item.baseQuantity !== item.quantity * item.unitsPerSalePackage) return false;
    const index = remaining.findIndex(line => {
      if (line.commercial_line_kind !== item.commercialLineKind) return false;
      if (line.commercial_line_kind === 'base_unit') return line.product_id === item.productId
        && line.base_quantity === item.quantity && item.unitsPerSalePackage === 1;
      if (line.commercial_line_kind === 'legacy_single_sku_parcel') return line.product_id === item.productId
        && line.parcel_quantity === item.quantity && line.units_per_parcel === item.unitsPerSalePackage;
      if (line.family_product_id !== item.productId || line.parcel_instances.length !== item.quantity
        || !Array.isArray(item.parcelInstances) || item.parcelInstances.length !== item.quantity) return false;
      const expected = line.parcel_instances.map(p => composition(p.components));
      const actual = item.parcelInstances.map(p => {
        if (!object(p) || !uuid(p.instance_id) || p.configuration_revision !== line.configuration_revision
          || p.units_per_parcel !== item.unitsPerSalePackage || !Array.isArray(p.components)
          || p.components.reduce((s, c) => s + (object(c) ? Number(c.base_quantity) : NaN), 0) !== item.unitsPerSalePackage) return null;
        return composition(p.components, true);
      });
      return !expected.includes(null) && !actual.includes(null)
        && JSON.stringify(expected.sort()) === JSON.stringify(actual.sort());
    });
    if (index < 0) return false;
    remaining.splice(index, 1); itemIds.add(String(item.id));
    if (item.commercialLineKind === 'configurable_parcel') {
      for (const p of item.parcelInstances as Array<Record<string, unknown>>) {
        if (instanceIds.has(String(p.instance_id))) return false;
        instanceIds.add(String(p.instance_id));
        for (const c of p.components as Array<Record<string, unknown>>) {
          if (componentIds.has(String(c.component_id))) return false;
          componentIds.add(String(c.component_id));
        }
      }
    }
    gross += item.lineTotalInMinorUnits; discount += item.allocatedDiscountInMinorUnits;
    net += item.netRefundableAmountInMinorUnits;
  }
  return Number.isSafeInteger(gross) && gross === value.subtotalInMinorUnits
    && discount === value.discountInMinorUnits && net === value.totalInMinorUnits && remaining.length === 0;
}
