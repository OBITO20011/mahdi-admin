import type {AftercarePhysicalRepresentative, ReturnPhysicalSource} from '../../services/supabase/salesAftercare.service';

/** UI allocation only. Refresh physical capacity before submission; an atomic
 * server-side capacity guard is a separate owner-authorized package D task. */
export function allocateBaseReturn(
  orderItemId: string, representatives: AftercarePhysicalRepresentative[],
  quantity: number, disposition: 'restock' | 'damaged',
  replacements: Array<Record<string, unknown>> = [],
  originalCompletedAt?: string,
): ReturnPhysicalSource[] {
  const available = representatives.reduce((sum, source) => sum + source.remainingQuantity, 0);
  if (!Number.isSafeInteger(available) || !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > available
    || representatives.some(source => !Number.isSafeInteger(source.remainingQuantity)
      || source.remainingQuantity < 0)
    || new Set(representatives.map(source => `${source.sourceKind}:${source.sourceId}`)).size !== representatives.length) {
    throw new Error('اختر كمية صحيحة بين 1 والكمية المتبقية.');
  }
  const history = new Map<string, {parent: string | null; issuedAt: number | null}>();
  for (const event of replacements) {
    if (event.operationalStatus !== 'issued' || !Array.isArray(event.items)) continue;
    for (const raw of event.items) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('بيانات سلسلة الاستبدال غير مكتملة. حدّث الطلب.');
      const item = raw as Record<string, unknown>;
      if (item.rootOrderItemId !== orderItemId || item.rootParcelComponentId != null) continue;
      if (typeof item.replacementItemId !== 'string'
        || (item.parentReplacementItemId !== null && typeof item.parentReplacementItemId !== 'string')
        || history.has(item.replacementItemId)) throw new Error('تعذر ترتيب القطع؛ حدّث بيانات الاستبدال.');
      const at = typeof event.issuedAt === 'string' ? Date.parse(event.issuedAt) : NaN;
      history.set(item.replacementItemId, {parent: item.parentReplacementItemId as string | null,
        issuedAt: Number.isFinite(at) ? at : null});
    }
  }
  const depth = (id: string, visited = new Set<string>()): number => {
    const item = history.get(id);
    if (!item || visited.has(id)) throw new Error('تعذر ترتيب سلسلة الاستبدال؛ حدّث الطلب قبل المتابعة.');
    visited.add(id);
    const parentDate = item.parent === null ? Date.parse(originalCompletedAt || '')
      : history.get(item.parent)?.issuedAt;
    if (item.issuedAt !== null && parentDate != null && Number.isFinite(parentDate)
      && item.issuedAt < parentDate) {
      throw new Error('تاريخ إصدار البديل أقدم من الأصل في سلسلة الاستبدال. حدّث الطلب.');
    }
    return item.parent === null ? 1 : 1 + depth(item.parent, visited);
  };
  const replacementLeaves = representatives.filter(source => source.sourceKind === 'replacement_item');
  for (const source of replacementLeaves) {
    if (history.get(source.sourceId)?.parent !== source.parentReplacementItemId) {
      throw new Error('بيانات القطعة الحالية لا تطابق سلسلة الاستبدال. حدّث الطلب.');
    }
    depth(source.sourceId);
  }
  const datesComplete = replacementLeaves.every(source => history.get(source.sourceId)?.issuedAt != null);
  const ordered = [...representatives].sort((a, b) => {
    if (a.sourceKind !== b.sourceKind) return a.sourceKind === 'base_order_item' ? -1 : 1;
    if (a.sourceKind === 'base_order_item') return a.sourceId.localeCompare(b.sourceId);
    return (datesComplete ? history.get(a.sourceId)!.issuedAt! - history.get(b.sourceId)!.issuedAt! : 0)
      || depth(a.sourceId) - depth(b.sourceId) || a.sourceId.localeCompare(b.sourceId);
  });
  let remaining = quantity;
  return ordered
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

/** Fail closed if any selected physical identity changed since the UI draft. */
export function assertReturnCapacityUnchanged(
  selected: AftercarePhysicalRepresentative[], current: AftercarePhysicalRepresentative[],
): void {
  for (const source of selected) {
    const matches = current.filter(candidate => candidate.sourceKind === source.sourceKind
      && candidate.sourceId === source.sourceId);
    if (matches.length !== 1 || matches[0].remainingQuantity !== source.remainingQuantity
      || matches[0].productId !== source.productId
      || matches[0].parentReplacementItemId !== source.parentReplacementItemId) {
      throw new Error('تغيّرت الكمية المتبقية أو القطعة الحالية. حدّث الطلب وأعد اختيار كمية المرتجع قبل الإرسال.');
    }
  }
}
