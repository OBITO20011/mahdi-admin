import {reportToday} from './reportPeriodSelection';

/** Owner trial item 17 helpers: pure presentation, no money recalculation. */
export interface ShiftTopItem {productName:string;sku:string;profit:number}
export interface ShiftProfitFacts {netProfit:number;top:ShiftTopItem[]}

const validDate=(value:unknown)=>{const date=typeof value==='string'&&value?new Date(value):null;return date&&Number.isFinite(date.getTime())?date:null;};

/** Amman calendar days the shift touched; an open shift runs to today. Null when the start is unknown. */
export function shiftReportDays(startTime:string|undefined,endTime?:string,now=new Date()):{from:string;to:string}|null {
  const start=validDate(startTime);if(!start)return null;
  const from=reportToday(start);
  const to=reportToday(validDate(endTime)??now);
  return to<from?{from,to:from}:{from,to};
}

/** The plain summary only renders for a complete server report; partial or legacy payloads keep the detailed report alone. */
export function canShowShiftOwnerSummary(report:{shift:{startTime?:string};sales:{netSales?:number};reconciliation:{netCliqMovement?:number}}):boolean {
  return shiftReportDays(report.shift.startTime)!==null&&Number.isFinite(report.sales.netSales)&&Number.isFinite(report.reconciliation.netCliqMovement);
}

export function topProfitProducts(items:ReadonlyArray<{productName:string;sku:string;profit:number}>,count=3):ShiftTopItem[] {
  return items.filter(item=>Number.isFinite(item.profit)&&item.profit>0)
    .map(({productName,sku,profit})=>({productName,sku,profit}))
    .sort((a,b)=>b.profit-a.profit)
    .slice(0,count);
}

export function shiftDurationLabel(startTime:string,endTime?:string,now=new Date()):string {
  const minutes=Math.max(0,Math.round(((endTime?new Date(endTime):now).getTime()-new Date(startTime).getTime())/60000));
  const hours=Math.floor(minutes/60),rest=minutes%60;
  return hours>0?`${hours} ساعة${rest?` و${rest} دقيقة`:''}`:`${rest} دقيقة`;
}
