import {isSupabaseConfigured,supabase} from '../../lib/supabase';
import {parseCustomerCollections} from '../../utils/customerCollections';
import type {HomeDashboardData,HomeDashboardSummary,HomeDashboardSalesDay} from '../../types/dashboard';

export interface SalesOnlyHomeData {
 accountingTracked:false;generatedAt:string;financialFactsAvailable:true;
 summary:Pick<HomeDashboardSummary,'todayCollections'|'todayCashCollectedInMinorUnits'|'todayCliqCollectedInMinorUnits'|'todaySalesInMinorUnits'|'todayCompletedOrders'|'monthSalesInMinorUnits'|'monthNetSalesInMinorUnits'|'customerReceivablesInMinorUnits'|'activeProductsCount'|'activeCustomersCount'>;
 sevenDaySales:HomeDashboardSalesDay[];orderStatuses:HomeDashboardData['orderStatuses'];latestOrders:HomeDashboardData['latestOrders'];chequeAlerts:{due:number;overdue:number};
}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const invalid=()=>Error('HOME-01: تعذر التحقق من مركز اليوم. أعد القراءة ولا تعتمد أرقاماً ناقصة.');
const integer=(v:unknown)=>{if(!Number.isSafeInteger(v))throw invalid();return v as number;};
const count=(v:unknown)=>{const n=integer(v);if(n<0)throw invalid();return n;};
const text=(v:unknown)=>{if(typeof v!=='string')throw invalid();return v;};
const date=(v:unknown)=>{const s=text(v);if(!/^\d{4}-\d{2}-\d{2}$/u.test(s)||!Number.isFinite(Date.parse(s+'T12:00:00Z'))||new Date(s+'T12:00:00Z').toISOString().slice(0,10)!==s)throw invalid();return s;};
export function parseSalesOnlyHome(value:unknown,branchId:string):SalesOnlyHomeData {
 if(!record(value)||value.contractVersion!=='lite2-home-v1'||value.accountingTracked!==false||value.branchId!==branchId||value.financialFactsAvailable!==true||!record(value.summary)||!record(value.chequeAlerts)||!Array.isArray(value.sevenDaySales)||value.sevenDaySales.length!==7||!Array.isArray(value.orderStatuses)||!Array.isArray(value.latestOrders)||value.latestOrders.length>5)throw invalid();
 const s=value.summary,generatedAt=text(value.generatedAt);if(!Number.isFinite(Date.parse(generatedAt)))throw invalid();
 const raw=parseCustomerCollections(s.todayCollections);if(!raw)throw invalid();
 const collections={cashInMinorUnits:raw.cashInMinorUnits,cliqInMinorUnits:raw.cliqInMinorUnits,bankTransferInMinorUnits:raw.bankTransferInMinorUnits,chequeInMinorUnits:raw.chequeInMinorUnits,otherInMinorUnits:raw.otherInMinorUnits,totalInMinorUnits:raw.totalInMinorUnits};
 const summary={todayCollections:collections,todayCashCollectedInMinorUnits:integer(s.todayCashCollectedInMinorUnits),todayCliqCollectedInMinorUnits:integer(s.todayCliqCollectedInMinorUnits),todaySalesInMinorUnits:integer(s.todaySalesInMinorUnits),todayCompletedOrders:count(s.todayCompletedOrders),monthSalesInMinorUnits:integer(s.monthSalesInMinorUnits),monthNetSalesInMinorUnits:integer(s.monthNetSalesInMinorUnits),customerReceivablesInMinorUnits:integer(s.customerReceivablesInMinorUnits),activeProductsCount:count(s.activeProductsCount),activeCustomersCount:count(s.activeCustomersCount)};
 if(collections.cashInMinorUnits!==summary.todayCashCollectedInMinorUnits||collections.cliqInMinorUnits!==summary.todayCliqCollectedInMinorUnits)throw invalid();
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Amman',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(generatedAt));
 const sevenDaySales=value.sevenDaySales.map((v,i)=>{if(!record(v))throw invalid();const day=date(v.date);if(day!==new Date(Date.parse(today+'T12:00:00Z')-(6-i)*86400000).toISOString().slice(0,10))throw invalid();return {date:day,dayLabel:day,salesInMinorUnits:integer(v.salesInMinorUnits),netSalesInMinorUnits:integer(v.netSalesInMinorUnits)};});
 if(sevenDaySales[6].salesInMinorUnits!==summary.todaySalesInMinorUnits)throw invalid();
 const seen=new Set<string>(),orderStatuses=value.orderStatuses.map(v=>{if(!record(v))throw invalid();const status=text(v.status);if(seen.has(status))throw invalid();seen.add(status);return {status,count:count(v.count)};});
 const ids=new Set<string>(),latestOrders=value.latestOrders.map(v=>{if(!record(v))throw invalid();const id=text(v.id);if(ids.has(id))throw invalid();ids.add(id);const createdAt=text(v.createdAt);if(!Number.isFinite(Date.parse(createdAt)))throw invalid();return {id,orderNumber:text(v.orderNumber),customerName:text(v.customerName),status:text(v.status),paymentStatus:text(v.paymentStatus),totalInMinorUnits:integer(v.totalInMinorUnits),source:text(v.source),createdAt};});
 return {accountingTracked:false,generatedAt,financialFactsAvailable:true,summary,sevenDaySales,orderStatuses,latestOrders,chequeAlerts:{due:count(value.chequeAlerts.due),overdue:count(value.chequeAlerts.overdue)}};
}
export async function fetchSalesOnlyHome(branchId:string){
 if(!isSupabaseConfigured||!supabase)throw invalid();const {data,error}=await supabase.rpc('lite1_home2',{p_branch_id:branchId});if(error)throw invalid();return parseSalesOnlyHome(data,branchId);
}
