import {cashShift,cashIds,shiftRpcFixture} from './package-f-cash.fixture';
export const expenseRows=[
 {id:'93600000-0000-4000-8000-000000000201',expenseNumber:'EXP-10481',shiftId:cashShift.id,branchId:cashIds.branch,category:'كهرباء وماء',amountInMinorUnits:1234567,paymentMethod:'cash',description:'فاتورة كهرباء الفرع',createdAt:'2026-10-09T08:30:00Z',createdByName:'أحمد',isReversed:false},
 {id:'93600000-0000-4000-8000-000000000202',expenseNumber:'EXP-10482',shiftId:cashShift.id,branchId:cashIds.branch,category:'صيانة',amountInMinorUnits:86500,paymentMethod:'cliq',referenceNumber:'CLIQ-10482',description:'صيانة ثلاجات العرض',createdAt:'2026-10-09T09:00:00Z',createdByName:'أحمد',isReversed:false},
 {id:'93600000-0000-4000-8000-000000000203',expenseNumber:'EXP-10483',shiftId:cashShift.id,branchId:cashIds.branch,category:'نقل ومحروقات',amountInMinorUnits:12500,paymentMethod:'cash',description:'تصحيح فاتورة النقل',createdAt:'2026-10-09T09:15:00Z',createdByName:'أحمد',isReversed:true,reversalReason:'السند مكرر',reversedByName:'المالك'},
];
export const expenseCenter=(closed=false)=>({success:true,expenses:expenseRows,currentShift:closed?null:shiftRpcFixture(cashShift),recentShifts:[]});
export const financialReport={
 success:true,generatedAt:'2026-10-09T10:30:00Z',period:{dateFrom:'2026-10-01',dateTo:'2026-10-09',branchId:cashIds.branch,branchName:'فرع الرمثا'},
 sales:{orderCount:50,posOrderCount:40,websiteOrderCount:10,packageCount:63,baseUnitCount:320,uniqueProductCount:15,subtotalInMinorUnits:16000000,discountInMinorUnits:100000,deliveryFeesInMinorUnits:25000,
  grossSalesInMinorUnits:15925000,returnEntitlementInMinorUnits:1250000,netSalesInMinorUnits:14675000,refundsInMinorUnits:950000,debtReductionInMinorUnits:300000,replacementCostInMinorUnits:180000,restockRecoveryInMinorUnits:450000,cogsInMinorUnits:9200000,grossProfitInMinorUnits:6700000,aftercareAdjustedMarginInMinorUnits:5745000,netProfitInMinorUnits:4423933,collectedInMinorUnits:12000000,outstandingInMinorUnits:2675000,returnCount:5},
 cashFlow:{cashCollectedInMinorUnits:8000000,cliqCollectedInMinorUnits:4000000,cashRefundedInMinorUnits:700000,cliqRefundedInMinorUnits:250000,cashNetFlowInMinorUnits:7300000,cliqNetFlowInMinorUnits:3750000},
 balances:{customerOrderCount:20,customerCount:12,customerDueInMinorUnits:2675000,supplierCount:3,supplierDueInMinorUnits:1234500,supplierAdvancesInMinorUnits:200000},
 expenses:{count:2,totalInMinorUnits:1321067,cashInMinorUnits:1234567,cliqInMinorUnits:86500,categories:[{category:'كهرباء وماء',count:1,amountInMinorUnits:1234567},{category:'صيانة',count:1,amountInMinorUnits:86500}]},
 purchases:{receiptCount:8,totalInMinorUnits:12000000,paidInMinorUnits:9000000,dueInMinorUnits:3000000},
 inventory:{stockedProducts:120,baseUnitsOnHand:4800,baseUnitsReserved:150,valueInMinorUnits:8900000,lowStockProducts:4},
 inventoryMovements:{movementCount:80,affectedProducts:16,unitsIn:2400,unitsOut:600,netUnits:1800,types:[{movementType:'purchase_receipt',movementCount:8,unitsIn:2400,unitsOut:0,netUnits:2400},{movementType:'sales_deduction',movementCount:50,unitsIn:0,unitsOut:600,netUnits:-600}],topProducts:[{productName:'عصير برتقال 250مل',sku:'INV-0001',movementCount:10,unitsIn:1000,unitsOut:300,netUnits:700}]},
 paymentMethods:[{method:'cash',orderCount:30,amountInMinorUnits:8000000},{method:'cliq',orderCount:10,amountInMinorUnits:4000000},{method:'debt',orderCount:10,amountInMinorUnits:3925000}],
 topProducts:[{productName:'عصير برتقال 250مل',sku:'INV-0001',packageCount:40,revenueInMinorUnits:1234500,profitInMinorUnits:450500},{productName:'عصير تفاح 250مل',sku:'INV-0002',packageCount:23,revenueInMinorUnits:860500,profitInMinorUnits:220000}],
};
