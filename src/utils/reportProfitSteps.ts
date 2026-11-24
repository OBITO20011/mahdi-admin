/** Owner trial item 15 (design A): "how the profit was calculated" box.
 * Every line is a server value except the «التلف والاستبدال» line, which is the exact remainder
 * (net sales − goods cost − expenses − server net profit), so the lines always add up to the
 * server profit. The goods-cost line is the server COGS alone (Codex review 2026-11-23 #1):
 * damage, replacement and recovered cost live in the remainder line, shown only when non-zero,
 * with «+» when it adds back to profit. Works in integer fils to avoid float drift. */
export interface ReportProfitStep {key:'gross'|'returns'|'cost'|'adjustments'|'expenses'|'profit';label:string;amount:number;sign:'+'|'−'|'='}

const fils=(value:number)=>Math.round(value*1000);

export function reportProfitSteps(sales:{grossSales:number;returnEntitlement:number;netSales:number;cogs:number;netProfit:number},expensesTotal:number):ReportProfitStep[]|null {
  const values=[sales.grossSales,sales.returnEntitlement,sales.netSales,sales.cogs,sales.netProfit,expensesTotal];
  if(!values.every(Number.isFinite))return null;
  const adjustments=fils(sales.netSales)-fils(sales.cogs)-fils(expensesTotal)-fils(sales.netProfit);
  return [
    {key:'gross',label:'إجمالي المبيعات',amount:sales.grossSales,sign:'+'},
    {key:'returns',label:'المرتجعات',amount:sales.returnEntitlement,sign:'−'},
    {key:'cost',label:'تكلفة البضاعة المباعة',amount:sales.cogs,sign:'−'},
    ...(adjustments===0?[]:[{key:'adjustments' as const,label:'التلف والاستبدال (صافي)',amount:Math.abs(adjustments)/1000,sign:adjustments>0?'−' as const:'+' as const}]),
    {key:'expenses',label:'المصاريف',amount:expensesTotal,sign:'−'},
    {key:'profit',label:'صافي الربح',amount:sales.netProfit,sign:'='},
  ];
}
