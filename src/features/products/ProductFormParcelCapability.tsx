import {useEffect,useState} from 'react';
import {UiButton} from '../../components/ui';
import {useAuthStore} from '../../stores/useAuthStore';
import {fetchParcelConfigurationContext,type ParcelConfigurationContext} from '../../services/supabase/parcelConfiguration.service';

/** Configuration has its own owner RPC and uncertain-save contract. Show its
 * real state and direct destination instead of a second, non-atomic save. */
export function ProductFormParcelCapability({familyId,dirty,busy,onOpen}:{
  familyId?:string;dirty:boolean;busy:boolean;onOpen:(familyId:string)=>void;
}) {
  const {roleName}=useAuthStore();
  const [context,setContext]=useState<ParcelConfigurationContext|null>(null);
  const [error,setError]=useState('');
  const [version,setVersion]=useState(0);
  useEffect(()=>{
    if(roleName!=='owner'||!familyId)return;
    let current=true;
    setContext(null);setError('');
    void fetchParcelConfigurationContext().then(value=>{if(current)setContext(value);})
      .catch(reason=>{if(current)setError(reason instanceof Error?reason.message:'تعذر قراءة إعداد الطرد المشكّل.');});
    return()=>{current=false;};
  },[roleName,familyId,version]);
  if(!familyId)return <p className="text-xs text-nw-muted">احفظ المنتج ونكهاته أولاً، ثم اضبط السماح بالطرد المشكّل.</p>;
  if(roleName!=='owner')return <p className="text-xs text-nw-muted">السماح بالطرد المشكّل وإعداده للمالك فقط.</p>;
  const product=context?.products.find(row=>row.familyProductId===familyId);
  const allowed=product?.configuration?.composition_mode==='configurable_mix'&&product.configuration.is_active;
  return <div className="space-y-2 rounded-lg border border-nw-border p-3 text-sm" aria-busy={!context&&!error}>
    {error?<><p role="alert">تعذر قراءة حالة الطرد المشكّل: {error}</p><UiButton type="button" variant="plain" onClick={()=>setVersion(value=>value+1)}>إعادة القراءة</UiButton></>
      :!context?<p role="status">جارٍ قراءة حالة الطرد المشكّل…</p>
      :!product?<p role="alert">لم يعد المنتج ضمن عائلات الطرد المشكّل؛ حدّث بيانات المنتج.</p>
      :<><label className="flex min-h-11 items-center gap-2 font-bold"><input type="checkbox" checked={allowed} disabled readOnly/>مسموح طرد مشكّل بالنكهات</label>
        <p className="text-xs text-nw-muted">{allowed?'مسموح لهذا المنتج':'غير مسموح لهذا المنتج حالياً'}{context.featureState==='OFF'?'؛ الميزة العامة موقوفة حالياً.':context.featureState==='OWNER_PILOT'?'؛ متاحة حالياً لتجربة المالك فقط.':'.'}</p></>}
    <UiButton type="button" variant="plain" disabled={dirty||busy} onClick={()=>onOpen(familyId)}>فتح إعداد الطرد المشكّل لهذا المنتج</UiButton>
    {dirty&&<p className="text-xs text-nw-muted">احفظ تعديلات المنتج أولاً حتى لا تفقدها عند فتح الإعداد.</p>}
  </div>;
}
