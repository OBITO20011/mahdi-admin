import {useCallback,useEffect,useRef,useState} from 'react';
import {useAuthStore} from '../../stores/useAuthStore';
import {fetchManualAvailability,setManualAvailability,type ProductAvailability} from '../../services/supabase/manualAvailability.service';
import {UiButton} from '../../components/ui';

/** One grouped read for the product/family. It never changes is_active, stock,
 * prices or cost. A failed CAS/lost reply requires an explicit fresh read. */
export function ManualAvailabilityPanel({products,disabled=false}:{products:readonly {id:string;name:string}[];disabled?:boolean}){
 const auth=useAuthStore(),actor=auth.isAuthenticated?auth.user?.id??'':'';
 const owner=auth.roleName==='owner'||auth.roles.includes('owner');
 const key=JSON.stringify([...new Set(products.map(p=>p.id))].sort());
 const [state,setState]=useState<{actor:string;key:string;rows:ProductAvailability[];status:'loading'|'ready'|'error'}>({actor:'',key:'',rows:[],status:'loading'});
 const [busy,setBusy]=useState(false),busyRef=useRef(false),generation=useRef(0);
 const load=useCallback(async()=>{
  const token=++generation.current;
  setState(s=>({...s,actor,key,status:'loading'}));
  try{
   const ids=JSON.parse(key) as string[],rows:ProductAvailability[]=[];
   if(!owner||!actor||!ids.length)throw Error('AVAILABILITY_ACTOR_REQUIRED');
   for(let i=0;i<ids.length;i+=200){const result=await fetchManualAvailability(ids.slice(i,i+200));if(result.fullAccounting)throw Error('MODE_CHANGED');rows.push(...result.products);}
   if(token===generation.current)setState({actor,key,rows,status:'ready'});
  }catch{if(token===generation.current)setState({actor,key,rows:[],status:'error'});}
 },[actor,key,owner]);
 useEffect(()=>{const sequence=generation;void load();return()=>{sequence.current++;};},[load]);
 const ready=owner&&!!actor&&state.actor===actor&&state.key===key&&state.status==='ready';
 const toggle=async(row:ProductAvailability)=>{
  if(!ready||disabled||busyRef.current)return;
  const token=generation.current;busyRef.current=true;setBusy(true);
  try{
   await setManualAvailability(row.productId,!row.available,row.revision);
   if(token===generation.current)await load();
  }catch{if(token===generation.current)setState({actor,key,rows:[],status:'error'});}
  finally{busyRef.current=false;setBusy(false);}
 };
 if(!owner)return null;
 return <section aria-label="التوفر اليدوي" className="space-y-3 rounded-xl border border-nw-border bg-nw-surface p-3" data-manual-availability>
  <h4 className="font-bold">التوفر اليدوي للمتجر والكاشير</h4>
  <p className="text-sm text-nw-muted">المتجر يمنع طلب غير المتوفر؛ الكاشير يطلب تأكيداً صريحاً قبل بيعه. لا يتغير المخزون بهذا المفتاح.</p>
  {!ready&&<p role={state.status==='error'?'alert':'status'}>{state.status==='error'?'لم نتأكد من الحالة. لا تكرر التغيير؛ أعد قراءة التوفر أولاً. (AVL-01)':'جارٍ قراءة التوفر…'}</p>}
  {ready&&products.map(product=>{const row=state.rows.find(r=>r.productId===product.id.toLowerCase());return row&&<div key={product.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-nw-border py-2">
   <div><strong>{product.name}</strong><p className="text-sm text-nw-muted">{row.effectiveAvailable?'متوفر فعلياً للمتجر':!row.active?'المنتج مخفي؛ إظهاره من بطاقة المنتج':!row.parentAvailable?'المنتج الأساسي غير متوفر أو مخفي':'غير متوفر'}</p></div>
   <UiButton role="switch" aria-label={`توفر ${product.name}`} aria-checked={row.available} disabled={disabled||busy} onClick={()=>void toggle(row)}>{row.available?'متوفر':'غير متوفر'}</UiButton>
  </div>;})}
  <UiButton disabled={disabled||busy||state.status==='loading'} onClick={()=>void load()}>إعادة قراءة التوفر</UiButton>
 </section>;
}
