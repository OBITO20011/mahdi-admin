export interface PartialPayment216 {
  paymentMethod: 'cash' | 'cliq' | 'debt';
  paidInMinorUnits: number;
  dueInMinorUnits: number;
  initialPaymentMethod: 'cash' | 'cliq' | null;
}

// Presentation/request planning only. SQL must independently price and validate
// the sale and commit the initial payment in the same transaction.
export function partialPayment216(total: number, paid: number,
  method: 'cash' | 'cliq', customerId: string | null): PartialPayment216 {
  if (!Number.isSafeInteger(total) || total <= 0 || !Number.isSafeInteger(paid)
    || paid < 0 || paid > total || !['cash', 'cliq'].includes(method)) {
    throw new Error('المدفوع الآن يجب أن يكون بين صفر وإجمالي الفاتورة.');
  }
  if (paid < total && !customerId) throw new Error('اختر زبوناً مسجلاً لحفظ الباقي على حسابه.');
  if (paid === total) return {paymentMethod: method, paidInMinorUnits: paid,
    dueInMinorUnits: 0, initialPaymentMethod: null};
  return {paymentMethod: 'debt', paidInMinorUnits: paid, dueInMinorUnits: total - paid,
    initialPaymentMethod: paid > 0 ? method : null};
}
