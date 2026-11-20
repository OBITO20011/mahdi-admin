/** Owner trial item 15 (design A): "how the profit was calculated" box.
 * Every line is a server value except the goods-cost line, which is the exact remainder
 * (net sales − expenses − server net profit), so the lines always add up to the server profit
 * and absorb its cost/return/damage adjustments. Works in integer fils to avoid float drift. */
export interface ReportProfitStep {key:'gross'|'returns'|'cost'|'expenses'|'profit';label:string;amount:number;sign:'+'|'−'|'='}

const fils=(value:number)=>Math.round(value*1000);

export function reportProfitSteps(sales:{grossSales:number;returnEntitlement:number;netSales:number;netProfit:number},expensesTotal:number):ReportProfitStep[]|null {
  const values=[sales.grossSales,sales.returnEntitlement,sales.netSales,sales.netProfit,expensesTotal];
  if(!values.every(Number.isFinite))return null;
  const cost=fils(sales.netSales)-fils(expensesTotal)-fils(sales.netProfit);
  return [
    {key:'gross',label:'إجمالي المبيعات',amount:sales.grossSales,sign:'+'},
    {key:'returns',label:'المرتجعات',amount:sales.returnEntitlement,sign:'−'},
    {key:'cost',label:'تكلفة البضاعة المباعة',amount:cost/1000,sign:'−'},
    {key:'expenses',label:'المصاريف',amount:expensesTotal,sign:'−'},
    {key:'profit',label:'صافي الربح',amount:sales.netProfit,sign:'='},
  ];
}
