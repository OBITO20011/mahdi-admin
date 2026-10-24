import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {Modal} from '../../components/common/Modal';
import {MoneyText,UiButton,formatUiDate} from '../../components/ui';
import {useAuthStore} from '../../stores/useAuthStore';
import {hasNavigationRole} from '../more/adminNavigation.config';
import {fetchCashShiftMovementPage,type CashShiftMovementPage,type CashShiftMovement} from '../../services/supabase/cashShiftMovements.service';
import {CashMovementDocument} from './CashMovementDocument';
import type {CashFlowRow} from './cashFlowModel';

export function CashFlowDetails({shiftId,row,onClose}:{shiftId:string;row:CashFlowRow;onClose:()=>void}) {
  const {user,roleName,roles}=useAuthStore();
  const allowed=hasNavigationRole(['owner','admin','manager','accountant'],roleName,roles);
  const [page,setPage]=useState(1),[retry,setRetry]=useState(0);
  const [data,setData]=useState<CashShiftMovementPage|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const scope=[user?.id,allowed,shiftId,row.kind,row.method,page,retry].join(':');
  const [loadedScope,setLoadedScope]=useState('');
  const [selectedDocument,setDocument]=useState<CashShiftMovement|null>(null);
  useEffect(()=>{
    const controller=new AbortController();setData(null);setDocument(null);setError('');setLoading(true);
    if(!allowed){setLoading(false);return()=>controller.abort();}
    void fetchCashShiftMovementPage(shiftId,row.kind,row.method,page,controller.signal)
      .then(value=>{if(!controller.signal.aborted)setData(value);})
      .catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'تعذر تحميل التفاصيل.');})
      .finally(()=>{if(!controller.signal.aborted){setLoading(false);setLoadedScope(scope);}});
    return()=>controller.abort();
  },[shiftId,row.kind,row.method,page,retry,allowed,user?.id,scope]);
  return createPortal(<Modal isOpen onClose={onClose} trackChanges={false} title={`تفصيل ${row.label}`}>
    {!allowed?<p role="alert">لا تملك صلاحية تفاصيل الوردية.</p>:loading||loadedScope!==scope?<p role="status">جاري تحميل العمليات…</p>:error?<div role="alert"><p>{error}</p><UiButton onClick={()=>setRetry(value=>value+1)}>إعادة المحاولة</UiButton></div>:data&&<div className="space-y-3">
      <p className="text-sm">مجموع العمليات المثبتة: <MoneyText amount={data.totalAmountInMinorUnits/1000} currency/> · {data.totalCount} عملية</p>
      {(data.evidenceStatus!=='matched'||data.canonicalAmountInMinorUnits!==Math.round(row.amount*1000))&&<div role="status" className="rounded-xl bg-nw-warn-bg p-3 text-sm text-nw-warn"><p>التفاصيل لا تطابق مبلغ العرض؛ قد تكون القراءة تغيّرت أو الدليل التاريخي ناقصاً. مبلغ الإغلاق المحفوظ يبقى كما هو.</p><p>مبلغ العرض: <MoneyText amount={row.amount}/> · إجمالي القارئ الحالي: {data.canonicalAmountInMinorUnits===null?'غير متاح':<MoneyText amount={data.canonicalAmountInMinorUnits/1000}/>}</p></div>}
      {!data.rows.length?<p role="status">لا توجد عمليات في هذه الصفحة.</p>:<ul className="m-0 list-none space-y-2 p-0">{data.rows.map(item=><li key={`${item.source}:${item.id}`} className="rounded-xl border border-nw-border text-sm">
        <button type="button" disabled={!item.document} onClick={()=>setDocument(item)} className="block min-h-14 w-full min-w-0 space-y-2 p-3 text-right" aria-label={`فتح مستند ${item.displayTitle??item.reference}`}>
          <span className="flex flex-wrap items-start justify-between gap-2"><strong className="min-w-0 break-words text-base">{item.displayTitle??item.note??'حركة مسجّلة'}</strong><MoneyText amount={item.amountInMinorUnits/1000}/></span>
          {Boolean(item.itemsPreview?.length)&&<span className="block break-words text-sm">{item.itemsPreview!.map(line=>`${line.quantity} ${line.unit} ${line.name}`).join(' + ')}{(item.itemCount??0)>2?` · +${item.itemCount!-2} أصناف أخرى`:''}</span>}
          <span className="block break-words text-xs text-nw-muted"><bdi>{item.reference}</bdi> · {formatUiDate(item.at,{dateStyle:'short',timeStyle:'short'})} · {item.method==='cash'?'كاش':item.method==='cliq'?'CliQ':'بطاقة'}</span>
          {item.note&&item.note!==item.displayTitle&&<span className="block break-words text-xs text-nw-muted">{item.note}</span>}
        </button>
      </li>)}</ul>}
      <nav aria-label="صفحات تفاصيل الوردية" className="flex items-center justify-center gap-3"><UiButton disabled={page<=1} onClick={()=>setPage(value=>value-1)}>السابق</UiButton><span className="text-xs">{page} / {data.totalPages}</span><UiButton disabled={page>=data.totalPages} onClick={()=>setPage(value=>value+1)}>التالي</UiButton></nav>
    </div>}
    {selectedDocument&&allowed&&loadedScope===scope&&<CashMovementDocument movement={selectedDocument} onClose={()=>setDocument(null)}/>}
  </Modal>,document.body);
}
