import {useState} from 'react';
import {UiButton,formatJod} from '../../components/ui';
import type {LastPurchaseQuote,SalePriceQuote} from '../../utils/receivingPurchaseContext';
import {purchasePriceRise,quoteForQuantity} from '../../utils/receivingPurchaseContext';
interface Props {status:'loading'|'ready'|'error';error:string|null;quote?:LastPurchaseQuote|null;unitName:string;units:number;priceInMinorUnits:number;saleQuote:SalePriceQuote|null;onEditSale?:()=>void}
export function ReceivingPurchaseHint(p:Props){
  const [dismissed,setDismissed]=useState('');
  if(p.status==='loading')return <p role="status" className="text-xs text-nw-muted">جارٍ قراءة آخر سعر شراء…</p>;
  if(p.status==='error')return <p role="alert" className="text-xs text-nw-warn">{p.error}</p>;
  const rise=purchasePriceRise(p.quote,p.priceInMinorUnits,p.units,p.saleQuote),signature=JSON.stringify([p.quote?.receiptId,p.priceInMinorUnits,p.units,p.saleQuote]);
  return <div className="space-y-2 text-xs">
    <p className="m-0 text-nw-muted">{p.quote?<>آخر سعر شراء: {formatJod(quoteForQuantity(p.quote,p.units)/1000)} · {p.units>1?'الطرد':p.unitName} · {p.quote.receiptNumber}</>:<>لا يوجد استلام سابق؛سعر الشراء الافتراضي اقتراح.</>}</p>
    {rise&&dismissed!==signature&&<div role="status" className={`rounded-xl border border-nw-border p-3 ${rise.isLoss?'bg-nw-bad-bg text-nw-bad':'bg-nw-warn-bg text-nw-warn'}`}>
      <strong>سعر الشراء ارتفع من {formatJod(rise.oldPrice/1000)} إلى {formatJod(rise.newPrice/1000)}.</strong>
      <p className="my-1">{rise.newProfit===null?'سعر البيع الحالي غير متاح لحساب الربح التقريبي.':<>ربح {(p.saleQuote?.baseQuantity??1)>1?'الطرد':p.unitName} التقريبي صار {formatJod(rise.newProfit/1000)} بدل {formatJod((rise.oldProfit??0)/1000)}.</>}{p.saleQuote&&p.saleQuote.baseQuantity>1&&p.saleQuote.baseQuantity!==p.units&&(' طرد البيع = '+p.saleQuote.baseQuantity+' '+p.unitName+'.')}{rise.isLoss&&' سعر البيع أقل من الشراء الجديد.'}</p>
      <div className="flex flex-wrap gap-2">{p.onEditSale&&<UiButton type="button" onClick={p.onEditSale}>تعديل سعر البيع</UiButton>}<UiButton type="button" variant="plain" onClick={()=>setDismissed(signature)}>لا</UiButton></div>
    </div>}
  </div>;
}
