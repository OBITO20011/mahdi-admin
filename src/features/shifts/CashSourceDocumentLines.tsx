import {useEffect,useState} from 'react';
import {useAuthStore} from '../../stores/useAuthStore';
import {fetchCashReceiptDocument,fetchCashPurchaseDocument,type CashDocumentDisplay} from '../../services/supabase/cashDocumentDisplay.service';
import type {CashShiftMovement} from '../../services/supabase/cashShiftMovements.service';
/** Existing document reads,displayed without edit/payment/cancellation controls. */
export function CashSourceDocumentLines({document}:{document:NonNullable<CashShiftMovement['document']>}){
 const {user,roleName,roles}=useAuthStore(),scope=[user?.id,roleName,roles.join(','),document.type,document.id].join('|');
 const [state,setState]=useState<{scope:string;data?:CashDocumentDisplay;error?:string}>({scope:''});
 useEffect(()=>{let active=true;
  const load=()=>document.type==='supplier_receipt'?fetchCashReceiptDocument(document.id):fetchCashPurchaseDocument(document.id);
  void load().then(data=>{if(active)setState({scope,data});}).catch(error=>{if(active)setState({scope,error:error instanceof Error?error.message:'تعذر فتح المستند.'});});
  return()=>{active=false;};
 },[scope,document.type,document.id]);
 const data=state.scope===scope?state.data:undefined,error=state.scope===scope?state.error:undefined;
 return <section className="space-y-2 border-t border-nw-border pt-3" aria-label="تفاصيل المستند الأصلي">
  {error?<p role="alert">{error}</p>:!data?<p role="status">جاري قراءة المستند الأصلي…</p>:<><h4 className="font-bold">{data.party}</h4><p className="text-xs text-nw-muted"><bdi>{data.reference}</bdi>{data.location?' · '+data.location:''}</p>
  {!data.lines.length?<p>لا توجد أصناف محفوظة في هذا المستند.</p>:<ul className="space-y-2">{data.lines.map(line=><li key={line.id}>{line.name} · {line.quantity} {line.unit}</li>)}</ul>}</>}
 </section>;
}
