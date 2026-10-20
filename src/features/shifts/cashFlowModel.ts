import type {Shift} from '../../types';

export type CashFlowKind = 'sales'|'receipts'|'supplier_payments'|'expenses'|'refunds'|'withdrawals'|'withdrawal_returns';
export interface CashFlowRow {
  kind:CashFlowKind;
  method:'cash'|'cliq'|'card';
  label:string;
  direction:'in'|'out';
  amount:number;
}

/** Presentation of existing server fields only. Expected cash is never recalculated here. */
export function cashFlowRows(shift:Shift):CashFlowRow[] {
  return [
    {kind:'sales',method:'cash',label:'مبيعات كاش',direction:'in',amount:shift.totalCashSales},
    {kind:'receipts',method:'cash',label:'سندات قبض كاش',direction:'in',amount:shift.cashReceipts},
    ...(shift.ownerWithdrawalReturns===undefined?[]:[{kind:'withdrawal_returns' as const,method:'cash' as const,label:'إرجاع سحوبات المالك',direction:'in' as const,amount:shift.ownerWithdrawalReturns}]),
    {kind:'supplier_payments',method:'cash',label:'دفعات الموردين كاش',direction:'out',amount:shift.cashSupplierPayments},
    {kind:'expenses',method:'cash',label:'مصروفات من الدرج',direction:'out',amount:shift.cashExpenses},
    {kind:'refunds',method:'cash',label:'مبالغ مرتجعات كاش',direction:'out',amount:shift.cashRefunds},
    ...(shift.ownerWithdrawals===undefined?[]:[{kind:'withdrawals' as const,method:'cash' as const,label:'سحوبات المالك',direction:'out' as const,amount:shift.ownerWithdrawals}]),
    {kind:'sales',method:'cliq',label:'مبيعات CliQ',direction:'in',amount:shift.totalCliqSales},
    {kind:'receipts',method:'cliq',label:'سندات قبض CliQ',direction:'in',amount:shift.cliqReceipts},
    {kind:'supplier_payments',method:'cliq',label:'دفعات الموردين CliQ',direction:'out',amount:shift.cliqSupplierPayments},
    {kind:'expenses',method:'cliq',label:'مصروفات CliQ',direction:'out',amount:shift.cliqExpenses},
    {kind:'refunds',method:'cliq',label:'مبالغ مرتجعات CliQ',direction:'out',amount:shift.cliqRefunds},
    ...(shift.totalCardSales===0?[]:[{kind:'sales' as const,method:'card' as const,label:'مبيعات بطاقة (تاريخية)',direction:'in' as const,amount:shift.totalCardSales}]),
  ];
}
