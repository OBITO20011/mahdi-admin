// Numerical input fixtures shared by the read-only return preview and the
// actual existing return coordinator. No prices/costs are supplied by the UI.
export function returnPayload215(s, {quantity = 12, good = 11, damage = 0, bad = quantity - good - damage, method = 'auto', reference = null, supplierId = null} = {}) {
  return {
    orderId: s.sale.orderId,
    reason: 'إرجاع بضاعة بعد فحص الباكيتات',
    notes: null,
    refundMethod: method,
    referenceNumber: reference,
    items: [{return_scope: 'base_unit', order_item_id: s.item, quantity,
      stock_disposition: good > 0 ? 'restock' : 'damaged', ...(damage > 0 ? {customer_damage_quantity: damage} : {})}],
    physicalSources: [{root_source_kind: 'base_order_item', root_source_id: s.item,
      source_kind: 'base_order_item', source_id: s.item, product_id: s.pid, quantity,
      sellable_restock_quantity: good, defect_non_sellable_quantity: bad, customer_damage_quantity: damage}],
    supplierAssignments: supplierId ? [{sourceKind: 'base_order_item', sourceId: s.item, supplierId}] : [],
  };
}
