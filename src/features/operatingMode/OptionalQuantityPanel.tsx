import {useCallback,useEffect,useRef,useState} from 'react';
import {useAuthStore} from '../../stores/useAuthStore';
import {UiButton} from '../../components/ui';
import {fetchOptionalQuantity,saveOptionalQuantity,parseOptionalQuantityInput,type OptionalQuantityContext,type OptionalQuantityRow} from '../../services/supabase/optionalQuantity.service';

type Draft={enabled:boolean;quantity:string;threshold:string};
function CounterRow({row,disabled,onSave}:{row:OptionalQuantityRow;disabled:boolean;onSave:(row:OptionalQuantityRow,draft:Draft)=>void}){
 const [draft,setDraft]=useState<Draft>({enabled:row.enabled,quantity:String(row.quantity),threshold:String(row.threshold)});
 const quantity=parseOptionalQuantityInput(draft.quantity),threshold=parseOptionalQuantityInput(draft.threshold);
 const valid=quantity!==null&&threshold!==null;
 const changed=draft.enabled!==row.enabled||quantity!==row.quantity||threshold!==row.threshold;
 return <div className="space-y-3 border-t border-nw-border py-3" data-optional-quantity-row={row.productId}>
  <div><strong>{row.flavorName||row.name}</strong><span className="ms-2 text-xs text-nw-muted">{row.sku}</span></div>
  <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={draft.enabled} disabled={disabled} onChange={e=>setDraft(d=>({...d,enabled:e.target.checked}))}/>تتبّع الكمية</label>
  <div className="grid gap-3 sm:grid-cols-2">
   <label className="space-y-1"><span>صار عندي — {row.unitName}</span><input className="w-full rounded-lg border border-nw-border bg-nw-surface p-2 text-base" inputMode="numeric" value={draft.quantity} disabled={disabled} onChange={e=>setDraft(d=>({...d,quantity:e.target.value}))}/></label>
   <label className="space-y-1"><span>نبّهني إذا صارت أقل من — {row.unitName}</span><input className="w-full rounded-lg border border-nw-border bg-nw-surface p-2 text-base" inputMode="numeric" value={draft.threshold} disabled={disabled} onChange={e=>setDraft(d=>({...d,threshold:e.target.value}))}/></label>
  </div>
  {!valid&&<p role="alert" className="text-sm text-nw-bad">أدخل أعداداً صحيحة من صفر إلى مليار.</p>}
  <p className="text-sm text-nw-muted">{row.enabled?`الكمية المحفوظة: ${row.quantity} ${row.unitName} — ${row.effectiveAvailable?'متوفر للمتجر':'غير متوفر للمتجر'}`:'التتبّع مطفأ؛ التوفّر اليدوي هو المعتمد.'}</p>
  <UiButton type="button" disabled={disabled||!valid||!changed} onClick={()=>onSave(row,draft)}>حفظ كمية {row.flavorName||row.name}</UiButton>
 </div>;
}

export function OptionalQuantityPanel({productId,disabled=false}:{productId:string;disabled?:boolean}){
 const auth=useAuthStore(),actor=auth.isAuthenticated?auth.user?.id??'':'';
 const owner=auth.roleName==='owner'||auth.roles.includes('owner');
 const [state,setState]=useState<{actor:string;id:string;status:'loading'|'ready'|'error';context:OptionalQuantityContext|null}>({actor:'',id:'',status:'loading',context:null});
 const [busy,setBusy]=useState(false),generation=useRef(0),busyRef=useRef(false);
 const load=useCallback(async()=>{
  const token=++generation.current;setState({actor,id:productId,status:'loading',context:null});
  try{
   if(!owner||!actor)throw Error('OWNER_REQUIRED');
   const context=await fetchOptionalQuantity(productId);
   if(token===generation.current)setState({actor,id:productId,status:'ready',context});
  }catch{if(token===generation.current)setState({actor,id:productId,status:'error',context:null});}
 },[actor,owner,productId]);
 useEffect(()=>{const sequence=generation;void load();return()=>{sequence.current++;};},[load]);
 const ready=owner&&!!actor&&state.actor===actor&&state.id===productId&&state.status==='ready';
 const save=async(row:OptionalQuantityRow,draft:Draft)=>{
  if(!ready||disabled||busyRef.current)return;
  const quantity=parseOptionalQuantityInput(draft.quantity),threshold=parseOptionalQuantityInput(draft.threshold);
  if(quantity===null||threshold===null)return;
  const token=generation.current;busyRef.current=true;setBusy(true);
  try{
   await saveOptionalQuantity(row,{enabled:draft.enabled,quantity,threshold},crypto.randomUUID());
   if(token===generation.current)await load();
  }catch{if(token===generation.current)setState({actor,id:productId,status:'error',context:null});}
  finally{busyRef.current=false;setBusy(false);}
 };
 if(!owner)return null;
 return <section aria-label="عدّاد الكمية الاختياري" className="mb-4 space-y-3 rounded-xl border border-nw-border bg-nw-surface p-3" data-optional-quantity>
  <h4 className="font-bold">عدّاد الكمية الاختياري</h4>
  <p className="text-sm text-nw-muted">التتبّع مستقل لكل منتج أو نكهة. احفظ تعديلات المنتج أولاً؛ حفظ الكمية هنا مستقل ويتطلب جلسة المالك المؤكدة.</p>
  {!ready&&<p role={state.status==='error'?'alert':'status'}>{state.status==='error'?'لم نتأكد من الكمية. أعد القراءة قبل تكرار التعديل. (QTY-01)':'جارٍ قراءة الكميات…'}</p>}
  {ready&&state.context?.products.map(row=><CounterRow key={`${row.productId}:${row.revision}`} row={row} disabled={disabled||busy} onSave={(r,d)=>void save(r,d)}/>)}
  <UiButton type="button" disabled={disabled||busy||state.status==='loading'} onClick={()=>void load()}>إعادة قراءة الكميات</UiButton>
 </section>;
}
