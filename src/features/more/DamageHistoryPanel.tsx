import {lazy,Suspense,useCallback,useEffect,useState} from 'react';
import {Modal} from '../../components/common/Modal';
import {Card,FormFields,SearchField,UiButton,formatUiDate} from '../../components/ui';
import {ProductGlyph} from '../../components/ui/ProductGlyph';
import {useAuthStore} from '../../stores/useAuthStore';
import {useAppStoreActions} from '../../stores/useAppStore';
import {canUseSupplierReplacement,type SupplierReplacementCase} from '../../utils/supplierReplacement';
import {canReadSalesHistory} from '../../utils/salesHistory';
import {damage215States,type Damage215Page,type Damage215Row,type Damage215State} from '../../utils/damageLedger215';
import {formatExactMinorJod,formatExactUnitCostJod,parcelPacketQuantity} from '../../utils/aftercare215Money';
import {fetchDamageLedger215} from '../../services/supabase/damageLedger215.service';
import {damageHistoryReasons,type DamageHistoryPeriod} from '../../services/supabase/damageHistory.service';
import {aftercareSupplierBlockedMessage} from '../../services/supabase/supplierReplacement.service';
import {businessErrorMessage} from '../../utils/businessError';
import {SupplierReplacementPanel} from '../inventory/SupplierReplacementPanel';
import {AftercareSupplierSafety} from '../orders/AftercareSupplierSafety';
const SalesInvoiceDialog=lazy(()=>import('../salesHistory/SalesInvoiceDialog').then(m=>({default:m.SalesInvoiceDialog})));
const movementLabels:Record<string,string>={shop_breakage:'تالف من المخزون',expired:'تالف من المخزون',storage_damage:'تالف من المخزون',other:'تالف من المخزون',
  customer_return_final:'من مرتجع زبون',customer_replacement:'من استبدال زبون',supplier_send:'أُرسل للمورد',supplier_received:'استُبدل من المورد',supplier_credited:'خُصم من حساب المورد',supplier_refused:'رفض المورد — خسارة نهائية',supplier_reverse:'عكس قرار المورد'};
type Action={scope:string;row:Damage215Row;type:'reverse';reversal:{item:SupplierReplacementCase;eventId:string}}
  |{scope:string;row:Damage215Row;type:'reclassify'}|{scope:string;row:Damage215Row;type:'decision';decision:{item:SupplierReplacementCase;action:'receive'|'writeoff'}};
export function DamageHistoryPanel(){
  const {user,roleName,roles}=useAuthStore(),allowed=canUseSupplierReplacement(roles,roleName),owner=roleName==='owner'||roles.includes('owner'),readInvoice=canReadSalesHistory(roles,roleName);
  const {setToast}=useAppStoreActions();
  const [period,setPeriod]=useState<DamageHistoryPeriod>('today'),[reason,setReason]=useState('all'),[filter,setFilter]=useState<'all'|Damage215State>('all'),[search,setSearch]=useState('');
  const [from,setFrom]=useState(''),[to,setTo]=useState(''),[page,setPage]=useState(1),[revision,setRevision]=useState(0);
  const [state,setState]=useState<{scope:string;data?:Damage215Page;error?:string}>({scope:''}),[action,setAction]=useState<Action|null>(null),[actionBusy,setActionBusy]=useState(false),[invoice,setInvoice]=useState<{scope:string;id:string}|null>(null);
  const scope=[user?.id,roleName,[...roles].sort().join(','),period,reason,filter,search,from,to,page,revision].join('|');
  const valid=period!=='range'||(/^\d{4}-\d{2}-\d{2}$/u.test(from)&&/^\d{4}-\d{2}-\d{2}$/u.test(to)&&from<=to);
  useEffect(()=>{if(!allowed||!valid)return;const controller=new AbortController(),timer=setTimeout(()=>{
    void fetchDamageLedger215({period,reason,state:filter,search,page,from,to},owner,controller.signal).then(data=>{if(!controller.signal.aborted)setState({scope,data});})
      .catch(cause=>{if(!controller.signal.aborted)setState({scope,error:businessErrorMessage(cause)});});
  },search?250:0);return()=>{controller.abort();clearTimeout(timer);};},[scope,allowed,valid,period,reason,filter,search,page,from,to,owner]);
  const changed=useCallback(async()=>{setAction(null);setActionBusy(false);setRevision(n=>n+1);},[]);
  if(!allowed)return <p role="alert">لا تملك صلاحية قراءة سجل التالف.</p>;
  const data=state.scope===scope?state.data:undefined,error=state.scope===scope?state.error:undefined;
  const currentAction=action?.scope===scope?action:null;
  const candidate=currentAction?.type==='reclassify'&&currentAction.row.owner?.reclassification?{
    ...currentAction.row.owner.reclassification,id:currentAction.row.owner.reclassification.sourceId,productId:currentAction.row.productId,productName:currentAction.row.productName,quantity:currentAction.row.quantity,occurredAt:currentAction.row.registeredAt}:undefined;
  return <FormFields className="min-w-0 space-y-3" data-testid="damage-history">
    <div className="grid gap-3 sm:grid-cols-2"><label>الفترة<select aria-label="الفترة" value={period} onChange={e=>{setPeriod(e.target.value as DamageHistoryPeriod);setPage(1);}}><option value="today">اليوم</option><option value="week">الأسبوع</option><option value="month">الشهر</option><option value="range">مخصص</option></select></label>
      <label>الحالة<select aria-label="الحالة" value={filter} onChange={e=>{setFilter(e.target.value as typeof filter);setPage(1);}}><option value="all">كل الحالات</option>{Object.entries(damage215States).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label>سبب التلف<select aria-label="سبب التلف" value={reason} onChange={e=>{setReason(e.target.value);setPage(1);}}><option value="all">كل الأسباب</option>{Object.entries({...damageHistoryReasons,shop_pending:'أُرسل للمورد من المخزون',shop_immediate:'استبدال فوري من المورد'}).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      {period==='range'&&<><label>من تاريخ<input aria-label="من تاريخ" type="date" value={from} onChange={e=>{setFrom(e.target.value);setPage(1);}}/></label><label>إلى تاريخ<input aria-label="إلى تاريخ" type="date" min={from||undefined} value={to} onChange={e=>{setTo(e.target.value);setPage(1);}}/></label></>}
    </div><SearchField label="بحث سجل التالف" placeholder="اسم الصنف أو رمز الصنف" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>
    <p className="text-sm text-nw-muted">الحالة الحالية للكميات، والخسارة لحركات الفترة المختارة. قد ينقسم المصدر بين أكثر من حالة؛ لا يتكرر مبلغ خسارته.</p>
    {!valid?<p role="status">اختر تاريخ البداية والنهاية بترتيب صحيح وبفترة لا تتجاوز سنة.</p>:error?<div role="alert"><p>{error}</p><UiButton onClick={()=>setRevision(n=>n+1)}>إعادة المحاولة</UiButton></div>:!data?<p role="status">جاري قراءة سجل التالف…</p>:<>
      {owner&&data.periodLossInMinorUnits!==undefined&&<Card><p className="font-bold">صافي خسارة الفترة: <bdi dir="ltr">{formatExactMinorJod(data.periodLossInMinorUnits)}</bdi></p><p className="text-xs text-nw-muted">يشمل العكس وإعادة التصنيف. السالب استرداد أو تخفيض للخسارة؛ لا يُخصم مرة ثانية من الربح.</p></Card>}
      {data.quantitySummary.length>0&&<details><summary className="min-h-11 cursor-pointer py-3">ملخص الكميات حسب الصنف</summary><ul className="space-y-2 text-sm">{data.quantitySummary.map(p=><li key={p.productId}>{p.productName}: بانتظار المورد {p.pending} باكيت · انتهى مع المورد {p.finished} باكيت · خسارة نهائية {p.final} باكيت</li>)}</ul></details>}
      {!data.rows.length?<p role="status">لا يوجد تالف مسجّل في هذه الفترة.</p>:data.rows.map(row=>{
        const reversal=row.owner?.cases.flatMap(item=>item.events.filter(e=>e.action==='damage'&&!e.isReversed).map(e=>({item,eventId:e.id})))[0];
        return <Card key={row.source+row.id} className="min-w-0 space-y-3" data-damage-history-row={row.id}>
          <div className="flex min-w-0 items-center gap-3"><ProductGlyph name={row.productName} image={row.imageUrl??undefined} className="h-10 w-10 shrink-0"/><h4 className="min-w-0 break-words font-bold">{row.productName}</h4></div>
          {row.financialOnly?<p className="text-sm">{row.source==='replacement'?'فرق تكلفة استبدال بلا باكيتات تالفة':'عكس أو إعادة تصنيف بلا باكيتات تالفة متبقية'}</p>:<p className="flex flex-wrap gap-1 font-semibold"><span>الكمية: </span><span>{parcelPacketQuantity(row.quantity,row.historicalParcelSize)}</span></p>}
          {!row.parcelSizeKnown&&!row.financialOnly&&<p className="text-xs text-nw-muted">حجم الطرد التاريخي غير محفوظ لهذا المصدر؛ عُرضت الباكيتات دون افتراض الحجم الحالي.</p>}
          <p className="break-words text-sm">{row.reason}</p><div className="space-y-1 text-sm">{row.states.map(s=><p key={s.state}>{damage215States[s.state]}: {parcelPacketQuantity(s.quantity,row.historicalParcelSize)}</p>)}</div>
          <p className="text-xs text-nw-muted">آخر حركة: {formatUiDate(row.occurredAt,{dateStyle:'short',timeStyle:'short'})}</p>
          {row.document&&<div className="min-w-0 space-y-1 text-sm"><span>المستند:</span> {readInvoice?<UiButton className="max-w-full whitespace-normal break-all" onClick={()=>setInvoice({scope,id:row.document!.id})}><bdi>{row.document.number}{row.document.returnNumber?` · ${row.document.returnNumber}`:''}</bdi></UiButton>:<span className="break-all">{row.document.number}{row.document.returnNumber?` · ${row.document.returnNumber}`:''}</span>}</div>}
          {owner&&row.owner&&<dl className="space-y-1 text-sm"><div className="flex flex-wrap justify-between gap-2"><dt>تكلفة الباكيت التاريخية</dt><dd><bdi dir="ltr">{formatExactUnitCostJod(row.owner.unitCostInMinorUnitsExact)}</bdi></dd></div><div className="flex flex-wrap justify-between gap-2"><dt>صافي خسارة المصدر في الفترة</dt><dd><bdi dir="ltr">{formatExactMinorJod(row.owner.periodLossInMinorUnits)}</bdi></dd></div>
            {row.owner.costDifferenceInMinorUnits!=='0'&&<div><dt>فرق تكلفة الاستبدال عند الأصل (للتوضيح)</dt><dd><bdi dir="ltr">{formatExactMinorJod(row.owner.costDifferenceInMinorUnits)}</bdi></dd></div>}</dl>}
          <details><summary className="min-h-11 cursor-pointer py-3 text-sm">حركات المصدر في الفترة</summary><ul className="space-y-3 text-sm">{row.movements.map(m=><li key={m.id}><p>{movementLabels[m.action]??(row.source==='damage'?'تالف من المخزون':row.source==='replacement'?'من استبدال زبون':'حركة مورد')} · {parcelPacketQuantity(m.quantity,row.historicalParcelSize)}</p><p>{m.reason}</p><p className="text-xs text-nw-muted">{formatUiDate(m.occurredAt,{dateStyle:'short',timeStyle:'short'})}{owner&&m.lossDeltaInMinorUnits!==undefined&&<> · <bdi dir="ltr">{formatExactMinorJod(m.lossDeltaInMinorUnits)}</bdi></>}</p></li>)}</ul></details>
          {owner&&row.owner&&<details><summary className="min-h-11 cursor-pointer py-3 text-sm">⋯ قرارات المصدر</summary>
            {row.owner.cases.filter(c=>c.pendingQuantity>0).map(item=><div key={item.id} className="space-y-2 py-2"><p>{item.supplierName??'المورد'} · بانتظاره {item.pendingQuantity} باكيت</p><div className="flex flex-wrap gap-2"><UiButton onClick={()=>setAction({scope,row,type:'decision',decision:{item,action:'receive'}})}>استلام البديل</UiButton><UiButton onClick={()=>setAction({scope,row,type:'decision',decision:{item,action:'writeoff'}})}>رفض المورد — خسارة نهائية</UiButton></div></div>)}
            {reversal&&<UiButton onClick={()=>setAction({scope,row,type:'reverse',reversal})}>إلغاء تالف المخزون (عكس)</UiButton>}
            {row.owner.reclassification&&(row.owner.reclassification.blockedReason?<p className="text-sm text-nw-muted">{aftercareSupplierBlockedMessage(row.owner.reclassification.blockedReason)}</p>:<UiButton onClick={()=>setAction({scope,row,type:'reclassify'})}>حوّلها للمورد بانتظار البديل</UiButton>)}
          </details>}
        </Card>;})}
      <nav aria-label="صفحات سجل التالف" className="flex flex-wrap items-center justify-center gap-3"><UiButton disabled={page<=1} onClick={()=>setPage(n=>n-1)}>السابق</UiButton><span>{page} / {data.totalPages}</span><UiButton disabled={page>=data.totalPages} onClick={()=>setPage(n=>n+1)}>التالي</UiButton></nav>
    </>}
    {owner&&currentAction&&<Modal isOpen onClose={()=>{if(!actionBusy)setAction(null);}} trackChanges={false} title={currentAction.type==='reverse'?'معاينة إلغاء تالف المخزون':currentAction.type==='decision'?'قرار المورد':'تحويل التالف للمورد'}>
      {currentAction.type==='reverse'?<SupplierReplacementPanel initialReversal={currentAction.reversal} onPendingChange={setActionBusy} onSaved={()=>void changed()}/>:currentAction.type==='decision'?<SupplierReplacementPanel initialCaseAction={currentAction.decision} onPendingChange={setActionBusy} onSaved={()=>void changed()}/>:candidate&&currentAction.row.document?<AftercareSupplierSafety orderId={currentAction.row.document.id} initialCandidate={candidate} disabled={false} onPendingChange={setActionBusy} onChanged={changed} notify={setToast}/>:null}
    </Modal>}
    {invoice?.scope===scope&&readInvoice&&<Suspense fallback={<p role="status">جاري فتح الفاتورة…</p>}><SalesInvoiceDialog nested orderId={invoice.id} onClose={()=>setInvoice(null)}/></Suspense>}
  </FormFields>;
}
