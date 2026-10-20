import {ChevronLeft} from 'lucide-react';
import {Card,SectionHeader,UiButton,MoneyText,formatUiTime} from '../../components/ui';
import type {SalesHistoryReadState} from '../../hooks/useSalesHistory';
import {PAYMENT_METHOD_LABELS} from '../orders/orderStatus';
export function RecentSalesCard({state,onOpen,onViewAll}:{state:SalesHistoryReadState;onOpen:(id:string)=>void;onViewAll:()=>void}) {
  return <Card aria-labelledby="home-recent-sales-title" data-testid="home-recent-sales" className="order-2 min-w-0 flex-[2_1_520px] lg:order-1">
    <SectionHeader id="home-recent-sales-title" title="آخر مبيعات اليوم" action={<UiButton onClick={onViewAll}>عرض الكل <ChevronLeft className="h-4 w-4" aria-hidden="true"/></UiButton>}/>
    {state.loading?<p role="status" className="py-8 text-center text-nw-muted">جاري تحميل مبيعات اليوم…</p>
      :state.error?<div role="alert" className="space-y-3 py-5"><p>{state.error}</p><UiButton onClick={()=>void state.reload()}>إعادة المحاولة</UiButton></div>
      :!state.data?<p role="status" className="py-5 text-nw-muted">قائمة المبيعات غير متاحة حالياً.</p>
      :!state.data.rows.length?<p className="py-8 text-center text-nw-muted">لا توجد مبيعات اليوم.</p>
      :<ul className="mt-3 divide-y divide-nw-border">{state.data.rows.map(row=><li key={row.id}><button onClick={()=>onOpen(row.id)} aria-label={`فتح الفاتورة ${row.orderNumber}`} className="flex min-h-16 w-full items-center justify-between gap-3 py-3 text-right">
        <span className="min-w-0 flex-1"><span className="block break-words font-semibold">{row.customerName}</span><span className="mt-1 block text-xs text-nw-muted"><bdi>{formatUiTime(row.listedAt)}</bdi> · {row.paymentMethod?PAYMENT_METHOD_LABELS[row.paymentMethod]??row.paymentMethod:'طريقة غير مسجّلة'}</span></span>
        <MoneyText amount={row.totalInMinorUnits/1000} className="shrink-0 font-bold"/><ChevronLeft className="h-4 w-4 shrink-0 text-nw-muted" aria-hidden="true"/>
      </button></li>)}</ul>}
  </Card>;
}
