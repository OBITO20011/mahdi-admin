import {useEffect,useRef,useState} from 'react';
import {FormFields,UiButton} from '../../components/ui';
import {ProductPicker} from '../../components/ui/ProductPicker';
import {productPickerOption} from '../../components/ui/productPickerModel';
import type {Order,Product} from '../../types';
import type {AdminAftercareModernContext} from '../../services/supabase/salesAftercare.service';
import {previewAftercare215,settleAftercare215} from '../../services/supabase/aftercare215.service';
import {fetchSupplierReplacementOptions,type ReplacementOptions} from '../../services/supabase/supplierReplacement.service';
import {searchAdminProducts} from '../../services/supabase/products.service';
import {businessErrorMessage} from '../../utils/businessError';
import type {Preview215} from '../../utils/aftercare215Contracts';
import {formatExactMinorJod,formatExactUnitCostJod,parcelPacketQuantity} from '../../utils/aftercare215Money';
import {buildWizard215,selectWizardPhysical215,inspectWizardPhysical215,physicalKey215,
  type BuiltWizard215,type WizardInspection215,type WizardRequest215,type WizardSelection215} from './aftercare215Draft';

interface Props {order:Order;context:AdminAftercareModernContext;ownerAllowed:boolean;disabled:boolean;
  onBusyChange:(busy:boolean)=>void;onRecoveryChange:()=>Promise<void>;onChanged:()=>Promise<void>;
  notify:(message:string,type?:'success'|'error'|'info')=>void}
const titles=['شو بده الزبون؟','شو الراجع؟','كيف حالة الراجع؟','الخربان على مين؟','المصاري أو البديل','راجع قبل التأكيد'];
const privateLabels:Record<string,string>={issuedCostInMinorUnits:'تكلفة البديل الصادر',goodRecoveryInMinorUnits:'قيمة السليم المستعاد',supplierHeldInMinorUnits:'قيمة المعيب المعلّق عند المورد',profitDeltaInMinorUnits:'أثر العملية على الربح',
  goodRestockValueExact:'قيمة السليم المستعاد',badLossInMinorUnits:'قيمة المعيب',profitDeltaExactInMinorUnits:'أثر العملية على الربح',newCogsExact:'تكلفة الصنف البديل'};
const defaultRefund=(order:Order):WizardRequest215['refundMethod']=>order.paymentMethod==='debt'?'debt':order.paymentMethod==='cliq'?'cliq':order.paymentMethod==='cash'?'cash':'auto';

/** Financial values are server previews. This component only collects physical
 * inspection and intent; it cannot enter a refund amount or persist cost. */
export function AftercareWizard215({order,context,ownerAllowed,disabled,onBusyChange,onRecoveryChange,onChanged,notify}:Props){
  const [open,setOpen]=useState(false),[step,setStep]=useState(1),[intent,setIntent]=useState<'refund'|'replace'>('refund');
  const [selection,setSelection]=useState<WizardSelection215|null>(null),[inspection,setInspection]=useState<WizardInspection215>({}),[inspected,setInspected]=useState(false);
  const [destination,setDestination]=useState<'final'|'supplier'|null>(null),[suppliers,setSuppliers]=useState<Record<string,string>>({}),[supplierSearch,setSupplierSearch]=useState('');
  const [options,setOptions]=useState<ReplacementOptions|null>(null),[optionsError,setOptionsError]=useState('');
  const [replacement,setReplacement]=useState<'same'|'other'>('same'),[products,setProducts]=useState<Product[]>([]),[selectedProduct,setSelectedProduct]=useState<Product|null>(null);
  const [search,setSearch]=useState(''),[productsLoading,setProductsLoading]=useState(false),[productsError,setProductsError]=useState('');
  const [replacementKind,setReplacementKind]=useState<'base_unit'|'legacy_single_sku_parcel'>('base_unit'),[replacementQuantity,setReplacementQuantity]=useState(1);
  const [refundMethod,setRefundMethod]=useState(defaultRefund(order)),[differenceMethod,setDifferenceMethod]=useState<'cash'|'cliq'|null>(order.paymentMethod==='cliq'?'cliq':'cash'),[reference,setReference]=useState('');
  const [reason,setReason]=useState('فحص بضاعة راجعة من الزبون'),[notes,setNotes]=useState(''),[preview,setPreview]=useState<Preview215|null>(null),[built,setBuilt]=useState<BuiltWizard215|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');const revision=useRef(0),mounted=useRef(true),heading=useRef<HTMLHeadingElement>(null),alert=useRef<HTMLParagraphElement>(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(open)heading.current?.focus();},[open,step]);
  const changed=()=>{revision.current++;setPreview(null);setBuilt(null);setError('');};
  const fail=(cause:unknown)=>{setError(businessErrorMessage(cause));requestAnimationFrame(()=>alert.current?.focus());};
  const choose=(value:WizardSelection215)=>{changed();setSelection(value);setInspection({});setInspected(false);setDestination(null);setSuppliers({});};
  let physical:ReturnType<typeof selectWizardPhysical215>=[],selectionError='';
  try{if(selection)physical=selectWizardPhysical215(order,context,selection);}catch(cause){selectionError=businessErrorMessage(cause);}
  let checked=physical;
  try{checked=inspectWizardPhysical215(physical,inspection);}catch{/* Named validation is displayed on Next/Preview. */}
  const bad=checked.reduce((s,x)=>s+x.source.defect_non_sellable_quantity,0);
  const badProducts=[...new Map(checked.filter(x=>x.source.defect_non_sellable_quantity>0).map(x=>[x.source.product_id,{id:x.source.product_id,name:x.name}])).values()];
  const selectedBase=selection?.kind==='base'?context.baseItems.find(i=>i.orderItemId===selection.orderItemId):undefined;
  const partial=Boolean(selection&&(selection.kind==='formed'?selection.componentId:selectedBase?.commercialLineKind==='legacy_single_sku_parcel'&&selection.unit==='packets'));
  const suggestedProduct=badProducts[0]?.id;
  useEffect(()=>{
    let active=true;setOptions(null);setOptionsError('');if(!open||step!==4||destination!=='supplier'||!ownerAllowed)return;
    const timer=setTimeout(()=>{void fetchSupplierReplacementOptions('customer_return','',supplierSearch,suggestedProduct).then(value=>{
      if(!active)return;setOptions(value);setSuppliers(previous=>{const next={...previous};for(const last of value.lastSuppliers)if(last.supplierId&&!next[last.productId]&&value.suppliers.some(s=>s.id===last.supplierId))next[last.productId]=last.supplierId;return next;});
    }).catch(cause=>{if(active)setOptionsError(businessErrorMessage(cause));});},supplierSearch?250:0);
    return()=>{active=false;clearTimeout(timer);};
  },[open,step,destination,ownerAllowed,supplierSearch,suggestedProduct]);
  useEffect(()=>{
    let active=true;if(!open||step!==5||intent!=='replace'||replacement!=='other')return;
    setProductsLoading(true);setProductsError('');const timer=setTimeout(()=>{void searchAdminProducts({purpose:'sellable',search,limit:30}).then(rows=>{
      if(active){setProducts(rows.filter(p=>!p.isFlavorMaster));setProductsLoading(false);}
    }).catch(cause=>{if(active){setProductsError(businessErrorMessage(cause));setProductsLoading(false);}});},search?250:0);
    return()=>{active=false;clearTimeout(timer);};
  },[open,step,intent,replacement,search]);
  const input=():WizardRequest215=>{
    if(!selection)throw new Error('اختر الطرد أو الباكيتات الراجعة.');
    return{selection,inspection,intent,replacement,supplierByProduct:suppliers,destination:destination??'final',ownerAllowed,reason,notes,refundMethod,referenceNumber:reference,
      productId:selectedProduct?.id??'',replacementKind,replacementQuantity,differenceMethod};
  };
  const next=()=>{
    try{
      if(step===2){if(!selection)throw new Error('اختر ما رجع من الزبون.');if(selectionError)throw new Error(selectionError);if(intent==='refund'&&partial)throw new Error('الباكيت من الطرد تبديل معيب فقط؛ لاسترداد المال اختر الطرد كاملاً.');}
      if(step===3){const rows=inspectWizardPhysical215(physical,inspection);if(!inspected)throw new Error('أكّد أنك فحصت الباكيتات الراجعة.');
        if(partial&&rows.some(x=>x.source.defect_non_sellable_quantity!==x.source.quantity))throw new Error('هذا استثناء تبديل المعيب من الطرد؛ يجب أن تكون الباكيتات المختارة كلها معيبة.');}
      if(step===4&&bad){if(!destination)throw new Error('اختر مصير الباكيتات المعيبة.');if(destination==='supplier')for(const p of badProducts)if(!suppliers[p.id])throw new Error(`${p.name}: اختر المورد.`);}
      setError('');setStep(Math.min(6,step+1));
    }catch(cause){fail(cause);}
  };
  const requestPreview=async()=>{
    if(disabled||busy)return;let request:BuiltWizard215;
    try{request=buildWizard215(order,context,input());}catch(cause){fail(cause);return;}
    const ownRevision=revision.current;setBusy(true);onBusyChange(true);setError('');
    try{const value=await previewAftercare215(request.action,request.payload,ownerAllowed);if(!mounted.current||revision.current!==ownRevision)return;
      setBuilt(request);setPreview(value);setStep(6);
    }catch(cause){if(mounted.current&&revision.current===ownRevision)fail(cause instanceof Error?cause:new Error((cause as {message?:string})?.message||'تعذرت المعاينة.'));}
    finally{onBusyChange(false);if(mounted.current)setBusy(false);}
  };
  const confirm=async()=>{
    if(disabled||busy||!preview?.canConfirm||!built)return;
    setBusy(true);onBusyChange(true);setError('');
    try{const result=await settleAftercare215(built.action,built.payload,preview.previewFingerprint);
      if(!mounted.current)return;if(!result.success)throw new Error(result.error||'نتيجة العملية غير محسومة؛ استعد نفس المحاولة.');
      notify(built.action==='sealed_return'?'تم الإرجاع وتسوية المبلغ حسب المعاينة.':'تم الاستبدال وإرجاع السليم فقط للمخزون.','success');setOpen(false);setPreview(null);setBuilt(null);await onChanged();
    }catch(cause){if(mounted.current)fail(cause);}
    finally{onBusyChange(false);if(mounted.current){setBusy(false);try{await onRecoveryChange();}catch(cause){fail(cause);}}}
  };
  if(!open)return <UiButton variant="primary" disabled={disabled} onClick={()=>{changed();setStep(1);setOpen(true);}}>إرجاع أو استبدال</UiButton>;
  const locked=busy||disabled;
  return <FormFields className="min-w-0 space-y-4 rounded-xl border border-nw-primary bg-nw-surface p-3" data-testid="aftercare215-wizard" aria-busy={busy}>
    <div className="flex items-start justify-between gap-2"><div><p className="text-sm text-nw-muted">{step} من 6 · {order.orderNumber}</p><h3 ref={heading} tabIndex={-1} className="text-lg font-bold text-nw-text">{titles[step-1]}</h3></div>
      <UiButton disabled={busy} onClick={()=>{changed();setOpen(false);}}>إغلاق</UiButton></div>
    {error&&<p ref={alert} tabIndex={-1} role="alert" className="rounded-lg bg-nw-bad-bg p-3 text-sm text-nw-bad">{error}</p>}
    <fieldset disabled={locked} className="min-w-0 space-y-3">
    {step===1&&<div className="grid gap-2"><UiButton variant={intent==='refund'?'primary':'secondary'} onClick={()=>{changed();setIntent('refund');}}>يرجّع ويسترد</UiButton>
      <UiButton variant={intent==='replace'?'primary':'secondary'} onClick={()=>{changed();setIntent('replace');}}>يبدّل</UiButton></div>}
    {step===2&&<div className="space-y-3">
      {context.baseItems.map(item=>{const name=order.items.find(i=>i.id===item.orderItemId)?.productName||'الصنف',remaining=item.physicalRepresentatives.reduce((s,x)=>s+x.remainingQuantity,0),parcel=item.commercialLineKind==='legacy_single_sku_parcel',n=item.unitsPerParcel??1;
        return remaining>0&&<div key={item.orderItemId} className="space-y-2 rounded-lg border border-nw-border p-3"><b>{name}</b><p className="text-sm text-nw-muted">المتبقي {parcelPacketQuantity(remaining,parcel?n:null)}</p>
          <div className="flex flex-wrap gap-2">{parcel&&<UiButton onClick={()=>choose({kind:'base',orderItemId:item.orderItemId,quantity:1,unit:'parcels'})}>طرد كامل</UiButton>}
            <UiButton onClick={()=>choose({kind:'base',orderItemId:item.orderItemId,quantity:1,unit:'packets'})}>{parcel?'باكيت معيب للتبديل فقط':'باكيتات'}</UiButton></div></div>;})}
      {context.parcelInstances.map((parcel,index)=><div key={parcel.parcelInstanceId} className="space-y-2 rounded-lg border border-nw-border p-3"><b>طرد مشكّل {index+1}</b>
        <p className="text-sm">{parcel.components.map(c=>`${c.quantity} ${order.items.flatMap(i=>i.parcelInstances??[]).flatMap(p=>p.components).find(x=>x.id===c.parcelComponentId)?.name||'نكهة'}`).join(' + ')}</p>
        <UiButton onClick={()=>choose({kind:'formed',parcelInstanceId:parcel.parcelInstanceId,quantity:1})}>الطرد المشكّل كاملاً</UiButton>
        {intent==='replace'&&parcel.components.map(c=><UiButton key={c.parcelComponentId} onClick={()=>choose({kind:'formed',parcelInstanceId:parcel.parcelInstanceId,componentId:c.parcelComponentId,quantity:1})}>
          تبديل المعيب · {order.items.flatMap(i=>i.parcelInstances??[]).flatMap(p=>p.components).find(x=>x.id===c.parcelComponentId)?.name||'نكهة'}</UiButton>)}</div>)}
      {selection&&<label>عدد {selection.kind==='formed'&&!selection.componentId?'الطرود المشكّلة':selection.kind==='base'&&selection.unit==='parcels'?'الطرود':'الباكيتات'} الراجعة<input type="number" min={1} step={1} inputMode="numeric" enterKeyHint="next" value={selection.quantity}
        disabled={selection.kind==='formed'&&!selection.componentId} onChange={e=>choose({...selection,quantity:Number(e.target.value)})}/></label>}
      {selectionError&&<p role="alert" className="text-sm text-nw-bad">{selectionError}</p>}
      <p className="text-sm text-nw-muted">الباكيت من الطرد تبديل معيب فقط بنفس الصنف؛ لا استرداد مال عن باكيت من طرد.</p>
    </div>}
    {step===3&&<div className="space-y-3"><p className="text-sm">السليم يرجع للمخزون. المعيب حسب القرار التالي. الافتراضي الكل سليم.</p>
      {physical.map(leaf=>{const key=physicalKey215(leaf.source),value=inspection[key]??{bad:0,customerDamage:0},rest=leaf.source.quantity-value.bad-value.customerDamage;
        return <div key={key} className="space-y-2 rounded-lg border border-nw-border p-3"><b>{leaf.name}</b><p className="text-sm text-nw-muted">{leaf.original?'من البيع الأصلي':'البديل الذي أعطيته'} · {leaf.source.quantity} باكيت</p>
          <label>الخربان · {leaf.name}<input type="number" min={0} max={leaf.source.quantity} inputMode="numeric" enterKeyHint="next" value={value.bad}
            onChange={e=>{changed();setInspection({...inspection,[key]:{...value,bad:Number(e.target.value)}});setInspected(false);}}/></label>
          <p>السليم الذي يرجع للمخزون: {rest>=0?rest:'راجع الكمية'} باكيت</p>
          <details><summary className="min-h-11 cursor-pointer py-3 text-sm">متقدم · ضرر من الزبون</summary><label>ضرر الزبون · {leaf.name}<input type="number" min={0} max={leaf.source.quantity} inputMode="numeric" enterKeyHint="next" value={value.customerDamage}
            onChange={e=>{changed();setInspection({...inspection,[key]:{...value,customerDamage:Number(e.target.value)}});setInspected(false);}}/></label><p className="text-sm text-nw-muted">يبقى للزبون ويُخصم حسب سعر الفاتورة التاريخي؛ ليس عيب ضمان. القدرات النادرة متاحة في الخيارات المتقدمة للفاتورة.</p></details></div>;})}
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={inspected} onChange={e=>{changed();setInspected(e.target.checked);}}/>فحصت الباكيتات الراجعة</label>
    </div>}
    {step===4&&<div className="space-y-3">{bad===0?<p>لا يوجد باكيت معيب. السليم يعود للمخزون.</p>:<>
      <p>الخربان: {bad} باكيت</p><UiButton variant={destination==='final'?'primary':'secondary'} onClick={()=>{changed();setDestination('final');}}>خسارة عليّ — تالف نهائي</UiButton>
      {ownerAllowed&&<UiButton variant={destination==='supplier'?'primary':'secondary'} onClick={()=>{changed();setDestination('supplier');}}>على المورد — بانتظار البديل</UiButton>}
      {destination==='supplier'&&ownerAllowed&&<><label>بحث المورد<input value={supplierSearch} onChange={e=>setSupplierSearch(e.target.value)} enterKeyHint="search"/></label>
        {badProducts.map(p=><label key={p.id}>مورد {p.name}<select aria-label={`مورد ${p.name}`} value={suppliers[p.id]??''} onChange={e=>{changed();setSuppliers({...suppliers,[p.id]:e.target.value});}}>
          <option value="">اختر المورد</option>{options?.suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>)}
        {optionsError&&<p role="alert" className="text-sm text-nw-bad">{optionsError}</p>}<p className="text-sm text-nw-muted">المعيب وحده ينتظر المورد؛ السليم يرجع للمخزون. يُقترح آخر مورد استلمنا منه الصنف.</p></>}
    </>}</div>}
    {step===5&&<div className="space-y-3">{intent==='refund'?<><h4 className="font-bold">كيف ترجّع المصاري؟</h4><p className="text-sm">المبلغ من سعر الفاتورة بعد الخصم. ينخفض دين هذه الفاتورة أولاً، ثم يُرد المال المدفوع فعلاً.</p>
      <label>طريقة رد المال<select aria-label="طريقة رد المال" value={refundMethod} onChange={e=>{changed();setRefundMethod(e.target.value as typeof refundMethod);}}><option value="auto">حسب دفع الفاتورة الأصلية</option><option value="cash">كاش — من الدرج الآن</option><option value="cliq">CliQ — تحويل من حسابك</option><option value="debt">خفض ذمة — ينقص من دين الزبون، بلا مصاري</option></select></label>
      <p className="text-sm text-nw-muted">الكاش ينقص متوقع الوردية المفتوحة. CliQ خارج الدرج ومرجعه إلزامي.</p></>:<>
      <h4 className="font-bold">شو أخذ بداله؟</h4><div className="flex flex-wrap gap-2"><UiButton variant={replacement==='same'?'primary':'secondary'} onClick={()=>{changed();setReplacement('same');}}>نفس الصنف</UiButton>
      <UiButton variant={replacement==='other'?'primary':'secondary'} onClick={()=>{if(partial||context.financial.merchandiseDebtInMinorUnits>0){fail('التبديل بصنف آخر يحتاج فاتورة مسددة وطرداً كاملاً أو باكيت بيع أصلياً مستقلاً.');return;}changed();setReplacement('other');}}>صنف آخر — مع فرق السعر</UiButton></div>
      {replacement==='same'?<p className="text-sm">يخرج نفس الصنف والكمية بلا فرق سعر. يعود السليم فقط، ويُسجّل المعيب حسب قرارك.</p>:<>
        <p className="text-sm">لفواتير مسددة وطرد كامل أو باكيت بيع أصلي مستقل. لا دين جديد ولا تبديل نكهة كأنها الصنف نفسه.</p>
        <ProductPicker label="الصنف البديل" search={search} onSearch={setSearch} loading={productsLoading} disabled={locked} value={selectedProduct?.id}
          options={products.map(p=>({...productPickerOption(p,context.order.warehouseId),unit:'باكيت'}))} onChoose={id=>{const p=products.find(x=>x.id===id);if(!p)return;changed();setSelectedProduct(p);setReplacementKind(p.parcelOnly?'legacy_single_sku_parcel':'base_unit');}}/>
        {productsError&&<p role="alert" className="text-sm text-nw-bad">{productsError}</p>}
        {selectedProduct&&<><p className="font-semibold">البديل: {selectedProduct.nameAr}</p><label>طريقة بيع البديل<select aria-label="طريقة بيع البديل" value={replacementKind} onChange={e=>{changed();setReplacementKind(e.target.value as typeof replacementKind);}}>
          {!selectedProduct.parcelOnly&&<option value="base_unit">باكيت</option>}{(selectedProduct.unitsPerSalePackage??1)>1&&(selectedProduct.salePackagePrice??0)>0&&<option value="legacy_single_sku_parcel">طرد ({selectedProduct.unitsPerSalePackage} باكيت)</option>}</select></label>
          <label>عدد {replacementKind==='base_unit'?'الباكيتات':'الطرود'} البديلة<input type="number" min={1} step={1} inputMode="numeric" enterKeyHint="next" value={replacementQuantity} onChange={e=>{changed();setReplacementQuantity(Number(e.target.value));}}/></label></>}
        <label>كيف تسوّي فرق المال؟<select aria-label="كيف تسوّي فرق المال؟" value={differenceMethod??''} onChange={e=>{changed();setDifferenceMethod(e.target.value?(e.target.value as 'cash'|'cliq'):null);}}><option value="">اختر بعد المعاينة</option><option value="cash">كاش — داخل أو خارج الدرج</option><option value="cliq">CliQ — خارج الدرج</option></select></label>
      </>}</>}
      {(intent==='refund'&&(refundMethod==='cliq'||refundMethod==='auto'&&order.paymentMethod==='cliq')||intent==='replace'&&replacement==='other'&&differenceMethod==='cliq')&&<label>مرجع CliQ<input value={reference} maxLength={120} enterKeyHint="next" onChange={e=>{changed();setReference(e.target.value);}}/></label>}
      <details><summary className="min-h-11 cursor-pointer py-3">متقدم · السبب والملاحظة</summary><label>سبب العملية<input value={reason} maxLength={500} onChange={e=>{changed();setReason(e.target.value);}}/></label><label>ملاحظة<textarea rows={3} value={notes} onChange={e=>{changed();setNotes(e.target.value);}}/></label></details>
    </div>}
    {step===6&&preview&&<div className="space-y-3" data-testid="aftercare215-preview"><p>يرجع للمخزون <b>{preview.goodQuantity} باكيت</b> · معيب <b>{preview.badQuantity} باكيت</b>{preview.customerDamageQuantity>0&&` · يبقى للزبون ${preview.customerDamageQuantity} باكيت`}</p>
      {preview.badQuantity>0&&<p>{destination==='supplier'?'المعيب بانتظار المورد':'المعيب خسارة نهائية عليّ'}</p>}
      {preview.kind==='sealed_return'&&<><p>المبيعات −{formatExactMinorJod(preview.entitlementInMinorUnits)}</p><p>ينقص من دين هذه الفاتورة: {formatExactMinorJod(preview.debtReductionInMinorUnits)}</p>
        {BigInt(preview.moneyRefundInMinorUnits)>0n?<p>تعطي الزبون {formatExactMinorJod(preview.moneyRefundInMinorUnits)} {preview.refundMethod==='cash'?'كاش من الدرج':preview.refundMethod==='cliq'?'CliQ من حسابك':'— اختر طريقة الرد'}</p>:<p>بلا مصاري من الدرج أو الحساب.</p>}</>}
      {preview.kind==='inspected_replacement'&&<><p>خرج للزبون {preview.issuedQuantity} باكيت بنفس الصنف · فرق المال 0.000 د.أ</p><p>صافي المخزون: {preview.goodQuantity-preview.issuedQuantity} باكيت</p></>}
      {preview.kind==='exchange'&&<><p>البديل: {preview.productName} · {preview.baseQuantity} باكيت</p><p>مقابل داخلي من المرتجع: {formatExactMinorJod(preview.internalCreditInMinorUnits)}</p><p>إجمالي البديل: {formatExactMinorJod(preview.newTotalInMinorUnits)}</p>
        <p>{BigInt(preview.moneyReceivedInMinorUnits)>0n?`تقبض الآن ${formatExactMinorJod(preview.moneyReceivedInMinorUnits)}`:BigInt(preview.moneyRefundInMinorUnits)>0n?`تعطي الزبون ${formatExactMinorJod(preview.moneyRefundInMinorUnits)}`:'فرق المال: 0.000 د.أ'} {preview.differenceMethod==='cash'?'كاش من/إلى الدرج':preview.differenceMethod==='cliq'?'CliQ خارج الدرج':''}</p></>}
      {ownerAllowed&&preview.ownerValues&&<details><summary className="min-h-11 cursor-pointer py-3">قيم المالك</summary><dl className="space-y-2">{Object.entries(preview.ownerValues).map(([key,value])=><div key={key} className="flex flex-wrap justify-between gap-2"><dt>{privateLabels[key]??'قيمة العملية'}</dt><dd dir="ltr">{value.includes('.')?`${value.startsWith('-')?'−':''}${formatExactUnitCostJod(value.replace(/^-/u,''))}`:formatExactMinorJod(value)}</dd></div>)}</dl></details>}
      {preview.issues.length>0&&<div role="alert" className="space-y-2 text-sm text-nw-bad">{preview.issues.map((issue,index)=><p key={index}>{issue.field==='referenceNumber'?'مرجع CliQ':issue.field==='cashShift'?'الوردية':issue.field==='differenceMethod'?'طريقة فرق المال':'طريقة رد المال'}: {businessErrorMessage(issue.code)}</p>)}<p>ارجع للخطوة السابقة وأكمل الخانة المذكورة، ثم أعد المعاينة.</p></div>}
    </div>}
    </fieldset>
    <div className="flex flex-wrap gap-2">
      {step>1&&<UiButton disabled={busy} onClick={()=>{changed();setStep(step-1);}}>رجوع</UiButton>}
      {step<5&&<UiButton variant="primary" disabled={locked} onClick={next}>التالي</UiButton>}
      {(step===5||step===6&&!preview)&&<UiButton variant="primary" disabled={locked} onClick={()=>void requestPreview()}>{busy?'جاري المعاينة…':'معاينة التفاصيل'}</UiButton>}
      {step===6&&preview?.canConfirm&&<UiButton variant="primary" disabled={locked} onClick={()=>void confirm()}>{busy?'جارٍ التأكيد…':intent==='refund'?'تأكيد الإرجاع':'تأكيد الاستبدال'}</UiButton>}
    </div>
    {step===6&&!preview&&<p className="text-sm text-nw-muted">أعد معاينة التفاصيل بعد أي تعديل.</p>}
  </FormFields>;
}
