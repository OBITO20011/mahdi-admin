export interface SupplierCancellationPreview {
  receiptId: string;
  receiptNumber: string;
  total: number;
  payable: number;
  payments: {id: string; amount: number; method: string; date: string; cashShiftId: string | null; cashShiftStatus: string | null}[];
  paymentsTotal: number;
  supplierBalanceBefore: number;
  supplierBalanceAfter: number;
}

export function parseSupplierCancellationPreview(value: unknown, receiptId: string): SupplierCancellationPreview {
  if (!value || typeof value !== 'object') throw new Error('تعذر إثبات بيانات معاينة الإلغاء.');
  const data = value as SupplierCancellationPreview;
  const money = [data.total, data.payable, data.paymentsTotal, data.supplierBalanceBefore, data.supplierBalanceAfter];
  if (data.receiptId !== receiptId || typeof data.receiptNumber !== 'string' || !data.receiptNumber
    || !money.every(Number.isSafeInteger) || data.total < 0 || data.payable < 0 || data.paymentsTotal < 0
    || !Array.isArray(data.payments) || data.payments.some(p => !p || typeof p.id !== 'string'
      || !p.id || !Number.isSafeInteger(p.amount) || p.amount <= 0 || typeof p.method !== 'string' || !p.method
      || typeof p.date !== 'string' || !Number.isFinite(Date.parse(p.date))
      || !(p.cashShiftId === null || typeof p.cashShiftId === 'string')
      || !(p.cashShiftStatus === null || typeof p.cashShiftStatus === 'string'))
    || new Set(data.payments.map(p => p.id)).size !== data.payments.length
    || data.payments.reduce((sum, p) => sum + p.amount, 0) !== data.paymentsTotal
    || data.supplierBalanceAfter !== data.supplierBalanceBefore - data.payable + data.paymentsTotal) {
    throw new Error('تعذر إثبات بيانات معاينة الإلغاء. أعد تحميل السند.');
  }
  return data;
}
