import {useState} from 'react';
import {UiButton,formatJod} from '../../components/ui';
import type {ReceiptPriceWarning225,RestorePrice225} from '../../services/supabase/onPrices225.service';
import {ReceivingProductPriceEditor} from './ReceivingProductPriceEditor';

export function SavedReceiptPriceReview225({warnings,onClose}:{warnings:ReceiptPriceWarning225[];onClose:()=>void}){
 const [dismissed,setDismissed]=useState<string[]>([]);
 const [editing,setEditing]=useState<{productId:string;restore:RestorePrice225}|null>(null);
 return <section aria-label="مراجعة أسعار البيع بعد الاستلام" className="min-w-0 space-y-3 overflow-y-auto p-4">
  <p role="status" className="font-bold text-nw-ok">تم حفظ الاستلام وتحديث المخزون.</p>
  <h3 className="font-bold">مراجعة أسعار البيع بعد الاستلام</h3>
  {warnings.filter(row=>!dismissed.includes(row.productId)).map(row=><article key={row.productId} className="space-y-2 rounded-lg border border-nw-border p-3">
   <h4 className="font-bold">{row.name}</h4>
   <p>سعر {row.unit} {formatJod(row.unitPrice/1000)}{row.originalUnitPrice!==null?' · الأصلي '+formatJod(row.originalUnitPrice/1000):''} · التكلفة الجديدة {formatJod(Number(row.wacInMinorUnitsExact)/1000)}</p>
   {(row.originalParcelPrice!==null||row.parcelBelowCost)&&<p>سعر {row.parcelUnit} {formatJod(row.parcelPrice/1000)}{row.originalParcelPrice!==null?' · الأصلي '+formatJod(row.originalParcelPrice/1000):''}{row.parcelEnabled?'':' · الطرد موقوف'}</p>}
   {(row.parcelBelowCost||row.unitBelowCost)&&<p className="text-nw-warn">{row.unitBelowCost?row.unit+' تحت التكلفة. ':''}{row.parcelBelowCost?row.parcelUnit+' تحت التكلفة.':''}</p>}
   <div className="flex flex-wrap gap-2">
    {row.originalUnitPrice!==null&&<UiButton type="button" variant="secondary" onClick={()=>setEditing({productId:row.priceProductId,restore:'single'})}>رجّع السعر الأصلي لـ{row.unit}</UiButton>}
    {row.originalParcelPrice!==null&&<UiButton type="button" variant="secondary" onClick={()=>setEditing({productId:row.priceProductId,restore:'parcel'})}>رجّع السعر الأصلي لـ{row.parcelUnit}</UiButton>}
    <UiButton type="button" onClick={()=>setDismissed(current=>[...current,row.productId])}>خلّيه هيك</UiButton>
   </div>
  </article>)}
  <UiButton type="button" onClick={onClose}>تم</UiButton>
  {editing&&<ReceivingProductPriceEditor productId={editing.productId} restoreOriginal={editing.restore}
   onClose={()=>setEditing(null)} onSavedOrClosed={()=>setEditing(null)}/>}
 </section>;
}
