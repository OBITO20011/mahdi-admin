export const liteReportBranch='92600000-0000-4000-8000-000000000200';
export function liteReportDocument(from:string,to=from){
 const customerCollections={cashInMinorUnits:5000,cliqInMinorUnits:3000,bankTransferInMinorUnits:0,chequeInMinorUnits:0,otherInMinorUnits:0,totalInMinorUnits:8000};
 return {success:true,contractVersion:'lite2-business-report-v1',accountingTracked:false,branchId:liteReportBranch,generatedAt:'2026-11-09T17:00:00Z',period:{dateFrom:from,dateTo:to,timezone:'Asia/Amman'},
  sales:{grossSalesInMinorUnits:12500,deliveryFeesInMinorUnits:1000,returnEntitlementInMinorUnits:2500,refundsInMinorUnits:1500,debtReductionInMinorUnits:1000,netSalesInMinorUnits:10000,collectedInMinorUnits:8000,outstandingInMinorUnits:2000,returnCount:1,orderCount:2,completedOrderCount:2},
  cashFlow:{customerCollections,cashCollectedInMinorUnits:5000,cliqCollectedInMinorUnits:3000,cashRefundedInMinorUnits:1000,cliqRefundedInMinorUnits:500,cashNetFlowInMinorUnits:4000,cliqNetFlowInMinorUnits:2500},
  balances:{customerDueInMinorUnits:4000,customerOrderCount:2,customerCount:2},expenses:{totalInMinorUnits:1500,cashInMinorUnits:1000,cliqInMinorUnits:500,count:2},
  dailyBreakdown:[{date:from,completedOrderCount:2,grossSalesInMinorUnits:12500,returnEntitlementInMinorUnits:2500,netSalesInMinorUnits:10000,customerCollections}]};
}
