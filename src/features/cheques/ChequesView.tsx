import React,{useCallback,useEffect,useId,useState} from 'react';
import {Modal} from '../../components/common/Modal';
import {Card,PageHeader,KpiGrid,KpiCard,FilterChips,SearchField,SegmentedControl,TableShell,Th,Tr,Td,MoneyText,
  StatusBadge,UiButton,SectionHeader,FormFields,formatUiDate} from '../../components/ui';
import {useAuthStore} from '../../stores/useAuthStore';
import {useDrawerShortfallConfirm} from '../../hooks/useDrawerShortfallConfirm';
import {useAppStoreSelector} from '../../stores/useAppStore';
import {fetchSuppliersFromSupabase} from '../../services/supabase/purchases.service';
import {fetchPosCustomersFromSupabase} from '../../services/supabase/pos.service';
import {parseJodToMinor} from '../goLive/goLiveImport';
import {ChequeRegistrationForm,type ChequeParty} from './ChequeRegistrationForm';
import {fetchCheques,fetchChequeDetail,clearCheque,returnCheque,cancelCheque,endorseCheque,paySupplierChequeClaim,
  reverseSupplierChequeClaimPayment,newChequeKey,chequeStatusLabels,type Cheque,type ChequeDetail,type ChequePage,type ChequeFilter,type ChequeDirection} from '../../services/supabase/cheques.service';
const filters:readonly {value:ChequeFilter;label:string}[]=[{value:'all',label:'الكل'},{value:'due7',label:'خلال 7 أيام'},
  {value:'overdue',label:'متأخرة'},{value:'pending',label:'قيد الانتظار'},{value:'endorsed',label:'مُجيّرة'},
  {value:'returned',label:'راجعة'},{value:'cleared',label:'صُرفت'},{value:'cancelled',label:'ملغاة'}];
const tone=(s:Cheque['status'])=>s==='returned'?'bad':s==='cleared'?'ok':s==='cancelled'?'mute':s==='endorsed'?'info':'warn';
const field='h-11 w-full min-w-0 rounded-xl border border-nw-border bg-nw-surface px-3 text-sm text-nw-text';
type Action={kind:'clear'|'return'|'cancel'|'endorse';cheque:Cheque;key:string};
type Registration={direction:ChequeDirection;partyId?:string;claimId?:string};
const errorText=(e:unknown)=>e instanceof Error?e.message:'تعذر تنفيذ العملية.';
const date=(value:string)=>formatUiDate(value,{year:'numeric',month:'2-digit',day:'2-digit'});

export function ChequesView() {
  const drawer=useDrawerShortfallConfirm();
  const {roles}=useAuthStore(),canManage=roles.some(r=>r==='owner'||r==='manager'),owner=roles.includes('owner');
  const branchId=useAppStoreSelector(s=>s.activeBranch?.id??null);
  const [data,setData]=useState<ChequePage|null>(null),[page,setPage]=useState(1),[status,setStatus]=useState<ChequeFilter>('all');
  const [direction,setDirection]=useState<ChequeDirection|'all'>('all'),[search,setSearch]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0);
  const [detail,setDetail]=useState<ChequeDetail|null>(null),[action,setAction]=useState<Action|null>(null),[reason,setReason]=useState('');
  const [suppliers,setSuppliers]=useState<ChequeParty[]>([]),[customers,setCustomers]=useState<ChequeParty[]>([]),[partySearch,setPartySearch]=useState('');
  const [registration,setRegistration]=useState<Registration|null>(null),[endorseSupplier,setEndorseSupplier]=useState('');
  const [payment,setPayment]=useState<{claimId:string;supplierId:string;reference:string;key:string}|null>(null);
  const [paymentAmount,setPaymentAmount]=useState(''),[paymentMethod,setPaymentMethod]=useState<'cash'|'cliq'|'bank_transfer'>('cash');
  const [paymentReference,setPaymentReference]=useState('');const ids=useId();
  const [reversal,setReversal]=useState<{paymentId:string;amount:number;key:string}|null>(null),[reversalReason,setReversalReason]=useState('');
  useEffect(()=>{if(!canManage)return;let live=true;setBusy(true);setError('');
    fetchCheques({page,status,direction,branchId,search}).then(r=>{if(live)setData(r);}).catch(e=>{if(live)setError(errorText(e));})
      .finally(()=>{if(live)setBusy(false);});return()=>{live=false;};
  },[page,status,direction,branchId,search,revision,canManage]);
  useEffect(()=>{if(!canManage)return;let live=true;
    fetchSuppliersFromSupabase().then(s=>{if(live)setSuppliers(s.map(s=>({id:s.id,name:s.companyName,phone:s.phone})));})
      .catch(e=>{if(live)setError(errorText(e));});return()=>{live=false;};
  },[canManage]);
  useEffect(()=>{if(!registration||registration.direction!=='incoming'||!canManage)return;let live=true;
    fetchPosCustomersFromSupabase({page:1,pageSize:100,search:partySearch}).then(r=>{if(live)setCustomers(r.customers);})
      .catch(e=>{if(live)setError(errorText(e));});return()=>{live=false;};
  },[registration,partySearch,canManage]);
  const refresh=useCallback(()=>setRevision(r=>r+1),[]);
  const openDetail=async(c:Cheque)=>{setBusy(true);setError('');try{setDetail(await fetchChequeDetail(c.id));}catch(e){setError(errorText(e));}finally{setBusy(false);}};
  const begin=(kind:Action['kind'],c:Cheque)=>{setReason('');setEndorseSupplier('');setAction({kind,cheque:c,key:newChequeKey()});};
  const runAction=async()=>{
    if(!action)return;setBusy(true);setError('');
    try {
      const {cheque:c,key,kind}=action;
      if(kind==='clear')await clearCheque(c.id,c.version,key);
      else if(kind==='return')await returnCheque(c.id,c.version,reason,key);
      else if(kind==='cancel')await cancelCheque(c.id,c.version,reason,key);
      else await endorseCheque(c.id,endorseSupplier,c.version,key);
      setAction(null);setDetail(await fetchChequeDetail(c.id));refresh();setNotice('تم حفظ العملية.');
    }catch(e){setError(errorText(e));}finally{setBusy(false);}
  };
  const pay=async(event:React.FormEvent)=>{
    event.preventDefault();if(!payment)return;const minor=parseJodToMinor(paymentAmount);
    if(minor===null||minor==='0'){setError('أدخل مبلغاً صحيحاً أكبر من صفر.');return;}
    if(!drawer.confirmCash(Number(minor)/1000,paymentMethod==='cash',branchId))return;
    setBusy(true);setError('');
    try{await paySupplierChequeClaim({claimId:payment.claimId,branchId,amount:Number(minor),method:paymentMethod,
      reference:paymentReference,notes:'سداد قيد شيك مستقل',key:payment.key});
      setPayment(null);if(detail)setDetail(await fetchChequeDetail(detail.cheque.id));refresh();setNotice('تم سداد قيد المورد.');
    }catch(e){setError(errorText(e));}finally{setBusy(false);}
  };
  const reversePayment=async()=>{
    if(!reversal||!owner||reversalReason.trim().length<5||reversalReason.trim().length>500)return;
    setBusy(true);setError('');
    try{await reverseSupplierChequeClaimPayment(reversal.paymentId,reversalReason,reversal.key);
      setReversal(null);if(detail)setDetail(await fetchChequeDetail(detail.cheque.id));refresh();setNotice('تم عكس سداد القيد وإعادة ذمة المورد.');
    }catch(e){setError(errorText(e));}finally{setBusy(false);}
  };
  const errors=error?<p role="alert" className="rounded-xl bg-nw-bad-bg p-3 text-sm text-nw-bad">{error}</p>:null;
  if(!canManage)return <Card className="m-4"><h1 className="text-xl font-bold">الشيكات</h1><p>هذه الصفحة للمالك والمدير. استلام شيك العميل متاح من التحصيل أو نقطة البيع للأدوار المصرّح لها.</p></Card>;
  return <main dir="rtl" className="min-w-0 pb-28 text-nw-text" data-testid="cheques-workbench">
    <PageHeader title="الشيكات" description="استلام وإصدار ومتابعة الشيكات دون حركة على درج الصندوق" actions={<>
      <UiButton variant="primary" disabled={busy} onClick={()=>setRegistration({direction:'incoming'})}>استلام شيك</UiButton>
      <UiButton variant="accent" disabled={busy} onClick={()=>setRegistration({direction:'outgoing'})}>إصدار شيك</UiButton>
    </>} />
    <div className="space-y-4 p-4 lg:p-8">
      {errors}{notice&&<p role="status" className="rounded-xl bg-nw-ok-bg p-3 text-sm text-nw-ok">{notice}</p>}
      <KpiGrid>
        <KpiCard label="شيكات واردة قيد المتابعة" value={data?<MoneyText amount={data.summary.incoming/1000} />:'غير متاح'} note="تشمل المُجيّرة؛ ليست ديناً إضافياً" />
        <KpiCard label="شيكات صادرة قائمة" value={data?<MoneyText amount={data.summary.outgoing/1000} />:'غير متاح'} />
        <KpiCard label="من الوارد: شيكات مُجيّرة" value={data?<MoneyText amount={data.summary.endorsed/1000} />:'غير متاح'} />
      </KpiGrid>
      <div className="flex flex-wrap gap-3">
        <SearchField className="min-w-0 flex-1" label="البحث في الشيكات" placeholder="رقم الشيك أو البنك أو الطرف" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} />
        <SegmentedControl label="اتجاه الشيك" options={[{value:'all',label:'الكل'},{value:'incoming',label:'وارد'},{value:'outgoing',label:'صادر'}]} value={direction}
          onChange={v=>{setDirection(v);setPage(1);}} />
      </div>
      <FilterChips label="حالة الشيكات" options={filters.map(f=>({...f,count:data?.counts[f.value]}))} value={status} onChange={v=>{setStatus(v);setPage(1);}} touchSize />
      {busy&&!data&&<p role="status">جارٍ تحميل الشيكات…</p>}
      {data&&<>
        <div className="hidden md:block"><TableShell caption="قائمة الشيكات" head={<><Th>الشيك</Th><Th>الطرف</Th><Th>البنك</Th><Th>الاستحقاق</Th><Th>الحالة</Th><Th>المبلغ</Th></>}>
          {data.items.map(c=><Tr key={c.id} selected={detail?.cheque.id===c.id}><Td><UiButton variant="plain" className="whitespace-nowrap" onClick={()=>void openDetail(c)} aria-label={`تفاصيل الشيك ${c.number}`}><bdi>{c.number}</bdi></UiButton></Td>
            <Td>{c.customerName||c.supplierName}{c.endorsedSupplierName&&<span className="block text-xs text-nw-muted">مُجيّر لـ{c.endorsedSupplierName}</span>}</Td>
            <Td>{c.bank}</Td><Td className="whitespace-nowrap">{date(c.dueDate)}</Td><Td><StatusBadge tone={tone(c.status)}>{chequeStatusLabels[c.status]}</StatusBadge></Td>
            <Td><MoneyText amount={c.amount/1000} /></Td></Tr>)}
        </TableShell></div>
        <div className="space-y-3 md:hidden">{data.items.map(c=><Card key={c.id}>
          <UiButton variant="plain" className="!h-auto w-full min-w-0 flex-col !items-stretch !justify-start !p-0 text-right" onClick={()=>void openDetail(c)} aria-label={`تفاصيل الشيك ${c.number}`}>
            <span className="flex flex-wrap items-center justify-between gap-2"><bdi>{c.number}</bdi><StatusBadge tone={tone(c.status)}>{chequeStatusLabels[c.status]}</StatusBadge></span>
            <span className="break-words text-sm">{c.customerName||c.supplierName} · {c.bank}</span>
            {c.endorsedSupplierName&&<span className="break-words text-sm text-nw-muted">مُجيّر لـ{c.endorsedSupplierName}</span>}
            <span className="flex flex-wrap justify-between gap-2 text-sm"><span>{date(c.dueDate)}</span><MoneyText amount={c.amount/1000} /></span>
          </UiButton>
        </Card>)}</div>
        {data.items.length===0&&<Card>لا توجد شيكات مطابقة.</Card>}
        <div className="flex items-center justify-between gap-3 text-sm"><UiButton disabled={page<=1||busy} onClick={()=>setPage(p=>p-1)}>السابق</UiButton>
          <span>صفحة <bdi>{page}</bdi></span><UiButton disabled={!data.hasMore||busy} onClick={()=>setPage(p=>p+1)}>التالي</UiButton></div>
        <Card><SectionHeader title="المجاميع حسب أسبوع الاستحقاق" hint="شيكات قيد الانتظار أو مُجيّرة؛ ليست مصروفات أو أرباحاً" />
          <ul className="mt-3 list-none space-y-2 p-0 text-sm">{data.weeks.map(w=><li key={`${w.weekStart}-${w.direction}`} className="flex flex-wrap justify-between gap-2">
            <span>{date(w.weekStart)} · {w.direction==='incoming'?'وارد':'صادر'}</span><MoneyText amount={w.amount/1000} />
          </li>)}</ul>
        </Card>
      </>}
    </div>
    <Modal isOpen={detail!==null} onClose={()=>setDetail(null)} title="تفاصيل الشيك" maxWidth="max-w-2xl" closeDisabled={busy}>
      {detail&&<div className="space-y-4 text-sm" data-testid="cheque-detail">
        <div className="flex flex-wrap items-center justify-between gap-2"><bdi className="text-xl font-bold">{detail.cheque.number}</bdi><StatusBadge tone={tone(detail.cheque.status)}>{chequeStatusLabels[detail.cheque.status]}</StatusBadge></div>
        <p>{detail.cheque.bank} · الاستحقاق {date(detail.cheque.dueDate)}</p>
        <MoneyText className="text-3xl font-bold" amount={detail.cheque.amount/1000} currency />
        {detail.cheque.origin==='opening'&&<p className="text-nw-muted">شيك قائم قبل النظام — تسجيله للمتابعة فقط، دون خصم جديد من الرصيد.</p>}
        {['pending','endorsed'].includes(detail.cheque.status)&&<div className="sticky top-0 z-10 flex flex-wrap gap-2 border-y border-nw-border bg-nw-surface py-3">
          <UiButton variant="primary" onClick={()=>begin('clear',detail.cheque)} disabled={busy}>صُرف</UiButton>
          <UiButton variant="danger" onClick={()=>begin('return',detail.cheque)} disabled={busy}>شيك راجع</UiButton>
          {detail.cheque.status==='pending'&&detail.cheque.direction==='incoming'&&<UiButton onClick={()=>begin('endorse',detail.cheque)} disabled={busy}>تجيير لمورد</UiButton>}
          {owner&&detail.cheque.status==='pending'&&<UiButton onClick={()=>begin('cancel',detail.cheque)} disabled={busy}>إلغاء تسجيل خاطئ</UiButton>}
        </div>}
        <section><h2 className="font-bold">أصول الدين المثبتة</h2><ul className="list-none space-y-2 p-0">{detail.allocations.map(a=><li key={a.id} className="flex flex-wrap justify-between gap-2">
          <span>{a.partyKind==='customer'?'العميل':'المورد'} · {a.originalDebtAt?date(a.originalDebtAt):'عمر غير متاح'}</span><MoneyText amount={a.amount/1000} />
        </li>)}</ul></section>
        {detail.claims.map(c=><Card key={c.id}><h2 className="font-bold">{c.reference}</h2><p>{c.reason}</p><p>{c.partyKind==='customer'?'قيد دين عميل':'قيد ذمة مورد'} · <MoneyText amount={c.amount/1000} /></p>
          <p className="text-nw-muted">قيد مستقل؛ الدفعة والطلب والمرتجع الأصلي دون تعديل.</p>
          {c.partyKind==='customer'&&<p>يُحصّل من «تحصيل من الزبون» وفق الأقدم أولاً.</p>}
        </Card>)}
        {detail.supplierClaims.filter(c=>c.outstanding>0).map(c=><div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-nw-border p-3">
          <span>متبقي قيد المورد <MoneyText amount={c.outstanding/1000} /></span>
          <UiButton onClick={()=>{drawer.reset();setPayment({claimId:c.id,supplierId:detail.cheque.supplierId??detail.cheque.endorsedSupplierId??'',reference:c.reference,key:newChequeKey()});setPaymentAmount('');setPaymentReference('');}}>سداد قيد المورد</UiButton>
        </div>)}
        {detail.supplierClaimPayments.length>0&&<section aria-label="دفعات سداد القيد"><h2 className="font-bold">دفعات سداد القيد</h2>
          <ul className="list-none space-y-2 p-0">{detail.supplierClaimPayments.map(p=><li key={p.id} className="space-y-2 rounded-xl border border-nw-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><MoneyText amount={p.amount/1000} />
              <span>{p.method==='cash'?'كاش':p.method==='cliq'?'CliQ':p.method==='bank_transfer'?'تحويل بنكي':'شيك مؤجل'} · {date(p.paidAt)}</span></div>
            {p.isReversed?<p className="text-nw-muted">سداد معكوس · {p.reason}</p>:owner&&p.canReverse?
              <UiButton variant="danger" disabled={busy} onClick={()=>{setReversalReason('');setReversal({paymentId:p.id,amount:p.amount,key:newChequeKey()});}}>عكس سداد القيد</UiButton>:null}
          </li>)}</ul>
        </section>}
        <section><h2 className="font-bold">سجل الشيك</h2><ol className="space-y-2 ps-5">{detail.events.map(e=><li key={e.id}>
          {e.kind==='received'?'استلام':e.kind==='issued'?'إصدار':e.kind==='opening_registered'?'شيك قائم قبل النظام':chequeStatusLabels[e.kind as Cheque['status']]??e.kind}
          {' · '}{date(e.at)} · {e.actor}{e.reason&&<p className="text-nw-muted">{e.reason}</p>}
        </li>)}</ol></section>
      </div>}
    </Modal>
    <Modal isOpen={action!==null} onClose={()=>setAction(null)} title={action?.kind==='cancel'?'إلغاء تسجيل خاطئ':action?.kind==='return'?'تسجيل شيك راجع':action?.kind==='endorse'?'تجيير الشيك لمورد':'تأكيد صرف الشيك'} closeDisabled={busy}>
      {action&&<div className="space-y-4 text-sm">{errors}
        <p>شيك <bdi>{action.cheque.number}</bdi> بقيمة <MoneyText amount={action.cheque.amount/1000} currency /></p>
        <p>{action.kind==='clear'?'تأكيد الصرف لا يسجل حركة جديدة على الدرج أو دفعة ثانية.':action.kind==='endorse'?'تُنقص ذمة المورد بقيمة الشيك كاملة، دون حركة على الدرج.':
          action.kind==='cancel'?'سيُنشأ قيد مستقل «إلغاء تسجيل شيك» بقيمته كاملة؛ لا عكس للدفعة الأصلية، ولا وسم شيك راجع.':'سيُنشأ قيد دين تعويضي بقيمته كاملة، مع بقاء الدفعة والمرتجعات كما هي.'}</p>
        {action.kind==='return'&&action.cheque.endorsedSupplierId&&<p className="font-bold text-nw-warn">سيعود دين العميل وذمة المورد معاً في معاملة واحدة.</p>}
        {(action.kind==='return'||action.kind==='cancel')&&<div><label htmlFor={`${ids}-reason`} className="mb-1 block font-semibold">السبب الإلزامي</label>
          <textarea id={`${ids}-reason`} className={`${field} !h-24 py-3`} value={reason} maxLength={500} disabled={busy} onChange={e=>setReason(e.target.value)} /></div>}
        {action.kind==='endorse'&&<div><label htmlFor={`${ids}-endorse`} className="mb-1 block font-semibold">المورد</label><select id={`${ids}-endorse`} className={field} value={endorseSupplier} disabled={busy} onChange={e=>setEndorseSupplier(e.target.value)}>
          <option value="">اختر المورد</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div>}
        <div className="flex flex-wrap gap-2"><UiButton variant={action.kind==='return'||action.kind==='cancel'?'danger':'accent'}
          disabled={busy||((action.kind==='return'||action.kind==='cancel')&&reason.trim().length<5)||(action.kind==='endorse'&&!endorseSupplier)} onClick={()=>void runAction()}>تأكيد العملية</UiButton>
          <UiButton disabled={busy} onClick={()=>setAction(null)}>رجوع</UiButton></div>
      </div>}
    </Modal>
    <Modal isOpen={reversal!==null} onClose={()=>setReversal(null)} title="عكس سداد قيد المورد" closeDisabled={busy} confirmUnsavedClose>
      {reversal&&<div className="space-y-4 text-sm">{errors}
        <p>ستعود ذمة المورد بقيمة <MoneyText amount={reversal.amount/1000} currency />. لا تُعكس دفعة الشيك الأصلية.</p>
        <p>الكاش وCliQ يتطلبان بقاء وردية الدفعة الأصلية مفتوحة؛ التحويل البنكي بلا أثر على الدرج.</p>
        <label className="block" htmlFor={`${ids}-reversal-reason`}>سبب عكس السداد (5–500 حرف)</label>
        <textarea id={`${ids}-reversal-reason`} className={`${field} !h-24 py-3`} value={reversalReason} maxLength={500} disabled={busy} onChange={e=>setReversalReason(e.target.value)} />
        <div className="flex flex-wrap gap-2"><UiButton variant="danger" disabled={busy||reversalReason.trim().length<5||reversalReason.trim().length>500} onClick={()=>void reversePayment()}>تأكيد عكس السداد</UiButton>
          <UiButton disabled={busy} onClick={()=>setReversal(null)}>رجوع</UiButton></div>
      </div>}
    </Modal>
    <Modal isOpen={registration!==null} onClose={()=>setRegistration(null)} title={registration?.direction==='outgoing'?'إصدار شيك مورد':'استلام شيك عميل'} confirmUnsavedClose>
      {registration&&<>
        {registration.direction==='incoming'&&!registration.partyId&&<SearchField label="البحث عن عميل للشيك" placeholder="اسم العميل أو الهاتف" value={partySearch} onChange={e=>setPartySearch(e.target.value)} className="mb-3" />}
        <ChequeRegistrationForm key={`${registration.direction}-${registration.partyId??''}-${registration.claimId??''}`} direction={registration.direction}
          parties={registration.direction==='incoming'?customers:suppliers} partyId={registration.partyId} claimId={registration.claimId} branchId={branchId}
          onClose={()=>setRegistration(null)} onSaved={()=>{setRegistration(null);setDetail(null);setNotice('تم تسجيل الشيك.');refresh();}} />
      </>}
    </Modal>
    <Modal isOpen={payment!==null} onClose={()=>setPayment(null)} title="سداد قيد ذمة المورد" closeDisabled={busy} confirmUnsavedClose>
      {payment&&<FormFields><form className="space-y-3 text-sm" onSubmit={e=>void pay(e)} aria-busy={busy}>{errors}{drawer.warningNode}<p>{payment.reference}</p>
        <label className="block" htmlFor={`${ids}-pay-amount`}>المبلغ (د.أ)</label><input id={`${ids}-pay-amount`} className={field} value={paymentAmount} onChange={e=>setPaymentAmount(e.target.value)} inputMode="decimal" dir="ltr" required disabled={busy} />
        <label className="block" htmlFor={`${ids}-pay-method`}>طريقة الدفع</label><select id={`${ids}-pay-method`} className={field} value={paymentMethod} onChange={e=>{const v=e.target.value;if(v==='cash'||v==='cliq'||v==='bank_transfer')setPaymentMethod(v);}} disabled={busy}>
          <option value="cash">كاش من وردية الفرع</option><option value="cliq">CliQ من وردية الفرع</option><option value="bank_transfer">تحويل بنكي بلا وردية</option></select>
        <label className="block" htmlFor={`${ids}-pay-reference`}>المرجع</label><input id={`${ids}-pay-reference`} className={field} value={paymentReference} onChange={e=>setPaymentReference(e.target.value)} disabled={busy} />
        <p className="text-nw-muted">دفعة مستقلة، لا تُسجّل مقابل أمر شراء أو استلام أصلي.</p>
        <div className="flex flex-wrap gap-2"><UiButton type="submit" variant="accent" disabled={busy}>تأكيد السداد</UiButton>
          <UiButton disabled={busy} onClick={()=>{setRegistration({direction:'outgoing',partyId:payment.supplierId,claimId:payment.claimId});setPayment(null);}}>السداد بشيك مؤجل</UiButton>
          <UiButton disabled={busy} onClick={()=>setPayment(null)}>إلغاء</UiButton></div>
      </form></FormFields>}
    </Modal>
  </main>;
}
