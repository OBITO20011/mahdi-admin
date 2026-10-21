import {useCallback,useEffect,useRef,useState} from 'react';
import {Card,FormFields,MoneyText,SearchField,UiButton,formatUiDate} from '../../components/ui';
import {WarehouseChoice} from '../../components/ui/WarehouseChoice';
import {useAuthStore} from '../../stores/useAuthStore';
import {useAppStoreActions} from '../../stores/useAppStore';
import {fetchSupplierReplacementOptions,fetchSupplierReplacementPage,fetchSupplierReplacementPreview,submitSupplierReplacement,supplierReplacementRecovery,type ReplacementOptions} from '../../services/supabase/supplierReplacement.service';
import type {ReplacementAttempt} from '../../services/supabase/supplierReplacementIntent';
import {canUseSupplierReplacement,replacementMoney,type SupplierReplacementAction,type SupplierReplacementCase,type SupplierReplacementPage,type SupplierReplacementPayload} from '../../utils/supplierReplacement';

const eventLabels:Record<string,string>={send:'إرسال للمورد',immediate:'استبدال فوري',receive:'استلام البديل',writeoff:'رفض المورد',damage:'تلف نهائي',reverse:'عكس حدث'};
export interface SupplierReplacementPanelProps {productId?:string;supplierId?:string;damageOnly?:boolean}
export function SupplierReplacementPanel({productId:initialProductId,supplierId:initialSupplierId,damageOnly=false}:SupplierReplacementPanelProps) {
  const {user,roles,roleName}=useAuthStore(),owner=roles.includes('owner')||roleName==='owner';
  const supplierAllowed=canUseSupplierReplacement(roles,roleName),damageAllowed=supplierAllowed||roles.includes('admin')||roleName==='admin';
  const roleKey=roles.join(',');
  const {setToast,refreshProductsFromSupabase,refreshInventoryMovementsFromSupabase}=useAppStoreActions();
  const [tab,setTab]=useState<'new'|'pending'|'history'>('new'),[action,setAction]=useState<SupplierReplacementAction>(damageOnly||!supplierAllowed?'shop_damage':'shop_pending');
  const [productId,setProductId]=useState(initialProductId??''),[supplierId,setSupplierId]=useState(initialSupplierId??''),[warehouseId,setWarehouseId]=useState('');
  const [productSearch,setProductSearch]=useState(''),[supplierSearch,setSupplierSearch]=useState(''),[quantity,setQuantity]=useState('1'),[unit,setUnit]=useState('base');
  const [reason,setReason]=useState(''),[reasonCode,setReasonCode]=useState('shop_breakage');
  const [options,setOptions]=useState<ReplacementOptions|null>(null),[page,setPage]=useState<SupplierReplacementPage|null>(null),[pageNo,setPageNo]=useState(1);
  const [error,setError]=useState(''),[optionsError,setOptionsError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
  const [attempt,setAttempt]=useState<ReplacementAttempt|null>(null),[recoveryReady,setRecoveryReady]=useState(false);
  const [draft,setDraft]=useState<{action:SupplierReplacementAction;payload:SupplierReplacementPayload;label:string}|null>(null),[preview,setPreview]=useState<Record<string,unknown>|null>(null);
  const scope='supplier-replacement208:panel',working=useRef(false),version=useRef(0);
  const unresolved=attempt?.status==='prepared'||attempt?.status==='unknown';
  useEffect(()=>{const generation=++version.current;setAttempt(null);setRecoveryReady(false);setPreview(null);setDraft(null);setBusy(false);let active=true;
    void supplierReplacementRecovery(scope).then(value=>{if(active){setAttempt(value);setRecoveryReady(true);}}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'تعذر استعادة المحاولة.');});
    return()=>{active=false;version.current=generation+1;};
  },[user?.id,roleKey,roleName]);
  useEffect(()=>{let active=true;setOptions(null);setOptionsError('');
    if(!damageAllowed)return;
    const timer=setTimeout(()=>{void fetchSupplierReplacementOptions(action==='shop_damage'?'shop_damage':'shop_pending',productSearch,supplierSearch,initialProductId)
      .then(value=>{if(active){setOptions(value);if(value.warehouses.length===1)setWarehouseId(value.warehouses[0].id);}})
      .catch(cause=>{if(active)setOptionsError(cause instanceof Error?cause.message:'تعذر تحميل الخيارات.');});},productSearch||supplierSearch?250:0);
    return()=>{active=false;clearTimeout(timer);};
  },[action,productSearch,supplierSearch,initialProductId,user?.id,damageAllowed,revision]);
  const loadPage=useCallback(async()=>{
    setPage(null);if(!supplierAllowed)return;
    const value=await fetchSupplierReplacementPage(initialSupplierId,tab==='history'?'all':'pending',pageNo);
    if(value.pendingValueInMinorUnitsExact!==undefined)replacementMoney(value.pendingValueInMinorUnitsExact);
    setPage(value);
  },[supplierAllowed,initialSupplierId,tab,pageNo]);
  useEffect(()=>{let active=true;setPage(null);if(tab==='new'||!supplierAllowed)return;
    void fetchSupplierReplacementPage(initialSupplierId,tab==='history'?'all':'pending',pageNo).then(v=>{if(active)setPage(v);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'تعذر تحميل السجل.');});
    return()=>{active=false;};
  },[tab,pageNo,supplierAllowed,initialSupplierId,user?.id,roleKey,revision]);
  if(!damageAllowed)return <p role="alert">لا تملك صلاحية الاستبدال أو تسجيل التلف.</p>;
  const product=options?.products.find(p=>p.id===productId);
  const chooseProduct=(id:string)=>{setProductId(id);const last=options?.lastSuppliers.find(v=>v.productId===id);if(!initialSupplierId&&last?.supplierId&&options?.suppliers.some(s=>s.id===last.supplierId))setSupplierId(last.supplierId);};
  const formPayload=():SupplierReplacementPayload=>{
    const amount=Number(quantity),damageReason=({shop_breakage:'انكسر بالمحل',expired:'انتهت الصلاحية',storage_damage:'تلف تخزين',other:''} as Record<string,string>)[reasonCode];
    const finalReason=reason.trim()||(action==='shop_damage'?damageReason:'');
    if(!Number.isSafeInteger(amount)||amount<1||!productId||!warehouseId||finalReason.length<3)throw new Error('اختر الصنف وأكمل الكمية والمستودع والسبب؛ تحتاج «أخرى» إلى ملاحظة.');
    if(action!=='shop_damage'&&!supplierId)throw new Error('اختر المورد.');
    return {productId,warehouseId,quantity:amount,unit,reason:finalReason,...(action==='shop_damage'?{reasonCode}:{supplierId})};
  };
  const inspect=async(next?:typeof draft)=>{
    if(working.current||unresolved||!recoveryReady)return;working.current=true;setBusy(true);setError('');const current=version.current;
    try{const candidate=next??{action,payload:formPayload(),label:action==='shop_damage'?'تسجيل تلف نهائي':action==='shop_immediate'?'استبدال فوري':'إرسال بانتظار الاستبدال'};
      const value=await fetchSupplierReplacementPreview(candidate.action,candidate.payload);if(current===version.current){setDraft(candidate);setPreview(value);}}
    catch(cause){if(current===version.current){setPreview(null);setDraft(null);setError(cause instanceof Error?cause.message:'تعذر تحميل المعاينة.');}}
    finally{working.current=false;if(current===version.current)setBusy(false);}
  };
  const execute=async(recover=false)=>{
    if(working.current||!recoveryReady||(!recover&&(!draft||preview?.eligible!==true)))return;working.current=true;setBusy(true);setError('');const current=version.current;
    try{await submitSupplierReplacement(scope,recover?undefined:{action:draft!.action,payload:draft!.payload,expectedNonce:attempt?.nonce??null});
      if(current!==version.current)return;
      setToast('تم حفظ العملية وأدلتها دون تكرار.','success');setDraft(null);setPreview(null);
      await refreshProductsFromSupabase();await refreshInventoryMovementsFromSupabase();setRevision(n=>n+1);
      if(tab!=='new')await loadPage();
    }catch(cause){if(current===version.current)setError(cause instanceof Error?cause.message:'نتيجة العملية غير محسومة؛ استعد نفس المحاولة.');}
    finally{working.current=false;if(current===version.current){try{setAttempt(await supplierReplacementRecovery(scope));}catch(cause){setRecoveryReady(false);setError(cause instanceof Error?cause.message:'تعذر قراءة المحاولة.');}setBusy(false);}}
  };
  const caseAction=(c:SupplierReplacementCase,next:'receive'|'writeoff')=>{
    const qty=Number(quantity);if(!Number.isSafeInteger(qty)||qty<1||reason.trim().length<3){setError('أكمل كمية العملية وسببها.');return;}
    void inspect({action:next,payload:{caseId:c.id,quantity:qty,reason:reason.trim()},label:next==='receive'?'استلام البديل':'تحويل المعلّق إلى خسارة'});
  };
  return <div dir="rtl" aria-busy={busy} data-testid="supplier-replacement-panel" className="space-y-4">
    {supplierAllowed&&!damageOnly&&<div className="flex flex-wrap gap-2">{([['new','عملية جديدة'],['pending','المعلّق'],['history','السجل']] as const).map(([value,label])=><UiButton key={value} disabled={busy} onClick={()=>{setTab(value);setPageNo(1);setPreview(null);setDraft(null);setError('');}}>{label}</UiButton>)}</div>}
    <p className="text-sm text-nw-muted">نفس الصنف والكمية. لا دفعة أو ذمة مورد. المعلّق خارج المتاح ويعود بقيمته التاريخية.</p>
    {error&&<p role="alert" className="text-sm text-nw-bad">{error} <UiButton disabled={busy} onClick={()=>{setError('');setRevision(n=>n+1);}}>تحديث القراءة</UiButton></p>}
    {!recoveryReady?<p role="status">جاري التحقق من سجل المحاولة…</p>:attempt&&<Card className="space-y-2" data-testid="replacement-recovery">
      <p className="text-sm">{unresolved?'توجد محاولة لم تُحسم. استعدها قبل تسجيل عملية جديدة.':attempt.status==='succeeded'?'آخر عملية مثبتة. يمكنك معاينة عملية جديدة صراحةً.':'آخر محاولة رُفضت دون حفظ؛ راجع بيانات العملية الجديدة.'}</p>
      {attempt.status!=='rejected'&&<UiButton disabled={busy} onClick={()=>void execute(true)}>استعادة نفس المحاولة</UiButton>}
    </Card>}
    {tab==='new'&&<FormFields className="space-y-3">
      <fieldset disabled={busy||unresolved||!recoveryReady||Boolean(draft)} className="space-y-3">
        {supplierAllowed&&!damageOnly&&<label className="block text-sm">العملية<select value={action} onChange={e=>{setAction(e.target.value as SupplierReplacementAction);setDraft(null);setPreview(null);}}><option value="shop_pending">بانتظار البديل</option><option value="shop_immediate">بديل فوري</option><option value="shop_damage">تلف نهائي من المحل</option></select></label>}
        {optionsError?<p role="alert">{optionsError} <UiButton onClick={()=>setRevision(n=>n+1)}>إعادة المحاولة</UiButton></p>:!options?<p role="status">جاري تحميل الأصناف والموردين…</p>:<>
          {!initialProductId&&<SearchField label="ابحث عن الصنف" value={productSearch} onChange={e=>setProductSearch(e.target.value)}/>}
          <label className="block text-sm">الصنف<select value={productId} onChange={e=>chooseProduct(e.target.value)}><option value="">اختر الصنف</option>{options.products.map(p=><option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}</select></label>
          {action!=='shop_damage'&&<><SearchField label="ابحث عن المورد" value={supplierSearch} onChange={e=>setSupplierSearch(e.target.value)}/><label className="block text-sm">المورد<select value={supplierId} onChange={e=>setSupplierId(e.target.value)}><option value="">اختر المورد</option>{options.suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            {options.lastSuppliers.find(s=>s.productId===productId)?.supplierName&&<p className="text-xs text-nw-muted">آخر استلام موثق: {options.lastSuppliers.find(s=>s.productId===productId)?.supplierName}</p>}</>}
          <WarehouseChoice options={options.warehouses} value={warehouseId} onSingle={setWarehouseId}><label className="block text-sm">المستودع<select value={warehouseId} onChange={e=>setWarehouseId(e.target.value)}><option value="">اختر المستودع</option>{options.warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label></WarehouseChoice>
          <label className="block text-sm">الوحدة<select value={unit} onChange={e=>setUnit(e.target.value)}><option value="base">{product?.baseUnitName??'باكيت'}</option>{(product?.unitsPerParcel??1)>1&&<option value="parcel">طرد ({product?.unitsPerParcel} {product?.baseUnitName})</option>}</select></label>
          {action==='shop_damage'&&<label className="block text-sm">سبب التلف<select value={reasonCode} onChange={e=>setReasonCode(e.target.value)}><option value="shop_breakage">انكسر بالمحل</option><option value="expired">انتهت الصلاحية</option><option value="storage_damage">تلف تخزين</option><option value="other">أخرى</option></select></label>}
        </>}
      </fieldset>
    </FormFields>}
    <FormFields><fieldset className="space-y-3" disabled={busy||unresolved||!recoveryReady||Boolean(draft)}>
      <label className="block text-sm">{tab==='new'?'العدد':'كمية العملية بالوحدة الحقيقية للصنف'}<input inputMode="numeric" type="number" min="1" step="1" value={quantity} onChange={e=>{setQuantity(e.target.value);setPreview(null);setDraft(null);}}/></label>
      <label className="block text-sm">{action==='shop_damage'?'ملاحظة التلف':'سبب العملية'}<textarea required={action==='shop_damage'&&reasonCode==='other'} maxLength={500} value={reason} onChange={e=>{setReason(e.target.value);setPreview(null);setDraft(null);}}/></label>
    </fieldset></FormFields>
    {tab==='new'&&<UiButton disabled={busy||unresolved||!recoveryReady||!options} onClick={()=>void inspect()}>معاينة العملية</UiButton>}
    {tab!=='new'&&(page?<>
      <p className="text-sm">المعلّق: {page.pendingQuantity}{owner&&page.pendingValueInMinorUnitsExact!==undefined&&<> · <MoneyText amount={replacementMoney(page.pendingValueInMinorUnitsExact)} currency /></>}</p>
      {page.cases.length===0?<p role="status">لا توجد عمليات مطابقة.</p>:page.cases.map(c=><Card key={c.id} className="space-y-2">
        <p className="font-bold">{c.productName} · {c.supplierName??'تلف المحل'}</p><p className="text-sm">المعلّق {c.pendingQuantity} {c.baseUnitName} · استُلم {c.receivedQuantity} · رُفض {c.writtenOffQuantity}</p>
        <p className="text-xs text-nw-muted">منذ {formatUiDate(c.occurredAt,{day:'numeric',month:'short',year:'numeric'})}</p>
        {owner&&c.pendingValueInMinorUnitsExact!==undefined&&<p className="text-sm">قيمة الأصل المعلّق: <MoneyText amount={replacementMoney(c.pendingValueInMinorUnitsExact)} currency /></p>}
        {c.pendingQuantity>0&&<div className="flex flex-wrap gap-2"><UiButton disabled={busy||unresolved} onClick={()=>{setQuantity(String(c.pendingQuantity));void inspect({action:'receive',payload:{caseId:c.id,quantity:c.pendingQuantity,reason:reason.trim()||'استلام بديل المورد'},label:'استلام كل المتبقي'});}}>استلام المتبقي ({c.pendingQuantity})</UiButton><UiButton disabled={busy||unresolved||!reason.trim()} onClick={()=>caseAction(c,'receive')}>معاينة استلام جزئي</UiButton></div>}
        <details><summary className="min-h-11 cursor-pointer text-sm">⋯ السجل{owner?' والخسارة والعكس':''}</summary>
          {owner&&c.pendingQuantity>0&&<UiButton disabled={busy||unresolved} onClick={()=>caseAction(c,'writeoff')}>معاينة رفض المورد</UiButton>}
          <ul className="space-y-2">{c.events.map(e=><li key={e.id} className="text-sm">{eventLabels[e.action]} · {e.quantity} {c.baseUnitName} · {formatUiDate(e.occurredAt,{day:'numeric',month:'short',year:'numeric'})}{e.isReversed?' · معكوس':''}
            {owner&&e.reason&&<p className="text-xs text-nw-muted">{e.reason}</p>}{owner&&!e.isReversed&&e.action!=='reverse'&&<UiButton disabled={busy||unresolved||reason.trim().length<3} onClick={()=>void inspect({action:'reverse',payload:{eventId:e.id,reason:reason.trim()},label:'عكس الحدث'})}>معاينة العكس</UiButton>}</li>)}</ul>
        </details>
      </Card>)}
      <div className="flex gap-2"><UiButton disabled={busy||pageNo===1} onClick={()=>setPageNo(n=>n-1)}>السابق</UiButton><span>{pageNo}</span><UiButton disabled={busy||pageNo*25>=page.totalCount} onClick={()=>setPageNo(n=>n+1)}>التالي</UiButton></div>
    </>:!error&&<p role="status">جاري قراءة السجل…</p>)}
    {draft&&preview&&<Card className="space-y-3" data-testid="replacement-preview"><p className="font-bold">{draft.label}</p>
      {preview.eligible?<><p className="text-sm">الكمية: {String(draft.payload.quantity??'كما في الحدث الأصلي')} · السبب: {String(draft.payload.reason)}</p>{owner&&typeof preview.valueInMinorUnitsExact==='string'&&<MoneyText amount={replacementMoney(preview.valueInMinorUnitsExact)} currency/>}<UiButton disabled={busy||unresolved} onClick={()=>void execute()}>تأكيد وحفظ العملية</UiButton></>:<p role="alert">{String(preview.blockedReason)}</p>}
      <UiButton disabled={busy} onClick={()=>{setPreview(null);setDraft(null);}}>إلغاء المعاينة</UiButton>
    </Card>}
  </div>;
}
