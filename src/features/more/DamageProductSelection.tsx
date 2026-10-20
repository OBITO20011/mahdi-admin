import {useEffect, useRef, useState} from 'react';
import {searchAdminProducts, fetchAdminProductById} from '../../services/supabase/products.service';
import {useAppStoreActions} from '../../stores/useAppStore';
import {useAuthStore} from '../../stores/useAuthStore';
import {SearchField, UiButton} from '../../components/ui';
import type {Product} from '../../types';
import {canUseNavigationAction} from './adminNavigation.config';

/** Product is chosen from current server results before entering the existing damage form. */
export function DamageProductSelection() {
  const {roleName,roles,user}=useAuthStore();
  const allowed=canUseNavigationAction({type:'modal',destination:'damage_stock_selection'},roleName,roles);
  const {cacheProductPage,openModal}=useAppStoreActions();
  const [search,setSearch]=useState(''),[products,setProducts]=useState<Product[]>([]);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [reload,setReload]=useState(0);
  const version=useRef(0),selecting=useRef(false);
  useEffect(()=>{
    const current=++version.current;setProducts([]);setError('');setLoading(true);setBusy(false);selecting.current=false;
    if(!allowed){setLoading(false);return;}
    const timer=window.setTimeout(()=>{void searchAdminProducts({search,limit:20,purpose:'stockable'})
      .then(rows=>{if(current===version.current)setProducts(rows);})
      .catch(()=>{if(current===version.current)setError('تعذر البحث في الأصناف.');})
      .finally(()=>{if(current===version.current)setLoading(false);});},search.trim()?250:0);
    return()=>{window.clearTimeout(timer);version.current=current+1;};
  },[search,reload,allowed,user?.id]);
  const select=async(productId:string)=>{
    if(selecting.current||!allowed)return;selecting.current=true;setBusy(true);setError('');const current=version.current;
    try{const product=await fetchAdminProductById(productId,'stockable');if(current!==version.current)return;if(!product)throw new Error('الصنف لم يعد متاحاً.');
      cacheProductPage([product]);openModal('adjust_stock',{product,mode:'deduct'});
    }catch(cause){if(current===version.current)setError(cause instanceof Error?cause.message:'تعذر تحميل الصنف.');}
    finally{selecting.current=false;if(current===version.current)setBusy(false);}
  };
  if(!allowed)return <p role="alert">لا تملك صلاحية تسجيل بضاعة تالفة.</p>;
  return <div className="space-y-3" aria-busy={busy}>
    <SearchField label="ابحث عن الصنف التالف" placeholder="اسم الصنف أو الباركود" value={search} disabled={busy} onChange={event=>setSearch(event.target.value)}/>
    {error&&<div role="alert"><p className="text-sm text-nw-bad">{error}</p><UiButton disabled={busy} onClick={()=>setReload(value=>value+1)}>إعادة المحاولة</UiButton></div>}
    {loading?<p role="status">جاري البحث…</p>:products.length===0&&!error?<p role="status" className="text-sm text-nw-muted">لا توجد أصناف مطابقة.</p>:<ul className="m-0 space-y-2 p-0">
      {products.map(product=><li key={product.id} className="list-none"><UiButton variant="plain" disabled={busy} onClick={()=>void select(product.id)} className="!h-auto flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-nw-border px-3 py-2 text-right">
        <span className="min-w-0"><b className="block break-words text-sm">{product.nameAr}</b><span className="text-xs text-nw-muted">{product.sku} · المتاح {product.availableQuantity} {product.unit}</span></span>
      </UiButton></li>)}
    </ul>}
  </div>;
}
