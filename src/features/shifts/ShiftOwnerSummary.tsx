import {useEffect,useState} from 'react';
import {CheckCircle2,RefreshCw,Smartphone,TrendingUp,TriangleAlert,Wallet} from 'lucide-react';
import {MoneyText} from '../../components/ui';
import {fetchAccountingReport} from '../../services/supabase/reportingDispatch.service';
import type {ShiftClosingReport} from '../../types';
import {canShowShiftOwnerSummary,shiftDurationLabel,shiftReportDays,topProfitProducts,type ShiftProfitFacts} from '../../utils/shiftOwnerSummary';

type ProfitState={status:'loading'}|{status:'ready';facts:ShiftProfitFacts}|{status:'unavailable';reason:string};

/**
 * Owner trial item 17 (approved mockup 2026-11-20): a plain summary on top of the
 * existing closing report. Net sales, CliQ and the drawer come from the shift's own
 * server report. Profit and top items come from the canonical business report for
 * the shift's Amman day(s), so they include every sale booked on those days.
 */
export function ShiftOwnerSummary({report}:{report:ShiftClosingReport}) {
  return canShowShiftOwnerSummary(report)?<ShiftOwnerSummaryCard report={report}/>:null;
}

function ShiftOwnerSummaryCard({report}:{report:ShiftClosingReport}) {
  const {shift,reconciliation}=report;
  const days=shiftReportDays(shift.startTime,shift.endTime)!;
  const [profit,setProfit]=useState<ProfitState>({status:'loading'});
  useEffect(()=>{
    let active=true;setProfit({status:'loading'});
    if(!shift.branchId){setProfit({status:'unavailable',reason:'الفرع غير معروف'});return()=>{active=false;};}
    fetchAccountingReport(shift.branchId,days.from,days.to).then(result=>{
      if(!active)return;
      if(result.kind!=='full'){setProfit({status:'unavailable',reason:'الربح غير متاح لأيام بيع بدون تكلفة'});return;}
      setProfit({status:'ready',facts:{netProfit:result.report.sales.netProfit,top:topProfitProducts(result.report.topProducts)}});
    }).catch(()=>{if(active)setProfit({status:'unavailable',reason:'تعذر قراءة الربح الآن'});});
    return()=>{active=false;};
  },[shift.branchId,days.from,days.to]);
  const open=shift.status==='open';
  const difference=reconciliation.cashDiscrepancy;
  const balanced=difference===undefined||Math.abs(difference)<0.001;
  const dayLabel=days.from===days.to?days.from:`${days.from} ← ${days.to}`;
  return <section data-testid="shift-owner-summary" aria-label="ملخص الوردية" className="space-y-3 rounded-2xl border border-nw-border bg-nw-surface p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="text-[11px] leading-5 text-nw-muted">
        <span className="block font-bold text-nw-text">ملخص الوردية · <bdi dir="ltr">{dayLabel}</bdi></span>
        <span className="block">{shift.cashierName} · {shiftDurationLabel(shift.startTime,shift.endTime)}</span>
      </div>
      <span data-testid="shift-drawer-badge" className={`flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold ${open?'bg-nw-info-bg text-nw-info':balanced?'bg-nw-ok-bg text-nw-ok':'bg-nw-warn-bg text-nw-warn'}`}>
        {open?<RefreshCw className="h-3.5 w-3.5"/>:balanced?<CheckCircle2 className="h-3.5 w-3.5"/>:<TriangleAlert className="h-3.5 w-3.5"/>}
        {open?'الوردية مفتوحة':balanced?'الدرج مطابق':<>فرق بالدرج <MoneyText amount={difference??0}/></>}
      </span>
    </div>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <div data-testid="shift-summary-profit" className="rounded-xl border border-nw-border bg-nw-ok-bg p-3">
        <span className="flex items-center gap-1 text-[11px] font-bold text-nw-muted"><TrendingUp className="h-3.5 w-3.5 text-nw-ok"/>ربح الوردية</span>
        {profit.status==='loading'?<span className="mt-1 block text-xs text-nw-muted">جاري الحساب…</span>
          :profit.status==='ready'?<strong className={`mt-1 block text-base ${profit.facts.netProfit<0?'text-nw-bad':'text-nw-ok'}`}><MoneyText amount={profit.facts.netProfit} currency/></strong>
          :<span className="mt-1 block text-xs text-nw-muted">{profit.reason}</span>}
        <span className="mt-1 block text-[10px] text-nw-muted">الربح الصافي ليوم الوردية (كل البيع بهذا اليوم، بعد المرتجعات والتلف).</span>
      </div>
      <div data-testid="shift-summary-net-sales" className="rounded-xl border border-nw-border bg-nw-surface-2 p-3">
        <span className="flex items-center gap-1 text-[11px] font-bold text-nw-muted"><Wallet className="h-3.5 w-3.5 text-nw-info"/>صافي مبيعات الوردية</span>
        <strong className="mt-1 block text-base text-nw-text"><MoneyText amount={report.sales.netSales} currency/></strong>
        <span className="mt-1 block text-[10px] text-nw-muted">مبيعات الوردية بعد خصم المرتجعات.</span>
      </div>
      <div data-testid="shift-summary-cliq" className="rounded-xl border border-nw-border bg-nw-info-bg p-3">
        <span className="flex items-center gap-1 text-[11px] font-bold text-nw-muted"><Smartphone className="h-3.5 w-3.5 text-nw-info"/>صافي CliQ بالوردية</span>
        <strong className="mt-1 block text-base text-nw-info"><MoneyText amount={reconciliation.netCliqMovement} currency/></strong>
        <span className="mt-1 block text-[10px] text-nw-muted">صافي اللي دخل حساب CliQ بالوردية (بيع + سندات قبض − مرتجعات ومصاريف).</span>
      </div>
    </div>
    {profit.status==='ready'&&profit.facts.top.length>0&&<div data-testid="shift-summary-top-items" className="rounded-xl border border-nw-border p-3">
      <h4 className="m-0 mb-2 text-xs font-black text-nw-text">أكثر الأصناف ربحاً</h4>
      <ol className="m-0 list-none space-y-1 p-0">{profit.facts.top.map((item,index)=><li key={`${item.sku}:${index}`} className="flex items-center justify-between gap-2 text-xs"><span className="min-w-0 break-words">{index+1}. {item.productName}</span><MoneyText amount={item.profit} className="font-bold text-nw-ok"/></li>)}</ol>
    </div>}
    <p className="m-0 text-[10px] text-nw-muted">الكاش وCliQ منفصلين دائماً. حركة الدرج بالتفصيل تحت، وباقي الأرقام للمحاسب.</p>
  </section>;
}
