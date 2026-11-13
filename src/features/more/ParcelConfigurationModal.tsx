import {FormFields,UiButton,formatJod} from '../../components/ui';
import {useEffect, useRef, useState, type FormEvent} from 'react';
import {useAuthStore} from '../../stores/useAuthStore';
import {fetchAdminProductById} from '../../services/supabase/products.service';
import {unsafeLiteParcelPrice,PARCEL_DEFINITION_MESSAGE} from '../../../customer-web/src/utils/saleUnitLabels';
import {filterParcelFamilies} from '../../utils/parcelFamilySearch';
import {fetchParcelConfigurationContext, saveParcelConfiguration, setParcelFeatureState,
  type ParcelConfigurationContext, type ParcelConfigurationInput, type ParcelFeatureState} from '../../services/supabase/parcelConfiguration.service';

const inputClass = 'mt-1 w-full rounded-lg border border-nw-border bg-nw-surface p-2 text-sm';
const labels = {OFF:'متوقفة',OWNER_PILOT:'تجربة المالك فقط',ENABLED:'مفعّلة للجميع'};
const flavorFamilies = (data: ParcelConfigurationContext) => data.products.filter(p =>
  p.isFlavorMaster && p.components.some(c => c.productId !== p.familyProductId)
  && p.configuration?.composition_mode!=='single_sku');
export function ParcelConfigurationModal({initialFamilyProductId,operatingMode='full',modeVerified=true}:{initialFamilyProductId?:string;operatingMode?:'full'|'sales-only';modeVerified?:boolean}) {
  const {roleName:role} = useAuthStore();
  const salesOnly=operatingMode==='sales-only';
  const authorization=useRef({role,operatingMode,modeVerified});
  authorization.current={role,operatingMode,modeVerified};
  const [context,setContext] = useState<ParcelConfigurationContext | null>(null);
  const [form,setForm] = useState<ParcelConfigurationInput | null>(null);
  const [nextState,setNextState] = useState<ParcelFeatureState>('OFF');
  const [confirm,setConfirm] = useState(false);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [error,setError] = useState('');
  const [uncertain,setUncertain] = useState(false);
  const [familySearch,setFamilySearch] = useState('');
  const select = (data: ParcelConfigurationContext, id: string) => {
    const candidates = flavorFamilies(data);
    const p = candidates.find(product => product.familyProductId === id) ?? candidates[0];
    setForm(p ? {familyProductId:p.familyProductId,mode:'configurable_mix',
      active:p.configuration?.is_active ?? false, units:p.unitsPerParcel,
      allowed:p.configuration ? [...p.allowedProductIds] : p.isFlavorMaster ? [] : [id]} : null);
  };
  useEffect(() => {
    if (role !== 'owner') return;
    let active = true;
    void fetchParcelConfigurationContext().then(data => {if (active) {setContext(data);setNextState(data.featureState);select(data,initialFamilyProductId ?? data.products[0]?.familyProductId ?? '');}})
      .catch(reason => {if (active) setError(reason instanceof Error ? reason.message : 'تعذر تحميل الإعداد.');});
    return () => {active=false;};
  },[role,initialFamilyProductId]);
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
    try {
      if(!modeVerified)throw new Error('أعد قراءة وضع التشغيل قبل حفظ إعداد الطرد.');
      if(salesOnly){
        const fresh=await fetchAdminProductById(form.familyProductId);
        if(!fresh||authorization.current.role!=='owner'||!authorization.current.modeVerified||authorization.current.operatingMode!==operatingMode)throw new Error('تعذر التحقق من وضع التشغيل وتعريف المنتج؛ أعد التحميل.');
        if(form.units!==fresh.unitsPerSalePackage)throw new Error('عدّل عدد الطرد من نموذج المنتج أولاً، ثم أعد تحميل إعداد النكهات.');
        const sameUnit=fresh.baseUnitId===fresh.saleUnitId||fresh.unit?.trim()===fresh.salePackage?.trim();
        if(form.active&&form.units>1&&(sameUnit||unsafeLiteParcelPrice(true,form.units,fresh.salePackagePrice,fresh.retailPrice)))throw new Error(PARCEL_DEFINITION_MESSAGE);
      }
      await saveParcelConfiguration(form,p);const data=await fetchParcelConfigurationContext();setContext(data);select(data,form.familyProductId);setMessage('تم حفظ إعداد الطرد.');}
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
  const disableLegacy = async (product:ParcelConfigurationContext['products'][number]) => {
    if(busy||uncertain||product.configuration?.composition_mode!=='single_sku'||!product.configuration.is_active)return;
    setBusy(true);setError('');setMessage('');
    try{
      await saveParcelConfiguration({familyProductId:product.familyProductId,mode:'single_sku',active:false,
        units:product.unitsPerParcel,allowed:[...product.allowedProductIds]},product);
      const data=await fetchParcelConfigurationContext();setContext(data);select(data,form?.familyProductId??'');setMessage('تم إيقاف الإعداد القديم؛ بيانات المبيعات السابقة محفوظة.');
    }catch(reason){setUncertain(true);setError(reason instanceof Error?reason.message:'تعذر تأكيد الإيقاف؛ أعد تحميل الإعداد.');}
    finally{setBusy(false);}
  };
  if (role !== 'owner') return <p role="alert">إعداد الطرود متاح للمالك فقط.</p>;
  const product=context?.products.find(p=>p.familyProductId===form?.familyProductId);
  const visibleFamilies=filterParcelFamilies(context?flavorFamilies(context):[],familySearch);
  const missingCandidates=(context ? flavorFamilies(context) : []).flatMap(p=>p.configuration?.is_active
    ? p.components.filter(c=>p.allowedProductIds.includes(c.productId) && c.packetPriceInMinorUnits===0) : []);
  const missingPacketPrices=missingCandidates.filter((c,index)=>missingCandidates.findIndex(other=>other.productId===c.productId)===index);
  return <FormFields dir="rtl" aria-busy={busy} className="nw-products-fields min-w-0 space-y-4 text-nw-text">
    <p className="text-sm">هنا تجهّز طرداً مشكّلاً من نكهات المنتج. الطرد العادي يُضبط من نموذج المنتج ولا يحتاج هذه الشاشة.</p>
    {missingPacketPrices.length>0 && <aside role="status" className="rounded-lg border border-nw-border p-3 text-nw-warn">
      <p>عبّي سعر الباكيت؛ بدونه لا يُحسب خصم ضرر العميل</p>
      <ul>{missingPacketPrices.map(c=><li key={c.productId}>{c.nameAr} — {c.sku}</li>)}</ul>
    </aside>}
    {error && <p role="alert" className="text-nw-bad">{error}</p>}
    {message && <p role="status" className="text-nw-ok">{message}</p>}
    <UiButton variant="plain" type="button" disabled={busy} onClick={()=>void reload()} className="rounded-lg border p-2">إعادة تحميل الإعداد</UiButton>
    {!context ? <p>جارٍ تحميل إعداد الطرود...</p> : <>
      <details><summary className="min-h-11 cursor-pointer font-bold">متقدم: حالة الطرد المشكّل</summary>
      <fieldset disabled={busy || uncertain || !modeVerified} className="space-y-3 rounded-xl border border-nw-border p-3">
        <legend>حالة الطرد المشكّل — {labels[context.featureState]}</legend>
        <label>حالة الميزة<select aria-label="حالة الميزة" className={inputClass} value={nextState} onChange={e=>{setNextState(e.target.value as ParcelFeatureState);setConfirm(false);}}>
          {Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select></label>
        {nextState!==context.featureState && <><p>التغيير يؤثر على عمليات البيع الجديدة. إيقاف الميزة لا يلغي الطلبات السابقة.</p>
          <label className="flex gap-2"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>أؤكد تغيير الحالة إلى {labels[nextState]}</label>
          <UiButton variant="primary" type="button" disabled={!confirm} onClick={()=>void changeState()} className="rounded-lg p-2">تأكيد تغيير حالة الميزة</UiButton></>}
      </fieldset></details>
      {!flavorFamilies(context).length ? <p>لا توجد منتجات لها نكهات بعد. أضف النكهات من نموذج المنتج، ثم جهّز الطرد المشكّل هنا.</p> : <form onSubmit={event=>void save(event)} aria-busy={busy} className="space-y-3">
        <fieldset disabled={busy || uncertain || !modeVerified} className="space-y-3">
          <label>بحث العائلات<input type="search" className={inputClass} value={familySearch} placeholder="جزء من الاسم أو رمز الصنف" onChange={e=>setFamilySearch(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')e.preventDefault();}}/></label>
          <label>الصنف / العائلة<select className={inputClass} value={visibleFamilies.some(p=>p.familyProductId===form?.familyProductId)?form?.familyProductId:''} onChange={e=>{if(e.target.value)select(context,e.target.value);}}>
            {!visibleFamilies.some(p=>p.familyProductId===form?.familyProductId)&&<option value="" disabled>{visibleFamilies.length?'اختر العائلة من النتائج':'لا توجد عائلة مطابقة'}</option>}
            {visibleFamilies.map(p=><option key={p.familyProductId} value={p.familyProductId}>{p.nameAr} — {p.sku}</option>)}
          </select></label>
          {familySearch&&<p className="text-sm text-nw-muted" role="status">{visibleFamilies.length} نتيجة — العائلة المحددة: {product?.nameAr} — {product?.sku}</p>}
          {form && product && <>
            <label>كم حبة بالطرد<input readOnly={salesOnly} inputMode="numeric" enterKeyHint="next" className={inputClass} required type="number" min="1" step="1" value={form.units} onChange={e=>setForm({...form,units:Number(e.target.value)})}/></label>
            {salesOnly&&<p className="text-sm text-nw-muted">عدد الطرد ووحدته وسعره تُضبط من نموذج المنتج أولاً؛ هذه الشاشة تختار النكهات فقط. بعد تعديل المنتج أعد تحميل الإعداد.</p>}
            {salesOnly&&<p className="text-sm text-nw-muted">لطرد نكهات حقيقي اختر وحدة بيع مختلفة عن وحدة المحتوى. للحفاظ على سعر الوحدة راجع أن سعر الطرد يساوي العدد × سعر الوحدة؛ الحفظ هنا لا يحوّل الأسعار تلقائياً.</p>}
              <div><label className="flex gap-2"><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/>الطرد المشكّل مفعّل للبيع</label>
                <p className="mt-1 text-sm text-nw-muted">أزل الإشارة لإيقافه مؤقتاً؛ يبقى الإعداد محفوظاً.</p></div>
            {form.mode==='configurable_mix' && <fieldset className="space-y-2"><legend>النكهات المسموحة</legend>
              {product.components.filter(p=>p.productId!==product.familyProductId).map(component=><label className="flex gap-2" key={component.productId}>
                <input type="checkbox" checked={form.allowed.includes(component.productId)} onChange={e=>setForm({...form,allowed:e.target.checked?[...form.allowed,component.productId]:form.allowed.filter(id=>id!==component.productId)})}/>
                {component.flavorNameAr || component.nameAr}
              </label>)}
            </fieldset>}
            <p className="text-sm">سعر الطرد: {formatJod(product.parcelPriceInMinorUnits/1000)} — يُعدّل من شاشة المنتج. نسخة الإعداد: {product.configuration?.configuration_revision ?? 'جديد'}.</p>
            <UiButton variant="primary" type="submit" className="rounded-lg p-3">{busy?'جارٍ الحفظ...':'حفظ إعداد الطرد'}</UiButton>
          </>}
        </fieldset>
      </form>}
      {context.products.some(p=>p.configuration?.composition_mode==='single_sku')&&<section aria-label="إعدادات الطرد القديمة" className="space-y-3 rounded-xl border border-nw-border p-3">
        <h3 className="font-bold">إعدادات قديمة للقراءة فقط</h3>
        <p className="text-sm text-nw-muted">الطرد العادي يُضبط من نموذج المنتج. تبقى هذه الإعدادات ومبيعاتها السابقة محفوظة؛ يمكنك إيقاف البيع الجديد بها.</p>
        {context.products.filter(p=>p.configuration?.composition_mode==='single_sku').map(p=><article key={p.familyProductId} className="space-y-2 border-t border-nw-border pt-3">
          <h4 className="font-bold">{p.nameAr}</h4><p>كم حبة بالطرد: {p.unitsPerParcel} · {p.configuration?.is_active?'متاح للبيع':'متوقف'}</p>
          {p.configuration?.is_active&&<UiButton type="button" disabled={busy||uncertain} onClick={()=>void disableLegacy(p)}>إيقاف الإعداد القديم — {p.nameAr}</UiButton>}
        </article>)}
      </section>}
    </>}
  </FormFields>;
}
