import type {SupplierReceiptItem} from '../../types/directReceiving';
import type {ReceiptDisplayLine} from '../../utils/receivingPurchaseContext';
type PreviewRow = Pick<SupplierReceiptItem, 'id'|'productId'|'productName'|'productSku'|'packageQuantity'|'unitsPerPackage'|'baseUnitName'> & {displayUnit: string};

export function SupplierReceiptItemsPreview({items, displayLines, error}: {
  items: readonly SupplierReceiptItem[];
  displayLines?: readonly ReceiptDisplayLine[];
  error?: string;
}) {
  if (error) return <p role="status" className="text-xs text-nw-warn">تعذر عرض كميات السند: {error}</p>;
  const rows: PreviewRow[] = displayLines ? displayLines.map(line => ({
    id: line.id,
    productId: line.kind === 'configurable_parcel' ? `mix:${line.id}` : line.components[0]?.productId || line.id,
    productName: line.components.map(c => c.nameAr || items.find(item => item.id === c.itemId)?.productName || c.sku || 'صنف غير مسمى').join(' / '),
    productSku: line.components[0]?.sku || '',
    packageQuantity: line.commercialQuantity,
    unitsPerPackage: line.kind === 'base_unit' ? 1 : line.unitsPerParcel || 1,
    baseUnitName: line.baseUnitName,
    displayUnit: line.kind === 'base_unit' ? line.baseUnitName : line.kind === 'configurable_parcel' ? 'طرد مشكّل' : 'طرد',
  })) : items.map(item => ({...item, displayUnit: item.unitsPerPackage > 1 ? 'طرد' : item.baseUnitName || item.purchaseUnitName || 'وحدة'}));
  const products = new Map<string, PreviewRow[]>();
  for (const item of rows) {
    const key = item.productId || item.id;
    products.set(key, [...(products.get(key) || []), item]);
  }
  const groups = [...products.values()];
  return <div className="space-y-1 text-sm" aria-label="أصناف السند">
    {groups.slice(0, 2).map(lines => <p key={lines[0].productId || lines[0].id} className="m-0 break-words">
      {lines[0].productName || lines[0].productSku || 'صنف غير مسمى'} —{' '}
      {lines.map((item, index) => <span key={item.id}>
        {index > 0 ? ' + ' : ''}<bdi dir="ltr">{item.packageQuantity}</bdi>{' '}
        {item.displayUnit}
        {item.unitsPerPackage > 1 && lines.some(other => other.unitsPerPackage > 1 && other.unitsPerPackage !== item.unitsPerPackage)
          ? ` (${item.unitsPerPackage} ${item.baseUnitName || 'وحدة'})` : ''}
      </span>)}
    </p>)}
    {groups.length > 2 && <p className="m-0 text-xs text-nw-muted">+{groups.length - 2} أصناف أخرى</p>}
    {groups.length === 0 && <p className="m-0 text-xs text-nw-muted">لا توجد تفاصيل أصناف في السند.</p>}
  </div>;
}
