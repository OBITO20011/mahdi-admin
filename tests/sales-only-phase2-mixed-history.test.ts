import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAccountingHome,parseAccountingReport,readReportingWithRpc} from '../src/services/supabase/reportingDispatch.service';
import {parseHomeDashboard} from '../src/services/supabase/dashboard.service';
import {liteHomeDocument} from '../e2e/sales-only-phase2-home.fixture';
import {liteReportDocument,liteReportBranch} from '../e2e/sales-only-phase2-report.fixture';
import {homeFixture} from '../e2e/package-f-home.fixture';
import {posFixtureIds} from '../e2e/package-f-pos.fixture';
test('reporting uses immutable history contract,not currentON;missing mixed evidence refused notconvertedtofull',()=>{
 const day='2026-11-09',home={...liteHomeDocument(day),historyWithoutCost:true},report={...liteReportDocument(day),historyWithoutCost:true};
 const parsedHome=parseAccountingHome(home,posFixtureIds.branch);assert.ok('accountingTracked' in parsedHome);assert.equal(parsedHome.accountingTracked,false);assert.equal(parseAccountingReport(report,liteReportBranch,day,day).kind,'mixed');
 for(const value of [{...home,historyWithoutCost:undefined},{...home,accountingTracked:true},{...home,branchId:'other'},{...home,summary:{...home.summary,todaySalesInMinorUnits:undefined}}])assert.throws(()=>parseAccountingHome(value,posFixtureIds.branch));
 for(const value of [{...report,historyWithoutCost:undefined},{...report,accountingTracked:true},{...report,sales:{...report.sales,returnEntitlementInMinorUnits:undefined}}])assert.throws(()=>parseAccountingReport(value,liteReportBranch,day,day));
 const full={generatedAt:'2026-11-09T12:00:00Z',summary:homeFixture.summary,access:{canViewProfit:true},latestOrders:[],stockAlerts:[],orderStatuses:[],sevenDaySales:[]};assert.deepEqual(parseAccountingHome(full,posFixtureIds.branch),parseHomeDashboard(full));
});
test('historical report dispatcher onlymissingexactRPC permitsold219 fallback;cannotlosebranch/period arguments',async()=>{
 for(const name of ['lite1_reporting_report2','lite1_reporting_home2'] as const){const args={p_branch_id:posFixtureIds.branch,p_date_from:'2026-11-09',p_date_to:'2026-11-09'},calls:unknown[]=[];await readReportingWithRpc(async(n,a)=>{calls.push([n,a]);return n===name?{data:null,error:{code:'PGRST202',message:'public.'+name},status:404}:{data:{},error:null};},name,args);assert.deepEqual(calls,[[name,args],[name==='lite1_reporting_home2'?'get_home_dashboard':'get_operational_business_report',name==='lite1_reporting_home2'?undefined:args]]);
 for(const bad of [{data:null,error:{code:'PGRST202',message:name},status:500},{data:null,error:{code:'42501',message:'denied'},status:404},{data:{malformed:true},error:null,status:200}]){let count=0;await readReportingWithRpc(async()=>{count++;return bad;},name,args);assert.equal(count,1);}}
});
