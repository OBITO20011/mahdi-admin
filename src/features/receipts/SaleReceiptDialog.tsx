import {Copy,Printer,Share2,X} from 'lucide-react';
import {useDialogFocus} from '../../hooks/useDialogFocus';
import {ReceiptDocument,ReceiptPrintStyle} from '../../../customer-web/src/receipts/ReceiptDocument';
import type {ReceiptDocumentData} from '../../../customer-web/src/receipts/commercialReceipt';
import {UiButton} from '../../components/ui';

export function SaleReceiptDialog({receipt,onClose,onShare,onCopy,completed=false}:{receipt:ReceiptDocumentData;onClose:()=>void;onShare?:()=>void;onCopy?:()=>void;completed?:boolean}){
  const focus=useDialogFocus(true,onClose);
  return <div ref={focus as React.RefObject<HTMLDivElement>} role="dialog" aria-modal="true" aria-label="إيصال البيع" className="fixed inset-0 z-50 flex items-center justify-center bg-nw-side/80 p-3 backdrop-blur-md">
    <ReceiptPrintStyle/>
    <section className="max-h-[92dvh] w-full max-w-sm overflow-y-auto rounded-2xl border border-nw-border bg-nw-surface p-4 text-nw-text shadow-2xl">
      <header className="mb-3 flex items-center justify-between gap-3 print:hidden">
        <h3 className="font-bold">{completed?'تم إتمام العملية بنجاح!':'وصل الشراء المحفوظ'}</h3>
        <UiButton aria-label="إغلاق الإيصال" onClick={onClose}><X className="h-4 w-4"/></UiButton>
      </header>
      <ReceiptDocument receipt={receipt}/>
      <div className="mt-3 flex flex-wrap gap-2 print:hidden">
        <UiButton onClick={()=>window.print()} variant="primary"><Printer className="h-4 w-4"/>طباعة / PDF</UiButton>
        {onShare&&<UiButton onClick={onShare}><Share2 className="h-4 w-4"/>مشاركة الوصل</UiButton>}
        {onCopy&&<UiButton onClick={onCopy}><Copy className="h-4 w-4"/>نسخ الرابط</UiButton>}
      </div>
    </section>
  </div>;
}
