import type {Invoice, OrderItem, Product} from '../../types';
import type {PosV2Line, PosV2SaleResult} from '../../services/supabase/posV2.service';

export interface PosCartItem extends OrderItem {v2Line: PosV2Line}
export function posCartLines(items: PosCartItem[]): PosV2Line[] {
  return items.map(item => item.v2Line.commercial_line_kind === 'base_unit'
    ? {...item.v2Line, base_quantity: item.quantity}
    : item.v2Line.commercial_line_kind === 'legacy_single_sku_parcel'
      ? {...item.v2Line, parcel_quantity: item.quantity} : structuredClone(item.v2Line));
}
export function posStockDemand(items: PosCartItem[]): Map<string, number> {
  const demand = new Map<string, number>();
  for (const line of posCartLines(items)) {
    const add = (id: string, q: number) => demand.set(id, (demand.get(id) || 0) + q);
    if (line.commercial_line_kind === 'base_unit') add(line.product_id, line.base_quantity);
    else if (line.commercial_line_kind === 'legacy_single_sku_parcel') add(line.product_id, line.parcel_quantity * line.units_per_parcel);
    else for (const p of line.parcel_instances) for (const c of p.components) add(c.product_id, c.base_quantity);
  }
  return demand;
}
export function posWarehouseAvailable(product: Product, warehouseId: string): number {
  const balance = product.warehouseBalances?.find(b => b.warehouseId === warehouseId);
  return balance ? balance.availableQuantity : product.warehouseId === warehouseId ? product.availableQuantity : 0;
}
export function posV2Invoice(sale: PosV2SaleResult, actor: {id: string; name: string}, createdAt: string): Invoice & {changeDue: number} {
  const items = sale.items as Array<Record<string, any>>;
  return {id: sale.orderId, invoiceNumber: sale.orderNumber, orderId: sale.orderId, customerName: sale.customerName,
    items: items.map(i => ({id: i.id, productId: i.productId, productName: i.productName, sku: i.sku,
      productImage: '', unit: i.salePackage, unitPrice: i.unitPriceInMinorUnits / 1000,
      costPrice: i.cogsInMinorUnits / i.baseQuantity / 1000, quantity: i.quantity, baseQuantity: i.baseQuantity,
      unitsPerSalePackage: i.unitsPerSalePackage, salePackage: i.salePackage, discount: i.allocatedDiscountInMinorUnits / 1000,
      totalPrice: i.lineTotalInMinorUnits / 1000, commercialLineKind: i.commercialLineKind})),
    subtotal: sale.subtotalInMinorUnits / 1000, discount: sale.discountInMinorUnits / 1000, taxAmount: 0,
    totalAmount: sale.totalInMinorUnits / 1000, paidAmount: sale.amountPaidInMinorUnits / 1000,
    remainingAmount: (sale.totalInMinorUnits - sale.amountPaidInMinorUnits) / 1000, paymentMethod: sale.paymentMethod,
    status: 'posted', branchId: sale.branchId, createdById: actor.id, createdByName: actor.name, createdAt,
    changeDue: sale.changeDueInMinorUnits / 1000};
}
