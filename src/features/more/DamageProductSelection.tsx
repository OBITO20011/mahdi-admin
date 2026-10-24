import {ProductPicker} from '../../components/ui/ProductPicker';
import {productPickerOption} from '../../components/ui/productPickerModel';
import {useEffect, useRef, useState} from 'react';
import {searchAdminProducts, fetchAdminProductById} from '../../services/supabase/products.service';
import {useAppStoreActions} from '../../stores/useAppStore';
import {useAuthStore} from '../../stores/useAuthStore';
import {UiButton} from '../../components/ui';
import type {Product} from '../../types';
import {canUseNavigationAction} from './adminNavigation.config';
import {canUseSupplierReplacement} from '../../utils/supplierReplacement';
import {DamageHistoryPanel} from './DamageHistoryPanel';

/** Product is chosen from current server results before entering the existing damage form. */
export function DamageProductSelection() {
  const {roleName,roles,user}=useAuthStore();
  const allowed=canUseNavigationAction({type:'modal',destination:'damage_stock_selection'},roleName,roles);
  const {cacheProductPage,openModal}=useAppStoreActions();
  const [search,setSearch]=useState(''),[products,setProducts]=useState<Product[]>([]);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [reload,setReload]=useState(0);
  const [tab,setTab]=useState<'register'|'history'>('register');
  const canRead=canUseSupplierReplacement(roles,roleName);
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
      cacheProductPage([product]);openModal('supplier_replacement',{productId:product.id,damageOnly:true});
    }catch(cause){if(current===version.current)setError(cause instanceof Error?cause.message:'تعذر تحميل الصنف.');}
    finally{selecting.current=false;if(current===version.current)setBusy(false);}
  };
  if(!allowed)return <p role="alert">لا تملك صلاحية تسجيل بضاعة تالفة.</p>;
  return <div className="space-y-3" aria-busy={busy}>
    <div role="tablist" aria-label="بضاعة تالفة" className="flex flex-wrap gap-2">
      <UiButton role="tab" aria-selected={tab==='register'} disabled={busy} onClick={()=>setTab('register')}>تسجيل تالف</UiButton>
      {canRead&&<UiButton role="tab" aria-selected={tab==='history'} disabled={busy} onClick={()=>setTab('history')}>سجل التالف</UiButton>}
    </div>
    {tab==='history'&&canRead?<DamageHistoryPanel/>:<>
    {error&&<div role="alert"><p className="text-sm text-nw-bad">{error}</p><UiButton disabled={busy} onClick={()=>setReload(value=>value+1)}>إعادة المحاولة</UiButton></div>}
    <ProductPicker label="اختر الصنف التالف" search={search} onSearch={setSearch} disabled={busy} loading={loading}
      options={products.map(product=>productPickerOption(product))} onChoose={id=>void select(id)}/>
    </>}
  </div>;
}
