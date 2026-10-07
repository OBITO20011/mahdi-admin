import {useEffect, useState, type FormEvent} from 'react';
import {useAuthStore} from '../../stores/useAuthStore';
import {fetchParcelConfigurationContext, saveParcelConfiguration, setParcelFeatureState,
  type ParcelConfigurationContext, type ParcelConfigurationInput, type ParcelFeatureState} from '../../services/supabase/parcelConfiguration.service';

const inputClass = 'mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm';
const labels = {OFF:'متوقفة',OWNER_PILOT:'تجربة المالك فقط',ENABLED:'مفعّلة للجميع'};
export function ParcelConfigurationModal() {
  const {roleName:role} = useAuthStore();
  const [context,setContext] = useState<ParcelConfigurationContext | null>(null);
  const [form,setForm] = useState<ParcelConfigurationInput | null>(null);
  const [nextState,setNextState] = useState<ParcelFeatureState>('OFF');
  const [confirm,setConfirm] = useState(false);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [error,setError] = useState('');
  const [uncertain,setUncertain] = useState(false);
  const select = (data: ParcelConfigurationContext, id: string) => {
    const p = data.products.find(product => product.familyProductId === id);
    setForm(p ? {familyProductId:id,mode:p.configuration?.composition_mode ?? (p.isFlavorMaster?'configurable_mix':'single_sku'),
      active:p.configuration?.is_active ?? false, units:p.unitsPerParcel,
      allowed:p.configuration ? [...p.allowedProductIds] : p.isFlavorMaster ? [] : [id]} : null);
  };
  useEffect(() => {
    if (role !== 'owner') return;
    let active = true;
    void fetchParcelConfigurationContext().then(data => {if (active) {setContext(data);setNextState(data.featureState);select(data,data.products[0]?.familyProductId ?? '');}})
      .catch(reason => {if (active) setError(reason instanceof Error ? reason.message : 'تعذر تحميل الإعداد.');});
    return () => {active=false;};
  },[role]);
  const reload = async () => {
    setBusy(true);setError('');
    try {const data=await fetchParcelConfigurationContext();setContext(data);setNextState(data.featureState);
      select(data,form?.familyProductId ?? data.products[0]?.familyProductId ?? '');setUncertain(false);setConfirm(false);}
    catch (reason) {setError(reason instanceof Error ? reason.message : 'تعذر تحميل الإعداد.');}
    finally {setBusy(false);}
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();if (!context || !form || busy || uncertain) return;
    const p=context.products.find(product=>product.familyProductId===form.familyProductId);if (!p) return;
    setBusy(true);setError('');setMessage('');
    try {await saveParcelConfiguration(form,p);const data=await fetchParcelConfigurationContext();setContext(data);select(data,form.familyProductId);setMessage('تم حفظ إعداد الطرد.');}
    catch (reason) {setUncertain(true);setError(reason instanceof Error ? reason.message : 'تعذر تأكيد الحفظ؛ أعد تحميل الإعداد.');}
    finally {setBusy(false);}
  };
  const changeState = async () => {
    if (!confirm || !context || busy || uncertain || nextState===context.featureState) return;
    setBusy(true);setError('');setMessage('');
    try {await setParcelFeatureState(nextState);const data=await fetchParcelConfigurationContext();setContext(data);setNextState(data.featureState);setConfirm(false);setMessage('تم تغيير حالة الميزة.');}
    catch (reason) {setUncertain(true);setError(reason instanceof Error ? reason.message : 'تعذر تأكيد تغيير الحالة؛ أعد التحميل.');}
    finally {setBusy(false);}
  };
  if (role !== 'owner') return <p role="alert">إعداد الطرود متاح للمالك فقط.</p>;
  const product=context?.products.find(p=>p.familyProductId===form?.familyProductId);
  const missingCandidates=context?.products.flatMap(p=>p.configuration?.is_active
    ? p.components.filter(c=>p.allowedProductIds.includes(c.productId) && c.packetPriceInMinorUnits===0) : []) ?? [];
  const missingPacketPrices=missingCandidates.filter((c,index)=>missingCandidates.findIndex(other=>other.productId===c.productId)===index);
  return <div dir="rtl" aria-busy={busy} className="space-y-4 text-slate-200">
    <p className="text-xs">إعدادات البيع الجديدة للمتجر والكاشير. لا تغيّر الطرود أو الأسعار التاريخية.</p>
    {missingPacketPrices.length>0 && <aside role="status" className="rounded-lg border border-amber-500/40 p-3 text-amber-200">
      <p>عبّي سعر الباكيت؛ بدونه لا يُحسب خصم ضرر العميل</p>
      <ul>{missingPacketPrices.map(c=><li key={c.productId}>{c.nameAr} — {c.sku}</li>)}</ul>
    </aside>}
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {message && <p role="status" className="text-emerald-300">{message}</p>}
    <button type="button" disabled={busy} onClick={()=>void reload()} className="rounded-lg border p-2">إعادة تحميل الإعداد</button>
    {!context ? <p>جارٍ تحميل إعداد الطرود...</p> : <>
      <fieldset disabled={busy || uncertain} className="space-y-3 rounded-xl border border-slate-700 p-3">
        <legend>حالة الطرود المرنة — {labels[context.featureState]}</legend>
        <label>حالة الميزة<select aria-label="حالة الميزة" className={inputClass} value={nextState} onChange={e=>{setNextState(e.target.value as ParcelFeatureState);setConfirm(false);}}>
          {Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select></label>
        {nextState!==context.featureState && <><p>التغيير يؤثر على عمليات البيع الجديدة. إيقاف الميزة لا يلغي الطلبات السابقة.</p>
          <label className="flex gap-2"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>أؤكد تغيير الحالة إلى {labels[nextState]}</label>
          <button type="button" disabled={!confirm} onClick={()=>void changeState()} className="rounded-lg bg-amber-700 p-2">تأكيد تغيير حالة الميزة</button></>}
      </fieldset>
      {!context.products.length ? <p>لا توجد أصناف مؤهلة؛ عرّف وحدة بيع للمنتج أولاً.</p> : <form onSubmit={event=>void save(event)} aria-busy={busy} className="space-y-3">
        <fieldset disabled={busy || uncertain} className="space-y-3">
          <label>الصنف / العائلة<select className={inputClass} value={form?.familyProductId ?? ''} onChange={e=>select(context,e.target.value)}>
            {context.products.map(p=><option key={p.familyProductId} value={p.familyProductId}>{p.nameAr} — {p.sku}</option>)}
          </select></label>
          {form && product && <>
            <label>نمط الطرد<select className={inputClass} value={form.mode} onChange={e=>{const mode=e.target.value as ParcelConfigurationInput['mode'];setForm({...form,mode,allowed:mode==='single_sku'?[form.familyProductId]:[]});}}>
              <option value="single_sku">صنف واحد</option>{product.isFlavorMaster && <option value="configurable_mix">نكهات مختارة</option>}
            </select></label>
            <label>عدد القطع في الطرد<input className={inputClass} required type="number" min="1" step="1" value={form.units} onChange={e=>setForm({...form,units:Number(e.target.value)})}/></label>
            <label className="flex gap-2"><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/>متاح للبيع كطرد</label>
            {form.mode==='configurable_mix' && <fieldset className="space-y-2"><legend>النكهات المسموحة</legend>
              {product.components.filter(p=>p.productId!==product.familyProductId).map(component=><label className="flex gap-2" key={component.productId}>
                <input type="checkbox" checked={form.allowed.includes(component.productId)} onChange={e=>setForm({...form,allowed:e.target.checked?[...form.allowed,component.productId]:form.allowed.filter(id=>id!==component.productId)})}/>
                {component.flavorNameAr || component.nameAr}
              </label>)}
            </fieldset>}
            <p className="text-xs">سعر الطرد: {(product.parcelPriceInMinorUnits/1000).toFixed(3)} د.أ — يُعدّل من شاشة المنتج. نسخة الإعداد: {product.configuration?.configuration_revision ?? 'جديد'}.</p>
            <button type="submit" className="rounded-lg bg-blue-600 p-3">{busy?'جارٍ الحفظ...':'حفظ إعداد الطرد'}</button>
          </>}
        </fieldset>
      </form>}
    </>}
  </div>;
}
