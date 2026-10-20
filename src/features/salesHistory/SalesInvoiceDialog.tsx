import {useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {RefreshCw} from 'lucide-react';
import {UiButton} from '../../components/ui';
import {useDialogFocus} from '../../hooks/useDialogFocus';
import {fetchOrderByIdFromSupabase} from '../../services/supabase/orders.service';
import {OrderDetailModal} from '../orders/OrderDetailModal';
import type {Order} from '../../types';
import './salesHistory.css';

export function SalesInvoiceDialog({orderId,onClose,onChanged}:{orderId:string;onClose:()=>void;onChanged?:()=>Promise<void>}) {
  const [order,setOrder]=useState<Order|null>(null),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(true);
  const version=useRef(0),restorePrint=useRef<(()=>void)|null>(null);
  // Preserve the embedded order's existing busy close lock at this outer focus boundary.
  const panel=useDialogFocus(true,():void=>{if(!panel.current?.querySelector('.order-detail[aria-busy="true"]'))onClose();},true);
  const load=useCallback(async()=>{
    const current=++version.current;setLoading(true);setError(null);
    try {const result=await fetchOrderByIdFromSupabase(orderId);if(current!==version.current)return;
      if(result.success&&result.order)setOrder(result.order);else {setOrder(null);setError(result.error||'تعذر تحميل الفاتورة.');}
    }catch {if(current===version.current){setOrder(null);setError('تعذر تحميل الفاتورة.');}}
    finally{if(current===version.current)setLoading(false);}
  },[orderId]);
  const invalidate=useCallback(()=>{++version.current;restorePrint.current?.();},[]);
  useEffect(()=>{setOrder(null);void load();return invalidate;},[load,invalidate]);
  const print=()=>{
    restorePrint.current?.();
    const closed=Array.from(panel.current?.querySelectorAll<HTMLDetailsElement>('details[data-commercial-components]:not([open])')??[]);
    closed.forEach(element=>{element.open=true;});
    const restore=()=>{closed.forEach(element=>{element.open=false;});window.removeEventListener('afterprint',restore);restorePrint.current=null;};
    restorePrint.current=restore;window.addEventListener('afterprint',restore,{once:true});window.print();
  };
  return createPortal(<div className="sales-invoice-backdrop fixed inset-0 z-40 overflow-y-auto bg-black/60 p-2 sm:p-5" dir="rtl">
    <div ref={panel as React.RefObject<HTMLDivElement>} role="dialog" aria-modal="true" aria-label={order?`الفاتورة ${order.orderNumber}`:'تفاصيل الفاتورة'} className="sales-invoice-dialog mx-auto min-w-0 max-w-3xl bg-nw-surface p-4 text-nw-text">
      {loading?<div role="status" className="space-y-4 py-8 text-center"><RefreshCw className="mx-auto h-6 w-6 animate-spin" aria-hidden="true"/>جاري تحميل الفاتورة…<div><UiButton onClick={onClose}>إغلاق</UiButton></div></div>
        :error||!order?<div role="alert" className="space-y-3"><p>{error||'تعذر تحميل الفاتورة.'}</p><UiButton onClick={()=>void load()}>إعادة المحاولة</UiButton><UiButton onClick={onClose}>إغلاق</UiButton></div>
        :<OrderDetailModal key={`${order.id}:${order.updatedAt}`} embedded historyContext order={order} onClose={onClose} onPrint={print} onOrderChanged={async()=>{await load();await onChanged?.();}}/>}
    </div>
  </div>,document.body);
}
