import {useEffect,useRef,useState} from 'react';
import {Card,PageHeader,FormFields,UiButton,MoneyText,DataTable,Th,Tr,Td} from '../../components/ui';
import {useAuthStore} from '../../stores/useAuthStore';
import {useAppStoreSelector} from '../../stores/useAppStore';
import {readReportPeriod,reportToday,saveReportPeriod} from '../../utils/reportPeriodSelection';
import {fetchSalesOnlyBusinessReport,type SalesOnlyBusinessReport} from '../../services/supabase/salesOnlyReport.service';
import {CustomerCollectionsSection} from './CustomerCollectionsSection';

const money=(minor:number)=><MoneyText amount={minor/1000} currency/>;
/** Existing report selection,collection presentation,money and table controls;
 * no cost/profit placeholders and no second client-side financial calculator. */
export function SalesOnlyReportsView(){
 const auth=useAuthStore(),actor=auth.isAuthenticated?auth.user?.id??'':'',branch=useAppStoreSelector(s=>s.activeBranch.id);
 const [period,setPeriod]=useState(readReportPeriod),[refresh,setRefresh]=useState(0),generation=useRef(0);
 const key=JSON.stringify([actor,branch,period.dateFrom,period.dateTo]);
 const [state,setState]=useState<{key:string;data:SalesOnlyBusinessReport|null;status:'loading'|'ready'|'error'}>({key:'',data:null,status:'loading'});
 useEffect(()=>{
  const token=++generation.current;let active=true;setState({key,data:null,status:'loading'});
  if(!actor){setState({key,data:null,status:'error'});return;}
  void fetchSalesOnlyBusinessReport(branch,period.dateFrom,period.dateTo).then(data=>{if(active&&generation.current===token)setState({key,data,status:'ready'});},()=>{if(active&&generation.current===token)setState({key,data:null,status:'error'});});
  return()=>{active=false;};
 },[actor,branch,period.dateFrom,period.dateTo,key,refresh]);
 const data=state.key===key&&state.status==='ready'?state.data:null,loading=state.key!==key||state.status==='loading';
 const select=(next:typeof period)=>{setPeriod(next);saveReportPeriod(next);};
 return <div dir="rtl" className="mx-auto max-w-5xl space-y-4 p-3 pb-8 text-nw-text" data-testid="lite-business-report">
  <PageHeader title="المبيعات والذمم" description="مبيعات وتحصيل ومرتجعات ومصروفات — بلا تكلفة أو أرباح"/>
  <FormFields className="flex flex-wrap items-end gap-3">
   <label>من تاريخ<input aria-label="من تاريخ" type="date" value={period.dateFrom} onChange={e=>select({...period,dateFrom:e.target.value})}/></label>
   <label>إلى تاريخ<input aria-label="إلى تاريخ" type="date" value={period.dateTo} onChange={e=>select({...period,dateTo:e.target.value})}/></label>
   <UiButton onClick={()=>{const today=reportToday();select({dateFrom:today,dateTo:today});}}>اليوم</UiButton>
   <UiButton disabled={loading} onClick={()=>setRefresh(v=>v+1)}>تحديث التقرير</UiButton>
   {data&&<UiButton onClick={()=>window.print()}>طباعة التقرير</UiButton>}
  </FormFields>
  {loading&&<p role="status">جارٍ قراءة التقرير…</p>}
  {!loading&&!data&&<p role="alert">تعذر التحقق من التقرير. راجع الفترة والاتصال وأعد القراءة؛ لا تعتمد أرقاماً ناقصة. (SREP-01)</p>}
  {data&&<>
   <Card><dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
    {([['إجمالي المبيعات',data.sales.grossSalesInMinorUnits],['استحقاق المرتجعات',data.sales.returnEntitlementInMinorUnits],['صافي المبيعات',data.sales.netSalesInMinorUnits],['رسوم التوصيل',data.sales.deliveryFeesInMinorUnits],['ذمم العملاء الحالية',data.balances.customerDueInMinorUnits],['المصروفات',data.expenses.totalInMinorUnits]] as const).map(([label,value])=><div key={label}><dt className="text-sm text-nw-muted">{label}</dt><dd className="m-0 font-bold">{money(value)}</dd></div>)}
   </dl><p className="mt-3 text-xs text-nw-muted">الفواتير المكتملة: {data.sales.completedOrderCount}. الذمم رصيد حالي؛ حركات الفترة لا تعني تحصيل فواتير الفترة نفسها.</p></Card>
   <CustomerCollectionsSection collections={data.cashFlow.customerCollections}/>
   <Card><h3 className="font-bold">المرتجع والمصروفات</h3><dl className="grid grid-cols-2 gap-3">
    {([['تخفيض دين بمرتجع',data.sales.debtReductionInMinorUnits],['مبالغ مرتجعة',data.sales.refundsInMinorUnits],['مرتجعات كاش',data.cashFlow.cashRefundedInMinorUnits],['مرتجعات CliQ',data.cashFlow.cliqRefundedInMinorUnits],['مصروفات كاش',data.expenses.cashInMinorUnits],['مصروفات CliQ',data.expenses.cliqInMinorUnits]] as const).map(([label,value])=><div key={label}><dt className="text-sm text-nw-muted">{label}</dt><dd className="m-0 font-bold">{money(value)}</dd></div>)}
   </dl></Card>
   <Card><h3 className="font-bold">المبيعات اليومية</h3><DataTable caption="المبيعات اليومية" style={{minWidth:400}}><thead><Tr><Th>اليوم</Th><Th>الفواتير</Th><Th>صافي المبيعات</Th></Tr></thead><tbody>{data.dailyBreakdown.map(d=><Tr key={d.date}><Td>{d.date}</Td><Td>{d.completedOrderCount}</Td><Td>{money(d.netSalesInMinorUnits)}</Td></Tr>)}</tbody></DataTable></Card>
  </>}
 </div>;
}
