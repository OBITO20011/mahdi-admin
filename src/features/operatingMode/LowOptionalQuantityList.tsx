import {useEffect,useRef,useState} from 'react';
import {useAuthStore} from '../../stores/useAuthStore';
import {UiButton} from '../../components/ui';
import {fetchLowOptionalQuantity,type LowOptionalQuantity} from '../../services/supabase/optionalQuantity.service';

export function LowOptionalQuantityList(){
 const auth=useAuthStore(),actor=auth.isAuthenticated?auth.user?.id??'':'';
 const owner=auth.roleName==='owner'||auth.roles.includes('owner');
 const [opened,setOpened]=useState(false),generation=useRef(0);
 useEffect(()=>{const sequence=generation;sequence.current++;return()=>{sequence.current++;};},[actor,owner]);
 const [state,setState]=useState<{actor:string;status:'loading'|'ready'|'error';page:number;total:number;products:LowOptionalQuantity[]}>({actor:'',status:'loading',page:1,total:0,products:[]});
 const load=async(page:number)=>{
  if(!owner||!actor)return;
  const sequence=++generation.current;setState({actor,status:'loading',page,total:0,products:[]});
  try{const result=await fetchLowOptionalQuantity(page);if(sequence===generation.current)setState({actor,status:'ready',...result});}
  catch{if(sequence===generation.current)setState({actor,status:'error',page,total:0,products:[]});}
 };
 if(!owner)return null;
 const ready=state.actor===actor&&state.status==='ready';
 return <section className="space-y-3 rounded-xl border border-nw-border bg-nw-surface p-3" aria-label="أصناف قرب تخلص">
  <UiButton type="button" aria-expanded={opened} onClick={()=>{generation.current++;setOpened(!opened);if(!opened)void load(1);}}>أصناف قرب تخلص</UiButton>
  {opened&&<>
   <p className="text-sm text-nw-muted">الأصناف التي فعّلت عدّادها ووصلت إلى صفر أو نزلت عن حد التنبيه. ابحث عن رمز الصنف في دليل المنتجات لتعديل كميته.</p>
   {!ready&&<p role={state.status==='error'?'alert':'status'}>{state.status==='error'?'تعذرت قراءة القائمة؛ تحقّق من جلسة المالك وأعد القراءة.':'جارٍ القراءة…'}</p>}
   {ready&&<><p>عدد الأصناف: {state.total}</p><ul className="divide-y divide-nw-border">{state.products.map(row=><li key={row.productId} className="py-2">
    <strong>{row.name}</strong><span className="ms-2 text-xs text-nw-muted">{row.sku}</span><p>{row.quantity===0?'نفدت الكمية':`${row.quantity} ${row.unitName}`} — حد التنبيه: {row.threshold} {row.unitName}</p>
   </li>)}</ul>
   <div className="flex flex-wrap gap-2"><UiButton type="button" disabled={state.page<=1} onClick={()=>void load(state.page-1)}>السابق</UiButton><span className="self-center">صفحة {state.page}</span><UiButton type="button" disabled={state.page*20>=state.total} onClick={()=>void load(state.page+1)}>التالي</UiButton></div></>}
   <UiButton type="button" disabled={state.actor===actor&&state.status==='loading'} onClick={()=>void load(state.page)}>إعادة قراءة القائمة</UiButton>
  </>}
 </section>;
}
