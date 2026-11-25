import {useCallback,useEffect,useRef,useState} from 'react';
import {Edit3,Plus,X} from 'lucide-react';
import {Modal} from '../../components/common/Modal';
import {PageHeader,SearchField,UiButton,StatusBadge} from '../../components/ui';
import {DISPLAY_LOCALE} from '../../components/ui/uiFormat';
import {useAuthStore} from '../../stores/useAuthStore';
import {useNavigationDrawer} from '../../components/layout/navigationDrawerContext';
import {fetchInventory224,searchNewCounters224} from '../../services/supabase/inventory224.service';
import {fetchOptionalQuantity,saveOptionalQuantity,parseOptionalQuantityInput,type OptionalQuantityRow} from '../../services/supabase/optionalQuantity.service';
import {receivedQuantity224,type InventoryCounter224,type InventoryPage224,type InventoryFilter,type QuantityEvent224} from './inventory224Contract';

const count=(n:number)=>n.toLocaleString(DISPLAY_LOCALE);
const labels={all:'الكل',low:'قرب يخلص',zero:'نفد'} as const;
const stateLabels={available:'متوفر',low:'قرب يخلص',zero:'نفد'} as const;
const field='w-full min-w-0 rounded-xl border border-nw-border bg-nw-surface p-3 text-base';
function useSearch(initial=''){
 const [text,setText]=useState(initial),[search,setSearch]=useState(initial);
 useEffect(()=>{const timer=setTimeout(()=>setSearch(text),300);return()=>clearTimeout(timer);},[text]);
 return {text,search,setText};
}
function Search({text,onChange,label}:{text:string;onChange:(value:string)=>void;label:string}){
 return <div className="flex min-w-0 items-center gap-2"><SearchField className="min-w-0 flex-1" label={label} placeholder="الاسم أو الرمز أو الباركود" value={text} maxLength={100} onChange={e=>onChange(e.target.value)}/>
  <UiButton type="button" variant="secondary" aria-label="مسح البحث" disabled={!text} onClick={()=>onChange('')}><X className="h-4 w-4"/></UiButton></div>;
}
function LastEvent({event}:{event:QuantityEvent224|null}){
 if(!event)return <p className="text-sm text-nw-muted">لا توجد حركة متاحة في هذه القراءة.</p>;
 const name=event.kind==='manual'?`آخر تعديل: ${event.actorDisplayName||'المالك'}`:event.kind==='sale'?event.source==='website'?'بيع من المتجر':'بيع من الكاشير':event.kind==='cancel'?'إلغاء طلب':'مرتجع صالح للبيع';
 return <p className="break-words text-sm text-nw-muted">{name} ({event.delta>0?'+':event.delta<0?'−':''}{count(Math.abs(event.delta))}) · {new Date(event.at).toLocaleString(DISPLAY_LOCALE,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</p>;
}
function QuantityEditor({row,event,adding,onSaved,onBusy}:{row:OptionalQuantityRow;event:QuantityEvent224|null;adding:boolean;onSaved:()=>void;onBusy:(busy:boolean)=>void}){
 const [kind,setKind]=useState<'receive'|'correct'>(adding?'correct':'receive');
 const [amount,setAmount]=useState(adding?String(row.quantity):'0'),[threshold,setThreshold]=useState(String(row.threshold)),[enabled,setEnabled]=useState(adding||row.enabled);
 const [busy,setBusy]=useState(false),[failed,setFailed]=useState(false),busyRef=useRef(false);
 const amountValue=parseOptionalQuantityInput(amount),thresholdValue=parseOptionalQuantityInput(threshold);
 const next=kind==='receive'?receivedQuantity224(row.quantity,amountValue):amountValue;
 const valid=next!==null&&thresholdValue!==null&&(kind!=='receive'||(amountValue??0)>0||enabled!==row.enabled||thresholdValue!==row.threshold);
 const save=async()=>{
  if(busyRef.current||failed||!valid||next===null||thresholdValue===null)return;
  busyRef.current=true;setBusy(true);onBusy(true);
  try{await saveOptionalQuantity(row,{enabled,quantity:next,threshold:thresholdValue},crypto.randomUUID());onSaved();}
  catch{setFailed(true);}
  finally{busyRef.current=false;setBusy(false);onBusy(false);}
 };
 return <div className="space-y-4" data-counter-editor>
  <p className="text-sm text-nw-muted">{row.sku} · الكمية الحالية <strong>{count(row.quantity)} {row.unitName}</strong></p>
  {!adding&&<div className="flex flex-wrap gap-2" aria-label="نوع تعديل الكمية">{(['receive','correct'] as const).map(value=><UiButton key={value} type="button" variant={kind===value?'primary':'secondary'} aria-pressed={kind===value} disabled={busy||failed} onClick={()=>{setKind(value);setAmount(value==='receive'?'0':String(row.quantity));}}>{value==='receive'?'وصلت بضاعة (+)':'تصحيح العدد'}</UiButton>)}</div>}
  <label className="block space-y-2"><span>{kind==='receive'?`كم ${row.unitName} وصل؟`:'الكمية الموجودة'}</span><div className="flex min-w-0 items-center gap-2">
   {kind==='receive'&&<UiButton type="button" variant="secondary" aria-label="إنقاص الكمية المضافة" disabled={busy||failed||!amountValue} onClick={()=>setAmount(String(Math.max(0,(amountValue??0)-1)))}>−</UiButton>}
   <input className={field} inputMode="numeric" aria-label={kind==='receive'?`كم ${row.unitName} وصل؟`:'الكمية الموجودة'} value={amount} disabled={busy||failed} onChange={e=>setAmount(e.target.value)}/>
   {kind==='receive'&&<UiButton type="button" variant="secondary" aria-label="زيادة الكمية المضافة" disabled={busy||failed||(amountValue??0)>=1_000_000_000} onClick={()=>setAmount(String((amountValue??0)+1))}>+</UiButton>}
  </div></label>
  {kind==='receive'&&next!==null&&<p role="status" className="break-words text-sm font-bold text-nw-ok">{count(row.quantity)} + {count(amountValue??0)} = الكمية الجديدة {count(next)} {row.unitName}</p>}
  <label className="block space-y-2"><span>نبّهني إذا أصبحت أقل من</span><input className={field} inputMode="numeric" value={threshold} disabled={busy||failed} onChange={e=>setThreshold(e.target.value)}/></label>
  {!adding&&<label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={enabled} disabled={busy||failed} onChange={e=>setEnabled(e.target.checked)}/>تتبّع الكمية لهذا الصنف</label>}
  {adding&&<p className="rounded-xl bg-nw-warn-bg p-3 text-sm text-nw-warn">بعد التفعيل وحدة «{row.unitName}» بتنقفل لهالصنف وما بتتغيّر.</p>}
  {(amountValue===null||thresholdValue===null||next===null)&&<p role="alert" className="text-nw-bad">أدخل أعداداً صحيحة من صفر إلى مليار.</p>}
  {failed&&<p role="alert" className="text-nw-bad">لم نتأكد من الكمية أو تغيّرت أثناء التعديل. أعد القراءة قبل تكرار التعديل. (QTY-01)</p>}
  <LastEvent event={event}/>
  <UiButton type="button" disabled={busy||failed||!valid} onClick={()=>void save()}>{busy?'جارٍ الحفظ…':adding?'ابدأ العدّ':'حفظ الكمية'}</UiButton>
 </div>;
}
function EditPanel({item,onClose,onSaved}:{item:InventoryCounter224;onClose:()=>void;onSaved:()=>void}){
 const [state,setState]=useState<{row:OptionalQuantityRow|null;event:QuantityEvent224|null;error:boolean;sequence:number}>({row:null,event:null,error:false,sequence:0});
 const [busy,setBusy]=useState(false),generation=useRef(0);
 const load=useCallback(async()=>{
  const sequence=++generation.current;setState({row:null,event:null,error:false,sequence});
  try{const [data,page]=await Promise.all([fetchOptionalQuantity(item.productId),fetchInventory224(item.sku,'all',1)]);if(sequence===generation.current){if(data.isFamily||data.products.length!==1)throw Error('SELLABLE_REQUIRED');const current=page.items.find(row=>row.productId===item.productId);setState({row:data.products[0],event:current?current.lastEvent:item.lastEvent,error:false,sequence});}}
  catch{if(sequence===generation.current)setState({row:null,event:null,error:true,sequence});}
 },[item.productId,item.sku,item.lastEvent]);
 useEffect(()=>{const ref=generation;void load();return()=>{ref.current++;};},[load]);
 return <Modal isOpen title={[item.familyName||item.name,item.flavorName].filter(Boolean).join(' · ')} onClose={onClose} closeDisabled={busy} trackChanges={false}>
  <div className="space-y-4 p-4">{state.row?<QuantityEditor key={state.sequence} row={state.row} event={state.event} adding={false} onSaved={onSaved} onBusy={setBusy}/>:<p role={state.error?'alert':'status'}>{state.error?'تعذرت القراءة. أعد القراءة قبل التعديل. (QTY-01)':'جارٍ قراءة الكمية…'}</p>}
   <UiButton type="button" variant="secondary" disabled={busy} onClick={()=>void load()}>إعادة قراءة الكمية</UiButton></div>
 </Modal>;
}
function AddPanel({onClose,onSaved}:{onClose:()=>void;onSaved:()=>void}){
 const query=useSearch(),[state,setState]=useState<{rows:OptionalQuantityRow[];loading:boolean;error:boolean}>({rows:[],loading:true,error:false});
 const [selected,setSelected]=useState<OptionalQuantityRow|null>(null),[busy,setBusy]=useState(false),generation=useRef(0),[refresh,setRefresh]=useState(0);
 useEffect(()=>{
  let active=true;const sequence=++generation.current;setState({rows:[],loading:true,error:false});
  void searchNewCounters224(query.search).then(rows=>{if(active&&sequence===generation.current)setState({rows,loading:false,error:false});}).catch(()=>{if(active&&sequence===generation.current)setState({rows:[],loading:false,error:true});});
  return()=>{active=false;};
 },[query.search,refresh]);
 return <Modal isOpen title={selected?selected.flavorName||selected.name:'إضافة منتج للعدّ'} onClose={onClose} closeDisabled={busy} trackChanges={false}>
  <div className="space-y-4 p-4">{selected?<><QuantityEditor key={`${selected.productId}:${refresh}`} row={selected} event={null} adding onSaved={onSaved} onBusy={setBusy}/>
   <UiButton type="button" variant="secondary" disabled={busy} onClick={()=>{setSelected(null);setRefresh(n=>n+1);}}>إعادة قراءة المنتجات</UiButton></>:<>
   <Search label="بحث عن منتج للعدّ" text={query.text} onChange={query.setText}/>
   {state.loading?<p role="status">جارٍ البحث…</p>:state.error?<p role="alert">تعذرت قراءة المنتجات؛ أعد البحث.</p>:state.rows.length===0?<p role="status">{query.search.trim()?`لا توجد نتيجة لـ"${query.search}"`:'لا توجد منتجات متاحة'}</p>:<ul className="divide-y divide-nw-border">{state.rows.map(row=><li key={row.productId} className="flex min-w-0 items-center gap-2 py-3"><div className="min-w-0 flex-1"><strong className="break-words">{row.name}{row.flavorName?' · '+row.flavorName:''}</strong><p className="break-all text-xs text-nw-muted">{row.sku}</p></div><UiButton type="button" variant="secondary" disabled={row.enabled||query.text!==query.search} onClick={()=>setSelected(row)}>{row.enabled?'بالقائمة':'اختيار'}</UiButton></li>)}</ul>}
  </>}</div>
 </Modal>;
}
function OwnerInventory(){
 const entry=useNavigationDrawer()?.entryIntent,query=useSearch();
 const [filter,setFilter]=useState<InventoryFilter>(entry?.type==='inventory_low'?'low':'all'),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0);
 const [state,setState]=useState<{data:InventoryPage224|null;loading:boolean;error:boolean}>({data:null,loading:true,error:false});
 const [selected,setSelected]=useState<InventoryCounter224|null>(null),[adding,setAdding]=useState(false);
 useEffect(()=>{if(entry?.type==='inventory_low'){setFilter('low');setPage(1);}},[entry]);
 useEffect(()=>{
  let active=true;setState({data:null,loading:true,error:false});
  void fetchInventory224(query.search,filter,page).then(data=>{if(active)setState({data,loading:false,error:false});}).catch(()=>{if(active)setState({data:null,loading:false,error:true});});
  return()=>{active=false;};
 },[query.search,filter,page,refresh]);
 const changeFilter=(value:InventoryFilter)=>{setFilter(value);setPage(1);};
 const saved=()=>{setSelected(null);setAdding(false);setRefresh(n=>n+1);};
 return <div dir="rtl" className="mx-auto min-w-0 max-w-5xl space-y-4 p-3 pb-8 sm:p-5" data-inventory224>
  <PageHeader title="المخزون" actions={<div className="flex flex-wrap gap-2"><UiButton type="button" variant="secondary" disabled={state.loading} onClick={()=>setRefresh(n=>n+1)}>إعادة القراءة</UiButton><UiButton type="button" onClick={()=>setAdding(true)}><Plus className="h-4 w-4"/>إضافة منتج للعدّ</UiButton></div>}/>
  <p className="text-sm text-nw-muted">عدّاد الكمية الاختياري؛ لا تكلفة أو مخزون محاسبي. الأصناف غير المتابَعة تبقى على التوفّر اليدوي.</p>
  <div className="grid grid-cols-3 gap-2">{([{key:'all',count:'tracked',label:'متابَع'},{key:'low',count:'low',label:'قرب يخلص'},{key:'zero',count:'zero',label:'نفد'}] as const).map(card=><UiButton key={card.key} type="button" variant="plain" aria-pressed={filter===card.key} className={`!h-auto min-w-0 flex-col rounded-xl border p-3 ${filter===card.key?'border-nw-primary bg-nw-info-bg':'border-nw-border bg-nw-surface'}`} onClick={()=>changeFilter(card.key)}><span className="text-sm">{card.label}</span><strong className="text-2xl">{state.data?count(state.data.counts[card.count]):'—'}</strong></UiButton>)}</div>
  <Search label="البحث في المخزون" text={query.text} onChange={value=>{query.setText(value);setPage(1);}}/>
  <div className="flex flex-wrap gap-2" aria-label="فلتر المخزون">{(['all','low','zero'] as const).map(value=><UiButton key={value} type="button" variant={filter===value?'primary':'secondary'} aria-pressed={filter===value} onClick={()=>changeFilter(value)}>{labels[value]}</UiButton>)}</div>
  {state.loading?<p role="status">جارٍ قراءة المخزون…</p>:state.error?<div role="alert">تعذرت قراءة المخزون. تحقق من جلسة المالك.<UiButton type="button" onClick={()=>setRefresh(n=>n+1)}>إعادة القراءة</UiButton></div>:state.data&&<>
   {state.data.items.length===0?<div className="space-y-3 rounded-xl border border-nw-border p-5"><p role="status">{query.search?`لا توجد نتيجة لـ"${query.search}"`:'لا توجد أصناف مطابقة لهذا الفلتر.'}</p><UiButton type="button" onClick={()=>setAdding(true)}>إضافة منتج للعدّ</UiButton></div>:<ul className="space-y-2">{state.data.items.map(item=><li key={item.productId}><button type="button" data-counter-id={item.productId} className="flex min-h-24 w-full min-w-0 items-center gap-3 rounded-xl border border-nw-border bg-nw-surface p-3 text-start hover:bg-nw-surface-2 focus-visible:outline-2 focus-visible:outline-nw-primary" disabled={query.text!==query.search} onClick={()=>setSelected(item)}>
    <div className="min-w-0 flex-1 space-y-1"><strong className="block break-words">{item.familyName||item.name}{item.flavorName?' · '+item.flavorName:''}</strong><p className="break-all text-xs text-nw-muted">{item.sku} · الحد {count(item.threshold)}</p><StatusBadge tone={item.status==='zero'?'bad':item.status==='low'?'warn':'ok'}>{stateLabels[item.status]}</StatusBadge></div>
    <div className="max-w-[45%] shrink-0 text-end"><strong className="block break-all text-2xl">{count(item.quantity)}</strong><span className="break-words text-sm">{item.unitName}</span></div><Edit3 className="h-4 w-4 shrink-0" aria-hidden="true"/>
   </button></li>)}</ul>}
   <div className="flex flex-wrap items-center justify-between gap-2"><UiButton type="button" variant="secondary" disabled={page<=1} onClick={()=>setPage(n=>n-1)}>السابق</UiButton><span className="text-sm">صفحة {count(page)} · {count(state.data.total)} صنف</span><UiButton type="button" variant="secondary" disabled={page*20>=state.data.total} onClick={()=>setPage(n=>n+1)}>التالي</UiButton></div>
  </>}
  {selected&&<EditPanel key={selected.productId} item={selected} onClose={()=>setSelected(null)} onSaved={saved}/>}
  {adding&&<AddPanel onClose={()=>setAdding(false)} onSaved={saved}/>}
 </div>;
}
export function Inventory224View(){
 const auth=useAuthStore(),owner=auth.roleName==='owner'||auth.roles.includes('owner');
 if(!auth.isAuthenticated||!auth.user?.id||!owner)return <p role="alert">هذه الشاشة للمالك فقط.</p>;
 return <OwnerInventory key={auth.user.id}/>;
}
