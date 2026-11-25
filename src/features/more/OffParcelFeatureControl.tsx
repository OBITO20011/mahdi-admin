import type {ReactNode} from 'react';
import {UiButton} from '../../components/ui';
import type {ParcelFeatureState} from '../../services/supabase/parcelConfiguration.service';

export function OffParcelFeatureControl({featureState,nextState,disabled,onToggle,children}:{
  featureState:ParcelFeatureState;nextState:ParcelFeatureState;disabled:boolean;
  onToggle:()=>void;children:ReactNode;
}){
  return <fieldset id="parcel-global-state" disabled={disabled} className="space-y-3 rounded-xl border border-nw-border bg-nw-surface-2 p-3">
    <legend className="px-1 font-bold">حالة الطرد المشكّل العامة</legend>
    <UiButton type="button" role="switch" aria-checked={nextState==='ENABLED'}
      aria-label="تشغيل الطرد المشكّل" variant={nextState==='ENABLED'?'primary':'secondary'} onClick={onToggle}>
      الطرد المشكّل: {nextState==='ENABLED'?'شغّال':'موقوف'}
    </UiButton>
    {featureState!=='ENABLED'&&<aside role="status" className="rounded-lg border border-nw-warn bg-nw-warn-bg p-3 text-sm font-bold text-nw-warn">
      {featureState==='OWNER_PILOT'&&<p>موقوف للزبائن (تجربة المالك)</p>}
      <p>لن يرى الزبائن أو الكاشير أي طرد مشكّل</p>
    </aside>}
    {children}
  </fieldset>;
}
