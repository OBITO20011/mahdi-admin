import{useState}from'react';import{UiButton}from'../../components/ui';
import{completeFamilyBarcodes,familyBarcodeErrorText}from'../../services/supabase/productFamilyBarcodes.service';
export function FamilyBarcodeRecovery({actor,familyIds,initialItems,onComplete}:{actor:string;familyIds:string[];initialItems?:{name:string;barcode:string}[];onComplete:()=>Promise<void>}){
 const[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const resume=async(id:string)=>{setBusy(true);setMessage('');try{await completeFamilyBarcodes(actor,id,localStorage,initialItems?.length?initialItems:undefined);await onComplete();}catch(error){setMessage(familyBarcodeErrorText(error));}finally{setBusy(false);}};
 return <section className="space-y-3 rounded-xl border border-nw-warn bg-nw-warn-bg p-3" aria-label="استكمال باركود النكهات">
  <p className="m-0 font-bold">العائلة محفوظة؛ استكمل باركود النكهات قبل إنشاء عائلة جديدة.</p>
  <p className="m-0 text-sm">لا تُعد إنشاء المنتج. الاستكمال يقرأ UUIDs المحفوظة ويثبت الباركود الناقص فقط.</p>
  {familyIds.map(id=><UiButton key={id} disabled={busy} onClick={()=>void resume(id)}>استكمال باركود العائلة المحفوظة {id.slice(-6)}</UiButton>)}
  {message&&<p role="alert">{message}</p>}
 </section>;
}
