import {useEffect,useState} from 'react';
import {Card,MoneyText,UiButton} from '../../components/ui';
import {useAuthStore} from '../../stores/useAuthStore';
import {useAppStoreActions,useAppStoreSelector} from '../../stores/useAppStore';
import {fetchSupplierReplacementPage} from '../../services/supabase/supplierReplacement.service';
import {canUseSupplierReplacement,replacementMoney,type SupplierReplacementPage} from '../../utils/supplierReplacement';
import {SupplierReplacementQuantities} from './SupplierReplacementQuantities';
/** This is an in-kind asset, kept outside available/opening stock and cash debt. */
export function SupplierReplacementSummary({ownerOnly=false}:{ownerOnly?:boolean}) {
  const {user,roles,roleName}=useAuthStore(),owner=roles.includes('owner')||roleName==='owner';
  const allowed=canUseSupplierReplacement(roles,roleName)&&(!ownerOnly||owner);
  const roleKey=roles.join(',');
  const revision=useAppStoreSelector(s=>s.productDataRevision),{openModal}=useAppStoreActions();
  const [data,setData]=useState<SupplierReplacementPage|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    let active=true;setData(null);setError('');
    if(allowed)void fetchSupplierReplacementPage().then(value=>{if(active){if(owner&&value.pendingValueInMinorUnitsExact===undefined)throw new Error('قيمة المعلّق غير متاحة في القراءة.');if(value.pendingValueInMinorUnitsExact!==undefined)replacementMoney(value.pendingValueInMinorUnitsExact);setData(value);}}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'تعذر قراءة المعلّق.');});
    return()=>{active=false;};
  },[allowed,owner,user?.id,roleKey,revision,retry]);
  if(!allowed)return null;
  return <Card data-testid="supplier-replacement-summary" className="space-y-2">
    <p className="m-0 text-sm font-bold">بضاعة لدى المورد بانتظار الاستبدال</p>
    {error?<p role="alert" className="text-sm text-nw-bad">{error} <UiButton onClick={()=>setRetry(n=>n+1)}>إعادة المحاولة</UiButton></p>
      :data?<><SupplierReplacementQuantities data={data}/>{owner&&data.pendingValueInMinorUnitsExact!==undefined&&<p className="text-sm">القيمة الإجمالية للمعلّق: <MoneyText amount={replacementMoney(data.pendingValueInMinorUnitsExact)} currency /></p>}</>
      :<p role="status" className="text-sm text-nw-muted">جاري قراءة المعلّق…</p>}
    <p className="text-xs text-nw-muted">خارج المخزون المتاح. لا تضفه مرة أخرى إلى الرصيد الافتتاحي، ولا يُعد ديناً نقدياً على المورد.</p>
    <UiButton onClick={()=>openModal('supplier_replacement')}>عرض المعلّق والاستبدال</UiButton>
  </Card>;
}
