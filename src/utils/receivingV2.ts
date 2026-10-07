import type {DirectReceiptItemInput} from '../types/directReceiving';
import type {ReceivePurchaseOrderInput} from '../types/purchases';

const integer = (value: number, name: string, positive = false): number => {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    throw new Error(`قيمة ${name} غير صالحة.`);
  }
  return value;
};
const uuid = (value: string | undefined): string => {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('هوية سطر الاستلام غير صالحة؛ أعد فتح السند.');
  }
  return value;
};

// Purchase packages are converted to physical base units, never Sales Parcels.
// Product defaults and selling prices are intentionally absent from this API.
export function directReceiptV2Lines(items: DirectReceiptItemInput[]) {
  return items.map(item => {
    const quantity = integer(item.packageQuantity, 'عدد العبوات', true);
    const units = integer(item.unitsPerPackage, 'محتوى العبوة', true);
    const price = integer(item.packagePriceInMinorUnits, 'سعر العبوة');
    return {
      client_line_id: uuid(item.clientLineId),
      line_kind: 'base_unit',
      commercial_quantity: integer(quantity * units, 'عدد الباكيتات', true),
      base_unit_name: item.baseUnitName,
      gross_amount_in_minor_units: integer(quantity * price, 'إجمالي السطر'),
      line_discount_in_minor_units: integer(item.discountInMinorUnits ?? 0, 'خصم السطر'),
      components: [{product_id: uuid(item.productId), base_quantity: quantity * units,
        batch_number: item.batchNumber ?? null, production_date: item.productionDate ?? null,
        expiry_date: item.expiryDate ?? null, notes: item.notes ?? null}],
    };
  });
}

export function purchaseReceiptV2Lines(items: ReceivePurchaseOrderInput['items']) {
  return items.map(item => {
    const quantity = integer(item.receivedQuantity, 'الكمية المستلمة', true);
    if (!Number.isFinite(item.unitCost) || item.unitCost < 0) throw new Error('تكلفة الباكيت غير صالحة.');
    const cost = integer(Math.round(item.unitCost * 1000), 'تكلفة الباكيت');
    return {client_line_id: uuid(item.purchaseOrderItemId),
      purchase_order_item_id: item.purchaseOrderItemId, line_kind: 'base_unit',
      commercial_quantity: quantity, base_unit_name: item.baseUnitName || 'باكيت',
      gross_amount_in_minor_units: integer(quantity * cost, 'إجمالي الاستلام'),
      line_discount_in_minor_units: 0,
      components: [{product_id: uuid(item.productId), base_quantity: quantity}],
    };
  });
}
