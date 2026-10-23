import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {ProductPicker} from '../../components/ui/ProductPicker';
import {Card,FormFields,MoneyText,SearchField,UiButton,formatUiDate} from '../../components/ui';
import {WarehouseChoice} from '../../components/ui/WarehouseChoice';
import {RejectionNotice} from '../../components/common/RejectionNotice';
import {SupplierReplacementQuantities} from './SupplierReplacementQuantities';
import {useAuthStore} from '../../stores/useAuthStore';
import {useAppStoreActions} from '../../stores/useAppStore';
import {fetchSupplierReplacementOptions,fetchSupplierReplacementPage,fetchSupplierReplacementPreview,submitSupplierReplacement,supplierReplacementRecovery,type ReplacementOptions} from '../../services/supabase/supplierReplacement.service';
import type {ReplacementAttempt} from '../../services/supabase/supplierReplacementIntent';
import {canUseSupplierReplacement,replacementMoney,type SupplierReplacementAction,type SupplierReplacementCase,type SupplierReplacementPage,type SupplierReplacementPayload} from '../../utils/supplierReplacement';

const eventLabels:Record<string,string>={send:'إرسال للمورد',immediate:'استبدال فوري',receive:'استلام البديل',writeoff:'رفض المورد',damage:'تلف نهائي',reverse:'عكس حدث'};
type CaseSelection={action:'receive'|'writeoff';item:SupplierReplacementCase}|{action:'reverse';eventId:string;item:SupplierReplacementCase};
export interface SupplierReplacementPanelProps {productId?:string;supplierId?:string;damageOnly?:boolean;initialReversal?:{item:SupplierReplacementCase;eventId:string};onSaved?:()=>void;onPendingChange?:(pending:boolean)=>void}
export function SupplierReplacementPanel({productId:initialProductId,supplierId:initialSupplierId,damageOnly=false,initialReversal,onSaved,onPendingChange}:SupplierReplacementPanelProps) {
  const {user,roles,roleName}=useAuthStore(),owner=roles.includes('owner')||roleName==='owner';
  const supplierAllowed=canUseSupplierReplacement(roles,roleName),damageAllowed=supplierAllowed||roles.includes('admin')||roleName==='admin';
  const roleKey=roles.join(',');
  const {setToast,refreshProductsFromSupabase,refreshInventoryMovementsFromSupabase}=useAppStoreActions();
  const [tab,setTab]=useState<'new'|'pending'|'history'>('new'),[action,setAction]=useState<SupplierReplacementAction>(damageOnly||!supplierAllowed?'shop_damage':'shop_pending');
  const [productId,setProductId]=useState(initialProductId??''),[supplierId,setSupplierId]=useState(initialSupplierId??''),[warehouseId,setWarehouseId]=useState('');
  const [productSearch,setProductSearch]=useState(''),[supplierSearch,setSupplierSearch]=useState(''),[quantity,setQuantity]=useState('1'),[unit,setUnit]=useState('base');
  const [reason,setReason]=useState(''),[reasonCode,setReasonCode]=useState('shop_breakage');
  const [selection,setSelection]=useState<CaseSelection|null>(null);
  const reasonInput=useRef<HTMLTextAreaElement>(null),quantityInput=useRef<HTMLInputElement>(null),actionPanel=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{if(selection){actionPanel.current?.scrollIntoView({block:'nearest'});actionPanel.current?.focus({preventScroll:true});}},[selection]);
  const [options,setOptions]=useState<ReplacementOptions|null>(null),[page,setPage]=useState<SupplierReplacementPage|null>(null),[pageNo,setPageNo]=useState(1);
  const [error,setError]=useState(''),[optionsError,setOptionsError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
  const [attempt,setAttempt]=useState<ReplacementAttempt|null>(null),[recoveryReady,setRecoveryReady]=useState(false);
  const [draft,setDraft]=useState<{action:SupplierReplacementAction;payload:SupplierReplacementPayload;label:string}|null>(null),[preview,setPreview]=useState<Record<string,unknown>|null>(null);
  const scope='supplier-replacement208:panel',working=useRef(false),version=useRef(0);
  const unresolved=attempt?.status==='prepared'||attempt?.status==='unknown';
  useEffect(()=>{onPendingChange?.(busy||unresolved||!recoveryReady);},[busy,unresolved,recoveryReady,onPendingChange]);
  useEffect(()=>{if(initialReversal&&owner&&recoveryReady){setSelection({action:'reverse',item:initialReversal.item,eventId:initialReversal.eventId});}},[initialReversal,owner,recoveryReady]);
  useEffect(()=>{const generation=++version.current;setAttempt(null);setRecoveryReady(false);setPreview(null);setDraft(null);setSelection(null);setBusy(false);let active=true;
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
    if(!productId)throw new Error('الصنف: اختر الصنف.');
    if(!warehouseId)throw new Error('المستودع: اختر المستودع.');
    if(!Number.isSafeInteger(amount)||amount<1)throw new Error('العدد: أدخل عدداً صحيحاً أكبر من صفر.');
    if(finalReason.length<3)throw new Error('سبب العملية: اكتب 3 أحرف على الأقل؛ تحتاج «أخرى» إلى ملاحظة.');
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
      setToast('تم حفظ العملية.','success');setDraft(null);setPreview(null);setSelection(null);
      await refreshProductsFromSupabase();await refreshInventoryMovementsFromSupabase();setRevision(n=>n+1);
      if(tab!=='new')await loadPage();
      onSaved?.();
    }catch(cause){if(current===version.current)setError(cause instanceof Error?cause.message:'نتيجة العملية غير محسومة؛ استعد نفس المحاولة.');}
    finally{working.current=false;if(current===version.current){try{setAttempt(await supplierReplacementRecovery(scope));}catch(cause){setRecoveryReady(false);setError(cause instanceof Error?cause.message:'تعذر قراءة المحاولة.');}setBusy(false);}}
  };
  const caseAction=(c:SupplierReplacementCase,next:'receive'|'writeoff')=>{
    const qty=Number(quantity);if(!Number.isSafeInteger(qty)||qty<1){setError('العدد: أدخل عدداً صحيحاً أكبر من صفر.');quantityInput.current?.focus();return;}
    if(qty>c.pendingQuantity){setError('العدد: لا يتجاوز المعلّق المتبقي ('+c.pendingQuantity+' '+c.baseUnitName+').');quantityInput.current?.focus();return;}
    if(reason.trim().length<3){setError('سبب العملية: اكتب 3 أحرف على الأقل.');reasonInput.current?.focus();return;}
    void inspect({action:next,payload:{caseId:c.id,quantity:qty,reason:reason.trim()},label:next==='receive'?'استلام البديل':'تحويل المعلّق إلى خسارة'});
  };
  const previewSelection=()=>{
    if(!selection)return;
    if(reason.trim().length<3){setError('سبب العملية: اكتب 3 أحرف على الأقل.');reasonInput.current?.focus();return;}
    if(selection.action==='reverse')void inspect({action:'reverse',payload:{eventId:selection.eventId,reason:reason.trim()},label:'عكس الحدث'});
    else caseAction(selection.item,selection.action);
  };
  const openCase=(item:SupplierReplacementCase,next:'receive'|'writeoff'|'reverse',eventId?:string,inspectAll=false)=>{
    if(working.current||unresolved||!recoveryReady)return;
    const defaultReason=next==='receive'?'وصل البديل من المورد':'';
    setSelection(next==='reverse'?{action:next,item,eventId:eventId!}:{action:next,item});
    setQuantity(String(item.pendingQuantity));setReason(defaultReason);setPreview(null);setDraft(null);setError('');
    if(inspectAll)void inspect({action:'receive',payload:{caseId:item.id,quantity:item.pendingQuantity,reason:defaultReason},label:'استلام كل المتبقي'});
  };
  const renderPreview=()=>draft&&preview?<Card className="space-y-3" data-testid="replacement-preview"><p className="font-bold">{draft.label}</p>
      {preview.eligible?<><p className="text-sm">الكمية: {String(draft.payload.quantity??'كما في الحدث الأصلي')} · السبب: {String(draft.payload.reason)}</p>{owner&&typeof preview.valueInMinorUnitsExact==='string'&&<MoneyText amount={replacementMoney(preview.valueInMinorUnitsExact)} currency/>}<UiButton disabled={busy||unresolved} onClick={()=>void execute()}>{draft.action==='receive'?'تأكيد الاستلام':draft.action==='writeoff'?'تأكيد رفض المورد':draft.action==='reverse'?'تأكيد العكس':'تأكيد وحفظ العملية'}</UiButton></>:<RejectionNotice reason={preview.blockedReason}/>}
      <UiButton disabled={busy} onClick={()=>{setPreview(null);setDraft(null);}}>إلغاء المعاينة</UiButton>
    </Card> : null;
  const renderCaseWorkflow=()=>selection&&<FormFields ref={actionPanel} tabIndex={-1} role="region" aria-label="تفاصيل عملية المعلّق" className="space-y-3 rounded-xl border border-nw-border p-3" data-testid="replacement-case-workflow">
    <p className="font-bold">{selection.action==='reverse'?'عكس الحدث':selection.action==='receive'?'استلام البديل':'رفض المورد'} · {selection.item.productName}</p>
    {error&&<RejectionNotice reason={error}/>}
    <fieldset className="space-y-3" disabled={busy||unresolved||!recoveryReady||Boolean(draft)}>
      {selection.action!=='reverse'&&<label className="block text-sm">العدد ({selection.item.baseUnitName})<input enterKeyHint="next" ref={quantityInput} inputMode="numeric" type="number" min="1" max={selection.item.pendingQuantity} step="1" value={quantity} onChange={e=>{setQuantity(e.target.value);setError('');}}/></label>}
      <label className="block text-sm"><span>سبب العملية</span><textarea aria-label="سبب العملية" ref={reasonInput} maxLength={500} value={reason} onChange={e=>{setReason(e.target.value);setError('');}}/></label>
      {!draft&&<UiButton onClick={previewSelection}>معاينة التفاصيل</UiButton>}
    </fieldset>
    {renderPreview()}
    {!draft&&<UiButton disabled={busy} onClick={()=>{setSelection(null);setError('');}}>إلغاء العملية</UiButton>}
  </FormFields>;
  if(initialReversal)return !owner?<p role="alert">هذه العملية متاحة للمالك فقط.</p>:<div dir="rtl" className="space-y-3" aria-busy={busy}>
    {!recoveryReady&&<p role="status">جاري التحقق من المحاولة السابقة…</p>}
    {unresolved&&<UiButton disabled={busy} onClick={()=>void execute(true)}>استعادة العملية المحفوظة</UiButton>}
    {!selection&&error&&<RejectionNotice reason={error}/>}{renderCaseWorkflow()}
  </div>;
  return <div dir="rtl" aria-busy={busy} data-testid="supplier-replacement-panel" className="space-y-4">
    {supplierAllowed&&!damageOnly&&<div className="flex flex-wrap gap-2">{([['new','عملية جديدة'],['pending','المعلّق'],['history','السجل']] as const).map(([value,label])=><UiButton key={value} disabled={busy} onClick={()=>{setTab(value);setPageNo(1);setPreview(null);setDraft(null);setSelection(null);setError('');}}>{label}</UiButton>)}</div>}
    <p className="text-sm text-nw-muted">{damageOnly?'سجّل العدد التالف بالوحدة الظاهرة للصنف، واختر سبب التلف.':'تبديل بنفس الصنف والعدد، بلا دفعة أو دين للمورد. البضاعة المعلّقة ليست جاهزة للبيع؛ عند استلامها تعود بتكلفتها وقت الإرسال.'}</p>
    {error&&!selection&&<RejectionNotice reason={error}><UiButton disabled={busy} onClick={()=>{setError('');setRevision(n=>n+1);}}>تحديث القراءة</UiButton></RejectionNotice>}
    {!recoveryReady?<p role="status">جاري التحقق من سجل المحاولة…</p>:attempt&&<Card className="space-y-2" data-testid="replacement-recovery">
      <p className="text-sm">{unresolved?'لم تتأكد نتيجة الحفظ بعد. استعد نفس المحاولة قبل تسجيل عملية جديدة.':attempt.status==='succeeded'?'آخر عملية محفوظة. يمكنك معاينة عملية جديدة.':'آخر محاولة مرفوضة؛ راجع البيانات قبل عملية جديدة.'}</p>
      {attempt.status!=='rejected'&&<UiButton disabled={busy} onClick={()=>void execute(true)}>استعادة نفس المحاولة</UiButton>}
    </Card>}
    {tab==='new'&&<FormFields className="space-y-3">
      <fieldset disabled={busy||unresolved||!recoveryReady||Boolean(draft)} className="space-y-3">
        {supplierAllowed&&!damageOnly&&<label className="block text-sm">العملية<select value={action} onChange={e=>{setAction(e.target.value as SupplierReplacementAction);setDraft(null);setPreview(null);}}><option value="shop_pending">بانتظار البديل</option><option value="shop_immediate">بديل فوري</option><option value="shop_damage">تلف نهائي من المحل</option></select></label>}
        {optionsError?<RejectionNotice reason={optionsError}><UiButton onClick={()=>setRevision(n=>n+1)}>إعادة المحاولة</UiButton></RejectionNotice>:!options?<p role="status">جاري تحميل الأصناف والموردين…</p>:<>
          <ProductPicker label="الصنف" search={productSearch} onSearch={setProductSearch} value={productId} onChoose={chooseProduct}
            options={options.products.map(p=>({id:p.id,name:p.name,image:p.imageUrl??undefined,available:p.availableQuantity??null,unit:p.baseUnitName}))}/>
          {action!=='shop_damage'&&<><SearchField label="ابحث عن المورد" value={supplierSearch} onChange={e=>setSupplierSearch(e.target.value)}/><label className="block text-sm">المورد<select value={supplierId} onChange={e=>setSupplierId(e.target.value)}><option value="">اختر المورد</option>{options.suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            {options.lastSuppliers.find(s=>s.productId===productId)?.supplierName&&<p className="text-xs text-nw-muted">آخر استلام موثق: {options.lastSuppliers.find(s=>s.productId===productId)?.supplierName}</p>}</>}
          <WarehouseChoice options={options.warehouses} value={warehouseId} onSingle={setWarehouseId}><label className="block text-sm">المستودع<select value={warehouseId} onChange={e=>setWarehouseId(e.target.value)}><option value="">اختر المستودع</option>{options.warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label></WarehouseChoice>
          <label className="block text-sm">الوحدة<select value={unit} onChange={e=>setUnit(e.target.value)}><option value="base">{product?.baseUnitName??'باكيت'}</option>{(product?.unitsPerParcel??1)>1&&<option value="parcel">طرد ({product?.unitsPerParcel} {product?.baseUnitName})</option>}</select></label>
          {action==='shop_damage'&&<label className="block text-sm">سبب التلف<select value={reasonCode} onChange={e=>setReasonCode(e.target.value)}><option value="shop_breakage">انكسر بالمحل</option><option value="expired">انتهت الصلاحية</option><option value="storage_damage">تلف تخزين</option><option value="other">أخرى</option></select></label>}
        </>}
      </fieldset>
    </FormFields>}
    {tab==='new'&&<FormFields><fieldset className="space-y-3" disabled={busy||unresolved||!recoveryReady||Boolean(draft)}>
      <label className="block text-sm">العدد<input enterKeyHint="next" inputMode="numeric" type="number" min="1" step="1" ref={quantityInput} value={quantity} onChange={e=>{setQuantity(e.target.value);setPreview(null);setDraft(null);}}/></label>
      <label className="block text-sm">{action==='shop_damage'?'ملاحظة التلف':'سبب العملية'}<textarea ref={reasonInput} required={action==='shop_damage'&&reasonCode==='other'} maxLength={500} value={reason} onChange={e=>{setReason(e.target.value);setPreview(null);setDraft(null);}}/></label>
    </fieldset></FormFields>}
    {tab==='new'&&<UiButton disabled={busy||unresolved||!recoveryReady||!options} onClick={()=>void inspect()}>معاينة العملية</UiButton>}
    {tab!=='new'&&(page?<>
      <SupplierReplacementQuantities data={page}/>{owner&&page.pendingValueInMinorUnitsExact!==undefined&&<p className="text-sm">القيمة الإجمالية للمعلّق: <MoneyText amount={replacementMoney(page.pendingValueInMinorUnitsExact)} currency /></p>}
      {page.cases.length===0?<p role="status">لا توجد عمليات مطابقة.</p>:page.cases.map(c=><Card key={c.id} className="space-y-2" data-testid="replacement-case">
        <p className="font-bold">{c.productName} · {c.supplierName??'تلف المحل'}</p><p className="text-sm">المعلّق {c.pendingQuantity} {c.baseUnitName} · استُلم {c.receivedQuantity} {c.baseUnitName} · رُفض {c.writtenOffQuantity} {c.baseUnitName}</p>
        <p className="text-xs text-nw-muted">منذ {formatUiDate(c.occurredAt,{day:'numeric',month:'short',year:'numeric'})}</p>
        {owner&&c.pendingValueInMinorUnitsExact!==undefined&&<p className="text-sm">قيمة الأصل المعلّق: <MoneyText amount={replacementMoney(c.pendingValueInMinorUnitsExact)} currency /></p>}
        {c.pendingQuantity>0&&<div className="flex flex-wrap gap-2"><UiButton disabled={busy||unresolved} onClick={()=>openCase(c,'receive',undefined,true)}>استلام المتبقي ({c.pendingQuantity})</UiButton><UiButton disabled={busy||unresolved} onClick={()=>openCase(c,'receive')}>معاينة استلام جزئي</UiButton></div>}
        {selection?.item.id===c.id&&selection.action==='receive'&&renderCaseWorkflow()}
        <details><summary className="min-h-11 cursor-pointer text-sm">⋯ السجل{owner?' والخسارة والعكس':''}</summary>
          {owner&&c.pendingQuantity>0&&<UiButton disabled={busy||unresolved} onClick={()=>openCase(c,'writeoff')}>معاينة رفض المورد</UiButton>}
          {selection?.item.id===c.id&&selection.action==='writeoff'&&renderCaseWorkflow()}
          <ul className="space-y-2">{c.events.map(e=><li key={e.id} className="text-sm">{eventLabels[e.action]} · {e.quantity} {c.baseUnitName} · {formatUiDate(e.occurredAt,{day:'numeric',month:'short',year:'numeric'})}{e.isReversed?' · معكوس':''}
            {owner&&e.reason&&<p className="text-xs text-nw-muted">{e.reason}</p>}{owner&&!e.isReversed&&e.action!=='reverse'&&<UiButton disabled={busy||unresolved} onClick={()=>openCase(c,'reverse',e.id)}>معاينة العكس</UiButton>}{selection?.action==='reverse'&&selection.eventId===e.id&&renderCaseWorkflow()}</li>)}</ul>
        </details>
      </Card>)}
      <div className="flex gap-2"><UiButton disabled={busy||pageNo===1} onClick={()=>{setSelection(null);setPageNo(n=>n-1);}}>السابق</UiButton><span>{pageNo}</span><UiButton disabled={busy||pageNo*25>=page.totalCount} onClick={()=>{setSelection(null);setPageNo(n=>n+1);}}>التالي</UiButton></div>
    </>:!error&&<p role="status">جاري قراءة السجل…</p>)}
    {tab==='new'&&renderPreview()}
  </div>;
}
