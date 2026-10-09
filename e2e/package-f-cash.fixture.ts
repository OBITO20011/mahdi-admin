import type {Shift} from '../src/types';
export const cashIds={actor:'93600000-0000-4000-8000-000000000001',branch:'93600000-0000-4000-8000-000000000002',shift:'93600000-0000-4000-8000-000000000003'};
export const cashShift:Shift={id:cashIds.shift,shiftNumber:'SHIFT-10482',branchId:cashIds.branch,cashierName:'أحمد',startTime:'2026-10-09T05:30:00Z',
  openingCash:50,totalCashSales:734,totalCliqSales:300,totalCardSales:0,totalReceipts:90.3,totalPayments:91,
  cashReceipts:62.3,cliqReceipts:28,cashSupplierPayments:0,cliqSupplierPayments:15,cashExpenses:24,cliqExpenses:0,
  cashRefunds:12,cliqRefunds:4,expectedCash:810.3,status:'open'};
export const recentCashShifts:Shift[]=[
  {id:'93600000-0000-4000-8000-000000000004',shiftNumber:'SHIFT-10481',cashierName:'سامر',expectedCash:388.25,actualCash:388.25,cashDiscrepancy:0,status:'closed'},
  {id:'93600000-0000-4000-8000-000000000005',shiftNumber:'SHIFT-10480',cashierName:'أحمد',expectedCash:512.6,actualCash:511.6,cashDiscrepancy:-1,status:'closed'},
  {id:'93600000-0000-4000-8000-000000000006',shiftNumber:'SHIFT-10479',cashierName:'أحمد',expectedCash:301.9,actualCash:302.15,cashDiscrepancy:.25,status:'closed'},
  {id:'93600000-0000-4000-8000-000000000007',shiftNumber:'SHIFT-10478',status:'cancelled',expectedCash:0,cancellationReason:'فُتحت بالخطأ',cancelledByName:'المالك'},
  {id:'93600000-0000-4000-8000-000000000008',shiftNumber:'SHIFT-10477',status:'reversed',expectedCash:0,reversalReason:'تصحيح العمليات',reversedByName:'المالك',reversalId:'REV-42'},
].map(row=>({...cashShift,...row,startTime:'2026-10-08T05:30:00Z',endTime:'2026-10-08T11:00:00Z'} as Shift));
export function shiftRpcFixture(s:Shift){return {id:s.id,shiftNumber:s.shiftNumber,branchId:s.branchId,cashierName:s.cashierName,startTime:s.startTime,endTime:s.endTime,status:s.status,
  openingCashInMinorUnits:s.openingCash*1000,cashSalesInMinorUnits:s.totalCashSales*1000,cliqSalesInMinorUnits:s.totalCliqSales*1000,cardSalesInMinorUnits:s.totalCardSales*1000,
  cashReceiptsInMinorUnits:s.cashReceipts*1000,cliqReceiptsInMinorUnits:s.cliqReceipts*1000,cashSupplierPaymentsInMinorUnits:s.cashSupplierPayments*1000,cliqSupplierPaymentsInMinorUnits:s.cliqSupplierPayments*1000,
  cashExpensesInMinorUnits:s.cashExpenses*1000,cliqExpensesInMinorUnits:s.cliqExpenses*1000,cashRefundsInMinorUnits:s.cashRefunds*1000,cliqRefundsInMinorUnits:s.cliqRefunds*1000,
  expectedCashInMinorUnits:s.expectedCash*1000,actualCashInMinorUnits:s.actualCash===undefined?null:s.actualCash*1000,cashDiscrepancyInMinorUnits:s.cashDiscrepancy===undefined?null:s.cashDiscrepancy*1000,
  discrepancyReason:s.discrepancyReason,cancellationReason:s.cancellationReason,cancelledByName:s.cancelledByName,reversalReason:s.reversalReason,reversedByName:s.reversedByName,reversalId:s.reversalId};}
export const cashReportFixture={success:true,generatedAt:'2026-10-09T08:30:00Z',snapshotStatus:'live',salesDetailStatus:'available',shift:shiftRpcFixture(cashShift),
  sales:{salesDefinitionVersion:133,orderCount:31,posOrderCount:29,websiteOrderCount:2,packageCount:64,uniqueProductCount:18,grossSalesInMinorUnits:1092000,refundsInMinorUnits:16000,netSalesInMinorUnits:1073000,returnEntitlementInMinorUnits:19000,debtReductionInMinorUnits:3000,creditSalesInMinorUnits:58000,
    collectedDirectSalesInMinorUnits:1034000,initialReceiptPaymentsInMinorUnits:0,initialReceiptCashInMinorUnits:0,initialReceiptCliqInMinorUnits:0},
  collections:{count:4,cashInMinorUnits:62300,cliqInMinorUnits:28000,initialPaymentsInMinorUnits:0,initialCashInMinorUnits:0,initialCliqInMinorUnits:0},
  outflows:{supplierPaymentCount:1,cashSupplierPaymentsInMinorUnits:0,cliqSupplierPaymentsInMinorUnits:15000,expenseCount:2,cashExpensesInMinorUnits:24000,cliqExpensesInMinorUnits:0,returnCount:3,cashRefundsInMinorUnits:12000,cliqRefundsInMinorUnits:4000},
  reconciliation:{openingCashInMinorUnits:50000,expectedCashInMinorUnits:810300,totalInflowsInMinorUnits:1124300,totalOutflowsInMinorUnits:55000,netMovementInMinorUnits:1069300,netCliqMovementInMinorUnits:309000},
  expenseBreakdown:[{category:'تشغيل',count:2,amountInMinorUnits:24000}],returnBreakdown:[{refundMethod:'cash',stockDisposition:'restock',count:2,amountInMinorUnits:12000},{refundMethod:'cliq',stockDisposition:'damaged',count:1,amountInMinorUnits:4000}],
  returnQuantityBreakdown:[{eventId:'return-1',productId:'sku-1',productName:'عصير برتقال',sellableQuantity:3,defectQuantity:1,customerDamageQuantity:0}]};
