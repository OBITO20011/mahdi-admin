export interface PartialPayment216 {
  paymentMethod: 'cash' | 'cliq' | 'debt';
  paidInMinorUnits: number;
  dueInMinorUnits: number;
  initialPaymentMethod: 'cash' | 'cliq' | null;
}

export function initialPaymentText216(text: string): number {
  const normalized = text.trim().replace(/[٠-٩۰-۹]/gu, c => String(c.charCodeAt(0) - (c <= '٩' ? 0x660 : 0x6f0))).replace('٫', '.');
  if (!normalized) return 0;
  if (!/^\d+(?:\.\d{0,3})?$/u.test(normalized)) throw new Error('اكتب المدفوع الآن بثلاث خانات عشرية كحد أقصى.');
  const [whole, fraction = ''] = normalized.split('.');
  const minor = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('المدفوع الآن أكبر من الحد المسموح.');
  return Number(minor);
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
