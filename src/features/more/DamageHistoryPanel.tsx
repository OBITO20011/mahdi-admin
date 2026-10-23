import {useCallback,useEffect,useMemo,useState} from 'react';
import {Modal} from '../../components/common/Modal';
import {Card,FormFields,MoneyText,UiButton,formatUiDate} from '../../components/ui';
import {useAuthStore} from '../../stores/useAuthStore';
import {useAppStoreActions} from '../../stores/useAppStore';
import {canUseSupplierReplacement} from '../../utils/supplierReplacement';
import {damageHistoryReasons,fetchDamageHistoryPage,type DamageHistoryPage,type DamageHistoryPeriod,type DamageHistoryRow} from '../../services/supabase/damageHistory.service';
import {aftercareSupplierBlockedMessage} from '../../services/supabase/supplierReplacement.service';
import {SupplierReplacementPanel} from '../inventory/SupplierReplacementPanel';
import {AftercareSupplierSafety} from '../orders/AftercareSupplierSafety';

export function DamageHistoryPanel() {
  const {user,roleName,roles}=useAuthStore(),allowed=canUseSupplierReplacement(roles,roleName),owner=roleName==='owner'||roles.includes('owner');
  const {setToast}=useAppStoreActions();
  const [period,setPeriod]=useState<DamageHistoryPeriod>('today'),[reason,setReason]=useState('all'),[from,setFrom]=useState(''),[to,setTo]=useState(''),[page,setPage]=useState(1),[revision,setRevision]=useState(0);
  const [state,setState]=useState<{scope:string;data?:DamageHistoryPage;error?:string}>({scope:''});
  const scope=[user?.id,roleName,roles.join(','),period,reason,from,to,page,revision].join('|');
  const [action,setAction]=useState<{row:DamageHistoryRow;type:'reverse'|'reclassify';scope:string}|null>(null),[actionBusy,setActionBusy]=useState(false);
  const valid=period!=='range'||(/^\d{4}-\d{2}-\d{2}$/u.test(from)&&/^\d{4}-\d{2}-\d{2}$/u.test(to)&&from<=to);
  useEffect(()=>{if(!allowed||!valid)return;const controller=new AbortController();
    void fetchDamageHistoryPage({period,reason,page,fromDate:from,toDate:to},controller.signal)
      .then(data=>{if(!controller.signal.aborted){if(!owner&&data.rows.some(row=>row.lossAtRegistrationInMinorUnits!==undefined||row.reversal||row.reclassification))throw new Error('قراءة سجل التالف لا تطابق دور المستخدم.');setState({scope,data});}})
      .catch(error=>{if(!controller.signal.aborted)setState({scope,error:error instanceof Error?error.message:'تعذر قراءة سجل التالف.'});});
    return()=>controller.abort();
  },[scope,allowed,valid,period,reason,page,from,to,owner]);
  const changed=useCallback(async()=>{setAction(null);setActionBusy(false);setRevision(value=>value+1);},[]);
  const candidate=useMemo(()=>action?.type==='reclassify'&&action.row.reclassification?{
    kind:action.row.reclassification.kind,id:action.row.reclassification.sourceId,productId:action.row.productId,
    productName:action.row.productName,quantity:action.row.quantity,occurredAt:action.row.occurredAt,blockedReason:action.row.reclassification.blockedReason,
  }:undefined,[action]);
  if(!allowed)return <p role="alert">لا تملك صلاحية قراءة سجل التالف.</p>;
  const data=state.scope===scope?state.data:undefined,error=state.scope===scope?state.error:undefined;
  return <FormFields className="space-y-3" data-testid="damage-history">
    <div className="grid gap-3 sm:grid-cols-2">
      <label>الفترة<select aria-label="الفترة" value={period} onChange={e=>{setPeriod(e.target.value as DamageHistoryPeriod);setPage(1);}}>
        <option value="today">اليوم</option><option value="week">الأسبوع</option><option value="month">الشهر</option><option value="range">مخصص</option>
      </select></label>
      <label>سبب التلف<select aria-label="سبب التلف" value={reason} onChange={e=>{setReason(e.target.value);setPage(1);}}><option value="all">كل الأسباب</option>{Object.entries(damageHistoryReasons).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      {period==='range'&&<><label>من تاريخ<input aria-label="من تاريخ" type="date" value={from} onChange={e=>{setFrom(e.target.value);setPage(1);}}/></label><label>إلى تاريخ<input aria-label="إلى تاريخ" type="date" min={from||undefined} value={to} onChange={e=>{setTo(e.target.value);setPage(1);}}/></label></>}
    </div>
    {!valid?<p role="status">اختر تاريخ البداية والنهاية بترتيب صحيح، وبفترة لا تتجاوز سنة.</p>:error?<div role="alert"><p>{error}</p><UiButton onClick={()=>setRevision(n=>n+1)}>إعادة المحاولة</UiButton></div>:!data?<p role="status">جاري قراءة سجل التالف…</p>:<>
      {!data.rows.length?<p role="status">لا يوجد تالف مسجّل في هذه الفترة.</p>:data.rows.map(row=><Card key={row.source+row.id} className="space-y-2" data-damage-history-row={row.id}>
        <h4 className="break-words text-base font-bold">{row.productName} · {row.quantity} {row.unitName}</h4>
        <p className="break-words text-sm">{row.reason}</p>
        <p className="text-xs text-nw-muted">{row.origin==='shop'?'محل':row.origin==='supplier_rejected'?'مورد مرفوض':'مرتجع زبون'} · {formatUiDate(row.occurredAt,{dateStyle:'short',timeStyle:'short'})}</p>
        {row.isReversed&&<p className="text-sm text-nw-info">أُلغيت الحركة بالعكس؛ الحدث الأصلي محفوظ.</p>}
        {row.isReclassified&&<p className="text-sm text-nw-info">حُوّلت للمورد؛ راجع سجل استبدال المورد لمعرفة حالتها.</p>}
        {owner&&row.lossAtRegistrationInMinorUnits!==undefined&&<p className="text-sm">الخسارة عند التسجيل: <MoneyText amount={row.lossAtRegistrationInMinorUnits/1000} currency/>{(row.isReversed||row.isReclassified)&&<span className="block text-xs text-nw-muted">قيمة الحدث الأصلي؛ العكس أو التحويل يظهر بحالته أعلاه.</span>}</p>}
        {owner&&(row.reversal||row.reclassification)&&<details><summary className="min-h-11 cursor-pointer py-2 text-sm">⋯ خيارات الحركة</summary>
          {row.reversal&&<UiButton onClick={()=>setAction({row,type:'reverse',scope})}>إلغاء الحركة (عكس)</UiButton>}
          {row.reclassification&&(row.reclassification.blockedReason?<p className="text-sm text-nw-muted">{aftercareSupplierBlockedMessage(row.reclassification.blockedReason)}</p>:<UiButton onClick={()=>setAction({row,type:'reclassify',scope})}>حوّلها للمورد بانتظار البديل</UiButton>)}
        </details>}
      </Card>)}
      <nav aria-label="صفحات سجل التالف" className="flex flex-wrap items-center justify-center gap-3"><UiButton disabled={page<=1} onClick={()=>setPage(n=>n-1)}>السابق</UiButton><span>{page} / {Math.max(1,Math.ceil(data.totalCount/data.pageSize))}</span><UiButton disabled={page*data.pageSize>=data.totalCount} onClick={()=>setPage(n=>n+1)}>التالي</UiButton></nav>
    </>}
    {owner&&action&&action.scope===scope&&<Modal isOpen onClose={()=>{if(!actionBusy)setAction(null);}} trackChanges={false} title={action.type==='reverse'?'معاينة إلغاء حركة التالف':'تحويل التالف للمورد'}>
      {action.type==='reverse'&&action.row.reversal?<SupplierReplacementPanel initialReversal={action.row.reversal} onPendingChange={setActionBusy} onSaved={()=>void changed()}/>:candidate&&action.row.reclassification?<AftercareSupplierSafety orderId={action.row.reclassification.orderId} initialCandidate={candidate} disabled={false} onPendingChange={setActionBusy} onChanged={changed} notify={setToast}/>:null}
    </Modal>}
  </FormFields>;
}
