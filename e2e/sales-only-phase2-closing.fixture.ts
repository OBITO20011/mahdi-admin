export const liteShiftId='92600000-0000-4000-8000-000000000500';
export const liteClosingDocument={success:true,accountingTracked:false,shiftId:liteShiftId,snapshotStatus:'immutable',
 summary:{id:liteShiftId,shiftNumber:'SHIFT-LITE-LOCAL',branchId:'92600000-0000-4000-8000-000000000200',cashierName:'مالك اختبار',
  startTime:'2026-11-09T07:00:00Z',endTime:'2026-11-09T15:00:00Z',status:'closed',openingCashInMinorUnits:10000,
  cashSalesInMinorUnits:15000,cliqSalesInMinorUnits:5000,cardSalesInMinorUnits:0,cashReceiptsInMinorUnits:3000,cliqReceiptsInMinorUnits:2000,
  cashSupplierPaymentsInMinorUnits:0,cliqSupplierPaymentsInMinorUnits:0,cashExpensesInMinorUnits:1500,cliqExpensesInMinorUnits:500,
  cashRefundsInMinorUnits:2000,cliqRefundsInMinorUnits:1000,ownerWithdrawalsInMinorUnits:2500,ownerWithdrawalReturnsInMinorUnits:500,
  expectedCashInMinorUnits:22500,actualCashInMinorUnits:22500,cashDiscrepancyInMinorUnits:0},
 reconciliation:{expectedCashInMinorUnits:22500,actualCashInMinorUnits:22500,cashDiscrepancyInMinorUnits:0,netMovementInMinorUnits:20000},
 sales:[{orderId:'92600000-0000-4000-8000-000000000600',totalInMinorUnits:26000,collectedInMinorUnits:20000}],returns:4000,cashExpensesInMinorUnits:1500};

// Mixed document contains no invented per-order values or cost/profit totals.
export const mixedClosingDocument={success:true,accountingTracked:false,historyWithoutCost:true,contractVersion:'lite2-mixed-shift-v1',shiftId:liteShiftId,snapshotStatus:'immutable',summary:liteClosingDocument.summary,reconciliation:liteClosingDocument.reconciliation,orderCount:1,returnCount:2,returnMoneyInMinorUnits:3000,cashExpensesInMinorUnits:1500};
