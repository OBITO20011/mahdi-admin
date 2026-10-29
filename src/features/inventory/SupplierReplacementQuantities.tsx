import type {SupplierReplacementPage} from '../../utils/supplierReplacement';
import {supplierPacketQuantity} from './supplierReplacementPresentation';

/** Display only: quantities keep their product/base-unit identity and page scope. */
export function SupplierReplacementQuantities({data}:{data:SupplierReplacementPage}) {
  const groups=new Map<string,{name:string;factor:number;quantity:bigint}>();
  for(const row of data.cases) {
    if(row.pendingQuantity===0)continue;
    const key=JSON.stringify([row.productId,row.unitsPerCommercialUnit]);
    const group=groups.get(key)??{name:row.productName,factor:row.unitsPerCommercialUnit,quantity:0n};
    group.quantity+=BigInt(row.pendingQuantity);groups.set(key,group);
  }
  return <div className="space-y-2 text-sm">
    {groups.size>0?<ul aria-label="كميات المعلّق حسب الصنف" className="space-y-1">
      {[...groups].map(([key,row])=><li key={key} className="flex flex-wrap justify-between gap-x-3">
        <span>{row.name}</span><span><bdi>{supplierPacketQuantity(row.quantity,row.factor)}</bdi></span>
      </li>)}
    </ul>:<p>لا توجد كميات معلّقة في السجلات المعروضة.</p>}
    {data.totalCount>data.cases.length&&<p className="text-xs text-nw-muted">
      صفحة {data.page} · عرض {data.cases.length} من {data.totalCount} سجلاً. الكميات تخص هذه الصفحة فقط؛ بقية الأصناف في السجل.
    </p>}
  </div>;
}
