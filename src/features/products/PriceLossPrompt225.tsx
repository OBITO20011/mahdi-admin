import {UiButton,formatJod} from '../../components/ui';
import type {PriceLossConfirmation225} from '../../services/supabase/onPrices225.service';

export function PriceLossPrompt225({proof,onRespond}:{proof:PriceLossConfirmation225;onRespond:(accepted:boolean)=>void}){
 return <section role="alert" className="space-y-2 rounded-xl border border-nw-warn p-3" aria-label="تأكيد السعر تحت التكلفة">
  <p className="font-bold">السعر أقل من التكلفة. متأكد من البيع بخسارة؟</p>
  <p>سعر المفرد {formatJod(proof.unitPrice/1000)} · سعر الطرد {formatJod(proof.parcelPrice/1000)}</p>
  <ul className="list-disc ps-5">{proof.risks.map((risk,index)=>
   <li key={index}>{risk.name} — التكلفة {formatJod(Number(risk.wacInMinorUnitsExact)/1000)} · {risk.unitBelowCost?'المفرد تحت التكلفة':''}{risk.unitBelowCost&&risk.parcelBelowCost?'، ':''}{risk.parcelBelowCost?'الطرد تحت التكلفة':''}</li>)}</ul>
  <div className="flex flex-wrap gap-2">
   <UiButton type="button" variant="primary" onClick={()=>onRespond(true)}>أكّد الحفظ بهذا السعر</UiButton>
   <UiButton type="button" onClick={()=>onRespond(false)}>رجوع</UiButton>
  </div>
 </section>;
}
