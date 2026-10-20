import {useEffect,useRef,useState} from 'react';
import {useNavigationDrawer} from '../../components/layout/navigationDrawerContext';
import {ChevronLeft,ChevronRight,RefreshCw} from 'lucide-react';
import {Card,PageHeader,UiButton,MoneyText,StatusBadge,TableShell,Th,Td,Tr,formatUiDate} from '../../components/ui';
import {useAuthStore} from '../../stores/useAuthStore';
import {useSalesHistory} from '../../hooks/useSalesHistory';
import {canReadSalesHistory,type SalesHistoryPeriod,type SalesHistoryMethod,type SalesHistorySource,type SalesHistoryItem} from '../../utils/salesHistory';
import {getOrderStatus,orderSourceLabel,PAYMENT_METHOD_LABELS} from '../orders/orderStatus';
import {SalesInvoiceDialog} from './SalesInvoiceDialog';
const methods:Array<[SalesHistoryMethod,string]>=[['all','كل طرق الدفع'],['cash','كاش'],['cliq','CliQ'],['debt','دين'],['bank_transfer','تحويل بنكي'],['cheque','شيك'],['card','بطاقة'],['mixed','مختلط'],['unknown','غير مسجّلة']];
const periods:Array<[SalesHistoryPeriod,string]>=[['day','اليوم'],['week','آخر 7 أيام'],['month','الشهر'],['range','مدى'],['all','كل التواريخ']];
const payment=(row:SalesHistoryItem)=>row.paymentMethod?PAYMENT_METHOD_LABELS[row.paymentMethod]??row.paymentMethod:'غير مسجّلة';
export function SalesHistoryView() {
  const entry=useNavigationDrawer()?.entryIntent;
  const numberInput=useRef<HTMLInputElement>(null);
  const returnContext=entry?.type==='customer_return';
  const {roles,roleName,user}=useAuthStore(),allowed=canReadSalesHistory(roles,roleName);
  const [page,setPage]=useState(1),[period,setPeriod]=useState<SalesHistoryPeriod>(returnContext?'all':'day');
  const [method,setMethod]=useState<SalesHistoryMethod>('all'),[source,setSource]=useState<SalesHistorySource>('all');
  const [customer,setCustomer]=useState(''),[number,setNumber]=useState(''),[search,setSearch]=useState({customer:'',number:''});
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Amman',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const [from,setFrom]=useState(today),[to,setTo]=useState(today),[selected,setSelected]=useState<string|null>(null);
  useEffect(()=>{if(entry?.type==='customer_return'){setPeriod('all');setMethod('all');setSource('all');setCustomer('');setNumber('');setSearch({customer:'',number:''});setPage(1);numberInput.current?.focus();}},[entry]);
  useEffect(()=>{const timer=window.setTimeout(()=>{setSearch({customer,number});setPage(1);},250);return ()=>window.clearTimeout(timer);},[customer,number]);
  useEffect(()=>{setSelected(null);},[user?.id,allowed]);
  const state=useSalesHistory({page,pageSize:25,period,fromDate:from,toDate:to,paymentMethod:method,source,customerSearch:search.customer,numberSearch:search.number},allowed,user?.id);
  useEffect(()=>{if(state.data&&page>state.data.totalPages)setPage(state.data.totalPages);},[state.data,page]);
  if(!allowed)return <div dir="rtl" className="p-4 lg:p-8"><Card role="alert">لا تملك صلاحية قراءة سجل المبيعات.</Card></div>;
  const change=(action:()=>void)=>{action();setPage(1);};
  const inputClass='min-h-11 w-full rounded-xl border border-nw-border bg-nw-surface px-3 py-2 text-sm text-nw-text';
  const openButton=(row:SalesHistoryItem)=><button onClick={()=>setSelected(row.id)} className="min-h-11 break-all font-semibold text-nw-primary" aria-label={`فتح الفاتورة ${row.orderNumber}`}><bdi>{row.orderNumber}</bdi></button>;
  const date=(row:SalesHistoryItem)=><><bdi>{formatUiDate(row.listedAt,{dateStyle:'short',timeStyle:'short'})}</bdi>{row.dateBasis==='creation'&&<span className="mt-1 block text-xs text-nw-muted">تاريخ الإنشاء{['completed','returned'].includes(row.status)?' · وقت البيع غير مسجّل':''}</span>}</>;
  return <div dir="rtl" data-testid="sales-history" className="min-w-0 space-y-4 p-4 pb-24 lg:p-8">
    <PageHeader title="سجل المبيعات" description="كل الفواتير من نقطة البيع والمتجر" actions={<UiButton disabled={state.loading} onClick={()=>void state.reload()} aria-label="تحديث سجل المبيعات"><RefreshCw className="h-4 w-4" aria-hidden="true"/>تحديث</UiButton>}/>
    <Card className="space-y-4 print:hidden">
      <fieldset><legend className="mb-2 text-sm font-semibold">الفترة</legend><div className="flex flex-wrap gap-2">{periods.map(([value,label])=><UiButton key={value} aria-pressed={period===value} variant={period===value?'primary':'secondary'} onClick={()=>change(()=>setPeriod(value))}>{label}</UiButton>)}</div></fieldset>
      {period==='range'&&<div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">من تاريخ<input type="date" className={inputClass} value={from} onChange={e=>change(()=>setFrom(e.target.value))}/></label><label className="text-sm">إلى تاريخ<input type="date" className={inputClass} value={to} onChange={e=>change(()=>setTo(e.target.value))}/></label></div>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="text-sm"><label htmlFor="sales-history-method">طريقة دفع الفاتورة</label><select id="sales-history-method" className={inputClass} value={method} onChange={e=>change(()=>setMethod(e.target.value as SalesHistoryMethod))}>{methods.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
        <div className="text-sm"><label htmlFor="sales-history-source">المصدر</label><select id="sales-history-source" className={inputClass} value={source} onChange={e=>change(()=>setSource(e.target.value as SalesHistorySource))}><option value="all">كل المصادر</option><option value="pos">نقطة البيع</option><option value="website">المتجر</option><option value="unknown">غير مسجّل</option></select></div>
        <label className="text-sm">الزبون أو الهاتف<input maxLength={100} className={inputClass} value={customer} onChange={e=>setCustomer(e.target.value)} placeholder="اسم أو رقم هاتف"/></label>
        <label className="text-sm">بحث برقم الفاتورة<input ref={numberInput} maxLength={100} className={inputClass} value={number} onChange={e=>setNumber(e.target.value)} placeholder="رقم الفاتورة"/></label>
      </div>
    </Card>
    {state.loading?<Card role="status">جاري تحميل سجل المبيعات…</Card>:state.error?<Card role="alert"><p>{state.error}</p><UiButton className="mt-3" onClick={()=>void state.reload()}>إعادة المحاولة</UiButton></Card>:!state.data?<Card role="status">سجل المبيعات غير متاح حالياً.</Card>:<>
      <Card data-testid="sales-history-summary"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm text-nw-muted">{period==='day'?'مبيعات اليوم':'مبيعات الفترة'} · {state.data.summary.salesCount} فواتير مؤرخة</p><MoneyText amount={state.data.summary.salesInMinorUnits/1000} currency className="text-2xl font-bold"/></div><p className="text-sm text-nw-muted">{state.data.totalCount} فاتورة في السجل</p></div>
        {state.data.summary.undatedInvoiceCount>0&&<p className="mt-3 text-sm text-nw-muted">{state.data.summary.undatedInvoiceCount} فواتير قديمة بلا وقت بيع مسجّل؛ تظهر بتاريخ الإنشاء ولا تدخل إجمالي المبيعات.</p>}
        <p className="mt-2 text-xs text-nw-muted">الإجمالي للفواتير المكتملة والمرتجعة بحسب وقت البيع، قبل خصم المرتجعات. طريقة الدفع الأصلية لا تتغير بسبب تحصيل لاحق.</p>
      </Card>
      {!state.data.rows.length?<Card><p className="py-6 text-center text-nw-muted">لا توجد فواتير ضمن هذه الفلاتر.</p></Card>:<>
        <div className="space-y-3 lg:hidden">{state.data.rows.map(row=><Card key={row.id} data-sales-invoice={row.id}><div className="flex flex-wrap items-center justify-between gap-2">{openButton(row)}<StatusBadge tone={getOrderStatus(row.status).tone}>{getOrderStatus(row.status).label}</StatusBadge></div><p className="mt-2 break-words font-semibold">{row.customerName}</p><div className="mt-2 flex flex-wrap justify-between gap-3 text-sm"><span>{date(row)}</span><MoneyText amount={row.totalInMinorUnits/1000} className="font-bold"/></div><p className="mt-2 text-xs text-nw-muted">{payment(row)} · {orderSourceLabel(row.source??undefined)}</p></Card>)}</div>
        <div className="hidden lg:block"><TableShell caption="كل فواتير المبيعات" minWidth={850} head={<><Th>الفاتورة</Th><Th>الوقت</Th><Th>الزبون</Th><Th>المبلغ</Th><Th>الدفع</Th><Th>المصدر</Th><Th>الحالة</Th></>}>{state.data.rows.map(row=><Tr key={row.id}><Td>{openButton(row)}</Td><Td className="text-xs">{date(row)}</Td><Td className="max-w-48 break-words">{row.customerName}</Td><Td><MoneyText amount={row.totalInMinorUnits/1000}/></Td><Td>{payment(row)}</Td><Td>{orderSourceLabel(row.source??undefined)}</Td><Td><StatusBadge tone={getOrderStatus(row.status).tone}>{getOrderStatus(row.status).label}</StatusBadge></Td></Tr>)}</TableShell></div>
      </>}
      <nav aria-label="صفحات سجل المبيعات" className="flex flex-wrap items-center justify-center gap-3"><UiButton disabled={page<=1} onClick={()=>setPage(v=>v-1)}><ChevronRight className="h-4 w-4" aria-hidden="true"/>السابق</UiButton><span className="text-sm">صفحة {page} من {state.data.totalPages}</span><UiButton disabled={page>=state.data.totalPages} onClick={()=>setPage(v=>v+1)}>التالي<ChevronLeft className="h-4 w-4" aria-hidden="true"/></UiButton></nav>
    </>}
    {selected&&<SalesInvoiceDialog orderId={selected} returnContext={returnContext} onClose={()=>setSelected(null)} onChanged={state.reload}/>}
  </div>;
}
