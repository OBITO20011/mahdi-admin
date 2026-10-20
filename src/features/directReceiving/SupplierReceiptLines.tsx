import {formatJod} from '../../components/ui';
import type {ReceiptDisplayLine} from '../../utils/receivingPurchaseContext';
interface Props {lines:ReceiptDisplayLine[]|undefined;error?:string}
export function SupplierReceiptLines({lines,error}:Props){
  if(error)return <p role="alert" className="rounded-xl border border-nw-border p-3 text-nw-bad">{error}</p>;
  if(!lines)return <p role="status">أساس أسعار الاستلام غير متاح؛أعد فتح السند لقراءة تفاصيله.</p>;
  if(!lines.length)return <p role="status">لا توجد أصناف محفوظة في هذا السند.</p>;
  return <div className="space-y-3" data-testid="supplier-receipt-saved-lines">{lines.map((line,index)=>{
    const parcel=line.kind!=='base_unit',unit=line.baseUnitName;
    const basis=parcel?'طرد':unit;
    const sale=line.components.length===1?line.components[0].currentSaleUnitPriceInMinorUnits:null;
    const unitQuote=line.grossInMinorUnits/line.baseQuantity;
    return <section key={line.id} className="break-inside-avoid rounded-xl border border-nw-border p-3">
      <h3 className="m-0 text-sm font-bold">{index+1}. {line.components.map(c=>c.nameAr??c.sku??'صنف').join(' + ')}</h3>
      <p className="my-2 font-bold">{line.commercialQuantity} {basis}{parcel&&line.unitsPerParcel!==null?` × ${line.unitsPerParcel} ${unit}`:''} · إجمالي {line.baseQuantity} {unit}</p>
      {line.kind==='base_unit'&&<p className="my-1 text-xs text-nw-muted">السند محفوظ بالـ{unit}؛عدد الطرود الأصلي غير محفوظ في هذا المسار.</p>}
      {line.components.length>1&&<ul className="my-2 text-xs">{line.components.map(c=><li key={c.itemId}>{c.nameAr??c.sku??'صنف'}: {c.baseQuantity} {unit}</li>)}</ul>}
      <dl className="m-0 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div><dt>سعر {basis}{line.grossInMinorUnits%line.commercialQuantity!==0?' (تقريبي)':''}</dt><dd className="m-0 font-bold">{formatJod(line.grossInMinorUnits/line.commercialQuantity/1000)}</dd></div>
        <div><dt>الإجمالي قبل الخصم</dt><dd className="m-0 font-bold">{formatJod(line.grossInMinorUnits/1000)}</dd></div>
        <div><dt>خصم الصنف</dt><dd className="m-0 font-bold">{formatJod(line.lineDiscountInMinorUnits/1000)}</dd></div>
        <div><dt>الصافي بعد خصم الصنف</dt><dd className="m-0 font-bold">{formatJod(line.netInMinorUnits/1000)}</dd></div>
      </dl>
      <div className="mt-2 grid grid-cols-2 gap-2 border-t border-nw-border pt-2 text-xs print:hidden">
        <p className="m-0">سعر بيع {unit} الحالي: <strong>{sale===null?'غير متاح':formatJod(sale/1000)}</strong></p>
        <p className="m-0">فرق البيع الحالي عن الشراء لكل {unit} (تقريبي): <strong className={sale!==null&&sale<unitQuote?'text-nw-bad':'text-nw-ok'}>{sale===null?'غير متاح':formatJod((sale-unitQuote)/1000)}</strong></p>
      </div>
    </section>;
  })}</div>;
}
