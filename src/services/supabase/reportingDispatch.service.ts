import {isSupabaseConfigured,supabase} from '../../lib/supabase';
import {parseOperationalBusinessReport} from './reports.service';
import {parseHomeDashboard} from './dashboard.service';
import {parseSalesOnlyBusinessReport,type SalesOnlyBusinessReport} from './salesOnlyReport.service';
import {parseSalesOnlyHome,type SalesOnlyHomeData} from './salesOnlyHome.service';
import type {OperationalBusinessReport} from '../../types';
import type {HomeDashboardData} from '../../types/dashboard';
type Response={data:unknown;error:{code?:string;message?:string}|null;status?:number};
export type ReportingRpc=(name:string,args?:Record<string,unknown>)=>PromiseLike<Response>;
const originals={lite1_reporting_report2:'get_operational_business_report',lite1_reporting_home2:'get_home_dashboard'} as const;
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export async function readReportingWithRpc(rpc:ReportingRpc,name:keyof typeof originals,args:Record<string,unknown>){const result=await rpc(name,args);if(result.data==null&&result.status===404&&result.error?.code==='PGRST202'&&result.error.message?.includes(name))return rpc(originals[name],name==='lite1_reporting_home2'?undefined:args);return result;}
export function parseAccountingReport(value:unknown,branchId:string,from:string,to:string):{kind:'mixed';report:SalesOnlyBusinessReport}|{kind:'full';report:OperationalBusinessReport}{
 if(!record(value))throw Error('REPORTING-01');if(value.accountingTracked===false){if(value.historyWithoutCost!==true)throw Error('REPORTING-01');return {kind:'mixed',report:parseSalesOnlyBusinessReport(value,branchId,from,to)};}
 if(value.historyWithoutCost!==undefined||value.accountingTracked!==undefined)throw Error('REPORTING-01');return {kind:'full',report:parseOperationalBusinessReport(value,branchId,from,to)};
}
export function parseAccountingHome(value:unknown,branchId:string):HomeDashboardData|SalesOnlyHomeData{
 if(!record(value))throw Error('REPORTING-01');if(value.accountingTracked===false){if(value.historyWithoutCost!==true)throw Error('REPORTING-01');return {...parseSalesOnlyHome(value,branchId),historyWithoutCost:true};}
 if(value.historyWithoutCost!==undefined||value.accountingTracked!==undefined)throw Error('REPORTING-01');return parseHomeDashboard(value);
}
const reportingRpc:ReportingRpc=(name,args)=>{const client=supabase;if(!isSupabaseConfigured||!client)throw Error('REPORTING-01');switch(name){
 case 'lite1_reporting_report2':return client.rpc('lite1_reporting_report2',args);
 case 'get_operational_business_report':return client.rpc('get_operational_business_report',args);
 case 'lite1_reporting_home2':return client.rpc('lite1_reporting_home2',args);
 case 'get_home_dashboard':return client.rpc('get_home_dashboard');
 default:throw Error('REPORTING-01');
}};
export async function fetchAccountingReport(branchId:string,from:string,to:string){const result=await readReportingWithRpc(reportingRpc,'lite1_reporting_report2',{p_branch_id:branchId,p_date_from:from,p_date_to:to});if(result.error)throw Error('REPORTING-01: تعذر التحقق من التقرير؛ أعد القراءة ولا تعتمد بيانات ناقصة.');return parseAccountingReport(result.data,branchId,from,to);}
export async function fetchAccountingHome(branchId:string){const result=await readReportingWithRpc(reportingRpc,'lite1_reporting_home2',{p_branch_id:branchId});if(result.error)throw Error('REPORTING-01: تعذر التحقق من الرئيسية؛ أعد القراءة ولا تعتمد بيانات ناقصة.');return parseAccountingHome(result.data,branchId);}
