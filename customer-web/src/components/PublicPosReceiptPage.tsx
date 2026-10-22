import { AlertTriangle, ArrowRight, Loader2, Printer, Share2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchPublicPosReceipt } from '../services/receipts.service';
import type { PublicPosReceipt } from '../types/receipt';
import { ReceiptDocument, ReceiptPrintStyle } from '../receipts/ReceiptDocument';
import { receiptDocumentShareText } from '../receipts/commercialReceipt';
import { publicReceiptDocument } from '../receipts/publicReceipt';

export function PublicPosReceiptPage({ token }: { token: string }) {
  const [receipt,setReceipt]=useState<PublicPosReceipt|null>(null);
  const [error,setError]=useState(''),[isLoading,setIsLoading]=useState(true);
  useEffect(()=>{
    let active=true;setIsLoading(true);setError('');setReceipt(null);
    fetchPublicPosReceipt(token).then(result=>{if(active){setReceipt(result);document.title=`إيصال ${result.orderNumber} | محلات النواصرة التجارية`;}})
      .catch(loadError=>{if(active)setError(loadError instanceof Error?loadError.message:'تعذر تحميل الإيصال.');})
      .finally(()=>{if(active)setIsLoading(false);});
    return()=>{active=false;};
  },[token]);
  const receiptDocument=receipt?publicReceiptDocument(receipt):null;
  const shareReceipt=async()=>{
    if(!receiptDocument)return;
    const text=receiptDocumentShareText(receiptDocument,window.location.href);
    try{
      if(navigator.share)await navigator.share({title:`إيصال ${receiptDocument.number}`,text,url:window.location.href});
      else await navigator.clipboard.writeText(text);
    }catch(shareError){if(!(shareError instanceof DOMException&&shareError.name==='AbortError'))setError('تعذر مشاركة الوصل.');}
  };
  return <div className="min-h-screen bg-slate-100 px-3 py-6 text-slate-950" dir="rtl">
    <ReceiptPrintStyle/>
    <main className="public-pos-receipt mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-4 shadow-xl sm:p-7">
      {isLoading&&<div role="status" className="flex min-h-72 flex-col items-center justify-center gap-3 text-slate-500"><Loader2 className="h-8 w-8 animate-spin"/><p>جاري تحميل الإيصال...</p></div>}
      {!isLoading&&!receiptDocument&&<div className="space-y-3 py-12 text-center"><AlertTriangle className="mx-auto h-10 w-10 text-amber-500"/><h1>تعذر فتح الإيصال</h1><p role="alert">{error}</p><a href="/products">العودة إلى المتجر</a></div>}
      {!isLoading&&receiptDocument&&<>
        <p className="receipt-actions mb-3 text-center text-sm font-bold">إيصال إلكتروني موثّق</p>
        {receipt?.status==='returned'&&<p className="receipt-actions mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">هذه الفاتورة مسجلة كمرتجعة في نظام الإدارة.</p>}
        <ReceiptDocument receipt={receiptDocument}/>
        {error&&<p role="alert" className="receipt-actions">{error}</p>}
        <div className="receipt-actions mt-5 grid grid-cols-3 gap-2 text-center text-xs font-bold">
          <button type="button" onClick={()=>window.print()} className="rounded-xl bg-blue-700 p-3 text-white"><Printer className="mx-auto mb-1 h-4 w-4"/>طباعة الوصل</button>
          <button type="button" onClick={()=>void shareReceipt()} className="rounded-xl border border-blue-200 p-3"><Share2 className="mx-auto mb-1 h-4 w-4"/>مشاركة الوصل</button>
          <a href="/products" className="rounded-xl border border-slate-200 p-3"><ArrowRight className="mx-auto mb-1 h-4 w-4"/>المتجر</a>
        </div>
      </>}
    </main>
  </div>;
}
