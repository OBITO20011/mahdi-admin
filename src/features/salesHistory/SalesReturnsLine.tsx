import {useEffect,useState} from 'react';
import {MoneyText} from '../../components/ui';
import {fetchAccountingReport} from '../../services/supabase/reportingDispatch.service';
import {useAppStoreSelector} from '../../stores/useAppStore';
import {useAuthStore} from '../../stores/useAuthStore';
import {canUseNavigationAction} from '../more/adminNavigation.config';

interface NetFigures {gross:number;returns:number;net:number}

/**
 * Owner trial item 9: «الإجمالي · المرتجعات · الصافي» under the sales history total.
 * All three figures come from the canonical business report for the same Amman days,
 * so they always agree with «التقارير». Roles without reports access, or a failed
 * read, see nothing rather than an unverified net figure.
 */
export function SalesReturnsLine({fromDate,toDate,refreshKey}:{fromDate:string;toDate:string;refreshKey?:unknown}) {
  const branchId=useAppStoreSelector(state=>state.activeBranch.id);
  const {roleName,roles}=useAuthStore();
  const allowed=canUseNavigationAction({type:'tab',destination:'reports'},roleName,roles);
  const [figures,setFigures]=useState<NetFigures|null>(null);
  useEffect(()=>{
    let active=true;setFigures(null);
    if(!allowed||!branchId||!fromDate||!toDate||toDate<fromDate)return()=>{active=false;};
    fetchAccountingReport(branchId,fromDate,toDate).then(result=>{
      if(!active)return;
      setFigures(result.kind==='full'
        ?{gross:result.report.sales.grossSales,returns:result.report.sales.returnEntitlement,net:result.report.sales.netSales}
        :{gross:result.report.sales.grossSalesInMinorUnits/1000,returns:result.report.sales.returnEntitlementInMinorUnits/1000,net:result.report.sales.netSalesInMinorUnits/1000});
    }).catch(()=>{if(active)setFigures(null);});
    return()=>{active=false;};
  },[allowed,branchId,fromDate,toDate,refreshKey]);
  if(!figures)return null;
  return <div data-testid="sales-history-net" className="mt-3 rounded-xl bg-nw-surface-2 p-3 text-sm">
    <div className="grid grid-cols-3 gap-2 text-center">
      <div><span className="block text-xs text-nw-muted">الإجمالي</span><MoneyText amount={figures.gross} className="font-bold"/></div>
      <div><span className="block text-xs text-nw-muted">المرتجعات</span><MoneyText amount={-figures.returns} className="font-bold text-nw-bad"/></div>
      <div><span className="block text-xs text-nw-muted">الصافي</span><MoneyText amount={figures.net} className="font-bold text-nw-ok"/></div>
    </div>
    <p className="m-0 mt-2 text-xs text-nw-muted">حسب تقرير نفس الأيام: المرتجعات = كل مرتجع انعمل بهالأيام (كاش، CliQ أو تخفيض دين).</p>
  </div>;
}
