import type {Shift,ShiftClosingReport} from '../../types';

export interface SalesOnlyShiftClosingReport {
 accountingTracked:false;shift:Shift;snapshotStatus:'immutable'|'legacy_recalculated'|'live'|'not_applicable';
 orderCount:number;returnEntitlementInMinorUnits:number;netMovementInMinorUnits:number;
}
export type CashShiftClosingResult=ShiftClosingReport|SalesOnlyShiftClosingReport;
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const invalid=()=>Error('SHIFT-01: تعذر التحقق من تقرير الوردية؛ أعد قراءة التقرير ولا تعتمد أرقاماً ناقصة.');
const minor=(v:unknown)=>{if(!Number.isSafeInteger(v))throw invalid();return v as number;};
export function isSalesOnlyShiftReport(value:CashShiftClosingResult):value is SalesOnlyShiftClosingReport{return 'accountingTracked' in value&&value.accountingTracked===false;}

/** Reads the existing immutable lite document directly. It does not pretend it
 * is a full accounting report,fill missing sections with zero,or read live
 * order totals to reconstruct an old closing snapshot. */
export function parseSalesOnlyShiftReport(value:unknown,shiftId:string,mapShift:(summary:Record<string,unknown>)=>Shift):SalesOnlyShiftClosingReport {
 if(!record(value)||value.success!==true||value.accountingTracked!==false||value.shiftId!==shiftId
  ||!record(value.summary)||!record(value.reconciliation)||!Array.isArray(value.sales))throw invalid();
 const s=value.summary,r=value.reconciliation;
 if(s.id!==shiftId||typeof s.shiftNumber!=='string'||typeof s.branchId!=='string'||typeof s.startTime!=='string'
  ||!['open','closed','cancelled','reversed'].includes(String(s.status))
  ||!['immutable','legacy_recalculated','live','not_applicable'].includes(String(value.snapshotStatus)))throw invalid();
 for(const key of ['openingCashInMinorUnits','cashSalesInMinorUnits','cliqSalesInMinorUnits','cardSalesInMinorUnits','cashReceiptsInMinorUnits','cliqReceiptsInMinorUnits',
  'cashSupplierPaymentsInMinorUnits','cliqSupplierPaymentsInMinorUnits','cashExpensesInMinorUnits','cliqExpensesInMinorUnits','cashRefundsInMinorUnits','cliqRefundsInMinorUnits',
  'ownerWithdrawalsInMinorUnits','ownerWithdrawalReturnsInMinorUnits','expectedCashInMinorUnits'])minor(s[key]);
 for(const key of ['actualCashInMinorUnits','cashDiscrepancyInMinorUnits']){
  if(s[key]!==null)minor(s[key]);if(r[key]!==s[key])throw invalid();
 }
 if(minor(r.expectedCashInMinorUnits)!==s.expectedCashInMinorUnits)throw invalid();
 const expected=minor(s.openingCashInMinorUnits)+minor(s.cashSalesInMinorUnits)+minor(s.cashReceiptsInMinorUnits)
  -minor(s.cashSupplierPaymentsInMinorUnits)-minor(s.cashExpensesInMinorUnits)-minor(s.cashRefundsInMinorUnits)
  -minor(s.ownerWithdrawalsInMinorUnits)+minor(s.ownerWithdrawalReturnsInMinorUnits);
 // These equations assert the documented snapshot contract;they never supply
 // substitute monetary values to the UI.
 if(!Number.isSafeInteger(expected)||expected!==s.expectedCashInMinorUnits)throw invalid();
 const net=minor(s.cashSalesInMinorUnits)+minor(s.cliqSalesInMinorUnits)+minor(s.cardSalesInMinorUnits)+minor(s.cashReceiptsInMinorUnits)+minor(s.cliqReceiptsInMinorUnits)
  -minor(s.cashSupplierPaymentsInMinorUnits)-minor(s.cliqSupplierPaymentsInMinorUnits)-minor(s.cashExpensesInMinorUnits)-minor(s.cliqExpensesInMinorUnits)-minor(s.cashRefundsInMinorUnits)-minor(s.cliqRefundsInMinorUnits);
 if(!Number.isSafeInteger(net)||net!==minor(r.netMovementInMinorUnits))throw invalid();
 if(s.status==='closed'&&(s.actualCashInMinorUnits===null||s.cashDiscrepancyInMinorUnits===null
  ||minor(s.actualCashInMinorUnits)-minor(s.expectedCashInMinorUnits)!==s.cashDiscrepancyInMinorUnits||value.snapshotStatus!=='immutable'))throw invalid();
 const ids=new Set<string>();
 for(const order of value.sales){if(!record(order)||typeof order.orderId!=='string'||ids.has(order.orderId)||minor(order.totalInMinorUnits)<0
  ||minor(order.collectedInMinorUnits)<0||minor(order.collectedInMinorUnits)>minor(order.totalInMinorUnits))throw invalid();ids.add(order.orderId);}
 const entitlement=minor(value.returns);if(entitlement<0||minor(value.cashExpensesInMinorUnits)!==s.cashExpensesInMinorUnits)throw invalid();
 return {accountingTracked:false,shift:mapShift(s),snapshotStatus:value.snapshotStatus as SalesOnlyShiftClosingReport['snapshotStatus'],
  orderCount:ids.size,returnEntitlementInMinorUnits:entitlement,netMovementInMinorUnits:minor(r.netMovementInMinorUnits)};
}
