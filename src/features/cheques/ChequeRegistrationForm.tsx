import React,{useEffect,useId,useState} from 'react';
import {FormFields,MoneyText,UiButton,StatusBadge,formatUiDate} from '../../components/ui';
import {parseJodToMinor} from '../goLive/goLiveImport';
import {newChequeKey,previewCustomerCheque,previewSupplierCheque,receiveCustomerCheque,issueSupplierCheque,
  type ChequeDirection,type ChequeResult} from '../../services/supabase/cheques.service';
import type {CollectionPart} from '../../services/supabase/goLive.service';

export interface ChequeParty {id:string;name:string;phone?:string}
interface Props {direction:ChequeDirection;parties:ChequeParty[];partyId?:string;claimId?:string;purchaseOrderId?:string;openingOnly?:boolean;initialAmount?:string;initialNotes?:string;branchId:string|null;onBusyChange?:(busy:boolean)=>void;onSaved:(result:ChequeResult)=>void;onClose:()=>void}
const field='h-11 w-full min-w-0 rounded-xl border border-nw-border bg-nw-surface px-3 text-sm text-nw-text';
/** Monetary inputs are parsed to exact integer fils; allocation/caps only DB. */
export function ChequeRegistrationForm({direction,parties,partyId,claimId,purchaseOrderId,openingOnly,initialAmount='',initialNotes='',branchId,onBusyChange,onSaved,onClose}:Props) {
  const prefix=useId(),[selectedParty,setParty]=useState(partyId??''),[bank,setBank]=useState(''),[number,setNumber]=useState('');
  const party=partyId??selectedParty;
  const [dueDate,setDueDate]=useState(''),[amount,setAmount]=useState(initialAmount),[notes,setNotes]=useState(initialNotes);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[key]=useState(newChequeKey);
  useEffect(()=>{onBusyChange?.(busy);return()=>onBusyChange?.(false);},[busy,onBusyChange]);
  const [preview,setPreview]=useState<{identity:string;balance:number;parts:CollectionPart[]}|null>(null);
  const minorText=parseJodToMinor(amount),minor=minorText===null?null:Number(minorText);
  const identity=JSON.stringify({party,bank,number,dueDate,minor,notes,branchId,claimId,purchaseOrderId,openingOnly});
  const current=preview?.identity===identity;
  const input=(name:string,label:string,value:string,set:(value:string)=>void,props:React.InputHTMLAttributes<HTMLInputElement>={})=><div>
    <label className="mb-1 block text-sm font-semibold" htmlFor={`${prefix}-${name}`}>{label}</label>
    <input {...props} id={`${prefix}-${name}`} className={field} value={value} onChange={e=>set(e.target.value)} disabled={busy} required={name!=='notes'} />
  </div>;
  const run=async(event:React.FormEvent)=>{
    event.preventDefault();setError('');
    if(!party||!branchId||!bank.trim()||!number.trim()||!dueDate||minor===null||!Number.isSafeInteger(minor)||minor<=0){setError('أكمل الطرف والفرع وبيانات الشيك والمبلغ الصحيح.');return;}
    setBusy(true);
    try {
      if(!current){
        if(direction==='incoming'){
          const p=await previewCustomerCheque(party,minor);
          if(p.exceedsBalance)throw Error('المبلغ أكبر من دين العميل؛ لا يمكن تسجيل شيك بلا دين أو بقيمة أكبر منه.');
          setPreview({identity,balance:p.totalOutstandingInMinorUnits,parts:p.parts.filter(p=>p.allocateInMinorUnits>0)});
        }else{const p=await previewSupplierCheque(party,minor,claimId,purchaseOrderId,openingOnly);setPreview({identity,balance:p.balance,parts:[]});}
        return;
      }
      const data={partyId:party,branchId,bank,number,dueDate,amount:minor,notes,idempotencyKey:key,claimId,purchaseOrderId,openingOnly};
      onSaved(await(direction==='incoming'?receiveCustomerCheque(data):issueSupplierCheque(data)));
    }catch(e){setError(e instanceof Error?e.message:'تعذر تسجيل الشيك.');}finally{setBusy(false);}
  };
  return <FormFields><form dir="rtl" className="space-y-4" onSubmit={e=>void run(e)} aria-busy={busy} data-testid="cheque-registration">
    {partyId?<p className="m-0 font-semibold">{parties.find(p=>p.id===partyId)?.name??'الطرف المحدد'}</p>:<div>
      <label htmlFor={`${prefix}-party`} className="mb-1 block text-sm font-semibold">{direction==='incoming'?'العميل':'المورد'}</label>
      <select id={`${prefix}-party`} className={field} value={party} disabled={busy} required onChange={e=>setParty(e.target.value)}>
        <option value="">اختر الطرف</option>{parties.map(p=><option key={p.id} value={p.id}>{p.name}{p.phone?` · ${p.phone}`:''}</option>)}
      </select>
    </div>}
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      {input('bank','البنك',bank,setBank,{maxLength:120})}{input('number','رقم الشيك',number,setNumber,{maxLength:80,dir:'ltr'})}
      {input('due','تاريخ الاستحقاق',dueDate,setDueDate,{type:'date',dir:'ltr'})}{input('amount','مبلغ الشيك (د.أ)',amount,setAmount,{inputMode:'decimal',dir:'ltr'})}
    </div>
    {input('notes','ملاحظات (اختياري)',notes,setNotes,{maxLength:300})}
    {preview&&<div className="space-y-2 rounded-xl border border-nw-border bg-nw-surface-2 p-3 text-sm" data-testid="cheque-preview">
      <StatusBadge tone={current?'info':'warn'}>{current?'معاينة محدثة':'تغيرت البيانات؛ أعد المعاينة'}</StatusBadge>
      <p>الدين قبل الشيك <MoneyText amount={preview.balance/1000} /> · قيمة الشيك <MoneyText amount={(minor??0)/1000} /></p>
      <p className="text-nw-muted">الشيك يخفض الدين عند التسجيل، ولا يدخل درج الوردية. تأكيد الصرف لاحقاً لا يسجل دفعة ثانية.</p>
      <ul className="list-none space-y-2 p-0">{preview.parts.map(p=><li key={p.id} className="flex flex-wrap justify-between gap-2">
        <span>{p.kind==='compensation'?'قيد شيك':p.kind==='opening'?'رصيد سابق':'طلب'} · <bdi>{p.reference}</bdi> · {p.debtAt?formatUiDate(p.debtAt,{year:'numeric',month:'2-digit',day:'2-digit'}):'تاريخ غير متاح'}</span>
        <MoneyText amount={p.allocateInMinorUnits/1000} />
      </li>)}</ul>
    </div>}
    {error&&<p role="alert" className="rounded-xl bg-nw-bad-bg p-3 text-sm text-nw-bad">{error}</p>}
    <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-nw-border bg-nw-surface py-3">
      <UiButton type="submit" variant="accent" disabled={busy}>{busy?'جارٍ التنفيذ…':current?'تأكيد تسجيل الشيك':'معاينة قبل التسجيل'}</UiButton>
      <UiButton onClick={onClose} disabled={busy}>إلغاء</UiButton>
    </div>
  </form></FormFields>;
}
