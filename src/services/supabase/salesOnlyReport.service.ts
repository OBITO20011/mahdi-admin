import {isSupabaseConfigured,supabase} from '../../lib/supabase';
import {parseCustomerCollections,type CustomerCollectionsInMinorUnits} from '../../utils/customerCollections';

const saleMoney=['grossSalesInMinorUnits','deliveryFeesInMinorUnits','returnEntitlementInMinorUnits','refundsInMinorUnits','debtReductionInMinorUnits','netSalesInMinorUnits','collectedInMinorUnits','outstandingInMinorUnits'] as const;
const flowMoney=['cashCollectedInMinorUnits','cliqCollectedInMinorUnits','cashRefundedInMinorUnits','cliqRefundedInMinorUnits','cashNetFlowInMinorUnits','cliqNetFlowInMinorUnits'] as const;
export interface SalesOnlyBusinessReport {
 branchId:string;generatedAt:string;period:{dateFrom:string;dateTo:string;timezone:'Asia/Amman'};
 sales:Record<typeof saleMoney[number]|'returnCount'|'orderCount'|'completedOrderCount',number>;
 cashFlow:Record<typeof flowMoney[number],number>&{customerCollections:CustomerCollectionsInMinorUnits};
 balances:{customerDueInMinorUnits:number;customerOrderCount:number;customerCount:number};
 expenses:{totalInMinorUnits:number;cashInMinorUnits:number;cliqInMinorUnits:number;count:number};
 dailyBreakdown:{date:string;completedOrderCount:number;grossSalesInMinorUnits:number;returnEntitlementInMinorUnits:number;netSalesInMinorUnits:number;customerCollections:CustomerCollectionsInMinorUnits}[];
}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const invalid=()=>Error('SREP-01: تعذر التحقق من تقرير المبيعات والذمم. أعد قراءته؛ لا تعتمد أرقاماً ناقصة.');
const day=(s:unknown):s is string=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/u.test(s)&&Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
function numbers<K extends string>(v:unknown,keys:readonly K[]):Record<K,number>{
 if(!record(v)||keys.some(k=>!Number.isSafeInteger(v[k])))throw invalid();
 return Object.fromEntries(keys.map(k=>[k,v[k]])) as Record<K,number>;
}
function collections(value:unknown){try{const parsed=parseCustomerCollections(value);if(!parsed)throw invalid();return {...Object.fromEntries(['cashInMinorUnits','cliqInMinorUnits','bankTransferInMinorUnits','chequeInMinorUnits','otherInMinorUnits','totalInMinorUnits'].map(k=>[k,(parsed as unknown as Record<string,unknown>)[k]]))} as unknown as CustomerCollectionsInMinorUnits;}catch{throw invalid();}}
export function parseSalesOnlyBusinessReport(value:unknown,branchId:string,dateFrom:string,dateTo:string):SalesOnlyBusinessReport {
 if(!day(dateFrom)||!day(dateTo)||dateTo<dateFrom||Date.parse(dateTo)-Date.parse(dateFrom)>365*86400000||!record(value)||value.success!==true||value.contractVersion!=='lite2-business-report-v1'||value.accountingTracked!==false||value.branchId!==branchId||!record(value.period)
  ||value.period.dateFrom!==dateFrom||value.period.dateTo!==dateTo||value.period.timezone!=='Asia/Amman'||typeof value.generatedAt!=='string'||!Number.isFinite(Date.parse(value.generatedAt))||!Array.isArray(value.dailyBreakdown)||value.dailyBreakdown.length>366)throw invalid();
 const sales=numbers(value.sales,[...saleMoney,'returnCount','orderCount','completedOrderCount'] as const);
 const cashFlow={...numbers(value.cashFlow,flowMoney),customerCollections:collections(record(value.cashFlow)?value.cashFlow.customerCollections:undefined)};
 const balances=numbers(value.balances,['customerDueInMinorUnits','customerOrderCount','customerCount'] as const),expenses=numbers(value.expenses,['totalInMinorUnits','cashInMinorUnits','cliqInMinorUnits','count'] as const);
 if([sales.returnCount,sales.orderCount,sales.completedOrderCount,balances.customerOrderCount,balances.customerCount,expenses.count].some(n=>n<0))throw invalid();
 const seen=new Set<string>(),dailyBreakdown=value.dailyBreakdown.map(v=>{
  if(!record(v)||!day(v.date)||v.date<dateFrom||v.date>dateTo||seen.has(v.date))throw invalid();seen.add(v.date);
  const n=numbers(v,['completedOrderCount','grossSalesInMinorUnits','returnEntitlementInMinorUnits','netSalesInMinorUnits'] as const);
  if(n.completedOrderCount<0||n.grossSalesInMinorUnits-n.returnEntitlementInMinorUnits!==n.netSalesInMinorUnits)throw invalid();
  return {date:v.date,...n,customerCollections:collections(v.customerCollections)};
 });
 if(sales.grossSalesInMinorUnits-sales.returnEntitlementInMinorUnits!==sales.netSalesInMinorUnits||expenses.cashInMinorUnits+expenses.cliqInMinorUnits!==expenses.totalInMinorUnits
  ||cashFlow.cashCollectedInMinorUnits-cashFlow.cashRefundedInMinorUnits!==cashFlow.cashNetFlowInMinorUnits||cashFlow.cliqCollectedInMinorUnits-cashFlow.cliqRefundedInMinorUnits!==cashFlow.cliqNetFlowInMinorUnits
  ||cashFlow.customerCollections.cashInMinorUnits!==cashFlow.cashCollectedInMinorUnits||cashFlow.customerCollections.cliqInMinorUnits!==cashFlow.cliqCollectedInMinorUnits
  ||dailyBreakdown.reduce((n,d)=>n+d.netSalesInMinorUnits,0)!==sales.netSalesInMinorUnits)throw invalid();
 return {branchId,generatedAt:value.generatedAt,period:{dateFrom,dateTo,timezone:'Asia/Amman'},sales,cashFlow,balances,expenses,dailyBreakdown};
}
export async function fetchSalesOnlyBusinessReport(branchId:string,dateFrom:string,dateTo:string){
 if(!isSupabaseConfigured||!supabase||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(branchId)||!day(dateFrom)||!day(dateTo)||dateTo<dateFrom||Date.parse(dateTo)-Date.parse(dateFrom)>365*86400000)throw invalid();
 const {data,error}=await supabase.rpc('lite1_business_report2',{p_branch_id:branchId,p_date_from:dateFrom,p_date_to:dateTo});
 if(error)throw invalid();return parseSalesOnlyBusinessReport(data,branchId,dateFrom,dateTo);
}
