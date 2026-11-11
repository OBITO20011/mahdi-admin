import {reportToday} from '../src/utils/reportPeriodSelection';
import {posFixtureIds} from './package-f-pos.fixture';
export function liteHomeDocument(today=reportToday()){
 const collections={cashInMinorUnits:5000,cliqInMinorUnits:3000,bankTransferInMinorUnits:0,chequeInMinorUnits:0,otherInMinorUnits:0,totalInMinorUnits:8000};
 return {contractVersion:'lite2-home-v1',accountingTracked:false,branchId:posFixtureIds.branch,generatedAt:today+'T12:00:00+03:00',financialFactsAvailable:true,
  summary:{todayCollections:collections,todayCashCollectedInMinorUnits:5000,todayCliqCollectedInMinorUnits:3000,todaySalesInMinorUnits:12500,todayCompletedOrders:2,monthSalesInMinorUnits:12500,monthNetSalesInMinorUnits:10000,customerReceivablesInMinorUnits:4000,activeProductsCount:3,activeCustomersCount:2},
  sevenDaySales:Array.from({length:7},(_,i)=>{const date=new Date(Date.parse(today+'T12:00:00Z')-(6-i)*86400000).toISOString().slice(0,10);return {date,dayLabel:date,salesInMinorUnits:i===6?12500:0,netSalesInMinorUnits:i===6?10000:0};}),
  orderStatuses:[{status:'new',count:2}],latestOrders:[],chequeAlerts:{due:1,overdue:0}};
}
