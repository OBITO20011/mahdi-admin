import type {AftercarePhysicalRepresentative, ReturnPhysicalSource} from '../../services/supabase/salesAftercare.service';

/** Presentation request allocation only; remaining capacity is still revalidated by the RPC. */
export function allocateBaseReturn(
  orderItemId: string, representatives: AftercarePhysicalRepresentative[],
  quantity: number, disposition: 'restock' | 'damaged',
): ReturnPhysicalSource[] {
  const available = representatives.reduce((sum, source) => sum + source.remainingQuantity, 0);
  if (!Number.isSafeInteger(available) || !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > available
    || representatives.some(source => !Number.isSafeInteger(source.remainingQuantity)
      || source.remainingQuantity < 0)
    || new Set(representatives.map(source => `${source.sourceKind}:${source.sourceId}`)).size !== representatives.length) {
    throw new Error('اختر كمية صحيحة بين 1 والكمية المتبقية.');
  }
  let remaining = quantity;
  return [...representatives].sort((a, b) => a.sourceId.localeCompare(b.sourceId))
    .flatMap(source => {
      const allocated = Math.min(remaining, source.remainingQuantity);
      remaining -= allocated;
      return allocated === 0 ? [] : [{
        root_source_kind: 'base_order_item' as const, root_source_id: orderItemId,
        source_kind: source.sourceKind, source_id: source.sourceId,
        product_id: source.productId, quantity: allocated,
        sellable_restock_quantity: disposition === 'restock' ? allocated : 0,
        defect_non_sellable_quantity: disposition === 'damaged' ? allocated : 0,
        customer_damage_quantity: 0,
      }];
    });
}
